/**
 * Policy Recommender - 策略推荐
 *
 * Generates policy recommendations based on trace analysis:
 * - Suggest new policies based on repeated violations
 * - Recommend policy adjustments based on false positive rates
 * - Identify gaps in current policy coverage
 * - Propose rule refinements based on patterns
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { analyzePatterns, type PatternReport } from "./pattern-analyzer.js";
import { detectAnomalies, type AnomalyReport } from "./anomaly-detector.js";

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

export interface PolicyRecommendation {
  type: "new_policy" | "adjust_policy" | "remove_policy" | "refine_rule";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  evidence: string[];
  suggestedPolicy?: Record<string, unknown>;
  confidence: number;
}

export interface RecommendationReport {
  recommendations: PolicyRecommendation[];
  summary: {
    newPolicies: number;
    adjustments: number;
    removals: number;
    refinements: number;
  };
  analyzedData: {
    totalTraces: number;
    totalSessions: number;
    dateRange: { start: string; end: string };
  };
}

export function generateRecommendations(tracesDir: string, days: number = 7): RecommendationReport {
  const entries = loadTraces(tracesDir, days);
  const patternReport = analyzePatterns(tracesDir, days);
  const recommendations: PolicyRecommendation[] = [];

  if (entries.length === 0) {
    return {
      recommendations: [],
      summary: { newPolicies: 0, adjustments: 0, removals: 0, refinements: 0 },
      analyzedData: { totalTraces: 0, totalSessions: 0, dateRange: { start: "N/A", end: "N/A" } },
    };
  }

  // 1. Recommend new policies based on repeated violations
  recommendations.push(...recommendNewPolicies(entries));

  // 2. Recommend adjustments based on error patterns
  recommendations.push(...recommendAdjustments(patternReport, entries));

  // 3. Recommend removals for unused policies
  recommendations.push(...recommendRemovals(entries));

  // 4. Recommend refinements based on tool patterns
  recommendations.push(...recommendRefinements(patternReport));

  // Sort by priority and confidence
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.confidence - a.confidence;
  });

  const timestamps = entries.map((e) => e.timestamp).sort();

  return {
    recommendations,
    summary: {
      newPolicies: recommendations.filter((r) => r.type === "new_policy").length,
      adjustments: recommendations.filter((r) => r.type === "adjust_policy").length,
      removals: recommendations.filter((r) => r.type === "remove_policy").length,
      refinements: recommendations.filter((r) => r.type === "refine_rule").length,
    },
    analyzedData: {
      totalTraces: entries.length,
      totalSessions: patternReport.totalSessions,
      dateRange: {
        start: timestamps[0] || "N/A",
        end: timestamps[timestamps.length - 1] || "N/A",
      },
    },
  };
}

function recommendNewPolicies(entries: TraceEntry[]): PolicyRecommendation[] {
  const recommendations: PolicyRecommendation[] = [];

  // Find repeated violations that aren't covered by existing policies
  const violationPatterns = new Map<string, { count: number; examples: string[] }>();

  for (const e of entries) {
    if (e.action === "deny" && e.feedback && e.feedback.length > 0) {
      const key = e.toolName || "unknown";
      if (!violationPatterns.has(key)) {
        violationPatterns.set(key, { count: 0, examples: [] });
      }
      const pattern = violationPatterns.get(key)!;
      pattern.count++;
      if (pattern.examples.length < 3) {
        pattern.examples.push(e.feedback[0]);
      }
    }
  }

  // Recommend policies for frequent violations
  for (const [tool, data] of violationPatterns) {
    if (data.count >= 5) {
      recommendations.push({
        type: "new_policy",
        priority: data.count >= 10 ? "high" : "medium",
        title: "Create policy for " + tool + " violations",
        description: "Detected " + data.count + " violations involving " + tool + ". Consider creating a dedicated policy to prevent these operations.",
        evidence: data.examples,
        suggestedPolicy: {
          name: "auto-generated-" + tool.toLowerCase().replace(/[^a-z0-9]/g, "-"),
          description: "Auto-generated policy based on repeated violations",
          rules: [
            {
              when: "tool.before",
              match: [{ field: "toolName", pattern: tool }],
              action: "deny",
              feedback: "This operation has been repeatedly blocked. Review the operation before retrying.",
            },
          ],
        },
        confidence: Math.min(0.9, 0.5 + data.count * 0.05),
      });
    }
  }

  return recommendations;
}

function recommendAdjustments(
  patternReport: PatternReport,
  entries: TraceEntry[]
): PolicyRecommendation[] {
  const recommendations: PolicyRecommendation[] = [];

  // Find tools with high error rates that might need policy adjustment
  for (const ep of patternReport.errorPatterns) {
    if (ep.errorRate > 0.5 && ep.errorCount >= 3) {
      recommendations.push({
        type: "adjust_policy",
        priority: ep.errorRate > 0.8 ? "high" : "medium",
        title: "Adjust policy for " + ep.tool,
        description: "Tool '" + ep.tool + "' has a " + Math.round(ep.errorRate * 100) + "% error rate (" + ep.errorCount + " errors). The policy may be too restrictive or the agent may need guidance.",
        evidence: [
          "Error count: " + ep.errorCount,
          "Error rate: " + Math.round(ep.errorRate * 100) + "%",
        ],
        confidence: Math.min(0.85, 0.4 + ep.errorRate * 0.5),
      });
    }
  }

  // Check for policies that block legitimate operations
  const allowAfterDeny = new Map<string, number>();
  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1].action === "deny" && entries[i].action === "allow") {
      const tool = entries[i - 1].toolName || "unknown";
      allowAfterDeny.set(tool, (allowAfterDeny.get(tool) || 0) + 1);
    }
  }

  for (const [tool, count] of allowAfterDeny) {
    if (count >= 3) {
      recommendations.push({
        type: "adjust_policy",
        priority: "medium",
        title: "Review deny policy for " + tool,
        description: "Detected " + count + " cases where operations were denied but similar operations were later allowed. The policy may need refinement.",
        evidence: ["Retry-after-deny count: " + count],
        confidence: 0.6,
      });
    }
  }

  return recommendations;
}

function recommendRemovals(entries: TraceEntry[]): PolicyRecommendation[] {
  const recommendations: PolicyRecommendation[] = [];

  // This would require access to loaded policies, which we don't have here
  // Instead, we'll note this as a future enhancement
  // In a real implementation, we'd cross-reference with actual policy files

  return recommendations;
}

function recommendRefinements(patternReport: PatternReport): PolicyRecommendation[] {
  const recommendations: PolicyRecommendation[] = [];

  // Recommend refinements based on common sequences
  if (patternReport.commonSequences.length > 0) {
    const topSeq = patternReport.commonSequences[0];
    if (topSeq.count >= 10) {
      recommendations.push({
        type: "refine_rule",
        priority: "low",
        title: "Optimize for common operation sequence",
        description: "Detected frequent sequence: " + topSeq.pattern.join(" -> ") + " (x" + topSeq.count + "). Consider creating a compound rule or optimizing the workflow.",
        evidence: ["Sequence count: " + topSeq.count, "Pattern: " + topSeq.pattern.join(" -> ")],
        confidence: 0.5,
      });
    }
  }

  // Recommend refinements based on peak hours
  if (patternReport.peakHours.length > 0) {
    recommendations.push({
      type: "refine_rule",
      priority: "low",
      title: "Consider time-based policy adjustments",
      description: "Peak activity hours: " + patternReport.peakHours.map((h) => h + ":00").join(", ") + ". Consider relaxing certain policies during off-peak hours.",
      evidence: ["Peak hours: " + patternReport.peakHours.join(", ")],
      confidence: 0.4,
    });
  }

  return recommendations;
}

// --- Helpers ---

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

export function printRecommendationReport(report: RecommendationReport): void {
  console.log("");
  console.log("=== Policy Recommendations ===");
  console.log("");
  console.log("Analyzed: " + report.analyzedData.totalTraces + " traces across " + report.analyzedData.totalSessions + " sessions");
  console.log("Period:   " + report.analyzedData.dateRange.start + " to " + report.analyzedData.dateRange.end);
  console.log("");
  console.log("Summary:");
  console.log("  New policies:    " + report.summary.newPolicies);
  console.log("  Adjustments:     " + report.summary.adjustments);
  console.log("  Removals:        " + report.summary.removals);
  console.log("  Refinements:     " + report.summary.refinements);
  console.log("");

  if (report.recommendations.length === 0) {
    console.log("No recommendations at this time. Policies appear well-tuned.");
    console.log("");
    return;
  }

  console.log("--- Recommendations ---");
  console.log("");

  for (const r of report.recommendations) {
    const icon = r.type === "new_policy" ? "[NEW]     " :
                 r.type === "adjust_policy" ? "[ADJUST]  " :
                 r.type === "remove_policy" ? "[REMOVE]  " : "[REFINE]  ";
    const priority = r.priority === "high" ? "HIGH" : r.priority === "medium" ? "MED " : "LOW ";
    console.log(icon + " [" + priority + "] " + r.title);
    console.log("           " + r.description);
    console.log("           Confidence: " + Math.round(r.confidence * 100) + "%");
    if (r.evidence.length > 0) {
      console.log("           Evidence:");
      for (const e of r.evidence) {
        console.log("             - " + e);
      }
    }
    if (r.suggestedPolicy) {
      console.log("           Suggested policy:");
      console.log("             " + JSON.stringify(r.suggestedPolicy, null, 2).split("\n").join("\n             "));
    }
    console.log("");
  }
}
