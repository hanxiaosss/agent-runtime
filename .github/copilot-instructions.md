# Copilot Agent Runtime Configuration

This project uses Agent Runtime to monitor and control Copilot behavior.

## Hooks Configuration

Add the following to your Copilot settings (VS Code or CLI):

```json
{
  "hooks": {
    "PreToolUse": [{
      "command": "node .harness/hooks/handler.mjs pre-tool-use"
    }],
    "PostToolUse": [{
      "command": "node .harness/hooks/handler.mjs post-tool-use"
    }]
  }
}
```

## What This Does

- **PreToolUse**: Runs before each tool execution to check policies
- **PostToolUse**: Runs after each tool execution to record traces
- Policies are defined in `.harness/policies/`
- Traces are saved to `.harness/traces/`

## Viewing Traces

```bash
hannah trace          # View recent traces
hannah trace --follow # Follow in real-time
hannah summary        # View statistics
```
