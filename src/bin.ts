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

import { runInit } from "./cli/init.js";
import { runSync } from "./cli/sync.js";
import { runTrace } from "./cli/trace.js";
import { runSummary } from "./cli/summary.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
  hannah — Cross-agent runtime event & policy layer

  Usage:
    hannah <command> [options]

  Commands:
    init [dir] [options]    Generate .harness/ directory (default: cwd)
      --agent=<name>          Select agent: claude-code, copilot, qoder, codex, trae
    sync [dir]              Synchronize semantic hooks with project rules
    watch                   Start file system watcher for redline protection
    trace [options]         View agent runtime traces
      --all                   Show all entries (default: last 50)
      --follow                Follow traces in real-time
      --json                  Output raw JSON
      --denied                Only show denied events
    summary [options]       Show aggregate statistics
      --today                 Summary of today only
      --days N                Summary of last N days
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
