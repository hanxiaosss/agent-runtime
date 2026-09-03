/**
 * trace command
 *
 * Reads .harness/traces/*.jsonl and renders a timeline view.
 *
 * Usage:
 *   hannah trace              - show last 50 entries
 *   hannah trace --all        - show all entries
 *   hannah trace --follow     - tail -f style
 *   hannah trace --json       - output raw JSON
 *   hannah trace --denied     - only show denied events
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Unified trace entry — handles both formats:
 *  1. handler.mjs format: { action, payload, feedback, source }
 *  2. codex-handler.ts format: { decision, toolName, reason, input, output }
 */
interface TraceEntry {
  timestamp: string;
  event: string;
  source?: string;
  // handler.mjs fields
  action?: string;
  payload?: Record<string, unknown>;
  feedback?: string[];
  // codex-handler.ts fields
  decision?: string;
  toolName?: string;
  reason?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  ruleName?: string;
  sessionId?: string;
  duration?: number;
  modifiedFiles?: string[];
  exitCode?: number;
}

/** Normalize action value from either format, case-insensitive. */
function getAction(entry: TraceEntry): string {
  return ((entry.action ?? entry.decision ?? "allow") as string).toLowerCase();
}

/** Get the effective tool name from either format. */
function getToolName(entry: TraceEntry): string {
  return (
    (entry.payload?.toolName as string | undefined) ??
    entry.toolName ??
    "unknown"
  );
}

/** Get the payload object from either format. */
function getPayload(entry: TraceEntry): Record<string, unknown> {
  if (entry.payload) return entry.payload;
  // codex-handler format: wrap legacy fields into a pseudo-payload
  const p: Record<string, unknown> = {};
  if (entry.toolName) p.toolName = entry.toolName;
  if (entry.input) p.input = entry.input;
  if (entry.output !== undefined) p.output = entry.output;
  if (entry.ruleName) p.ruleName = entry.ruleName;
  if (entry.duration !== undefined) p.duration = entry.duration;
  if (entry.modifiedFiles) p.modifiedFiles = entry.modifiedFiles;
  return p;
}

/** Get feedback messages from either format. */
function getFeedback(entry: TraceEntry): string[] {
  if (entry.feedback && entry.feedback.length > 0) return entry.feedback;
  if (entry.reason) return [entry.reason];
  return [];
}

export function runTrace(args: string[]): void {
  const harnessDir = findHarnessDir();
  if (!harnessDir) {
    console.error("No .harness/ directory found. Run 'hannah init' first.");
    process.exit(1);
  }

  const traceDir = path.join(harnessDir, "traces");
  if (!fs.existsSync(traceDir)) {
    console.log("No traces yet. Traces will appear after agents run with hooks enabled.");
    return;
  }

  // Parse flags
  const flags = new Set(args);
  const showAll = flags.has("--all");
  const follow = flags.has("--follow");
  const jsonOutput = flags.has("--json");
  const deniedOnly = flags.has("--denied");
  const limit = showAll ? Infinity : 50;

  // Read all .jsonl files
  const entries = readAllTraces(traceDir);

  // Filter
  let filtered = entries;
  if (deniedOnly) {
    filtered = entries.filter((e) => getAction(e) === "deny");
  }

  // Sort by timestamp
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Limit
  if (!showAll && filtered.length > limit) {
    filtered = filtered.slice(-limit);
  }

  if (filtered.length === 0) {
    console.log("No trace entries found.");
    return;
  }

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  renderTimeline(filtered, harnessDir);

  // Follow mode
  if (follow) {
    console.log("\n  (following - press Ctrl+C to stop)\n");
    followTraces(traceDir, entries.length);
  }
}

// ---- Trace Reading --------------------------------------------------------

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

// ---- Timeline Renderer ----------------------------------------------------

/**
 * Convert ISO timestamp to local time string.
 * Input:  "2026-08-28T02:35:06.712Z" (UTC)
 * Output: "10:35:06.712" (local time, e.g. UTC+8)
 */
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Convert ISO timestamp to short local time (no ms).
 */
function toLocalTimeShort(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Border character for table separators. */
const BORDER = "─"; // ─

/** Arrow character for time ranges. */
const ARROW = "→"; // →

/** Dot character for header. */
const DOT = "●"; // ●

function renderTimeline(entries: TraceEntry[], harnessDir: string): void {
  const projectName = extractProjectName(harnessDir);
  const sep = "  " + BORDER.repeat(65);

  console.log("");
  console.log(`  Agent Runtime Trace ${DOT} ${projectName}`);
  console.log(sep);
  console.log("");
  console.log("  Time        Action  Event                    Source         Details");
  console.log(sep);

  for (const entry of entries) {
    const time = toLocalTime(entry.timestamp);
    const action = getAction(entry);
    const actionDisplay = action.toUpperCase().padEnd(6);
    const event = entry.event.padEnd(24);
    const source = (entry.source || "hannah").padEnd(13);
    const payload = getPayload(entry);

    // Build details string from payload
    const details = buildDetails(payload);

    console.log(`  ${time}  ${actionDisplay}  ${event}  ${source}  ${details}`);

    // Show feedback on separate line if present
    const feedback = getFeedback(entry);
    if (feedback.length > 0) {
      for (const msg of feedback) {
        console.log(`            ${ARROW} ${msg}`);
      }
    }
  }

  // Summary
  console.log("");
  console.log(sep);

  const total = entries.length;
  const denied = entries.filter((e) => getAction(e) === "deny").length;
  const warned = entries.filter((e) => getAction(e) === "warn").length;
  const allowed = entries.filter((e) => getAction(e) === "allow").length;

  console.log(`  Total: ${total} | Allowed: ${allowed} | Denied: ${denied} | Warned: ${warned}`);

  // Time range
  if (entries.length > 1) {
    const first = entries[0].timestamp;
    const last = entries[entries.length - 1].timestamp;
    const duration = formatDuration(
      new Date(last).getTime() - new Date(first).getTime(),
    );
    console.log(`  Range: ${toLocalTimeShort(first)} ${ARROW} ${toLocalTimeShort(last)} (${duration})`);
  }

  console.log("");
}

function buildDetails(p: Record<string, unknown>): string {
  const parts: string[] = [];

  if (p.toolName) parts.push(String(p.toolName));
  if (p.filePath) {
    const fp = String(p.filePath);
    const short = fp.length > 30 ? "..." + fp.slice(-27) : fp;
    parts.push(short);
  }
  if (p.server) parts.push(`${p.server}.${p.operation || ""}`);
  if (p.input && typeof p.input === "object") {
    const cmd = (p.input as Record<string, unknown>).command;
    if (cmd) {
      const str = String(cmd);
      const short = str.length > 30 ? str.slice(0, 27) + "..." : str;
      parts.push(short);
    }
  }

  return parts.join(" | ") || "";
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

// ---- Follow Mode ----------------------------------------------------------

function followTraces(traceDir: string, startIndex: number): void {
  const files = fs.readdirSync(traceDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();

  if (files.length === 0) return;

  const latestFile = path.join(traceDir, files[files.length - 1]);
  let pos = fs.statSync(latestFile).size;

  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(latestFile);
      if (stat.size > pos) {
        const fd = fs.openSync(latestFile, "r");
        const buf = Buffer.alloc(stat.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        fs.closeSync(fd);
        pos = stat.size;

        const newLines = buf.toString("utf-8").trim().split("\n");
        for (const line of newLines) {
          if (!line.trim()) continue;
          try {
            const entry: TraceEntry = JSON.parse(line);
            renderEntry(entry);
          } catch {
            // skip
          }
        }
      }
    } catch {
      // File might not exist yet
    }
  }, 500);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });
}

function renderEntry(entry: TraceEntry): void {
  const time = toLocalTime(entry.timestamp);
  const action = getAction(entry).toUpperCase().padEnd(6);
  const event = entry.event.padEnd(24);
  const source = (entry.source || "hannah").padEnd(13);
  const payload = getPayload(entry);
  const details = buildDetails(payload);

  console.log(`  ${time}  ${action}  ${event}  ${source}  ${details}`);
  const feedback = getFeedback(entry);
  if (feedback.length > 0) {
    for (const msg of feedback) {
      console.log(`            ${ARROW} ${msg}`);
    }
  }
}

// ---- Helpers --------------------------------------------------------------

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
