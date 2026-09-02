/**
 * Pattern Analyzer - 行为模式分析
 *
 * Analyzes agent behavior patterns from trace data:
 * - Tool usage frequency and distribution
 * - Time-based activity patterns
 * - Session behavior profiles
 * - Error rate trends
 * - Common operation sequences
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

export interface BehaviorProfile {
  sessionId: string;
  source: string;
  startTime: string;
  endTime: string;
  totalEvents: number;
  toolUsage: Map<string, number>;
  actionDistribution: Map<string, number>;
  hourlyActivity: Map<number, number>;
  avgDuration: number;
  errorRate: number;
  topModifiedPaths: string[];
}

export interface PatternReport {
  totalSessions: number;
  totalEvents: number;
  dateRange: { start: string; end: string };
  toolStats: { tool: string; count: number; percentage: number }[];
  sourceStats: { source: string; count: number; percentage: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  peakHours: number[];
  commonSequences: { pattern: string[]; count: number }[];
  errorPatterns: { tool: string; errorCount: number; errorRate: number }[];
  behaviorProfiles: BehaviorProfile[];
}

export function analyzePatterns(tracesDir: string, days: number = 7): PatternReport {
  const entries = loadTraces(tracesDir, days);

  if (entries.length === 0) {
    return emptyReport();
  }

  const toolCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const hourlyCounts = new Map<number, number>();
  const sessionEntries = new Map<string, TraceEntry[]>();

  for (const entry of entries) {
    // Tool usage
    if (entry.toolName) {
      toolCounts.set(entry.toolName, (toolCounts.get(entry.toolName) || 0) + 1);
    }

    // Source distribution
    const src = entry.source || "unknown";
    sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);

    // Hourly activity
    const hour = new Date(entry.timestamp).getHours();
    hourlyCounts.set(hour, (hourlyCounts.get(hour) || 0) + 1);

    // Session grouping
    const sid = entry.sessionId || "unknown";
    if (!sessionEntries.has(sid)) sessionEntries.set(sid, []);
    sessionEntries.get(sid)!.push(entry);
  }

  // Build tool stats
  const totalEvents = entries.length;
  const toolStats = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: Math.round((count / totalEvents) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // Build source stats
  const sourceStats = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({
      source,
      count,
      percentage: Math.round((count / totalEvents) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // Hourly distribution
  const hourlyDistribution = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourlyCounts.get(i) || 0,
  }));

  // Peak hours (top 3)
  const peakHours = hourlyDistribution
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour);

  // Common sequences (bigrams)
  const commonSequences = findCommonSequences(entries);

  // Error patterns
  const errorPatterns = findErrorPatterns(entries);

  // Behavior profiles per session
  const behaviorProfiles = Array.from(sessionEntries.entries()).map(([sid, ses]) =>
    buildBehaviorProfile(sid, ses)
  );

  const timestamps = entries.map((e) => e.timestamp).sort();

  return {
    totalSessions: sessionEntries.size,
    totalEvents,
    dateRange: {
      start: timestamps[0] || "N/A",
      end: timestamps[timestamps.length - 1] || "N/A",
    },
    toolStats,
    sourceStats,
    hourlyDistribution,
    peakHours,
    commonSequences,
    errorPatterns,
    behaviorProfiles,
  };
}

function buildBehaviorProfile(sessionId: string, entries: TraceEntry[]): BehaviorProfile {
  const timestamps = entries.map((e) => e.timestamp).sort();
  const toolUsage = new Map<string, number>();
  const actionDist = new Map<string, number>();
  const hourlyAct = new Map<number, number>();
  const pathCounts = new Map<string, number>();
  let totalDuration = 0;
  let durationCount = 0;
  let errorCount = 0;

  for (const e of entries) {
    if (e.toolName) toolUsage.set(e.toolName, (toolUsage.get(e.toolName) || 0) + 1);
    actionDist.set(e.action, (actionDist.get(e.action) || 0) + 1);
    const hour = new Date(e.timestamp).getHours();
    hourlyAct.set(hour, (hourlyAct.get(hour) || 0) + 1);
    if (e.duration != null) {
      totalDuration += e.duration;
      durationCount++;
    }
    if (e.action === "deny" || e.exitCode !== undefined && e.exitCode !== 0) {
      errorCount++;
    }
    if (e.modifiedFiles) {
      for (const f of e.modifiedFiles) {
        pathCounts.set(f, (pathCounts.get(f) || 0) + 1);
      }
    }
  }

  const topPaths = Array.from(pathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p]) => p);

  return {
    sessionId,
    source: entries[0]?.source || "unknown",
    startTime: timestamps[0] || "N/A",
    endTime: timestamps[timestamps.length - 1] || "N/A",
    totalEvents: entries.length,
    toolUsage,
    actionDistribution: actionDist,
    hourlyActivity: hourlyAct,
    avgDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    errorRate: entries.length > 0 ? errorCount / entries.length : 0,
    topModifiedPaths: topPaths,
  };
}

function findCommonSequences(entries: TraceEntry[]): { pattern: string[]; count: number }[] {
  const bigrams = new Map<string, number>();

  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i].toolName || entries[i].event;
    const b = entries[i + 1].toolName || entries[i + 1].event;
    const key = a + " -> " + b;
    bigrams.set(key, (bigrams.get(key) || 0) + 1);
  }

  return Array.from(bigrams.entries())
    .map(([pattern, count]) => ({
      pattern: pattern.split(" -> "),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function findErrorPatterns(entries: TraceEntry[]): { tool: string; errorCount: number; errorRate: number }[] {
  const toolTotal = new Map<string, number>();
  const toolErrors = new Map<string, number>();

  for (const e of entries) {
    const tool = e.toolName || "unknown";
    toolTotal.set(tool, (toolTotal.get(tool) || 0) + 1);
    if (e.action === "deny" || (e.exitCode !== undefined && e.exitCode !== 0)) {
      toolErrors.set(tool, (toolErrors.get(tool) || 0) + 1);
    }
  }

  return Array.from(toolTotal.entries())
    .map(([tool, total]) => ({
      tool,
      errorCount: toolErrors.get(tool) || 0,
      errorRate: total > 0 ? (toolErrors.get(tool) || 0) / total : 0,
    }))
    .filter((p) => p.errorCount > 0)
    .sort((a, b) => b.errorRate - a.errorRate);
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
        if (ts >= cutoff) entries.push(entry);
      } catch { /* skip */ }
    }
  }

  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function emptyReport(): PatternReport {
  return {
    totalSessions: 0,
    totalEvents: 0,
    dateRange: { start: "N/A", end: "N/A" },
    toolStats: [],
    sourceStats: [],
    hourlyDistribution: [],
    peakHours: [],
    commonSequences: [],
    errorPatterns: [],
    behaviorProfiles: [],
  };
}

export function printPatternReport(report: PatternReport): void {
  console.log("");
  console.log("=== Behavior Pattern Analysis ===");
  console.log("");
  console.log("Total sessions: " + report.totalSessions);
  console.log("Total events:   " + report.totalEvents);
  console.log("Date range:     " + report.dateRange.start + " to " + report.dateRange.end);
  console.log("");

  if (report.toolStats.length > 0) {
    console.log("--- Tool Usage ---");
    console.log("");
    for (const t of report.toolStats.slice(0, 10)) {
      const bar = "#".repeat(Math.max(1, Math.round(t.percentage / 2)));
      console.log("  " + t.tool.padEnd(20) + String(t.count).padStart(6) + "  (" + t.percentage + "%)  " + bar);
    }
    console.log("");
  }

  if (report.sourceStats.length > 0) {
    console.log("--- Agent Sources ---");
    console.log("");
    for (const s of report.sourceStats) {
      console.log("  " + s.source.padEnd(20) + String(s.count).padStart(6) + "  (" + s.percentage + "%)");
    }
    console.log("");
  }

  if (report.peakHours.length > 0) {
    console.log("--- Peak Activity Hours ---");
    console.log("");
    console.log("  " + report.peakHours.map((h) => String(h).padStart(2, "0") + ":00").join(", "));
    console.log("");
  }

  if (report.commonSequences.length > 0) {
    console.log("--- Common Operation Sequences ---");
    console.log("");
    for (const seq of report.commonSequences.slice(0, 5)) {
      console.log("  " + seq.pattern.join(" -> ") + "  (x" + seq.count + ")");
    }
    console.log("");
  }

  if (report.errorPatterns.length > 0) {
    console.log("--- Error Patterns ---");
    console.log("");
    for (const ep of report.errorPatterns.slice(0, 5)) {
      console.log("  " + ep.tool.padEnd(20) + " errors: " + ep.errorCount + "  rate: " + Math.round(ep.errorRate * 100) + "%");
    }
    console.log("");
  }
}
