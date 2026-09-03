# Hook 适配器 v2 快速参考

## 快速开始

### 为新运行时实现 Hook 支持（5 分钟）

#### Step 1: 创建适配器文件

```typescript
// src/adapters/my-runtime-adapter-v2.ts

import { HookAdapterV2, type HookCapabilities } from "./hook-adapter-v2.js";

export class MyRuntimeAdapterV2 extends HookAdapterV2 {
  readonly name = "my-runtime-v2";

  readonly hookCapabilities: HookCapabilities = {
    SessionStart: true,
    PreToolUse: true,
    PermissionRequest: false, // 可选功能
    PostToolUse: true,
    Stop: true,
    UserPromptSubmit: false,
    PreCompact: false,
    PostCompact: false,
  };
}
```

#### Step 2: 在适配器中添加特定于运行时的处理器

```typescript
async handleMyRuntimeEvent(input: MyRuntimeInput): Promise<MyRuntimeOutput> {
  const context = {
    sessionId: input.session_id,
    source: "my-runtime",
    timestamp: new Date(),
    cwd: input.working_dir,
  };

  const result = await this.onPreToolUse(context, {
    toolName: input.tool_name,
    toolInput: input.tool_input,
  });

  return {
    decision: result.decision === "deny" ? "rejected" : "approved",
    reason: result.reason,
  };
}
```

#### Step 3: 在运行时代码中调用

```typescript
const adapter = new MyRuntimeAdapterV2();
await adapter.initialize();

const result = await adapter.handleMyRuntimeEvent({
  session_id: "abc123",
  tool_name: "file_editor",
  tool_input: { action: "write", file: "test.txt" },
  working_dir: process.cwd(),
});

if (result.decision === "rejected") {
  throw new Error(`Hook denied: ${result.reason}`);
}
```

## 配置管理

### 启用/禁用 Hooks

```json
// .harness/hooks/config/hooks-config.local.json
{
  "disablePermissionRequestHook": true,
  "disablePreCompactHook": true
}
```

### 自定义处理器

```json
// .harness/hooks/hooks.json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "shell",
        "command": "bash ./scripts/validate-tool.sh",
        "timeout": 5000,
        "priority": 100
      },
      {
        "type": "python",
        "command": "python3 ./scripts/audit.py",
        "timeout": 10000,
        "priority": 50
      }
    ]
  }
}
```

### 处理器执行顺序

```
Priority: 100 ✓ 先执行
Priority: 75  ✓ 次之
Priority: 50  ✓ 最后
```

返回结果：

- 返回 deny → 立即停止并返回 deny
- 返回 warn → 继续执行
- shouldBreak: true → 立即停止

## 事件参考

### SessionStart

```typescript
await adapter.onSessionStart({
  sessionId: "sess_123",
  source: "codex",
  timestamp: new Date(),
  cwd: "/project",
  metadata: { model: "claude-3", user: "alice" },
});
```

### PreToolUse

```typescript
await adapter.onPreToolUse(
  { sessionId: "sess_123", ... },
  { toolName: "file_editor", toolInput: { action: "write" } }
);
```

### PostToolUse

```typescript
await adapter.onPostToolUse(
  { sessionId: "sess_123", ... },
  { toolName: "file_editor", toolOutput: { success: true, file: "test.txt" } }
);
```

### PermissionRequest

```typescript
await adapter.onPermissionRequest(
  { sessionId: "sess_123", ... },
  { resource: "database", action: "delete", details: { table: "users" } }
);
```

### Stop

```typescript
await adapter.onStop({
  sessionId: "sess_123",
  source: "codex",
  timestamp: new Date(),
  cwd: "/project",
});
```

### UserPromptSubmit

```typescript
await adapter.onUserPromptSubmit(
  { sessionId: "sess_123", ... },
  { promptText: "Fix the bug in login.ts", context: { file: "login.ts" } }
);
```

### PreCompact

```typescript
await adapter.onPreCompact(
  { sessionId: "sess_123", ... },
  { oldSize: 50000, newSize: 25000, strategy: "summarize" }
);
```

### PostCompact

```typescript
await adapter.onPostCompact(
  { sessionId: "sess_123", ... },
  { oldSize: 50000, newSize: 25000, strategy: "summarize" }
);
```

## 常见模式

### Pattern 1: 简单的权限检查

```typescript
const result = await adapter.onPreToolUse(context, toolInfo);
if (result.decision === "deny") {
  throw new Error(`Tool not allowed: ${result.reason}`);
}
```

### Pattern 2: 审计日志

```typescript
const stats = await adapter.getHookStatistics(7);
console.log(`Denied tools: ${stats.byDecision.deny || 0}`);
```

### Pattern 3: 动态启用/禁用

```typescript
// 临时禁用权限检查
await adapter.enableHook("PermissionRequest", false);

// 稍后重新启用
await adapter.enableHook("PermissionRequest", true);
```

### Pattern 4: 能力检测

```typescript
const capabilities = await adapter.getCapabilities();
if (capabilities.PreCompact) {
  await adapter.onPreCompact(context, compactInfo);
}
```

## 调试

### 查看最近的 hook 日志

```bash
# 最后一小时的 hook 执行
tail -f .harness/hooks/logs/hook-$(date +%Y-%m-%d).jsonl

# 查看所有 deny 决策
grep '"decision":"deny"' .harness/hooks/logs/*.jsonl

# 查看超时事件
grep '"status":"timeout"' .harness/hooks/logs/*.jsonl
```

### 检查适配器状态

```typescript
const status = await adapter.getHealthStatus();
console.log(`Healthy: ${status.healthy}`);
console.log(`Supported hooks: ${status.hooks.join(", ")}`);
```

### 导出指标用于监控

```typescript
const metrics = await adapter.exportMetrics();
console.log(JSON.stringify(metrics, null, 2));
```

## 错误处理

### Hook 执行失败

如果 hook 处理器失败：

1. 错误被记录
2. 返回 `{ decision: "allow", reason: "..." }`
3. 处理流程继续（优雅降级）

```typescript
try {
  const result = await adapter.onPreToolUse(context, toolInfo);
  // result 总是返回有效的 HookResult
} catch (error) {
  // 这里不会被触发（异常已被处理）
}
```

### 超时处理

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "command": "...",
        "timeout": 5000 // 5 秒超时
      }
    ]
  }
}
```

如果处理器超时：

- 日志记录为 "timeout"
- 返回错误但继续执行

## 监控与观测

### Hook 执行统计

```typescript
const stats = await adapter.getHookStatistics(days);
// {
//   total: 42,
//   byEvent: { PreToolUse: 15, Stop: 27 },
//   byDecision: { allow: 35, deny: 7 },
//   byStatus: { success: 40, timeout: 2 },
//   avgDuration: 234  // ms
// }
```

### 日志查询

```typescript
const logs = await hookExecutor.queryLogs(
  new Date("2024-01-01"),
  new Date("2024-01-31"),
);

for (const log of logs) {
  console.log(`${log.timestamp} ${log.hookEvent} ${log.decision}`);
}
```

## 最佳实践

✅ **DO**

- 为每个运行时继承 HookAdapterV2
- 在初始化时调用 `await adapter.initialize()`
- 使用 hook 结果来判断是否继续
- 在超时值上保持合理（5-30 秒）
- 记录重要的业务事件

❌ **DON'T**

- 修改返回的 HookResult 对象
- 假设所有 hooks 都支持（检查能力矩阵）
- 在 hook 中执行长时间操作（>30s）
- 忽略 hook 错误（总是检查决策）
- 在生产中禁用所有 hooks

## 相关资源

- [Hook 适配器 API 文档](../src/adapters/hook-adapter-v2.ts)
- [HookExecutor 文档](../src/core/hook-executor.ts)
- [配置加载器文档](../src/core/hook-config-loader.ts)
- [集成指南](./HOOK-ADAPTER-INTEGRATION.md)
- [Codex 适配器示例](../src/adapters/codex-adapter-v2.ts)
