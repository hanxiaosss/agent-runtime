/**
 * summary command
 *
 * Generates an aggregate summary of agent runtime traces.
 *
 * Usage:
 *   hannah summary              — summary of all traces
 *   hannah summary --today      — summary of today only
 *   hannah summary --days 7     — summary of last N days
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TraceEntry {
  timestamp: string;
  event: string;
  source: string;
  action: string;
  payload: Record<string, unknown>;
  feedback: string[];
}

export function runSummary(args: string[]): void {
  const harnessDir = findHarnessDir();
  if (!harnessDir) {
    console.error("No .harness/ directory found. Run 'hannah init' first.");
    process.exit(1);
  }

  const traceDir = path.join(harnessDir, "traces");
  if (!fs.existsSync(traceDir)) {
    console.log("No traces yet.");
    return;
  }

  // Parse flags
  const flags = new Set(args);
  const todayOnly = flags.has("--today");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : Infinity;

  // Read traces
  const entries = readAllTraces(traceDir);
  if (entries.length === 0) {
    console.log("No trace entries found.");
    return;
  }

  // Filter by time range
  let filtered = entries;
  const now = new Date();

  if (todayOnly) {
    const todayStr = now.toISOString().slice(0, 10);
    filtered = entries.filter((e) => e.timestamp.startsWith(todayStr));
  } else if (days < Infinity) {
    const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
    filtered = entries.filter((e) => e.timestamp >= cutoff);
  }

  if (filtered.length === 0) {
    console.log("No traces in the selected time range.");
    return;
  }

  // Compute statistics
  const projectName = extractProjectName(harnessDir);
  const stats = computeStats(filtered);

  // Render
  console.log("");
  console.log(`  Agent Runtime Summary — ${projectName}`);
  console.log("  " + "═".repeat(55));
  console.log("");

  // Overview
  console.log("  Overview");
  console.log("  " + "─".repeat(55));
  console.log(`  Total events:     ${stats.total}`);
  console.log(`  Allowed:          ${stats.allowed}  (${pct(stats.allowed, stats.total)})`);
  console.log(`  Denied:           ${stats.denied}  (${pct(stats.denied, stats.total)})`);
  console.log(`  Warned:           ${stats.warned}  (${pct(stats.warned, stats.total)})`);

  if (stats.firstTimestamp && stats.lastTimestamp) {
    const duration = formatDuration(
      new Date(stats.lastTimestamp).getTime() - new Date(stats.firstTimestamp).getTime(),
    );
    console.log(`  Time range:       ${stats.firstTimestamp.slice(0, 19)} → ${stats.lastTimestamp.slice(0, 19)}`);
    console.log(`  Duration:         ${duration}`);
  }

  // Events breakdown
  console.log("");
  console.log("  Events by Type");
  console.log("  " + "─".repeat(55));

  const eventEntries = Object.entries(stats.byEvent).sort((a, b) => b[1] - a[1]);
  for (const [event, count] of eventEntries) {
    const bar = "█".repeat(Math.min(Math.ceil(count / stats.total * 30), 30));
    console.log(`  ${event.padEnd(24)} ${String(count).padStart(4)}  ${bar}`);
  }

  // Tools breakdown
  if (Object.keys(stats.byTool).length > 0) {
    console.log("");
    console.log("  Tools Used");
    console.log("  " + "─".repeat(55));

    const toolEntries = Object.entries(stats.byTool).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of toolEntries) {
      console.log(`  ${tool.padEnd(24)} ${String(count).padStart(4)}`);
    }
  }

  // Files modified
  if (Object.keys(stats.byFile).length > 0) {
    console.log("");
    console.log("  Files Modified");
    console.log("  " + "─".repeat(55));

    const fileEntries = Object.entries(stats.byFile).sort((a, b) => b[1] - a[1]);
    for (const [file, count] of fileEntries.slice(0, 15)) {
      const short = file.length > 35 ? "..." + file.slice(-32) : file;
      console.log(`  ${short.padEnd(37)} ${String(count).padStart(4)}`);
    }
    if (fileEntries.length > 15) {
      console.log(`  ... and ${fileEntries.length - 15} more`);
    }
  }

  // Denied events detail
  if (stats.deniedDetails.length > 0) {
    console.log("");
    console.log("  Denied Events (recent)");
    console.log("  " + "─".repeat(55));

    for (const detail of stats.deniedDetails.slice(-5)) {
      const time = detail.timestamp.slice(11, 19);
      const tool = (detail.payload.toolName as string) || detail.event;
      console.log(`  ${time}  ${tool}`);
      if (detail.feedback.length > 0) {
        console.log(`           └─ ${detail.feedback[0]}`);
      }
    }
  }

  // Sources
  if (Object.keys(stats.bySource).length > 0) {
    console.log("");
    console.log("  Sources");
    console.log("  " + "─".repeat(55));

    const sourceEntries = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sourceEntries) {
      console.log(`  ${source.padEnd(24)} ${String(count).padStart(4)}`);
    }
  }

  console.log("");
}

// ─── Statistics ─────────────────────────────────────────────────────

interface Stats {
  total: number;
  allowed: number;
  denied: number;
  warned: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  byEvent: Record<string, number>;
  byTool: Record<string, number>;
  byFile: Record<string, number>;
  bySource: Record<string, number>;
  deniedDetails: TraceEntry[];
}

function computeStats(entries: TraceEntry[]): Stats {
  const stats: Stats = {
    total: entries.length,
    allowed: 0,
    denied: 0,
    warned: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    byEvent: {},
    byTool: {},
    byFile: {},
    bySource: {},
    deniedDetails: [],
  };

  for (const entry of entries) {
    // Action counts
    if (entry.action === "allow") stats.allowed++;
    else if (entry.action === "deny") stats.denied++;
    else if (entry.action === "warn") stats.warned++;

    // Timestamps
    if (!stats.firstTimestamp || entry.timestamp < stats.firstTimestamp) {
      stats.firstTimestamp = entry.timestamp;
    }
    if (!stats.lastTimestamp || entry.timestamp > stats.lastTimestamp) {
      stats.lastTimestamp = entry.timestamp;
    }

    // Event breakdown
    stats.byEvent[entry.event] = (stats.byEvent[entry.event] || 0) + 1;

    // Tool breakdown
    const toolName = entry.payload?.toolName as string;
    if (toolName) {
      stats.byTool[toolName] = (stats.byTool[toolName] || 0) + 1;
    }

    // File breakdown
    const filePath = entry.payload?.filePath as string;
    if (filePath) {
      stats.byFile[filePath] = (stats.byFile[filePath] || 0) + 1;
    }

    // Source breakdown
    if (entry.source) {
      stats.bySource[entry.source] = (stats.bySource[entry.source] || 0) + 1;
    }

    // Denied details
    if (entry.action === "deny") {
      stats.deniedDetails.push(entry);
    }
  }

  return stats;
}

// ─── Helpers ────────────────────────────────────────────────────────

function readAllTraces(traceDir: string): TraceEntry[] {
  const files = fs.readdirSync(traceDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();

  const entries: TraceEntry[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(traceDir, file), "utf-8");
    for (const line of content.trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  }

  return entries;
}

function findHarnessDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".harness");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function extractProjectName(harnessDir: string): string {
  const configPath = path.join(harnessDir, "config.yaml");
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const match = content.match(/^project:\s*(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      // ignore
    }
  }
  return path.basename(path.dirname(harnessDir));
}

function pct(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round(count / total * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}
