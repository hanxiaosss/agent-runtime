/**
 * Qoder Adapter
 *
 * Qoder's hook system is very similar to Claude Code:
 * - PreToolUse / PostToolUse / UserPromptSubmit / PermissionRequest / Stop / SessionEnd
 * - JSON stdin → JSON stdout + exit code
 * - Supports updatedInput (input rewriting)
 * - Supports async background hooks
 *
 * Key differences from Claude Code:
 * - File-modifying tools: Write, SearchReplace, Bash (for file ops)
 * - MCP tools: start with `mcp_` (single underscore)
 * - Additional events: PermissionRequest, UserPromptSubmit
 */

import { BaseAdapter, type BaseHookInput, type BaseHookOutput, pipelineToOutput } from "./base-adapter.js";
import type { EventCapability } from "../core/event.js";
import type { ToolClassifier } from "./base-adapter.js";

// ─── Qoder-Specific Types ───────────────────────────────────────────

export interface QoderHookInput extends BaseHookInput {
  /** Permission request details (for PermissionRequest event) */
  permission_type?: string;
  permission_details?: Record<string, unknown>;
  /** User prompt (for UserPromptSubmit event) */
  user_message?: string;
}

export interface QoderHookOutput extends BaseHookOutput {
  /** Qoder supports input rewriting */
  updatedInput?: Record<string, unknown>;
  /** Inject system message */
  systemMessage?: string;
}

// ─── Qoder Tool Classifier ──────────────────────────────────────────

const qoderClassifier: ToolClassifier = {
  isFileModifyTool(toolName: string): boolean {
    const fileTools = new Set(["Write", "SearchReplace", "write_file", "edit_file", "create_file"]);
    return fileTools.has(toolName);
  },

  isMCPTool(toolName: string): boolean {
    // Qoder uses single underscore: mcp_server_operation
    return toolName.startsWith("mcp_");
  },

  isAPITool(toolName: string): boolean {
    const apiTools = new Set(["WebFetch", "fetch", "http_request"]);
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
    // Qoder: mcp_server_operation
    const parts = toolName.split("_");
    if (parts.length < 3 || parts[0] !== "mcp") return null;
    return {
      server: parts[1],
      operation: parts.slice(2).join("_"),
    };
  },
};

// ─── Capability Declaration ─────────────────────────────────────────

const QODER_CAPABILITIES: EventCapability[] = [
  { event: "tool.before", support: "native", note: "PreToolUse hook" },
  { event: "tool.after", support: "native", note: "PostToolUse hook" },
  { event: "code.before_modify", support: "emulated", note: "Detected from Write/SearchReplace tools" },
  { event: "code.after_modify", support: "emulated", note: "Detected from Write/SearchReplace tools" },
  { event: "mcp.before", support: "emulated", note: "Detected when tool starts with mcp_" },
  { event: "mcp.after", support: "emulated", note: "Detected when MCP tool completes" },
  { event: "api.before", support: "emulated", note: "Detected from WebFetch tool" },
  { event: "api.after", support: "emulated", note: "Detected from WebFetch tool" },
  { event: "confirm.before", support: "native", note: "Stop hook" },
  { event: "confirm.after", support: "native", note: "SessionEnd hook" },
  { event: "task.start", support: "unsupported" },
  { event: "task.before_complete", support: "unsupported" },
  { event: "task.complete", support: "unsupported" },
  { event: "skill.before", support: "emulated", note: "Detected when tool matches skill set" },
  { event: "skill.after", support: "emulated", note: "Detected when skill tool completes" },
];

// ─── Adapter Implementation ─────────────────────────────────────────

export class QoderAdapter extends BaseAdapter {
  readonly name = "qoder";

  constructor() {
    super(qoderClassifier);
  }

  getCapabilities(): EventCapability[] {
    return QODER_CAPABILITIES;
  }

  async handlePreToolUse(input: BaseHookInput): Promise<QoderHookOutput> {
    const events = this.buildBeforeEvents(input);
    const result = await this.processEvents(events);
    if (!result) return { decision: "allow" };

    const output = pipelineToOutput(result);

    // Qoder supports updatedInput for "modify" actions
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

  async handlePermissionRequest(input: QoderHookInput): Promise<QoderHookOutput> {
    if (!this.runtime) return { decision: "allow" };

    const result = await this.runtime.processEvent({
      id: `evt_${Date.now()}_perm`,
      name: "tool.before",
      category: "tool",
      timestamp: new Date().toISOString(),
      source: this.name,
      correlationId: this.correlationId,
      payload: {
        toolName: `permission:${input.permission_type ?? "unknown"}`,
        input: input.permission_details ?? {},
        permissionRequest: true,
      },
    });

    return pipelineToOutput(result);
  }

  async handleUserPromptSubmit(input: QoderHookInput): Promise<QoderHookOutput> {
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
}

// ─── CLI Entry Point ────────────────────────────────────────────────

export async function runQoderCLI(args: string[], runtime: any): Promise<void> {
  const mode = args[0];
  const input = await BaseAdapter.readStdin();

  const adapter = new QoderAdapter();
  adapter.attachRuntime(runtime);

  let output: QoderHookOutput;

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
    case "permission-request":
      output = await adapter.handlePermissionRequest(input as QoderHookInput);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;
    case "user-prompt-submit":
      output = await adapter.handleUserPromptSubmit(input as QoderHookInput);
      process.stdout.write(JSON.stringify(output));
      process.exit(output.decision === "deny" ? 2 : 0);
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}
