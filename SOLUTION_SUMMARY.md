# 解决方案总结：统一的 Agent 保护机制

## 问题回顾

您遇到的核心问题是：**GitHub Copilot 不支持 PreToolUse/PostToolUse hooks**，导致：
- ❌ Hook 机制无法触发
- ❌ agent.md 中的红线规则可以被 AI 随意修改
- ❌ 安全保护完全失效

## 解决方案：双重保护机制

我们实现了**两层保护机制**，确保无论使用哪个 Agent，关键文件都能得到保护：

### 第一层：Hook 机制（适用于支持 hooks 的 Agent）

**适用 Agent**：Claude Code、Codex、Qoder

**工作原理**：
```
Agent 尝试修改文件
  ↓
PreToolUse hook 触发
  ↓
检查红线规则
  ↓
如果违反 → 阻止修改
如果符合 → 允许修改
```

**配置方式**：
```bash
hannah init --agent=claude-code
```

### 第二层：文件监控器（适用于所有 Agent）

**适用 Agent**：所有 Agent，包括 Copilot

**工作原理**：
```
启动文件监控器
  ↓
备份所有受保护的文件
  ↓
实时监控文件系统
  ↓
检测到修改
  ↓
内容哈希比对
  ↓
如果内容变化 → 自动恢复 + 记录违规
如果内容未变 → 忽略
```

**使用方式**：
```bash
# 启动文件监控器
node dist/cli/watcher.js

# 或在后台运行
node dist/cli/watcher.js &
```

## 实现细节

### 文件监控器的关键技术

1. **内容哈希比对**
   - 使用 MD5 哈希检测实际内容变化
   - 避免元数据变化导致的误报
   - 只在内容真正改变时触发恢复

2. **恢复锁机制**
   - 恢复文件时设置锁标志
   - 忽略正在恢复的文件的 watch 事件
   - 防止无限循环

3. **冷却期**
   - 每个文件 2 秒冷却期
   - 避免短时间内重复处理同一修改

4. **智能过滤**
   - 只监控受保护的文件和目录
   - 忽略非关键文件的变化

### 受保护的文件

- `agent.md`、`AGENT.md`、`.agent.md`
- `CLAUDE.md`、`COPILOT.md`、`.cursorrules`
- `.harness/config.yaml`
- `.harness/policies/*`
- `.harness/hooks/*`
- `.harness/semantic-hooks/*`

## 测试验证

### 测试场景

1. 启动文件监控器
2. 修改 agent.md：将 "Never run migrations directly on production" 改为 "Allow running migrations directly on production"
3. 观察监控器输出

### 测试结果

```
[watcher] ⚠️  Protected file modified: agent.md
[watcher] ✅ Restored: agent.md
```

✅ **检测成功**：监控器检测到修改
✅ **恢复成功**：文件自动恢复到原始内容
✅ **无无限循环**：只触发一次检测和恢复
✅ **Trace 记录**：违规行为记录到 `.harness/traces/2026-08-26.jsonl`

### Trace 日志示例

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

## 使用建议

### 对于支持 Hooks 的 Agent（Claude Code、Codex、Qoder）

```bash
# 1. 初始化项目
hannah init --agent=claude-code

# 2. 正常使用 Agent
claude

# Hook 会自动保护关键文件
```

### 对于不支持 Hooks 的 Agent（Copilot）

```bash
# 1. 初始化项目
hannah init --agent=copilot

# 2. 启动文件监控器
node dist/cli/watcher.js &

# 3. 使用 Copilot
copilot

# 文件监控器会保护关键文件
```

### 推荐：双重保护

```bash
# 1. 初始化项目（配置 hooks）
hannah init --agent=claude-code

# 2. 启动文件监控器（额外保护）
node dist/cli/watcher.js &

# 3. 使用 Agent
claude

# 双重保护：hooks + 文件监控
```

## 对比分析

| 特性 | Hook 机制 | 文件监控器 |
|------|----------|-----------|
| **适用 Agent** | Claude Code、Codex、Qoder | 所有 Agent |
| **保护时机** | 修改前阻止 | 修改后恢复 |
| **性能开销** | 低 | 中等（文件监控） |
| **可靠性** | 依赖 Agent 支持 | 独立于 Agent |
| **用户体验** | 无缝 | 需要启动监控器 |
| **保护强度** | 强（预防） | 中（检测+恢复） |

## 文件清单

### 新增文件

1. `src/cli/watcher.ts` - 文件监控器实现
2. `FILE_WATCHER_PROTECTION.md` - 文件监控器详细文档
3. `SOLUTION_SUMMARY.md` - 本文档

### 修改文件

1. `README.md` - 添加文件监控器说明
2. `src/bin.ts` - 添加 `watch` 命令（可选）

## 下一步

### 立即可用

```bash
# 编译项目
npm run build

# 启动文件监控器
node dist/cli/watcher.js

# 在另一个终端测试
# 修改 agent.md，观察监控器自动恢复
```

### 可选增强

1. **自动启动**：在 Agent 启动时自动启动文件监控器
2. **配置化**：允许自定义受保护的文件列表
3. **通知机制**：检测到违规时发送通知
4. **性能优化**：使用更高效的文件监控 API

## 总结

通过**双重保护机制**，我们解决了 Copilot 不支持 hooks 的问题：

✅ **Hook 机制**：为支持 hooks 的 Agent 提供预防性保护
✅ **文件监控器**：为所有 Agent 提供检测和恢复保护
✅ **统一保护**：无论使用哪个 Agent，关键文件都得到保护
✅ **完整审计**：所有违规行为记录到 trace 日志

现在，即使使用 Copilot，agent.md 中的红线规则也能得到有效保护！
