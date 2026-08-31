/**
 * Agent Runtime Engine
 *
 * The central runtime that connects adapters, hooks, and policies.
 * It receives events from adapters, runs them through the hook pipeline,
 * and returns decisions back to the adapter.
 */

import type { UnifiedEvent, EventCapability, SupportLevel } from "./event.js";
import { createEventId, createCorrelationId, getCategory } from "./event.js";
import {
  type HookHandler,
  type HookRegistration,
  type HookResult,
  type PipelineResult,
  resolvePipelineResult,
} from "./hook.js";
import { PolicyEngine, type PolicyDefinition } from "./policy.js";
import type { SemanticRule } from "../semantic/types.js";

// ─── Adapter Interface ──────────────────────────────────────────────

/**
 * Every Agent Runtime adapter must implement this interface.
 * It defines how the adapter:
 * 1. Reports its capabilities (which events it can produce)
 * 2. Starts listening for events
 * 3. Translates runtime-specific hooks into unified events
 */
export interface Adapter {
  /** Unique adapter name (e.g., "claude-code", "codex") */
  readonly name: string;

  /** Report which events this adapter can produce */
  getCapabilities(): EventCapability[];

  /**
   * Start the adapter. The adapter should begin emitting events
   * through the provided emitter callback.
   */
  start(emitter: EventEmitter): void | Promise<void>;

  /** Stop the adapter and clean up resources */
  stop(): void | Promise<void>;
}

/** Callback for adapters to emit unified events */
export type EventEmitter = (event: UnifiedEvent) => void;

// ─── Runtime Configuration ──────────────────────────────────────────

export interface RuntimeConfig {
  /** Whether to log events and decisions to console */
  debug?: boolean;
  /** Maximum number of events to keep in history */
  maxHistory?: number;
}

// ─── Trace Entry ────────────────────────────────────────────────────

export interface TraceEntry {
  event: UnifiedEvent;
  pipelineResult: PipelineResult;
  timestamp: number;
}

// ─── Runtime Engine ─────────────────────────────────────────────────

export class AgentRuntime {
  private adapters: Map<string, Adapter> = new Map();
  private hooks: HookRegistration[] = [];
  private policyEngine: PolicyEngine;
  private trace: TraceEntry[] = [];
  private config: Required<RuntimeConfig>;
  private running = false;
  private correlationId: string;

  /**
   * Semantic hook adapter — lazily created when `enableSemanticHooks()`
   * is called.  When present, it is auto-registered into the hook
   * pipeline during `start()`.
   */
  private semanticAdapter: import("../semantic/adapter.js").SemanticHookAdapter | null = null;

  constructor(config: RuntimeConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      maxHistory: config.maxHistory ?? 1000,
    };
    this.policyEngine = new PolicyEngine();
    this.correlationId = createCorrelationId();
  }

  // ─── Adapter Management ─────────────────────────────────────────

  /** Register an adapter */
  registerAdapter(adapter: Adapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
    this.log(`[runtime] Adapter registered: ${adapter.name}`);
  }

  /** Get all registered adapters */
  getAdapters(): Adapter[] {
    return [...this.adapters.values()];
  }

  /** Get the capability matrix across all adapters */
  getCapabilityMatrix(): Map<string, EventCapability[]> {
    const matrix = new Map<string, EventCapability[]>();
    for (const [name, adapter] of this.adapters) {
      matrix.set(name, adapter.getCapabilities());
    }
    return matrix;
  }

  // ─── Policy Management ──────────────────────────────────────────

  /** Load a policy */
  loadPolicy(policy: PolicyDefinition): void {
    this.policyEngine.loadPolicy(policy);
    this.log(`[runtime] Policy loaded: ${policy.name} (${policy.rules.length} rules)`);
  }

  /** Get the policy engine for direct access */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  // ─── Hook Management ────────────────────────────────────────────

  /** Register a hook handler */
  on(registration: HookRegistration): void {
    this.hooks.push({
      ...registration,
      priority: registration.priority ?? 100,
    });
    // Sort by priority (lower = first)
    this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    this.log(
      `[runtime] Hook registered: ${registration.name ?? "anonymous"} → [${
        Array.isArray(registration.events)
          ? registration.events.join(", ")
          : registration.events
      }]`,
    );
  }

  /** Register a hook for a specific event */
  onEvent(
    events: string | string[],
    handler: HookHandler,
    name?: string,
  ): void {
    this.on({ events, handler, name });
  }

  // ─── Semantic Hook Integration ────────────────────────────────────

  /**
   * Enable the semantic hook system.
   *
   * This creates a `SemanticHookAdapter` (if not already created),
   * registers it into the hook pipeline at priority 500 (between
   * custom hooks at 100 and the policy engine at 1000), and
   * optionally loads agent.md rules from the project.
   *
   * @param projectRoot  Project root for agent.md scanning.
   *                     Defaults to `process.cwd()`.
   * @param options      Additional adapter options.
   */
  async enableSemanticHooks(
    projectRoot?: string,
    options?: {
      loadBuiltIn?: boolean;
      loadAgentMd?: boolean;
    },
  ): Promise<void> {
    // Dynamic import to avoid circular dependency at module load time
    const { SemanticHookAdapter } = await import("../semantic/adapter.js");

    if (!this.semanticAdapter) {
      this.semanticAdapter = new SemanticHookAdapter({
        projectRoot,
        loadBuiltIn: options?.loadBuiltIn ?? true,
      });
    }

    // Optionally scan agent.md for rules
    if (options?.loadAgentMd !== false && projectRoot) {
      try {
        const { scanProjectRules } = await import("../semantic/agent-md-scanner.js");
        const { generateSemanticRulesFromExtracted } = await import("../semantic/hook-generator.js");
        const extracted = await scanProjectRules(projectRoot);
        const rules = generateSemanticRulesFromExtracted(extracted);
        this.semanticAdapter.addRules(rules);
        this.log(`[runtime] Loaded ${rules.length} rules from agent.md`);
      } catch (err) {
        this.log(`[runtime] Failed to load agent.md rules: ${err}`);
      }
    }

    // Register into the hook pipeline (idempotent)
    const existingIdx = this.hooks.findIndex((h) => h.name === "semantic-rules");
    if (existingIdx >= 0) {
      this.hooks.splice(existingIdx, 1);
    }

    this.on({
      events: "*",
      handler: this.semanticAdapter.toHookHandler(),
      name: "semantic-rules",
      priority: 500,
    });

    this.log("[runtime] Semantic hooks enabled ✓");
  }

  /**
   * Add a semantic rule at runtime.
   * Calls `enableSemanticHooks()` automatically if not yet enabled.
   */
  async addSemanticRule(rule: SemanticRule): Promise<void> {
    if (!this.semanticAdapter) {
      await this.enableSemanticHooks();
    }
    this.semanticAdapter!.addRule(rule);
  }

  /** Get the semantic adapter (null if not enabled) */
  getSemanticAdapter(): import("../semantic/adapter.js").SemanticHookAdapter | null {
    return this.semanticAdapter;
  }

  // ─── Event Processing ───────────────────────────────────────────

  /**
   * Process a unified event through the hook pipeline.
   * This is the core execution path.
   */
  async processEvent(event: UnifiedEvent): Promise<PipelineResult> {
    this.log(`[runtime] Event: ${event.name} (source: ${event.source})`);

    // 1. Run custom hook handlers
    const hookResults: Array<{ hookName: string; result: HookResult }> = [];

    for (const registration of this.hooks) {
      const events = Array.isArray(registration.events)
        ? registration.events
        : [registration.events];

      const matches = events.some((e) => {
        if (e === "*") return true;
        if (e === event.name) return true;
        // Support category matching: "tool.*" matches "tool.before"
        if (e.endsWith(".*")) {
          const prefix = e.slice(0, -2);
          return event.name.startsWith(prefix + ".");
        }
        return false;
      });

      if (!matches) continue;

      try {
        const result = await registration.handler(event);
        hookResults.push({
          hookName: registration.name ?? "anonymous",
          result,
        });
        this.log(
          `  → Hook [${registration.name ?? "anonymous"}]: ${result.action}` +
            (result.feedback ? ` — ${result.feedback}` : ""),
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.log(`  → Hook [${registration.name ?? "anonymous"}] ERROR: ${errorMsg}`);
        hookResults.push({
          hookName: registration.name ?? "anonymous",
          result: {
            action: "warn",
            reason: "hook_error",
            feedback: `Hook error: ${errorMsg}`,
          },
        });
      }
    }

    // 2. Policy engine runs as a registered hook (see start())
    // No need to call it again here — it's already in the hook pipeline.

    // 3. Resolve pipeline
    const pipelineResult = resolvePipelineResult(hookResults);

    // 4. Record trace
    this.trace.push({
      event,
      pipelineResult,
      timestamp: Date.now(),
    });

    // Trim history
    if (this.trace.length > this.config.maxHistory) {
      this.trace = this.trace.slice(-this.config.maxHistory);
    }

    this.log(
      `  → Final: ${pipelineResult.finalAction}` +
        (pipelineResult.feedbackMessages.length > 0
          ? ` (${pipelineResult.feedbackMessages.length} messages)`
          : ""),
    );

    return pipelineResult;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /** Start all registered adapters */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Runtime is already running");
    }

    this.log(`[runtime] Starting with ${this.adapters.size} adapter(s)...`);

    // Auto-register policy engine as a hook
    this.on({
      events: "*",
      handler: this.policyEngine.toHookHandler(),
      name: "policy-engine",
      priority: 1000, // Run after custom hooks
    });

    // Start all adapters
    for (const [name, adapter] of this.adapters) {
      this.log(`[runtime] Starting adapter: ${name}`);
      await adapter.start((event) => {
        // Fire-and-forget event processing
        // Adapters emit events; the runtime processes them async
        this.processEvent(event).catch((err) => {
          this.log(`[runtime] Error processing event: ${err}`);
        });
      });
    }

    this.running = true;
    this.log("[runtime] Started ✓");
  }

  /** Stop all adapters */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.log("[runtime] Stopping...");

    for (const [name, adapter] of this.adapters) {
      this.log(`[runtime] Stopping adapter: ${name}`);
      await adapter.stop();
    }

    this.running = false;
    this.log("[runtime] Stopped ✓");
  }

  // ─── Trace & Observability ──────────────────────────────────────

  /** Get the event trace */
  getTrace(): readonly TraceEntry[] {
    return this.trace;
  }

  /** Get trace entries filtered by event name */
  getTraceByEvent(eventName: string): TraceEntry[] {
    return this.trace.filter((t) => t.event.name === eventName);
  }

  /** Get trace entries filtered by final action */
  getTraceByAction(action: string): TraceEntry[] {
    return this.trace.filter(
      (t) => t.pipelineResult.finalAction === action,
    );
  }

  /** Clear the trace */
  clearTrace(): void {
    this.trace = [];
  }

  /** Format the trace as a readable timeline */
  formatTimeline(): string {
    if (this.trace.length === 0) return "(empty trace)";

    const lines: string[] = [];
    lines.push("Agent Runtime Trace");
    lines.push("─".repeat(50));

    for (const entry of this.trace) {
      const time = new Date(entry.event.timestamp).toISOString().slice(11, 23);
      const action = entry.pipelineResult.finalAction.toUpperCase();
      const source = entry.event.source;

      lines.push(`${time} [${action.padEnd(5)}] ${entry.event.name}`);
      lines.push(`         source: ${source}`);

      // Show payload summary
      const payload = entry.event.payload as Record<string, unknown>;
      if (payload.toolName) lines.push(`         tool: ${payload.toolName}`);
      if (payload.filePath) lines.push(`         file: ${payload.filePath}`);
      if (payload.server) lines.push(`         server: ${payload.server}`);
      if (payload.operation) lines.push(`         operation: ${payload.operation}`);

      // Show feedback
      if (entry.pipelineResult.feedbackMessages.length > 0) {
        for (const msg of entry.pipelineResult.feedbackMessages) {
          lines.push(`         → ${msg}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  // ─── Internal ───────────────────────────────────────────────────

  private log(message: string): void {
    if (this.config.debug) {
      console.log(message);
    }
  }
}
