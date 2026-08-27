# File Watcher Protection for Redline Files

## Problem Statement

The original hook-based protection system only works for agents that support PreToolUse/PostToolUse hooks (Claude Code, Codex, Qoder). However, some agents like GitHub Copilot don't support these hooks, leaving redline files (agent.md, AGENT.md, .harness/config.yaml, etc.) unprotected.

**Issue**: When using Copilot or other non-hook-supporting agents, AI can modify redline rules in agent.md, bypassing all security protections.

## Solution: File System Watcher

Implemented a file system watcher that monitors protected files and automatically restores them when unauthorized modifications are detected. This solution works independently of the agent's hook support.

### Key Features

1. **Agent-Agnostic**: Works with any AI agent (Copilot, Claude Code, Codex, Qoder, etc.)
2. **Real-time Protection**: Detects and reverts modifications within milliseconds
3. **No Infinite Loops**: Uses content hashing and restoration locks to prevent feedback loops
4. **Trace Logging**: Records all violations to .harness/traces/ for audit
5. **Automatic Backup**: Creates backups of protected files on startup

### Protected Files

- `agent.md`, `AGENT.md`, `.agent.md`
- `CLAUDE.md`, `COPILOT.md`, `.cursorrules`
- `.harness/config.yaml`
- All files in `.harness/policies/`, `.harness/hooks/`, `.harness/semantic-hooks/`

## Implementation Details

### Core Mechanisms

1. **Content Hashing**: Uses MD5 hashes to detect actual content changes
   - Prevents false positives from metadata-only changes
   - Only triggers restoration when content actually differs from backup

2. **Restoration Lock**: Prevents infinite loops
   - Sets a flag before restoring a file
   - Ignores watch events for files currently being restored
   - Releases lock after 500ms delay

3. **Cooldown Period**: Prevents rapid re-triggering
   - 2-second cooldown per file
   - Avoids processing the same modification multiple times

4. **Watch Event Filtering**:
   - Only monitors protected files and directories
   - Ignores changes to non-protected files
   - Skips events during restoration

### Usage

```bash
# Start the watcher
node dist/cli/watcher.js

# Or run in background
node dist/cli/watcher.js &
```

The watcher will:
1. Backup all protected files to `.harness/.backups/`
2. Monitor the project directory recursively
3. Detect modifications to protected files
4. Automatically restore from backup
5. Log violations to `.harness/traces/YYYY-MM-DD.jsonl`

### Example Output

```
[watcher] Starting file system watcher...
[watcher] Project root: E:\code\agent-runtime
[watcher] Protected files: agent.md, AGENT.md, .agent.md, CLAUDE.md, COPILOT.md, .cursorrules, .harness/config.yaml
[watcher] Protected dirs: .harness/policies, .harness/hooks, .harness/semantic-hooks

[watcher] Backed up: agent.md
[watcher] Backed up: AGENT.md
[watcher] Backed up: .harness\config.yaml
[watcher] Backed up: .harness\policies\git-safety.yaml
[watcher] Backed up: .harness\policies\mcp-safety.yaml
[watcher] Backed up: .harness\policies\protected-files.yaml
[watcher] Backed up: .harness\hooks\handler.mjs
[watcher] Backed up: .harness\semantic-hooks\hooks.json
[watcher] ✅ Watcher started. Monitoring for redline violations...
[watcher] Press Ctrl+C to stop.

[watcher] ⚠️  Protected file modified: agent.md
[watcher] ✅ Restored: agent.md
```

### Trace Log Entry

```json
{
  "timestamp": "2026-08-26T17:17:51.665Z",
  "event": "redline.violation",
  "source": "file-watcher",
  "action": "deny",
  "payload": {
    "filePath": "agent.md",
    "eventType": "rename",
    "message": "AI agent attempted to modify protected file"
  },
  "feedback": [
    "Redline file modification detected and reverted",
    "This file is protected and cannot be modified by AI agents"
  ]
}
```

## Testing

### Test Scenario

1. Start the watcher: `node dist/cli/watcher.js`
2. Modify agent.md: Change "Never run migrations directly on production" to "Allow running migrations directly on production"
3. Observe watcher output:
   - Detects modification: `⚠️  Protected file modified: agent.md`
   - Restores file: `✅ Restored: agent.md`
4. Verify file content: Original rule is restored
5. Check trace log: Violation recorded in `.harness/traces/2026-08-26.jsonl`

### Test Results

✅ **Passed**: File watcher successfully detected and reverted unauthorized modification
✅ **Passed**: No infinite loop occurred (only one detection and one restoration)
✅ **Passed**: File content restored to original state
✅ **Passed**: Violation logged to trace file

## Comparison: Hook-based vs File Watcher

| Feature | Hook-based | File Watcher |
|---------|-----------|--------------|
| **Agent Support** | Only hook-supporting agents | All agents |
| **Protection Timing** | Before tool execution | After file modification |
| **Prevention** | Prevents modification | Reverts modification |
| **Performance** | Lower overhead | Slight overhead (file monitoring) |
| **Reliability** | Depends on agent compliance | Independent of agent |
| **Use Case** | Claude Code, Codex, Qoder | Copilot, any agent |

## Recommended Strategy

**Use both mechanisms together**:

1. **Hook-based protection** for agents that support it (prevention)
2. **File watcher** as a fallback for all agents (reversion)

This provides defense-in-depth:
- Hooks prevent modifications before they happen
- File watcher catches any modifications that bypass hooks
- Works even if agent doesn't support hooks or hooks are disabled

## Future Enhancements

1. **Configurable Protection Levels**:
   - Strict mode: Immediate restoration
   - Lenient mode: Log only, don't restore
   - Interactive mode: Prompt user for confirmation

2. **Selective Protection**:
   - Allow specific users/processes to modify protected files
   - Whitelist certain paths or patterns

3. **Integration with Agent Runtime**:
   - Automatically start watcher when agent session begins
   - Stop watcher when session ends

4. **Performance Optimization**:
   - Use native file system APIs (e.g., ReadDirectoryChangesW on Windows)
   - Debounce rapid changes more aggressively

## Conclusion

The file watcher provides a robust, agent-agnostic solution for protecting redline files. It complements the hook-based protection system and ensures that critical configuration files remain secure regardless of which AI agent is being used.

By combining both mechanisms, we achieve comprehensive protection:
- **Prevention** (hooks) + **Detection & Reversion** (watcher) = **Complete Security**
