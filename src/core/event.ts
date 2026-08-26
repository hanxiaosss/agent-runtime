/**
 * Unified Event Taxonomy
 *
 * Defines the canonical event types that all Agent Runtimes map into.
 * This is the core abstraction layer — adapters translate runtime-specific
 * hooks into these unified events.
 */

// ─── Event Categories ───────────────────────────────────────────────

export type EventCategory =
  | "task"
  | "skill"
  | "tool"
  | "mcp"
  | "code"
  | "git"
  | "agent"
  | "confirm"
  | "api";

// ─── Event Names ────────────────────────────────────────────────────

export type EventName =
  // Task lifecycle
  | "task.start"
  | "task.before_complete"
  | "task.complete"
  // Skill lifecycle
  | "skill.before"
  | "skill.after"
  // Tool lifecycle
  | "tool.before"
  | "tool.after"
  // MCP lifecycle
  | "mcp.before"
  | "mcp.after"
  // Code modification
  | "code.before_modify"
  | "code.after_modify"
  // Git operations
  | "git.worktree_keep"
  | "git.worktree_undo"
  // Agent lifecycle
  | "agent.start"
  | "agent.stop"
  // Confirmation / completion gate
  | "confirm.before"
  | "confirm.after"
  // API calls (external HTTP)
  | "api.before"
  | "api.after";

// ─── Support Level ──────────────────────────────────────────────────
// Different runtimes have different native capabilities.
// The capability matrix tracks what's actually available.

export type SupportLevel = "native" | "emulated" | "unsupported";

export interface EventCapability {
  event: EventName;
  support: SupportLevel;
  /** Human-readable note about how this event is provided */
  note?: string;
}

// ─── Base Event ─────────────────────────────────────────────────────

export interface BaseEvent {
  /** Unique event id for tracing */
  id: string;
  /** Canonical event name */
  name: EventName;
  /** Event category */
  category: EventCategory;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Which agent runtime emitted this event */
  source: string;
  /** Correlation id — ties events within the same task/session */
  correlationId: string;
  /** Arbitrary payload — each event type extends this */
  payload: Record<string, unknown>;
}

// ─── Concrete Event Types ───────────────────────────────────────────

export interface ToolBeforeEvent extends BaseEvent {
  name: "tool.before";
  category: "tool";
  payload: {
    toolName: string;
    input: Record<string, unknown>;
    /** Optional: the raw runtime-specific tool call id */
    rawCallId?: string;
  };
}

export interface ToolAfterEvent extends BaseEvent {
  name: "tool.after";
  category: "tool";
  payload: {
    toolName: string;
    input: Record<string, unknown>;
    output?: unknown;
    error?: string;
    durationMs?: number;
    rawCallId?: string;
  };
}

export interface CodeBeforeModifyEvent extends BaseEvent {
  name: "code.before_modify";
  category: "code";
  payload: {
    filePath: string;
    operation: "write" | "edit" | "create" | "delete";
    /** Content before modification (if available) */
    previousContent?: string;
    /** Content being written (if available at before stage) */
    incomingContent?: string;
  };
}

export interface CodeAfterModifyEvent extends BaseEvent {
  name: "code.after_modify";
  category: "code";
  payload: {
    filePath: string;
    operation: "write" | "edit" | "create" | "delete";
    /** Content after modification */
    newContent?: string;
    /** Whether the modification was successful */
    success: boolean;
  };
}

export interface TaskStartEvent extends BaseEvent {
  name: "task.start";
  category: "task";
  payload: {
    taskDescription?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface TaskBeforeCompleteEvent extends BaseEvent {
  name: "task.before_complete";
  category: "task";
  payload: {
    summary?: string;
    /** Whether tests were run and passed */
    testPassed?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export interface TaskCompleteEvent extends BaseEvent {
  name: "task.complete";
  category: "task";
  payload: {
    summary?: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  };
}

export interface MCPBeforeEvent extends BaseEvent {
  name: "mcp.before";
  category: "mcp";
  payload: {
    server: string;
    operation: string;
    params?: Record<string, unknown>;
  };
}

export interface MCPAfterEvent extends BaseEvent {
  name: "mcp.after";
  category: "mcp";
  payload: {
    server: string;
    operation: string;
    result?: unknown;
    error?: string;
    durationMs?: number;
  };
}

// ─── Confirmation / Completion Gate Events ──────────────────────────

export interface ConfirmBeforeEvent extends BaseEvent {
  name: "confirm.before";
  category: "confirm";
  payload: {
    /** What the agent is trying to confirm/complete */
    summary?: string;
    /** Whether prerequisites (tests, lint) have passed */
    prerequisitesPassed?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export interface ConfirmAfterEvent extends BaseEvent {
  name: "confirm.after";
  category: "confirm";
  payload: {
    summary?: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  };
}

// ─── API Call Events ────────────────────────────────────────────────

export interface APIBeforeEvent extends BaseEvent {
  name: "api.before";
  category: "api";
  payload: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    metadata?: Record<string, unknown>;
  };
}

export interface APIAfterEvent extends BaseEvent {
  name: "api.after";
  category: "api";
  payload: {
    url: string;
    method: string;
    statusCode?: number;
    error?: string;
    durationMs?: number;
  };
}

// ─── Union Type ─────────────────────────────────────────────────────

export type UnifiedEvent =
  | ToolBeforeEvent
  | ToolAfterEvent
  | CodeBeforeModifyEvent
  | CodeAfterModifyEvent
  | TaskStartEvent
  | TaskBeforeCompleteEvent
  | TaskCompleteEvent
  | MCPBeforeEvent
  | MCPAfterEvent
  | ConfirmBeforeEvent
  | ConfirmAfterEvent
  | APIBeforeEvent
  | APIAfterEvent
  | BaseEvent; // fallback for events not yet typed

// ─── Event Metadata Helpers ─────────────────────────────────────────

/** Extract the category from an event name */
export function getCategory(name: EventName): EventCategory {
  return name.split(".")[0] as EventCategory;
}

/** Create a unique event id */
export function createEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a correlation id for a session/task */
export function createCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
