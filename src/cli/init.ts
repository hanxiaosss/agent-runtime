/**
 * init command
 *
 * Generates the .harness/ directory in the current project:
 *   .harness/
 *   ├── config.yaml          — project config
 *   ├── policies/
 *   │   ├── protected-files.yaml
 *   │   ├── mcp-safety.yaml
 *   │   └── git-safety.yaml
 *   ├── hooks/
 *   │   └── handler.mjs      — unified hook entry point
 *   └── README.md            — setup guide for agent settings
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Templates ──────────────────────────────────────────────────────

const CONFIG_YAML = `# Agent Runtime Harness Configuration
# See: doc/guidelines/hook-adaptation-table.md

project: ${"{project}"}

# Which agent runtime adapters to enable
# Select one: claude-code, qoder, codex, copilot, trae
adapters:
  - {agent}

# Trace configuration
trace:
  enabled: true
  dir: .harness/traces

# Policy directories to load (relative to .harness/)
policies:
  - policies
`;

const PROTECTED_FILES_YAML = `# Protected Files Policy
# Prevents agents from modifying sensitive files.

name: protected-files
description: Prevent modification of sensitive configuration and lock files

rules:
  - name: block-env-files
    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/.env"
          - "**/.env.*"
          - "**/*.env"
    action: deny
    feedback: "Cannot modify environment files (.env). These contain secrets and must be edited manually."

  - name: block-lock-files
    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/package-lock.json"
          - "**/pnpm-lock.yaml"
          - "**/yarn.lock"
    action: deny
    feedback: "Cannot modify lock files directly. Run the package manager instead."

  - name: block-core-files
    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "src/core/**"
          - "src/kernel/**"
    action: deny
    feedback: "Core module files require human review. Changes to core modules need explicit approval."

  - name: warn-config-changes
    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/tsconfig.json"
          - "**/package.json"
    action: warn
    feedback: "You are modifying a project configuration file. Ensure this is intentional."
`;

const MCP_SAFETY_YAML = `# MCP Safety Policy
# Controls agent access to MCP servers and operations.

name: mcp-safety
description: Controls agent access to MCP servers and operations

rules:
  - name: block-database-writes
    when: mcp.before
    match:
      - field: server
        pattern: "database"
      - field: operation
        pattern:
          - "write"
          - "delete"
          - "drop"
          - "truncate"
    action: deny
    feedback: "Direct database write operations are not allowed. Use the application API layer."

  - name: warn-database-reads
    when: mcp.before
    match:
      - field: server
        pattern: "database"
    action: warn
    feedback: "Database access detected. Ensure queries are read-only."

  - name: block-filesystem-delete
    when: mcp.before
    match:
      - field: server
        pattern: "filesystem"
      - field: operation
        pattern:
          - "delete"
          - "remove"
          - "unlink"
    action: deny
    feedback: "File deletion through MCP is not allowed."
`;

const GIT_SAFETY_YAML = `# Git Safety Policy
# Prevents dangerous git operations by agents.

name: git-safety
description: Prevents dangerous git operations by agents

rules:
  - name: block-force-push
    when: tool.before
    match:
      - field: toolName
        pattern:
          - "Bash"
          - "bash"
          - "terminal"
          - "shell"
      - field: input.command
        pattern:
          - "*push --force*"
          - "*push -f*"
    action: deny
    feedback: "Force push (git push --force) is not allowed. Use regular push or push with lease."

  - name: block-hard-reset
    when: tool.before
    match:
      - field: toolName
        pattern:
          - "Bash"
          - "bash"
          - "terminal"
          - "shell"
      - field: input.command
        pattern: "*reset --hard*"
    action: deny
    feedback: "git reset --hard is not allowed. This discards uncommitted changes permanently."

  - name: block-main-push
    when: tool.before
    match:
      - field: toolName
        pattern:
          - "Bash"
          - "bash"
          - "terminal"
          - "shell"
      - field: input.command
        pattern:
          - "*push*main*"
          - "*push*master*"
    action: deny
    feedback: "Direct push to main/master is not allowed. Use feature branches and pull requests."
`;

const HANDLER_MJS = `#!/usr/bin/env node
/**
 * Agent Runtime — Self-Contained Hook Handler
 *
 * ZERO external dependencies. All logic is embedded.
 * Reads stdin JSON → evaluates policies → writes traces → outputs decisions.
 *
 * Usage (in agent settings):
 *   PreToolUse:  node .harness/hooks/handler.mjs pre-tool-use
 *   PostToolUse: node .harness/hooks/handler.mjs post-tool-use
 *   Stop:        node .harness/hooks/handler.mjs stop
 *
 * Environment variables:
 *   HANNAH_DEBUG=true    Enable debug logging
 *   HANNAH_LOG_FILE=...  Write logs to file
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Logger ─────────────────────────────────────────────────────────

const DEBUG = process.env.HANNAH_DEBUG === "true";
const LOG_FILE = process.env.HANNAH_LOG_FILE;

function log(...args) {
  const timestamp = new Date().toISOString();
  const message = \`[\${timestamp}] [hannah] \${args.join(" ")}\`;
  console.error(message);
  if (LOG_FILE) {
    try {
      const logDir = path.dirname(LOG_FILE);
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(LOG_FILE, message + "\\n");
    } catch {}
  }
}

function debug(...args) {
  if (DEBUG) log("[DEBUG]", ...args);
}

// ─── Paths ──────────────────────────────────────────────────────────

function findProjectRoot() {
  // .harness/hooks/handler.mjs → project root is 2 levels up
  return path.resolve(__dirname, "..", "..");
}

const PROJECT_ROOT = findProjectRoot();
const HARNESS_DIR = path.join(PROJECT_ROOT, ".harness");
const POLICIES_DIR = path.join(HARNESS_DIR, "policies");
const TRACE_DIR = path.join(HARNESS_DIR, "traces");

// ─── Simple YAML Parser ─────────────────────────────────────────────
// Handles the subset of YAML used in policy files.
// No external dependencies needed.

function parseSimpleYAML(text) {
  const lines = text.split("\\n");
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.search(/\\S/);
    const trimmed = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      // Find the key this array belongs to
      let target = parent;
      if (Array.isArray(parent)) {
        // We're inside an array, check if this is a nested object
        if (value.includes(":")) {
          const obj = {};
          const [k, ...rest] = value.split(":");
          const v = rest.join(":").trim();
          obj[k.trim()] = parseValue(v);
          parent.push(obj);
          stack.push({ indent, obj: obj });
        } else {
          parent.push(parseValue(value));
        }
      } else {
        // Find the last key that was set and convert to array
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        if (lastKey && !Array.isArray(parent[lastKey])) {
          // Check if the previous line was the key definition
          const prevLine = lines[i - 1]?.trim() || "";
          if (prevLine === lastKey + ":" || prevLine.startsWith(lastKey + ":")) {
            parent[lastKey] = [];
          }
        }
        if (Array.isArray(parent[lastKey])) {
          if (value.includes(":")) {
            const obj = {};
            const [k, ...rest] = value.split(":");
            const v = rest.join(":").trim();
            obj[k.trim()] = parseValue(v);
            parent[lastKey].push(obj);
            stack.push({ indent, obj: obj });
          } else {
            parent[lastKey].push(parseValue(value));
          }
        }
      }
      continue;
    }

    // Key: value
    if (trimmed.includes(":")) {
      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      if (rawValue === "") {
        // Could be an object or array — look ahead
        const nextLine = lines[i + 1]?.trim() || "";
        if (nextLine.startsWith("- ")) {
          parent[key] = [];
        } else {
          parent[key] = {};
        }
        stack.push({ indent, obj: parent[key] });
      } else {
        parent[key] = parseValue(rawValue);
      }
    }
  }

  return root;
}

function parseValue(str) {
  if (!str) return "";
  // Remove quotes
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  if (str === "true") return true;
  if (str === "false") return false;
  if (str === "null") return null;
  if (/^-?\\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\\d+\\.\\d+$/.test(str)) return parseFloat(str);
  // Inline array [a, b, c]
  if (str.startsWith("[") && str.endsWith("]")) {
    return str.slice(1, -1).split(",").map(s => parseValue(s.trim()));
  }
  return str;
}

// ─── Policy Engine ──────────────────────────────────────────────────

function globMatch(pattern, value) {
  if (typeof value !== "string") return false;
  // Convert glob pattern to regex
  let regexStr = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches zero or more path segments
        if (pattern[i + 2] === "/") {
          regexStr += "(.*/)?"; // **/ matches optional path prefix
          i += 2;
        } else {
          regexStr += ".*"; // ** at end matches everything
          i++;
        }
      } else {
        regexStr += "[^/]*"; // * matches everything except /
      }
    } else if (c === "?") {
      regexStr += ".";
    } else if (c === "." || c === "+" || c === "^" || c === "$" || 
               c === "{" || c === "}" || c === "(" || c === ")" || 
               c === "|" || c === "[" || c === "]") {
      regexStr += String.fromCharCode(92) + c; // backslash + char
    } else {
      regexStr += c;
    }
  }
  return new RegExp("^" + regexStr + "$", "i").test(value);
}

function getFieldValue(obj, field) {
  const parts = field.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function matchesPattern(value, pattern) {
  if (value === undefined || value === null) return false;
  const strValue = String(value);
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some(p => globMatch(p, strValue));
}

function evaluateRule(rule, eventName, eventPayload) {
  // Check event match
  const events = Array.isArray(rule.when) ? rule.when : [rule.when];
  const eventMatches = events.some(e => {
    if (e === "*") return true;
    if (e === eventName) return true;
    if (e.endsWith(".*")) {
      return eventName.startsWith(e.slice(0, -2) + ".");
    }
    return globMatch(e, eventName);
  });

  if (!eventMatches) return null;

  // Check conditions
  if (rule.match && Array.isArray(rule.match)) {
    const allMatch = rule.match.every(condition => {
      const value = getFieldValue(eventPayload, condition.field) ??
                    getFieldValue({ name: eventName }, condition.field);
      const matched = matchesPattern(value, condition.pattern);
      return condition.negate ? !matched : matched;
    });
    if (!allMatch) return null;
  }

  return rule;
}

function evaluatePolicies(policies, eventName, eventPayload) {
  for (const policy of policies) {
    if (policy.enabled === false) continue;
    if (!policy.rules || !Array.isArray(policy.rules)) continue;

    for (const rule of policy.rules) {
      const matched = evaluateRule(rule, eventName, eventPayload);
      if (matched) {
        return {
          action: matched.action,
          reason: matched.reason || matched.feedback || \`Blocked by policy: \${policy.name}\`,
          feedback: matched.feedback || matched.reason || "",
          policy: policy.name,
          rule: matched.name || "unnamed",
        };
      }
    }
  }
  return { action: "allow" };
}

// ─── Load Policies ──────────────────────────────────────────────────

function loadPolicies() {
  const policies = [];
  if (!fs.existsSync(POLICIES_DIR)) {
    debug("No policies directory:", POLICIES_DIR);
    return policies;
  }

  const files = fs.readdirSync(POLICIES_DIR).filter(
    f => f.endsWith(".yaml") || f.endsWith(".yml")
  );

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(POLICIES_DIR, file), "utf-8");
      const policy = parseSimpleYAML(content);
      if (policy.name) {
        policies.push(policy);
        debug("Loaded policy:", policy.name, "with", (policy.rules || []).length, "rules");
      }
    } catch (err) {
      debug("Failed to load policy", file + ":", err.message);
    }
  }

  return policies;
}

// ─── Tool Classifier ────────────────────────────────────────────────

const FILE_MODIFY_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", "write_file", "edit_file", "create_file",
  "SearchReplace", "write", "edit",
]);

function isFileModifyTool(toolName) {
  return FILE_MODIFY_TOOLS.has(toolName);
}

function isMCPTool(toolName) {
  return toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
}

function extractFilePath(toolInput) {
  return toolInput?.file_path || toolInput?.path || toolInput?.filePath;
}

function parseMCPToolName(toolName) {
  let parts = toolName.split("__");
  if (parts.length >= 3) return { server: parts[1], operation: parts.slice(2).join("__") };
  parts = toolName.split("_");
  if (parts.length >= 3 && parts[0] === "mcp") return { server: parts[1], operation: parts.slice(2).join("_") };
  return null;
}

// ─── Event Builder ──────────────────────────────────────────────────

function buildEvents(input, phase) {
  const events = [];
  const toolName = input.tool_name || "unknown";
  const toolInput = input.tool_input || {};
  const now = new Date().toISOString();

  if (phase === "before") {
    // Always emit tool.before
    events.push({
      name: "tool.before",
      payload: { toolName, input: toolInput },
    });

    // File modification
    if (isFileModifyTool(toolName)) {
      const filePath = extractFilePath(toolInput);
      if (filePath) {
        events.push({
          name: "code.before_modify",
          payload: { filePath, operation: "write" },
        });
      }
    }

    // MCP
    if (isMCPTool(toolName)) {
      const mcpInfo = parseMCPToolName(toolName);
      if (mcpInfo) {
        events.push({
          name: "mcp.before",
          payload: { server: mcpInfo.server, operation: mcpInfo.operation, params: toolInput },
        });
      }
    }
  } else {
    // after
    events.push({
      name: "tool.after",
      payload: { toolName, input: toolInput, output: input.tool_output },
    });

    if (isFileModifyTool(toolName)) {
      const filePath = extractFilePath(toolInput);
      if (filePath) {
        events.push({
          name: "code.after_modify",
          payload: { filePath, operation: "write", success: true },
        });
      }
    }

    if (isMCPTool(toolName)) {
      const mcpInfo = parseMCPToolName(toolName);
      if (mcpInfo) {
        events.push({
          name: "mcp.after",
          payload: { server: mcpInfo.server, operation: mcpInfo.operation, result: input.tool_output },
        });
      }
    }
  }

  return events;
}

// ─── Trace Writer ───────────────────────────────────────────────────

function writeTrace(eventName, payload, action, feedback) {
  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const traceFile = path.join(TRACE_DIR, date + ".jsonl");
    const entry = {
      timestamp: new Date().toISOString(),
      event: eventName,
      source: "hannah",
      action: action,
      payload: payload,
      feedback: feedback ? [feedback] : [],
    };
    fs.appendFileSync(traceFile, JSON.stringify(entry) + "\\n");
    debug("Trace written:", eventName, action);
  } catch (err) {
    debug("Failed to write trace:", err.message);
  }
}

// ─── stdin Reader ───────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      if (chunks.length === 0) {
        reject(new Error("stdin timeout"));
      } else {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch (e) { reject(e); }
      }
    }, 1000);

    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch (e) { reject(e); }
    });
    process.stdin.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.error("Usage: handler.mjs <pre-tool-use|post-tool-use|stop>");
    process.exit(1);
  }

  log("Hook triggered:", mode);

  // Load policies
  const policies = loadPolicies();
  log("Loaded", policies.length, "policies");

  // Read stdin
  let input;
  try {
    input = await readStdin();
    debug("Input:", JSON.stringify(input, null, 2));
  } catch (err) {
    debug("No stdin:", err.message);
    process.exit(0);
  }

  const toolName = input.tool_name || "unknown";
  const phase = mode === "pre-tool-use" ? "before" : "after";
  const events = buildEvents(input, phase);

  // Evaluate all events through policies
  let finalDecision = "allow";
  let finalReason = "";
  let finalFeedback = "";

  for (const event of events) {
    const result = evaluatePolicies(policies, event.name, event.payload);

    if (result.action === "deny") {
      finalDecision = "deny";
      finalReason = result.reason || result.feedback;
      finalFeedback = result.feedback || result.reason;
      log("DENY:", event.name, "-", finalReason);
      writeTrace(event.name, event.payload, "deny", finalFeedback);
      break; // Most restrictive wins, stop evaluating
    } else if (result.action === "warn" && finalDecision !== "deny") {
      finalDecision = "warn";
      finalReason = result.reason || result.feedback;
      finalFeedback = result.feedback || result.reason;
      log("WARN:", event.name, "-", finalReason);
    }

    // Write trace for allowed events too
    if (phase === "before") {
      writeTrace(event.name, event.payload, "allow", "");
    }
  }

  // Output decision
  if (mode === "pre-tool-use" || mode === "stop") {
    const output = { decision: finalDecision };
    if (finalReason) output.reason = finalReason;
    if (finalFeedback) output.stopReason = finalFeedback;

    process.stdout.write(JSON.stringify(output));
    process.exit(finalDecision === "deny" ? 2 : 0);
  } else {
    // post-tool-use: observation only
    writeTrace("tool.after", { toolName }, "allow", "");
    process.exit(0);
  }
}

main().catch((err) => {
  log("Error:", err.message);
  if (DEBUG) log("Stack:", err.stack);
  // On error, allow by default (don't block the agent)
  process.exit(0);
});
`;

const README_MD = `# Agent Runtime Harness

This directory contains the project-level agent runtime configuration.

## Structure

\`\`\`
.harness/
├── config.yaml          # Project configuration
├── policies/            # Declarative policy files (YAML)
│   ├── protected-files.yaml
│   ├── mcp-safety.yaml
│   └── git-safety.yaml
├── hooks/
│   └── handler.mjs      # Unified hook entry point
└── traces/              # Runtime trace data (JSONL)
\`\`\`

## Setup

### 1. Configure your agent

#### Claude Code

Add to \`~/.claude/settings.json\` or \`.claude/settings.json\`:

\`\`\`json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs pre-tool-use"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs post-tool-use"
          }
        ]
      }
    ]
  }
}
\`\`\`

#### GitHub Copilot

Add to \`.github/copilot-instructions.md\` or configure in your Copilot settings:

\`\`\`json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ],
    "PostToolUse": [
      {
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }
    ]
  }
}
\`\`\`

#### Qoder

Similar to Claude Code, add hooks to \`.qoder/settings.json\`.

#### Codex CLI

Add to \`.codex/hooks.json\`:

\`\`\`json
{
  "PreToolUse": [
    { "command": "node .harness/hooks/handler.mjs pre-tool-use" }
  ],
  "PostToolUse": [
    { "command": "node .harness/hooks/handler.mjs post-tool-use" }
  ]
}
\`\`\`

#### Trae

Add to \`.trae/settings.json\`:

\`\`\`json
{
  "hooks": {
    "PreToolUse": [
      { "command": "node .harness/hooks/handler.mjs pre-tool-use" }
    ],
    "PostToolUse": [
      { "command": "node .harness/hooks/handler.mjs post-tool-use" }
    ]
  }
}
\`\`\`

## Viewing Traces

\`\`\`bash
# View recent trace entries
hannah trace

# Follow traces in real-time
hannah trace --follow

# View summary statistics
hannah summary
\`\`\`

## Customizing Policies

Edit the YAML files in \`policies/\` to customize agent behavior.
See the [adaptation table](../doc/guidelines/hook-adaptation-table.md) for the full event taxonomy.

### Example: Block a specific file

\`\`\`yaml
name: my-custom-rules
rules:
  - name: block-readme
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/README.md"
    action: deny
    feedback: "README is managed separately."
\`\`\`
`;

// ─── Agent Configuration ────────────────────────────────────────────

interface AgentConfig {
  name: string;
  value: string;
  description: string;
  configPath: string;
  hookConfig: string;
  generateConfig: (projectRoot: string) => void;
}

const AGENTS: AgentConfig[] = [
  {
    name: "Claude Code",
    value: "claude-code",
    description: "Anthropic Claude Code CLI",
    configPath: ".claude/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }]
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".claude");
      const configPath = path.join(configDir, "settings.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        hooks: {
          PreToolUse: [{
            matcher: "",
            hooks: [{
              type: "command",
              command: "node .harness/hooks/handler.mjs pre-tool-use"
            }]
          }],
          PostToolUse: [{
            matcher: "",
            hooks: [{
              type: "command",
              command: "node .harness/hooks/handler.mjs post-tool-use"
            }]
          }]
        }
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "GitHub Copilot",
    value: "copilot",
    description: "GitHub Copilot coding agent",
    configPath: ".github/hooks/hooks.json",
    hookConfig: `{
  "version": 1,
  "hooks": {
    "preToolUse": [{
      "type": "command",
      "bash": "node .harness/hooks/handler.mjs pre-tool-use",
      "powershell": "node .harness/hooks/handler.mjs pre-tool-use"
    }],
    "postToolUse": [{
      "type": "command",
      "bash": "node .harness/hooks/handler.mjs post-tool-use",
      "powershell": "node .harness/hooks/handler.mjs post-tool-use"
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".github", "hooks");
      const configPath = path.join(configDir, "hooks.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{
            type: "command",
            bash: "node .harness/hooks/handler.mjs pre-tool-use",
            powershell: "node .harness/hooks/handler.mjs pre-tool-use"
          }],
          postToolUse: [{
            type: "command",
            bash: "node .harness/hooks/handler.mjs post-tool-use",
            powershell: "node .harness/hooks/handler.mjs post-tool-use"
          }]
        }
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Qoder",
    value: "qoder",
    description: "Qoder AI coding assistant",
    configPath: ".qoder/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }]
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".qoder");
      const configPath = path.join(configDir, "settings.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        hooks: {
          PreToolUse: [{
            matcher: "",
            hooks: [{
              type: "command",
              command: "node .harness/hooks/handler.mjs pre-tool-use"
            }]
          }],
          PostToolUse: [{
            matcher: "",
            hooks: [{
              type: "command",
              command: "node .harness/hooks/handler.mjs post-tool-use"
            }]
          }]
        }
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Codex CLI",
    value: "codex",
    description: "OpenAI Codex CLI",
    configPath: ".codex/hooks.json",
    hookConfig: `{
  "PreToolUse": [{
    "command": "node .harness/hooks/handler.mjs pre-tool-use"
  }],
  "PostToolUse": [{
    "command": "node .harness/hooks/handler.mjs post-tool-use"
  }]
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".codex");
      const configPath = path.join(configDir, "hooks.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        PreToolUse: [{
          command: "node .harness/hooks/handler.mjs pre-tool-use"
        }],
        PostToolUse: [{
          command: "node .harness/hooks/handler.mjs post-tool-use"
        }]
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Trae",
    value: "trae",
    description: "Trae AI coding assistant",
    configPath: ".trae/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{
      "command": "node .harness/hooks/handler.mjs pre-tool-use"
    }],
    "PostToolUse": [{
      "command": "node .harness/hooks/handler.mjs post-tool-use"
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".trae");
      const configPath = path.join(configDir, "settings.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        hooks: {
          PreToolUse: [{
            command: "node .harness/hooks/handler.mjs pre-tool-use"
          }],
          PostToolUse: [{
            command: "node .harness/hooks/handler.mjs post-tool-use"
          }]
        }
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Cursor",
    value: "cursor",
    description: "Cursor AI code editor",
    configPath: ".cursor/hooks.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{
      "command": "node .harness/hooks/handler.mjs pre-tool-use"
    }],
    "PostToolUse": [{
      "command": "node .harness/hooks/handler.mjs post-tool-use"
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".cursor");
      const configPath = path.join(configDir, "hooks.json");
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        hooks: {
          PreToolUse: [{
            command: "node .harness/hooks/handler.mjs pre-tool-use"
          }],
          PostToolUse: [{
            command: "node .harness/hooks/handler.mjs post-tool-use"
          }]
        }
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
];

// ─── Init Command Implementation ────────────────────────────────────

export async function runInit(args: string[]): Promise<void> {
  // Parse arguments: separate directory from options
  const dirArgs = args.filter(arg => !arg.startsWith("--"));
  const optionArgs = args.filter(arg => arg.startsWith("--"));
  
  const targetDir = dirArgs[0] || process.cwd();
  const harnessDir = path.join(targetDir, ".harness");

  // Check if .harness already exists
  if (fs.existsSync(harnessDir)) {
    console.log(".harness/ already exists. Overwriting...");
  }

  // Get project name from package.json or directory
  let projectName = path.basename(targetDir);
  const pkgPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      projectName = pkg.name || projectName;
    } catch {
      // ignore
    }
  }

  // Interactive agent selection
  console.log("\n? Select your AI coding agent:");
  
  let selectedAgent: AgentConfig;
  
  // Check if --agent flag is provided
  const agentFlag = optionArgs.find(arg => arg.startsWith("--agent="));
  if (agentFlag) {
    const agentValue = agentFlag.split("=")[1];
    const found = AGENTS.find(a => a.value === agentValue || a.name.toLowerCase() === agentValue.toLowerCase());
    if (found) {
      selectedAgent = found;
      console.log(`✓ Selected: ${selectedAgent.name}`);
    } else {
      console.error(`✗ Unknown agent: ${agentValue}`);
      console.error("Available agents:", AGENTS.map(a => a.value).join(", "));
      process.exit(1);
    }
  } else {
    // Interactive mode with arrow keys
    let currentIndex = 0;
    
    // Check if stdin supports raw mode (TTY)
    const isTTY = process.stdin.isTTY;
    
    if (!isTTY) {
      // Fallback to simple number input for non-TTY environments
      console.log("\n  Enter number (1-5): ");
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question("  > ", (ans) => {
          rl.close();
          resolve(ans.trim());
        });
      });
      
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < AGENTS.length) {
        selectedAgent = AGENTS[index];
        console.log(`\n✓ Selected: ${selectedAgent.name}`);
      } else {
        console.error("\n✗ Invalid selection");
        process.exit(1);
      }
    } else {
      // Full interactive mode with arrow keys
      // Render options
      const renderOptions = () => {
        // Clear previous render
        process.stdout.write(`\x1b[${AGENTS.length}A\x1b[0J`);
        
        AGENTS.forEach((agent, index) => {
          const isSelected = index === currentIndex;
          const prefix = isSelected ? "❯" : " ";
          const highlight = isSelected ? "\x1b[36m" : "";
          const reset = isSelected ? "\x1b[0m" : "";
          console.log(`  ${prefix} ${highlight}${agent.name}${reset} - ${agent.description}`);
        });
      };
      
      // Initial render
      AGENTS.forEach((agent, index) => {
        console.log(`    ${agent.name} - ${agent.description}`);
      });
      renderOptions();
      
      // Setup stdin for raw input
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
    
    // Wait for user input
    selectedAgent = await new Promise<AgentConfig>((resolve) => {
      const onKeyPress = (key: string) => {
        // Ctrl+C
        if (key === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(0);
        }
        
        // Up arrow
        if (key === "\u001b[A" || key === "k") {
          currentIndex = currentIndex > 0 ? currentIndex - 1 : AGENTS.length - 1;
          renderOptions();
        }
        
        // Down arrow
        if (key === "\u001b[B" || key === "j") {
          currentIndex = currentIndex < AGENTS.length - 1 ? currentIndex + 1 : 0;
          renderOptions();
        }
        
        // Enter
        if (key === "\r" || key === "\n") {
          stdin.removeListener("data", onKeyPress);
          stdin.setRawMode(false);
          stdin.pause();
          console.log(`\n✓ Selected: ${AGENTS[currentIndex].name}`);
          resolve(AGENTS[currentIndex]);
        }
      };
      
      stdin.on("data", onKeyPress);
    });
    } // End of TTY mode else block
  }

  // Create directories
  fs.mkdirSync(path.join(harnessDir, "policies"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "traces"), { recursive: true });

  // Write files
  const files: Array<[string, string]> = [
    ["config.yaml", CONFIG_YAML.replace("{project}", projectName).replace("{agent}", selectedAgent.value)],
    ["policies/protected-files.yaml", PROTECTED_FILES_YAML],
    ["policies/mcp-safety.yaml", MCP_SAFETY_YAML],
    ["policies/git-safety.yaml", GIT_SAFETY_YAML],
    ["hooks/handler.mjs", HANDLER_MJS],
    ["README.md", README_MD],
  ];

  for (const [filePath, content] of files) {
    const fullPath = path.join(harnessDir, filePath);
    fs.writeFileSync(fullPath, content.trimStart(), "utf-8");
    console.log(`  ✓ .harness/${filePath}`);
  }

  // Generate agent-specific configuration
  console.log(`\n  ✓ Generating ${selectedAgent.name} configuration...`);
  selectedAgent.generateConfig(targetDir);
  console.log(`  ✓ ${selectedAgent.configPath}`);

  // Initialize semantic hooks
  console.log("\n  ✓ Scanning project for semantic rules...");
  try {
    const { createSemanticEngine } = await import("../semantic/engine.js");
    const engine = await createSemanticEngine(targetDir);
    const hooks = engine.getHooks();
    const techStackHooks = engine.getHooksBySource('tech-stack');
    const agentMdHooks = engine.getHooksBySource('agent-md');
    
    console.log(`  ✓ Generated ${hooks.length} semantic hooks`);
    if (techStackHooks.length > 0) {
      console.log(`    ├─ ${techStackHooks.length} tech stack hooks`);
    }
    if (agentMdHooks.length > 0) {
      console.log(`    └─ ${agentMdHooks.length} agent.md hooks`);
    }
    
    // Create semantic-hooks directory and save metadata
    const semanticDir = path.join(harnessDir, "semantic-hooks");
    if (!fs.existsSync(semanticDir)) {
      fs.mkdirSync(semanticDir, { recursive: true });
    }
    
    const hooksMetadata = hooks.map(h => ({
      name: h.name,
      description: h.description,
      version: h.version,
      source: h.source,
    }));
    
    fs.writeFileSync(
      path.join(semanticDir, "hooks.json"),
      JSON.stringify(hooksMetadata, null, 2)
    );
    console.log(`  ✓ Saved hooks metadata to .harness/semantic-hooks/hooks.json`);
  } catch (err: any) {
    console.log(`  ⚠ Semantic hook initialization skipped: ${err.message}`);
  }

  // VSCode extension setup
  const withVSCode = optionArgs.includes("--with-vscode");
  const vscodeOnly = optionArgs.includes("--vscode-only");
  
  if (withVSCode || vscodeOnly) {
    console.log("\n  ✓ Setting up VSCode extension...");
    await setupVSCodeExtension(targetDir, harnessDir);
  }

  console.log("");
  console.log("Done! Next steps:");
  console.log("");
  console.log(`  1. Agent configuration generated: ${selectedAgent.configPath}`);
  
  if (withVSCode) {
    console.log("  2. Install VSCode extension:      See .vscode/README.md");
    console.log("  3. Sync semantic hooks:           hannah sync");
    console.log("  4. View traces:                   hannah trace (or VSCode sidebar)");
  } else {
    console.log("  2. Sync semantic hooks:           hannah sync");
    console.log("  3. View traces:                   hannah trace");
  }
  
  if (withVSCode) {
    console.log("");
    console.log("  💡 Tip: Open VSCode and press Ctrl+Shift+P → 'View: Show Secondary Sidebar'");
    console.log("     to see the Agent Runtime trace panel.");
  }
  
  console.log("");
}

// ─── VSCode Extension Setup ─────────────────────────────────────────

async function setupVSCodeExtension(targetDir: string, harnessDir: string): Promise<void> {
  const vscodeDir = path.join(targetDir, ".vscode");
  
  // Create .vscode directory if it doesn't exist
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  // Generate VSCode settings
  const settingsPath = path.join(vscodeDir, "settings.json");
  let settings: any = {};
  
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  // Add agent-runtime settings
  settings["agentRuntime.traceDir"] = ".harness/traces";
  settings["agentRuntime.autoRefresh"] = true;
  settings["agentRuntime.maxEntries"] = 100;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`  ✓ Generated .vscode/settings.json`);

  // Generate extension installation guide
  const readmePath = path.join(vscodeDir, "README.md");
  const readme = `# Agent Runtime VSCode Extension

## Installation

### Option 1: From Source (Development)

\`\`\`bash
cd editors/vscode
npm install
npm run compile
code --install-extension agent-runtime-trace-0.1.0.vsix
\`\`\`

### Option 2: Manual Copy

1. Open VSCode
2. Press \`Ctrl+Shift+P\` (or \`Cmd+Shift+P\` on Mac)
3. Type "Extensions: Install from VSIX..."
4. Select the \`.vsix\` file from \`editors/vscode/\`

## Usage

1. Open your project in VSCode
2. Press \`Ctrl+Shift+P\` → "View: Show Secondary Sidebar"
3. Look for the "Agent Runtime" panel
4. The tool call chain will appear automatically

## Features

- 📊 **Real-time Trace**: Automatically refreshes when new traces are written
- 🌳 **Tree View**: Hierarchical display of sessions → tools → events
- 🎨 **Visual Indicators**: 
  - ✅ Green check for allowed actions
  - ❌ Red X for denied actions
  - ⚠️ Yellow warning for warnings
- 🔍 **Filtering**: Click the filter icon to show only denied events
- 📋 **Tooltips**: Hover over any item for detailed information

## Configuration

Settings are in \`.vscode/settings.json\`:

\`\`\`json
{
  "agentRuntime.traceDir": ".harness/traces",
  "agentRuntime.autoRefresh": true,
  "agentRuntime.maxEntries": 100
}
\`\`\`

## Commands

- \`Agent Runtime: Refresh Trace\` - Manually refresh the trace view
- \`Agent Runtime: Clear Trace\` - Clear the current view
- \`Agent Runtime: Show Denied Only\` - Toggle filter for denied events

## Troubleshooting

### Extension not showing?

1. Make sure \`.harness/traces/\` directory exists
2. Check VSCode Output panel: View → Output → "Agent Runtime Trace"
3. Try reloading VSCode window: \`Ctrl+Shift+P\` → "Developer: Reload Window"

### No traces appearing?

1. Run your agent with hooks enabled
2. Check that traces are being written to \`.harness/traces/*.jsonl\`
3. Verify \`agentRuntime.traceDir\` setting points to the correct directory
`;

  fs.writeFileSync(readmePath, readme);
  console.log(`  ✓ Generated .vscode/README.md`);

  // Check if VSCode is installed
  const vscodeInstalled = checkVSCodeInstalled();
  
  if (vscodeInstalled) {
    console.log(`  ✓ VSCode detected`);
    console.log("");
    console.log("  📦 To install the extension:");
    console.log("     1. Build: cd editors/vscode && npm install && npm run compile");
    console.log("     2. Package: npx vsce package");
    console.log("     3. Install: code --install-extension agent-runtime-trace-0.1.0.vsix");
  } else {
    console.log(`  ⚠ VSCode not detected in PATH`);
    console.log("     You can still install the extension manually. See .vscode/README.md");
  }
}

function checkVSCodeInstalled(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync("code --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
