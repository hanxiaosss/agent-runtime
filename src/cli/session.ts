/**
 * session command
 *
 * Manage agent sessions: list, info, archive, cleanup.
 *
 * Usage:
 *   hannah session                    # List active sessions
 *   hannah session --all              # List all sessions (including archived)
 *   hannah session info <id>          # Show session details
 *   hannah session archive <id>       # Archive a session
 *   hannah session cleanup [--days=30] # Remove old sessions
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TraceEntry {
  timestamp: string;
  event: string;
  source: string;
  action: string;
  toolName?: string;
  payload: Record<string, unknown>;
  feedback?: string[];
  sessionId?: string;
  duration?: number;
  modifiedFiles?: string[];
  exitCode?: number;
}

interface SessionInfo {
  sessionId: string;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  denyCount: number;
  warnCount: number;
  sources: Set<string>;
  tools: Set<string>;
  archived: boolean;
}

export function runSession(args: string[]): void {
  const subCommand = (args[0] && !args[0].startsWith("--")) ? args[0] : "list";
  const flags = (args[0] && !args[0].startsWith("--")) ? args.slice(1) : args;

  switch (subCommand) {
    case "list":
      listSessions(flags);
      break;
    case "info":
      showSessionInfo(flags);
      break;
    case "archive":
      archiveSession(flags);
      break;
    case "cleanup":
      cleanupSessions(flags);
      break;
    default:
      console.error("Unknown session command: " + subCommand);
      console.error("Usage: hannah session [list|info|archive|cleanup]");
      process.exit(1);
  }
}

function listSessions(args: string[]): void {
  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found.");
    process.exit(1);
  }

  const showAll = args.includes("--all");
  const entries = loadAllTraces(tracesDir);
  const sessions = aggregateSessions(entries);

  const now = Date.now();
  const activeThreshold = 30 * 60 * 1000;

  let filtered = sessions;
  if (!showAll) {
    filtered = sessions.filter((s) => {
      const lastSeen = new Date(s.lastSeen).getTime();
      return now - lastSeen < activeThreshold;
    });
  }

  if (filtered.length === 0) {
    console.log(showAll ? "No sessions found." : "No active sessions. Use --all to show all.");
    return;
  }

  filtered.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

  console.log("");
  console.log("=== Agent Sessions ===");
  console.log("");

  const header = "Session ID".padEnd(20) + "Events".padStart(8) + "Denied".padStart(8) + "Sources".padStart(12) + "Last Active".padStart(20) + "Status".padStart(10);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const s of filtered) {
    const lastActive = formatRelativeTime(s.lastSeen);
    const isActive = now - new Date(s.lastSeen).getTime() < activeThreshold;
    const status = s.archived ? "Archived" : isActive ? "Active" : "Idle";
    const id = s.sessionId.length > 18 ? s.sessionId.slice(0, 15) + "..." : s.sessionId;
    const sources = Array.from(s.sources).join(",");

    console.log(
      id.padEnd(20) +
      String(s.eventCount).padStart(8) +
      String(s.denyCount).padStart(8) +
      sources.padStart(12) +
      lastActive.padStart(20) +
      status.padStart(10),
    );
  }

  console.log("");
  console.log("Total: " + filtered.length + " session(s)");
  console.log("");
}

function showSessionInfo(args: string[]): void {
  const sessionId = args.find((a) => !a.startsWith("--"));
  if (!sessionId) {
    console.error("Usage: hannah session info <session-id>");
    process.exit(1);
  }

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found.");
    process.exit(1);
  }

  const entries = loadAllTraces(tracesDir);
  const sessionEntries = entries.filter((e) => e.sessionId === sessionId);

  if (sessionEntries.length === 0) {
    console.error("No traces found for session: " + sessionId);
    process.exit(1);
  }

  const session = aggregateSessionFromEntries(sessionId, sessionEntries);

  console.log("");
  console.log("=== Session Details ===");
  console.log("");
  console.log("Session ID:  " + session.sessionId);
  console.log("First Seen:  " + session.firstSeen);
  console.log("Last Seen:   " + session.lastSeen);
  console.log("Duration:    " + formatDuration(session.firstSeen, session.lastSeen));
  console.log("Total Events: " + session.eventCount);
  console.log("Denied:      " + session.denyCount);
  console.log("Warned:      " + session.warnCount);
  console.log("Sources:     " + Array.from(session.sources).join(", "));
  console.log("Tools:       " + Array.from(session.tools).join(", "));
  console.log("");

  console.log("--- Event Timeline ---");
  console.log("");
  const recent = sessionEntries.slice(-20);
  for (const e of recent) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const action = (e.action || "unknown").toUpperCase().padEnd(6);
    const tool = e.toolName || e.event || "?";
    console.log("  " + time + "  " + action + "  " + tool);
  }
  console.log("");
}

function archiveSession(args: string[]): void {
  const sessionId = args.find((a) => !a.startsWith("--"));
  if (!sessionId) {
    console.error("Usage: hannah session archive <session-id>");
    process.exit(1);
  }

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found.");
    process.exit(1);
  }

  const archiveDir = path.join(tracesDir, "..", "archive");
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const entries = loadAllTraces(tracesDir);
  const sessionEntries = entries.filter((e) => e.sessionId === sessionId);

  if (sessionEntries.length === 0) {
    console.error("No traces found for session: " + sessionId);
    process.exit(1);
  }

  const archiveFile = path.join(archiveDir, "session-" + sessionId.slice(0, 8) + ".jsonl");
  const content = sessionEntries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(archiveFile, content, "utf8");

  console.log("Archived " + sessionEntries.length + " entries to " + archiveFile);
}

function cleanupSessions(args: string[]): void {
  const daysStr = getArgValue(args, "--days") || "30";
  const days = parseInt(daysStr);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found.");
    process.exit(1);
  }

  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));
  let cleaned = 0;

  for (const file of files) {
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})\.jsonl/);
    if (dateMatch) {
      const fileDate = new Date(dateMatch[1]).getTime();
      if (fileDate < cutoff) {
        const filePath = path.join(tracesDir, file);
        fs.unlinkSync(filePath);
        cleaned++;
        console.log("Removed: " + file);
      }
    }
  }

  if (cleaned === 0) {
    console.log("No trace files older than " + days + " days found.");
  } else {
    console.log("Cleaned up " + cleaned + " trace file(s).");
  }
}

// --- Helpers ---

function findTracesDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".harness", "traces");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getArgValue(args: string[], flag: string): string | null {
  const idx = args.findIndex((a) => a.startsWith(flag));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.includes("=")) return arg.split("=")[1];
  if (idx + 1 < args.length) return args[idx + 1];
  return null;
}

function loadAllTraces(tracesDir: string): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const filePath = path.join(tracesDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as TraceEntry);
      } catch {
        // Skip invalid lines
      }
    }
  }

  return entries;
}

function aggregateSessions(entries: TraceEntry[]): SessionInfo[] {
  const map = new Map<string, TraceEntry[]>();
  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(e);
  }

  const sessions: SessionInfo[] = [];
  for (const [sessionId, sessionEntries] of map) {
    sessions.push(aggregateSessionFromEntries(sessionId, sessionEntries));
  }
  return sessions;
}

function aggregateSessionFromEntries(sessionId: string, entries: TraceEntry[]): SessionInfo {
  const timestamps = entries.map((e) => e.timestamp).sort();
  const sources = new Set<string>();
  const tools = new Set<string>();
  let denyCount = 0;
  let warnCount = 0;

  for (const e of entries) {
    if (e.source) sources.add(e.source);
    if (e.toolName) tools.add(e.toolName);
    if (e.action === "deny") denyCount++;
    if (e.action === "warn") warnCount++;
  }

  return {
    sessionId,
    firstSeen: timestamps[0] || "N/A",
    lastSeen: timestamps[timestamps.length - 1] || "N/A",
    eventCount: entries.length,
    denyCount,
    warnCount,
    sources,
    tools,
    archived: false,
  };
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  return days + "d ago";
}

function formatDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return hours + "h " + remainMin + "m";
}
