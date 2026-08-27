# 文件系统监控方案：统一 Agent 保护

## 问题背景

不同的 AI Agent 对 hooks 的支持程度不同：
- ✅ **Claude Code** - 完整支持 PreToolUse/PostToolUse hooks
- ✅ **Qoder** - 完整支持 hooks
- ✅ **Codex CLI** - 完整支持 hooks
- ❌ **GitHub Copilot** - **不支持 hooks**

这导致使用 Copilot 时，redline-protection 无法工作，agent.md 等关键文件可以被 AI 随意修改。

## 解决方案：文件系统监控

我们实现了一个**文件系统监控器（watcher）**，它不依赖 agent 的 hook 支持，而是通过监控文件系统来实现保护。

### 工作原理

```
1. 启动 watcher
   ↓
2. 备份所有受保护的文件到 .harness/.backups/
   ↓
3. 监控文件系统变化
   ↓
4. 检测到受保护文件被修改
   ↓
5. 立即从备份恢复文件
   ↓
6. 记录违规事件到 trace 日志
```

### 受保护的文件

- `agent.md` / `AGENT.md` / `.agent.md`
- `CLAUDE.md`
- `COPILOT.md`
- `.cursorrules`
- `.harness/config.yaml`
- `.harness/policies/*`
- `.harness/hooks/*`
- `.harness/semantic-hooks/*`

## 使用方法

### 1. 启动 watcher

```bash
# 在前台运行（可以看到实时日志）
hannah watch

# 在后台运行
hannah watch &
```

### 2. 正常使用 agent

无论使用哪个 agent（Copilot、Claude Code 等），watcher 都会保护关键文件。

```bash
# 使用 Copilot
copilot

# 使用 Claude Code
claude
```

### 3. 尝试修改受保护文件

如果 AI 尝试修改 agent.md：

```
AI: "我需要修改 agent.md 来..."
```

Watcher 会：
1. 检测到文件修改
2. 立即恢复文件到原始版本
3. 记录违规事件到 trace

### 4. 查看违规记录

```bash
# 查看最新的 trace 记录
hannah trace --denied

# 实时跟踪
hannah trace --follow
```

你会看到类似这样的记录：

```json
{
  "timestamp": "2026-08-26T17:15:09.034Z",
  "event": "redline.violation",
  "source": "file-watcher",
  "action": "deny",
  "payload": {
    "filePath": "agent.md",
    "eventType": "change",
    "message": "AI agent attempted to modify protected file"
  },
  "feedback": [
    "Redline file modification detected and reverted",
    "This file is protected and cannot be modified by AI agents"
  ]
}
```

## 两种保护机制对比

| 特性 | Hook 机制 | Watcher 机制 |
|------|----------|-------------|
| **支持范围** | 仅支持 hooks 的 agent | 所有 agent |
| **拦截时机** | 执行前拦截 | 执行后恢复 |
| **实时性** | 实时阻止 | 事后恢复 |
| **依赖** | agent 支持 | 文件系统监控 |
| **适用场景** | Claude Code, Qoder, Codex | Copilot, 所有 agent |

### 推荐使用方式

**双重保护**：同时使用 hook 机制和 watcher 机制

```bash
# 1. 初始化项目（配置 hooks）
hannah init --agent=claude-code

# 2. 启动 watcher（额外保护）
hannah watch &

# 3. 使用 agent
claude
```

这样即使 hook 机制失效，watcher 也会提供后备保护。

## 实现细节

### 核心代码

- `src/cli/watcher.ts` - 文件系统监控器
- 使用 Node.js 的 `fs.watch` API
- 支持递归监控整个项目目录

### 备份机制

- 备份目录：`.harness/.backups/`
- 首次启动时自动备份所有受保护文件
- 恢复时从备份复制回原位置

### Trace 集成

- 违规事件记录到 `.harness/traces/YYYY-MM-DD.jsonl`
- 事件类型：`redline.violation`
- 来源：`file-watcher`

## 测试验证

### 测试步骤

1. 启动 watcher：
   ```bash
   hannah watch
   ```

2. 在另一个终端修改 agent.md：
   ```bash
   echo "modified" >> agent.md
   ```

3. 检查 watcher 输出：
   ```
   [watcher] ⚠️  Protected file modified: agent.md
   [watcher] Restored: agent.md
   [watcher] ✅ File restored: agent.md
   ```

4. 验证文件已恢复：
   ```bash
   cat agent.md  # 应该显示原始内容
   ```

5. 查看 trace 记录：
   ```bash
   hannah trace --denied
   ```

## 限制和注意事项

### 限制

1. **事后恢复**：watcher 是在文件被修改后才恢复，不是事前阻止
2. **短暂不一致**：在恢复前，文件可能短暂包含修改内容
3. **性能开销**：持续监控文件系统会有一定开销

### 注意事项

1. **必须先启动 watcher**：在使用 agent 之前启动 `hannah watch`
2. **保持 watcher 运行**：关闭 watcher 会失去保护
3. **备份空间**：确保 `.harness/.backups/` 有足够的磁盘空间

## 未来改进

1. **文件锁定**：在 Windows 上使用文件锁定机制，事前阻止修改
2. **通知机制**：当检测到违规时发送通知（邮件、Slack 等）
3. **智能恢复**：只恢复被修改的部分，而不是整个文件
4. **白名单机制**：允许特定用户或进程修改受保护文件

## 总结

文件系统监控方案提供了一个**通用的、不依赖 agent 支持的保护机制**，确保无论使用哪个 AI agent，关键文件都能得到保护。

结合 hook 机制和 watcher 机制，我们可以实现：
- ✅ 对所有 agent 的统一保护
- ✅ 双重保险，提高可靠性
- ✅ 完整的审计追踪

---

**版本**: 0.2.3  
**最后更新**: 2026-08-27
