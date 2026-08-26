/**
 * Base Adapter
 *
 * Shared logic for all runtime adapters:
 * - stdin reading (JSON protocol)
 * - Event emission helpers
 * - Decision translation
 * - Capability reporting
 */

import type { Adapter, EventEmitter } from "../core/runtime.js";
import type { AgentRuntime } from "../core/runtime.js";
import type { EventCapability, EventName } from "../core/event.js";
import { createEventId, createCorrelationId } from "../core/event.js";
import type { PipelineResult } from "../core/hook.js";

// ─── Common Hook Input (stdin JSON) ─────────────────────────────────

/**
 * All 5 runtimes send JSON via stdin with these common fields.
 * Runtime-specific adapters extend this with additional fields.
 */
export interface BaseHookInput {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_use_id?: string;
  /** Agent metadata (not all runtimes provide all fields) */
  agent_id?: string;
  agent_type?: string;
  turn_id?: string;
  model?: string;
}

// ─── Common Hook Output ─────────────────────────────────────────────

/**
 * Standard output format for blocking hooks.
 *
 * Runtimes differ in how they consume this:
 * - Claude Code / Qoder: read JSON from stdout
 * - Codex / Copilot / Trae: rely on exit code only
 *
 * The base adapter always produces this structure;
 * subclasses decide how much of it the runtime can consume.
 */
export interface BaseHookOutput {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  /** Input rewriting (only Claude Code / Qoder support this) */
  updatedInput?: Record<string, unknown>;
  /** Inject a system message into the conversation */
  systemMessage?: string;
  /** Suppress the tool's output from the conversation */
  suppressOutput?: boolean;
}

// ─── Decision Translation ───────────────────────────────────────────

/**
 * Convert a pipeline result into a base hook output.
 * Subclasses override to add runtime-specific fields.
 */
export function pipelineToOutput(result: PipelineResult): BaseHookOutput {
  switch (result.finalAction) {
    case "deny":
      return {
        decision: "deny",
        reason: result.feedbackMessages.join("; ") || "Blocked by policy",
      };
    case "warn":
      return {
        decision: "warn",
        reason: result.feedbackMessages.join("; "),
      };
    case "retry":
      return {
        decision: "deny",
        reason: result.feedbackMessages.join("; ") || "Please retry",
      };
    case "allow":
    case "modify":
    default:
      return { decision: "allow" };
  }
}

// ─── Tool Classification ────────────────────────────────────────────
// Common across most runtimes — file-modifying tools and MCP tools.

export interface ToolClassifier {
  isFileModifyTool(toolName: string): boolean;
  isMCPTool(toolName: string): boolean;
  isAPITool(toolName: string): boolean;
  extractFilePath(toolInput: Record<string, unknown>): string | undefined;
  parseMCPToolName(toolName: string): { server: string; operation: string } | null;
}

/**
 * Default classifier based on common tool naming conventions.
 * Most runtimes use similar tool names (Write, Edit, Bash, mcp__*, etc.)
 */
export const defaultClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "Write", "Edit", "MultiEdit", "write_file", "edit_file",
      "create_file", "SearchReplace", "write", "edit",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    return toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["WebFetch", "fetch", "http", "curl", "request"]);
    return apiTools.has(toolName) || toolName.toLowerCase().includes("fetch");
  },

  extractFilePath(toolInput: Record<string, unknown>): string | undefined {
    return (
      (toolInput.file_path as string) ??
      (toolInput.path as string) ??
      (toolInput.filePath as string) ??
      (toolInput.file as string)
    );
  },

  parseMCPToolName(toolName: string): { server: string; operation: string } | null {
    // Try mcp__server__operation first (Claude Code style)
    let parts = toolName.split("__");
    if (parts.length >= 3) {
      return {
        server: parts[1],
        operation: parts.slice(2).join("__"),
      };
    }
    // Try mcp_server_operation (Qoder style)
    parts = toolName.split("_");
    if (parts.length >= 3 && (parts[0] === "mcp")) {
      return {
        server: parts[1],
        operation: parts.slice(2).join("_"),
      };
    }
    return null;
  },
};

// ─── Base Adapter Class ─────────────────────────────────────────────

export abstract class BaseAdapter implements Adapter {
  abstract readonly name: string;
  protected emitter: EventEmitter | null = null;
  protected correlationId: string;
  protected runtime: AgentRuntime | null = null;
  protected classifier: ToolClassifier;

  constructor(classifier: ToolClassifier = defaultClassifier) {
    this.correlationId = createCorrelationId();
    this.classifier = classifier;
  }

  abstract getCapabilities(): EventCapability[];

  async start(emitter: EventEmitter): Promise<void> {
    this.emitter = emitter;
  }

  async stop(): Promise<void> {
    this.emitter = null;
  }

  attachRuntime(runtime: AgentRuntime): void {
    this.runtime = runtime;
  }

  // ─── stdin Reading ──────────────────────────────────────────────

  /**
   * Read JSON input from stdin.
   * All 5 runtimes send hook data as JSON via stdin.
   */
  static async readStdin(timeoutMs: number = 1000): Promise<BaseHookInput> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (chunks.length === 0) {
          reject(new Error("stdin read timeout — no data received"));
        } else {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch (e) {
            reject(new Error(`stdin JSON parse error: ${e}`));
          }
        }
      }, timeoutMs);

      process.stdin.on("data", (chunk) => {
        chunks.push(chunk as Buffer);
      });

      process.stdin.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const text = Buffer.concat(chunks).toString("utf-8");
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error(`stdin JSON parse error: ${e}`));
        }
      });

      process.stdin.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ─── Event Building ─────────────────────────────────────────────

  /**
   * Build unified events from a tool call.
   * A single tool call may produce multiple events:
   * - tool.before (always)
   * - code.before_modify (if file-modifying tool)
   * - mcp.before (if MCP tool)
   * - api.before (if API tool)
   */
  protected buildBeforeEvents(input: BaseHookInput): Array<{
    id: string;
    name: EventName;
    category: string;
    timestamp: string;
    source: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }> {
    const timestamp = new Date().toISOString();
    const events: Array<{
      id: string;
      name: EventName;
      category: string;
      timestamp: string;
      source: string;
      correlationId: string;
      payload: Record<string, unknown>;
    }> = [];

    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};

    // Always emit tool.before
    events.push({
      id: createEventId(),
      name: "tool.before",
      category: "tool",
      timestamp,
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        toolName,
        input: toolInput,
        rawCallId: input.tool_use_id,
      },
    });

    // File modification
    if (this.classifier.isFileModifyTool(toolName)) {
      const filePath = this.classifier.extractFilePath(toolInput);
      if (filePath) {
        events.push({
          id: createEventId(),
          name: "code.before_modify",
          category: "code",
          timestamp,
          source: this.name,
          correlationId: this.correlationId,
          payload: {
            filePath,
            operation: "write",
            incomingContent: toolInput.content as string | undefined,
          },
        });
      }
    }

    // MCP
    if (this.classifier.isMCPTool(toolName)) {
      const mcpInfo = this.classifier.parseMCPToolName(toolName);
      if (mcpInfo) {
        events.push({
          id: createEventId(),
          name: "mcp.before",
          category: "mcp",
          timestamp,
          source: this.name,
          correlationId: this.correlationId,
          payload: {
            server: mcpInfo.server,
            operation: mcpInfo.operation,
            params: toolInput,
          },
        });
      }
    }

    // API
    if (this.classifier.isAPITool(toolName)) {
      events.push({
        id: createEventId(),
        name: "api.before",
        category: "api",
        timestamp,
        source: this.name,
        correlationId: this.correlationId,
        payload: {
          url: (toolInput.url as string) ?? (toolInput.endpoint as string) ?? "",
          method: (toolInput.method as string) ?? "GET",
        },
      });
    }

    return events;
  }

  /**
   * Build after-events from a completed tool call.
   */
  protected buildAfterEvents(input: BaseHookInput): Array<{
    id: string;
    name: EventName;
    category: string;
    timestamp: string;
    source: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }> {
    const timestamp = new Date().toISOString();
    const events: Array<{
      id: string;
      name: EventName;
      category: string;
      timestamp: string;
      source: string;
      correlationId: string;
      payload: Record<string, unknown>;
    }> = [];

    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};

    // Always emit tool.after
    events.push({
      id: createEventId(),
      name: "tool.after",
      category: "tool",
      timestamp,
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        toolName,
        input: toolInput,
        output: input.tool_output,
        rawCallId: input.tool_use_id,
      },
    });

    // File modification
    if (this.classifier.isFileModifyTool(toolName)) {
      const filePath = this.classifier.extractFilePath(toolInput);
      if (filePath) {
        events.push({
          id: createEventId(),
          name: "code.after_modify",
          category: "code",
          timestamp,
          source: this.name,
          correlationId: this.correlationId,
          payload: {
            filePath,
            operation: "write",
            success: true,
          },
        });
      }
    }

    // MCP
    if (this.classifier.isMCPTool(toolName)) {
      const mcpInfo = this.classifier.parseMCPToolName(toolName);
      if (mcpInfo) {
        events.push({
          id: createEventId(),
          name: "mcp.after",
          category: "mcp",
          timestamp,
          source: this.name,
          correlationId: this.correlationId,
          payload: {
            server: mcpInfo.server,
            operation: mcpInfo.operation,
            result: input.tool_output,
          },
        });
      }
    }

    // API
    if (this.classifier.isAPITool(toolName)) {
      events.push({
        id: createEventId(),
        name: "api.after",
        category: "api",
        timestamp,
        source: this.name,
        correlationId: this.correlationId,
        payload: {
          url: (toolInput.url as string) ?? (toolInput.endpoint as string) ?? "",
          method: (toolInput.method as string) ?? "GET",
        },
      });
    }

    return events;
  }

  // ─── Event Processing ───────────────────────────────────────────

  /**
   * Process a list of events through the runtime.
   * Returns the most restrictive pipeline result.
   */
  protected async processEvents(
    events: Array<Record<string, unknown>>,
  ): Promise<PipelineResult | null> {
    if (!this.runtime) return null;

    let mostRestrictive: PipelineResult | null = null;

    for (const event of events) {
      const result = await this.runtime.processEvent(event as any);
      if (!mostRestrictive) {
        mostRestrictive = result;
      } else if (
        this.actionPriority(result.finalAction) >
        this.actionPriority(mostRestrictive.finalAction)
      ) {
        mostRestrictive = result;
      }
      // If denied, short-circuit
      if (result.finalAction === "deny") break;
    }

    return mostRestrictive;
  }

  private actionPriority(action: string): number {
    const priorities: Record<string, number> = {
      allow: 1,
      warn: 2,
      retry: 3,
      modify: 4,
      deny: 5,
    };
    return priorities[action] ?? 0;
  }

  // ─── Abstract Methods ───────────────────────────────────────────

  /**
   * Handle a PreToolUse (before) hook.
   * Subclasses implement this with runtime-specific logic.
   */
  abstract handlePreToolUse(input: BaseHookInput): Promise<BaseHookOutput>;

  /**
   * Handle a PostToolUse (after) hook.
   * Subclasses implement this with runtime-specific logic.
   */
  abstract handlePostToolUse(input: BaseHookInput): Promise<void>;

  /**
   * Handle a Stop / confirm.before hook.
   * Default: emit confirm.before event.
   */
  async handleStop(input: BaseHookInput): Promise<BaseHookOutput> {
    if (!this.runtime) return { decision: "allow" };

    const result = await this.runtime.processEvent({
      id: createEventId(),
      name: "confirm.before" as EventName,
      category: "confirm",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        summary: (input as any).summary ?? (input as any).message,
      },
    });

    return pipelineToOutput(result);
  }
}
