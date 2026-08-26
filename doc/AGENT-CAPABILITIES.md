# Agent Hook 支持能力矩阵

> **重要说明**：并非所有 AI Agent 都支持 Hook 机制。本文档明确说明每个 Agent 的实际支持情况。

---

## 支持状态总览

| Agent | Hook 支持 | 配置方式 | 状态 |
|-------|----------|---------|------|
| **Claude Code** | ✅ 完整支持 | `.claude/settings.json` | ✅ 可用 |
| **Qoder** | ✅ 完整支持 | `.qoder/settings.json` | ✅ 可用 |
| **Codex CLI** | ✅ 完整支持 | `.codex/config.json` | ✅ 可用 |
| **GitHub Copilot** | ❌ 不支持 | N/A | ❌ 不可用 |
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
// .codex/config.json
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

### ❌ GitHub Copilot（不支持）

**问题**：
GitHub Copilot **不支持** PreToolUse/PostToolUse 这样的 hook 机制。

**原因**：
- Copilot 没有暴露工具执行的拦截点
- `.github/copilot-instructions.md` 只是给 Copilot 的指令文件，不是 hook 配置
- Copilot 的执行流程不经过外部 hook 系统

**替代方案**：
1. **文件监控** - 使用文件系统监控（如 chokidar）检测文件变化
2. **Git Hooks** - 使用 pre-commit hooks 在提交前检查
3. **IDE 插件** - 开发 VS Code 插件拦截操作
4. **代理模式** - 通过代理服务器拦截 API 调用

**状态**：❌ 不可用，需要替代方案

---

### ⚠️ Trae（部分支持，待验证）

**状态**：⚠️ 实验性支持，需要进一步验证

**待确认**：
- Trae 是否支持 PreToolUse/PostToolUse
- 配置方式是否与 Claude Code 相同
- 实际触发机制

---

## 推荐方案

### 如果你需要 Hook 功能

**推荐使用**：
1. **Claude Code** - 最佳选择，完整支持
2. **Qoder** - 完整支持
3. **Codex CLI** - 完整支持

**不推荐**：
- **GitHub Copilot** - 不支持 hooks

### 如果你必须使用 Copilot

需要使用替代方案：

#### 方案 1：Git Hooks
```bash
# .git/hooks/pre-commit
#!/bin/bash
node .harness/hooks/git-hook.mjs
```

#### 方案 2：文件监控
```javascript
// 使用 chokidar 监控文件变化
import chokidar from 'chokidar';

chokidar.watch('src/**/*').on('change', (path) => {
  // 检查文件变化是否符合规则
});
```

#### 方案 3：IDE 插件
开发 VS Code 插件，在编辑器层面拦截操作。

---

## 更新日志

### 2026-08-26
- 明确标注 GitHub Copilot 不支持 hooks
- 提供替代方案建议
- 更新能力矩阵

---

## 总结

**支持的 Agent**（可以直接使用）：
- ✅ Claude Code
- ✅ Qoder
- ✅ Codex CLI

**不支持的 Agent**（需要替代方案）：
- ❌ GitHub Copilot
- ⚠️ Trae（待验证）

**建议**：如果需要完整的 hook 功能，请使用 Claude Code、Qoder 或 Codex CLI。
