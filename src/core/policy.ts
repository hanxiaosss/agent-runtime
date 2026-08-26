/**
 * Policy Engine
 *
 * A declarative policy engine that matches events against rules
 * and produces hook decisions. Policies are defined as YAML-like
 * configuration and compiled into hook handlers at runtime.
 */

import type { UnifiedEvent, EventName } from "./event.js";
import { HookResult, type HookHandler, type HookResult as HookResultType } from "./hook.js";

// ─── Policy Rule Definition ─────────────────────────────────────────

export type PolicyAction = "allow" | "deny" | "warn" | "retry" | "trace";

export interface PolicyMatch {
  /** Field path to match against event payload (dot notation) */
  field: string;
  /** Glob pattern or exact value to match */
  pattern: string | string[];
  /** Negate the match */
  negate?: boolean;
}

export interface PolicyRule {
  /** Which event(s) this rule applies to */
  when: string | string[];
  /** Match conditions — all must match (AND logic) */
  match?: PolicyMatch[];
  /** What to do when matched */
  action: PolicyAction;
  /** Human-readable reason */
  reason?: string;
  /** Feedback message for the agent */
  feedback?: string;
  /** Rule name for debugging */
  name?: string;
}

export interface PolicyDefinition {
  /** Policy name */
  name: string;
  /** Policy description */
  description?: string;
  /** Whether this policy is enabled */
  enabled?: boolean;
  /** Rules in this policy */
  rules: PolicyRule[];
}

// ─── Pattern Matching ───────────────────────────────────────────────

/**
 * Simple glob matcher supporting * and **
 * - * matches any sequence of non-separator characters
 * - ** matches any sequence of characters including separators
 */
function globMatch(pattern: string, value: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars (except * and ?)
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, ".")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");

  const regex = new RegExp(`^${regexStr}$`, "i");
  return regex.test(value);
}

/** Get a nested field value from an object using dot notation */
function getFieldValue(obj: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Check if a value matches a pattern */
function matchesPattern(value: unknown, pattern: string | string[]): boolean {
  if (value === undefined || value === null) return false;

  const strValue = String(value);
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  return patterns.some((p) => globMatch(p, strValue));
}

// ─── Rule Matching ──────────────────────────────────────────────────

function matchesEvent(rule: PolicyRule, eventName: string): boolean {
  const events = Array.isArray(rule.when) ? rule.when : [rule.when];
  return events.some((e) => {
    if (e === "*") return true;
    return globMatch(e, eventName);
  });
}

function matchesConditions(rule: PolicyRule, event: UnifiedEvent): boolean {
  if (!rule.match || rule.match.length === 0) return true;

  return rule.match.every((condition) => {
    // Look in payload first, then in top-level event fields
    const value =
      getFieldValue(event.payload as Record<string, unknown>, condition.field) ??
      getFieldValue(event as unknown as Record<string, unknown>, condition.field);

    const matched = matchesPattern(value, condition.pattern);
    return condition.negate ? !matched : matched;
  });
}

// ─── Policy Engine ──────────────────────────────────────────────────

export class PolicyEngine {
  private policies: PolicyDefinition[] = [];

  /** Load a policy definition */
  loadPolicy(policy: PolicyDefinition): void {
    if (policy.enabled === false) return;
    this.policies.push(policy);
  }

  /** Load multiple policies */
  loadPolicies(policies: PolicyDefinition[]): void {
    for (const p of policies) {
      this.loadPolicy(p);
    }
  }

  /** Remove a policy by name */
  unloadPolicy(name: string): void {
    this.policies = this.policies.filter((p) => p.name !== name);
  }

  /** Get all loaded policies */
  getPolicies(): readonly PolicyDefinition[] {
    return this.policies;
  }

  /**
   * Evaluate an event against all loaded policies.
   * Returns the first matching rule's action, or allow if no rules match.
   */
  evaluate(event: UnifiedEvent): HookResultType {
    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        if (!matchesEvent(rule, event.name)) continue;
        if (!matchesConditions(rule, event)) continue;

        // Rule matched — produce a result
        switch (rule.action) {
          case "deny":
            return HookResult.deny(
              rule.reason ?? `Blocked by policy rule: ${rule.name ?? "unnamed"}`,
              rule.feedback ?? `Action denied by policy: ${policy.name}`,
            );
          case "warn":
            return HookResult.warn(
              rule.reason ?? `Warning from policy rule: ${rule.name ?? "unnamed"}`,
              rule.feedback ?? `Warning from policy: ${policy.name}`,
            );
          case "retry":
            return HookResult.retry(
              rule.reason ?? `Retry requested by policy rule: ${rule.name ?? "unnamed"}`,
              rule.feedback ?? `Please retry. Policy: ${policy.name}`,
            );
          case "trace":
            // trace = allow but mark for tracing
            return HookResult.allow({
              traced: true,
              tracePolicy: policy.name,
              traceRule: rule.name,
            });
          case "allow":
          default:
            return HookResult.allow({
              allowedBy: rule.name ?? policy.name,
            });
        }
      }
    }

    // No rules matched — default allow
    return HookResult.allow();
  }

  /**
   * Convert this policy engine into a HookHandler.
   * This is the bridge between declarative policies and the hook system.
   */
  toHookHandler(): HookHandler {
    return (event: UnifiedEvent) => this.evaluate(event);
  }

  /**
   * Get all rules that would match a given event (without executing them).
   * Useful for debugging and dry-run analysis.
   */
  dryRun(event: UnifiedEvent): Array<{
    policy: string;
    rule: string;
    action: PolicyAction;
  }> {
    const matches: Array<{
      policy: string;
      rule: string;
      action: PolicyAction;
    }> = [];

    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        if (matchesEvent(rule, event.name) && matchesConditions(rule, event)) {
          matches.push({
            policy: policy.name,
            rule: rule.name ?? "unnamed",
            action: rule.action,
          });
        }
      }
    }

    return matches;
  }
}
