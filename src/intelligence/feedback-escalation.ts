/**
 * Feedback Escalation - 多级反馈系统
 *
 * Implements progressive escalation based on violation patterns:
 * - Level 1: Warning (first occurrence)
 * - Level 2: Deny (repeated violations)
 * - Level 3: Block + Notify (persistent violations)
 * - Tracks violation history per agent/session
 * - Supports cooldown periods and reset mechanisms
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ViolationRecord {
  agentId: string;
  sessionId: string;
  ruleName: string;
  timestamp: string;
  level: number;
  action: FeedbackAction;
  cooldownUntil?: string;
}

export type FeedbackAction = "allow" | "warn" | "deny" | "block";

export interface EscalationConfig {
  /** Number of violations before escalating to warn */
  warnThreshold: number;
  /** Number of violations before escalating to deny */
  denyThreshold: number;
  /** Number of violations before escalating to block */
  blockThreshold: number;
  /** Cooldown period in minutes after each escalation */
  cooldownMinutes: number;
  /** Time window for counting violations (minutes) */
  windowMinutes: number;
  /** Whether to reset counter after cooldown */
  resetAfterCooldown: boolean;
}

export interface EscalationResult {
  level: number;
  action: FeedbackAction;
  feedback: string;
  violationCount: number;
  nextEscalationAt?: number;
  shouldNotify: boolean;
}

const DEFAULT_CONFIG: EscalationConfig = {
  warnThreshold: 1,
  denyThreshold: 3,
  blockThreshold: 5,
  cooldownMinutes: 30,
  windowMinutes: 60,
  resetAfterCooldown: false,
};

export class FeedbackEscalation {
  private config: EscalationConfig;
  private violations: ViolationRecord[] = [];
  private stateFile: string;

  constructor(harnessDir: string, config?: Partial<EscalationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateFile = path.join(harnessDir, "escalation-state.json");
    this.loadState();
  }

  /**
   * Evaluate a violation and return the appropriate escalation level
   */
  evaluate(agentId: string, sessionId: string, ruleName: string): EscalationResult {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.config.windowMinutes * 60 * 1000);

    // Count recent violations for this agent + rule
    const recentViolations = this.violations.filter(
      (v) =>
        v.agentId === agentId &&
        v.ruleName === ruleName &&
        new Date(v.timestamp) >= windowStart
    );

    const count = recentViolations.length + 1; // +1 for current violation

    // Determine escalation level
    let level: number;
    let action: FeedbackAction;
    let feedback: string;
    let shouldNotify = false;

    if (count >= this.config.blockThreshold) {
      level = 3;
      action = "block";
      feedback = "BLOCKED: Persistent violation detected. Operation '" + ruleName + "' has been blocked after " + count + " violations. Please review the operation and contact an administrator if this is intentional.";
      shouldNotify = true;
    } else if (count >= this.config.denyThreshold) {
      level = 2;
      action = "deny";
      feedback = "DENIED: Repeated violation of rule '" + ruleName + "'. This is violation #" + count + ". Further violations will result in blocking.";
    } else if (count >= this.config.warnThreshold) {
      level = 1;
      action = "warn";
      feedback = "WARNING: Violation of rule '" + ruleName + "'. This is violation #" + count + ". Repeated violations will be denied.";
    } else {
      level = 0;
      action = "allow";
      feedback = "";
    }

    // Record the violation
    const record: ViolationRecord = {
      agentId,
      sessionId,
      ruleName,
      timestamp: now.toISOString(),
      level,
      action,
    };

    if (action === "block" || action === "deny") {
      const cooldownUntil = new Date(now.getTime() + this.config.cooldownMinutes * 60 * 1000);
      record.cooldownUntil = cooldownUntil.toISOString();
    }

    this.violations.push(record);
    this.saveState();

    // Calculate next escalation threshold
    let nextEscalationAt: number | undefined;
    if (level < 3) {
      nextEscalationAt = level === 0 ? this.config.warnThreshold :
                         level === 1 ? this.config.denyThreshold :
                         this.config.blockThreshold;
    }

    return {
      level,
      action,
      feedback,
      violationCount: count,
      nextEscalationAt,
      shouldNotify,
    };
  }

  /**
   * Check if an agent is currently in cooldown for a rule
   */
  isInCooldown(agentId: string, ruleName: string): boolean {
    const now = new Date();
    return this.violations.some(
      (v) =>
        v.agentId === agentId &&
        v.ruleName === ruleName &&
        v.cooldownUntil &&
        new Date(v.cooldownUntil) > now
    );
  }

  /**
   * Get violation statistics for an agent
   */
  getAgentStats(agentId: string): {
    totalViolations: number;
    activeViolations: number;
    rulesViolated: string[];
    currentLevel: number;
  } {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.config.windowMinutes * 60 * 1000);

    const agentViolations = this.violations.filter((v) => v.agentId === agentId);
    const activeViolations = agentViolations.filter(
      (v) => new Date(v.timestamp) >= windowStart
    );

    const rulesViolated = [...new Set(activeViolations.map((v) => v.ruleName))];
    const currentLevel = activeViolations.length > 0
      ? Math.max(...activeViolations.map((v) => v.level))
      : 0;

    return {
      totalViolations: agentViolations.length,
      activeViolations: activeViolations.length,
      rulesViolated,
      currentLevel,
    };
  }

  /**
   * Reset violations for an agent (admin action)
   */
  resetAgent(agentId: string): void {
    this.violations = this.violations.filter((v) => v.agentId !== agentId);
    this.saveState();
  }

  /**
   * Reset all violations (admin action)
   */
  resetAll(): void {
    this.violations = [];
    this.saveState();
  }

  /**
   * Get all violation records
   */
  getViolations(): ViolationRecord[] {
    return [...this.violations];
  }

  // --- Persistence ---

  private loadState(): void {
    if (fs.existsSync(this.stateFile)) {
      try {
        const data = fs.readFileSync(this.stateFile, "utf8");
        this.violations = JSON.parse(data);
      } catch {
        this.violations = [];
      }
    }
  }

  private saveState(): void {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFile, JSON.stringify(this.violations, null, 2), "utf8");
  }
}

export function printEscalationStats(escalation: FeedbackEscalation): void {
  const violations = escalation.getViolations();

  console.log("");
  console.log("=== Escalation Statistics ===");
  console.log("");

  if (violations.length === 0) {
    console.log("No violations recorded.");
    console.log("");
    return;
  }

  // Group by agent
  const agentStats = new Map<string, { count: number; maxLevel: number; rules: Set<string> }>();

  for (const v of violations) {
    if (!agentStats.has(v.agentId)) {
      agentStats.set(v.agentId, { count: 0, maxLevel: 0, rules: new Set() });
    }
    const stats = agentStats.get(v.agentId)!;
    stats.count++;
    stats.maxLevel = Math.max(stats.maxLevel, v.level);
    stats.rules.add(v.ruleName);
  }

  console.log("Agent Violations:");
  console.log("");

  const header = "Agent".padEnd(25) + "Violations".padStart(12) + "Max Level".padStart(12) + "Rules";
  console.log(header);
  console.log("-".repeat(header.length + 20));

  for (const [agentId, stats] of agentStats) {
    const levelName = stats.maxLevel === 0 ? "none" :
                      stats.maxLevel === 1 ? "warn" :
                      stats.maxLevel === 2 ? "deny" : "block";
    console.log(
      agentId.padEnd(25) +
      String(stats.count).padStart(12) +
      levelName.padStart(12) +
      "  " + Array.from(stats.rules).join(", ")
    );
  }

  console.log("");
  console.log("Total violations: " + violations.length);
  console.log("");
}
