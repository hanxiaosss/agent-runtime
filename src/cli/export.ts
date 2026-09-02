/**
 * export command
 *
 * Export trace data to various formats for external analysis.
 *
 * Usage:
 *   hannah export                   # Export to JSON (default)
 *   hannah export --format=csv       # Export to CSV
 *   hannah export --format=jsonl     # Export to JSONL
 *   hannah export --output=traces.json  # Specify output file
 *   hannah export --days=7           # Export last 7 days
 *   hannah export --session=abc123   # Export specific session
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

export function runExport(args: string[]): void {
  const tracesDir = findTracesDir();
  if (!tracesDir || !fs.existsSync(tracesDir)) {
    console.error("No traces directory found. Run some agent operations first.");
    process.exit(1);
  }

  const format = getArgValue(args, "--format") || "json";
  const outputFile = getArgValue(args, "--output");
  const days = parseInt(getArgValue(args, "--days") || "7");
  const sessionId = getArgValue(args, "--session");

  const entries = loadTraces(tracesDir, days);

  let filtered = entries;
  if (sessionId) {
    filtered = entries.filter((e) => e.sessionId === sessionId);
    if (filtered.length === 0) {
      console.error('No traces found for session: ${sessionId}');
      process.exit(1);
    }
  }

  if (filtered.length === 0) {
    console.log("No trace entries found for the specified period.");
    return;
  }

  let output: string;
  let ext: string;

  switch (format.toLowerCase()) {
    case "csv":
      output = toCSV(filtered);
      ext = "csv";
      break;
    case "jsonl":
      output = toJSONL(filtered);
      ext = "jsonl";
      break;
    case "json":
    default:
      output = toJSON(filtered);
      ext = "json";
      break;
  }

  if (outputFile) {
    fs.writeFileSync(outputFile, output, "utf8");
    console.log(`Exported ${filtered.length} entries to ${outputFile}`);
  } else {
    const defaultName = `hannah-traces-${new Date().toISOString().split("T")[0]}.${ext}`;
    fs.writeFileSync(defaultName, output, "utf8");
    console.log(`Exported ${filtered.length} entries to ${defaultName}`);
  }
}

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
  if (arg.includes("=")) {
    return arg.split("=")[1];
  }
  if (idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

function loadTraces(tracesDir: string, days: number): TraceEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries: TraceEntry[] = [];

  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const filePath = path.join(tracesDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TraceEntry;
        const ts = new Date(entry.timestamp).getTime();
        if (ts >= cutoff) {
          entries.push(entry);
        }
      } catch {
        // Skip invalid lines
      }
    }
  }

  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function toJSON(entries: TraceEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function toJSONL(entries: TraceEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

function toCSV(entries: TraceEntry[]): string {
  const headers = [
    "timestamp",
    "event",
    "source",
    "action",
    "toolName",
    "sessionId",
    "duration",
    "exitCode",
    "feedback",
    "payload",
  ];

  const rows = entries.map((e) => {
    return [
      e.timestamp,
      e.event,
      e.source,
      e.action,
      e.toolName || "",
      e.sessionId || "",
      e.duration?.toString() || "",
      e.exitCode?.toString() || "",
      e.feedback?.join("; ") || "",
      JSON.stringify(e.payload),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}
