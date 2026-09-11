/**
 * Feedback Effectiveness Analyzer
 *
 * 分析 hook 反馈是否有效帮助 agent 修正了行为。
 *
 * 核心逻辑：
 * 对于每条 agent 收到反馈的 trace（deny/warn/modify 且有 feedback），
 * 在同一 round 内向后扫描——如果同一 event（规则）再次触发 deny/warn，
 * 说明反馈"无效"；否则"有效"。
 *
 * 无需修改 handler.mjs，完全基于已有 trace 数据做 post-hoc 分析。
 */

// ─── Types ────────────────────────────────────────────────────────────

interface TraceEntry {
  timestamp: string;
  event: string;
  source: string;
  action: string;
  payload: Record<string, unknown>;
  feedback?: string[];
  sessionId?: string;
}

export interface RoundBounds {
  roundId: string;
  sessionId: string;
  startTime: string;
  endTime: string;
}

export interface FeedbackEvent {
  timestamp: string;
  event: string;
  action: string;
  feedback: string;
  sessionId: string;
  roundId: string;
  target: string;
}

export interface FeedbackCase {
  feedbackEvent: FeedbackEvent;
  repeated: boolean;
  repeatTimestamp?: string;
  repeatEvent?: string;
}

export interface RuleBreakdown {
  rule: string;
  totalFeedback: number;
  effective: number;
  ineffective: number;
  effectivenessRate: number;
  rating: "good" | "fair" | "poor";
}

export interface FeedbackEffectivenessReport {
  totalFeedbackEvents: number;
  effectiveCount: number;
  ineffectiveCount: number;
  overallRate: number;
  byRule: RuleBreakdown[];
  cases: FeedbackCase[];
  insufficientData: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────

/** Gap threshold in ms — must match dashboard's ROUND_GAP_MS */
const ROUND_GAP_MS = 30_000;

/** Actions that count as "feedback was given to agent" */
const FEEDBACK_ACTIONS = new Set(["deny", "warn", "modify"]);

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Analyze feedback effectiveness from trace entries.
 *
 * @param entries - Trace entries (should be sorted by timestamp ascending)
 * @param rounds - Optional pre-computed round bounds; if omitted, rounds are
 *                 detected from time gaps using the same algorithm as the dashboard.
 */
export function analyzeFeedbackEffectiveness(
  entries: TraceEntry[],
  rounds?: RoundBounds[],
): FeedbackEffectivenessReport {
  // Sort entries by timestamp
  const sorted = [...entries].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  // Detect rounds if not provided
  const resolvedRounds = rounds ?? detectRoundsFromEntries(sorted);

  // Assign each entry to a round
  const entryRoundMap = assignEntriesToRounds(sorted, resolvedRounds);

  // Identify feedback events
  const feedbackEvents = extractFeedbackEvents(sorted, entryRoundMap);

  if (feedbackEvents.length === 0) {
    return {
      totalFeedbackEvents: 0,
      effectiveCount: 0,
      ineffectiveCount: 0,
      overallRate: 0,
      byRule: [],
      cases: [],
      insufficientData: true,
    };
  }

  // For each feedback event, check if the same rule fires again in the same round
  const cases: FeedbackCase[] = [];
  for (const fe of feedbackEvents) {
    const repeat = findRepeat(fe, sorted, entryRoundMap);
    cases.push({
      feedbackEvent: fe,
      repeated: repeat !== null,
      repeatTimestamp: repeat?.timestamp,
      repeatEvent: repeat?.event,
    });
  }

  // Aggregate
  const effectiveCount = cases.filter((c) => !c.repeated).length;
  const ineffectiveCount = cases.filter((c) => c.repeated).length;
  const overallRate =
    cases.length > 0 ? effectiveCount / cases.length : 0;

  // Per-rule breakdown
  const byRule = computeRuleBreakdown(cases);

  return {
    totalFeedbackEvents: cases.length,
    effectiveCount,
    ineffectiveCount,
    overallRate,
    byRule,
    cases,
    insufficientData: cases.length < 2,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────

/**
 * Detect rounds from trace entries using time-gap algorithm.
 * Mirrors the logic in dashboard.ts detectRounds().
 */
function detectRoundsFromEntries(entries: TraceEntry[]): RoundBounds[] {
  const sessionMap = new Map<string, TraceEntry[]>();
  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);
  }

  const rounds: RoundBounds[] = [];

  for (const [sessionId, sessionEntries] of sessionMap) {
    sessionEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let roundStart = 0;
    let roundNumber = 1;

    for (let i = 1; i <= sessionEntries.length; i++) {
      const isNewRound =
        i === sessionEntries.length ||
        new Date(sessionEntries[i].timestamp).getTime() -
          new Date(sessionEntries[i - 1].timestamp).getTime() >
          ROUND_GAP_MS;

      if (isNewRound) {
        const roundEntries = sessionEntries.slice(roundStart, i);
        rounds.push({
          roundId: `${sessionId}#round${roundNumber}`,
          sessionId,
          startTime: roundEntries[0].timestamp,
          endTime: roundEntries[roundEntries.length - 1].timestamp,
        });
        roundStart = i;
        roundNumber++;
      }
    }
  }

  return rounds;
}

/**
 * Assign each entry index to a round ID based on timestamp and sessionId.
 * Returns a map from entry index → roundId.
 */
function assignEntriesToRounds(
  entries: TraceEntry[],
  rounds: RoundBounds[],
): Map<number, string> {
  const map = new Map<number, string>();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const sid = e.sessionId || "unknown";
    const ts = new Date(e.timestamp).getTime();

    // Find the round that contains this entry
    let matched = false;
    for (const r of rounds) {
      if (r.sessionId !== sid) continue;
      const startMs = new Date(r.startTime).getTime();
      const endMs = new Date(r.endTime).getTime();
      if (ts >= startMs && ts <= endMs) {
        map.set(i, r.roundId);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Fallback: assign to a synthetic round
      map.set(i, `${sid}#unassigned`);
    }
  }

  return map;
}

/**
 * Extract feedback events from trace entries.
 * A feedback event is one where action is deny/warn/modify AND feedback[] is non-empty.
 */
function extractFeedbackEvents(
  entries: TraceEntry[],
  entryRoundMap: Map<number, string>,
): FeedbackEvent[] {
  const events: FeedbackEvent[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const action = (e.action || "").toLowerCase();

    if (!FEEDBACK_ACTIONS.has(action)) continue;

    const feedbackArr = e.feedback;
    if (!feedbackArr || feedbackArr.length === 0) continue;

    const feedbackText = feedbackArr.join("; ");
    if (!feedbackText.trim()) continue;

    events.push({
      timestamp: e.timestamp,
      event: e.event || "unknown",
      action,
      feedback: feedbackText,
      sessionId: e.sessionId || "unknown",
      roundId: entryRoundMap.get(i) || "unknown",
      target: extractTarget(e.payload),
    });
  }

  return events;
}

/**
 * Extract a target identifier from the payload for display purposes.
 */
function extractTarget(payload: Record<string, unknown>): string {
  if (!payload) return "unknown";
  return (
    (payload.filePath as string) ||
    (payload.file_path as string) ||
    (payload.command as string) ||
    (payload.toolName as string) ||
    (payload.tool_name as string) ||
    (payload.userMessage as string)?.substring(0, 60) ||
    "unknown"
  );
}

/**
 * Check if the same rule (event name) fires again as deny/warn
 * after the given feedback event, within the same round.
 *
 * Returns the repeat entry if found, null otherwise.
 */
function findRepeat(
  fe: FeedbackEvent,
  entries: TraceEntry[],
  entryRoundMap: Map<number, string>,
): TraceEntry | null {
  const feedbackTime = new Date(fe.timestamp).getTime();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const entryTime = new Date(e.timestamp).getTime();

    // Only look at entries AFTER the feedback event
    if (entryTime <= feedbackTime) continue;

    // Must be in the same round
    if (entryRoundMap.get(i) !== fe.roundId) continue;

    // Must be the same event (rule)
    if ((e.event || "unknown") !== fe.event) continue;

    // Must be a deny or warn (the agent repeated the violation)
    const action = (e.action || "").toLowerCase();
    if (action === "deny" || action === "warn") {
      return e;
    }
  }

  return null;
}

/**
 * Compute per-rule breakdown from feedback cases.
 */
function computeRuleBreakdown(cases: FeedbackCase[]): RuleBreakdown[] {
  const ruleMap = new Map<
    string,
    { total: number; effective: number; ineffective: number }
  >();

  for (const c of cases) {
    const rule = c.feedbackEvent.event;
    if (!ruleMap.has(rule)) {
      ruleMap.set(rule, { total: 0, effective: 0, ineffective: 0 });
    }
    const stats = ruleMap.get(rule)!;
    stats.total++;
    if (c.repeated) {
      stats.ineffective++;
    } else {
      stats.effective++;
    }
  }

  const breakdowns: RuleBreakdown[] = [];
  for (const [rule, stats] of ruleMap) {
    const rate = stats.total > 0 ? stats.effective / stats.total : 0;
    let rating: "good" | "fair" | "poor";
    if (rate >= 0.7) rating = "good";
    else if (rate >= 0.4) rating = "fair";
    else rating = "poor";

    breakdowns.push({
      rule,
      totalFeedback: stats.total,
      effective: stats.effective,
      ineffective: stats.ineffective,
      effectivenessRate: rate,
      rating,
    });
  }

  // Sort by totalFeedback descending, then by effectivenessRate ascending
  breakdowns.sort((a, b) => {
    if (b.totalFeedback !== a.totalFeedback)
      return b.totalFeedback - a.totalFeedback;
    return a.effectivenessRate - b.effectivenessRate;
  });

  return breakdowns;
}
