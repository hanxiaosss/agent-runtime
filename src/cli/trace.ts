/**
 * trace command
 *
 * Reads .harness/traces/*.jsonl and renders a timeline view.
 *
 * Usage:
 *   hannah trace              - show the latest round (one user message cycle)
 *   hannah trace --all        - show all rounds
 *   hannah trace --follow     - tail -f style
 *   hannah trace --json       - output raw JSON
 *   hannah trace --denied     - only show denied events
 *
 * A "round" is one user message cycle — events within the same session
 * separated by more than ROUND_GAP_MS are considered different rounds.
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

/**
 * A "round" represents one user message cycle within a session.
 * Events within the same session separated by more than ROUND_GAP_MS
 * are considered to be in different rounds.
 */
interface Round {
  roundId: string;
  sessionId: string;
  roundNumber: number;
  entries: TraceEntry[];
  startTime: string;
  endTime: string;
  duration: number;
  eventCount: number;
  deniedCount: number;
  warnedCount: number;
  allowedCount: number;
}

/** Gap threshold in ms — events separated by more than this start a new round. */
const ROUND_GAP_MS = 30_000;

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

// ---- Round Detection ------------------------------------------------------

/**
 * Detect rounds from trace entries.
 * Groups by sessionId, then within each session splits by time gaps.
 */
function detectRounds(entries: TraceEntry[], gapMs: number = ROUND_GAP_MS): Round[] {
  // Group by sessionId
  const sessionMap = new Map<string, TraceEntry[]>();
  for (const e of entries) {
    const sid = e.sessionId || "no-session";
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);
  }

  const rounds: Round[] = [];

  for (const [sessionId, sessionEntries] of sessionMap) {
    // Sort by timestamp within session
    sessionEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let currentRoundEntries: TraceEntry[] = [sessionEntries[0]];
    let roundNumber = 1;

    for (let i = 1; i < sessionEntries.length; i++) {
      const prev = sessionEntries[i - 1];
      const curr = sessionEntries[i];
      const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();

      if (gap > gapMs) {
        // Finalize current round
        rounds.push(buildRound(sessionId, roundNumber, currentRoundEntries));
        roundNumber++;
        currentRoundEntries = [curr];
      } else {
        currentRoundEntries.push(curr);
      }
    }

    // Finalize last round
    if (currentRoundEntries.length > 0) {
      rounds.push(buildRound(sessionId, roundNumber, currentRoundEntries));
    }
  }

  // Sort rounds by endTime (most recent last)
  rounds.sort((a, b) => a.endTime.localeCompare(b.endTime));
  return rounds;
}

function buildRound(sessionId: string, roundNumber: number, entries: TraceEntry[]): Round {
  const timestamps = entries.map((e) => e.timestamp).sort();
  const startTime = timestamps[0];
  const endTime = timestamps[timestamps.length - 1];
  const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

  let deniedCount = 0;
  let warnedCount = 0;
  let allowedCount = 0;
  for (const e of entries) {
    const action = getAction(e);
    if (action === "deny") deniedCount++;
    else if (action === "warn") warnedCount++;
    else allowedCount++;
  }

  return {
    roundId: `${sessionId}#round${roundNumber}`,
    sessionId,
    roundNumber,
    entries,
    startTime,
    endTime,
    duration,
    eventCount: entries.length,
    deniedCount,
    warnedCount,
    allowedCount,
  };
}

/** Get the latest round (most recent by endTime). */
function getLatestRound(rounds: Round[]): Round | null {
  if (rounds.length === 0) return null;
  return rounds.reduce((latest, r) =>
    r.endTime > latest.endTime ? r : latest
  , rounds[0]);
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

  // Read all .jsonl files
  const entries = readAllTraces(traceDir);

  // Filter
  let filtered = entries;
  if (deniedOnly) {
    filtered = entries.filter((e) => getAction(e) === "deny");
  }

  // Sort by timestamp
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (filtered.length === 0) {
    console.log("No trace entries found.");
    return;
  }

  // Detect rounds
  const allRounds = detectRounds(filtered);

  // Select which rounds to display
  let displayRounds: Round[];
  if (showAll) {
    displayRounds = allRounds;
  } else {
    // Default: show only the latest round
    const latest = getLatestRound(allRounds);
    displayRounds = latest ? [latest] : [];
  }

  if (displayRounds.length === 0) {
    console.log("No rounds found.");
    return;
  }

  // Collect entries from selected rounds
  const displayEntries = displayRounds.flatMap((r) => r.entries);

  // Output
  if (jsonOutput) {
    if (showAll) {
      console.log(JSON.stringify({ rounds: displayRounds }, null, 2));
    } else {
      console.log(JSON.stringify(displayEntries, null, 2));
    }
    return;
  }

  renderTimelineByRounds(displayRounds, harnessDir, showAll);

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

/** Separator for round headers. */
const ROUND_SEP = "═"; // ═

/**
 * Render timeline grouped by rounds.
 * Each round gets a header showing session, round number, time range, and stats.
 */
function renderTimelineByRounds(rounds: Round[], harnessDir: string, showAll: boolean): void {
  const projectName = extractProjectName(harnessDir);
  const sep = "  " + BORDER.repeat(65);
  const roundSep = "  " + ROUND_SEP.repeat(65);

  console.log("");
  console.log(`  Agent Runtime Trace ${DOT} ${projectName}`);
  if (!showAll) {
    console.log(`  (showing latest round only — use --all to see all rounds)`);
  }
  console.log(sep);

  let totalEvents = 0;
  let totalDenied = 0;
  let totalWarned = 0;
  let totalAllowed = 0;

  for (const round of rounds) {
    // Round header
    const sessionShort = round.sessionId.includes("#")
      ? round.sessionId.split("#").pop()
      : round.sessionId;
    const timeRange = `${toLocalTimeShort(round.startTime)} ${ARROW} ${toLocalTimeShort(round.endTime)}`;
    const stats = `${round.eventCount} events`;
    const denied = round.deniedCount > 0 ? `, ${round.deniedCount} denied` : "";

    console.log("");
    console.log(roundSep);
    console.log(`  Round #${round.roundNumber} ${DOT} ${sessionShort} ${DOT} ${timeRange} (${formatDuration(round.duration)}, ${stats}${denied})`);
    console.log(roundSep);
    console.log("");
    console.log("  Time        Action  Event                    Source         Details");
    console.log(sep);

    for (const entry of round.entries) {
      const time = toLocalTime(entry.timestamp);
      const action = getAction(entry);
      const actionDisplay = action.toUpperCase().padEnd(6);
      const event = entry.event.padEnd(24);
      const source = (entry.source || "hannah").padEnd(13);
      const payload = getPayload(entry);
      const details = buildDetails(payload);

      console.log(`  ${time}  ${actionDisplay}  ${event}  ${source}  ${details}`);

      const feedback = getFeedback(entry);
      if (feedback.length > 0) {
        for (const msg of feedback) {
          console.log(`            ${ARROW} ${msg}`);
        }
      }
    }

    totalEvents += round.eventCount;
    totalDenied += round.deniedCount;
    totalWarned += round.warnedCount;
    totalAllowed += round.allowedCount;
  }

  // Summary
  console.log("");
  console.log(sep);
  console.log(`  Total: ${totalEvents} | Allowed: ${totalAllowed} | Denied: ${totalDenied} | Warned: ${totalWarned}`);
  console.log(`  Rounds: ${rounds.length}`);

  if (rounds.length > 0) {
    const first = rounds[0].startTime;
    const last = rounds[rounds.length - 1].endTime;
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
