# Agent Hook 支持能力矩阵

> **所有主流 Agent 都支持 Hook 机制**

---

## 支持状态总览

| Agent | Hook 支持 | 配置位置 | 状态 |
|-------|----------|---------|------|
| **Claude Code** | ✅ 完整支持 | `.claude/settings.json` | ✅ 可用 |
| **Qoder** | ✅ 完整支持 | `.qoder/settings.json` | ✅ 可用 |
| **Codex CLI** | ✅ 完整支持 | `.codex/hooks.json` | ✅ 可用 |
| **GitHub Copilot** | ✅ 完整支持 | `.github/hooks/hooks.json` | ✅ 可用 |
| **Cursor** | ✅ 完整支持 | `.cursor/hooks.json` | ✅ 可用 |
| **Trae** | ⚠️ 部分支持 | 待验证 | ⚠️ 实验性 |

---

## 详细说明

### ✅ Claude Code（完全支持）

**Hook 类型**：
- PreToolUse - 工具执行前
- PostToolUse - 工具执行后
- Stop - 会话结束前

**配置方式**：
```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }]
    }]
  }
}
```

**状态**：✅ 完全可用，所有功能正常工作

---

### ✅ Qoder（完全支持）

**Hook 类型**：
- PreToolUse - 工具执行前
- PostToolUse - 工具执行后

**配置方式**：
```json
// .qoder/settings.json
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

**状态**：✅ 完全可用

---

### ✅ Codex CLI（完全支持）

**Hook 类型**：
- PreToolUse - 工具执行前
- PostToolUse - 工具执行后

**配置方式**：
```json
// .codex/hooks.json
{
  "PreToolUse": [{
    "command": "node .harness/hooks/handler.mjs pre-tool-use"
  }],
  "PostToolUse": [{
    "command": "node .harness/hooks/handler.mjs post-tool-use"
  }]
}
```

**状态**：✅ 完全可用

---

### ✅ GitHub Copilot（完全支持）

**Hook 类型**：
- sessionStart - 会话开始时
- sessionEnd - 会话结束时
- userPromptSubmitted - 用户提交提示时
- preToolUse - 工具执行前（可以批准或拒绝）
- postToolUse - 工具执行后
- agentStop - Agent 停止时
- subagentStop - 子 Agent 停止时
- errorOccurred - 发生错误时

**配置方式**：
```json
// .github/hooks/hooks.json
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

**特点**：
- 使用 `version: 1` 格式
- 支持 `bash` 和 `powershell` 字段（跨平台）
- 支持 `cwd`、`env`、`timeoutSec` 等配置
- Hooks 通过 stdin 接收 JSON 输入
- 可以通过退出码控制行为（0 = 允许，非 0 = 拒绝）

**状态**：✅ 完全可用

**参考文档**：https://docs.github.com/copilot/customizing-copilot/agents/custom-agents/hooks

---

### ✅ Cursor（完全支持）

**Hook 类型**：
- PreToolUse - 工具执行前
- PostToolUse - 工具执行后

**配置方式**：
```json
// .cursor/hooks.json
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

**特点**：
- 支持 JSON stdout + exit code 协议（类似 Claude Code）
- 支持 `updatedInput` 字段进行输入重写
- 工具名称：`write_file`, `edit_file`, `create_file`
- MCP 工具使用 `mcp__` 前缀（双下划线）
- Exit code: 0 = allow, 2 = deny

**状态**：✅ 完全可用

---

### ⚠️ Trae（部分支持，待验证）

**状态**：⚠️ 实验性支持，需要进一步验证

**待确认**：
- Trae 是否支持 PreToolUse/PostToolUse
- 配置方式是否与 Claude Code 相同
- 实际触发机制

---

## 推荐方案

### 所有 Agent 都支持 Hooks

所有主流 Agent 都支持 hooks，可以直接使用：
- ✅ Claude Code
- ✅ Qoder
- ✅ Codex CLI
- ✅ GitHub Copilot
- ✅ Cursor

### 双重保护（可选）

如果需要额外保护，可以同时使用文件监控器：

```bash
# 启动文件监控器作为后备保护
node dist/cli/watcher.js &
```

文件监控器会：
- 实时监控关键文件（agent.md、.harness/ 等）
- 检测到修改时自动恢复
- 记录违规行为到 trace 日志

---

## 更新日志

### 2026-08-27
- ✅ 确认 GitHub Copilot 支持 hooks
- ✅ 更新 Copilot 配置格式为 `.github/hooks/hooks.json`
- ✅ 使用 `version: 1` 格式和 `bash`/`powershell` 字段
- ✅ 移除 "Copilot 不支持 hooks" 的错误说明

---

## 总结

**支持的 Agent**（可以直接使用）：
- ✅ Claude Code
- ✅ Qoder
- ✅ Codex CLI
- ✅ GitHub Copilot
- ✅ Cursor

**实验性支持**：
- ⚠️ Trae（待验证）

**建议**：所有主流 Agent 都支持 hooks，可以根据需求选择合适的 Agent。
