# Cursor Agent Hook 诊断指南

## 问题描述

在 Cursor Agent Mode 中，配置了 `.cursor/hooks.json`，但触及红线操作时：
- Hook 没有被调用
- 没有留下 trace 日志
- 语义级别的钩子也没有触发

## 问题原因

**最可能的原因**：**Cursor Agent Mode 目前不支持 hooks**

关键发现：
- 配置了 `.cursor/hooks.json`，但 Cursor Agent 根本没有调用 hook
- 与 VSCode Copilot Agent Mode 情况类似
- Cursor 可能还没有实现 hook 系统，或者实现方式与我们假设的不同

## 验证步骤

### 步骤 1：确认 handler.mjs 工作正常

手动测试 handler：

```bash
echo '{"tool_name":"write_file","tool_input":{"file_path":".env","content":"SECRET=123"}}' | \
  node .harness/hooks/handler.mjs pre-tool-use

# 应该输出：
# {"decision":"deny","reason":"Cannot modify environment files..."}
```

如果手动测试正常，说明 handler.mjs 本身没有问题。

### 步骤 2：检查 Cursor 是否调用了 hook

在 Cursor Agent Mode 中执行一个应该触发 hook 的操作（如修改 `.env` 文件），然后检查：

1. `.harness/traces/` 目录下是否有新的 trace 文件
2. 如果没有 trace 文件，说明 Cursor 没有调用 hook

### 步骤 3：启用调试日志

编辑 `.cursor/hooks.json`，添加环境变量：

```json
{
  "hooks": {
    "PreToolUse": [{
      "command": "HANNAH_DEBUG=true HANNAH_LOG_FILE=.harness/debug.log node .harness/hooks/handler.mjs pre-tool-use"
    }]
  }
}
```

然后在 Cursor Agent Mode 中执行操作，检查 `.harness/debug.log` 是否存在。

**如果日志文件不存在**：说明 Cursor Agent Mode 没有调用 hook，即不支持 hooks。

## 替代方案

如果 Cursor Agent Mode 确实不支持 hooks，可以使用以下替代方案：

### 方案 1：使用文件监控器（推荐）

```bash
# 启动文件监控器作为后备保护
node dist/cli/watcher.js &
```

文件监控器会：
- 实时监控关键文件（agent.md、.harness/ 等）
- 检测到修改时自动恢复
- 记录违规行为到 trace 日志

### 方案 2：使用支持 hooks 的 Agent

- ✅ **Claude Code**（完全支持，推荐）
- ✅ **Qoder**（完全支持）
- ✅ **Codex CLI**（完全支持）
- ✅ **GitHub Copilot**（GitHub.com 版本支持）

### 方案 3：等待 Cursor 更新

关注 Cursor 的更新日志，等待 hook 支持。

## 当前状态

### 已验证支持 hooks 的 Agent

- ✅ Claude Code
- ✅ Qoder
- ✅ Codex CLI
- ✅ GitHub Copilot（GitHub.com 版本）

### 待验证的 Agent

- ⚠️ Cursor（配置了 hooks 但 agent 没有调用）
- ⚠️ VSCode Copilot Agent Mode（可能不支持）
- ⚠️ Trae（待验证）

## 建议

1. **立即使用**：切换到 Claude Code（完全支持 hooks，最稳定）
2. **临时方案**：使用文件监控器 `node dist/cli/watcher.js`
3. **长期方案**：等待 Cursor 支持 hooks

## 参考链接

- [Cursor 官方文档](https://cursor.sh/docs)
- [Cursor Agent Mode](https://cursor.sh/docs/agent)
