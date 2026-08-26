#!/usr/bin/env node
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

// ─── Resolve hannah-agent-runtime ──────────────────────────────────────────
// Try local project install first, then global

let runtime;
try {
  runtime = require("hannah-agent-runtime");
} catch {
  // Try resolving from the project root
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    try {
      runtime = require(path.join(projectRoot, "node_modules", "hannah-agent-runtime"));
    } catch {
      console.error(
        "hannah-agent-runtime not found. Install it: npm install -D hannah-agent-runtime"
      );
      process.exit(1);
    }
  } else {
    console.error("hannah-agent-runtime not found. Install it: npm install -D hannah-agent-runtime");
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
    "hannah-agent-runtime",
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
    fs.appendFileSync(traceFile, JSON.stringify(entry) + "\n");
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
