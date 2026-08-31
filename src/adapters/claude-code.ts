/**
 * Claude Code Adapter
 *
 * Adapts Claude Code's hook system into the unified event model.
 *
 * Claude Code hooks:
 * - PreToolUse:      called before tool execution, can deny/allow/modify
 * - PostToolUse:     called after tool execution, observation only
 * - UserPromptSubmit: called before user prompt is processed, can deny/modify
 * - Stop:            called when agent wants to stop, can deny
 * - Notification:    called when agent emits a notification, observation only
 * - SubagentStop:    called when a sub-agent stops, can deny
 *
 * Claude Code hook protocol:
 * - Input: JSON via stdin with { tool_name, tool_input, ... }
 * - Output: JSON to stdout with { decision, reason?, updatedInput?, ... }
 *
 * This adapter extends BaseAdapter and reuses its event-building logic.
 */

import {
  BaseAdapter,
  pipelineToOutput,
  type BaseHookInput,
  type BaseHookOutput,
  type ToolClassifier,
} from "./base-adapter.js";
import type { EventCapability, EventName } from "../core/event.js";
import { createEventId } from "../core/event.js";
import type { PipelineResult } from "../core/hook.js";

// ─── Claude Code Hook Types ─────────────────────────────────────────

/** Input that Claude Code sends to PreToolUse hooks */
export interface ClaudePreToolUseInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

/** Input that Claude Code sends to PostToolUse hooks */
export interface ClaudePostToolUseInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
  tool_use_id: string;
}

/** Input that Claude Code sends to UserPromptSubmit hooks */
export interface ClaudeUserPromptSubmitInput extends BaseHookInput {
  user_message: string;
}

/** Input that Claude Code sends to Notification hooks */
export interface ClaudeNotificationInput extends BaseHookInput {
  title?: string;
  message: string;
  level?: "info" | "warning" | "error";
}

/** Input that Claude Code sends to SubagentStop hooks */
export interface ClaudeSubagentStopInput extends BaseHookInput {
  subagent_id?: string;
  summary?: string;
  success?: boolean;
}

/** Output format for Claude Code hooks */
export interface ClaudeHookOutput extends BaseHookOutput {
  /** Claude Code supports input rewriting */
  updatedInput?: Record<string, unknown>;
  /** Inject a system message into the conversation */
  systemMessage?: string;
  /** Suppress the tool's output from the conversation */
  suppressOutput?: boolean;
  /** Suggestions for the agent (shown alongside the reason) */
  suggestions?: string[];
}

// ─── Claude Code Tool Classifier ────────────────────────────────────

const claudeCodeClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "Write", "Edit", "MultiEdit",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    // Claude Code uses double underscore: mcp__server__operation
    return toolName.startsWith("mcp__");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["WebFetch", "fetch"]);
    return apiTools.has(toolName);
  },

  extractFilePath(toolInput: Record<string, unknown>): string | undefined {
    return (
      (toolInput.file_path as string) ??
      (toolInput.path as string) ??
      (toolInput.filePath as string)
    );
  },

  parseMCPToolName(toolName: string): { server: string; operation: string } | null {
    // Claude Code: mcp__server__operation
    const parts = toolName.split("__");
    if (parts.length < 3) return null;
    return {
      server: parts[1],
      operation: parts.slice(2).join("__"),
    };
  },
};

// ─── Capability Declaration ─────────────────────────────────────────

const CLAUDE_CODE_CAPABILITIES: EventCapability[] = [
  // Native mappings
  { event: "tool.before", support: "native", note: "Mapped from PreToolUse hook" },
  { event: "tool.after", support: "native", note: "Mapped from PostToolUse hook" },
  { event: "prompt.before", support: "native", note: "Mapped from UserPromptSubmit hook" },
  { event: "confirm.before", support: "native", note: "Mapped from Stop hook" },
  { event: "notification", support: "native", note: "Mapped from Notification hook" },
  { event: "subagent.stop", support: "native", note: "Mapped from SubagentStop hook" },
  // Emulated mappings (inferred from tool names)
  { event: "code.before_modify", support: "emulated", note: "Detected when tool is Write/Edit/MultiEdit" },
  { event: "code.after_modify", support: "emulated", note: "Detected when Write/Edit/MultiEdit completes" },
  { event: "mcp.before", support: "emulated", note: "Detected when tool_name starts with 'mcp__'" },
  { event: "mcp.after", support: "emulated", note: "Detected when MCP tool completes" },
  { event: "api.before", support: "emulated", note: "Detected when tool is WebFetch" },
  { event: "api.after", support: "emulated", note: "Detected when WebFetch completes" },
  // Currently unsupported
  { event: "prompt.after", support: "unsupported", note: "Claude Code does not emit a post-prompt event" },
  { event: "task.start", support: "unsupported", note: "Claude Code does not expose task lifecycle hooks" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "skill.before", support: "emulated", note: "Detected when tool matches skill set" },
  { event: "skill.after", support: "emulated", note: "Detected when skill tool completes" },
  { event: "git.worktree_keep", support: "unsupported" },
  { event: "git.worktree_undo", support: "unsupported" },
  { event: "agent.start", support: "unsupported" },
  { event: "agent.stop", support: "unsupported" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly name = "claude-code";

  constructor() {
    super(claudeCodeClassifier);
  }

  getCapabilities(): EventCapability[] {
    return CLAUDE_CODE_CAPABILITIES;
  }

  // ─── PreToolUse ──────────────────────────────────────────────────

  /**
   * Handle a PreToolUse hook from Claude Code.
   * A single tool call may produce multiple unified events:
   * - tool.before (always)
   * - code.before_modify (if file-modifying tool)
   * - mcp.before (if MCP tool)
   * - api.before (if API tool)
   *
   * The most restrictive decision across all events wins.
   */
  async handlePreToolUse(input: BaseHookInput): Promise<ClaudeHookOutput> {
    const events = this.buildBeforeEvents(input);
    const result = await this.processEvents(events);
    if (!result) return { decision: "allow" };

    const output = pipelineToOutput(result) as ClaudeHookOutput;

    // Claude Code supports updatedInput for "modify" actions
    if (result.finalAction === "modify" && result.results.length > 0) {
      const modifyResult = result.results.find((r) => r.result.action === "modify");
      if (modifyResult?.result.modifiedPayload) {
        // Merge modified payload with original input so Claude Code gets
        // the full rewritten tool_input
        const originalInput = input.tool_input ?? {};
        return {
          ...output,
          decision: "allow",
          updatedInput: { ...originalInput, ...modifyResult.result.modifiedPayload },
        };
      }
    }

    return output;
  }

  // ─── PostToolUse ─────────────────────────────────────────────────

  /**
   * Handle a PostToolUse hook from Claude Code.
   * PostToolUse is observation-only — it cannot block.
   */
  async handlePostToolUse(input: BaseHookInput): Promise<void> {
    const events = this.buildAfterEvents(input);
    await this.processEvents(events);
  }

  // ─── UserPromptSubmit ────────────────────────────────────────────

  /**
   * Handle a UserPromptSubmit hook from Claude Code.
   * This fires BEFORE the user's prompt is sent to the model.
   * It is blockable — can deny or modify the prompt.
   */
  async handleUserPromptSubmit(input: BaseHookInput): Promise<ClaudeHookOutput> {
    const userMessage =
      (input as any).user_message ??
      (input as any).prompt ??
      (input as any).message ??
      "";

    if (!this.runtime) return { decision: "allow" };

    const result = await this.runtime.processEvent({
      id: createEventId(),
      name: "prompt.before" as EventName,
      category: "prompt",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        userMessage,
        sessionId: input.session_id,
        rawInput: input,
      },
    });

    return pipelineToOutput(result) as ClaudeHookOutput;
  }

  // ─── Notification ────────────────────────────────────────────────

  /**
   * Handle a Notification hook from Claude Code.
   * Observation-only — emits a notification event for tracing.
   */
  async handleNotification(input: BaseHookInput): Promise<void> {
    if (!this.runtime) return;

    await this.runtime.processEvent({
      id: createEventId(),
      name: "notification" as EventName,
      category: "notification",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        title: (input as any).title,
        message: (input as any).message ?? (input as any).content ?? "",
        level: (input as any).level ?? "info",
      },
    });
  }

  // ─── SubagentStop ────────────────────────────────────────────────

  /**
   * Handle a SubagentStop hook from Claude Code.
   * Fires when a sub-agent is about to stop. Blockable.
   */
  async handleSubagentStop(input: BaseHookInput): Promise<ClaudeHookOutput> {
    if (!this.runtime) return { decision: "allow" };

    const result = await this.runtime.processEvent({
      id: createEventId(),
      name: "subagent.stop" as EventName,
      category: "agent",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        subagentId: (input as any).subagent_id ?? (input as any).agent_id,
        summary: (input as any).summary ?? (input as any).message,
        success: (input as any).success,
      },
    });

    return pipelineToOutput(result) as ClaudeHookOutput;
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
 *     }],
 *     "UserPromptSubmit": [{
 *       "matcher": "",
 *       "hooks": [{ "type": "command", "command": "node adapter.js user-prompt-submit" }]
 *     }]
 *   }
 * }
 */
export async function runCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new ClaudeCodeAdapter();
  adapter.attachRuntime(runtime);

  let output: ClaudeHookOutput;

  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      process.exit(0);
      break;

    case "stop":
      output = await adapter.handleStop(input);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    case "user-prompt-submit":
      output = await adapter.handleUserPromptSubmit(input);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    case "notification":
      await adapter.handleNotification(input);
      // Notification is observation-only — no output, no blocking
      process.exit(0);
      break;

    case "subagent-stop":
      output = await adapter.handleSubagentStop(input);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;

    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}
