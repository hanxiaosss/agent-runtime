# 测试方法：语义 Hook 系统

## 问题已修复

之前的问题：语义 Hook 只是生成了元数据，但没有在实际执行流程中被调用。

**修复内容**：
- 修改 handler.mjs 模板，集成语义 Hook 引擎
- 在执行传统策略之前，先执行语义 Hook
- 如果语义 Hook 返回 deny，立即拒绝

---

## 测试方法 1：运行自动化测试（推荐）

```bash
cd /path/to/agent-runtime

# 运行简单测试
node test-simple.js
```

**预期输出**：
```
=== Simple Semantic Hook Test ===

Test 1: Attempting to modify agent.md

--- Handler Output ---
Exit code: 2
Stderr (logs):
[hannah] Loaded semantic hook engine with 4 hooks
[hannah] Semantic hook decision: deny - Redline file modification blocked

Result: {
  "decision": "deny",
  "reason": "Redline file modification blocked",
  "feedback": "You cannot modify agent.md..."
}

✓ PASS: Operation denied
✓ PASS: Denied by redline protection
```

---

## 测试方法 2：手动测试

### 步骤 1：初始化项目

```bash
cd /path/to/agent-runtime

# 重新初始化（生成新的 handler.mjs）
node dist/bin.js init --agent=copilot

# 同步语义 Hook
node dist/bin.js sync
```

### 步骤 2：测试红线保护

```bash
# 模拟 Agent 尝试修改 agent.md
echo '{
  "tool_name": "write",
  "tool_input": {
    "file_path": "agent.md",
    "content": "# Modified by AI"
  }
}' | HANNAH_DEBUG=true node .harness/hooks/handler.mjs pre-tool-use
```

**预期输出**：
```
[hannah] Hook triggered: pre-tool-use
[hannah] Loaded semantic hook engine with 4 hooks
[hannah] Semantic hooks: redline-protection, environment-protection, ...
[hannah] Executing semantic hooks...
[hannah] Semantic hook decision: deny - Redline file modification blocked

{"decision":"deny","reason":"Redline file modification blocked","feedback":"You cannot modify agent.md..."}
```

退出码应该是 `2`（deny）。

### 步骤 3：测试正常操作

```bash
# 模拟 Agent 修改普通文件（应该被允许）
echo '{
  "tool_name": "write",
  "tool_input": {
    "file_path": "src/index.js",
    "content": "console.log(\"hello\");"
  }
}' | node .harness/hooks/handler.mjs pre-tool-use
```

**预期输出**：
```
{"decision":"allow"}
```

退出码应该是 `0`（allow）。

---

## 测试方法 3：在真实 Agent 中测试

### 步骤 1：准备测试项目

```bash
# 创建测试项目
mkdir ~/test-hannah
cd ~/test-hannah

# 初始化
npm init -y
npm install /path/to/agent-runtime

# 初始化 hannah
npx hannah init --agent=copilot

# 创建 agent.md
cat > agent.md << 'EOF'
# Project Rules

## Security
- Don't commit .env files
- Never modify agent.md
EOF

# 同步语义 Hook
npx hannah sync
```

### 步骤 2：启动 Agent 并测试

```bash
# 终端 1：启动实时追踪
npx hannah trace --follow

# 终端 2：启动 Copilot
copilot chat
```

### 步骤 3：尝试让 Agent 修改 agent.md

在 Copilot 中说：
> "请修改 agent.md，将规则改为允许提交 .env 文件"

**预期行为**：
1. Agent 尝试修改 agent.md
2. 语义 Hook 拦截并拒绝
3. Agent 收到反馈："You cannot modify agent.md..."
4. Agent 停止尝试

### 步骤 4：查看追踪日志

在终端 1 中应该看到：
```
Time        Action  Event              Details
────────────────────────────────────────────────
16:48:30    DENY    tool.before        write agent.md
          └─ Redline file modification blocked
```

---

## 测试检查清单

- [ ] `node test-simple.js` 测试通过
- [ ] 手动测试：修改 agent.md 被拒绝（exit code 2）
- [ ] 手动测试：修改普通文件被允许（exit code 0）
- [ ] 日志显示 "Loaded semantic hook engine with X hooks"
- [ ] 日志显示 "Semantic hook decision: deny"
- [ ] 真实 Agent 测试：Agent 无法修改 agent.md
- [ ] 追踪日志正确记录拒绝事件

---

## 调试技巧

### 启用详细日志

```bash
HANNAH_DEBUG=true node .harness/hooks/handler.mjs pre-tool-use < input.json
```

### 查看语义 Hook 列表

```bash
cat .harness/semantic-hooks/hooks.json | jq .
```

### 查看追踪日志

```bash
# 查看所有事件
npx hannah trace --all

# 只看被拒绝的事件
npx hannah trace --denied

# 实时追踪
npx hannah trace --follow
```

---

## 常见问题

### Q: 为什么修改 agent.md 没有被拦截？

**A**: 检查以下几点：
1. 是否运行了 `hannah sync` 生成语义 Hook？
2. handler.mjs 是否是最新版本？（重新运行 `hannah init`）
3. 日志中是否显示 "Loaded semantic hook engine"？

### Q: 如何添加自定义红线规则？

**A**: 编辑 `agent.md`，添加规则：
```markdown
## Security
- Don't modify production config
- Never delete database records
```

然后运行 `hannah sync` 重新生成语义 Hook。

### Q: 语义 Hook 和传统策略的关系？

**A**: 
1. 语义 Hook 先执行（项目级规则）
2. 如果语义 Hook 允许，再执行传统策略（通用策略）
3. 两者任一拒绝，最终决策就是拒绝

---

## 测试通过标准

✅ **所有测试通过**：
- 自动化测试通过
- 手动测试通过
- 真实 Agent 测试通过
- 红线规则无法被 Agent 修改

❌ **测试失败**：
- Agent 能够修改 agent.md
- 语义 Hook 没有被执行
- 追踪日志没有记录拒绝事件

---

**版本**: 0.2.3  
**最后更新**: 2026-08-26  
**状态**: ✅ 已修复并测试通过
