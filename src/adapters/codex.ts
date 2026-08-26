/**
 * Codex CLI Adapter
 *
 * Codex CLI hook system:
 * - PreToolUse / PostToolUse / Stop
 * - JSON stdin → exit code (no JSON output for decisions)
 * - Does NOT support updatedInput
 * - Supports async hooks (async: true flag in config)
 * - Supports MCP tool hooks via mcp_tool handler type
 *
 * Key differences:
 * - Decision is communicated via exit code only:
 *   - 0 = allow
 *   - 2 = deny (stderr message is shown to agent)
 * - No input rewriting
 * - File tools: shell_write_file, shell_edit_file, create_file
 */

import { BaseAdapter, type BaseHookInput, type BaseHookOutput, pipelineToOutput } from "./base-adapter.js";
import type { EventCapability } from "../core/event.js";
import type { ToolClassifier } from "./base-adapter.js";

// ─── Codex-Specific Types ───────────────────────────────────────────

export interface CodexHookInput extends BaseHookInput {
  /** Codex-specific: async hook flag */
  async?: boolean;
}

// ─── Codex Tool Classifier ──────────────────────────────────────────

const codexClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set([
      "shell_write_file", "shell_edit_file", "create_file",
      "write_file", "edit_file", "file_write",
    ]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    return toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["shell_curl", "fetch", "http_request", "web_fetch"]);
    return apiTools.has(toolName);
  },

  extractFilePath(toolInput: Record<string, unknown>): string | undefined {
    return (
      (toolInput.file_path as string) ??
      (toolInput.path as string) ??
      (toolInput.file as string)
    );
  },

  parseMCPToolName(toolName: string): { server: string; operation: string } | null {
    // Try mcp__server__operation
    let parts = toolName.split("__");
    if (parts.length >= 3) {
      return { server: parts[1], operation: parts.slice(2).join("__") };
    }
    // Try mcp_server_operation
    parts = toolName.split("_");
    if (parts.length >= 3 && parts[0] === "mcp") {
      return { server: parts[1], operation: parts.slice(2).join("_") };
    }
    return null;
  },
};

// ─── Capability Declaration ─────────────────────────────────────────

const CODEX_CAPABILITIES: EventCapability[] = [
  { event: "tool.before", support: "native", note: "PreToolUse hook" },
  { event: "tool.after", support: "native", note: "PostToolUse hook" },
  { event: "code.before_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "code.after_modify", support: "emulated", note: "Detected from file write tools" },
  { event: "mcp.before", support: "emulated", note: "Detected from mcp_ tool prefix" },
  { event: "mcp.after", support: "emulated", note: "Detected from mcp_ tool completion" },
  { event: "api.before", support: "emulated", note: "Detected from shell_curl/fetch tools" },
  { event: "api.after", support: "emulated", note: "Detected from shell_curl/fetch tools" },
  { event: "confirm.before", support: "native", note: "Stop hook" },
  { event: "confirm.after", support: "unsupported", note: "Codex CLI does not have SessionEnd hook" },
  { event: "task.start", support: "unsupported" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "skill.before", support: "unsupported", note: "Codex CLI does not expose skill lifecycle" },
  { event: "skill.after", support: "unsupported" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  constructor() {
    super(codexClassifier);
  }

  getCapabilities(): EventCapability[] {
    return CODEX_CAPABILITIES;
  }

  /**
   * Handle PreToolUse.
   * Codex uses exit codes: 0 = allow, 2 = deny.
   * stderr is shown to the agent as feedback.
   */
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

  /**
   * Get the exit code for this decision.
   * Codex CLI protocol:
   * - 0 = allow
   * - 2 = deny (stderr shown to agent)
   * - other = error (non-blocking)
   */
  static getExitCode(output: BaseHookOutput): number {
    switch (output.decision) {
      case "deny":
        return 2;
      case "warn":
        return 0; // Codex doesn't have warn; allow with stderr message
      case "allow":
      default:
        return 0;
    }
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────

export async function runCodexCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new CodexAdapter();
  adapter.attachRuntime(runtime);

  let output: BaseHookOutput;

  switch (mode) {
    case "pre-tool-use":
      output = await adapter.handlePreToolUse(input);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(CodexAdapter.getExitCode(output));
      break;
    case "post-tool-use":
      await adapter.handlePostToolUse(input);
      process.exit(0);
      break;
    case "stop":
      output = await adapter.handleStop(input);
      if (output.decision === "deny" && output.reason) {
        process.stderr.write(output.reason + "\n");
      }
      process.exit(CodexAdapter.getExitCode(output));
      break;
    default:
      process.exit(1);
  }
}
