# 重要更新：GitHub Copilot 支持 Hooks

## 问题修正

**之前的错误判断**：我们之前认为 GitHub Copilot 不支持 hooks。

**实际情况**：GitHub Copilot **完全支持** hooks！

## 正确的配置方式

### Copilot Hooks 配置

**配置位置**：`.github/hooks/hooks.json`

**配置格式**：
```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [{
      "type": "command",
      "bash": "node .harness/hooks/handler.mjs pre-tool-use",
      "powershell": "node .harness/hooks/handler.mjs pre-tool-use"
    }],
    "postToolUse": [{
      "type": "command",
      "bash": "node .harness/hooks/handler.mjs post-tool-use",
      "powershell": "node .harness/hooks/handler.mjs post-tool-use"
    }]
  }
}
```

### 关键特点

1. **使用 `version: 1` 格式**
2. **支持跨平台**：使用 `bash` 和 `powershell` 字段
3. **配置位置**：`.github/hooks/*.json`（不是 `.github/copilot-instructions.md`）
4. **支持的 Hook 类型**：
   - sessionStart
   - sessionEnd
   - userPromptSubmitted
   - preToolUse（可以批准或拒绝工具执行）
   - postToolUse
   - agentStop
   - subagentStop
   - errorOccurred

## 使用方法

### 1. 初始化项目

```bash
cd your-project
hannah init --agent=copilot
```

这会自动生成：
- `.harness/` 目录（包含 policies、hooks、traces）
- `.github/hooks/hooks.json`（Copilot hook 配置）

### 2. 使用 Copilot

```bash
# 启动 Copilot
copilot
```

Hooks 会自动触发，保护关键文件。

### 3. 测试保护

尝试让 Copilot 修改 agent.md：
- Hook 会检测到修改意图
- 如果违反规则，会拒绝执行
- 记录到 trace 日志

## 与其他 Agent 的对比

| Agent | 配置位置 | Hook 类型 | 状态 |
|-------|---------|----------|------|
| Claude Code | `.claude/settings.json` | PreToolUse, PostToolUse, Stop | ✅ 完全支持 |
| Qoder | `.qoder/settings.json` | PreToolUse, PostToolUse | ✅ 完全支持 |
| Codex CLI | `.codex/hooks.json` | PreToolUse, PostToolUse | ✅ 完全支持 |
| **Copilot** | `.github/hooks/hooks.json` | preToolUse, postToolUse, 等 | ✅ 完全支持 |

## 双重保护（可选）

如果需要额外保护，可以同时使用文件监控器：

```bash
# 启动文件监控器作为后备保护
node dist/cli/watcher.js &
```

## 参考文档

- [GitHub Copilot Hooks 官方文档](https://docs.github.com/copilot/customizing-copilot/agents/custom-agents/hooks)
- [Agent 能力矩阵](doc/AGENT-CAPABILITIES.md)
- [文件监控保护](FILE_WATCHER_PROTECTION.md)

## 更新日志

### 2026-08-27
- ✅ 修正：GitHub Copilot 支持 hooks
- ✅ 更新配置格式为 `.github/hooks/hooks.json`
- ✅ 使用 `version: 1` 格式
- ✅ 支持 `bash` 和 `powershell` 字段

---

**更新时间**：2026-08-27  
**状态**：✅ 已修正，Copilot 完全支持 hooks
