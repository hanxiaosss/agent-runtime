/**
 * Trae Adapter
 *
 * Trae has the most limited hook system:
 * - PreToolUse / PostToolUse / UserPromptSubmit
 * - Only 6 events total
 * - JSON stdin → exit code only
 * - Does NOT support updatedInput
 * - Does NOT support async hooks
 * - Does NOT support FileChanged / PreCompact
 *
 * Key differences:
 * - Minimal event surface
 * - Exit code protocol like Copilot
 * - No worktree, no permission, no session lifecycle
 */

import { BaseAdapter, type BaseHookInput, type BaseHookOutput, pipelineToOutput } from "./base-adapter.js";
import type { EventCapability } from "../core/event.js";
import type { ToolClassifier } from "./base-adapter.js";

// ─── Trae-Specific Types ────────────────────────────────────────────

export interface TraeHookInput extends BaseHookInput {
  user_message?: string;
}

// ─── Trae Tool Classifier ───────────────────────────────────────────

const traeClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "write_file", "edit_file", "create_file", "replace_in_file",
      "Write", "Edit",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    return toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["fetch", "http_request", "web_fetch"]);
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

const TRAE_CAPABILITIES: EventCapability[] = [
  { event: "tool.before", support: "native", note: "PreToolUse hook" },
  { event: "tool.after", support: "native", note: "PostToolUse hook" },
  { event: "code.before_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "code.after_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "mcp.before", support: "emulated", note: "Detected from mcp_ tool prefix" },
  { event: "mcp.after", support: "emulated", note: "Detected from mcp_ tool completion" },
  { event: "api.before", support: "unsupported", note: "Trae does not expose API tool hooks" },
  { event: "api.after", support: "unsupported" },
  { event: "confirm.before", support: "unsupported", note: "Trae does not have Stop hook" },
  { event: "confirm.after", support: "unsupported" },
  { event: "task.start", support: "unsupported" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "git.worktree_keep", support: "unsupported" },
  { event: "git.worktree_undo", support: "unsupported" },
  { event: "skill.before", support: "unsupported", note: "Trae does not expose skill lifecycle" },
  { event: "skill.after", support: "unsupported" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class TraeAdapter extends BaseAdapter {
  readonly name = "trae";

  constructor() {
    super(traeClassifier);
  }

  getCapabilities(): EventCapability[] {
    return TRAE_CAPABILITIES;
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

  async handleUserPromptSubmit(input: TraeHookInput): Promise<BaseHookOutput> {
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
   * Trae exit code protocol (same as Copilot):
   * - 0 = allow
   * - non-zero = deny
   */
  static getExitCode(output: BaseHookOutput): number {
    return output.decision === "deny" ? 1 : 0;
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────

export async function runTraeCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new TraeAdapter();
  adapter.attachRuntime(runtime);

  let output: BaseHookOutput;

  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(TraeAdapter.getExitCode(output));
      break;
    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      process.exit(0);
      break;
    case "user-prompt-submit":
      output = await adapter.handleUserPromptSubmit(input as TraeHookInput);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(TraeAdapter.getExitCode(output));
      break;
    default:
      process.exit(1);
  }
}
