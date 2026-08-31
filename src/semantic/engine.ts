/**
 * Semantic Hook Engine
 *
 * Orchestrates semantic hooks and integrates with policy engine.
 *
 * Architecture overview:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  AgentRuntime                                                │
 * │    └── hook pipeline                                         │
 * │          ├── custom hooks (user-registered)                  │
 * │          ├── PolicyEngine (declarative YAML / TS rules)      │
 * │          └── SemanticHookAdapter ← SemanticRuleEngine        │
 * │                                   ├── built-in rules         │
 * │                                   ├── agent.md rules         │
 * │                                   └── user YAML rules        │
 * └──────────────────────────────────────────────────────────────┘
 *
 * The `SemanticHookEngine` class combines:
 *   • `SemanticRuleEngine` — the multi-dimensional matching engine
 *   • Legacy `SemanticHook` interface — for backward compatibility
 *
 * The bridge to the core hook pipeline is `SemanticHookAdapter`,
 * which converts `SemanticRuleEngine` decisions into `HookResult`.
 */

import type { SemanticHook, SemanticContext, SemanticMatch, SemanticDecision, ExtractedRule, TechStack } from './types.js';
import { generateHookFromRule, generateTechStackHooks, saveHooksToFile } from './hook-generator.js';
import { detectTechStack } from './tech-stack-detector.js';
import { scanProjectRules } from './agent-md-scanner.js';
import { SemanticRuleEngine, type SemanticRule } from './rule-engine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Semantic hook engine
 *
 * Unified facade that combines:
 *   1. `SemanticRuleEngine` — the multi-dimensional rule matcher
 *   2. Legacy `SemanticHook` interface — per-hook detect/evaluate
 *
 * Prefer adding rules via `addRule()` / `addRules()` (which delegates
 * to `SemanticRuleEngine`) over the legacy `register(hook)` API.
 */
export class SemanticHookEngine {
  private hooks: Map<string, SemanticHook> = new Map();
  private enabled: boolean = true;

  /** The underlying multi-dimensional rule engine */
  readonly ruleEngine: SemanticRuleEngine;

  constructor(loadBuiltIn = true) {
    this.ruleEngine = new SemanticRuleEngine(loadBuiltIn);
  }

  // ─── Rule-based API (preferred) ─────────────────────────────────

  /** Add a semantic rule (delegates to SemanticRuleEngine) */
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

  /** Get all rules */
  getRules(): SemanticRule[] {
    return this.ruleEngine.getRules();
  }

  // ─── Legacy SemanticHook API (backward compatible) ──────────────

  /**
   * Register a legacy SemanticHook.
   * @deprecated Prefer addRule() for new code.
   */
  register(hook: SemanticHook): void {
    this.hooks.set(hook.name, hook);
  }

  /**
   * Unregister a legacy SemanticHook.
   * @deprecated Prefer removeRule() for new code.
   */
  unregister(name: string): void {
    this.hooks.delete(name);
  }

  /** Get all registered legacy hooks */
  getHooks(): SemanticHook[] {
    return Array.from(this.hooks.values());
  }

  /** Get legacy hooks by source */
  getHooksBySource(source: SemanticHook['source']): SemanticHook[] {
    return this.getHooks().filter(h => h.source === source);
  }

  /** Enable/disable the entire engine */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ─── Evaluation ─────────────────────────────────────────────────

  /**
   * Evaluate all hooks and rules against a context.
   * Returns decisions from both the rule engine and legacy hooks.
   */
  async evaluate(context: SemanticContext): Promise<SemanticDecision[]> {
    if (!this.enabled) {
      return [];
    }

    const decisions: SemanticDecision[] = [];

    // 1. Evaluate semantic rules (multi-dimensional)
    const ruleDecision = this.ruleEngine.resolve(context);
    if (ruleDecision) {
      decisions.push(ruleDecision);
    }

    // 2. Evaluate legacy hooks
    for (const hook of this.hooks.values()) {
      try {
        const match = await hook.detect(context);
        if (match) {
          const decision = await hook.evaluate(match, context);
          decisions.push(decision);
        }
      } catch (error) {
        console.error(`Semantic hook ${hook.name} failed:`, error);
      }
    }

    return decisions;
  }

  /**
   * Get the most restrictive decision from a list of decisions.
   */
  resolveDecisions(decisions: SemanticDecision[]): SemanticDecision | null {
    if (decisions.length === 0) {
      return null;
    }

    // Priority: deny > modify > warn > allow
    const priority = { deny: 0, modify: 1, warn: 2, allow: 3 };

    return decisions.reduce((most, current) => {
      return priority[current.action] < priority[most.action] ? current : most;
    });
  }

  // ─── Project Initialization ─────────────────────────────────────

  /**
   * Initialize hooks from project.
   * Detects tech stack and scans agent.md for rules.
   */
  async initializeFromProject(projectRoot: string): Promise<void> {
    // Detect tech stack
    const techStack = await detectTechStack(projectRoot);

    // Generate tech stack hooks (legacy interface)
    const techHooks = generateTechStackHooks(techStack);
    for (const hook of techHooks) {
      this.register(hook);
    }

    // Scan for agent.md rules
    const rules = await scanProjectRules(projectRoot);

    // Generate hooks from rules (legacy interface)
    for (const rule of rules) {
      const hook = generateHookFromRule(rule);
      this.register(hook);
    }

    // Save hook metadata
    const hooksDir = path.join(projectRoot, '.harness', 'semantic-hooks');
    saveHooksToFile(this.getHooks(), path.join(hooksDir, 'hooks.json'));
  }

  /**
   * Sync hooks with project (re-scan and update).
   */
  async syncWithProject(projectRoot: string): Promise<{
    added: string[];
    removed: string[];
    updated: string[];
  }> {
    const previousHooks = new Set(this.hooks.keys());

    // Clear existing legacy hooks
    this.hooks.clear();

    // Re-initialize
    await this.initializeFromProject(projectRoot);

    const currentHooks = new Set(this.hooks.keys());

    // Calculate diff
    const added = Array.from(currentHooks).filter(h => !previousHooks.has(h));
    const removed = Array.from(previousHooks).filter(h => !currentHooks.has(h));
    const updated = Array.from(currentHooks).filter(h => previousHooks.has(h));

    return { added, removed, updated };
  }
}

/**
 * Create and initialize a semantic hook engine
 */
export async function createSemanticEngine(projectRoot: string): Promise<SemanticHookEngine> {
  const engine = new SemanticHookEngine();
  await engine.initializeFromProject(projectRoot);
  return engine;
}

/**
 * Build a fully-populated SemanticContext from a UnifiedEvent.
 *
 * This is the canonical way to construct the context that is fed
 * into `SemanticRuleEngine.evaluate()` / `.resolve()`.  It extracts
 * every dimension that rules can match on, so rule authors don't
 * have to re-parse event payloads.
 */
export function buildSemanticContext(
  event: any,
  projectRoot: string,
  techStack?: TechStack
): SemanticContext {
  const payload = event.payload || {};

  // ── Extract file_path / file_type ──
  let filePath = '';
  let fileType = '';
  let content = '';

  if (payload.input?.file_path) {
    filePath = payload.input.file_path;
    fileType = filePath.includes('.') ? filePath.split('.').pop() || '' : '';
  } else if (payload.input?.path) {
    filePath = payload.input.path;
    fileType = filePath.includes('.') ? filePath.split('.').pop() || '' : '';
  } else if (payload.filePath) {
    // code.before_modify / code.after_modify
    filePath = payload.filePath;
    fileType = filePath.includes('.') ? filePath.split('.').pop() || '' : '';
  }

  // ── Extract content ──
  if (payload.input?.content) {
    content = String(payload.input.content);
  } else if (payload.incomingContent) {
    content = String(payload.incomingContent);
  }

  // ── Extract command ──
  const command = payload.input?.command ? String(payload.input.command) : '';

  // ── Extract tool name ──
  const toolName = payload.toolName || '';

  // ── Extract MCP info ──
  let mcpServer = '';
  let mcpOperation = '';
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    if (parts.length >= 3) {
      mcpServer = parts[1];
      mcpOperation = parts.slice(2).join('__');
    }
  } else if (toolName.startsWith('mcp_')) {
    const parts = toolName.split('_');
    if (parts.length >= 3) {
      mcpServer = parts[1];
      mcpOperation = parts.slice(2).join('_');
    }
  }
  // Also check direct payload fields (mcp.before / mcp.after)
  if (payload.server) mcpServer = payload.server;
  if (payload.operation) mcpOperation = payload.operation;

  // ── Build code context ──
  const code = filePath
    ? {
        filePath,
        fileType,
        content: content || undefined,
      }
    : undefined;

  // ── Build dimensions ──
  const dimensions = {
    tool_name: toolName,
    file_path: filePath,
    content,
    command,
    mcp_server: mcpServer,
    mcp_operation: mcpOperation,
    file_type: fileType,
  };

  return {
    event,
    code,
    project: {
      root: projectRoot,
      name: path.basename(projectRoot),
      techStack: techStack?.technologies || [],
    },
    dimensions,
  };
}
