// Base
export { BaseAdapter, pipelineToOutput, defaultClassifier } from "./base-adapter.js";
export type { BaseHookInput, BaseHookOutput, ToolClassifier } from "./base-adapter.js";

// Claude Code
export { ClaudeCodeAdapter, runCLI as runClaudeCodeCLI } from "./claude-code.js";
export type {
  ClaudePreToolUseInput,
  ClaudePostToolUseInput,
  ClaudeUserPromptSubmitInput,
  ClaudeNotificationInput,
  ClaudeSubagentStopInput,
  ClaudeHookOutput,
} from "./claude-code.js";

// Qoder
export { QoderAdapter, runQoderCLI } from "./qoder.js";
export type { QoderHookInput, QoderHookOutput } from "./qoder.js";

// Codex CLI
export { CodexAdapter, runCodexCLI } from "./codex.js";
export type { CodexHookInput } from "./codex.js";

// Copilot
export { CopilotAdapter, runCopilotCLI } from "./copilot.js";
export type { CopilotHookInput } from "./copilot.js";

// Trae
export { TraeAdapter, runTraeCLI } from "./trae.js";
export type { TraeHookInput } from "./trae.js";

// Hook Adapter V2
export { HookAdapterV2, type HookCapabilities, type HookExecutionContext } from "./hook-adapter-v2.js";
export { CodexAdapterV2 } from "./codex-adapter-v2.js";
export { CopilotAdapterV2 } from "./copilot-adapter-v2.js";
export { ClaudeCodeAdapterV2 } from "./claude-code-adapter-v2.js";
export { QoderAdapterV2 } from "./qoder-adapter-v2.js";
export { TraeAdapterV2 } from "./trae-adapter-v2.js";

// Cursor
export { CursorAdapter, runCursorCLI } from "./cursor.js";
export type { CursorHookInput, CursorHookOutput } from "./cursor.js";
