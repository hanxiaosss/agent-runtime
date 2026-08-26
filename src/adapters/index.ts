// Base
export { BaseAdapter, pipelineToOutput, defaultClassifier } from "./base-adapter.js";
export type { BaseHookInput, BaseHookOutput, ToolClassifier } from "./base-adapter.js";

// Claude Code
export { ClaudeCodeAdapter, runCLI as runClaudeCodeCLI } from "./claude-code.js";
export type {
  ClaudePreToolUseInput,
  ClaudePostToolUseInput,
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
