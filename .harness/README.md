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
├── semantic-rules/      # Multi-dimensional semantic rules (YAML)
│   └── custom.yaml
├── hooks/
│   └── handler.mjs      # Unified hook entry point
├── semantic-hooks/      # Auto-generated hook metadata
│   └── hooks.json
└── traces/              # Runtime trace data (JSONL)
```

## Two Hook Systems

### 1. Declarative Policies (policies/)

Match on event fields via dot-notation paths:

```yaml
name: my-policy
rules:
  - name: block-readme
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/README.md"
    action: deny
    feedback: "README is managed separately."
```

### 2. Semantic Rules (semantic-rules/)

Match on multiple operational dimensions simultaneously:

```yaml
rules:
  - name: no-eval-in-src
    description: Block eval() in source files
    match:
      file_path: ["src/**"]
      file_type: [ts, js]
      content: ["eval(", "new Function("]
    action: deny
    feedback: "eval() is not allowed in source files."
```

Dimensions: `tool_name`, `file_path`, `content`, `command`,
`mcp_server`, `mcp_operation`, `file_type`.
All specified dimensions must match (AND); within a dimension any
pattern can match (OR).

## Setup

### 1. Configure your agent

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

#### GitHub Copilot

Add to `.github/copilot-instructions.md` or configure in your Copilot settings:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ],
    "PostToolUse": [
      {
        "command": "node .harness/hooks/handler.mjs post-tool-use"
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
  "description": "Agent runtime hooks",
  "hooks": {
    "matcher": "*",
    "PreToolUse": [
      { "command": "node .harness/hooks/handler.mjs pre-tool-use" }
    ],
    "PostToolUse": [
      { "command": "node .harness/hooks/handler.mjs post-tool-use" }
    ]
  }
}
```

#### Trae

Add to `.trae/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "command": "node .harness/hooks/handler.mjs pre-tool-use" }
    ],
    "PostToolUse": [
      { "command": "node .harness/hooks/handler.mjs post-tool-use" }
    ]
  }
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
