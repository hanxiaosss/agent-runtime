# 重要更新：GitHub Copilot 不支持 Hooks

## 问题发现

经过实际测试，我们发现 **GitHub Copilot 不支持 PreToolUse/PostToolUse hooks**。

这意味着：
- ❌ Hooks 不会被触发
- ❌ 语义 Hook（包括 redline-protection）不会工作
- ❌ agent.md 中的规则不会被自动执行

## 解决方案

### 方案 1：使用支持 Hooks 的 Agent（推荐）

以下 Agent 完全支持 hooks：
- ✅ **Claude Code** - 完整支持，推荐使用
- ✅ **Qoder** - 完整支持
- ✅ **Codex CLI** - 完整支持

### 方案 2：使用替代方案保护 Copilot

如果你必须使用 Copilot，可以使用以下替代方案：

#### 1. Git Hooks
```bash
# .git/hooks/pre-commit
#!/bin/bash
# 检查是否有敏感文件被修改
if git diff --cached --name-only | grep -q ".env"; then
  echo "Error: .env files cannot be committed"
  exit 1
fi
```

#### 2. 文件监控
```javascript
// monitor.js
import chokidar from 'chokidar';

chokidar.watch(['agent.md', '.harness/**/*']).on('change', (path) => {
  console.error(`WARNING: Protected file modified: ${path}`);
  // 发送通知或回滚
});
```

#### 3. VS Code 扩展
开发 VS Code 扩展来拦截 Copilot 的操作。

## 已更新的文档

1. **doc/AGENT-CAPABILITIES.md** - Agent 能力矩阵
2. **README.md** - 添加了支持状态说明
3. **src/cli/init.ts** - 选择 Copilot 时会显示警告

## 测试验证

### Claude Code（可用）
```bash
node dist/bin.js init --agent=claude-code
# Hooks 正常工作
```

### GitHub Copilot（不可用）
```bash
node dist/bin.js init --agent=copilot
# 会显示警告：
# ⚠️  WARNING: GitHub Copilot does NOT support PreToolUse/PostToolUse hooks!
#    The generated configuration file is for documentation only.
#    Hooks will NOT be triggered when using Copilot.
```

## 下一步

1. 如果你需要完整的 hook 功能，请切换到 Claude Code、Qoder 或 Codex CLI
2. 如果必须使用 Copilot，请实现替代方案（Git Hooks、文件监控等）
3. 我们会继续研究 Copilot 的其他集成方式

---

**更新时间**：2026-08-26  
**状态**：已确认 Copilot 不支持 hooks
