/**
 * Anomaly Detector - 异常检测
 *
 * Detects anomalous agent behavior:
 * - Sudden spikes in error rates
 * - Unusual tool usage patterns
 * - Abnormal session duration
 * - Unexpected file access patterns
 * - Rate limit violations
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

export interface Anomaly {
  type: AnomalyType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  details: Record<string, unknown>;
  timestamp: string;
  recommendation: string;
}

export type AnomalyType =
  | "error_spike"
  | "unusual_tool"
  | "long_session"
  | "sensitive_access"
  | "rate_violation"
  | "pattern_deviation";

export interface AnomalyReport {
  anomalies: Anomaly[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  analyzedPeriod: { start: string; end: string };
}

export function detectAnomalies(tracesDir: string, days: number = 7): AnomalyReport {
  const entries = loadTraces(tracesDir, days);
  const anomalies: Anomaly[] = [];

  if (entries.length === 0) {
    return {
      anomalies: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      analyzedPeriod: { start: "N/A", end: "N/A" },
    };
  }

  // 1. Error spike detection
  anomalies.push(...detectErrorSpikes(entries));

  // 2. Unusual tool usage
  anomalies.push(...detectUnusualToolUsage(entries));

  // 3. Long session detection
  anomalies.push(...detectLongSessions(entries));

  // 4. Sensitive file access
  anomalies.push(...detectSensitiveAccess(entries));

  // 5. Rate violations
  anomalies.push(...detectRateViolations(entries));

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const timestamps = entries.map((e) => e.timestamp).sort();

  return {
    anomalies,
    summary: {
      total: anomalies.length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
      high: anomalies.filter((a) => a.severity === "high").length,
      medium: anomalies.filter((a) => a.severity === "medium").length,
      low: anomalies.filter((a) => a.severity === "low").length,
    },
    analyzedPeriod: {
      start: timestamps[0] || "N/A",
      end: timestamps[timestamps.length - 1] || "N/A",
    },
  };
}

function detectErrorSpikes(entries: TraceEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Group by hour
  const hourlyErrors = new Map<string, { total: number; errors: number }>();

  for (const e of entries) {
    const hourKey = e.timestamp.slice(0, 13); // YYYY-MM-DDTHH
    if (!hourlyErrors.has(hourKey)) {
      hourlyErrors.set(hourKey, { total: 0, errors: 0 });
    }
    const bucket = hourlyErrors.get(hourKey)!;
    bucket.total++;
    if (e.action === "deny" || (e.exitCode !== undefined && e.exitCode !== 0)) {
      bucket.errors++;
    }
  }

  // Calculate average error rate
  const rates = Array.from(hourlyErrors.values()).map((b) =>
    b.total > 0 ? b.errors / b.total : 0
  );
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const stdDev = Math.sqrt(
    rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length
  );

  // Detect spikes (> 2 standard deviations above mean)
  const threshold = avgRate + 2 * stdDev;

  for (const [hour, bucket] of hourlyErrors) {
    const rate = bucket.total > 0 ? bucket.errors / bucket.total : 0;
    if (rate > threshold && bucket.errors >= 3) {
      anomalies.push({
        type: "error_spike",
        severity: rate > 0.8 ? "critical" : rate > 0.5 ? "high" : "medium",
        description: "Error rate spike detected at " + hour + ":00",
        details: {
          hour,
          errorRate: Math.round(rate * 100) + "%",
          avgRate: Math.round(avgRate * 100) + "%",
          errors: bucket.errors,
          total: bucket.total,
        },
        timestamp: hour + ":00:00",
        recommendation: "Investigate agent behavior during this period. High error rates may indicate misconfiguration or policy conflicts.",
      });
    }
  }

  return anomalies;
}

function detectUnusualToolUsage(entries: TraceEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Calculate tool usage distribution
  const toolCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.toolName) {
      toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    }
  }

  const total = entries.length;
  for (const [tool, count] of toolCounts) {
    const percentage = count / total;

    // Flag if a single tool dominates (> 80% of operations)
    if (percentage > 0.8 && count > 10) {
      anomalies.push({
        type: "unusual_tool",
        severity: "medium",
        description: "Unusual tool dominance: " + tool + " used in " + Math.round(percentage * 100) + "% of operations",
        details: { tool, count, percentage: Math.round(percentage * 100) },
        timestamp: entries[entries.length - 1].timestamp,
        recommendation: "Verify if this tool usage pattern is expected. Excessive reliance on a single tool may indicate suboptimal agent behavior.",
      });
    }

    // Flag rare tools that suddenly appear
    if (count === 1 && total > 50) {
      // Only flag if it's a potentially dangerous tool
      const dangerousTools = ["rm", "del", "format", "drop", "truncate"];
      if (dangerousTools.some((d) => tool.toLowerCase().includes(d))) {
        anomalies.push({
          type: "unusual_tool",
          severity: "high",
          description: "Rare dangerous tool detected: " + tool,
          details: { tool, count },
          timestamp: entries.find((e) => e.toolName === tool)?.timestamp || new Date().toISOString(),
          recommendation: "Review the use of dangerous tool '" + tool + "'. Ensure proper safeguards are in place.",
        });
      }
    }
  }

  return anomalies;
}

function detectLongSessions(entries: TraceEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Group by session
  const sessions = new Map<string, { start: number; end: number; events: number }>();

  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    const ts = new Date(e.timestamp).getTime();
    if (!sessions.has(sid)) {
      sessions.set(sid, { start: ts, end: ts, events: 0 });
    }
    const session = sessions.get(sid)!;
    session.start = Math.min(session.start, ts);
    session.end = Math.max(session.end, ts);
    session.events++;
  }

  const LONG_SESSION_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours

  for (const [sid, data] of sessions) {
    const duration = data.end - data.start;
    if (duration > LONG_SESSION_THRESHOLD) {
      const hours = Math.round(duration / (60 * 60 * 1000));
      anomalies.push({
        type: "long_session",
        severity: hours > 8 ? "high" : "medium",
        description: "Long-running session detected: " + sid + " (" + hours + " hours)",
        details: { sessionId: sid, duration: hours + "h", events: data.events },
        timestamp: new Date(data.end).toISOString(),
        recommendation: "Consider breaking long sessions into smaller chunks. Extended sessions may lead to context overflow or stale state.",
      });
    }
  }

  return anomalies;
}

function detectSensitiveAccess(entries: TraceEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const sensitivePatterns = [
    { pattern: /\.env/i, name: ".env file" },
    { pattern: /\.ssh/i, name: "SSH directory" },
    { pattern: /\.aws/i, name: "AWS credentials" },
    { pattern: /password|secret|token|key/i, name: "sensitive content" },
    { pattern: /\.git\/config/i, name: "git config" },
  ];

  for (const e of entries) {
    if (e.modifiedFiles) {
      for (const file of e.modifiedFiles) {
        for (const { pattern, name } of sensitivePatterns) {
          if (pattern.test(file)) {
            anomalies.push({
              type: "sensitive_access",
              severity: "high",
              description: "Agent modified sensitive file: " + file,
              details: { file, category: name, action: e.action },
              timestamp: e.timestamp,
              recommendation: "Review changes to sensitive file '" + file + "'. Ensure proper access controls and audit logging.",
            });
            break; // Only report once per file
          }
        }
      }
    }
  }

  return anomalies;
}

function detectRateViolations(entries: TraceEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Check for rapid-fire operations (> 100 events in 5 minutes)
  const WINDOW_SIZE = 5 * 60 * 1000; // 5 minutes
  const RATE_THRESHOLD = 100;

  const timestamps = entries.map((e) => new Date(e.timestamp).getTime()).sort();

  for (let i = 0; i < timestamps.length - RATE_THRESHOLD; i++) {
    const windowStart = timestamps[i];
    const windowEnd = windowStart + WINDOW_SIZE;

    // Count events in window
    let count = 0;
    for (let j = i; j < timestamps.length && timestamps[j] <= windowEnd; j++) {
      count++;
    }

    if (count >= RATE_THRESHOLD) {
      anomalies.push({
        type: "rate_violation",
        severity: "high",
        description: "Rate limit violation: " + count + " operations in 5 minutes",
        details: { count, window: "5min", threshold: RATE_THRESHOLD },
        timestamp: new Date(windowStart).toISOString(),
        recommendation: "Agent is operating at high frequency. Consider implementing rate limiting or batching operations.",
      });
      break; // Only report first occurrence
    }
  }

  return anomalies;
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

export function printAnomalyReport(report: AnomalyReport): void {
  console.log("");
  console.log("=== Anomaly Detection Report ===");
  console.log("");
  console.log("Analyzed period: " + report.analyzedPeriod.start + " to " + report.analyzedPeriod.end);
  console.log("Total anomalies: " + report.summary.total);
  console.log("  Critical: " + report.summary.critical);
  console.log("  High:     " + report.summary.high);
  console.log("  Medium:   " + report.summary.medium);
  console.log("  Low:      " + report.summary.low);
  console.log("");

  if (report.anomalies.length === 0) {
    console.log("No anomalies detected. Agent behavior appears normal.");
    console.log("");
    return;
  }

  console.log("--- Detected Anomalies ---");
  console.log("");

  for (const a of report.anomalies) {
    const icon = a.severity === "critical" ? "[CRITICAL]" :
                 a.severity === "high" ? "[HIGH]    " :
                 a.severity === "medium" ? "[MEDIUM]  " : "[LOW]     ";
    console.log(icon + " " + a.type);
    console.log("           " + a.description);
    console.log("           Recommendation: " + a.recommendation);
    console.log("");
  }
}
