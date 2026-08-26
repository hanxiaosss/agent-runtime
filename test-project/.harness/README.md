# Agent Runtime Harness

This directory contains the project-level agent runtime configuration.

## Structure

```
.harness/
├── config.yaml          # Project configuration
├── policies/            # Declarative policy files (YAML)
│   ├── protected-files.yaml
│   ├── mcp-safety.yaml
│   └── git-safety.yaml
├── hooks/
│   └── handler.mjs      # Unified hook entry point
└── traces/              # Runtime trace data (JSONL)
```

## Setup

### 1. Install hannah-agent-runtime

```bash
npm install -D hannah-agent-runtime
```

### 2. Configure your agent

#### Claude Code

Add to `~/.claude/settings.json` or `.claude/settings.json`:

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

#### Qoder

Similar to Claude Code, add hooks to `.qoder/settings.json`.

#### Codex CLI

Add to `.codex/hooks.json`:

```json
{
  "PreToolUse": [
    { "command": "node .harness/hooks/handler.mjs pre-tool-use" }
  ],
  "PostToolUse": [
    { "command": "node .harness/hooks/handler.mjs post-tool-use" }
  ]
}
```

## Viewing Traces

```bash
# View recent trace entries
hannah trace

# Follow traces in real-time
hannah trace --follow

# View summary statistics
hannah summary
```

## Customizing Policies

Edit the YAML files in `policies/` to customize agent behavior.
See the [adaptation table](../doc/guidelines/hook-adaptation-table.md) for the full event taxonomy.

### Example: Block a specific file

```yaml
name: my-custom-rules
rules:
  - name: block-readme
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/README.md"
    action: deny
    feedback: "README is managed separately."
```
