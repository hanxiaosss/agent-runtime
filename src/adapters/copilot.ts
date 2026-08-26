/**
 * Copilot Adapter
 *
 * Copilot hook system:
 * - PreToolUse / PostToolUse / UserPromptSubmit
 * - JSON stdin → exit code only (no JSON stdout)
 * - Does NOT support updatedInput
 * - Does NOT support async hooks
 * - Does NOT support worktree events
 * - Does NOT support PermissionRequest
 *
 * Key differences:
 * - Simplest hook protocol: exit code only
 * - 0 = allow, non-zero = deny
 * - stderr message shown to agent
 * - No FileChanged event (cannot observe file changes outside tool calls)
 */

import { BaseAdapter, type BaseHookInput, type BaseHookOutput, pipelineToOutput } from "./base-adapter.js";
import type { EventCapability } from "../core/event.js";
import type { ToolClassifier } from "./base-adapter.js";

// ─── Copilot-Specific Types ─────────────────────────────────────────

export interface CopilotHookInput extends BaseHookInput {
  /** User message (for UserPromptSubmit) */
  user_message?: string;
}

// ─── Copilot Tool Classifier ────────────────────────────────────────

const copilotClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "write_file", "edit_file", "create_file", "replace_in_file",
      "Write", "Edit", "write", "edit",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    return toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
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
    let parts = toolName.split("__");
    if (parts.length >= 3) {
      return { server: parts[1], operation: parts.slice(2).join("__") };
    }
    parts = toolName.split("_");
    if (parts.length >= 3 && parts[0] === "mcp") {
      return { server: parts[1], operation: parts.slice(2).join("_") };
    }
    return null;
  },
};

// ─── Capability Declaration ─────────────────────────────────────────

const COPILOT_CAPABILITIES: EventCapability[] = [
  { event: "tool.before", support: "native", note: "PreToolUse hook" },
  { event: "tool.after", support: "native", note: "PostToolUse hook" },
  { event: "code.before_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "code.after_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "mcp.before", support: "emulated", note: "Detected from mcp_ tool prefix" },
  { event: "mcp.after", support: "emulated", note: "Detected from mcp_ tool completion" },
  { event: "api.before", support: "emulated", note: "Detected from fetch/curl tools" },
  { event: "api.after", support: "emulated", note: "Detected from fetch/curl tools" },
  { event: "confirm.before", support: "unsupported", note: "Copilot does not have Stop hook" },
  { event: "confirm.after", support: "unsupported" },
  { event: "task.start", support: "unsupported" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "git.worktree_keep", support: "unsupported", note: "Copilot does not support worktree events" },
  { event: "git.worktree_undo", support: "unsupported" },
  { event: "skill.before", support: "unsupported", note: "Copilot does not expose skill lifecycle" },
  { event: "skill.after", support: "unsupported" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class CopilotAdapter extends BaseAdapter {
  readonly name = "copilot";

  constructor() {
    super(copilotClassifier);
  }

  getCapabilities(): EventCapability[] {
    return COPILOT_CAPABILITIES;
  }

  async handlePreToolUse(input: BaseHookInput): Promise<BaseHookOutput> {
    const events = this.buildBeforeEvents(input);
    const result = await this.processEvents(events);
    if (!result) return { decision: "allow" };
    return pipelineToOutput(result);
  }

  async handlePostToolUse(input: BaseHookInput): Promise<void> {
    const events = this.buildAfterEvents(input);
    await this.processEvents(events);
  }

  async handleUserPromptSubmit(input: CopilotHookInput): Promise<BaseHookOutput> {
    if (!this.runtime) return { decision: "allow" };

    const result = await this.runtime.processEvent({
      id: `evt_${Date.now()}_prompt`,
      name: "tool.before",
      category: "tool",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        toolName: "user_prompt",
        input: { message: input.user_message ?? "" },
      },
    });

    return pipelineToOutput(result);
  }

  /**
   * Copilot exit code protocol:
   * - 0 = allow
   * - non-zero = deny (stderr shown to agent)
   */
  static getExitCode(output: BaseHookOutput): number {
    return output.decision === "deny" ? 1 : 0;
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────

export async function runCopilotCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new CopilotAdapter();
  adapter.attachRuntime(runtime);

  let output: BaseHookOutput;

  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(CopilotAdapter.getExitCode(output));
      break;
    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      process.exit(0);
      break;
    case "user-prompt-submit":
      output = await adapter.handleUserPromptSubmit(input as CopilotHookInput);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(CopilotAdapter.getExitCode(output));
      break;
    default:
      process.exit(1);
  }
}
