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
adapters:
  - claude-code
  # - qoder
  # - codex
  # - copilot
  # - trae

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
 * Agent Runtime — Unified Hook Handler
 *
 * This script is the single entry point for all agent hooks.
 * It reads stdin JSON, processes events through the policy engine,
 * writes traces, and outputs decisions.
 *
 * Usage (in agent settings):
 *   PreToolUse:  node .harness/hooks/handler.mjs pre-tool-use
 *   PostToolUse: node .harness/hooks/handler.mjs post-tool-use
 *   Stop:        node .harness/hooks/handler.mjs stop
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);

// ─── Resolve agent-runtime ──────────────────────────────────────────
// Try local project install first, then global

let runtime;
try {
  runtime = require("agent-runtime");
} catch {
  // Try resolving from the project root
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    try {
      runtime = require(path.join(projectRoot, "node_modules", "agent-runtime"));
    } catch {
      console.error(
        "agent-runtime not found. Install it: npm install -D agent-runtime"
      );
      process.exit(1);
    }
  } else {
    console.error("agent-runtime not found. Install it: npm install -D agent-runtime");
    process.exit(1);
  }
}

function findProjectRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // .harness/hooks/handler.mjs → project root is 3 levels up
  return path.resolve(dir, "..", "..");
}

function fileURLToPath(url) {
  if (typeof url === "string") return url;
  return url.pathname;
}

// ─── Load Config & Policies ─────────────────────────────────────────

const projectRoot = findProjectRoot();
const harnessDir = path.join(projectRoot, ".harness");
const configPath = path.join(harnessDir, "config.yaml");

let config;
try {
  const { loadHarnessConfig, loadPoliciesFromDir } = require(path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "agent-runtime",
    "dist",
    "cli",
    "yaml-loader.js"
  )) || runtime;

  // Try to load config
  if (fs.existsSync(configPath)) {
    const yamlContent = fs.readFileSync(configPath, "utf-8");
    const yaml = require("js-yaml");
    config = yaml.load(yamlContent);
  }
} catch {
  // Use defaults if config loading fails
  config = {
    trace: { enabled: true, dir: ".harness/traces" },
    policies: ["policies"],
  };
}

// ─── Setup Runtime ──────────────────────────────────────────────────

const agentRuntime = new runtime.AgentRuntime({ debug: false });

// Load policies from .harness/policies/
const policiesDir = path.join(harnessDir, "policies");
if (fs.existsSync(policiesDir)) {
  try {
    const { loadPoliciesFromDir } = runtime;
    if (typeof loadPoliciesFromDir === "function") {
      const policies = loadPoliciesFromDir(policiesDir);
      policies.forEach((p) => agentRuntime.loadPolicy(p));
    }
  } catch {
    // Fallback: load built-in policies
    const { allPolicies } = runtime;
    if (allPolicies) {
      allPolicies.forEach((p) => agentRuntime.loadPolicy(p));
    }
  }
}

// Create adapter based on config
const adapterName = config?.adapters?.[0] || "claude-code";
const adapterMap = {
  "claude-code": runtime.ClaudeCodeAdapter,
  "qoder": runtime.QoderAdapter,
  "codex": runtime.CodexAdapter,
  "copilot": runtime.CopilotAdapter,
  "trae": runtime.TraeAdapter,
};

const AdapterClass = adapterMap[adapterName];
if (!AdapterClass) {
  console.error("Unknown adapter: " + adapterName);
  process.exit(1);
}

const adapter = new AdapterClass();
adapter.attachRuntime(agentRuntime);

// ─── Trace Writer ───────────────────────────────────────────────────

const traceEnabled = config?.trace?.enabled !== false;
const traceDir = path.join(projectRoot, config?.trace?.dir || ".harness/traces");

function writeTrace(event, result) {
  if (!traceEnabled) return;
  try {
    fs.mkdirSync(traceDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const traceFile = path.join(traceDir, date + ".jsonl");
    const entry = {
      timestamp: new Date().toISOString(),
      event: event.name,
      source: event.source,
      action: result?.finalAction || "unknown",
      payload: event.payload,
      feedback: result?.feedbackMessages || [],
    };
    fs.appendFileSync(traceFile, JSON.stringify(entry) + "\\n");
  } catch {
    // Silently ignore trace write errors
  }
}

// ─── Hook Processing ────────────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      if (chunks.length === 0) {
        reject(new Error("stdin timeout"));
      } else {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch (e) {
          reject(e);
        }
      }
    }, 1000);

    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.error("Usage: handler.mjs <pre-tool-use|post-tool-use|stop>");
    process.exit(1);
  }

  let input;
  try {
    input = await readStdin();
  } catch {
    // No stdin or parse error — allow by default
    process.exit(0);
  }

  // Process through adapter
  let output;
  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      // Write traces for all events
      // (The adapter internally processes events; we trace the final decision)
      if (traceEnabled) {
        writeTrace(
          {
            name: "tool.before",
            source: adapterName,
            payload: { toolName: input.tool_name, input: input.tool_input },
          },
          { finalAction: output.decision === "deny" ? "deny" : "allow", feedbackMessages: output.reason ? [output.reason] : [] }
        );
      }
      // Output decision
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      if (traceEnabled) {
        writeTrace(
          {
            name: "tool.after",
            source: adapterName,
            payload: { toolName: input.tool_name },
          },
          { finalAction: "allow", feedbackMessages: [] }
        );
      }
      process.exit(0);
      break;

    case "stop":
      output = await adapter.handleStop(input);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    default:
      console.error("Unknown mode: " + mode);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Hook handler error:", err.message);
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

### 1. Install agent-runtime

\`\`\`bash
npm install -D agent-runtime
\`\`\`

### 2. Configure your agent

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

## Viewing Traces

\`\`\`bash
# View recent trace entries
npx agent-runtime trace

# Follow traces in real-time
npx agent-runtime trace --follow

# View summary statistics
npx agent-runtime summary
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

// ─── Init Command Implementation ────────────────────────────────────

export function runInit(args: string[]): void {
  const targetDir = args[0] || process.cwd();
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

  // Create directories
  fs.mkdirSync(path.join(harnessDir, "policies"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "traces"), { recursive: true });

  // Write files
  const files: Array<[string, string]> = [
    ["config.yaml", CONFIG_YAML.replace("{project}", projectName)],
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

  console.log("");
  console.log("Done! Next steps:");
  console.log("");
  console.log("  1. Install agent-runtime:  npm install -D agent-runtime");
  console.log("  2. Configure your agent (see .harness/README.md)");
  console.log("  3. View traces:            npx agent-runtime trace");
  console.log("");
}
