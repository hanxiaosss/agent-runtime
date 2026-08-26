# Agent Runtime

> **A cross-agent-runtime unified event and policy layer for observing, constraining, and providing feedback on AI agent behavior.**

## Overview

Agent Runtime provides a unified control plane for AI coding agents (Claude Code, Codex, Qoder, Copilot, Trae). It intercepts agent actions through a standardized hook system, applies declarative policies, and generates observable traces.

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Runtime Control Plane                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Universal    │    │  Runtime     │    │  Runtime     │  │
│  │ Hooks        │───▶│  Guard       │───▶│  Trace       │  │
│  │              │    │  (Policies)  │    │  (JSONL)     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Adapter Layer                           │   │
│  │  Claude Code │ Codex │ Qoder │ Copilot │ Trae       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Universal Event Taxonomy**: 17 canonical event types (tool.before, code.before_modify, mcp.before, etc.)
- **5 Runtime Adapters**: Claude Code, Codex, Qoder, Copilot, Trae
- **Declarative Policies**: YAML-based security rules
- **Observable Traces**: JSONL logs with timeline and summary views
- **Capability Matrix**: Honest reporting of native/emulated/unsupported events per runtime

## Quick Start

### Installation

```bash
npm install -g agent-runtime
```

### Initialize Project

```bash
cd your-project
agent-runtime init
```

This generates `.harness/` with policies, hooks, and configuration.

### Configure Agent

Add hooks to your agent's settings (see `.harness/README.md` for details):

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }]
    }]
  }
}
```

### View Traces

```bash
# Timeline view
agent-runtime trace

# Real-time follow
agent-runtime trace --follow

# Statistics summary
agent-runtime summary
```

## Example Output

### Trace Timeline
```
Agent Runtime Trace — my-project
────────────────────────────────────────────────────────────────
Time        Action  Event              Source         Details
────────────────────────────────────────────────────────────────
11:02:33    DENY    tool.before        claude-code    Write
          └─ Cannot modify environment files (.env)
11:02:34    ALLOW   tool.before        claude-code    Write
11:02:35    DENY    tool.before        claude-code    Bash → git push --force
          └─ Force push is not allowed
```

### Summary Statistics
```
Agent Runtime Summary — my-project
═════════════════════════════════════════════════════════

Overview
─────────────────────────────────────────────────────────
Total events:     42
Allowed:          38  (90%)
Denied:           4   (10%)

Tools Used
─────────────────────────────────────────────────────────
Write              12
Bash               8
Edit               5
mcp__filesystem__read  3
```

## Architecture

### Core Components

1. **Event Taxonomy** (`src/core/event.ts`)
   - 17 canonical event types across 7 categories
   - Support level tracking (native/emulated/unsupported)

2. **Policy Engine** (`src/core/policy.ts`)
   - YAML-based declarative rules
   - Pattern matching with glob syntax
   - Actions: allow, deny, warn, retry, modify

3. **Hook System** (`src/core/hook.ts`)
   - Standardized HookResult interface
   - Pipeline execution with priority ordering
   - Feedback propagation to agents

4. **Runtime Engine** (`src/core/runtime.ts`)
   - Adapter registration and lifecycle
   - Event processing and trace recording
   - Capability matrix management

5. **Adapters** (`src/adapters/`)
   - Claude Code: Full hook support (PreToolUse, PostToolUse, Stop)
   - Codex: Exit code protocol, async hooks
   - Qoder: Input rewriting, permission requests
   - Copilot: Basic PreToolUse/PostToolUse
   - Trae: Minimal event surface

### Event Flow

```
Agent Action
    ↓
Adapter (translates to unified event)
    ↓
Policy Engine (evaluates rules)
    ↓
Decision (allow/deny/warn)
    ↓
Trace (JSONL log)
    ↓
Feedback (to agent)
```

## Unified Event Taxonomy

| Event | Category | Blockable | Description |
|-------|----------|-----------|-------------|
| `tool.before` | tool | ✅ | Before any tool execution |
| `tool.after` | tool | ❌ | After tool execution |
| `code.before_modify` | code | ✅ | Before file write/edit |
| `code.after_modify` | code | ❌ | After file modification |
| `mcp.before` | mcp | ✅ | Before MCP server call |
| `mcp.after` | mcp | ❌ | After MCP call |
| `task.start` | task | ❌ | Task begins |
| `task.before_complete` | task | ✅ | Quality gate before completion |
| `task.complete` | task | ❌ | Task finished |
| `confirm.before` | confirm | ✅ | Agent about to stop |
| `confirm.after` | confirm | ❌ | Session ended |
| `api.before` | api | ✅ | External HTTP request |
| `api.after` | api | ❌ | HTTP request completed |
| `git.worktree_keep` | git | ❌ | Worktree preserved |
| `git.worktree_undo` | git | ❌ | Worktree reverted |
| `skill.before` | skill | ✅ | Skill execution starts |
| `skill.after` | skill | ❌ | Skill execution ends |

See [Hook Adaptation Table](doc/guidelines/hook-adaptation-table.md) for complete runtime mappings.

## Policy Examples

### Block Environment Files

```yaml
name: protected-files
rules:
  - name: block-env
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/.env"
    action: deny
    feedback: "Environment files are protected"
```

### Block Dangerous Git Commands

```yaml
name: git-safety
rules:
  - name: block-force-push
    when: tool.before
    match:
      - field: toolName
        pattern: ["Bash", "terminal"]
      - field: input.command
        pattern: "*push --force*"
    action: deny
    feedback: "Force push is not allowed"
```

### Control MCP Access

```yaml
name: mcp-safety
rules:
  - name: block-database-writes
    when: mcp.before
    match:
      - field: server
        pattern: "database"
      - field: operation
        pattern: ["write", "delete"]
    action: deny
    feedback: "Database writes are not allowed"
```

## CLI Commands

### `agent-runtime init [dir]`

Generate `.harness/` directory with policies and hooks.

### `agent-runtime trace [options]`

View agent runtime traces.

Options:
- `--all` - Show all entries (default: last 50)
- `--follow` - Real-time follow mode
- `--json` - Output raw JSON
- `--denied` - Only show denied events

### `agent-runtime summary [options]`

Show aggregate statistics.

Options:
- `--today` - Summary of today only
- `--days N` - Summary of last N days

## Project Structure

```
agent-runtime/
├── src/
│   ├── core/              # Core abstractions
│   │   ├── event.ts       # Unified event taxonomy
│   │   ├── hook.ts        # Hook interface & pipeline
│   │   ├── policy.ts      # Policy engine
│   │   └── runtime.ts     # Runtime engine
│   ├── adapters/          # Runtime adapters
│   │   ├── base-adapter.ts
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   ├── qoder.ts
│   │   ├── copilot.ts
│   │   └── trae.ts
│   ├── policies/          # Built-in policies
│   ├── cli/               # CLI commands
│   │   ├── init.ts
│   │   ├── trace.ts
│   │   ├── summary.ts
│   │   └── yaml-loader.ts
│   ├── bin.ts             # CLI entry point
│   └── index.ts           # Public API
├── doc/
│   └── guidelines/
│       └── hook-adaptation-table.md  # SSOT adaptation spec
└── package.json
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run demo
pnpm run demo

# Run tests
pnpm test

# Type check
pnpm exec tsc --noEmit
```

## Roadmap

- [x] **Phase 1**: CLI + file mode (init, trace, summary)
- [ ] **Phase 2**: Project-embedded mode (policies in git, CI integration)
- [ ] **Phase 3**: Sidecar + dashboard (cross-project aggregation, web UI)

## Documentation

- [Quick Start Guide](QUICKSTART.md)
- [Hook Adaptation Table](doc/guidelines/hook-adaptation-table.md) - Complete event taxonomy and runtime mappings

## License

MIT
