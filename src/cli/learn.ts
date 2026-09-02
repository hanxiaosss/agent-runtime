/**
 * learn command - Self-learning intelligence
 *
 * Provides access to Phase 4 intelligence features:
 * - Pattern analysis
 * - Anomaly detection
 * - Policy recommendations
 * - Escalation management
 *
 * Usage:
 *   hannah learn                    # Run full analysis (patterns + anomalies + recommendations)
 *   hannah learn patterns           # Behavior pattern analysis only
 *   hannah learn anomalies          # Anomaly detection only
 *   hannah learn recommend          # Policy recommendations only
 *   hannah learn escalation         # Show escalation statistics
 *   hannah learn escalation reset   # Reset all escalation records
 *   hannah learn escalation reset <agent>  # Reset specific agent
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { analyzePatterns, printPatternReport } from "../intelligence/pattern-analyzer.js";
import { detectAnomalies, printAnomalyReport } from "../intelligence/anomaly-detector.js";
import { generateRecommendations, printRecommendationReport } from "../intelligence/policy-recommender.js";
import { FeedbackEscalation, printEscalationStats } from "../intelligence/feedback-escalation.js";

export function runLearn(args: string[]): void {
  const subCommand = (args[0] && !args[0].startsWith("--")) ? args[0] : "full";
  const flags = (args[0] && !args[0].startsWith("--")) ? args.slice(1) : args;
  const days = parseInt(getArgValue(flags, "--days") || "7");

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found. Run some agent operations first.");
    process.exit(1);
  }

  const harnessDir = path.join(tracesDir, "..");

  switch (subCommand) {
    case "full":
      runFullAnalysis(tracesDir, harnessDir, days);
      break;
    case "patterns":
      runPatterns(tracesDir, days);
      break;
    case "anomalies":
      runAnomalies(tracesDir, days);
      break;
    case "recommend":
      runRecommendations(tracesDir, days);
      break;
    case "escalation":
      runEscalation(harnessDir, flags);
      break;
    default:
      console.error("Unknown learn command: " + subCommand);
      console.error("Usage: hannah learn [full|patterns|anomalies|recommend|escalation]");
      process.exit(1);
  }
}

function runFullAnalysis(tracesDir: string, harnessDir: string, days: number): void {
  console.log("");
  console.log("========================================");
  console.log("  Hannah Intelligence Report");
  console.log("  Period: Last " + days + " days");
  console.log("========================================");

  // 1. Pattern Analysis
  const patternReport = analyzePatterns(tracesDir, days);
  printPatternReport(patternReport);

  // 2. Anomaly Detection
  const anomalyReport = detectAnomalies(tracesDir, days);
  printAnomalyReport(anomalyReport);

  // 3. Policy Recommendations
  const recommendationReport = generateRecommendations(tracesDir, days);
  printRecommendationReport(recommendationReport);

  // 4. Escalation Stats
  const escalation = new FeedbackEscalation(harnessDir);
  printEscalationStats(escalation);

  console.log("========================================");
  console.log("  Analysis Complete");
  console.log("========================================");
  console.log("");
}

function runPatterns(tracesDir: string, days: number): void {
  const report = analyzePatterns(tracesDir, days);
  printPatternReport(report);
}

function runAnomalies(tracesDir: string, days: number): void {
  const report = detectAnomalies(tracesDir, days);
  printAnomalyReport(report);
}

function runRecommendations(tracesDir: string, days: number): void {
  const report = generateRecommendations(tracesDir, days);
  printRecommendationReport(report);
}

function runEscalation(harnessDir: string, args: string[]): void {
  const action = args.find((a) => !a.startsWith("--")) || "stats";
  const escalation = new FeedbackEscalation(harnessDir);

  switch (action) {
    case "stats":
      printEscalationStats(escalation);
      break;
    case "reset": {
      const agentId = args.find((a) => !a.startsWith("--") && a !== "reset");
      if (agentId) {
        escalation.resetAgent(agentId);
        console.log("Reset escalation records for agent: " + agentId);
      } else {
        escalation.resetAll();
        console.log("Reset all escalation records.");
      }
      break;
    }
    default:
      console.error("Unknown escalation action: " + action);
      console.error("Usage: hannah learn escalation [stats|reset] [--agent=<id>]");
      process.exit(1);
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
