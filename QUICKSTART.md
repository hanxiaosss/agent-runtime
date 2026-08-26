# Agent Runtime - Quick Start Guide

## What is this?

Agent Runtime is a unified control plane for AI coding agents. It provides:
- **Universal Hooks**: Intercept agent actions across different runtimes (Claude Code, Codex, Qoder, etc.)
- **Runtime Guard**: Define policies to block/allow/warn agent behaviors
- **Runtime Trace**: Observe and analyze agent activity

## Installation

```bash
npm install -g agent-runtime
# or
pnpm add -g agent-runtime
```

## Quick Start

### 1. Initialize your project

```bash
cd your-project
agent-runtime init
```

This creates `.harness/` with:
- `config.yaml` - Runtime configuration
- `policies/*.yaml` - Security policies (git, MCP, file protection)
- `hooks/handler.mjs` - Hook handler for agent integration
- `README.md` - Integration instructions

### 2. Configure your agent

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs pre-tool-use"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs post-tool-use"
          }
        ]
      }
    ]
  }
}
```

#### Other Agents

See `.harness/README.md` for Codex, Qoder, Copilot, and Trae configurations.

### 3. View traces

```bash
# Show recent traces
agent-runtime trace

# Follow traces in real-time
agent-runtime trace --follow

# View summary statistics
agent-runtime summary
```

## Example Output

### Trace View
```
Agent Runtime Trace — test-project
─────────────────────────────────────────────────────────────────
Time        Action  Event              Source         Details
─────────────────────────────────────────────────────────────────
11:02:33    DENY    tool.before        claude-code    Write
          └─ Cannot modify environment files (.env)
11:02:33    ALLOW   tool.before        claude-code    Write
11:02:33    DENY    tool.before        claude-code    Bash → git push --force
          └─ Force push is not allowed
```

### Summary View
```
Agent Runtime Summary — test-project
═════════════════════════════════════════════════════════

Overview
─────────────────────────────────────────────────────────
Total events:     6
Allowed:          2  (33%)
Denied:           4  (67%)

Tools Used
─────────────────────────────────────────────────────────
Write              2
Bash               1
mcp__database__write  1
```

## Customizing Policies

Edit `.harness/policies/*.yaml` to customize behavior:

```yaml
name: my-custom-policy
description: Custom security rules

rules:
  - name: block-sensitive-files
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/*.env"
    action: deny
    feedback: "Environment files are protected"
```

## Architecture

```
Agent (Claude/Codex/Qoder/...)
    ↓
Adapter Layer (translates to unified events)
    ↓
Policy Engine (evaluates rules)
    ↓
Decision (allow/deny/warn)
    ↓
Trace (JSONL logs)
```

## Documentation

- [Hook Adaptation Table](doc/guidelines/hook-adaptation-table.md) - Complete event taxonomy and runtime mappings
- [README](README.md) - Full documentation

## Development

```bash
# Build
npm run build

# Run demo
npm run demo

# Run tests
npm test
```

## License

MIT
