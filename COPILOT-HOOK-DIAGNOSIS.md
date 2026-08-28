# Copilot Hook 问题诊断指南

## 问题描述

在 VSCode 中使用 Copilot Agent Mode 时，设置了红线 hook 但触及红线操作没有触发 hook 也没有日志。

## 可能的原因

### 1. VSCode Copilot Agent Mode 不支持 Hooks（最可能）

**关键发现**：VSCode 中的 Copilot Agent Mode 和 GitHub.com 的 Copilot Agent 是不同的实现。

- **GitHub.com Copilot Agent**：支持 hooks（`.github/hooks/hooks.json`）
- **VSCode Copilot Agent Mode**：目前**可能不支持** hooks

这是最可能的原因。VSCode 的 Copilot Agent Mode 是一个相对较新的功能，可能还没有实现 hook 系统。

### 2. 配置格式不正确

如果 VSCode 确实支持 hooks，可能是配置格式不对。

### 3. handler.mjs 没有正确处理输入

可能是 handler 没有正确处理 Copilot 的输入格式。

## 诊断步骤

### 步骤 1：启用调试日志

在 Copilot 的配置中添加环境变量：

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [{
      "type": "command",
      "bash": "HANNAH_DEBUG=true HANNAH_LOG_FILE=.harness/debug.log node .harness/hooks/handler.mjs pre-tool-use",
      "powershell": "$env:HANNAH_DEBUG='true'; $env:HANNAH_LOG_FILE='.harness/debug.log'; node .harness/hooks/handler.mjs pre-tool-use"
    }]
  }
}
```

### 步骤 2：触发操作并检查日志

1. 在 Copilot Agent Mode 中执行一个应该触发 hook 的操作（如修改 `.env` 文件）
2. 检查 `.harness/debug.log` 是否存在
3. 检查 `.harness/traces/` 目录下是否有新的 trace 文件

### 步骤 3：手动测试 handler

```bash
# 手动测试 handler 是否能正常工作
echo '{"tool_name":"write_file","tool_input":{"file_path":".env","content":"SECRET=123"}}' | \
  node .harness/hooks/handler.mjs pre-tool-use

# 应该输出：
# {"decision":"deny","reason":"Cannot modify environment files..."}
```

### 步骤 4：检查 VSCode Copilot 版本

```bash
# 在 VSCode 中查看 Copilot 版本
# Help > About > GitHub Copilot
```

## 替代方案

如果 VSCode Copilot Agent Mode 确实不支持 hooks，可以使用以下替代方案：

### 方案 1：使用文件监控器（File Watcher）

```bash
# 启动文件监控器作为后备保护
node dist/cli/watcher.js &
```

文件监控器会：
- 实时监控关键文件（agent.md、.harness/ 等）
- 检测到修改时自动恢复
- 记录违规行为到 trace 日志

### 方案 2：使用其他支持 hooks 的 Agent

- ✅ Claude Code（完全支持）
- ✅ Qoder（完全支持）
- ✅ Codex CLI（完全支持）
- ✅ Cursor（完全支持）
- ⚠️ Trae（待验证）

### 方案 3：等待 VSCode Copilot 更新

关注 VSCode Copilot 的更新日志，等待 hook 支持。

## 验证 VSCode Copilot 是否支持 Hooks

### 测试方法

1. 创建一个简单的测试脚本：

```bash
# test-hook.sh
#!/bin/bash
echo "Hook triggered!" >> /tmp/copilot-hook.log
echo '{"decision":"allow"}'
```

2. 配置 Copilot 使用这个脚本：

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [{
      "type": "command",
      "bash": "bash test-hook.sh"
    }]
  }
}
```

3. 在 Copilot Agent Mode 中执行任何工具调用
4. 检查 `/tmp/copilot-hook.log` 是否存在

如果文件不存在，说明 VSCode Copilot Agent Mode 不支持 hooks。

## 结论

**最可能的原因**：VSCode Copilot Agent Mode 目前不支持 hooks。

**建议**：
1. 使用文件监控器作为替代方案
2. 或者使用其他支持 hooks 的 Agent（如 Claude Code、Cursor）
3. 关注 VSCode Copilot 的更新，等待 hook 支持

## 参考链接

- [GitHub Copilot Hooks Documentation](https://docs.github.com/copilot/customizing-copilot/agents/custom-agents/hooks)
- [VSCode Copilot Agent Mode](https://code.visualstudio.com/docs/copilot/copilot-agent-mode)
