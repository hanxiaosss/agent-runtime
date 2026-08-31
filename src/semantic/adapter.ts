/**
 * Semantic Hook Adapter
 *
 * Bridges the SemanticRuleEngine into the core hook pipeline.
 *
 * The adapter implements `HookHandler` — the function signature that
 * `AgentRuntime.processEvent()` calls.  Internally it:
 *
 *   1. Builds a `SemanticContext` from the incoming `UnifiedEvent`
 *   2. Runs the `SemanticRuleEngine` to find matching rules
 *   3. Converts the `SemanticDecision` into a `HookResult`
 *
 * Usage:
 *
 *   import { SemanticHookAdapter } from './semantic/adapter.js';
 *
 *   const adapter = new SemanticHookAdapter(projectRoot);
 *   runtime.on({
 *     events: '*',
 *     handler: adapter.toHookHandler(),
 *     name: 'semantic-rules',
 *     priority: 500,   // between custom hooks (100) and policy engine (1000)
 *   });
 *
 * Or let `AgentRuntime.enableSemanticHooks()` do it for you.
 */

import type { UnifiedEvent } from '../core/event.js';
import { HookResult, type HookHandler, type HookResult as HookResultType } from '../core/hook.js';
import { SemanticRuleEngine, type SemanticRule } from './rule-engine.js';
import { SemanticHookEngine, buildSemanticContext } from './engine.js';
import type { SemanticContext, SemanticDecision, TechStack } from './types.js';

// ─── Adapter Configuration ──────────────────────────────────────────

export interface SemanticAdapterOptions {
  /**
   * Project root — used for resolving relative paths and loading
   * agent.md rules.  Defaults to `process.cwd()`.
   */
  projectRoot?: string;

  /**
   * Whether to load the built-in redline rules.
   * Default: true.
   */
  loadBuiltIn?: boolean;

  /**
   * Pre-detected tech stack.  If omitted the adapter will not
   * auto-detect — call `detectTechStack()` yourself if you need it.
   */
  techStack?: TechStack;

  /**
   * Custom `SemanticRuleEngine` instance.  When provided, the
   * adapter uses it directly instead of creating a new one.
   */
  ruleEngine?: SemanticRuleEngine;

  /**
   * Custom `SemanticHookEngine` instance.  When provided, the
   * adapter registers its legacy hooks alongside the rule engine.
   */
  hookEngine?: SemanticHookEngine;
}

// ─── Adapter ────────────────────────────────────────────────────────

export class SemanticHookAdapter {
  readonly projectRoot: string;
  readonly ruleEngine: SemanticRuleEngine;
  readonly hookEngine: SemanticHookEngine;
  private techStack?: TechStack;

  constructor(options: SemanticAdapterOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.techStack = options.techStack;

    // Reuse provided engines or create new ones
    this.ruleEngine = options.ruleEngine ?? new SemanticRuleEngine(options.loadBuiltIn ?? true);
    this.hookEngine = options.hookEngine ?? new SemanticHookEngine(options.loadBuiltIn ?? true);
  }

  // ─── Rule Management ─────────────────────────────────────────────

  /** Add a semantic rule */
  addRule(rule: SemanticRule): void {
    this.ruleEngine.addRule(rule);
  }

  /** Batch-add semantic rules */
  addRules(rules: SemanticRule[]): void {
    this.ruleEngine.addRules(rules);
  }

  /** Remove a rule by name */
  removeRule(name: string): void {
    this.ruleEngine.removeRule(name);
  }

  /** Enable / disable a rule by name */
  setRuleEnabled(name: string, enabled: boolean): void {
    this.ruleEngine.setRuleEnabled(name, enabled);
  }

  /** Set tech stack (for context enrichment) */
  setTechStack(techStack: TechStack): void {
    this.techStack = techStack;
  }

  // ─── Evaluation ──────────────────────────────────────────────────

  /**
   * Evaluate a unified event against all semantic rules.
   * Returns a `HookResult` suitable for the hook pipeline.
   */
  evaluate(event: UnifiedEvent): HookResultType {
    const ctx = buildSemanticContext(event, this.projectRoot, this.techStack);

    // 1. Multi-dimensional rule engine
    const ruleDecision = this.ruleEngine.resolve(ctx);

    // 2. For now we only use the rule engine result synchronously.
    //    Legacy SemanticHook evaluation is async — handled in
    //    `evaluateAsync()` for callers that need it.

    if (!ruleDecision) {
      return HookResult.allow();
    }

    return decisionToHookResult(ruleDecision);
  }

  /**
   * Async variant — also evaluates legacy SemanticHooks.
   */
  async evaluateAsync(event: UnifiedEvent): Promise<HookResultType> {
    const ctx = buildSemanticContext(event, this.projectRoot, this.techStack);

    // 1. Rule engine (synchronous)
    const ruleDecision = this.ruleEngine.resolve(ctx);

    // 2. Legacy hooks (async)
    const hookDecisions = await this.hookEngine.evaluate(ctx);

    // 3. Merge all decisions
    const all = [...hookDecisions];
    if (ruleDecision) all.push(ruleDecision);

    if (all.length === 0) {
      return HookResult.allow();
    }

    // Pick the most restrictive
    const merged = this.hookEngine.resolveDecisions(all);
    if (!merged) return HookResult.allow();

    return decisionToHookResult(merged);
  }

  // ─── Hook Handler ────────────────────────────────────────────────

  /**
   * Convert this adapter into a `HookHandler` for registration
   * with `AgentRuntime.on()`.
   */
  toHookHandler(): HookHandler {
    return (event: UnifiedEvent) => this.evaluate(event);
  }

  /**
   * Async variant of `toHookHandler()`.
   */
  toAsyncHookHandler(): HookHandler {
    return (event: UnifiedEvent) => this.evaluateAsync(event);
  }
}

// ─── Decision → HookResult ──────────────────────────────────────────

/**
 * Convert a `SemanticDecision` into a core `HookResult`.
 *
 * Mapping:
 *   deny   → HookResult.deny
 *   warn   → HookResult.warn
 *   modify → HookResult.modify (with modifiedPayload)
 *   allow  → HookResult.allow
 */
export function decisionToHookResult(decision: SemanticDecision): HookResultType {
  const metadata: Record<string, unknown> = {
    semantic: true,
    source: 'semantic-rule-engine',
  };

  if (decision.suggestions) {
    metadata.suggestions = decision.suggestions;
  }

  switch (decision.action) {
    case 'deny':
      return HookResult.deny(
        decision.reason || 'Blocked by semantic rule',
        decision.feedback || decision.reason || 'Action denied by semantic rule',
      );

    case 'warn':
      return HookResult.warn(
        decision.reason || 'Warning from semantic rule',
        decision.feedback || decision.reason || 'Warning from semantic rule',
      );

    case 'modify':
      return HookResult.modify(
        decision.reason || 'Input modified by semantic rule',
        decision.feedback || decision.reason || 'Input modified by semantic rule',
        decision.modifiedInput || {},
      );

    case 'allow':
    default:
      return HookResult.allow(metadata);
  }
}
