/**
 * Template constants for .harness/ directory generation.
 */

export const CONFIG_YAML = `# Agent Runtime Harness Configuration
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

export const PROTECTED_FILES_YAML = `# Protected Files Policy
# Prevents agents from modifying sensitive files.

name: protected-files
description: Prevent modification of sensitive configuration and lock files

rules:
    id: SEC-001

    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/.env"
          - "**/.env.*"
          - "**/*.env"
    action: deny
    feedback: "Cannot modify environment files (.env). These contain secrets and must be edited manually."
    suggestions:
      - "Ask the human user to edit .env files"
      - "Use environment variables instead"

    id: SEC-002

    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/package-lock.json"
          - "**/pnpm-lock.yaml"
          - "**/yarn.lock"
    action: deny
    feedback: "Cannot modify lock files directly. Run the package manager instead."
    suggestions:
      - "Use npm install, pnpm add, yarn add, etc."

    id: ARCH-001

    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "src/core/**"
          - "src/kernel/**"
    action: deny
    feedback: "Core module files require human review. Changes to core modules need explicit approval."
    suggestions:
      - "Ask for human review before modifying core files"

    id: ARCH-002

    when: code.before_modify
    match:
      - field: filePath
        pattern:
          - "**/tsconfig.json"
          - "**/package.json"
    action: warn
    feedback: "You are modifying a project configuration file. Ensure this is intentional."
    suggestions:
      - "Verify the changes are necessary"
      - "Document the reason for changes"
`;

export const MCP_SAFETY_YAML = `# MCP Safety Policy
# Controls agent access to MCP servers and operations.

name: mcp-safety
description: Controls agent access to MCP servers and operations

rules:
    id: MCP-001

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
    suggestions:
      - "Use the application API instead of direct database access"

    id: MCP-002

    when: mcp.before
    match:
      - field: server
        pattern: "database"
    action: warn
    feedback: "Database access detected. Ensure queries are read-only."
    suggestions:
      - "Ensure queries are read-only"
      - "Don't expose sensitive data"

    id: MCP-003

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
    suggestions:
      - "Use the application API for file operations"
`;

export const GIT_SAFETY_YAML = `# Git Safety Policy
# Prevents dangerous git operations by agents.

name: git-safety
description: Prevents dangerous git operations by agents

rules:
    id: GIT-001

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
    action: modify
    feedback: "Force push is not allowed. Use regular push or push with lease."
    modifiedInput:
      command: "git push --force-with-lease"
    suggestions:
      - "Use git push --force-with-lease instead"

    id: GIT-002

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
    suggestions:
      - "Use git stash instead"
      - "Use git checkout to discard specific files"

    id: GIT-003

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
    suggestions:
      - "Create a feature branch"
      - "Use pull requests for code review"
`;

export const SEMANTIC_RULES_YAML = `# Semantic Rules — Multi-dimensional hook matching
#
# Unlike declarative policies (which match on event payload fields),
# semantic rules match on *operational dimensions*:
#
#   tool_name     — tool name (Write, Bash, mcp__server__op, …)
#   file_path     — file path glob
#   content       — content pattern (written code, inline, …)
#   command       — shell command (from Bash tool input.command)
#   mcp_server    — MCP server name
#   mcp_operation — MCP operation name
#   file_type     — file extension (ts, py, go, sql, …)
#
# Matching logic:
#   • All specified dimensions must match (AND across dimensions)
#   • Within a dimension, any pattern can match (OR within dimension)
#   • At least one dimension must be specified per rule

rules:
  # Example: block eval() in TypeScript source files
  # - name: no-eval-in-src
  #   description: eval() is a security risk in source files
  #   match:
  #     file_path: ["src/**"]
  #     file_type: [ts, js, tsx, jsx]
  #     content: ["eval(", "new Function("]
  #   action: deny
  #   feedback: "eval() is not allowed in source files. Use safer alternatives."
  #   suggestions:
  #     - "Use JSON.parse() for JSON data"
  #     - "Use structured data instead of dynamic code"

  # Example: warn when modifying configuration files
  # - name: warn-config-change
  #   description: Configuration changes may affect the build
  #   match:
  #     file_path: ["**/tsconfig.json", "**/package.json", "**/.eslintrc*"]
  #   action: warn
  #   feedback: "You are modifying a project configuration file. Ensure this is intentional."
`;

export const HANDLER_MJS = `#!/usr/bin/env node
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
const SEMANTIC_RULES_DIR = path.join(HARNESS_DIR, "semantic-rules");
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
          suggestions: matched.suggestions || [],
          modifiedInput: matched.modifiedInput || null,
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
    // Use local time for date filename (not UTC)
    const now = new Date();
    const date = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
    const traceFile = path.join(TRACE_DIR, date + ".jsonl");
    const entry = {
      timestamp: now.toISOString(),
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

// ─── Semantic Rule Engine (built-in) ────────────────────────────────
// Zero-dependency semantic rule matching across all dimensions.

const BUILT_IN_RULES = [
  // ── Redline: agent instruction files ──
  { name: "redline-agent-files", action: "deny",
    feedback: "You cannot modify agent instruction files. These define your behavior and must only be changed by the human user.",
    suggestions: ["Continue without modifying instruction files"],
    match: { file_path: ["**/agent.md", "**/AGENT.md", "**/.agent.md", "**/agents.md", "**/AGENTS.md", "**/CLAUDE.md", "**/COPILOT.md", "**/.cursorrules", "**/.cursor/rules.md"] } },
  // ── Redline: harness config ──
  { name: "redline-harness-config", action: "deny",
    feedback: "You cannot modify .harness/ configuration. This directory contains runtime guard policies and hooks.",
    suggestions: ["Continue without modifying .harness/ files"],
    match: { file_path: ["**/.harness/**"] } },
  // ── Environment files ──
  { name: "env-protection", action: "deny",
    feedback: "Environment files are protected. They may contain secrets and must be edited manually.",
    suggestions: ["Ask the human user to edit .env files"],
    match: { file_path: ["**/.env", "**/.env.*", "**/*.env"] } },
  // ── Lock files ──
  { name: "lock-file-protection", action: "deny",
    feedback: "Lock files are auto-generated. Use the package manager instead of editing directly.",
    suggestions: ["Use npm install, pnpm add, yarn add, etc."],
    match: { file_path: ["**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock", "**/poetry.lock", "**/Gemfile.lock", "**/Cargo.lock", "**/go.sum"] } },
  // ── Production config ──
  { name: "production-config", action: "deny",
    feedback: "Production configuration must be changed through the deployment pipeline, not directly.",
    suggestions: ["Modify staging/dev configuration first", "Use CI/CD pipeline for production deployment"],
    match: { file_path: ["**/production.yaml", "**/production.yml", "**/production.json", "**/production.env", "**/prod.yaml", "**/prod.yml", "**/prod.json", "**/prod.env", "**/production/**", "**/prod/**"] } },
  // ── Dangerous shell ──
  { name: "dangerous-rm", action: "modify",
    feedback: "Destructive rm commands are blocked.",
    modifiedInput: { command: "echo 'Blocked: dangerous rm command'" },
    suggestions: ["Use specific file paths instead of wildcards", "Use rm -i for interactive deletion"],
    match: { command: ["rm -rf /", "rm -rf ~", "rm -rf .", "rm -rf *"] } },
  { name: "dangerous-git-force", action: "modify",
    feedback: "Force push is not allowed. Use regular push or push with lease.",
    modifiedInput: { command: "git push --force-with-lease" },
    suggestions: ["Use git push --force-with-lease instead"],
    match: { command: ["git push --force", "git push -f"] } },
  // ── Dangerous DB ──
  { name: "dangerous-db-drop", action: "modify",
    feedback: "Destructive database operations (DROP/TRUNCATE) are blocked.",
    modifiedInput: { content: "-- Blocked: Use ALTER TABLE or conditional DELETE instead" },
    suggestions: ["Use ALTER TABLE instead", "Add conditional checks before DELETE"],
    match: { content: ["DROP TABLE", "DROP DATABASE", "TRUNCATE TABLE"] } },
  // ── Secrets ──
  { name: "secret-password", action: "deny",
    feedback: "Hardcoded passwords detected. Use environment variables or a secrets manager.",
    suggestions: ["Use process.env.PASSWORD", "Use a secrets manager (Vault, AWS Secrets Manager)"],
    match: { content: ["password = \\"", "password = '", "passwd = \\"", "passwd = '", "pwd = \\"", "pwd = '"] } },
  { name: "secret-api-key", action: "deny",
    feedback: "Hardcoded API keys detected. Use environment variables or a secrets manager.",
    suggestions: ["Use process.env.API_KEY", "Use a secrets manager"],
    match: { content: ["api_key = \\"", "api_key = '", "apiKey = \\"", "apiKey = '", "API_KEY = \\"", "API_KEY = '"] } },
  { name: "secret-private-key", action: "deny",
    feedback: "Private keys must not be embedded in source code.",
    suggestions: ["Use a secrets manager or SSH agent"],
    match: { content: ["-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----"] } },
  // ── MCP safety ──
  { name: "mcp-db-write", action: "deny",
    feedback: "Direct database write via MCP is not allowed. Use the application API layer.",
    suggestions: ["Use the application API instead of direct database access"],
    match: { mcp_server: ["database", "db", "sql", "postgres", "mysql", "mongodb"], mcp_operation: ["write", "delete", "drop", "truncate", "alter", "update", "insert", "execute"] } },
  // ── Frontend security (warn) ──
  { name: "react-xss", action: "warn",
    feedback: "dangerouslySetInnerHTML can lead to XSS. Ensure content is sanitized.",
    suggestions: ["Use DOMPurify to sanitize HTML", "Use textContent instead when possible"],
    match: { file_type: ["tsx", "jsx", "ts", "js"], content: ["dangerouslySetInnerHTML"] } },
  { name: "vue-xss", action: "warn",
    feedback: "v-html can lead to XSS. Use text interpolation when possible.",
    suggestions: ["Use {{ }} interpolation instead of v-html"],
    match: { file_type: ["vue"], content: ["v-html"] } },
  { name: "eval-injection", action: "warn",
    feedback: "eval() can lead to code injection. Consider safer alternatives.",
    suggestions: ["Use JSON.parse() for JSON data", "Use Function constructors carefully", "Avoid eval when possible"],
    match: { file_type: ["ts", "js", "tsx", "jsx", "py", "rb"], content: ["eval(", "new Function("] } },
  // ── Core module protection ──
  { name: "core-module", action: "warn",
    feedback: "You are modifying core module files. These changes require human review.",
    suggestions: ["Ensure changes are reviewed by a human", "Document the changes thoroughly"],
    match: { file_path: ["**/src/core/**", "**/src/kernel/**", "**/src/runtime/**"] } },
];

/**
 * Extract match dimensions from handler input
 */
// ─── Load Semantic Rules from YAML ──────────────────────────────────
// Reads .harness/semantic-rules/*.yaml and converts them into
// the same shape as BUILT_IN_RULES so evaluateSemanticRules()
// can check them all uniformly.

function loadSemanticRulesYAML() {
  const rules = [];
  let dir;
  try {
    dir = fs.readdirSync(SEMANTIC_RULES_DIR);
  } catch {
    return rules;
  }
  const files = dir.filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml")
  );
  for (const file of files) {
    try {
      const content = fs.readFileSync(
        path.join(SEMANTIC_RULES_DIR, file),
        "utf-8"
      );
      const parsed = parseSimpleYAML(content);
      const ruleList = parsed.rules;
      if (!Array.isArray(ruleList)) continue;
      for (const r of ruleList) {
        if (!r || typeof r !== "object") continue;
        const match = {};
        if (r.match && typeof r.match === "object") {
          for (const [dim, val] of Object.entries(r.match)) {
            match[dim] = Array.isArray(val)
              ? val.map(String)
              : [String(val)];
          }
        }
        rules.push({
          name: r.name || "unnamed-semantic-rule",
          feedback: r.feedback || r.description || "",
          action: r.action || "warn",
          suggestions: Array.isArray(r.suggestions)
            ? r.suggestions.map(String)
            : [],
          match,
        });
      }
    } catch (err) {
      debug("Failed to load semantic rule " + file + ":", err.message);
    }
  }
  return rules;
}

function extractDims(input) {
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || toolInput.filePath || "";
  const content = toolInput.content || "";
  const command = toolInput.command || "";
  const fileType = filePath.includes(".") ? filePath.split(".").pop() : "";

  let mcpServer = "", mcpOp = "";
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) { mcpServer = parts[1]; mcpOp = parts.slice(2).join("__"); }
  } else if (toolName.startsWith("mcp_")) {
    const parts = toolName.split("_");
    if (parts.length >= 3) { mcpServer = parts[1]; mcpOp = parts.slice(2).join("_"); }
  }

  return { tool_name: toolName, file_path: filePath, content, command, mcp_server: mcpServer, mcp_operation: mcpOp, file_type: fileType };
}

/**
 * Glob-to-regex (simplified)
 */
function globRe(glob) {
  let r = "";
  const special = [".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]"];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i+1] === "*") { r += (glob[i+2] === "/" ? "(.*/)?" : ".*"); i += (glob[i+2] === "/" ? 2 : 1); }
      else { r += "[^/]*"; }
    } else if (c === "?") { r += "."; }
    else if (special.indexOf(c) >= 0) { r += String.fromCharCode(92) + c; }
    else { r += c; }
  }
  return new RegExp(r, "i");
}

/**
 * Match one dimension
 */
function matchDim(patterns, value) {
  if (!value) return false;
  return patterns.some(p => {
    if (p.includes("*") || p.includes("?")) return globRe(p).test(value);
    const pLower = p.toLowerCase();
    const vLower = value.toLowerCase();
    // Short patterns (< 8 chars, no spaces) use word-boundary matching
    // to avoid overly broad matches (e.g. "commit" matching "committed").
    if (pLower.length < 8 && !/\\s/.test(pLower)) {
      const re = new RegExp("(?:^|[^a-z])" + pLower.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(?:[^a-z]|$)");
      return re.test(vLower);
    }
    return vLower.includes(pLower);
  });
}

/**
 * Evaluate all rules (built-in + YAML) against input dimensions
 */
function evaluateSemanticRules(input) {
  const dims = extractDims(input);
  const priority = { deny: 0, modify: 1, warn: 2 };
  let best = null;
  let bestP = Infinity;

  // Merge built-in rules with user-defined rules from semantic-rules/*.yaml
  const allRules = BUILT_IN_RULES.concat(loadSemanticRulesYAML());
  log("Semantic rules:", allRules.length, "total (" + BUILT_IN_RULES.length + " built-in + " + (allRules.length - BUILT_IN_RULES.length) + " YAML)");

  for (const rule of allRules) {
    const m = rule.match;
    let matched = 0, total = 0;

    if (m.tool_name)    { total++; if (matchDim(m.tool_name, dims.tool_name)) matched++; }
    if (m.file_path)    { total++; if (matchDim(m.file_path, dims.file_path)) matched++; }
    if (m.content)      { total++; if (matchDim(m.content, dims.content)) matched++; }
    if (m.command)      { total++; if (matchDim(m.command, dims.command)) matched++; }
    if (m.mcp_server)   { total++; if (matchDim(m.mcp_server, dims.mcp_server)) matched++; }
    if (m.mcp_operation){ total++; if (matchDim(m.mcp_operation, dims.mcp_operation)) matched++; }
    if (m.file_type)    { total++; if (matchDim(m.file_type, dims.file_type)) matched++; }

    if (total > 0 && matched === total) {
      const p = priority[rule.action] ?? 3;
      if (p < bestP) {
        best = rule;
        bestP = p;
      }
    }
  }

  return best;
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
  log("PID:", process.pid.toString());
  log("CWD:", process.cwd());
  log("Args:", process.argv.join(" "));

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
  let finalSuggestions = [];
  let finalModifiedInput = null;

  for (const event of events) {
    const result = evaluatePolicies(policies, event.name, event.payload);

    if (result.action === "deny") {
      finalDecision = "deny";
      finalReason = result.reason || result.feedback;
      finalFeedback = result.feedback || result.reason;
      if (result.suggestions) finalSuggestions = result.suggestions;
      log("DENY:", event.name, "-", finalReason);
      writeTrace(event.name, event.payload, "deny", finalFeedback);
      break; // Most restrictive wins, stop evaluating
    } else if (result.action === "modify") {
      finalDecision = "allow"; // modify means "allow with modified input"
      finalReason = result.reason || result.feedback;
      finalFeedback = result.feedback || result.reason;
      finalModifiedInput = result.modifiedInput || null;
      if (result.suggestions) finalSuggestions = result.suggestions;
      log("MODIFY:", event.name, "-", finalReason);
      writeTrace(event.name, event.payload, "modify", finalFeedback);
    } else if (result.action === "warn" && finalDecision !== "deny") {
      finalDecision = "warn";
      finalReason = result.reason || result.feedback;
      finalFeedback = result.feedback || result.reason;
      if (result.suggestions) finalSuggestions = result.suggestions;
      log("WARN:", event.name, "-", finalReason);
    }

    // Write trace for allowed events too
    if (phase === "before") {
      writeTrace(event.name, event.payload, "allow", "");
    }
  }

  // ── Semantic rule evaluation (if YAML policies didn't deny) ──
  if (finalDecision !== "deny" && phase === "before") {
    const semRule = evaluateSemanticRules(input);
    if (semRule) {
      log(semRule.action.toUpperCase() + ":", semRule.name, "-", semRule.feedback);
      writeTrace("semantic." + semRule.name, { toolName, rule: semRule.name }, semRule.action, semRule.feedback);

      if (semRule.action === "deny") {
        finalDecision = "deny";
        finalReason = semRule.feedback;
        finalFeedback = semRule.feedback;
        if (semRule.suggestions) finalSuggestions = semRule.suggestions;
      } else if (semRule.action === "modify" && !finalModifiedInput) {
        finalDecision = "allow"; // modify means "allow with modified input"
        finalReason = semRule.feedback;
        finalFeedback = semRule.feedback;
        finalModifiedInput = semRule.modifiedInput || null;
        if (semRule.suggestions) finalSuggestions = semRule.suggestions;
      } else if (semRule.action === "warn" && finalDecision !== "deny") {
        finalDecision = "warn";
        finalReason = semRule.feedback;
        finalFeedback = semRule.feedback;
        if (semRule.suggestions && finalSuggestions.length === 0) {
          finalSuggestions = semRule.suggestions;
        }
      }
    }
  }


  
  // Helper: Match semantic rule against input
  function matchSemanticRule(rule, input) {
    const dims = rule.match;
    const toolName = input.tool_name || "";
    const toolInput = input.tool_input || {};
    
    // Check tool_name
    if (dims.tool_name && dims.tool_name.length > 0) {
      if (!dims.tool_name.some(pattern => matchPattern(toolName, pattern))) {
        return false;
      }
    }
    
    // Check file_path
    if (dims.file_path && dims.file_path.length > 0) {
      const filePath = toolInput.file_path || "";
      if (!dims.file_path.some(pattern => globMatch(pattern, filePath))) {
        return false;
      }
    }
    
    // Check content
    if (dims.content && dims.content.length > 0) {
      const content = toolInput.content || toolInput.command || "";
      if (!dims.content.some(pattern => content.includes(pattern))) {
        return false;
      }
    }
    
    // Check file_type
    if (dims.file_type && dims.file_type.length > 0) {
      const filePath = toolInput.file_path || "";
      const ext = path.extname(filePath).slice(1);
      if (!dims.file_type.includes(ext)) {
        return false;
      }
    }
    
    return true;
  }
  

  // ─── Reflection Prompt (Agent Self-Analysis) ──────────────────────────
  // If semantic rules have reflection_prompt, return引导性问题让 agent 自我反思
  // This is zero-cost, zero-latency, no API key needed
  
  if (finalDecision !== "deny" && phase === "before") {
    const reflectionRules = semanticRules.filter(r => r.reflection_prompt);
    
    for (const rule of reflectionRules) {
      // Check if rule matches
      const matches = matchSemanticRule(rule, input);
      if (matches) {
        // Return reflection prompt as feedback
        const reflectionFeedback = \`[REFLECTION_REQUIRED] \${rule.reflection_prompt}\`;
        
        log("REFLECTION:", rule.name, "-", rule.reflection_prompt);
        writeTrace("reflection." + rule.name, { 
          toolName, 
          rule: rule.name,
          reflection_prompt: rule.reflection_prompt 
        }, "warn", reflectionFeedback);
        
        // Add to suggestions
        if (!finalSuggestions) finalSuggestions = [];
        finalSuggestions.push(reflectionFeedback);
        
        // Set decision to warn (non-blocking)
        if (finalDecision === "allow") {
          finalDecision = "warn";
          finalFeedback = reflectionFeedback;
        }
      }
    }
  }

  // Output decision
  if (mode === "pre-tool-use" || mode === "stop") {
    const output = { decision: finalDecision };
    if (finalReason) output.reason = finalReason;
    if (finalFeedback) output.stopReason = finalFeedback;

    // Add updatedInput for modify actions (Claude Code / Qoder / Cursor support this)
    if (finalModifiedInput) {
      output.updatedInput = finalModifiedInput;
      // Merge modified input with original input
      if (input.tool_input) {
        output.updatedInput = { ...input.tool_input, ...finalModifiedInput };
      }
    }

    // Add suggestions for the agent
    if (finalSuggestions.length > 0) {
      output.suggestions = finalSuggestions;
    }

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

export const README_MD = `# Agent Runtime Harness

This directory contains the project-level agent runtime configuration.

## Structure

\`\`\`
.harness/
├── config.yaml          # Project configuration
├── policies/            # Declarative policy files (YAML)
│   ├── protected-files.yaml
│   ├── mcp-safety.yaml
│   └── git-safety.yaml
├── semantic-rules/      # Multi-dimensional semantic rules (YAML)
│   └── custom.yaml
├── hooks/
│   └── handler.mjs      # Unified hook entry point
├── semantic-hooks/      # Auto-generated hook metadata
│   └── hooks.json
└── traces/              # Runtime trace data (JSONL)
\`\`\`

## Two Hook Systems

### 1. Declarative Policies (policies/)

Match on event fields via dot-notation paths:

\`\`\`yaml
name: my-policy
rules:
  - name: block-readme
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/README.md"
    action: deny
    feedback: "README is managed separately."
\`\`\`

### 2. Semantic Rules (semantic-rules/)

Match on multiple operational dimensions simultaneously:

\`\`\`yaml
rules:
  - name: no-eval-in-src
    description: Block eval() in source files
    match:
      file_path: ["src/**"]
      file_type: [ts, js]
      content: ["eval(", "new Function("]
    action: deny
    feedback: "eval() is not allowed in source files."
\`\`\`

Dimensions: \`tool_name\`, \`file_path\`, \`content\`, \`command\`,
\`mcp_server\`, \`mcp_operation\`, \`file_type\`.
All specified dimensions must match (AND); within a dimension any
pattern can match (OR).

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

Add to \`.codex/config.toml\`:

\`\`\`toml
[[hooks.PreToolUse]]
matcher = "*"
command = "node dist/hooks/codex-handler.js pre-tool-use"

[[hooks.PostToolUse]]
matcher = "*"
command = "node dist/hooks/codex-handler.js post-tool-use"

[[hooks.Stop]]
matcher = ""
command = "node dist/hooks/codex-handler.js stop"
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

export const ARCHITECTURE_YAML = `# Architecture Layer Definitions
# Defines project layers and enforces dependency rules between them.
# Violations are blocked at pre-tool-use time.

layers:
  - name: controller
    description: "HTTP/RPC handlers, route definitions"
    patterns:
      - "**/controllers/**"
      - "**/handlers/**"
      - "**/routes/**"

  - name: service
    description: "Business logic layer"
    patterns:
      - "**/services/**"
      - "**/use-cases/**"
      - "**/domain/**"

  - name: repository
    description: "Data access layer"
    patterns:
      - "**/repositories/**"
      - "**/dao/**"
      - "**/models/**"

  - name: infrastructure
    description: "External integrations, DB drivers"
    patterns:
      - "**/infrastructure/**"
      - "**/adapters/**"

rules:
  - from: controller
    to: repository
    allowed: false
    feedback: "Controllers must not directly access the repository layer. Use services instead."
    suggestions:
      - "Route the call through a service layer"

  - from: controller
    to: infrastructure
    allowed: false
    feedback: "Controllers must not directly access infrastructure."
    suggestions:
      - "Abstract infrastructure behind a service interface"

  - from: repository
    to: controller
    allowed: false
    feedback: "Repository layer must not depend on controllers."
    suggestions:
      - "Use interfaces or events to decouple"
`;
