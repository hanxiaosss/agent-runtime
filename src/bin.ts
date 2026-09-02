#!/usr/bin/env node
/**
 * agent-runtime CLI
 *
 * Commands:
 *   init       — Generate .harness/ directory in the current project
 *   sync       — Synchronize semantic hooks with project rules
 *   watch      — Start file system watcher for redline protection
 *   trace      — View agent runtime traces
 *   summary    — Show aggregate statistics
 *
 * Usage:
 *   hannah init
 *   hannah sync
 *   hannah watch
 *   hannah trace
 *   hannah trace --follow
 *   hannah summary
 *   hannah summary --today
 */

import { runInit } from "./cli/init/index.js";
import { runSync } from "./cli/sync.js";
import { runTrace } from "./cli/trace.js";
import { runSummary } from "./cli/summary.js";
import { runAnalyze } from "./cli/analyze.js";
import { runExport } from "./cli/export.js";
import { runSession } from "./cli/session.js";
import { runPolicy } from "./cli/policy.js";
import { runLearn } from "./cli/learn.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
  hannah — Cross-agent runtime event & policy layer

  Usage:
    hannah <command> [options]

  Commands:
    init [dir] [options]    Generate .harness/ directory (default: cwd)
      --agent=<name>          Select agent: claude-code, copilot, qoder, codex, trae, cursor
    sync [dir]              Synchronize semantic hooks with project rules
    watch                   Start file system watcher for redline protection
    trace [options]         View agent runtime traces
      --all                   Show all entries (default: last 50)
      --follow                Follow traces in real-time
      --json                  Output raw JSON
      --denied                Only show denied events
    summary [options]       Show aggregate statistics
    analyze [options]       Analyze traces for rule optimization
      --today                 Summary of today only
      --days N                Summary of last N days
    export [options]        Export trace data
      --format=<fmt>          Output format: json, csv, jsonl (default: json)
      --output=<file>         Output file path
      --days=N                Export last N days (default: 7)
      --session=<id>          Export specific session
    session [subcommand]    Manage agent sessions
      list [--all]            List active/all sessions
      info <id>               Show session details
      archive <id>            Archive a session
      cleanup [--days=N]      Remove old trace files (default: 30 days)
    policy [subcommand]     Manage policies
      list                    List all policies
      validate                Validate all policy files
      show <name>             Show policy details
      check <file>            Check a specific policy file
    monitor [options]       Start real-time monitoring server
      --port=N                Server port (default: 4848)
      --open                  Open browser after start
    web [options]           Start WebUI Dashboard
      --port=N                Server port (default: 4849)
      --open                  Open browser after start
    learn [subcommand]      Self-learning intelligence
      full                  Full analysis (patterns + anomalies + recommendations)
      patterns              Behavior pattern analysis
      anomalies             Anomaly detection
      recommend             Policy recommendations
      escalation [stats|reset]  Escalation management
      --days=N              Analysis period (default: 7)
    help                    Show this help message

  Examples:
    hannah init
    hannah init --agent=copilot
    hannah init ./my-project --agent=claude-code
    hannah sync
    hannah watch
    hannah trace --follow
    hannah summary --today
`);
}

switch (command) {
  case "init":
    runInit(args.slice(1)).catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
    break;

  case "sync":
    runSync(args.slice(1)).catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
    break;

  case "watch":
    // Import watcher dynamically
    import("./cli/watcher.js").catch((err) => {
      console.error("Error starting watcher:", err.message);
      process.exit(1);
    });
    break;

  case "trace":
    runTrace(args.slice(1));
    break;

  case "summary":
    runSummary(args.slice(1));
    break;

  case "analyze":
    runAnalyze(args.slice(1));
    break;

  case "export":
    runExport(args.slice(1));
    break;

  case "session":
    runSession(args.slice(1));
    break;

  case "policy":
    runPolicy(args.slice(1));
    break;

  case "monitor":
    import("./server/websocket.js").then((mod) => {
      mod.runMonitor(args.slice(1));
    }).catch((err: Error) => {
      console.error("Error starting monitor:", err.message);
      process.exit(1);
    });
    break;

  case "web":
    import("./server/dashboard.js").then((mod) => {
      mod.runWeb(args.slice(1));
    }).catch((err: Error) => {
      console.error("Error starting web UI:", err.message);
      process.exit(1);
    });
    break;

  case "learn":
    runLearn(args.slice(1));
    break;

  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;

  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Run 'hannah help' for usage.");
    process.exit(1);
}
