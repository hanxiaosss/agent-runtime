# Hook 适配器重构方案

参考 Codex CLI Hooks 设计，对当前项目的 hook 适配器进行重构。

## 目标

1. **扩展 Hook 事件覆盖范围**：从 3 个基本 hooks → 8 个完整 hooks
2. **改进配置管理**：支持多层配置和本地覆盖
3. **增强处理链**：支持多个处理器链和优先级
4. **完善日志系统**：统一的 JSONL 日志格式

## 新 Hook 事件清单

|  #  | Hook 名称           | 当前支持 | 重构后 | 描述                 |
| :-: | ------------------- | -------- | ------ | -------------------- |
|  1  | `SessionStart`      | ❌       | ✅     | 会话开始时注入上下文 |
|  2  | `PreToolUse`        | ✅       | ✅     | 工具执行前（保留）   |
|  3  | `PermissionRequest` | ❌       | ✅     | 敏感操作权限请求     |
|  4  | `PostToolUse`       | ✅       | ✅     | 工具执行后（保留）   |
|  5  | `Stop`              | ✅       | ✅     | 会话结束（保留）     |
|  6  | `UserPromptSubmit`  | ❌       | ✅     | 用户提交 prompt      |
|  7  | `PreCompact`        | ❌       | ✅     | 上下文压缩前         |
|  8  | `PostCompact`       | ❌       | ✅     | 上下文压缩后         |

## 配置架构重构

### 1. 新的配置文件结构

```
.harness/
├── config.yaml                    # 主配置（保留）
├── hooks/
│   ├── hooks.json                 # Hook 事件处理器配置（新）
│   └── config/
│       ├── hooks-config.json      # 全局 hook 开关配置（新）
│       └── hooks-config.local.json # 本地个性化配置（新，git-ignore）
├── policies/                       # 策略文件（保留）
└── traces/                         # 日志（保留）
```

### 2. hooks.json 配置格式

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs session-start",
        "statusMessage": "Initializing session hooks...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "PreToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs pre-tool-use",
        "statusMessage": "Running pre-tool-use hook...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "PermissionRequest": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs permission-request",
        "statusMessage": "Requesting permission...",
        "timeout": 30,
        "priority": 100
      }
    ],
    "PostToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs post-tool-use",
        "statusMessage": "Running post-tool-use hook...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "Stop": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs stop",
        "statusMessage": "Running session stop hook...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "UserPromptSubmit": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs user-prompt-submit",
        "statusMessage": "Processing user prompt...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "PreCompact": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs pre-compact",
        "statusMessage": "Running pre-compact hook...",
        "timeout": 10,
        "priority": 100
      }
    ],
    "PostCompact": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs post-compact",
        "statusMessage": "Running post-compact hook...",
        "timeout": 10,
        "priority": 100
      }
    ]
  }
}
```

### 3. hooks-config.json 开关配置

```json
{
  "disableSessionStartHook": false,
  "disablePreToolUseHook": false,
  "disablePermissionRequestHook": false,
  "disablePostToolUseHook": false,
  "disableStopHook": false,
  "disableUserPromptSubmitHook": false,
  "disablePreCompactHook": false,
  "disablePostCompactHook": false,
  "disableLogging": false
}
```

## 适配器架构改进

### 1. Hook 事件定义扩展

```typescript
// src/core/hook.ts

export type HookEventName =
  | "session.start"
  | "tool.before"
  | "permission.request"
  | "tool.after"
  | "session.stop"
  | "prompt.submit"
  | "context.before_compact"
  | "context.after_compact";

export interface HookHandler {
  type: "shell" | "javascript" | "python";
  command?: string;
  statusMessage?: string;
  timeout?: number;
  priority?: number;
}

export interface HookConfig {
  hooks: Record<string, HookHandler[]>;
}
```

### 2. 处理器执行引擎

```typescript
// src/core/hook-executor.ts (新文件)

export class HookExecutor {
  async executeHandlers(
    handlers: HookHandler[],
    input: HookInput,
    context: ExecutionContext,
  ): Promise<HookResult> {
    // 按 priority 排序
    const sorted = handlers.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );

    for (const handler of sorted) {
      if (handler.type === "shell") {
        const result = await this.executeShell(handler, input);
        if (result.shouldBreak) {
          return result;
        }
      }
    }

    return { decision: "allow" };
  }

  private async executeShell(
    handler: HookHandler,
    input: HookInput,
  ): Promise<HookResult> {
    // 执行 shell 命令并解析结果
  }
}
```

### 3. 适配器层改进

```typescript
// src/adapters/hook-adapter-v2.ts (新文件)

export abstract class HookAdapterV2 extends BaseAdapter {
  protected hookConfig?: HookConfig;
  protected hookExecutor: HookExecutor;

  async loadHookConfig(configPath: string): Promise<void> {
    // 加载和验证 hooks.json
  }

  async executeHookChain(
    eventName: string,
    input: HookInput,
  ): Promise<HookResult> {
    const handlers = this.hookConfig?.hooks[eventName] || [];
    return this.hookExecutor.executeHandlers(handlers, input, this.context);
  }

  abstract getEventName(hookType: string): string;
}
```

### 4. 运行时特定适配器

```typescript
// 针对每个运行时的适配器都继承 HookAdapterV2

export class CodexAdapterV2 extends HookAdapterV2 {
  // Codex 特定实现
  // 支持 SessionStart, PreToolUse, PostToolUse, Stop 等
}

export class CopilotAdapterV2 extends HookAdapterV2 {
  // Copilot 特定实现
}

export class ClaudeCodeAdapterV2 extends HookAdapterV2 {
  // Claude Code 特定实现
}
```

## 日志系统改进

### JSONL 日志格式标准化

```json
{
  "timestamp": "2026-09-02T10:30:45.123Z",
  "hookEvent": "tool.before",
  "hookName": "PreToolUse",
  "source": "codex",
  "sessionId": "sess-123",
  "status": "success",
  "action": "allow",
  "duration": 245,
  "payload": {
    "toolName": "write_file",
    "input": {...}
  },
  "feedback": []
}
```

### 日志管理

```typescript
// src/core/hook-logger.ts (新文件)

export class HookLogger {
  async logHookEvent(event: HookLogEntry): Promise<void> {
    // 写入 .harness/hooks/logs/hook-{date}.jsonl
  }

  async queryLogs(filter: LogFilter): Promise<HookLogEntry[]> {
    // 查询日志
  }

  async getStatistics(range: DateRange): Promise<LogStatistics> {
    // 统计分析
  }
}
```

## 迁移路径

### Phase 1: 基础设施（第一周）

- [ ] 创建 `HookExecutor` 类
- [ ] 创建 `HookLogger` 类
- [ ] 创建 `HookAdapterV2` 基类
- [ ] 创建新配置文件格式

### Phase 2: 运行时适配（第二周）

- [ ] 实现 `CodexAdapterV2`
- [ ] 实现 `CopilotAdapterV2`
- [ ] 实现 `ClaudeCodeAdapterV2`
- [ ] 实现 `QoderAdapterV2`
- [ ] 实现 `TraeAdapterV2`

### Phase 3: 新 Hook 事件支持（第三周）

- [ ] 在 handler.mjs 中添加新事件处理
- [ ] 在各适配器中映射新事件
- [ ] 编写新事件的语义 hooks

### Phase 4: 测试与文档（第四周）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 更新文档
- [ ] 迁移指南

## 关键改进点

### 1. 处理器链支持

```typescript
// 支持多个处理器，按优先级执行
"PreToolUse": [
  { "command": "...", "priority": 100 },  // 先执行
  { "command": "...", "priority": 50 }    // 后执行
]
```

### 2. 本地配置覆盖

- 全局配置：`.harness/hooks/config/hooks-config.json`
- 本地覆盖：`.harness/hooks/config/hooks-config.local.json` (git-ignored)
- 优先级：local > global

### 3. 更好的 sessionStart 支持

```typescript
// SessionStart hook 可以注入上下文：
{
  "decision": "allow",
  "context": {
    "gitBranch": "main",
    "gitStatus": "clean",
    "cwd": "/path/to/project",
    "timestamp": "2026-09-02T10:30:45.123Z"
  }
}
```

### 4. PermissionRequest 支持

```typescript
// 需要用户确认的敏感操作
{
  "event": "permission.request",
  "operation": "drop_database",
  "details": {...},
  "timeout": 30
}
```

## 向后兼容性

- 保留现有的 `BaseAdapter` 接口
- v1 适配器继续工作（deprecated）
- 新代码使用 v2 适配器
- 过渡期提供兼容层

## 预期收益

✅ **功能扩展**：从 3 个 → 8 个 hook 事件  
✅ **配置灵活性**：支持本地覆盖和热更新  
✅ **处理能力**：支持处理器链和优先级  
✅ **可观测性**：更详细的日志和统计  
✅ **用户体验**：更好的状态消息和 timeout 控制

## 参考资料

- [Codex CLI Hooks](https://github.com/shanraisshan/codex-cli-hooks)
- [当前项目 Hook 设计](./guidelines/hook-adaptation-table.md)
- [Event 分类](../src/core/event.ts)
