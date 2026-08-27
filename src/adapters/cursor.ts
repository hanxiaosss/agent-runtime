/**
 * Cursor Agent Adapter
 *
 * Cursor Agent hook system:
 * - PreToolUse / PostToolUse events
 * - JSON stdin → JSON stdout + exit code
 * - Supports updatedInput (input rewriting)
 * - Configuration via .cursor/hooks.json
 *
 * Key characteristics:
 * - Similar to Claude Code but with Cursor-specific tool names
 * - File tools: write_file, edit_file, create_file
 * - MCP tools: mcp__ prefix (double underscore)
 * - Supports both blocking and async hooks
 */

import { BaseAdapter, type BaseHookInput, type BaseHookOutput, pipelineToOutput } from "./base-adapter.js";
import type { EventCapability } from "../core/event.js";
import type { ToolClassifier } from "./base-adapter.js";

// ─── Cursor-Specific Types ──────────────────────────────────────────

export interface CursorHookInput extends BaseHookInput {
  /** Cursor-specific: hook event type */
  hook_event?: "PreToolUse" | "PostToolUse";
  /** Cursor-specific: cursor version */
  cursor_version?: string;
}

export interface CursorHookOutput extends BaseHookOutput {
  /** Cursor supports input rewriting */
  updatedInput?: Record<string, unknown>;
}

// ─── Cursor Tool Classifier ─────────────────────────────────────────

const cursorClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "write_file", "edit_file", "create_file", "replace_file",
      "Write", "Edit", "MultiEdit",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    // Cursor uses mcp__ prefix (double underscore)
    return toolName.startsWith("mcp__");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["fetch", "http_request", "web_fetch", "curl"]);
    return apiTools.has(toolName);
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
    // Cursor: mcp__server__operation
    const parts = toolName.split("__");
    if (parts.length < 3) return null;
    return {
      server: parts[1],
      operation: parts.slice(2).join("__"),
    };
  },
};

// ─── Capability Declaration ─────────────────────────────────────────

const CURSOR_CAPABILITIES: EventCapability[] = [
  { event: "tool.before", support: "native", note: "PreToolUse hook" },
  { event: "tool.after", support: "native", note: "PostToolUse hook" },
  { event: "code.before_modify", support: "emulated", note: "Detected from write_file/edit_file tools" },
  { event: "code.after_modify", support: "emulated", note: "Detected from write_file/edit_file tools" },
  { event: "mcp.before", support: "emulated", note: "Detected from mcp__ tool prefix" },
  { event: "mcp.after", support: "emulated", note: "Detected from mcp__ tool completion" },
  { event: "api.before", support: "emulated", note: "Detected from fetch/curl tools" },
  { event: "api.after", support: "emulated", note: "Detected from fetch/curl tools" },
  { event: "confirm.before", support: "unsupported", note: "Cursor does not have Stop hook" },
  { event: "confirm.after", support: "unsupported" },
  { event: "task.start", support: "unsupported" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "git.worktree_keep", support: "unsupported" },
  { event: "git.worktree_undo", support: "unsupported" },
  { event: "skill.before", support: "unsupported", note: "Cursor does not expose skill lifecycle" },
  { event: "skill.after", support: "unsupported" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class CursorAdapter extends BaseAdapter {
  readonly name = "cursor";

  constructor() {
    super(cursorClassifier);
  }

  getCapabilities(): EventCapability[] {
    return CURSOR_CAPABILITIES;
  }

  /**
   * Handle PreToolUse.
   * Cursor uses JSON stdout + exit code: 0 = allow, 2 = deny.
   */
  async handlePreToolUse(input: BaseHookInput): Promise<CursorHookOutput> {
    const events = this.buildBeforeEvents(input);
    const result = await this.processEvents(events);
    if (!result) return { decision: "allow" };

    const output = pipelineToOutput(result);

    // Cursor supports updatedInput for "modify" actions
    if (result.finalAction === "modify" && result.results.length > 0) {
      const modifyResult = result.results.find((r) => r.result.action === "modify");
      if (modifyResult?.result.modifiedPayload) {
        return {
          ...output,
          decision: "allow",
          updatedInput: modifyResult.result.modifiedPayload,
        };
      }
    }

    return output;
  }

  async handlePostToolUse(input: BaseHookInput): Promise<void> {
    const events = this.buildAfterEvents(input);
    await this.processEvents(events);
  }

  /**
   * Get the exit code for this decision.
   * Cursor protocol:
   * - 0 = allow
   * - 2 = deny (stderr/stdout JSON shown to agent)
   */
  static getExitCode(output: BaseHookOutput): number {
    switch (output.decision) {
      case "deny":
        return 2;
      case "warn":
        return 0; // Cursor doesn't have warn; allow with message
      case "allow":
      default:
        return 0;
    }
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────

export async function runCursorCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new CursorAdapter();
  adapter.attachRuntime(runtime);

  let output: CursorHookOutput;

  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.stdout.write(JSON.stringify(output));
      process.exit(CursorAdapter.getExitCode(output));
      break;
    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      process.exit(0);
      break;
    default:
      process.exit(1);
  }
}
