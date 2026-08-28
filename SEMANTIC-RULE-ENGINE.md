# 语义级 Hook 正则匹配触发方案

## 问题

语义级 hook 没有特定的触发点（不像 `PreToolUse` 是 agent 原生事件），
需要从 agent 的每一次操作中"嗅探"是否违反了项目规则。

## 设计：多维度正则匹配引擎

### 核心思路

每次 agent 调用工具时，handler.mjs 从输入中提取 **7 个维度** 的值，
然后用内置规则库（16 条）逐条匹配。匹配逻辑：

```
同一维度内多个 pattern → OR（任一命中即可）
不同维度之间           → AND（所有提供的维度都必须命中）
至少提供一个维度
```

### 7 个匹配维度

| 维度 | 字段名 | 提取来源 | 示例 |
|------|--------|---------|------|
| 工具名 | `tool_name` | `input.tool_name` | `Write`, `Bash`, `mcp__database__write` |
| 文件路径 | `file_path` | `input.file_path` / `input.path` | `.env`, `src/core/engine.ts` |
| 写入内容 | `content` | `input.content` | `DROP TABLE`, `password = "xxx"` |
| Shell 命令 | `command` | `input.command` | `git push --force`, `rm -rf /` |
| MCP 服务器 | `mcp_server` | 从 `mcp__server__op` 解析 | `database`, `filesystem` |
| MCP 操作 | `mcp_operation` | 从 `mcp__server__op` 解析 | `write`, `delete`, `drop` |
| 文件类型 | `file_type` | 从 `file_path` 提取扩展名 | `ts`, `vue`, `sql`, `tsx` |

### 匹配方式

- **Glob 模式**：pattern 包含 `*` 或 `?` 时，转为正则匹配（`**` = 任意路径，`*` = 单级通配）
- **包含匹配**：不含通配符时，大小写不敏感的子串包含

### 内置规则库（16 条）

| # | 规则名 | 动作 | 匹配维度 | 匹配内容 |
|---|--------|------|---------|---------|
| 1 | `redline-agent-files` | **DENY** | file_path | `**/agent.md`, `**/CLAUDE.md`, `**/.cursorrules` 等 |
| 2 | `redline-harness-config` | **DENY** | file_path | `**/.harness/**` |
| 3 | `env-protection` | **DENY** | file_path | `**/.env`, `**/.env.*`, `**/*.env` |
| 4 | `lock-file-protection` | **DENY** | file_path | `**/package-lock.json`, `**/pnpm-lock.yaml` 等 |
| 5 | `production-config` | **DENY** | file_path | `**/production.yaml`, `**/prod/**` 等 |
| 6 | `dangerous-rm` | **DENY** | command | `rm -rf /`, `rm -rf ~`, `rm -rf .`, `rm -rf *` |
| 7 | `dangerous-git-force` | **DENY** | command | `git push --force`, `git push -f` |
| 8 | `dangerous-db-drop` | **DENY** | content | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` |
| 9 | `secret-password` | **DENY** | content | `password = "`, `passwd = '` 等 |
| 10 | `secret-api-key` | **DENY** | content | `api_key = "`, `apiKey = '` 等 |
| 11 | `secret-private-key` | **DENY** | content | `-----BEGIN RSA PRIVATE KEY-----` 等 |
| 12 | `mcp-db-write` | **DENY** | mcp_server + mcp_operation | server ∈ {database,db,sql...} AND op ∈ {write,delete,drop...} |
| 13 | `react-xss` | WARN | file_type + content | `.tsx/.jsx` AND `dangerouslySetInnerHTML` |
| 14 | `vue-xss` | WARN | file_type + content | `.vue` AND `v-html` |
| 15 | `eval-injection` | WARN | file_type + content | `.ts/.js/.py` AND `eval(` |
| 16 | `core-module` | WARN | file_path | `**/src/core/**`, `**/src/kernel/**` |

### 评估流程

```
Agent 调用工具
    ↓
handler.mjs 接收 stdin JSON
    ↓
┌─ 1. YAML 策略评估（.harness/policies/*.yaml）
│     逐事件评估 → 最严格决策
│
├─ 2. 语义规则评估（内置 16 条规则）
│     提取 7 维度 → 逐条匹配 → 最严格决策
│
└─ 3. 合并决策（deny > warn > allow）
      ↓
  输出 JSON + exit code + 写 trace
```

### 自定义规则

用户可以在 `agent.md` 中写自然语言规则，`hannah sync` 会扫描并提取：

```markdown
# 项目规则

## 安全
- 不要修改 production 配置
- 禁止使用 eval()

## 架构
- 不要直接操作数据库
```

扫描器会提取这些规则并生成对应的语义 hook，保存到 `.harness/semantic-hooks/hooks.json`。

### 测试结果

```
  ✅ 修改 .env 文件           → DENY
  ✅ 修改 agent.md            → DENY
  ✅ 修改 .harness/config.yaml → DENY
  ✅ git push --force         → DENY
  ✅ rm -rf /                 → DENY
  ✅ MCP database write       → DENY
  ✅ DROP TABLE in content    → DENY
  ✅ Hardcoded password       → DENY
  ✅ dangerouslySetInnerHTML  → WARN
  ✅ v-html in Vue            → WARN
  ✅ eval() in JS             → WARN
  ✅ 修改 core 模块            → WARN
  ✅ 生产配置文件              → DENY
  ✅ 正常文件修改              → ALLOW
  ✅ lock 文件修改             → DENY

  15/15 passed
```

### 实现文件

| 文件 | 说明 |
|------|------|
| `src/semantic/rule-engine.ts` | 独立的语义规则引擎（TypeScript，可被其他模块引用） |
| `src/cli/init.ts` → `HANDLER_MJS` | handler.mjs 中内嵌的语义规则评估（零依赖） |

handler.mjs 中的实现是完全自包含的，不依赖任何外部模块。
