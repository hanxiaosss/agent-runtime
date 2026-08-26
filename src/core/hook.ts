/**
 * Hook Interface & Result Types
 *
 * Defines the standardized hook result that all policies return,
 * and the hook handler signature that the runtime engine uses.
 */

import type { UnifiedEvent } from "./event.js";

// ─── Hook Decision ──────────────────────────────────────────────────

export type HookAction =
  | "allow"    // Proceed normally
  | "deny"     // Block the action entirely
  | "warn"     // Proceed but log a warning
  | "retry"    // Ask the agent to retry with different params
  | "modify";  // Proceed with modified parameters

export interface HookResult {
  /** The decision */
  action: HookAction;
  /** Machine-readable reason code */
  reason?: string;
  /** Human-readable feedback to the agent */
  feedback?: string;
  /** Additional metadata (cost, trace info, etc.) */
  metadata?: Record<string, unknown>;
  /**
   * When action is "modify", this contains the modified payload.
   * The adapter is responsible for translating this back into
   * the runtime-specific format.
   */
  modifiedPayload?: Record<string, unknown>;
}

// ─── Convenience Constructors ───────────────────────────────────────

export const HookResult = {
  allow(metadata?: Record<string, unknown>): HookResult {
    return { action: "allow", metadata };
  },

  deny(reason: string, feedback: string): HookResult {
    return { action: "deny", reason, feedback };
  },

  warn(reason: string, feedback: string): HookResult {
    return { action: "warn", reason, feedback };
  },

  retry(reason: string, feedback: string): HookResult {
    return { action: "retry", reason, feedback };
  },

  modify(
    reason: string,
    feedback: string,
    modifiedPayload: Record<string, unknown>,
  ): HookResult {
    return { action: "modify", reason, feedback, modifiedPayload };
  },
};

// ─── Hook Handler ───────────────────────────────────────────────────

/**
 * A hook handler receives a unified event and returns a decision.
 * Handlers can be async (e.g., calling an external policy service).
 */
export type HookHandler = (event: UnifiedEvent) => Promise<HookResult> | HookResult;

// ─── Hook Registration ──────────────────────────────────────────────

export interface HookRegistration {
  /** Which event(s) this handler listens to. Use "*" for all events. */
  events: string | string[];
  /** The handler function */
  handler: HookHandler;
  /** Priority — lower numbers run first. Default: 100 */
  priority?: number;
  /** Human-readable name for debugging */
  name?: string;
}

// ─── Hook Pipeline Result ───────────────────────────────────────────
// When multiple hooks are registered for the same event,
// the pipeline aggregates their results.

export interface PipelineResult {
  /** The most restrictive decision across all hooks */
  finalAction: HookAction;
  /** All individual hook results */
  results: Array<{
    hookName: string;
    result: HookResult;
  }>;
  /** Combined feedback messages */
  feedbackMessages: string[];
  /** Combined metadata */
  metadata: Record<string, unknown>;
}

/**
 * Action priority order (most restrictive wins):
 * deny > modify > retry > warn > allow
 */
const ACTION_PRIORITY: Record<HookAction, number> = {
  deny: 5,
  modify: 4,
  retry: 3,
  warn: 2,
  allow: 1,
};

export function resolvePipelineResult(
  results: Array<{ hookName: string; result: HookResult }>,
): PipelineResult {
  if (results.length === 0) {
    return {
      finalAction: "allow",
      results: [],
      feedbackMessages: [],
      metadata: {},
    };
  }

  // Most restrictive action wins
  let finalAction: HookAction = "allow";
  for (const { result } of results) {
    if (ACTION_PRIORITY[result.action] > ACTION_PRIORITY[finalAction]) {
      finalAction = result.action;
    }
  }

  const feedbackMessages = results
    .filter((r) => r.result.feedback)
    .map((r) => `[${r.hookName}] ${r.result.feedback}`);

  const metadata: Record<string, unknown> = {};
  for (const { result } of results) {
    if (result.metadata) {
      Object.assign(metadata, result.metadata);
    }
  }

  return { finalAction, results, feedbackMessages, metadata };
}
