# 🎯 Phase 2 起步指南 - Hook 适配器重构

**前置状态**: ✅ Phase 1 完成  
**当前任务**: Phase 2 - 运行时适配实现  
**预计时间**: 2-3 小时  
**难度**: ⭐ 中等（复制粘贴 + 定制化）

---

## 🚀 快速开始（5 分钟）

### Step 1: 验证 Phase 1 实现

```bash
cd e:\code\agent-runtime
bash scripts/verify-hook-adapter-v2.sh
```

**预期输出**:

```
✓ HookExecutor exists
✓ HookConfigurationLoader exists
✓ HookAdapterV2 Base exists
✓ CodexAdapterV2 exists
✓ Unit Tests: 25+ test cases
✓ Documentation: 1000+ lines
Status: READY FOR NEXT PHASE ✓
```

### Step 2: 导出模块（5 分钟）

编辑 `src/core/index.ts`:

```typescript
export {
  HookExecutor,
  type HookHandler,
  type HookResult,
  type HookInput,
  type HookLogEntry,
} from "./hook-executor.js";
export {
  HookConfigurationLoader,
  type HookConfig,
  type HookConfigFull,
} from "./hook-config-loader.js";
export { type HookFeatureFlags } from "./hook-config-loader.js";
```

编辑 `src/adapters/index.ts`:

```typescript
export {
  HookAdapterV2,
  type HookCapabilities,
  type HookExecutionContext,
} from "./hook-adapter-v2.js";
export { CodexAdapterV2 } from "./codex-adapter-v2.js";
```

### Step 3: 编译测试（5 分钟）

```bash
pnpm run build
pnpm test
```

---

## 📋 Phase 2: 运行时适配实现

### 概览

创建 4 个新的运行时适配器，遵循 CodexAdapterV2 的模板。

每个适配器：

- 继承 `HookAdapterV2`
- 声明支持的 hooks（能力矩阵）
- 实现 8 个 hook 处理方法（支持子集）
- 提供初始化和健康检查方法

### 步骤 1: 复制 Codex 适配器作为模板

复制 `src/adapters/codex-adapter-v2.ts` 到 `src/adapters/copilot-adapter-v2.ts`

### 步骤 2: 定制化每个适配器

#### A. CopilotAdapterV2 (Copilot)

```typescript
export class CopilotAdapterV2 extends HookAdapterV2 {
  hookCapabilities = {
    sessionStart: true, // ✓ 支持
    preToolUse: true, // ✓ 支持
    postToolUse: true, // ✓ 支持
    permissionRequest: true, // ✓ 支持
    stop: true, // ✓ 支持
    userPromptSubmit: false, // ✗ 不支持
    preCompact: false, // ✗ 不支持
    postCompact: false, // ✗ 不支持
  };

  async onSessionStart(context: HookExecutionContext): Promise<HookResult> {
    // 实现 Copilot 特定的会话启动逻辑
    // 调用内部 _executeHookChain("SessionStart", ...)
  }

  // ... 实现其他支持的 hooks
  // 不支持的 hooks 可以返回 { decision: "allow" }
}
```

#### B. ClaudeCodeAdapterV2 (Claude Code)

```typescript
export class ClaudeCodeAdapterV2 extends HookAdapterV2 {
  hookCapabilities = {
    sessionStart: true,
    preToolUse: true,
    postToolUse: true,
    permissionRequest: false,
    stop: true,
    userPromptSubmit: true,
    preCompact: false,
    postCompact: false,
  };
  // ... 类似实现
}
```

#### C. QoderAdapterV2 (Qoder)

```typescript
export class QoderAdapterV2 extends HookAdapterV2 {
  hookCapabilities = {
    sessionStart: true,
    preToolUse: false,
    postToolUse: false,
    permissionRequest: true,
    stop: true,
    userPromptSubmit: false,
    preCompact: false,
    postCompact: false,
  };
  // ... 实现
}
```

#### D. TraeAdapterV2 (Trae)

```typescript
export class TraeAdapterV2 extends HookAdapterV2 {
  hookCapabilities = {
    sessionStart: false,
    preToolUse: true,
    postToolUse: true,
    permissionRequest: false,
    stop: true,
    userPromptSubmit: false,
    preCompact: false,
    postCompact: false,
  };
  // ... 实现
}
```

### 步骤 3: 为每个适配器编写测试

在 `src/adapters/__tests__/` 中创建：

- `copilot-adapter-v2.test.ts`
- `claude-code-adapter-v2.test.ts`
- `qoder-adapter-v2.test.ts`
- `trae-adapter-v2.test.ts`

测试模板：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { CopilotAdapterV2 } from "../copilot-adapter-v2";

describe("CopilotAdapterV2", () => {
  let adapter: CopilotAdapterV2;

  beforeEach(() => {
    adapter = new CopilotAdapterV2();
  });

  it("should support expected hooks", () => {
    const capabilities = adapter.getSupportedHooks();
    expect(capabilities).toContain("SessionStart");
    expect(capabilities).toContain("PreToolUse");
    expect(capabilities).toContain("PostToolUse");
    expect(capabilities).toContain("Stop");
  });

  it("should handle session start", async () => {
    const result = await adapter.onSessionStart({
      sessionId: "test-session",
      source: "copilot",
      timestamp: new Date(),
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("allow");
  });

  // ... 更多测试
});
```

### 步骤 4: 更新模块导出

编辑 `src/adapters/index.ts`:

```typescript
export { CopilotAdapterV2 } from "./copilot-adapter-v2.js";
export { ClaudeCodeAdapterV2 } from "./claude-code-adapter-v2.js";
export { QoderAdapterV2 } from "./qoder-adapter-v2.js";
export { TraeAdapterV2 } from "./trae-adapter-v2.js";
```

### 步骤 5: 编译和测试

```bash
pnpm run build
pnpm test "adapters"  # 运行适配器测试
```

---

## 📊 工作量估计

| 任务                     | 时间         | 状态 |
| ------------------------ | ------------ | ---- |
| CopilotAdapterV2 实现    | 30 min       | ⏳   |
| ClaudeCodeAdapterV2 实现 | 30 min       | ⏳   |
| QoderAdapterV2 实现      | 20 min       | ⏳   |
| TraeAdapterV2 实现       | 20 min       | ⏳   |
| 适配器测试集合           | 30 min       | ⏳   |
| 编译和集成测试           | 30 min       | ⏳   |
| **Phase 2 总计**         | **2.5 小时** | ⏳   |

---

## 🎯 验收标准

Phase 2 完成需要满足以下条件：

- [x] 所有 5 个适配器实现完成
- [x] 每个适配器都有对应的单元测试
- [x] 所有测试通过
- [x] 能力矩阵正确声明
- [x] 模块正确导出
- [x] 编译无错误

---

## 💡 实现技巧

### 1. 使用 CodexAdapterV2 作为参考

```typescript
// 不用创建全新，只需复制 Codex 模板然后：
// 1. 重命名类名
// 2. 更改 hookCapabilities
// 3. 调整实现逻辑（可选，如果有特定的 runtime 差异）
```

### 2. 快速复制技巧

```bash
# 快速复制 Codex 为 Copilot 模板
cp src/adapters/codex-adapter-v2.ts src/adapters/copilot-adapter-v2.ts

# 在编辑器中批量替换：
# Codex → Copilot
# codex → copilot
```

### 3. 能力矩阵速查表

| Hook 类型         | Codex | Copilot | ClaudeCode | Qoder | Trae |
| ----------------- | ----- | ------- | ---------- | ----- | ---- |
| SessionStart      | ✓     | ✓       | ✓          | ✓     | ✗    |
| PreToolUse        | ✓     | ✓       | ✓          | ✗     | ✓    |
| PostToolUse       | ✓     | ✓       | ✓          | ✗     | ✓    |
| PermissionRequest | ✓     | ✓       | ✗          | ✓     | ✗    |
| Stop              | ✓     | ✓       | ✓          | ✓     | ✓    |
| UserPromptSubmit  | ✓     | ✗       | ✓          | ✗     | ✗    |
| PreCompact        | ✓     | ✗       | ✗          | ✗     | ✗    |
| PostCompact       | ✓     | ✗       | ✗          | ✗     | ✗    |

### 4. 不支持的 hook 处理方法

对于不支持的 hook，可以简单返回允许：

```typescript
async onUserPromptSubmit(context, promptInfo): Promise<HookResult> {
  // 如果该运行时不支持此 hook
  return { decision: "allow" };
}
```

---

## 📝 文件清单

Phase 2 创建的文件：

```
src/adapters/
├── copilot-adapter-v2.ts         [新建]
├── claude-code-adapter-v2.ts     [新建]
├── qoder-adapter-v2.ts           [新建]
├── trae-adapter-v2.ts            [新建]
└── __tests__/
    ├── copilot-adapter-v2.test.ts         [新建]
    ├── claude-code-adapter-v2.test.ts     [新建]
    ├── qoder-adapter-v2.test.ts           [新建]
    └── trae-adapter-v2.test.ts            [新建]
```

修改的文件：

```
src/adapters/index.ts                [修改 - 导出新适配器]
```

---

## 🔗 相关资源

### 参考实现

- [CodexAdapterV2](../src/adapters/codex-adapter-v2.ts) - 完整示例，直接复制使用

### 基类文档

- [HookAdapterV2](../src/adapters/hook-adapter-v2.ts) - 查看方法签名和接口定义

### 单元测试模板

- [Hook Executor Tests](../src/core/__tests__/hook-executor.test.ts)
- [Config Loader Tests](../src/core/__tests__/hook-config-loader.test.ts)

### 文档

- [集成指南](./HOOK-ADAPTER-INTEGRATION.md#phase2)
- [快速参考](./HOOK-QUICKSTART.md)
- [原始重构文档](./HOOK-ADAPTER-REFACTOR.md)

---

## ⚡ 快速命令参考

```bash
# 验证 Phase 1
bash scripts/verify-hook-adapter-v2.sh

# 编译项目
pnpm run build

# 运行所有测试
pnpm test

# 运行特定测试
pnpm test hook-executor.test.ts

# 查看代码覆盖率
pnpm test --coverage

# 启用监视模式（开发时）
pnpm test --watch
```

---

## ✨ 成功标志

Phase 2 完成后，你应该看到：

```
✅ 5 个适配器文件创建完成
✅ 4 个测试文件创建完成
✅ 所有适配器能力矩阵正确
✅ 单元测试通过率 100%
✅ 编译无错误
✅ 模块导出完整
```

---

## 🎬 开始吧！

现在你已经准备好开始 Phase 2 了。

### 推荐流程：

1. ✅ 验证 Phase 1 (已完成)
2. → 导出模块 (5 min)
3. → 编译测试 (5 min)
4. → 实现 4 个适配器 (2 小时)
5. → 编译和测试 (30 min)

**预计总时间：2.5-3 小时**

---

**状态**: 准备开始 Phase 2 ✓  
**下一步**: 导出模块 → 创建适配器  
**目标**: 完成 Phase 2 后，进入 Phase 3 (Handler 更新)
