# Hook 适配器重构 - 集成指南

参考 Codex CLI Hooks 设计的详细集成步骤。

## 🎯 目标

将当前的 3-hook 系统升级到 8-hook 系统，增强配置灵活性和处理能力。

## 📋 需求清单

### 新增文件

- [ ] `src/core/hook-executor.ts` - 处理器执行引擎
- [ ] `src/core/hook-config-loader.ts` - 配置加载器
- [ ] `.harness/hooks/hooks.json` - Hook 处理器配置
- [ ] `.harness/hooks/config/hooks-config.json` - Hook 开关配置
- [ ] `.harness/hooks/logs/` - 日志目录

### 修改文件

- [ ] `src/adapters/base-adapter.ts` - 添加 v2 接口
- [ ] `.harness/hooks/handler.mjs` - 添加新事件处理
- [ ] `src/cli/init.ts` - 生成新配置文件

### 测试文件

- [ ] `src/core/__tests__/hook-executor.test.ts`
- [ ] `src/core/__tests__/hook-config-loader.test.ts`

## 🔧 第一阶段：基础设施设置

### Step 1: 导入并导出新模块

编辑 `src/core/index.ts`：

```typescript
// 新增导出
export {
  HookExecutor,
  type HookHandler,
  type HookResult,
} from "./hook-executor.js";
export {
  HookConfigurationLoader,
  type HookConfig,
} from "./hook-config-loader.js";
```

### Step 2: 在 Init 命令中生成新配置

编辑 `src/cli/init.ts`，在 `.harness/` 初始化时添加：

```typescript
// 创建新的 hook 配置目录结构
const harnessDir = path.join(targetDir, ".harness");
const hooksConfigDir = path.join(harnessDir, "hooks", "config");
const hooksLogsDir = path.join(harnessDir, "hooks", "logs");

fs.mkdirSync(hooksConfigDir, { recursive: true });
fs.mkdirSync(hooksLogsDir, { recursive: true });

// 写入示例配置（如果不存在）
const hooksPath = path.join(harnessDir, "hooks", "hooks.json");
if (!fs.existsSync(hooksPath)) {
  fs.copyFileSync(
    path.join(__dirname, "..", "..", ".harness", "hooks", "hooks.json.example"),
    hooksPath,
  );
}

const configPath = path.join(hooksConfigDir, "hooks-config.json");
if (!fs.existsSync(configPath)) {
  fs.copyFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      ".harness",
      "hooks",
      "config",
      "hooks-config.json.example",
    ),
    configPath,
  );
}
```

### Step 3: 构建并测试

```bash
pnpm run build
npm test
```

## 📝 第二阶段：运行时适配实现

### Step 1: 创建 HookAdapterV2 基类

创建 `src/adapters/hook-adapter-v2.ts`：

```typescript
import { BaseAdapter } from "./base-adapter.js";
import { HookExecutor } from "../core/hook-executor.js";
import { HookConfigurationLoader } from "../core/hook-config-loader.js";
import type { HookInput, HookResult } from "../core/hook-executor.js";

export abstract class HookAdapterV2 extends BaseAdapter {
  protected hookExecutor: HookExecutor;
  protected configLoader: HookConfigurationLoader;

  constructor(harnessDir: string = ".harness") {
    super();
    this.hookExecutor = new HookExecutor(
      path.join(harnessDir, "hooks", "logs"),
    );
    this.configLoader = new HookConfigurationLoader(harnessDir);
  }

  async executeHookChain(
    eventName: string,
    input: HookInput,
  ): Promise<HookResult> {
    const handlers = await this.configLoader.getHandlers(eventName);

    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.hookExecutor.executeHandlers(eventName, handlers, input);
  }

  abstract mapHookEvent(nativeEvent: string): string;
}
```

### Step 2: 针对每个运行时实现适配器

#### Codex 适配器（示例）

编辑/创建 `src/adapters/codex-v2.ts`：

```typescript
import { HookAdapterV2 } from "./hook-adapter-v2.js";
import type { CodexHookInput } from "./codex.js";

export class CodexAdapterV2 extends HookAdapterV2 {
  readonly name = "codex-v2";

  async handlePreToolUse(input: CodexHookInput): Promise<any> {
    const result = await this.executeHookChain("PreToolUse", {
      sessionId: input.session_id,
      hookEvent: "tool.before",
      source: "codex",
      cwd: input.cwd,
      toolName: input.tool_name,
      toolInput: input.tool_input,
    });

    return {
      decision: result.decision,
      reason: result.reason,
      context: result.context,
    };
  }

  async handlePostToolUse(input: CodexHookInput): Promise<void> {
    await this.executeHookChain("PostToolUse", {
      sessionId: input.session_id,
      hookEvent: "tool.after",
      source: "codex",
      cwd: input.cwd,
      toolName: input.tool_name,
    });
  }

  async handleStop(input: CodexHookInput): Promise<any> {
    const result = await this.executeHookChain("Stop", {
      sessionId: input.session_id,
      hookEvent: "confirm.before",
      source: "codex",
      cwd: input.cwd,
    });

    return {
      decision: result.decision,
      reason: result.reason,
    };
  }

  mapHookEvent(nativeEvent: string): string {
    const map: Record<string, string> = {
      PreToolUse: "tool.before",
      PostToolUse: "tool.after",
      Stop: "confirm.before",
      SessionStart: "session.start",
      UserPromptSubmit: "prompt.submit",
      PermissionRequest: "permission.request",
      PreCompact: "context.before_compact",
      PostCompact: "context.after_compact",
    };
    return map[nativeEvent] || nativeEvent;
  }
}
```

### Step 3: 为每个运行时创建对应的 V2 适配器

- [ ] `CodexAdapterV2`
- [ ] `CopilotAdapterV2`
- [ ] `ClaudeCodeAdapterV2`
- [ ] `QoderAdapterV2`
- [ ] `TraeAdapterV2`

## 🔄 第三阶段：更新 handler.mjs

编辑 `.harness/hooks/handler.mjs`，添加新事件处理：

```javascript
async function main() {
  const mode = process.argv[2];

  const modes = [
    "session-start",
    "pre-tool-use",
    "permission-request",
    "post-tool-use",
    "stop",
    "user-prompt-submit",
    "pre-compact",
    "post-compact",
  ];

  if (!modes.includes(mode)) {
    console.error(`Usage: handler.mjs <${modes.join("|")}>`);
    process.exit(1);
  }

  let input;
  try {
    input = await readStdin();
  } catch {
    process.exit(0);
  }

  const eventMap: Record<string, string> = {
    "session-start": "session.start",
    "pre-tool-use": "tool.before",
    "permission-request": "permission.request",
    "post-tool-use": "tool.after",
    "stop": "confirm.before",
    "user-prompt-submit": "prompt.submit",
    "pre-compact": "context.before_compact",
    "post-compact": "context.after_compact",
  };

  const eventName = eventMap[mode];

  // ... 处理事件
}
```

## 📊 第四阶段：测试与验证

### 单元测试

```bash
# 测试 HookExecutor
npm test src/core/__tests__/hook-executor.test.ts

# 测试 HookConfigurationLoader
npm test src/core/__tests__/hook-config-loader.test.ts

# 测试适配器
npm test src/adapters/__tests__/hook-adapter-v2.test.ts
```

### 集成测试

```bash
# 在项目中测试 hook 执行
hannah init --agent=codex

# 手动触发 hook
echo '{"sessionId":"test","hookEvent":"tool.before",...}' | \
  node .harness/hooks/handler.mjs pre-tool-use

# 查看日志
hannah trace --follow
```

## 🚀 迁移步骤

### 向后兼容性阶段

1. **保留 v1 适配器**
   - 继续支持旧代码
   - 在日志中标记为 "deprecated"

2. **并行运行 v1 和 v2**
   - 新项目使用 v2
   - 旧项目继续使用 v1

3. **平缓过渡期（4-8 周）**
   - 文档升级
   - 用户反馈
   - 问题修复

### 完全迁移

```bash
# 升级现有项目
hannah migrate --from-v1 --to-v2

# 这会：
# 1. 备份旧配置
# 2. 生成新配置文件
# 3. 迁移现有规则
# 4. 更新文档
```

## 📚 配置示例

### 启用所有 8 个 hooks

```json
{
  "hooks": {
    "SessionStart": [...],
    "PreToolUse": [...],
    "PermissionRequest": [...],
    "PostToolUse": [...],
    "Stop": [...],
    "UserPromptSubmit": [...],
    "PreCompact": [...],
    "PostCompact": [...]
  }
}
```

### 本地禁用某个 hook（.local.json）

```json
{
  "disablePermissionRequestHook": true
}
```

### 自定义处理器优先级

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "...",
        "priority": 100 // 先执行
      },
      {
        "command": "...",
        "priority": 50 // 后执行
      }
    ]
  }
}
```

## 📈 预期收益

✅ **功能覆盖**：3 → 8 hooks（166% 增长）  
✅ **配置灵活性**：支持本地覆盖和热更新  
✅ **处理能力**：支持处理器链和优先级  
✅ **可观测性**：详细的 JSONL 日志和统计  
✅ **用户体验**：更好的状态消息和 timeout 控制

## 🔗 相关资源

- [Hook 执行器 API](../../src/core/hook-executor.ts)
- [Hook 配置加载器 API](../../src/core/hook-config-loader.ts)
- [HookAdapterV2 基类](../../src/adapters/hook-adapter-v2.ts)
- [参考 Codex CLI Hooks](https://github.com/shanraisshan/codex-cli-hooks)
- [原始 Hook 设计](hook-adaptation-table.md)

## ❓ 常见问题

**Q: 如何在不影响现有系统的情况下开始使用 v2？**  
A: 通过 `hannah init --experimental-v2` 使用新配置，旧代码继续工作。

**Q: 如何从 v1 迁移到 v2？**  
A: 运行 `hannah migrate` 自动进行转换。

**Q: 本地覆盖文件会被 git 忽略吗？**  
A: 是的，`hooks-config.local.json` 被添加到 `.gitignore`。

**Q: 如果 hook 处理器超时会发生什么？**  
A: 日志会记录为 "timeout"，系统继续运行（除非配置了 fail-fast）。
