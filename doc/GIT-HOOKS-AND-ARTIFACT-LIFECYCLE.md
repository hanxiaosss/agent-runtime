# Git Hook 拦截机制 & 产物生命周期管理方案

## 1. 概述

### 1.1 目标

1. **Git Hook 拦截机制** — CLI 提供 `hannah git-hooks install` 命令，将 git hook 装载到项目的 `.git/hooks/` 中，支持用户自定义回调配置
2. **产物生命周期管理** — 不同产物有不同的存活周期，例如会话面板数据仅存活于一次 git commit 之内，提交时自动清空

### 1.2 当前产物清单

| 产物           | 路径                                 | 当前生命周期     | 建议生命周期                          |
| -------------- | ------------------------------------ | ---------------- | ------------------------------------- |
| 实时追踪数据   | `.harness/traces/*.jsonl`            | 永久（按日归档） | **commit 级** — 每次提交清空          |
| 会话元数据     | `.harness/sessions/*.json`           | 永久             | **commit 级** — 每次提交清空          |
| Hook 执行日志  | `.harness/hooks/logs/*.jsonl`        | 永久             | **commit 级** — 每次提交清空          |
| 语义规则缓存   | `.harness/semantic-hooks/hooks.json` | 永久             | **session 级** — sync 时刷新          |
| 策略文件       | `.harness/policies/*.yaml`           | 永久             | **项目级** — 用户手动管理，受版本控制 |
| 配置文件       | `.harness/config.yaml`               | 永久             | **项目级** — 用户手动管理             |
| Dashboard 数据 | 内存/SSE                             | 运行时           | 随 traces 清空自动重置                |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Git Lifecycle                         │
│                                                         │
│  git commit ──► .git/hooks/pre-commit                   │
│                      │                                  │
│                      ▼                                  │
│              hannah git-hooks run pre-commit             │
│                      │                                  │
│         ┌────────────┼────────────┐                     │
│         ▼            ▼            ▼                     │
│   [内置回调]    [用户自定义回调]   [生命周期清理]         │
│   检查暂存区     执行用户脚本     清空 traces/sessions   │
│   文件策略                          logs                 │
│                                                         │
│  git commit ──► .git/hooks/post-commit                  │
│                      │                                  │
│                      ▼                                  │
│              hannah git-hooks run post-commit            │
│                      │                                  │
│                      ▼                                  │
│              记录提交快照(可选)                           │
│              重置 Dashboard 状态                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 支持的 Git Hook 类型

| Hook                 | 触发时机            | 内置行为                                | 可配置        |
| -------------------- | ------------------- | --------------------------------------- | ------------- |
| `pre-commit`         | `git commit` 执行前 | 清空上一轮 traces/sessions/logs         | ✅ 自定义回调 |
| `post-commit`        | `git commit` 成功后 | 重置 Dashboard 状态，记录提交标记       | ✅ 自定义回调 |
| `pre-push`           | `git push` 执行前   | 可选：运行策略检查                      | ✅ 自定义回调 |
| `post-checkout`      | `git checkout` 后   | 可选：同步环境配置                      | ✅ 自定义回调 |
| `prepare-commit-msg` | 编辑器打开前        | 可选：注入 AI 会话摘要到 commit message | ✅ 自定义回调 |

---

## 3. 配置设计

### 3.1 配置文件结构

在 `.harness/config.yaml` 中新增 `git-hooks` 段：

```yaml
# .harness/config.yaml

project: my-project
adapters:
  - copilot

trace:
  enabled: true
  dir: .harness/traces

policies:
  - policies

# ─── Git Hook 配置 ───────────────────────────────────────────
git-hooks:
  # 是否启用 git hook 拦截（总开关）
  enabled: true

  # 产物生命周期策略
  lifecycle:
    # commit 级产物 — 每次 pre-commit 时清空
    commit-scoped:
      - traces # .harness/traces/
      - sessions # .harness/sessions/
      - hook-logs # .harness/hooks/logs/

    # 归档策略 — 清空前是否归档
    archive:
      enabled: true
      dir: .harness/archive # 归档目录
      format: jsonl # 归档格式

  # Hook 回调配置
  hooks:
    pre-commit:
      # 内置行为（可禁用）
      builtin:
        clear-artifacts: true # 清空 commit 级产物
        archive-before-clear: true # 清空前归档

      # 用户自定义回调（按顺序执行）
      callbacks:
        - name: "lint-check"
          command: "npm run lint"
          timeout: 30000
          on-failure: abort # abort | warn | skip
          # abort: 阻止 commit（exit 1）
          # warn: 输出警告但允许
          # skip: 静默跳过

        - name: "security-scan"
          command: "npm run security-check"
          timeout: 60000
          on-failure: warn

    post-commit:
      builtin:
        reset-dashboard: true # 重置 Dashboard 状态
        log-commit: true # 记录提交事件

      callbacks:
        - name: "notify"
          command: "echo 'Commit completed at $(date)'"
          timeout: 5000
          on-failure: skip

    pre-push:
      builtin:
        clear-artifacts: false

      callbacks:
        - name: "full-test"
          command: "npm test"
          timeout: 120000
          on-failure: abort

    post-checkout:
      callbacks: []

    prepare-commit-msg:
      callbacks:
        - name: "inject-session-summary"
          command: "hannah session summary --inject"
          timeout: 10000
          on-failure: skip
```

### 3.2 回调配置字段说明

| 字段         | 类型   | 必填 | 说明                                                                       |
| ------------ | ------ | ---- | -------------------------------------------------------------------------- |
| `name`       | string | ✅   | 回调名称（用于日志和调试）                                                 |
| `command`    | string | ✅   | 要执行的 shell 命令                                                        |
| `timeout`    | number | ❌   | 超时时间（ms），默认 30000                                                 |
| `on-failure` | enum   | ❌   | 失败策略：`abort`（阻止操作）/ `warn`（警告）/ `skip`（跳过），默认 `warn` |
| `env`        | object | ❌   | 注入的环境变量                                                             |
| `cwd`        | string | ❌   | 工作目录，默认项目根目录                                                   |
| `condition`  | string | ❌   | 执行条件表达式（如 `hasChanges: src/`）                                    |

---

## 4. CLI 命令设计

### 4.1 命令结构

```
hannah git-hooks <subcommand> [options]
```

| 子命令       | 说明                            |
| ------------ | ------------------------------- |
| `install`    | 安装 git hooks 到 `.git/hooks/` |
| `uninstall`  | 卸载 git hooks                  |
| `status`     | 查看当前 git hooks 状态         |
| `run <hook>` | 手动触发某个 hook 的回调链      |
| `list`       | 列出所有已配置的回调            |

### 4.2 命令详情

#### `hannah git-hooks install`

```bash
# 安装所有配置的 hooks
hannah git-hooks install

# 只安装特定 hook
hannah git-hooks install --hook=pre-commit

# 强制覆盖已有的 git hooks
hannah git-hooks install --force
```

**行为：**

1. 读取 `.harness/config.yaml` 中的 `git-hooks` 配置
2. 在 `.git/hooks/` 中生成对应的 hook 脚本
3. 生成的脚本是薄包装器，调用 `hannah git-hooks run <hook-name>`
4. 如果目标 hook 已存在，备份为 `.hook-name.hannah-backup`（除非 `--force`）

**生成的 hook 脚本示例（`.git/hooks/pre-commit`）：**

```bash
#!/usr/bin/env bash
# Generated by hannah git-hooks install
# Do not edit manually — changes will be overwritten

HANNAH_DIR="$(git rev-parse --show-toplevel)/.harness"

if [ -f "$HANNAH_DIR/config.yaml" ]; then
  npx hannah git-hooks run pre-commit "$@"
  exit $?
fi

# If hannah is not configured, exit silently
exit 0
```

#### `hannah git-hooks uninstall`

```bash
hannah git-hooks uninstall
hannah git-hooks uninstall --hook=pre-commit
```

**行为：** 删除 hannah 生成的 hook 脚本，恢复备份文件（如有）。

#### `hannah git-hooks status`

```bash
$ hannah git-hooks status

Git Hooks Status
═══════════════════════════════════════
  pre-commit    ✅ installed  (2 callbacks)
  post-commit   ✅ installed  (1 callback)
  pre-push      ⚠️  configured but not installed
  post-checkout ❌ not configured

Lifecycle Policy
═══════════════════════════════════════
  commit-scoped: traces, sessions, hook-logs
  archive:       enabled → .harness/archive/
```

#### `hannah git-hooks run <hook>`

```bash
# 手动触发 pre-commit 回调链
hannah git-hooks run pre-commit

# 跳过内置行为，只执行用户回调
hannah git-hooks run pre-commit --no-builtin
```

#### `hannah git-hooks list`

```bash
$ hannah git-hooks list

Configured Callbacks
═══════════════════════════════════════
pre-commit:
  [builtin] clear-artifacts    → clears traces, sessions, hook-logs
  [builtin] archive-before     → archives to .harness/archive/
  [user]    lint-check         → npm run lint (on-failure: abort)
  [user]    security-scan      → npm run security-check (on-failure: warn)

post-commit:
  [builtin] reset-dashboard    → resets dashboard state
  [builtin] log-commit         → logs commit event
  [user]    notify             → echo 'Commit completed' (on-failure: skip)
```

---

## 5. 产物生命周期管理

### 5.1 生命周期模型

```
                    ┌──────────────────────────────────────┐
                    │         Artifact Lifecycle           │
                    ├──────────────────────────────────────┤
                    │                                      │
  commit 级         │  traces/  sessions/  hooks/logs/     │
  (每次提交清空)     │  ──────────────────────────────► 🗑️  │
                    │  创建 ──► 累积 ──► pre-commit 清空   │
                    │                                      │
  session 级        │  semantic-hooks/hooks.json           │
  (每次 sync 刷新)  │  ──────────────────────────────► 🔄  │
                    │  sync 时重新生成                      │
                    │                                      │
  项目级            │  policies/  config.yaml              │
  (永久，版本控制)   │  ──────────────────────────────► 📌  │
                    │  用户手动管理                         │
                    │                                      │
  归档级            │  archive/*.jsonl                     │
  (跨提交保留)      │  ──────────────────────────────► 📦  │
                    │  pre-commit 时自动归档                │
                    │  cleanup 命令按天数清理               │
                    └──────────────────────────────────────┘
```

### 5.2 清空流程（pre-commit 内置行为）

```
pre-commit 触发
    │
    ▼
1. 读取 lifecycle.commit-scoped 列表
    │
    ▼
2. 如果 archive.enabled = true:
    │  ├── 将 traces/*.jsonl 合并归档到 .harness/archive/commit-<timestamp>.jsonl
    │  ├── 将 sessions/*.json 归档到 .harness/archive/sessions-<timestamp>.json
    │  └── 将 hooks/logs/*.jsonl 归档到 .harness/archive/logs-<timestamp>.jsonl
    │
    ▼
3. 清空 commit-scoped 目录:
    │  ├── rm .harness/traces/*.jsonl
    │  ├── rm .harness/sessions/*.json
    │  └── rm .harness/hooks/logs/*.jsonl
    │
    ▼
4. Dashboard 自动重置（因为数据源已清空）
    │
    ▼
5. 执行用户自定义 callbacks
    │
    ▼
6. 返回结果（全部 abort 类型失败 → exit 1，阻止 commit）
```

### 5.3 归档文件格式

归档文件按提交时间戳命名，保留完整的上下文信息：

```jsonl
// .harness/archive/commit-a1b2c3d-2026-09-04T10:30:00.jsonl
{"timestamp":"2026-09-04T10:25:00Z","event":"tool.before","action":"allow","sessionId":"src/server#ppid1234",...}
{"timestamp":"2026-09-04T10:25:01Z","event":"tool.after","action":"allow","sessionId":"src/server#ppid1234",...}
...
```

归档文件头部包含 commit 元数据注释：

```json
{
  "_archive": {
    "commitHash": "a1b2c3d",
    "commitMessage": "feat: add git hook support",
    "author": "developer",
    "archivedAt": "2026-09-04T10:30:00Z",
    "eventCount": 42,
    "sessionCount": 3
  }
}
```

---

## 6. 事件扩展

### 6.1 新增 Git Hook 事件

在 `src/core/event.ts` 中扩展事件分类：

```typescript
// 新增事件名
export type EventName =
  // ... existing events ...
  // Git hook lifecycle
  | "git.pre-commit"
  | "git.post-commit"
  | "git.pre-push"
  | "git.post-checkout"
  | "git.prepare-commit-msg";
```

### 6.2 与现有系统的集成

| 集成点                           | 方式                                     |
| -------------------------------- | ---------------------------------------- |
| `handler.mjs`                    | 新增 git hook 事件的处理分支，写入 trace |
| `src/cli/trace.ts`               | 识别 git hook 事件，在 timeline 中展示   |
| `src/cli/session.ts`             | 新增 `cleanup` 子命令与归档联动          |
| `src/server/dashboard.ts`        | 新增 commit 历史视图（读取归档）         |
| `src/core/hook-config-loader.ts` | 加载 git-hooks 配置段                    |

---

## 7. 实现计划

### 7.1 文件结构

```
src/cli/
  git-hooks.ts              # 新增：git-hooks 命令主逻辑
  init/
    templates.ts            # 修改：新增 git-hooks 配置模板

src/core/
  event.ts                  # 修改：新增 git hook 事件
  git-hook-runner.ts        # 新增：hook 回调链执行器
  artifact-lifecycle.ts     # 新增：产物生命周期管理器

.harness/
  config.yaml               # 修改：新增 git-hooks 配置段
```

### 7.2 分阶段实现

| 阶段        | 内容                                                               | 优先级 |
| ----------- | ------------------------------------------------------------------ | ------ |
| **Phase 1** | 核心框架：`git-hooks install/uninstall/status/run` 命令 + 配置加载 | P0     |
| **Phase 2** | 产物生命周期：`artifact-lifecycle.ts` + pre-commit 清空/归档逻辑   | P0     |
| **Phase 3** | 回调执行器：`git-hook-runner.ts` + 超时/失败策略/链式执行          | P0     |
| **Phase 4** | Dashboard 集成：commit 历史视图 + 归档浏览                         | P1     |
| **Phase 5** | 高级特性：条件执行、环境变量注入、commit message 注入              | P2     |

### 7.3 关键设计决策

| 决策              | 选择                                   | 理由                                        |
| ----------------- | -------------------------------------- | ------------------------------------------- |
| Hook 脚本生成方式 | 薄包装器 → 调用 `hannah git-hooks run` | 配置变更不需要重新 install                  |
| 清空策略          | 先归档再清空                           | 数据不丢失，支持事后审计                    |
| 回调执行顺序      | 内置 → 用户自定义                      | 确保环境干净后再执行用户逻辑                |
| 失败策略默认值    | `warn`                                 | 不过度干扰开发流程                          |
| 归档格式          | JSONL                                  | 与现有 traces 格式一致，可复用 trace 工具链 |
| 配置位置          | `config.yaml` 内嵌                     | 减少配置文件数量，统一管理                  |

---

## 8. 安全考量

1. **命令注入防护** — 回调 `command` 字段不经过 shell 插值，使用 `child_process.spawn` 的参数数组形式
2. **超时保护** — 每个回调有独立超时，默认 30s，防止阻塞 git 操作
3. **备份机制** — 安装 hook 前备份已有 hook，卸载时恢复
4. **权限检查** — 安装时检查 `.git/hooks/` 目录可写性
5. **幂等性** — 多次 `install` 不会产生重复内容

---

## 9. 用户交互流程示例

```bash
# 1. 初始化项目（已有）
$ hannah init --agent=copilot

# 2. 配置 git hooks（编辑 config.yaml 添加 git-hooks 段）
$ vim .harness/config.yaml

# 3. 安装 git hooks
$ hannah git-hooks install
✅ Git hooks installed:
   pre-commit  → clear-artifacts + archive + 2 callbacks
   post-commit → reset-dashboard + 1 callback

# 4. 正常使用 git
$ git add .
$ git commit -m "feat: add new feature"
   [pre-commit] Archiving 42 events to .harness/archive/commit-a1b2c3d.jsonl
   [pre-commit] Cleared: traces (3 files), sessions (2 files), logs (5 files)
   [pre-commit] Running: npm run lint ... ✅
   [pre-commit] Running: npm run security-check ... ⚠️ 1 warning
   [post-commit] Dashboard reset
   [master a1b2c3d] feat: add new feature

# 5. 查看状态
$ hannah git-hooks status
✅ pre-commit   installed (2 builtin + 2 callbacks)
✅ post-commit  installed (2 builtin + 1 callback)

# 6. 查看归档历史
$ hannah session list --archived
  commit-a1b2c3d  42 events  2026-09-04 10:30
  commit-e4f5g6h  28 events  2026-09-03 15:20
```
