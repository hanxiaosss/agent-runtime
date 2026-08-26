/**
 * Agent Runtime — Public API
 *
 * A cross-agent-runtime unified event and policy layer for observing,
 * constraining, and providing feedback on AI agent behavior.
 */

// Core
export {
  AgentRuntime,
  type Adapter,
  type EventEmitter,
  type RuntimeConfig,
  type TraceEntry,
} from "./core/runtime.js";

export {
  type UnifiedEvent,
  type BaseEvent,
  type EventName,
  type EventCategory,
  type EventCapability,
  type SupportLevel,
  type ToolBeforeEvent,
  type ToolAfterEvent,
  type CodeBeforeModifyEvent,
  type CodeAfterModifyEvent,
  type TaskStartEvent,
  type TaskBeforeCompleteEvent,
  type TaskCompleteEvent,
  type MCPBeforeEvent,
  type MCPAfterEvent,
  type ConfirmBeforeEvent,
  type ConfirmAfterEvent,
  type APIBeforeEvent,
  type APIAfterEvent,
  createEventId,
  createCorrelationId,
  getCategory,
} from "./core/event.js";

export {
  HookResult,
  type HookAction,
  type HookHandler,
  type HookRegistration,
  type HookResult as HookResultType,
  type PipelineResult,
  resolvePipelineResult,
} from "./core/hook.js";

export {
  PolicyEngine,
  type PolicyDefinition,
  type PolicyRule,
  type PolicyMatch,
  type PolicyAction,
} from "./core/policy.js";

// Adapters
export {
  // Base
  BaseAdapter,
  pipelineToOutput,
  defaultClassifier,
  type BaseHookInput,
  type BaseHookOutput,
  type ToolClassifier,
  // Claude Code
  ClaudeCodeAdapter,
  runClaudeCodeCLI,
  type ClaudePreToolUseInput,
  type ClaudePostToolUseInput,
  type ClaudeHookOutput,
  // Qoder
  QoderAdapter,
  runQoderCLI,
  type QoderHookInput,
  type QoderHookOutput,
  // Codex
  CodexAdapter,
  runCodexCLI,
  type CodexHookInput,
  // Copilot
  CopilotAdapter,
  runCopilotCLI,
  type CopilotHookInput,
  // Trae
  TraeAdapter,
  runTraeCLI,
  type TraeHookInput,
} from "./adapters/index.js";

// Policies
export {
  protectedFilesPolicy,
  mcpSafetyPolicy,
  gitSafetyPolicy,
  qualityGatePolicy,
  allPolicies,
} from "./policies/index.js";

// CLI utilities (for programmatic use)
export {
  loadPolicyFromYAML,
  loadPolicyFromFile,
  loadPoliciesFromDir,
  loadHarnessConfig,
  type HarnessConfig,
} from "./cli/index.js";
