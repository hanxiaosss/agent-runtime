/**
 * Rule Optimization Analyzer
 *
 * Analyzes trace data to generate optimization suggestions:
 * - High false positive rates (rules that block too often)
 * - Low hit rates (rules that never trigger)
 * - Rule conflicts
 * - Unused rules
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TraceEntry {
  timestamp: string;
  event: string;
  toolName: string;
  decision: string;
  reason: string;
  ruleName?: string;
  input?: Record<string, unknown>;
}

interface RuleStats {
  ruleName: string;
  totalHits: number;
  denyCount: number;
  warnCount: number;
  allowCount: number;
  lastTriggered: string | null;
  falsePositiveRate: number;
}

interface AnalysisReport {
  totalTraces: number;
  dateRange: { start: string; end: string };
  ruleStats: RuleStats[];
  suggestions: OptimizationSuggestion[];
  conflicts: RuleConflict[];
}

interface OptimizationSuggestion {
  type: "disable" | "relax" | "review" | "conflict";
  ruleName: string;
  reason: string;
  confidence: number;
}

interface RuleConflict {
  ruleA: string;
  ruleB: string;
  description: string;
}

export function runAnalyze(args: string[]): void {
  const tracesDir = findTracesDir();
  if (!tracesDir || !fs.existsSync(tracesDir)) {
    console.log("No traces directory found. Run some agent operations first.");
    return;
  }

  const days = parseDaysArg(args);
  const entries = loadTraces(tracesDir, days);

  if (entries.length === 0) {
    console.log("No trace entries found for the specified period.");
    return;
  }

  const report = analyzeEntries(entries);
  printReport(report);
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

function parseDaysArg(args: string[]): number {
  const daysIdx = args.indexOf("--days");
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    return parseInt(args[daysIdx + 1], 10) || 7;
  }
  if (args.includes("--today")) return 1;
  return 7;
}

function loadTraces(tracesDir: string, days: number): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const fileDate = new Date(dateMatch[1]);
      if (fileDate < cutoff) continue;
    }

    try {
      const content = fs.readFileSync(path.join(tracesDir, file), "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return entries;
}

function analyzeEntries(entries: TraceEntry[]): AnalysisReport {
  const ruleMap = new Map<string, RuleStats>();
  const conflicts: RuleConflict[] = [];

  for (const entry of entries) {
    const ruleName = entry.ruleName || "unmatched";
    if (!ruleMap.has(ruleName)) {
      ruleMap.set(ruleName, {
        ruleName,
        totalHits: 0,
        denyCount: 0,
        warnCount: 0,
        allowCount: 0,
        lastTriggered: null,
        falsePositiveRate: 0,
      });
    }

    const stats = ruleMap.get(ruleName)!;
    stats.totalHits++;
    stats.lastTriggered = entry.timestamp;

    if (entry.decision === "deny") stats.denyCount++;
    else if (entry.decision === "warn") stats.warnCount++;
    else stats.allowCount++;
  }

  const ruleStats = Array.from(ruleMap.values());

  // Calculate false positive rates
  for (const stats of ruleStats) {
    if (stats.totalHits > 0) {
      // False positive: rules that trigger but result in allow (over-matching)
      stats.falsePositiveRate = stats.allowCount / stats.totalHits;
    }
  }

  // Generate suggestions
  const suggestions: OptimizationSuggestion[] = [];

  for (const stats of ruleStats) {
    if (stats.ruleName === "unmatched") continue;

    // High false positive rate
    if (stats.falsePositiveRate > 0.8 && stats.totalHits >= 5) {
      suggestions.push({
        type: "relax",
        ruleName: stats.ruleName,
        reason: `Rule has ${Math.round(stats.falsePositiveRate * 100)}% false positive rate (${stats.totalHits} triggers, most allowed)`,
        confidence: 0.8,
      });
    }

    // Never triggers deny/warn
    if (stats.denyCount === 0 && stats.warnCount === 0 && stats.totalHits >= 10) {
      suggestions.push({
        type: "review",
        ruleName: stats.ruleName,
        reason: `Rule has never blocked or warned in ${stats.totalHits} triggers. Consider if it is still needed.`,
        confidence: 0.6,
      });
    }

    // Very low hit rate
    if (stats.totalHits <= 2) {
      suggestions.push({
        type: "review",
        ruleName: stats.ruleName,
        reason: `Rule triggered only ${stats.totalHits} time(s). Consider consolidating or removing.`,
        confidence: 0.4,
      });
    }
  }

  // Detect potential conflicts (rules that match similar patterns with different actions)
  const denyRules = ruleStats.filter((s) => s.denyCount > 0);
  const warnRules = ruleStats.filter((s) => s.warnCount > 0);
  for (const deny of denyRules) {
    for (const warn of warnRules) {
      if (deny.ruleName !== warn.ruleName && similarity(deny.ruleName, warn.ruleName) > 0.6) {
        conflicts.push({
          ruleA: deny.ruleName,
          ruleB: warn.ruleName,
          description: `Rules "${deny.ruleName}" (deny) and "${warn.ruleName}" (warn) may overlap in scope`,
        });
        suggestions.push({
          type: "conflict",
          ruleName: deny.ruleName,
          reason: `Potential conflict with "${warn.ruleName}"`,
          confidence: 0.5,
        });
      }
    }
  }

  const timestamps = entries.map((e) => e.timestamp).sort();
  return {
    totalTraces: entries.length,
    dateRange: {
      start: timestamps[0] || "N/A",
      end: timestamps[timestamps.length - 1] || "N/A",
    },
    ruleStats,
    suggestions,
    conflicts,
  };
}

function similarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;
  const longer = al.length > bl.length ? al : bl;
  const shorter = al.length > bl.length ? bl : al;
  if (longer.length === 0) return 1;
  const editDist = levenshtein(longer, shorter);
  return (longer.length - editDist) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function printReport(report: AnalysisReport): void {
  console.log("");
  console.log("=== Rule Optimization Report ===");
  console.log("");
  console.log("Total traces analyzed: " + report.totalTraces);
  console.log("Date range: " + report.dateRange.start + " to " + report.dateRange.end);
  console.log("");

  if (report.ruleStats.length > 0) {
    console.log("--- Rule Statistics ---");
    console.log("");
    const header = "Rule".padEnd(35) + "Hits".padStart(6) + "Deny".padStart(6) + "Warn".padStart(6) + "FP%".padStart(6);
    console.log(header);
    console.log("-".repeat(header.length));
    for (const stats of report.ruleStats) {
      const name = stats.ruleName.length > 33 ? stats.ruleName.slice(0, 30) + "..." : stats.ruleName;
      console.log(
        name.padEnd(35) +
        String(stats.totalHits).padStart(6) +
        String(stats.denyCount).padStart(6) +
        String(stats.warnCount).padStart(6) +
        (Math.round(stats.falsePositiveRate * 100) + "%").padStart(6),
      );
    }
    console.log("");
  }

  if (report.suggestions.length > 0) {
    console.log("--- Optimization Suggestions ---");
    console.log("");
    for (const s of report.suggestions) {
      const icon = s.type === "disable" ? "[DISABLE]" :
                   s.type === "relax" ? "[RELAX]  " :
                   s.type === "conflict" ? "[CONFLICT]" : "[REVIEW] ";
      console.log(icon + " " + s.ruleName);
      console.log("         " + s.reason);
      console.log("         Confidence: " + Math.round(s.confidence * 100) + "%");
      console.log("");
    }
  }

  if (report.conflicts.length > 0) {
    console.log("--- Detected Conflicts ---");
    console.log("");
    for (const c of report.conflicts) {
      console.log("  " + c.ruleA + " <-> " + c.ruleB);
      console.log("  " + c.description);
      console.log("");
    }
  }

  if (report.suggestions.length === 0 && report.conflicts.length === 0) {
    console.log("No optimization suggestions. Rules are performing well.");
    console.log("");
  }
}
