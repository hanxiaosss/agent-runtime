# Universal Agent Hook Adaptation Table

> **Single Source of Truth (SSOT)** for the cross-runtime hook adaptation layer.
>
> This document defines the unified event taxonomy, the capability matrix for each
> agent runtime, the per-event I/O contract, and the per-runtime adapter specification.
> All adapter implementations in `src/adapters/` must conform to this document.

---

## 1. Unified Event Taxonomy

Every agent runtime maps its native hooks into this canonical event set.

| Unified Event | Category | Phase | Blockable | Mode | Description |
|---|---|---|---|---|---|
| `task.start` | task | before | No | async | Agent session / task begins |
| `task.before_complete` | task | before | **Yes** | blocking | Quality gate before agent declares done |
| `task.complete` | task | after | No | async | Task finished |
| `skill.before` | skill | before | **Yes** | blocking | Skill execution starts |
| `skill.after` | skill | after | No | async | Skill execution ends |
| `tool.before` | tool | before | **Yes** | blocking | Any tool invocation |
| `tool.after` | tool | after | No | async | Tool invocation completed |
| `mcp.before` | mcp | before | **Yes** | blocking | MCP server call |
| `mcp.after` | mcp | after | No | async | MCP server call completed |
| `code.before_modify` | code | before | **Yes** | blocking | File write / edit about to happen |
| `code.after_modify` | code | after | No | async | File write / edit completed |
| `git.worktree_keep` | git | after | No | async | Worktree preserved (task kept changes) |
| `git.worktree_undo` | git | after | No | async | Worktree reverted (task undone) |
| `confirm.before` | confirm | before | **Yes** | blocking | Agent about to stop / declare complete |
| `confirm.after` | confirm | after | No | async | Agent session ended |
| `api.before` | api | before | **Yes** | blocking | External HTTP request |
| `api.after` | api | after | No | async | External HTTP request completed |
| `agent.start` | agent | before | No | async | Agent process started |
| `agent.stop` | agent | after | No | async | Agent process stopped |

### Design Rules

1. **`before` events are blockable** — they run in blocking mode and can deny / warn / retry.
2. **`after` events are observational** — they run in async mode and cannot block.
3. **One tool call may produce multiple events** — e.g. a `Write` tool call produces both `tool.before` and `code.before_modify`. The most restrictive decision wins.

---

## 2. Runtime Capability Matrix

| Dimension | Claude Code | Qoder | Codex CLI | Copilot | Trae | Cursor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Native event count** | 30+ | 26 | ~10 | 8 | 6 | 8 |
| **Handler types** | command / http / prompt / agent | command / http / prompt / agent | command / mcp_tool | command | command | command |
| **Input protocol** | JSON stdin | JSON stdin | JSON stdin | JSON stdin | JSON stdin | JSON stdin |
| **Output protocol** | exit code + JSON stdout | exit code + JSON stdout | exit code only | exit code only | exit code only | exit code + JSON stdout |
| **Blockable events** | PreToolUse, UserPromptSubmit, Stop | PreToolUse, UserPromptSubmit, PermissionRequest, Stop | PreToolUse, Stop | PreToolUse, UserPromptSubmit | PreToolUse, UserPromptSubmit | PreToolUse, PostToolUse |
| **Input rewriting** | ✅ `updatedInput` | ✅ `updatedInput` | ❌ | ❌ | ❌ | ✅ `updatedInput` |
| **Async hooks** | ✅ background | ✅ | ✅ `async: true` | ❌ | ❌ | ❌ |
| **Conditional matching** | `toolName` pattern | `toolName` pattern | `toolName` pattern | — | — | `toolName` pattern |
| **System message injection** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Event → Native Mapping

| Unified Event | Claude Code | Qoder | Codex CLI | Copilot | Trae | Cursor |
|---|---|---|---|---|---|---|
| `skill.before` | PreToolUse (tool ∈ skill set) | PreToolUse (tool ∈ skill set) | PreToolUse (tool ∈ skill set) | PreToolUse | PreToolUse | PreToolUse |
| `skill.after` | PostToolUse (tool ∈ skill set) | PostToolUse (tool ∈ skill set) | PostToolUse (tool ∈ skill set) | PostToolUse | PostToolUse | PostToolUse |
| `mcp.before` | PreToolUse (`mcp__*`) | PreToolUse (`mcp_*`) | PreToolUse (`mcp__*` / `mcp_*`) | PreToolUse (`mcp__*`) | PreToolUse (`mcp__*`) | PreToolUse (`mcp__*`) |
| `mcp.after` | PostToolUse (`mcp__*`) | PostToolUse (`mcp_*`) | PostToolUse | PostToolUse | PostToolUse | PostToolUse (`mcp__*`) |
| `code.before_modify` | PreToolUse (Write/Edit/MultiEdit) | PreToolUse (Write/SearchReplace) | PreToolUse (shell_write_file/shell_edit_file) | PreToolUse (write_file/edit_file) | PreToolUse (write_file/edit_file) | PreToolUse (write_file/edit_file/create_file) |
| `code.after_modify` | PostToolUse (Write/Edit) | PostToolUse (Write/SearchReplace) | PostToolUse | PostToolUse | PostToolUse | PostToolUse (write_file/edit_file) |
| `tool.before` | PreToolUse | PreToolUse | PreToolUse | PreToolUse | PreToolUse | PreToolUse |
| `tool.after` | PostToolUse | PostToolUse | PostToolUse | PostToolUse | PostToolUse | PostToolUse |
| `confirm.before` | Stop | Stop | Stop | — | — | — |
| `confirm.after` | SessionEnd | SessionEnd | — | — | — | — |
| `api.before` | PreToolUse (WebFetch/curl) | PreToolUse (WebFetch) | PreToolUse (shell_curl/fetch) | PreToolUse (fetch) | — | PreToolUse (fetch/curl) |
| `api.after` | PostToolUse (WebFetch) | PostToolUse (WebFetch) | PostToolUse | PostToolUse | — | PostToolUse (fetch) |
| `git.worktree_keep` | WorktreeCreate / custom | WorktreeCreate | — | — | — | — |
| `git.worktree_undo` | WorktreeRemove / custom | WorktreeRemove | — | — | — | — |
| `task.start` | — | — | — | — | — | — |
| `task.before_complete` | — | — | — | — | — | — |
| `task.complete` | — | — | — | — | — | — |

### Legend

- **Direct mapping**: The runtime has a native hook that directly corresponds.
- **Emulated**: The runtime does not have a dedicated hook; the adapter infers the event from tool names or other signals.
- **—**: The runtime cannot produce this event at all.

---

## 4. Per-Event I/O Contract

### 4.1 Common Input (stdin JSON)

All runtimes send hook data as JSON via stdin. Common fields:

```jsonc
{
  "session_id":       "string   — unique session identifier",
  "hook_event_name":  "string   — native event name (e.g. PreToolUse)",
  "cwd":              "string   — working directory",
  "tool_name":        "string?  — tool being invoked",
  "tool_input":       "object?  — tool input parameters",
  "tool_output":      "any?     — tool output (PostToolUse only)",
  "tool_use_id":      "string?  — unique tool call identifier",
  "agent_id":         "string?  — agent instance id",
  "agent_type":       "string?  — agent type identifier",
  "turn_id":          "string?  — conversation turn id",
  "model":            "string?  — model name in use"
}
```

### 4.2 Common Output (stdout JSON)

For runtimes that read JSON from stdout (Claude Code, Qoder):

```jsonc
{
  "decision":         "allow | deny | warn",
  "reason":           "string?  — machine-readable reason code",
  "updatedInput":     "object?  — rewritten tool input (Claude Code / Qoder only)",
  "systemMessage":    "string?  — injected into conversation context",
  "suppressOutput":   "boolean? — suppress tool output from conversation"
}
```

### 4.3 Exit Code Protocol

| Exit Code | Meaning | Applies To |
|---|---|---|
| `0` | **pass** — allow the action | All runtimes |
| `2` | **block** — deny the action (stderr/stdout JSON injected into conversation) | Claude Code, Qoder, Codex |
| `1` (other non-zero) | **deny** (Copilot/Trae) or **error** (ignored, non-blocking) | Copilot, Trae |

---

## 5. Per-Runtime Adapter Specification

### 5.1 Claude Code

| Property | Value |
|---|---|
| **Config location** | `~/.claude/settings.json` or `.claude/settings.json` |
| **Hook events** | PreToolUse, PostToolUse, UserPromptSubmit, Stop, Notification, SubagentStop |
| **Handler types** | `command`, `http`, `prompt`, `agent` |
| **Input** | JSON via stdin |
| **Output** | JSON to stdout + exit code |
| **Input rewriting** | ✅ via `updatedInput` field |
| **Async hooks** | ✅ via `background` handler type |
| **Timeout** | 10s (configurable per hook) |
| **Special** | Richest hook system; only runtime with `prompt` and `agent` handler types |

### 5.2 Qoder

| Property | Value |
|---|---|
| **Config location** | `.qoder/settings.json` |
| **Hook events** | PreToolUse, PostToolUse, UserPromptSubmit, PermissionRequest, Stop, SessionEnd |
| **Handler types** | `command`, `http`, `prompt`, `agent` |
| **Input** | JSON via stdin |
| **Output** | JSON to stdout + exit code |
| **Input rewriting** | ✅ via `updatedInput` field |
| **Async hooks** | ✅ |
| **Timeout** | 10s |
| **Special** | Closest to Claude Code; adds PermissionRequest and SessionEnd |

### 5.3 Codex CLI

| Property | Value |
|---|---|
| **Config location** | `.codex/hooks.json` or `codex.json` |
| **Hook events** | PreToolUse, PostToolUse, Stop |
| **Handler types** | `command`, `mcp_tool` |
| **Input** | JSON via stdin |
| **Output** | Exit code only (stderr for feedback) |
| **Input rewriting** | ❌ |
| **Async hooks** | ✅ via `async: true` flag |
| **Timeout** | 10s |
| **Special** | No JSON output; supports `mcp_tool` handler type for MCP-specific hooks |

### 5.4 Copilot

| Property | Value |
|---|---|
| **Config location** | `.github/copilot-settings.json` |
| **Hook events** | PreToolUse, PostToolUse, UserPromptSubmit |
| **Handler types** | `command` |
| **Input** | JSON via stdin |
| **Output** | Exit code only (stderr for feedback) |
| **Input rewriting** | ❌ |
| **Async hooks** | ❌ |
| **Timeout** | 10s |
| **Special** | Most limited of the "big 3"; no worktree, no permission, no session lifecycle |

### 5.5 Trae

| Property | Value |
|---|---|
| **Config location** | `.trae/settings.json` |
| **Hook events** | PreToolUse, PostToolUse, UserPromptSubmit |
| **Handler types** | `command` |
| **Input** | JSON via stdin |
| **Output** | Exit code only (stderr for feedback) |
| **Input rewriting** | ❌ |
| **Async hooks** | ❌ |
| **Timeout** | 10s |
| **Special** | Smallest event surface (6 events); no FileChanged, no PreCompact |

### 5.6 Cursor

| Property | Value |
|---|---|
| **Config location** | `.cursor/hooks.json` |
| **Hook events** | PreToolUse, PostToolUse |
| **Handler types** | `command` |
| **Input** | JSON via stdin |
| **Output** | JSON to stdout + exit code |
| **Input rewriting** | ✅ via `updatedInput` field |
| **Async hooks** | ❌ |
| **Timeout** | 10s |
| **Special** | Similar to Claude Code but with Cursor-specific tool names (write_file, edit_file, create_file). MCP tools use `mcp__` prefix. Supports input rewriting via `updatedInput`. |

---

## 6. Configuration Schema

Each hook entry in `hooks.config.js` supports:

```typescript
interface HookConfig {
  /** Unique hook name */
  name: string;
  /** Script or command to execute */
  script: string;
  /** Execution priority (lower = earlier) */
  priority?: number;
  /** Execution mode */
  mode: "blocking" | "async";
  /** Supported handler types */
  handlerTypes: Array<"command" | "http" | "prompt" | "agent" | "mcp_tool">;
  /** Native event mapping per runtime */
  nativeEvents: {
    claude?: string;
    qoder?: string;
    codex?: string;
    copilot?: string;
    trae?: string;
    cursor?: string;
  };
  /** Condition for when this hook fires */
  condition?: {
    /** Glob or regex pattern for tool name */
    toolNamePattern?: string;
    /** Glob pattern for file path */
    filePattern?: string;
  };
  /** Which runtimes this hook supports (omit = all) */
  supportedRuntimes?: Array<"claude" | "qoder" | "codex" | "copilot" | "trae" | "cursor">;
}
```

---

## 7. Exit Code & Output Convention

| Runtime | Allow | Deny | Error (non-blocking) |
|---|---|---|---|
| Claude Code | exit 0 + `{ "decision": "allow" }` | exit 2 + `{ "decision": "deny", "reason": "..." }` | exit ≠ 0,2 |
| Qoder | exit 0 + `{ "decision": "allow" }` | exit 2 + `{ "decision": "deny", "reason": "..." }` | exit ≠ 0,2 |
| Codex CLI | exit 0 | exit 2 + stderr message | exit ≠ 0,2 |
| Copilot | exit 0 | exit 1 + stderr message | — |
| Trae | exit 0 | exit 1 + stderr message | — |
| Cursor | exit 0 + `{ "decision": "allow" }` | exit 2 + `{ "decision": "deny", "reason": "..." }` | exit ≠ 0,2 |

---

## 8. Hook Classification & Latency Budget

| Mode | Timeout | Execution | Use Case |
|---|---|---|---|
| **blocking** | 200ms (configurable) | Serial, must complete before agent proceeds | Security firewall, file protection, quality gate |
| **async** | No limit | Parallel / background | Logging, tracing, cost tracking, statistics |

### Performance Rules

1. **Blocking hooks must complete within 200ms** by default. If a blocking hook exceeds its deadline, it is treated as `allow` with a warning.
2. **Async hooks never block the agent** — they run in the background and report results later.
3. **Policy evaluation is always blocking** — it runs in-process and must be fast.

---

## 9. Known Limitations & Fallback

| Runtime | Limitation | Fallback Strategy |
|---|---|---|
| **Copilot** | No WorktreeCreate/Remove, no PermissionRequest | `git.worktree_*` events unavailable; use post-file-save tasks instead |
| **Trae** | Only 6 events; no FileChanged, PreCompact | `confirm.after` unavailable; only `before`-class events support blocking |
| **Codex** | No `prompt`/`agent` handler type | Only `command` + `mcp_tool`; no LLM-driven hook decisions |
| **Copilot / Trae** | No `updatedInput` (input rewriting) | Can only pass/block; cannot modify tool parameters |
| **Cursor** | No Stop/SessionEnd hooks | `confirm.before`/`confirm.after` unavailable; no session lifecycle events |
| **All** | `task.start` / `task.complete` not natively supported | Emulated via session detection or left unsupported |
| **All** | `skill.before` / `skill.after` require skill-set configuration | Adapter must be configured with the project's skill tool names |

### Graceful Degradation

When an adapter encounters an unrecognized event or a runtime capability gap:

1. **Log a warning** (do not crash).
2. **Default to `allow`** for blocking events.
3. **Mark the event as `unsupported`** in the capability matrix.
4. **Continue processing** remaining events.

---

## Appendix A: Adapter Implementation Checklist

When implementing a new adapter:

- [ ] Define `ToolClassifier` (file tools, MCP tools, API tools)
- [ ] Declare `EventCapability[]` with accurate `support` levels
- [ ] Implement `handlePreToolUse` → emit `tool.before` + semantic events
- [ ] Implement `handlePostToolUse` → emit `tool.after` + semantic events
- [ ] Implement `handleStop` → emit `confirm.before` (if supported)
- [ ] Implement CLI entry point with correct exit code protocol
- [ ] Handle stdin timeout (1000ms default)
- [ ] Handle JSON parse errors gracefully
- [ ] Test with all built-in policies

---

## Appendix B: Version History

| Version | Date | Changes |
|---|---|---|
| 0.1.0 | 2025-01 | Initial taxonomy; 5 runtime adapters; Claude Code reference implementation |
