# Hannah Agent Runtime 实操手册

> 版本：0.2.5  
> 最后更新：2026-09-03

---

## 目录

1. [项目概述](#项目概述)
2. [快速开始](#快速开始)
3. [CLI 命令详解](#cli-命令详解)
4. [支持的编辑器/适配器](#支持的编辑器适配器)
5. [Hook 系统配置](#hook-系统配置)
6. [安全策略配置](#安全策略配置)
7. [语义引擎使用](#语义引擎使用)
8. [智能监控与分析](#智能监控与分析)
9. [实时监控与 WebUI](#实时监控与-webui)
10. [VSCode 扩展使用](#vscode-扩展使用)
11. [配置文件格式参考](#配置文件格式参考)
12. [常见问题排查](#常见问题排查)

---

## 项目概述

### 什么是 Hannah Agent Runtime？

Hannah Agent Runtime 是一个**跨 AI 代理的统一事件和策略控制层**，用于观察、约束和反馈 AI 编码代理的行为。它充当**控制平面**，通过标准化的 Hook 系统拦截代理操作，应用声明式策略，并生成可观测的追踪日志。

### 核心能力

- ✅ **统一事件模型**：将 6 种 AI 代理的特定 Hook 转换为 19 种标准事件类型
- ✅ **多维度安全策略**：红线保护、文件保护、命令拦截、密钥检测
- ✅ **语义规则引擎**：基于自然语言规则自动生成 Hook
- ✅ **实时监控**：SSE 实时事件流 + WebUI 仪表板
- ✅ **智能分析**：异常检测、模式分析、策略推荐
- ✅ **VSCode 集成**：侧边栏追踪视图 + 策略浏览器

### 支持的 AI 代理

| 代理           | 适配器版本 | 支持的 Hook 数量 |
| -------------- | ---------- | ---------------- |
| Claude Code    | V1/V2      | 5-6 个           |
| Codex CLI      | V1/V2      | 8 个（完整）     |
| Qoder          | V1/V2      | 2-3 个           |
| GitHub Copilot | V1/V2      | 5 个             |
| Trae           | V1/V2      | 3 个             |
| Cursor         | V1         | 2 个             |

---

## 快速开始

### 1. 安装

```bash
# 全局安装
npm install -g hannah

# 或使用 pnpm
pnpm add -g hannah

# 验证安装
hannah --version
```

### 2. 初始化项目

```bash
# 进入你的项目目录
cd your-project

# 初始化 Hannah（自动检测技术栈）
hannah init

# 或指定代理类型
hannah init --agent=copilot
hannah init --agent=claude-code
hannah init --agent=codex
hannah init --agent=qoder
hannah init --agent=trae
hannah init --agent=cursor
```

**初始化后会生成：**

```
.harness/
├── config.yaml              # 运行时配置
├── policies/                # 安全策略目录
│   ├── redline.yaml        # 红线保护策略
│   └── security.yaml       # 安全策略
├── hooks/
│   ├── handler.mjs         # Hook 处理器脚本
│   ├── config/             # Hook 配置
│   │   └── hooks-config.json
│   └── logs/               # 审计日志
├── traces/                 # 追踪日志（JSONL 格式）
├── semantic-hooks/         # 语义 Hook 元数据
└── architecture.yaml       # 架构层规则（可选）
```

### 3. 启动文件监视器（可选）

```bash
# 启动红线保护文件监视器
hannah watch
```

此命令会监控受保护文件，当 AI 代理尝试修改时自动回滚。

### 4. 查看追踪日志

```bash
# 查看最近的追踪
hannah trace

# 实时跟踪
hannah trace --follow

# 仅查看被拒绝的操作
hannah trace --denied

# 输出 JSON 格式
hannah trace --json
```

### 5. 启动监控面板

```bash
# 启动 SSE 监控服务器
hannah monitor --open

# 启动 WebUI 仪表板
hannah web --open
```

---

## CLI 命令详解

### `hannah init [dir]`

初始化项目，创建 `.harness/` 目录结构。

**参数：**

- `dir`：项目目录（默认当前目录）

**选项：**

- `--agent=<name>`：指定代理类型（claude-code, copilot, qoder, codex, trae, cursor）

**示例：**

```bash
# 初始化当前目录
hannah init

# 初始化指定目录，使用 Copilot 适配器
hannah init /path/to/project --agent=copilot
```

**功能：**

- 检测项目技术栈（React, Vue, Next.js, Prisma 等）
- 扫描 `agent.md`、`CLAUDE.md`、`COPILOT.md` 等文件
- 根据技术栈生成预设 Hook
- 根据自然语言规则生成语义 Hook

---

### `hannah sync [dir]`

重新同步语义 Hook 与项目规则和技术栈。

**示例：**

```bash
hannah sync
```

**使用场景：**

- 修改了 `agent.md` 中的规则后
- 项目技术栈发生变化后
- 需要重新生成语义 Hook 时

---

### `hannah watch`

启动文件系统监视器，提供红线保护。

**示例：**

```bash
hannah watch
```

**功能：**

- 监控受保护文件（agent.md, .env, lock 文件等）
- 当检测到修改时自动从备份恢复
- 使用内容哈希比较，避免误报
- 支持恢复锁和冷却期

**受保护的文件类型：**

- AI 代理指令文件：`agent.md`, `CLAUDE.md`, `COPILOT.md`, `.cursorrules`
- Harness 配置：`.harness/**`
- 环境文件：`.env`, `.env.*`
- Lock 文件：`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`
- 生产配置：`production.yaml`, `prod.yaml`

---

### `hannah trace`

查看代理运行时追踪日志。

**选项：**

- `--all`：显示所有追踪（默认仅显示最近的）
- `--follow`：实时跟踪新追踪
- `--json`：输出 JSON 格式
- `--denied`：仅显示被拒绝的操作

**示例：**

```bash
# 查看最近的追踪
hannah trace

# 实时跟踪
hannah trace --follow

# 导出为 JSON
hannah trace --json > traces.json

# 查看被拒绝的操作
hannah trace --denied
```

**输出格式：**

```
[2026-09-03 14:23:15] ✅ tool.before | Write | src/index.ts | allow
[2026-09-03 14:23:16] ❌ code.before_modify | .env | deny | Reason: Environment files protected
[2026-09-03 14:23:17] ⚠️  tool.before | Bash | npm install | warn | Reason: Unusual dependency
```

---

### `hannah summary`

显示聚合统计信息。

**选项：**

- `--today`：仅显示今天的统计
- `--days N`：显示最近 N 天的统计

**示例：**

```bash
# 显示今天的统计
hannah summary --today

# 显示最近 7 天的统计
hannah summary --days 7
```

**输出示例：**

```
📊 Hannah Agent Runtime - 统计摘要

时间范围：2026-08-27 至 2026-09-03

总计事件：1,234
  ✅ 允许：1,180 (95.6%)
  ❌ 拒绝：42 (3.4%)
  ⚠️  警告：12 (1.0%)

活跃会话：8
平均会话时长：2.3 小时

最常用工具：
  1. Write (342 次)
  2. Bash (289 次)
  3. Read (156 次)

被拒绝操作 Top 3：
  1. 修改 .env 文件 (12 次)
  2. git push --force (8 次)
  3. 修改 agent.md (5 次)
```

---

### `hannah analyze`

规则优化分析（误报、冲突、未使用规则）。

**选项：**

- `--today`：分析今天的数据
- `--days N`：分析最近 N 天的数据

**示例：**

```bash
hannah analyze --days 7
```

**输出示例：**

```
🔍 Hannah Agent Runtime - 规则优化分析

分析时间范围：2026-08-27 至 2026-09-03

📋 误报规则（高允许率但频繁触发）：
  1. rule-name-1：触发 45 次，允许 44 次 (97.8%)
     建议：考虑放宽规则或添加例外

🔄 冲突规则（相似名称但不同动作）：
  1. protect-env vs allow-env-modification
     建议：合并或明确优先级

❌ 未使用规则（30 天内未触发）：
  1. legacy-rule-1
  2. legacy-rule-2
     建议：考虑删除或归档

⚡ 高错误率工具：
  1. Bash：错误率 15.2%
     建议：添加更严格的命令白名单
```

---

### `hannah export`

导出追踪数据。

**选项：**

- `--format=<fmt>`：输出格式（json, csv, jsonl）
- `--output=<file>`：输出文件路径
- `--days=N`：导出最近 N 天的数据
- `--session=<id>`：仅导出指定会话

**示例：**

```bash
# 导出为 JSON
hannah export --format=json --output=traces.json

# 导出最近 7 天为 CSV
hannah export --format=csv --days=7 --output=traces.csv

# 导出指定会话
hannah export --session=abc123 --format=jsonl --output=session.jsonl
```

---

### `hannah session`

管理代理会话。

**子命令：**

#### `hannah session list`

列出所有会话。

**选项：**

- `--all`：显示所有会话（包括已归档的）

**示例：**

```bash
hannah session list
hannah session list --all
```

#### `hannah session info <id>`

显示会话详细信息。

**示例：**

```bash
hannah session info abc123
```

**输出示例：**

```
📝 会话详情：abc123

代理：Claude Code
开始时间：2026-09-03 10:15:23
结束时间：2026-09-03 12:45:10
持续时间：2 小时 29 分钟

事件统计：
  总计：234
  允许：220 (94.0%)
  拒绝：12 (5.1%)
  警告：2 (0.9%)

使用工具：
  Write: 89 次
  Bash: 67 次
  Read: 45 次
  Edit: 33 次
```

#### `hannah session archive <id>`

归档会话。

**示例：**

```bash
hannah session archive abc123
```

#### `hannah session cleanup`

清理旧会话。

**选项：**

- `--days=N`：清理 N 天前的会话（默认 30 天）

**示例：**

```bash
# 清理 30 天前的会话
hannah session cleanup

# 清理 7 天前的会话
hannah session cleanup --days=7
```

---

### `hannah policy`

管理策略。

**子命令：**

#### `hannah policy list`

列出所有策略。

**示例：**

```bash
hannah policy list
```

**输出示例：**

```
📋 已加载策略：

1. redlinePolicy（内置）
   描述：不可协商的 guard rails
   规则数：12
   状态：✅ 启用

2. securityPolicy（内置）
   描述：安全策略
   规则数：8
   状态：✅ 启用

3. custom-policy（自定义）
   文件：.harness/policies/custom.yaml
   规则数：3
   状态：✅ 启用
```

#### `hannah policy validate`

验证所有策略文件。

**示例：**

```bash
hannah policy validate
```

**输出示例：**

```
✅ 所有策略文件验证通过

检查的文件：
  ✅ .harness/policies/redline.yaml
  ✅ .harness/policies/security.yaml
  ✅ .harness/policies/custom.yaml
```

#### `hannah policy show <name>`

显示策略详情。

**示例：**

```bash
hannah policy show redlinePolicy
```

#### `hannah policy check <file>`

检查文件是否符合策略。

**示例：**

```bash
hannah policy check src/index.ts
```

---

### `hannah monitor`

启动实时监控服务器（SSE）。

**选项：**

- `--port=N`：端口号（默认 4848）
- `--open`：自动打开浏览器

**示例：**

```bash
# 启动监控服务器
hannah monitor

# 指定端口并自动打开浏览器
hannah monitor --port=8080 --open
```

**API 端点：**

- `GET /events`：SSE 事件流
- `GET /api/traces?limit=N`：最近的追踪
- `GET /api/stats`：聚合统计
- `GET /api/health`：健康检查

**使用示例：**

```bash
# 订阅 SSE 事件流
curl -N http://localhost:4848/events

# 获取最近的追踪
curl http://localhost:4848/api/traces?limit=10

# 获取统计信息
curl http://localhost:4848/api/stats
```

---

### `hannah web`

启动 WebUI 仪表板。

**选项：**

- `--port=N`：端口号（默认 4849）
- `--open`：自动打开浏览器

**示例：**

```bash
# 启动 WebUI
hannah web

# 指定端口并自动打开
hannah web --port=8080 --open
```

**功能：**

- 实时统计卡片（总计、拒绝、警告、会话数）
- 最近事件表格（带操作徽章）
- 活跃会话表格
- SSE 实时刷新

---

### `hannah learn`

自学习智能分析。

**子命令：**

#### `hannah learn full`

运行完整的智能分析。

**选项：**

- `--days=N`：分析最近 N 天的数据

**示例：**

```bash
hannah learn full --days=7
```

#### `hannah learn patterns`

分析使用模式。

**示例：**

```bash
hannah learn patterns
```

**输出示例：**

```
🔍 模式分析结果

工具使用频率：
  1. Write: 342 次 (27.7%)
  2. Bash: 289 次 (23.4%)
  3. Read: 156 次 (12.6%)

高峰时段：
  1. 14:00-15:00 (187 次)
  2. 10:00-11:00 (156 次)
  3. 16:00-17:00 (134 次)

常见操作序列：
  1. Read → Write → Bash (89 次)
  2. Write → Bash → Read (67 次)

错误率趋势：
  Bash: 15.2% (↑ 2.3%)
  Write: 3.4% (↓ 0.5%)
```

#### `hannah learn anomalies`

检测异常行为。

**示例：**

```bash
hannah learn anomalies
```

**输出示例：**

```
⚠️  检测到异常：

1. 错误峰值
   时间：2026-09-03 14:00-15:00
   错误数：23（正常：5.2 ± 3.1）
   可能原因：Bash 命令频繁失败

2. 异常工具使用
   会话：abc123
   问题：单一工具主导（Write 占 92%）
   建议：检查是否陷入循环

3. 长会话
   会话：def456
   持续时间：5.2 小时（阈值：4 小时）
   建议：考虑拆分会话

4. 敏感文件访问
   会话：ghi789
   文件：.env, .ssh/config
   操作：修改
   状态：❌ 已拒绝
```

#### `hannah learn recommend`

获取策略推荐。

**示例：**

```bash
hannah learn recommend
```

**输出示例：**

```
💡 策略推荐：

1. 新增策略：bash-command-whitelist
   原因：Bash 命令错误率高达 15.2%
   建议：添加命令白名单，仅允许安全的命令

2. 调整策略：protect-env
   原因：触发 45 次，允许 44 次（误报率 97.8%）
   建议：放宽规则，允许特定场景下的修改

3. 解决冲突：protect-env vs allow-env-modification
   原因：两个规则名称相似但动作相反
   建议：合并为一个规则，明确条件

4. 优化时段策略
   原因：高峰时段（14:00-15:00）错误率较高
   建议：在高峰时段启用更严格的策略
```

#### `hannah learn escalation`

管理反馈升级统计。

**子命令：**

- `stats`：显示升级统计
- `reset`：重置升级状态

**示例：**

```bash
# 查看升级统计
hannah learn escalation stats

# 重置升级状态
hannah learn escalation reset
```

---

## 支持的编辑器/适配器

### V1 适配器

#### Claude Code

**配置文件：** `.claude/settings.json`

**支持的 Hook：**

- PreToolUse
- PostToolUse
- UserPromptSubmit
- Notification
- SubagentStop

**配置示例：**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs pre-tool-use"
          }
        ]
      }
    ]
  }
}
```

#### Codex CLI

**配置文件：** `.codex/hooks.json`

**支持的 Hook：** 全部 8 个

**配置示例：**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs session-start"
      }
    ],
    "PreToolUse": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ]
  }
}
```

#### Qoder

**配置文件：** `.qoder/settings.json`

**支持的 Hook：**

- PreToolUse
- PostToolUse

#### GitHub Copilot

**配置文件：** `.github/hooks/hooks.json`

**支持的 Hook：**

- preToolUse（注意：驼峰命名）
- postToolUse
- sessionStart
- stop

**配置示例：**

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ]
  }
}
```

#### Trae

**配置文件：** `.trae/settings.json`

**支持的 Hook：**

- PreToolUse
- PostToolUse
- Stop

#### Cursor

**配置文件：** `.cursor/hooks.json`

**支持的 Hook：**

- PreToolUse
- PostToolUse

**特殊功能：** 支持 `updatedInput` 重写

---

### V2 适配器

V2 适配器支持 8 个标准 Hook 事件：

1. **SessionStart**：会话初始化
2. **PreToolUse**：工具执行前
3. **PermissionRequest**：权限请求
4. **PostToolUse**：工具执行后
5. **Stop**：会话终止
6. **UserPromptSubmit**：用户提示提交
7. **PreCompact**：上下文压缩前
8. **PostCompact**：上下文压缩后

**各适配器支持的 Hook 数量：**

| 适配器              | 支持的 Hook                                            |
| ------------------- | ------------------------------------------------------ |
| CodexAdapterV2      | 全部 8 个                                              |
| ClaudeCodeAdapterV2 | 6 个（缺少 PreCompact, PostCompact）                   |
| CopilotAdapterV2    | 5 个（缺少 UserPromptSubmit, PreCompact, PostCompact） |
| TraeAdapterV2       | 3 个（PreToolUse, PostToolUse, Stop）                  |
| QoderAdapterV2      | 3 个（SessionStart, PermissionRequest, Stop）          |

---

## Hook 系统配置

### Hook 配置文件

**位置：** `.harness/hooks/config/hooks-config.json`

**示例：**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs pre-tool-use",
        "timeout": 10000,
        "priority": 100
      }
    ],
    "PostToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs post-tool-use",
        "timeout": 10000,
        "priority": 100
      }
    ]
  },
  "disablePreToolUseHook": false,
  "disableLogging": false
}
```

### Hook 决策类型

| 决策     | 说明                 | 退出码 |
| -------- | -------------------- | ------ |
| `allow`  | 允许操作继续         | 0      |
| `deny`   | 阻止操作             | 2      |
| `warn`   | 允许但记录警告       | 0      |
| `retry`  | 要求代理重试         | 3      |
| `modify` | 使用修改后的参数继续 | 0      |

### Hook 处理器类型

- **shell**：Bash 命令（退出码 0=允许，2=拒绝）
- **javascript**：进程内 JS（计划中）
- **python**：Python3 命令

### 多层配置优先级

1. `hooks-config.local.json`（个人配置，git 忽略）
2. `hooks-config.json`（共享配置）
3. `hooks.json`（遗留配置）
4. 系统默认值

---

## 安全策略配置

### 红线保护策略

**位置：** `.harness/policies/redline.yaml`

**保护的规则（不可协商）：**

1. **代理指令文件**：`agent.md`, `CLAUDE.md`, `COPILOT.md`, `.cursorrules` 对代理只读
2. **Harness 配置**：`.harness/**` 只读
3. **环境文件**：`.env`, `.env.*` 受保护
4. **Lock 文件**：`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` 等
5. **生产配置**：`production.yaml`, `prod.yaml` 等
6. **危险 Shell 命令**：`rm -rf /`, `git push --force` 被阻止或修改
7. **危险数据库操作**：`DROP TABLE`, `TRUNCATE` 被阻止
8. **密钥检测**：硬编码密码、API 密钥、私钥被阻止
9. **MCP 安全**：通过 MCP 的数据库写入被阻止
10. **React XSS**：`dangerouslySetInnerHTML` 被阻止

### 内置策略

| 策略                   | 描述                                        |
| ---------------------- | ------------------------------------------- |
| `redlinePolicy`        | 不可协商的 guard rails                      |
| `protectedFilesPolicy` | 敏感配置/lock 文件保护                      |
| `mcpSafetyPolicy`      | MCP 服务器操作控制                          |
| `gitSafetyPolicy`      | 防止 force push、hard reset、直接 main 推送 |
| `qualityGatePolicy`    | 任务完成前要求测试通过                      |

### 自定义策略

**位置：** `.harness/policies/*.yaml`

**示例：**

```yaml
name: custom-policy
description: 自定义规则
rules:
  - name: block-sensitive-files
    when: code.before_modify
    match:
      - field: filePath
        pattern: "**/*.env"
    action: deny
    reason: "环境文件受保护"
    feedback: "不能修改 .env 文件，请使用环境变量"

  - name: require-tests
    when: task.before_complete
    match:
      - field: hasTests
        pattern: "false"
    action: deny
    reason: "任务完成前必须运行测试"
    feedback: "请先运行测试再完成任务"
```

### 策略字段说明

**`when`**：触发事件

- 事件名称：`tool.before`, `code.before_modify`, `task.before_complete` 等
- 支持多个事件：`[tool.before, code.before_modify]`

**`match`**：匹配条件

- `field`：字段路径（点表示法），如 `filePath`, `tool.name`, `content`
- `pattern`：Glob 模式或正则表达式
- `negate`：可选，取反匹配

**`action`**：动作

- `allow`：允许
- `deny`：拒绝
- `warn`：警告
- `retry`：重试
- `trace`：仅记录
- `modify`：修改参数

**`reason`**：拒绝/警告的原因（内部日志）

**`feedback`**：返回给代理的反馈信息

**`modifiedInput`**：当 `action: modify` 时，提供修改后的参数

---

## 语义引擎使用

### 多维度规则匹配

语义规则引擎支持 **7 个维度** 的匹配（维度间 AND，维度内 OR）：

| 维度            | 匹配内容                               |
| --------------- | -------------------------------------- |
| `tool_name`     | 工具名称（Write, Bash, mcp\_\_\*）     |
| `file_path`     | 文件路径（.env, src/core/\*）          |
| `content`       | 写入内容（DROP TABLE, password=）      |
| `command`       | Shell 命令（git push --force）         |
| `mcp_server`    | MCP 服务器名称（database, filesystem） |
| `mcp_operation` | MCP 操作（write, delete, drop）        |
| `file_type`     | 文件扩展名（ts, py, go, sql）          |

### 语义规则配置

**位置：** `.harness/semantic-hooks/*.yaml`

**示例：**

```yaml
source: custom
rules:
  - name: no-hardcoded-secrets
    description: 阻止硬编码密钥
    events: [tool.before, code.before_modify]
    priority: 50
    match:
      file_type: [ts, js, py, go]
      content: ['api_key = "', "password = '", 'secret = "']
    action: deny
    feedback: "请使用环境变量，不要硬编码密钥"
    suggestions:
      - "使用 process.env.API_KEY"
      - "使用 dotenv 库"

  - name: protect-database
    description: 保护数据库操作
    events: [mcp.before]
    priority: 100
    match:
      mcp_server: [database, postgres, mysql]
      mcp_operation: [drop, truncate, delete]
    action: deny
    feedback: "禁止通过 MCP 执行危险的数据库操作"
```

### Agent.md 扫描

**扫描的文件：**

- `agent.md`
- `CLAUDE.md`
- `COPILOT.md`
- `.cursorrules`
- `.cursor/rules.md`

**提取的规则类型：**

- 英文规则：通过正则模式提取
- 中文规则：支持中文自然语言规则
- 两轮提取：正则模式 + 项目符号启发式

**示例：**

```markdown
# agent.md

## 规则

- 不要修改 .env 文件
- 禁止使用 git push --force
- 所有 API 密钥必须使用环境变量
- 不要在生产配置中进行修改
```

**自动生成的语义 Hook：**

```yaml
source: agent-md-scanner
rules:
  - name: agent-md-rule-1
    description: 从 agent.md 提取的规则
    events: [code.before_modify]
    priority: 500
    match:
      file_path: ["**/.env"]
    action: deny
    feedback: "不要修改 .env 文件（来自 agent.md）"
```

### 技术栈检测

**检测的内容：**

- 分析 `package.json` 和项目结构
- 检测框架（React, Vue, Next.js）
- 检测数据库（Prisma, MongoDB）

**生成的预设 Hook：**

| Hook                     | 描述                                       |
| ------------------------ | ------------------------------------------ |
| `database-protection`    | 数据库保护                                 |
| `react-security`         | React 安全（阻止 dangerouslySetInnerHTML） |
| `vue-security`           | Vue 安全                                   |
| `environment-protection` | 环境文件保护                               |
| `secret-detection`       | 密钥检测                                   |
| `production-protection`  | 生产配置保护                               |

### 内置语义 Hook

**位置：** `.harness/semantic-hooks/`

**redline-protection.yaml**

```yaml
source: builtin
rules:
  - name: protect-agent-instructions
    description: 保护代理指令文件
    events: [code.before_modify]
    priority: 1000
    match:
      file_path:
        - "**/agent.md"
        - "**/CLAUDE.md"
        - "**/COPILOT.md"
        - "**/.cursorrules"
    action: deny
    feedback: "代理指令文件是只读的"

  - name: protect-harness
    description: 保护 Harness 配置
    events: [code.before_modify]
    priority: 1000
    match:
      file_path: ["**/.harness/**"]
    action: deny
    feedback: "Harness 配置是只读的"
```

**database-protection.yaml**

```yaml
source: builtin
rules:
  - name: block-dangerous-sql
    description: 阻止危险的 SQL 操作
    events: [tool.before, mcp.before]
    priority: 800
    match:
      content:
        - "DROP TABLE"
        - "TRUNCATE TABLE"
        - "DELETE FROM"
      file_type: [sql]
    action: deny
    feedback: "禁止执行危险的 SQL 操作"
```

**react-security.yaml**

```yaml
source: builtin
rules:
  - name: block-xss
    description: 阻止 React XSS
    events: [code.before_modify]
    priority: 700
    match:
      content: ["dangerouslySetInnerHTML"]
      file_type: [jsx, tsx]
    action: deny
    feedback: "禁止使用 dangerouslySetInnerHTML，存在 XSS 风险"
```

---

## 智能监控与分析

### 异常检测

**检测类型：**

1. **错误峰值检测**
   - 每小时错误率分析
   - 标准差阈值（默认 2σ）
   - 自动标记异常高峰

2. **异常工具使用**
   - 单一工具主导（>80%）
   - 罕见危险工具使用
   - 工具使用模式偏离

3. **长会话检测**
   - 超过 4 小时的会话
   - 可能表示陷入循环

4. **敏感文件访问**
   - 检测对 .env, .ssh, .aws 的修改
   - 自动拒绝并记录

5. **速率违规**
   - 5 分钟内 >100 次操作
   - 可能表示自动化脚本或循环

**查看异常：**

```bash
hannah learn anomalies
```

### 模式分析

**分析内容：**

1. **工具使用频率/分布**
   - 各工具的使用次数
   - 百分比分布

2. **小时活动模式 & 高峰时段**
   - 每小时的操作数量
   - 识别高峰时段

3. **常见操作序列（二元组）**
   - Read → Write → Bash
   - 识别常见工作流

4. **错误率趋势**
   - 每个工具的错误率
   - 趋势分析（上升/下降）

5. **每会话行为配置文件**
   - 每个会话的工具使用模式
   - 异常会话识别

**查看模式：**

```bash
hannah learn patterns
```

### 反馈升级

**3 级渐进式升级：**

| 级别 | 动作                          | 触发条件              |
| ---- | ----------------------------- | --------------------- |
| 1    | 警告（Warn）                  | 首次违规              |
| 2    | 拒绝（Deny）                  | 重复违规（默认 3 次） |
| 3    | 阻止 + 通知（Block + Notify） | 持续违规（默认 5 次） |

**配置：**

**位置：** `.harness/escalation-config.json`

```json
{
  "enabled": true,
  "levels": {
    "warn": { "threshold": 1, "cooldown": 300 },
    "deny": { "threshold": 3, "cooldown": 600 },
    "block": { "threshold": 5, "cooldown": 3600 }
  },
  "notify": {
    "enabled": true,
    "channels": ["log", "webhook"]
  }
}
```

**状态文件：** `.harness/escalation-state.json`

**管理升级：**

```bash
# 查看升级统计
hannah learn escalation stats

# 重置升级状态
hannah learn escalation reset
```

### 策略推荐

**推荐类型：**

1. **新增策略**
   - 基于重复违规
   - 识别常见违规模式

2. **调整策略**
   - 高误报率规则
   - 频繁触发但允许的规则

3. **解决冲突**
   - 相似名称但不同动作的规则
   - 优先级冲突

4. **优化建议**
   - 基于常见序列
   - 基于高峰时段

**获取推荐：**

```bash
hannah learn recommend
```

---

## 实时监控与 WebUI

### SSE 监控服务器

**启动：**

```bash
hannah monitor --port=4848 --open
```

**API 端点：**

#### `GET /events` - SSE 事件流

**示例：**

```bash
curl -N http://localhost:4848/events
```

**输出：**

```
event: trace
data: {"timestamp":"2026-09-03T14:23:15.123Z","event":"tool.before","tool":"Write","filePath":"src/index.ts","action":"allow"}

event: trace
data: {"timestamp":"2026-09-03T14:23:16.456Z","event":"code.before_modify","filePath":".env","action":"deny","reason":"Environment files protected"}
```

#### `GET /api/traces?limit=N` - 最近的追踪

**示例：**

```bash
curl http://localhost:4848/api/traces?limit=10
```

**输出：**

```json
{
  "traces": [
    {
      "timestamp": "2026-09-03T14:23:15.123Z",
      "event": "tool.before",
      "tool": "Write",
      "filePath": "src/index.ts",
      "action": "allow"
    }
  ]
}
```

#### `GET /api/stats` - 聚合统计

**示例：**

```bash
curl http://localhost:4848/api/stats
```

**输出：**

```json
{
  "total": 1234,
  "allowed": 1180,
  "denied": 42,
  "warned": 12,
  "sessions": 8,
  "timeRange": {
    "start": "2026-09-03T00:00:00.000Z",
    "end": "2026-09-03T23:59:59.999Z"
  }
}
```

#### `GET /api/health` - 健康检查

**示例：**

```bash
curl http://localhost:4848/api/health
```

**输出：**

```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.2.5"
}
```

### WebUI 仪表板

**启动：**

```bash
hannah web --port=4849 --open
```

**功能：**

1. **实时统计卡片**
   - 总事件数
   - 拒绝数
   - 警告数
   - 活跃会话数

2. **最近事件表格**
   - 时间戳
   - 事件类型
   - 工具/文件
   - 动作（带颜色徽章）
   - 原因

3. **活跃会话表格**
   - 会话 ID
   - 代理类型
   - 开始时间
   - 事件数
   - 错误率

4. **SSE 实时刷新**
   - 自动更新统计
   - 实时事件流

**访问：**

打开浏览器访问 `http://localhost:4849`

---

## VSCode 扩展使用

### 安装

**位置：** `editors/vscode/`

**安装步骤：**

```bash
cd editors/vscode
npm install
npm run compile
code --install-extension agent-runtime-trace-0.1.0.vsix
```

### 功能

#### 1. 侧边栏面板

**位置：** VSCode 辅助侧边栏

**两个树视图：**

**工具调用链（Tool Call Chain）**

- 会话 → 工具 → 事件层次结构
- 可视化展示代理的操作流程
- 支持展开/折叠

**策略与规则（Policies & Rules）**

- 策略浏览器
- 启用/禁用切换
- 规则详情查看

#### 2. 状态栏

**位置：** VSCode 底部状态栏

**显示：**

- 实时事件计数
- 拒绝数
- 警告数

**图标：**

- ✅ 允许
- ❌ 拒绝
- ⚠️ 警告

#### 3. 文件监视器

**功能：**

- 自动刷新追踪视图
- 监听追踪文件变化
- 增量读取（高效处理大文件）

#### 4. 命令

**可用命令：**

1. **Refresh** - 刷新追踪视图
2. **Clear** - 清除追踪
3. **Filter Denied** - 仅显示拒绝的操作
4. **Time Windows** - 时间窗口
   - 5 分钟
   - 1 小时
   - 今天

**使用方法：**

1. 打开命令面板（Ctrl+Shift+P / Cmd+Shift+P）
2. 输入 "Agent Runtime"
3. 选择命令

#### 5. 配置

**设置项：**

```json
{
  "agentRuntime.traceDir": ".harness/traces",
  "agentRuntime.autoRefresh": true,
  "agentRuntime.maxEntries": 1000
}
```

**配置方法：**

1. 打开设置（Ctrl+, / Cmd+,）
2. 搜索 "Agent Runtime"
3. 修改配置项

### 使用示例

**查看追踪：**

1. 打开辅助侧边栏
2. 展开 "Tool Call Chain"
3. 查看会话列表
4. 展开会话查看工具调用
5. 展开工具查看事件

**管理策略：**

1. 展开 "Policies & Rules"
2. 查看已加载的策略
3. 点击策略查看规则
4. 使用切换按钮启用/禁用策略

**过滤事件：**

1. 打开命令面板
2. 选择 "Agent Runtime: Filter Denied"
3. 仅显示拒绝的操作

---

## 配置文件格式参考

### 策略 YAML

**位置：** `.harness/policies/*.yaml`

**完整示例：**

```yaml
name: my-policy
description: 自定义规则
rules:
  - name: block-sensitive
    when: code.before_modify # 事件名称（或数组）
    match:
      - field: filePath # 字段路径（点表示法）
        pattern: "**/*.env" # Glob 模式（或数组）
        negate: false # 可选，取反
    action: deny # allow|deny|warn|retry|trace|modify
    reason: "环境文件受保护" # 内部日志原因
    feedback: "不能修改 .env 文件" # 返回给代理的反馈
    modifiedInput: {} # action: modify 时的修改参数

  - name: require-tests
    when: task.before_complete
    match:
      - field: hasTests
        pattern: "false"
    action: deny
    reason: "必须运行测试"
    feedback: "请先运行测试再完成任务"
```

### 语义规则 YAML

**位置：** `.harness/semantic-hooks/*.yaml`

**完整示例：**

```yaml
source: custom
rules:
  - name: no-hardcoded-secrets
    description: 阻止硬编码密钥
    events: [tool.before, code.before_modify]
    priority: 50
    match:
      file_type: [ts, js, py, go]
      content: ['api_key = "', "password = '", 'secret = "']
      command: []
      tool_name: []
      file_path: []
      mcp_server: []
      mcp_operation: []
    action: deny
    feedback: "请使用环境变量"
    suggestions:
      - "使用 process.env.API_KEY"
      - "使用 dotenv 库"
```

### Hook 配置 JSON

**位置：** `.harness/hooks/config/hooks-config.json`

**完整示例：**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs session-start",
        "timeout": 10000,
        "priority": 100
      }
    ],
    "PreToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs pre-tool-use",
        "timeout": 10000,
        "priority": 100
      }
    ],
    "PostToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs post-tool-use",
        "timeout": 10000,
        "priority": 100
      }
    ],
    "Stop": [
      {
        "type": "shell",
        "command": "node .harness/hooks/handler.mjs stop",
        "timeout": 10000,
        "priority": 100
      }
    ]
  },
  "disablePreToolUseHook": false,
  "disableLogging": false
}
```

### 架构 YAML

**位置：** `.harness/architecture.yaml`

**完整示例：**

```yaml
layers:
  - name: ui
    patterns:
      - "src/ui/**"
      - "src/components/**"
      - "src/pages/**"
  - name: core
    patterns:
      - "src/core/**"
      - "src/services/**"
  - name: data
    patterns:
      - "src/data/**"
      - "src/models/**"
  - name: utils
    patterns:
      - "src/utils/**"
      - "src/helpers/**"

rules:
  - from: ui
    to: data
    allowed: false
    feedback: "UI 层不能直接访问数据层，请使用 core 层"

  - from: ui
    to: core
    allowed: true

  - from: core
    to: data
    allowed: true

  - from: data
    to: core
    allowed: false
    feedback: "数据层不能依赖 core 层"
```

### Harness 配置 YAML

**位置：** `.harness/config.yaml`

**完整示例：**

```yaml
project: my-project
adapters:
  - claude-code
  - copilot
  - codex

trace:
  enabled: true
  dir: .harness/traces
  format: jsonl
  rotation:
    enabled: true
    maxSize: 10MB
    maxFiles: 10

policies:
  - policies

semantic:
  enabled: true
  dir: .harness/semantic-hooks
  scanAgentMd: true
  detectTechStack: true

intelligence:
  enabled: true
  anomalyDetection: true
  patternAnalysis: true
  escalation: true
  recommend: true

server:
  monitor:
    port: 4848
    enabled: true
  web:
    port: 4849
    enabled: true

watcher:
  enabled: true
  interval: 1000
  backup: true
```

---

## 常见问题排查

### 1. Hook 不生效

**问题：** 配置了 Hook 但没有触发

**排查步骤：**

1. **检查配置文件位置**

```bash
# 确认配置文件存在
ls -la .harness/hooks/config/
```

2. **检查配置格式**

```bash
# 验证 JSON 格式
cat .harness/hooks/config/hooks-config.json | jq .
```

3. **检查处理器脚本**

```bash
# 确认处理器脚本存在且可执行
ls -la .harness/hooks/handler.mjs
chmod +x .harness/hooks/handler.mjs
```

4. **查看日志**

```bash
# 查看 Hook 执行日志
tail -f .harness/hooks/logs/*.jsonl
```

5. **检查代理配置**

```bash
# 确认代理配置正确指向处理器
cat .claude/settings.json  # Claude Code
cat .github/hooks/hooks.json  # Copilot
```

---

### 2. 策略未生效

**问题：** 配置了策略但没有拦截

**排查步骤：**

1. **验证策略文件**

```bash
hannah policy validate
```

2. **检查策略加载**

```bash
hannah policy list
```

3. **检查事件匹配**

```bash
# 查看追踪，确认事件名称
hannah trace --json | jq '.event'
```

4. **检查字段路径**

```bash
# 查看事件数据结构
hannah trace --json | head -1 | jq .
```

5. **测试策略**

```bash
# 检查文件是否符合策略
hannah policy check src/index.ts
```

---

### 3. 追踪日志为空

**问题：** 没有生成追踪日志

**排查步骤：**

1. **检查追踪配置**

```bash
cat .harness/config.yaml | grep -A 5 trace
```

2. **检查目录权限**

```bash
ls -la .harness/traces/
```

3. **手动触发事件**

```bash
# 使用代理执行一些操作，然后查看追踪
hannah trace
```

4. **检查日志文件**

```bash
# 查看是否有日志文件
ls -la .harness/hooks/logs/
```

---

### 4. 文件监视器不工作

**问题：** `hannah watch` 没有保护文件

**排查步骤：**

1. **检查监视器配置**

```bash
cat .harness/config.yaml | grep -A 5 watcher
```

2. **手动启动监视器**

```bash
hannah watch
```

3. **测试保护**

```bash
# 尝试修改受保护的文件
echo "test" >> agent.md

# 检查是否被恢复
cat agent.md
```

4. **查看监视器日志**

```bash
# 查看监视器输出
```

---

### 5. WebUI 无法访问

**问题：** 无法访问 WebUI 仪表板

**排查步骤：**

1. **检查服务器是否运行**

```bash
# 检查端口占用
netstat -ano | findstr :4849  # Windows
lsof -i :4849  # Linux/Mac
```

2. **重启服务器**

```bash
hannah web --port=4849
```

3. **检查防火墙**

```bash
# 确保端口未被阻止
```

4. **查看服务器日志**

```bash
# 查看终端输出
```

---

### 6. VSCode 扩展不显示

**问题：** 安装扩展后侧边栏不显示

**排查步骤：**

1. **检查扩展是否启用**

```bash
# 在 VSCode 中
Ctrl+Shift+X  # 打开扩展面板
搜索 "Agent Runtime"
```

2. **重新加载窗口**

```bash
# 在 VSCode 中
Ctrl+Shift+P
选择 "Developer: Reload Window"
```

3. **检查配置**

```bash
# 在 VSCode 设置中
Ctrl+,
搜索 "agentRuntime"
```

4. **查看扩展日志**

```bash
# 在 VSCode 中
Ctrl+Shift+U  # 打开输出面板
选择 "Agent Runtime"
```

---

### 7. 语义 Hook 未生成

**问题：** `hannah init` 没有生成语义 Hook

**排查步骤：**

1. **检查 agent.md 是否存在**

```bash
ls -la agent.md CLAUDE.md COPILOT.md .cursorrules
```

2. **检查技术栈检测**

```bash
ls -la package.json
```

3. **手动同步**

```bash
hannah sync
```

4. **查看生成的 Hook**

```bash
ls -la .harness/semantic-hooks/
```

---

### 8. 智能分析无结果

**问题：** `hannah learn` 命令没有输出

**排查步骤：**

1. **检查是否有足够的追踪数据**

```bash
hannah trace --all
```

2. **指定时间范围**

```bash
hannah learn full --days=7
```

3. **检查智能配置**

```bash
cat .harness/config.yaml | grep -A 10 intelligence
```

---

## 附录

### A. 通用事件分类系统

**19 种事件类型，9 个类别：**

| 类别             | 事件                                                  |
| ---------------- | ----------------------------------------------------- |
| **task**         | `task.start`, `task.before_complete`, `task.complete` |
| **skill**        | `skill.before`, `skill.after`                         |
| **tool**         | `tool.before`, `tool.after`                           |
| **mcp**          | `mcp.before`, `mcp.after`                             |
| **code**         | `code.before_modify`, `code.after_modify`             |
| **git**          | `git.worktree_keep`, `git.worktree_undo`              |
| **agent**        | `agent.start`, `agent.stop`                           |
| **confirm**      | `confirm.before`, `confirm.after`                     |
| **api**          | `api.before`, `api.after`                             |
| **prompt**       | `prompt.before`, `prompt.after`                       |
| **notification** | `notification`                                        |
| **subagent**     | `subagent.stop`                                       |

### B. 支持级别

每个事件对每个适配器有一个 `SupportLevel`：

- `native`：原生支持
- `emulated`：模拟支持
- `unsupported`：不支持

### C. 退出码

| 退出码 | 含义          |
| ------ | ------------- |
| 0      | 允许（allow） |
| 2      | 拒绝（deny）  |
| 3      | 重试（retry） |

### D. 文件分类

**文件扫描器分类：**

- `sensitive`：敏感文件（.env, .ssh）
- `lock`：Lock 文件（package-lock.json）
- `generated`：生成文件（dist/, build/）
- `binary`：二进制文件（.exe, .dll）
- `config`：配置文件（.yaml, .json）

**风险级别：**

- `low`：低风险
- `medium`：中风险
- `high`：高风险
- `critical`：关键风险

### E. 意图类型

**意图提取器分类：**

- `file_create`：创建文件
- `file_modify`：修改文件
- `file_delete`：删除文件
- `file_read`：读取文件
- `code_execute`：执行代码
- `git_commit`：Git 提交
- `git_push`：Git 推送
- `git_force_push`：Git 强制推送
- `git_reset`：Git 重置
- `dependency_install`：安装依赖
- `config_change`：修改配置
- `mcp_call`：调用 MCP
- `search`：搜索
- `test_run`：运行测试

---

## 总结

Hannah Agent Runtime 提供了一个完整的 AI 代理治理解决方案，包括：

- ✅ **统一的事件模型**：支持 6 种 AI 代理
- ✅ **强大的安全策略**：红线保护、文件保护、命令拦截
- ✅ **智能语义引擎**：自然语言规则自动生成 Hook
- ✅ **实时监控**：SSE 事件流 + WebUI 仪表板
- ✅ **智能分析**：异常检测、模式分析、策略推荐
- ✅ **VSCode 集成**：侧边栏追踪 + 策略浏览器

通过本手册，你应该能够：

1. 快速初始化并配置 Hannah
2. 理解并使用所有 CLI 命令
3. 配置自定义策略和语义规则
4. 使用智能监控和分析功能
5. 集成 VSCode 扩展
6. 排查常见问题

如有更多问题，请参考项目文档或提交 Issue。

---

**文档版本：** 1.0  
**最后更新：** 2026-09-03  
**维护者：** Hannah Team
