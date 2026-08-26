#!/usr/bin/env node
/**
 * agent-runtime CLI
 *
 * Commands:
 *   init       — Generate .harness/ directory in the current project
 *   trace      — View agent runtime traces
 *   summary    — Show aggregate statistics
 *
 * Usage:
 *   npx agent-runtime init
 *   npx agent-runtime trace
 *   npx agent-runtime trace --follow
 *   npx agent-runtime summary
 *   npx agent-runtime summary --today
 */

import { runInit } from "./cli/init.js";
import { runTrace } from "./cli/trace.js";
import { runSummary } from "./cli/summary.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
  agent-runtime — Cross-agent runtime event & policy layer

  Usage:
    agent-runtime <command> [options]

  Commands:
    init [dir]              Generate .harness/ directory (default: cwd)
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
    npx agent-runtime init
    npx agent-runtime trace --follow
    npx agent-runtime summary --today
`);
}

switch (command) {
  case "init":
    runInit(args.slice(1));
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
    console.error("Run 'agent-runtime help' for usage.");
    process.exit(1);
}
