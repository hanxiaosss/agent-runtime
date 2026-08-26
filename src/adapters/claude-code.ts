/**
 * Claude Code Adapter
 *
 * Adapts Claude Code's hook system into the unified event model.
 *
 * Claude Code hooks:
 * - PreToolUse: called before tool execution, can deny/allow
 * - PostToolUse: called after tool execution, for observation
 *
 * Claude Code hook protocol:
 * - Input: JSON via stdin with { tool_name, tool_input, ... }
 * - Output: JSON to stdout with { decision, reason?, stopReason? }
 *
 * This adapter provides two modes:
 * 1. Standalone CLI mode: reads hook input from stdin, writes decisions to stdout
 * 2. Embedded mode: can be used programmatically within the runtime
 */

import type { Adapter, EventEmitter } from "../core/runtime.js";
import type { EventCapability } from "../core/event.js";
import { createEventId, createCorrelationId } from "../core/event.js";
import type { PipelineResult } from "../core/hook.js";
import type { AgentRuntime } from "../core/runtime.js";
import type { BaseHookInput } from "./base-adapter.js";

// ─── Claude Code Hook Types ─────────────────────────────────────────

/** Input that Claude Code sends to PreToolUse hooks */
export interface ClaudePreToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

/** Input that Claude Code sends to PostToolUse hooks */
export interface ClaudePostToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
  tool_use_id: string;
}

/** Output format for Claude Code PreToolUse hooks */
export interface ClaudeHookOutput {
  /** "allow" to proceed, "deny" to block */
  decision: "allow" | "deny";
  /** Reason for the decision (shown to the model) */
  reason?: string;
  /** If deny, why the tool was stopped */
  stopReason?: string;
}

// ─── Capability Declaration ─────────────────────────────────────────

const CLAUDE_CODE_CAPABILITIES: EventCapability[] = [
  {
    event: "tool.before",
    support: "native",
    note: "Mapped from Claude Code PreToolUse hook",
  },
  {
    event: "tool.after",
    support: "native",
    note: "Mapped from Claude Code PostToolUse hook",
  },
  {
    event: "code.before_modify",
    support: "emulated",
    note: "Detected when tool is Write/Edit and file path is in input",
  },
  {
    event: "code.after_modify",
    support: "emulated",
    note: "Detected when Write/Edit tool completes",
  },
  {
    event: "mcp.before",
    support: "emulated",
    note: "Detected when tool_name starts with 'mcp__'",
  },
  {
    event: "mcp.after",
    support: "emulated",
    note: "Detected when MCP tool completes",
  },
  {
    event: "task.start",
    support: "unsupported",
    note: "Claude Code does not expose task lifecycle hooks",
  },
  {
    event: "task.before_complete",
    support: "unsupported",
  },
  {
    event: "task.complete",
    support: "unsupported",
  },
];

// ─── Tool Name Mapping ──────────────────────────────────────────────
// Claude Code uses specific tool names. We map them to our semantics.

const FILE_MODIFY_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function isFileModifyTool(toolName: string): boolean {
  return FILE_MODIFY_TOOLS.has(toolName);
}

function isMCPTool(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

function extractFilePath(toolInput: Record<string, unknown>): string | undefined {
  // Claude Code tools use "file_path" or "path" for file operations
  return (toolInput.file_path as string) ?? (toolInput.path as string);
}

function parseMCPToolName(toolName: string): { server: string; operation: string } | null {
  // MCP tools are named like: mcp__server__operation
  const parts = toolName.split("__");
  if (parts.length < 3) return null;
  return {
    server: parts[1],
    operation: parts.slice(2).join("__"),
  };
}

// ─── Adapter Implementation ─────────────────────────────────────────

export class ClaudeCodeAdapter implements Adapter {
  readonly name = "claude-code";
  private emitter: EventEmitter | null = null;
  private correlationId: string;
  private runtime: AgentRuntime | null = null;

  constructor() {
    this.correlationId = createCorrelationId();
  }

  getCapabilities(): EventCapability[] {
    return CLAUDE_CODE_CAPABILITIES;
  }

  /**
   * Attach to a runtime for event processing.
   * In standalone CLI mode, this is not needed — the hook handler
   * processes events directly.
   */
  attachRuntime(runtime: AgentRuntime): void {
    this.runtime = runtime;
  }

  async start(emitter: EventEmitter): Promise<void> {
    this.emitter = emitter;
  }

  async stop(): Promise<void> {
    this.emitter = null;
  }

  // ─── PreToolUse Handler ─────────────────────────────────────────

  /**
   * Handle a PreToolUse hook from Claude Code.
   * This is the main entry point when running as a Claude Code hook.
   *
   * A single tool call may produce multiple unified events:
   * - Always: tool.before
   * - If file-modifying tool: code.before_modify
   * - If MCP tool: mcp.before
   *
   * The most restrictive decision across all events wins.
   *
   * Returns the output to send back to Claude Code.
   */
  async handlePreToolUse(input: BaseHookInput): Promise<ClaudeHookOutput> {
    const timestamp = new Date().toISOString();
    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};

    // 1. Build the list of unified events this tool call produces
    const events: Array<{
      id: string;
      name: string;
      category: string;
      timestamp: string;
      source: string;
      correlationId: string;
      payload: Record<string, unknown>;
    }> = [];

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

    // If it's a file-modifying tool, also emit code.before_modify
    if (isFileModifyTool(toolName)) {
      const filePath = extractFilePath(toolInput);
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
            operation: toolName === "Edit" || toolName === "MultiEdit" ? "edit" : "write",
            incomingContent: toolInput.content as string | undefined,
          },
        });
      }
    }

    // If it's an MCP tool, also emit mcp.before
    if (isMCPTool(toolName)) {
      const mcpInfo = parseMCPToolName(toolName);
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

    // 2. Process all events through runtime
    if (!this.runtime) {
      return { decision: "allow" };
    }

    // Process each event and collect results
    // The most restrictive decision wins
    let finalDecision: "allow" | "deny" = "allow";
    let denyReason: string | undefined;
    let denyStop: string | undefined;

    for (const event of events) {
      const result = await this.runtime.processEvent(event as any);
      const translated = this.translateToClaudeOutput(result);

      if (translated.decision === "deny") {
        finalDecision = "deny";
        denyReason = translated.reason;
        denyStop = translated.stopReason;
        // Once denied, no need to process further events
        break;
      }
    }

    return {
      decision: finalDecision,
      reason: denyReason,
      stopReason: denyStop,
    };
  }

  // ─── PostToolUse Handler ────────────────────────────────────────

  /**
   * Handle a PostToolUse hook from Claude Code.
   * PostToolUse is observation-only — it cannot block.
   *
   * Emits multiple events depending on tool type:
   * - Always: tool.after
   * - If file-modifying tool: code.after_modify
   * - If MCP tool: mcp.after
   */
  async handlePostToolUse(input: BaseHookInput): Promise<void> {
    const timestamp = new Date().toISOString();
    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};

    if (!this.runtime) return;

    // Always emit tool.after
    await this.runtime.processEvent({
      id: createEventId(),
      name: "tool.after" as const,
      category: "tool" as const,
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

    // If file-modifying tool, also emit code.after_modify
    if (isFileModifyTool(toolName)) {
      const filePath = extractFilePath(toolInput);
      if (filePath) {
        await this.runtime.processEvent({
          id: createEventId(),
          name: "code.after_modify" as const,
          category: "code" as const,
          timestamp,
          source: this.name,
          correlationId: this.correlationId,
          payload: {
            filePath,
            operation: toolName === "Edit" || toolName === "MultiEdit" ? "edit" : "write",
            success: true,
          },
        });
      }
    }

    // If MCP tool, also emit mcp.after
    if (isMCPTool(toolName)) {
      const mcpInfo = parseMCPToolName(toolName);
      if (mcpInfo) {
        await this.runtime.processEvent({
          id: createEventId(),
          name: "mcp.after" as const,
          category: "mcp" as const,
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
  }

  // ─── Decision Translation ───────────────────────────────────────

  private translateToClaudeOutput(result: PipelineResult): ClaudeHookOutput {
    switch (result.finalAction) {
      case "deny":
        return {
          decision: "deny",
          reason: result.feedbackMessages.join("; ") || "Blocked by policy",
          stopReason: result.feedbackMessages[0] || "Policy violation",
        };

      case "warn":
        // Claude Code doesn't have a "warn" decision.
        // We allow but include the warning in the reason.
        return {
          decision: "allow",
          reason: result.feedbackMessages.join("; "),
        };

      case "allow":
      case "retry":
      case "modify":
      default:
        return { decision: "allow" };
    }
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────

/**
 * Run the adapter in CLI mode.
 * Reads hook input from stdin, processes it, writes output to stdout.
 *
 * Usage in Claude Code settings:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "",
 *       "hooks": [{ "type": "command", "command": "node adapter.js pre-tool-use" }]
 *     }]
 *   }
 * }
 */
export async function runCLI(args: string[], runtime: AgentRuntime): Promise<void> {
  const mode = args[0]; // "pre-tool-use" or "post-tool-use"

  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  const adapter = new ClaudeCodeAdapter();
  adapter.attachRuntime(runtime);

  if (mode === "pre-tool-use") {
    const output = await adapter.handlePreToolUse(input as BaseHookInput);
    process.stdout.write(JSON.stringify(output));
  } else if (mode === "post-tool-use") {
    await adapter.handlePostToolUse(input as BaseHookInput);
    // PostToolUse doesn't return anything
  } else {
    console.error(`Unknown mode: ${mode}. Use "pre-tool-use" or "post-tool-use".`);
    process.exit(1);
  }
}
