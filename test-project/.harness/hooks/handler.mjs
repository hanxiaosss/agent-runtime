#!/usr/bin/env node
/**
 * Agent Runtime — Unified Hook Handler (ESM)
 *
 * This script is the single entry point for all agent hooks.
 * It reads stdin JSON, processes events through the policy engine,
 * writes traces, and outputs decisions.
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
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Logger ─────────────────────────────────────────────────────────

const DEBUG = process.env.HANNAH_DEBUG === "true";
const LOG_FILE = process.env.HANNAH_LOG_FILE;

function log(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [hannah] ${args.join(" ")}`;
  
  // Always log to stderr (doesn't interfere with stdout JSON)
  console.error(message);
  
  // Optionally log to file
  if (LOG_FILE) {
    try {
      const logDir = path.dirname(LOG_FILE);
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(LOG_FILE, message + "\n");
    } catch {}
  }
}

function debug(...args) {
  if (DEBUG) {
    log("[DEBUG]", ...args);
  }
}

// ─── Resolve hannah-agent-runtime ──────────────────────────────────────────
// Try local project install first, then global

function findProjectRoot() {
  // .harness/hooks/handler.mjs → project root is 2 levels up
  return path.resolve(__dirname, "..", "..");
}

async function loadRuntime() {
  const projectRoot = findProjectRoot();
  debug("Project root:", projectRoot);
  
  // Try local project install first
  try {
    const localPath = path.join(projectRoot, "node_modules", "hannah-agent-runtime", "dist", "index.js");
    if (fs.existsSync(localPath)) {
      debug("Loading from local install:", localPath);
      return await import(pathToFileURL(localPath).href);
    }
  } catch (err) {
    debug("Failed to load local:", err.message);
  }
  
  // Try global install
  try {
    debug("Loading from global install");
    return await import("hannah-agent-runtime");
  } catch (err) {
    debug("Failed to load global:", err.message);
  }
  
  console.error("hannah-agent-runtime not found. Install it: npm install -D hannah-agent-runtime");
  process.exit(1);
}

// ─── Load Config & Policies ─────────────────────────────────────────

async function loadConfig() {
  const projectRoot = findProjectRoot();
  const harnessDir = path.join(projectRoot, ".harness");
  const configPath = path.join(harnessDir, "config.yaml");
  
  let config = {
    trace: { enabled: true, dir: ".harness/traces" },
    policies: ["policies"],
  };
  
  try {
    // Try to load js-yaml for config parsing
    let yaml;
    try {
      yaml = await import("js-yaml");
    } catch {
      // js-yaml not available, use default config
      return config;
    }
    
    if (fs.existsSync(configPath)) {
      debug("Loading config from:", configPath);
      const yamlContent = fs.readFileSync(configPath, "utf-8");
      config = yaml.load(yamlContent);
    }
  } catch (err) {
    debug("Failed to load config:", err.message);
  }
  
  return config;
}

// ─── Main Setup ─────────────────────────────────────────────────────

async function setup() {
  log("Initializing hannah-agent-runtime...");
  
  const runtime = await loadRuntime();
  const config = await loadConfig();
  
  const projectRoot = findProjectRoot();
  const harnessDir = path.join(projectRoot, ".harness");
  
  // Setup Runtime
  const agentRuntime = new runtime.AgentRuntime({ debug: DEBUG });
  
  // Load policies from .harness/policies/
  const policiesDir = path.join(harnessDir, "policies");
  if (fs.existsSync(policiesDir)) {
    try {
      if (typeof runtime.loadPoliciesFromDir === "function") {
        const policies = runtime.loadPoliciesFromDir(policiesDir);
        policies.forEach((p) => agentRuntime.loadPolicy(p));
        debug("Loaded", policies.length, "policies from", policiesDir);
      }
    } catch (err) {
      debug("Failed to load policies from dir:", err.message);
      // Fallback: load built-in policies
      if (runtime.allPolicies) {
        runtime.allPolicies.forEach((p) => agentRuntime.loadPolicy(p));
        debug("Loaded built-in policies");
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
  debug("Using adapter:", adapterName);
  
  // Trace Writer
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
      debug("Trace written to:", traceFile);
    } catch (err) {
      debug("Failed to write trace:", err.message);
    }
  }
  
  log("Setup complete. Adapter:", adapterName);
  return { runtime, adapter, adapterName, writeTrace, traceEnabled };
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
  
  log("Hook triggered:", mode);
  
  // Setup runtime and adapter
  const { adapter, adapterName, writeTrace, traceEnabled } = await setup();
  
  let input;
  try {
    input = await readStdin();
    debug("Received input:", JSON.stringify(input, null, 2));
  } catch (err) {
    debug("Failed to read stdin:", err.message);
    // No stdin or parse error — allow by default
    log("No input received, allowing by default");
    process.exit(0);
  }
  
  // Process through adapter
  let output;
  switch (mode) {
    case "pre-tool-use":
      log("Processing pre-tool-use for tool:", input.tool_name);
      output = await adapter.handlePreToolUse(input);
      log("Decision:", output.decision, output.reason ? "- " + output.reason : "");
      
      // Write traces for all events
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
      log("Processing post-tool-use for tool:", input.tool_name);
      await adapter.handlePostToolUse(input);
      log("Post-tool-use completed");
      
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
      log("Processing stop hook");
      output = await adapter.handleStop(input);
      log("Stop decision:", output.decision);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;
      
    default:
      console.error("Unknown mode: " + mode);
      process.exit(1);
  }
}

main().catch((err) => {
  log("Error:", err.message);
  if (DEBUG) {
    log("Stack:", err.stack);
  }
  // On error, allow by default (don't block the agent)
  process.exit(0);
});
