# Hannah Agent Runtime

> **A cross-agent unified event and policy layer for observing, constraining, and providing feedback on AI agent behavior.**

## Overview

Hannah Agent Runtime provides a unified control plane for AI coding agents (Claude Code, Codex, Qoder, Copilot, Trae, Cursor). It intercepts agent actions through a standardized hook system, applies declarative policies, and generates observable traces.

### Key Features

- **Universal Event Taxonomy**: 19 canonical event types across 9 categories
- **6 Runtime Adapters**: Claude Code, Codex, Qoder, Copilot, Trae, Cursor
- **Declarative Policies**: YAML-based security rules
- **Semantic Hook System**: Project-level rules extracted from agent.md
- **Tech Stack Detection**: Automatic hook generation based on your stack
- **Redline Protection**: AI agents cannot modify their own rules (security critical)
- **Observable Traces**: JSONL logs with timeline and summary views
- **Capability Matrix**: Honest reporting of native/emulated/unsupported events per runtime

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
│  │  Claude Code │ Codex │ Qoder │ Copilot │ Trae │ Cursor│  │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Universal Event Taxonomy**: 19 canonical event types (tool.before, code.before_modify, mcp.before, etc.)
- **6 Runtime Adapters**: Claude Code, Codex, Qoder, Copilot, Trae, Cursor
- **Declarative Policies**: YAML-based security rules
- **Semantic Hook System**: Project-level rules extracted from agent.md
- **Tech Stack Detection**: Automatic hook generation based on your stack
- **File Watcher Protection**: Agent-agnostic file monitoring for agents without hook support
- **Observable Traces**: JSONL logs with timeline and summary views
- **Capability Matrix**: Honest reporting of native/emulated/unsupported events per runtime

## Agent 支持状态

> **所有 Agent 都支持 Hook 机制**

| Agent          | Hook 支持   | 配置位置                   | 配置格式                                                               | 状态      |
| -------------- | ----------- | -------------------------- | ---------------------------------------------------------------------- | --------- |
| Claude Code    | ✅ 完整支持 | `.claude/settings.json`    | `{ hooks: { PreToolUse: [{ matcher, hooks: [{ type, command }] }] } }` | ✅ 可用   |
| Qoder          | ✅ 完整支持 | `.qoder/settings.json`     | `{ hooks: { PreToolUse: [{ matcher, hooks: [{ type, command }] }] } }` | ✅ 可用   |
| Codex CLI      | ✅ 完整支持 | `.codex/hooks.json`        | `{ hooks: [{ event, matcher, command }] }`                               | ✅ 可用   |
| GitHub Copilot | ✅ 完整支持 | `.github/hooks/hooks.json` | `{ version: 1, hooks: { preToolUse: [{ type, bash, powershell }] } }`  | ✅ 可用   |
| Cursor         | ⚠️ 待验证   | `.cursor/hooks.json`       | `{ hooks: { PreToolUse: [{ command }] } }`                             | ⚠️ 待验证 |
| Trae           | ⚠️ 待验证   | `.trae/settings.json`      | `{ hooks: { PreToolUse: [{ command }] } }`                             | ⚠️ 实验性 |

**重要说明**：

- **Codex CLI** 的 `hooks.json` 格式要求顶层包含 `hooks` 数组，每个钩子通过 `event` 字段指定事件类型（`PreToolUse`/`PostToolUse`/`Stop`），并配置 `matcher` 和 `command`
- **GitHub Copilot** 使用 `preToolUse`（小驼峰）而非 `PreToolUse`，且需指定 `version: 1` 和平台命令（`bash`/`powershell`）
- ⚠️ **Cursor Agent** 目前**可能不支持** hooks（配置了但 agent 没有调用）
- 如果你在 Cursor 中使用 Agent Mode 且 hook 没有触发，请参考诊断指南
- 替代方案：使用文件监控器 `node dist/cli/watcher.js` 或其他支持 hooks 的 Agent（如 Claude Code）

**详细说明**：参见 [Agent 能力矩阵](doc/AGENT-CAPABILITIES.md)

**注意**：所有主流 Agent 都支持 hooks。hannah 会自动生成对应 agent 的配置文件。

## Quick Start

### Installation

```bash
npm install -g hannah-agent-runtime
```

### Initialize Project

```bash
cd your-project
hannah init
```

This will:

1. Create `.harness/` directory with policies and hooks
2. Detect your project's tech stack (React, Vue, Node.js, etc.)
3. Scan for agent instruction files (agent.md, CLAUDE.md, etc.)
4. Generate semantic hooks based on your project rules
5. Generate agent-specific configuration

### Select Agent

During initialization, select your AI agent interactively or specify directly:

```bash
hannah init --agent=copilot
```

### View Traces

```bash
# Timeline view
hannah trace

# Real-time follow
hannah trace --follow

# Statistics summary
hannah summary
```

### Sync Semantic Hooks

After modifying agent.md or project dependencies:

```bash
hannah sync
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

## Semantic Hook System

Hannah goes beyond simple event matching with **semantic-level hooks** that understand your project context.

### How It Works

1. **Tech Stack Detection**
   - Analyzes package.json and project structure
   - Detects frameworks (React, Vue, Next.js, etc.)
   - Detects databases (Prisma, MongoDB, etc.)
   - Generates preset hooks based on your stack

2. **Agent.md Scanning**
   - Scans agent.md, CLAUDE.md, .cursorrules, etc.
   - Extracts red-line rules and constraints
   - Converts natural language rules to semantic hooks

3. **Automatic Hook Generation**
   - Creates semantic hooks from your rules
   - Saves hook metadata to `.harness/semantic-hooks/`
   - Hooks are automatically applied during agent execution

### Supported Agent Instruction Files

- `agent.md` / `AGENT.md`
- `CLAUDE.md` / `.claude/CLAUDE.md`
- `COPILOT.md` / `.github/COPILOT.md`
- `.cursorrules`
- `.cursor/rules.md`

### Example: Agent.md Rules

```markdown
# Project Rules

## Security

- Don't commit .env files or secrets
- Never use eval() or innerHTML with user input

## Database

- Don't drop tables or delete all records
- Always backup before migration

## Architecture

- Don't modify production configuration directly
```

Hannah automatically extracts these rules and creates semantic hooks.

### Built-in Semantic Hooks

| Hook                     | Description                     | Tech Stack        |
| ------------------------ | ------------------------------- | ----------------- |
| `database-protection`    | Prevent dangerous DB operations | Any with database |
| `react-security`         | Prevent insecure React patterns | React, Next.js    |
| `vue-security`           | Prevent insecure Vue patterns   | Vue               |
| `environment-protection` | Protect .env files              | All               |
| `secret-detection`       | Detect hardcoded secrets        | All               |
| `production-protection`  | Protect production configs      | All               |

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
   - Codex: Exit code protocol, async hooks, matcher-based hooks (`{ description, hooks: { matcher, events } }`)
   - Qoder: Input rewriting, permission requests
   - Copilot: PreToolUse/PostToolUse with platform-specific commands (`bash`/`powershell`), `version: 1` format
   - Trae: Minimal event surface
   - Cursor: PreToolUse/PostToolUse hooks

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

| Event                  | Category | Blockable | Description                    |
| ---------------------- | -------- | --------- | ------------------------------ |
| `tool.before`          | tool     | ✅        | Before any tool execution      |
| `tool.after`           | tool     | ❌        | After tool execution           |
| `code.before_modify`   | code     | ✅        | Before file write/edit         |
| `code.after_modify`    | code     | ❌        | After file modification        |
| `mcp.before`           | mcp      | ✅        | Before MCP server call         |
| `mcp.after`            | mcp      | ❌        | After MCP call                 |
| `task.start`           | task     | ❌        | Task begins                    |
| `task.before_complete` | task     | ✅        | Quality gate before completion |
| `task.complete`        | task     | ❌        | Task finished                  |
| `confirm.before`       | confirm  | ✅        | Agent about to stop            |
| `confirm.after`        | confirm  | ❌        | Session ended                  |
| `api.before`           | api      | ✅        | External HTTP request          |
| `api.after`            | api      | ❌        | HTTP request completed         |
| `git.worktree_keep`    | git      | ❌        | Worktree preserved             |
| `git.worktree_undo`    | git      | ❌        | Worktree reverted              |
| `skill.before`         | skill    | ✅        | Skill execution starts         |
| `skill.after`          | skill    | ❌        | Skill execution ends           |

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

### `hannah init [dir] [options]`

Generate `.harness/` directory with policies, hooks, and semantic hooks.

Options:

- `--agent=<name>` - Select agent directly (claude-code, copilot, qoder, codex, trae, cursor)

What it does:

- Creates `.harness/` directory structure
- Generates default policies (protected files, MCP safety, git safety)
- Detects tech stack and generates semantic hooks
- Scans agent.md and extracts rules
- Generates agent-specific hook configuration

### `hannah sync [dir]`

Synchronize semantic hooks with project rules.

What it does:

- Re-scans agent.md for rule changes
- Re-detects tech stack
- Updates semantic hooks
- Saves hook metadata

When to use:

- After modifying agent.md
- After changing project dependencies
- Periodically to keep hooks up-to-date

### `hannah trace [options]`

View agent runtime traces.

Options:

- `--all` - Show all entries (default: last 50)
- `--follow` - Real-time follow mode
- `--json` - Output raw JSON
- `--denied` - Only show denied events

### `hannah summary [options]`

Show aggregate statistics.

Options:

- `--today` - Summary of today only
- `--days N` - Summary of last N days

## Project Structure

```
hannah/
├── src/
│   ├── core/              # Core abstractions
│   │   ├── event.ts       # Unified event taxonomy
│   │   ├── hook.ts        # Hook interface & pipeline
│   │   ├── policy.ts      # Policy engine
│   │   └── runtime.ts     # Runtime engine
│   ├── semantic/          # Semantic hook system
│   │   ├── types.ts       # Semantic hook types
│   │   ├── engine.ts      # Semantic hook engine
│   │   ├── hook-generator.ts    # Hook generation
│   │   ├── tech-stack-detector.ts # Tech stack detection
│   │   └── agent-md-scanner.ts  # Agent.md scanning
│   ├── adapters/          # Runtime adapters
│   │   ├── base-adapter.ts
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   ├── qoder.ts
│   │   ├── copilot.ts
│   │   ├── cursor.ts
│   │   └── trae.ts
│   ├── policies/          # Built-in policies
│   ├── cli/               # CLI commands
│   │   ├── init.ts
│   │   ├── sync.ts
│   │   ├── trace.ts
│   │   ├── summary.ts
│   │   └── yaml-loader.ts
│   ├── bin.ts             # CLI entry point
│   └── index.ts           # Public API
├── doc/
│   ├── architecture/      # Architecture design docs
│   │   ├── ARCHITECTURE-v2.md
│   │   ├── PPT-SUMMARY.md
│   │   └── DIAGRAMS.md
│   ├── USAGE.md           # Usage guide
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
- [x] **Phase 2**: Semantic hook system (tech stack detection, agent.md scanning)
- [ ] **Phase 3**: Project-embedded mode (policies in git, CI integration)
- [ ] **Phase 4**: Sidecar + dashboard (cross-project aggregation, web UI)
- [ ] **Phase 5**: Intelligence (self-learning, behavior analysis)

## Documentation

- [Usage Guide](doc/USAGE.md) - Complete usage guide
- [Architecture Design](doc/architecture/ARCHITECTURE-v2.md) - Detailed architecture
- [PPT Summary](doc/architecture/PPT-SUMMARY.md) - Presentation outline
- [Diagrams](doc/architecture/DIAGRAMS.md) - Architecture diagrams
- [Quick Start Guide](QUICKSTART.md)
- [Hook Adaptation Table](doc/guidelines/hook-adaptation-table.md) - Complete event taxonomy and runtime mappings

## License

MIT
