# Hannah Agent Runtime 端到端实战手册

> 版本：1.0  
> 最后更新：2026-09-03

本文档提供完整的实战场景演练，从零开始配置到生产环境部署。

---

## 目录

1. [场景一：从零配置 GitHub Copilot 项目](#场景一从零配置-github-copilot-项目)
2. [场景二：配置 Claude Code 项目](#场景二配置-claude-code-项目)
3. [场景三：自定义策略开发流程](#场景三自定义策略开发流程)
4. [场景四：监控与优化工作流](#场景四监控与优化工作流)
5. [场景五：多代理团队协作](#场景五多代理团队协作)
6. [场景六：Hook Handler 自定义开发](#场景六hook-handler-自定义开发)
7. [场景七：意图规则配置](#场景七意图规则配置)
8. [场景八：架构层规则配置](#场景八架构层规则配置)
9. [场景九：生产环境部署](#场景九生产环境部署)
10. [场景十：故障排查实战](#场景十故障排查实战)

---

## 场景一：从零配置 GitHub Copilot 项目

### 背景

你有一个 React + TypeScript 项目，使用 GitHub Copilot 作为 AI 编码助手。你希望：

- 防止 Copilot 修改敏感文件（.env、lock 文件）
- 阻止危险的 Shell 命令
- 实时监控 Copilot 的行为
- 生成行为报告

### 步骤 1：项目准备

```bash
# 进入你的项目目录
cd my-react-project

# 确认项目结构
ls
# 应该看到：package.json, src/, tsconfig.json 等
```

### 步骤 2：安装 Hannah

```bash
# 全局安装
npm install -g hannah

# 验证安装
hannah --version
# 输出：0.2.5
```

### 步骤 3：初始化 Hannah

```bash
# 初始化，选择 Copilot 适配器
hannah init --agent=copilot
```

**预期输出：**

```
? Select your AI coding agent:
✓ Selected: GitHub Copilot

📁 Creating .harness/ directory...
  ✅ Created .harness/config.yaml
  ✅ Created .harness/policies/redline.yaml
  ✅ Created .harness/policies/security.yaml
  ✅ Created .harness/hooks/handler.mjs
  ✅ Created .harness/hooks/config/hooks-config.json

🔍 Detecting tech stack...
  ✅ Detected: React, TypeScript, Node.js

📝 Scanning agent.md...
  ⚠️  No agent.md found, skipping

🔧 Generating semantic hooks...
  ✅ Created .harness/semantic-hooks/react-security.yaml
  ✅ Created .harness/semantic-hooks/environment-protection.yaml
  ✅ Created .harness/semantic-hooks/secret-detection.yaml

🔗 Configuring Copilot adapter...
  ✅ Created .github/hooks/hooks.json

✨ Hannah initialized successfully!

Next steps:
  1. Start file watcher: hannah watch
  2. Start monitoring: hannah monitor --open
  3. View traces: hannah trace
```

### 步骤 4：验证生成的文件

```bash
# 查看生成的目录结构
tree .harness -L 3
```

**预期输出：**

```
.harness/
├── config.yaml
├── policies/
│   ├── redline.yaml
│   └── security.yaml
├── hooks/
│   ├── handler.mjs
│   ├── config/
│   │   └── hooks-config.json
│   └── logs/
├── traces/
└── semantic-hooks/
    ├── react-security.yaml
    ├── environment-protection.yaml
    └── secret-detection.yaml
```

### 步骤 5：检查 Copilot 配置

```bash
# 查看生成的 Copilot 配置
cat .github/hooks/hooks.json
```

**预期内容：**

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }
    ]
  }
}
```

### 步骤 6：启动文件监视器

```bash
# 在新终端窗口中启动文件监视器
hannah watch
```

**预期输出：**

```
👁️  Starting file watcher for redline protection...

📋 Monitoring protected files:
  - agent.md
  - CLAUDE.md
  - COPILOT.md
  - .cursorrules
  - .env
  - .env.*
  - package-lock.json
  - pnpm-lock.yaml
  - yarn.lock

✅ File watcher started
Press Ctrl+C to stop
```

**保持此终端运行。**

### 步骤 7：启动监控面板

```bash
# 在另一个终端窗口中启动 WebUI
hannah web --open
```

**预期输出：**

```
🌐 Starting WebUI Dashboard...

✅ Server started at http://localhost:4849
📊 Dashboard ready!

Press Ctrl+C to stop
```

浏览器会自动打开 `http://localhost:4849`。

### 步骤 8：测试保护规则

**测试 1：尝试修改 .env 文件**

在 VS Code 中打开 Copilot Chat，输入：

```
请帮我修改 .env 文件，添加一个新的环境变量 API_KEY=test123
```

**预期结果：**

Copilot 会收到拒绝消息：

```
❌ 操作被拒绝

原因：环境文件受保护
反馈：不能修改 .env 文件，请使用环境变量
```

在 WebUI 中会看到：

```
[14:23:15] ❌ code.before_modify | .env | deny | 环境文件受保护
```

**测试 2：尝试执行危险命令**

在 Copilot Chat 中输入：

```
请帮我执行 git push --force 来强制推送代码
```

**预期结果：**

```
❌ 操作被拒绝

原因：Git 安全策略
反馈：禁止使用 git push --force，请使用普通的 git push
```

**测试 3：正常操作**

在 Copilot Chat 中输入：

```
请帮我在 src/components/ 下创建一个新的 Button 组件
```

**预期结果：**

```
✅ 操作允许

Copilot 会正常创建组件文件
```

在 WebUI 中会看到：

```
[14:25:30] ✅ tool.before | Write | src/components/Button.tsx | allow
```

### 步骤 9：查看追踪日志

```bash
# 查看最近的追踪
hannah trace
```

**预期输出：**

```
📋 Agent Runtime Traces (最近 50 条)

[2026-09-03 14:23:15] ❌ code.before_modify | .env | deny | 环境文件受保护
[2026-09-03 14:24:02] ❌ tool.before | Bash | git push --force | deny | Git 安全策略
[2026-09-03 14:25:30] ✅ tool.before | Write | src/components/Button.tsx | allow
[2026-09-03 14:25:31] ✅ tool.after | Write | src/components/Button.tsx | allow | 234ms
```

### 步骤 10：生成统计报告

```bash
# 查看今天的统计
hannah summary --today
```

**预期输出：**

```
📊 Hannah Agent Runtime - 统计摘要

时间范围：2026-09-03 00:00:00 至 2026-09-03 23:59:59

总计事件：47
  ✅ 允许：42 (89.4%)
  ❌ 拒绝：4 (8.5%)
  ⚠️  警告：1 (2.1%)

活跃会话：2
平均会话时长：1.2 小时

最常用工具：
  1. Write (18 次)
  2. Bash (12 次)
  3. Read (10 次)

被拒绝操作：
  1. 修改 .env 文件 (2 次)
  2. git push --force (1 次)
  3. 修改 agent.md (1 次)
```

### 步骤 11：导出报告

```bash
# 导出为 JSON
hannah export --format=json --output=copilot-report.json

# 导出为 CSV
hannah export --format=csv --days=7 --output=copilot-weekly.csv
```

### 完成！

你已经成功配置了一个完整的 Copilot 治理环境。

---

## 场景二：配置 Claude Code 项目

### 背景

你有一个 Node.js 后端项目，使用 Claude Code 作为 AI 编码助手。你希望：

- 保护数据库操作
- 防止修改生产配置
- 自动检测密钥泄露

### 步骤 1：初始化

```bash
cd my-backend-project

# 初始化，选择 Claude Code
hannah init --agent=claude-code
```

**预期输出：**

```
? Select your AI coding agent:
✓ Selected: Claude Code

📁 Creating .harness/ directory...
  ✅ Created .harness/config.yaml
  ✅ Created .harness/policies/redline.yaml
  ✅ Created .harness/policies/security.yaml

🔍 Detecting tech stack...
  ✅ Detected: Node.js, Express, Prisma

🔧 Generating semantic hooks...
  ✅ Created .harness/semantic-hooks/database-protection.yaml
  ✅ Created .harness/semantic-hooks/secret-detection.yaml
  ✅ Created .harness/semantic-hooks/production-protection.yaml

🔗 Configuring Claude Code adapter...
  ✅ Updated .claude/settings.json

✨ Hannah initialized successfully!
```

### 步骤 2：检查 Claude Code 配置

```bash
cat .claude/settings.json
```

**预期内容：**

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
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .harness/hooks/handler.mjs post-tool-use"
          }
        ]
      }
    ]
  }
}
```

### 步骤 3：创建 agent.md（可选但推荐）

```bash
# 创建 agent.md 文件
cat > agent.md << 'EOF'
# AI Agent 规则

## 禁止操作

- 不要修改 .env 文件
- 不要执行 git push --force
- 不要修改 prisma/schema.prisma 文件
- 不要在生产配置中进行修改

## 代码规范

- 所有 API 密钥必须使用环境变量
- 数据库操作必须使用 Prisma
- 禁止使用 raw SQL

## 安全要求

- 不要硬编码任何密钥或密码
- 不要提交敏感信息到 Git
EOF
```

### 步骤 4：重新同步语义 Hook

```bash
# 扫描 agent.md 并生成语义 Hook
hannah sync
```

**预期输出：**

```
🔄 Synchronizing semantic hooks...

📝 Scanning agent.md...
  ✅ Found 8 rules

🔧 Generating semantic hooks...
  ✅ Created .harness/semantic-hooks/agent-md-rule-1.yaml
  ✅ Created .harness/semantic-hooks/agent-md-rule-2.yaml
  ✅ Created .harness/semantic-hooks/agent-md-rule-3.yaml
  ✅ Created .harness/semantic-hooks/agent-md-rule-4.yaml

✨ Synchronization complete!
```

### 步骤 5：测试数据库保护

在 Claude Code 中输入：

```
请帮我执行 DROP TABLE users 来删除用户表
```

**预期结果：**

```
❌ 操作被拒绝

原因：数据库保护策略
反馈：禁止执行危险的 SQL 操作（DROP TABLE）
```

### 步骤 6：测试密钥检测

在 Claude Code 中输入：

```
请帮我在代码中添加 API_KEY = "sk-1234567890abcdef"
```

**预期结果：**

```
❌ 操作被拒绝

原因：密钥检测策略
反馈：请使用环境变量，不要硬编码密钥
建议：
  - 使用 process.env.API_KEY
  - 使用 dotenv 库
```

---

## 场景三：自定义策略开发流程

### 背景

你希望为项目添加自定义策略：

- 禁止在周末部署
- 禁止修改特定目录
- 要求所有代码修改必须包含测试

### 步骤 1：创建自定义策略文件

```bash
# 创建策略文件
cat > .harness/policies/custom.yaml << 'EOF'
name: custom-deployment-policy
description: 自定义部署和开发规则

rules:
  # 禁止在周末部署
  - name: no-weekend-deploy
    when: tool.before
    match:
      - field: tool.name
        pattern: "Bash"
      - field: input.command
        pattern: "*deploy*"
    action: deny
    reason: "禁止在周末部署"
    feedback: "部署操作不允许在周末执行，请选择工作日"

  # 禁止修改 legacy 目录
  - name: protect-legacy
    when: code.before_modify
    match:
      - field: filePath
        pattern: "src/legacy/**"
    action: deny
    reason: "Legacy 代码受保护"
    feedback: "src/legacy/ 目录是遗留代码，禁止修改"

  # 要求代码修改必须包含测试
  - name: require-tests
    when: task.before_complete
    match:
      - field: hasTests
        pattern: "false"
    action: deny
    reason: "必须包含测试"
    feedback: "代码修改必须包含相应的测试用例"
EOF
```

### 步骤 2：验证策略

```bash
# 验证策略文件
hannah policy validate
```

**预期输出：**

```
✅ 所有策略文件验证通过

检查的文件：
  ✅ .harness/policies/redline.yaml
  ✅ .harness/policies/security.yaml
  ✅ .harness/policies/custom.yaml
```

### 步骤 3：查看策略列表

```bash
hannah policy list
```

**预期输出：**

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

3. custom-deployment-policy（自定义）
   文件：.harness/policies/custom.yaml
   规则数：3
   状态：✅ 启用
```

### 步骤 4：测试策略

**测试 1：周末部署**

假设今天是周六，在 AI 助手中输入：

```
请帮我执行部署脚本 npm run deploy
```

**预期结果：**

```
❌ 操作被拒绝

原因：禁止在周末部署
反馈：部署操作不允许在周末执行，请选择工作日
```

**测试 2：修改 legacy 代码**

```
请帮我修改 src/legacy/old-module.ts 文件
```

**预期结果：**

```
❌ 操作被拒绝

原因：Legacy 代码受保护
反馈：src/legacy/ 目录是遗留代码，禁止修改
```

### 步骤 5：查看策略详情

```bash
hannah policy show custom-deployment-policy
```

**预期输出：**

```
📋 策略详情：custom-deployment-policy

名称：自定义部署和开发规则
文件：.harness/policies/custom.yaml
规则数：3

规则列表：
  1. no-weekend-deploy
     事件：tool.before
     动作：deny
     原因：禁止在周末部署

  2. protect-legacy
     事件：code.before_modify
     动作：deny
     原因：Legacy 代码受保护

  3. require-tests
     事件：task.before_complete
     动作：deny
     原因：必须包含测试
```

---

## 场景四：监控与优化工作流

### 背景

你的团队已经使用 Hannah 一周，现在需要：

- 分析使用模式
- 检测异常行为
- 优化策略规则
- 生成周报

### 步骤 1：查看使用模式

```bash
hannah learn patterns --days=7
```

**预期输出：**

```
🔍 模式分析结果（最近 7 天）

工具使用频率：
  1. Write: 342 次 (27.7%)
  2. Bash: 289 次 (23.4%)
  3. Read: 156 次 (12.6%)
  4. Edit: 134 次 (10.8%)
  5. Search: 98 次 (7.9%)

高峰时段：
  1. 14:00-15:00 (187 次)
  2. 10:00-11:00 (156 次)
  3. 16:00-17:00 (134 次)

常见操作序列：
  1. Read → Write → Bash (89 次)
  2. Write → Bash → Read (67 次)
  3. Read → Edit → Bash (45 次)

错误率趋势：
  Bash: 15.2% (↑ 2.3%)
  Write: 3.4% (↓ 0.5%)
  Edit: 2.1% (→ 0.0%)
```

### 步骤 2：检测异常

```bash
hannah learn anomalies --days=7
```

**预期输出：**

```
⚠️  检测到异常（最近 7 天）：

1. 错误峰值
   时间：2026-09-02 14:00-15:00
   错误数：23（正常：5.2 ± 3.1）
   可能原因：Bash 命令频繁失败
   建议：检查该时段的 Bash 命令

2. 异常工具使用
   会话：abc123
   问题：单一工具主导（Write 占 92%）
   可能原因：陷入循环
   建议：检查会话 abc123

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

### 步骤 3：获取优化建议

```bash
hannah learn recommend --days=7
```

**预期输出：**

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

### 步骤 4：执行优化分析

```bash
hannah analyze --days=7
```

**预期输出：**

```
🔍 Hannah Agent Runtime - 规则优化分析

分析时间范围：2026-08-27 至 2026-09-03

📋 误报规则（高允许率但频繁触发）：
  1. protect-env：触发 45 次，允许 44 次 (97.8%)
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

### 步骤 5：生成周报

```bash
# 导出最近 7 天的数据
hannah export --format=json --days=7 --output=weekly-report.json

# 生成统计摘要
hannah summary --days=7 > weekly-summary.txt
```

### 步骤 6：应用优化

根据建议，创建新的策略：

```bash
cat > .harness/policies/bash-whitelist.yaml << 'EOF'
name: bash-command-whitelist
description: Bash 命令白名单

rules:
  - name: allow-safe-commands
    when: tool.before
    match:
      - field: tool.name
        pattern: "Bash"
      - field: input.command
        pattern:
          - "npm *"
          - "pnpm *"
          - "yarn *"
          - "node *"
          - "git status"
          - "git diff"
          - "git log"
    action: allow

  - name: warn-unknown-commands
    when: tool.before
    match:
      - field: tool.name
        pattern: "Bash"
    action: warn
    reason: "未知的 Bash 命令"
    feedback: "请确认命令的安全性"
EOF
```

---

## 场景五：多代理团队协作

### 背景

你的团队同时使用多个 AI 代理：

- 前端开发使用 Copilot
- 后端开发使用 Claude Code
- DevOps 使用 Codex CLI

你希望统一管理所有代理的行为。

### 步骤 1：初始化多代理配置

```bash
# 初始化，选择多个代理
hannah init

# 在交互界面中选择第一个代理（如 Copilot）
# 然后手动编辑配置添加其他代理
```

**编辑 `.harness/config.yaml`：**

```yaml
project: my-project
adapters:
  - copilot
  - claude-code
  - codex

trace:
  enabled: true
  dir: .harness/traces

policies:
  - policies

semantic:
  enabled: true
  scanAgentMd: true
```

### 步骤 2：为每个代理生成配置

```bash
# 为 Copilot 生成配置
hannah init --agent=copilot

# 为 Claude Code 生成配置
hannah init --agent=claude-code

# 为 Codex 生成配置
hannah init --agent=codex
```

**注意：** 每次初始化会覆盖之前的配置，所以需要手动合并。

**手动合并后的配置：**

```bash
# Copilot 配置
cat > .github/hooks/hooks.json << 'EOF'
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
EOF

# Claude Code 配置
cat > .claude/settings.json << 'EOF'
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
EOF

# Codex 配置
cat > .codex/hooks.json << 'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }
    ]
  }
}
EOF
```

### 步骤 3：启动统一监控

```bash
# 启动 WebUI（统一监控所有代理）
hannah web --open
```

在 WebUI 中可以看到所有代理的活动，并按代理类型过滤。

### 步骤 4：查看各代理的统计

```bash
# 查看所有代理的统计
hannah summary --today

# 导出特定代理的数据
hannah export --format=json --session=copilot-session-123 --output=copilot.json
hannah export --format=json --session=claude-session-456 --output=claude.json
```

---

## 场景六：Hook Handler 自定义开发

### 背景

你希望自定义 Hook Handler 的逻辑：

- 添加自定义日志格式
- 集成外部通知系统（如 Slack）
- 实现复杂的业务逻辑

### 步骤 1：查看默认 Handler

```bash
cat .harness/hooks/handler.mjs
```

**默认内容（简化版）：**

```javascript
#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const hookType = process.argv[2]; // pre-tool-use, post-tool-use, etc.
const input = JSON.parse(await readStdin());

// 加载策略
const policies = loadPolicies();

// 执行策略检查
const result = checkPolicies(input, policies);

// 输出结果
if (result.decision === "deny") {
  console.error(result.feedback);
  process.exit(2);
} else if (result.decision === "warn") {
  console.error(result.feedback);
  process.exit(0);
} else {
  process.exit(0);
}

// 记录追踪
writeTrace(input, result);
```

### 步骤 2：创建自定义 Handler

```bash
cat > .harness/hooks/custom-handler.mjs << 'EOF'
#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── 配置 ─────────────────────────────────────────────
const CONFIG = {
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  notifyOnDeny: true,
  logFormat: 'json', // json | text
};

// ─── 读取输入 ─────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

const input = JSON.parse(await readStdin());
const hookType = process.argv[2];

// ─── 自定义逻辑 ───────────────────────────────────────

// 1. 检查是否是工作时间
function isWorkHours() {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  return day >= 1 && day <= 5 && hour >= 9 && hour <= 18;
}

// 2. 检查是否是部署操作
function isDeployOperation(input) {
  return input.tool_name === 'Bash' &&
         input.tool_input?.command?.includes('deploy');
}

// 3. 发送 Slack 通知
async function sendSlackNotification(message) {
  if (!CONFIG.slackWebhook) return;

  await fetch(CONFIG.slackWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🔔 Hannah Agent Alert`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ]
    })
  });
}

// 4. 主逻辑
let decision = 'allow';
let feedback = '';

// 非工作时间禁止部署
if (!isWorkHours() && isDeployOperation(input)) {
  decision = 'deny';
  feedback = '非工作时间禁止部署操作';

  if (CONFIG.notifyOnDeny) {
    await sendSlackNotification(
      `❌ 部署被拒绝\n` +
      `时间：${new Date().toISOString()}\n` +
      `原因：非工作时间\n` +
      `命令：${input.tool_input.command}`
    );
  }
}

// ─── 输出结果 ─────────────────────────────────────────

if (decision === 'deny') {
  console.error(feedback);
  process.exit(2);
} else if (decision === 'warn') {
  console.error(feedback);
  process.exit(0);
} else {
  process.exit(0);
}

// ─── 记录追踪 ─────────────────────────────────────────

const traceEntry = {
  timestamp: new Date().toISOString(),
  hook: hookType,
  tool: input.tool_name,
  decision,
  feedback,
  input: input.tool_input,
};

const traceDir = '.harness/hooks/logs';
const traceFile = path.join(traceDir, `${new Date().toISOString().split('T')[0]}.jsonl`);

fs.appendFileSync(traceFile, JSON.stringify(traceEntry) + '\n');
EOF
```

### 步骤 3：更新配置使用自定义 Handler

```bash
cat > .harness/hooks/config/hooks-config.json << 'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "shell",
        "command": "node .harness/hooks/custom-handler.mjs pre-tool-use",
        "timeout": 10000,
        "priority": 100
      }
    ]
  }
}
EOF
```

### 步骤 4：设置环境变量

```bash
# 设置 Slack Webhook URL
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# 或添加到 .env 文件
echo "SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL" >> .env
```

### 步骤 5：测试自定义 Handler

在非工作时间尝试部署：

```
请帮我执行部署脚本 npm run deploy
```

**预期结果：**

```
❌ 操作被拒绝

原因：非工作时间禁止部署操作
```

同时，Slack 会收到通知：

```
🔔 Hannah Agent Alert

❌ 部署被拒绝
时间：2026-09-03T20:15:30.000Z
原因：非工作时间
命令：npm run deploy
```

---

## 场景七：意图规则配置

### 背景

你希望基于代理的**意图**（而不是具体工具）来制定规则：

- 禁止所有"删除文件"的意图
- 禁止所有"强制推送"的意图
- 允许所有"读取文件"的意图

### 步骤 1：创建意图规则文件

```bash
mkdir -p .harness/intent-rules

cat > .harness/intent-rules/intent-rules.yaml << 'EOF'
rules:
  # 禁止删除文件
  - name: block-file-delete
    intent: file_delete
    action: deny
    feedback: "禁止删除文件操作"

  # 禁止强制推送
  - name: block-force-push
    intent: git_force_push
    action: deny
    feedback: "禁止 git force push"

  # 禁止硬重置
  - name: block-hard-reset
    intent: git_reset
    action: deny
    feedback: "禁止 git hard reset"

  # 允许读取文件
  - name: allow-file-read
    intent: file_read
    action: allow

  # 警告安装依赖
  - name: warn-dependency-install
    intent: dependency_install
    action: warn
    feedback: "安装依赖前请确认必要性"
EOF
```

### 步骤 2：意图规则的工作原理

意图提取器会自动分析工具调用，提取意图：

| 工具调用                    | 提取的意图                     |
| --------------------------- | ------------------------------ |
| `Write` + `file_path`       | `file_create` 或 `file_modify` |
| `Bash` + `rm`               | `file_delete`                  |
| `Bash` + `git push --force` | `git_force_push`               |
| `Bash` + `git reset --hard` | `git_reset`                    |
| `Read` + `file_path`        | `file_read`                    |
| `Bash` + `npm install`      | `dependency_install`           |

### 步骤 3：测试意图规则

**测试 1：删除文件**

```
请帮我删除 src/old-file.ts
```

**预期结果：**

```
❌ 操作被拒绝

原因：意图规则 - block-file-delete
反馈：禁止删除文件操作
```

**测试 2：安装依赖**

```
请帮我安装 lodash 库
```

**预期结果：**

```
⚠️  警告

原因：意图规则 - warn-dependency-install
反馈：安装依赖前请确认必要性
操作继续执行
```

---

## 场景八：架构层规则配置

### 背景

你的项目有分层架构：

- UI 层（src/ui/, src/components/）
- Core 层（src/core/, src/services/）
- Data 层（src/data/, src/models/）

你希望强制层级依赖规则：

- UI 可以访问 Core，但不能直接访问 Data
- Core 可以访问 Data
- Data 不能访问 Core 或 UI

### 步骤 1：创建架构配置

```bash
cat > .harness/architecture.yaml << 'EOF'
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
      - "src/hooks/**"

  - name: data
    patterns:
      - "src/data/**"
      - "src/models/**"
      - "src/repositories/**"

  - name: utils
    patterns:
      - "src/utils/**"
      - "src/helpers/**"

rules:
  # UI 可以访问 Core
  - from: ui
    to: core
    allowed: true

  # UI 不能直接访问 Data
  - from: ui
    to: data
    allowed: false
    feedback: "UI 层不能直接访问数据层，请通过 Core 层"

  # Core 可以访问 Data
  - from: core
    to: data
    allowed: true

  # Data 不能依赖 Core
  - from: data
    to: core
    allowed: false
    feedback: "数据层不能依赖 Core 层，会造成循环依赖"

  # Data 不能依赖 UI
  - from: data
    to: ui
    allowed: false
    feedback: "数据层不能依赖 UI 层"

  # 所有层都可以访问 Utils
  - from: ui
    to: utils
    allowed: true
  - from: core
    to: utils
    allowed: true
  - from: data
    to: utils
    allowed: true
EOF
```

### 步骤 2：测试架构规则

**测试 1：UI 直接访问 Data（应被拒绝）**

在 UI 组件中尝试：

```typescript
// src/components/UserList.tsx
import { users } from "../data/users"; // ❌ 违反架构规则
```

当 AI 助手尝试创建这样的导入时：

```
请帮我在 UserList 组件中导入用户数据
```

**预期结果：**

```
❌ 操作被拒绝

原因：架构层规则
反馈：UI 层不能直接访问数据层，请通过 Core 层
```

**测试 2：UI 访问 Core（应被允许）**

```typescript
// src/components/UserList.tsx
import { useUsers } from "../hooks/useUsers"; // ✅ 符合架构规则
```

**预期结果：**

```
✅ 操作允许
```

### 步骤 3：查看架构违规

```bash
# 分析架构违规
hannah analyze --days=7
```

**预期输出：**

```
🏗️  架构层违规：

1. UI → Data 直接访问
   文件：src/components/UserList.tsx
   导入：../data/users
   次数：3

2. Data → Core 依赖
   文件：src/models/user.ts
   导入：../services/logger
   次数：1
```

---

## 场景九：生产环境部署

### 背景

你希望将 Hannah 部署到生产环境：

- 作为 CI/CD 的一部分
- 集中监控多个项目
- 持久化存储追踪数据

### 步骤 1：CI/CD 集成（GitHub Actions）

```yaml
# .github/workflows/hannah-check.yml
name: Hannah Agent Governance

on:
  pull_request:
    branches: [main]

jobs:
  governance-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install Hannah
        run: npm install -g hannah

      - name: Initialize Hannah
        run: hannah init --agent=copilot

      - name: Validate Policies
        run: hannah policy validate

      - name: Check Architecture
        run: |
          hannah analyze --days=1
          # 如果有架构违规，失败
          if hannah analyze --days=1 | grep -q "架构层违规"; then
            exit 1
          fi

      - name: Export Report
        run: hannah export --format=json --output=governance-report.json

      - name: Upload Report
        uses: actions/upload-artifact@v3
        with:
          name: governance-report
          path: governance-report.json
```

### 步骤 2：Docker 部署监控服务器

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装 Hannah
RUN npm install -g hannah

# 复制项目
COPY . .

# 初始化 Hannah
RUN hannah init --agent=copilot

# 暴露端口
EXPOSE 4848 4849

# 启动监控服务器
CMD ["hannah", "monitor", "--port=4848"]
```

**docker-compose.yml：**

```yaml
version: "3.8"

services:
  hannah-monitor:
    build: .
    ports:
      - "4848:4848"
      - "4849:4849"
    volumes:
      - ./traces:/app/.harness/traces
      - ./logs:/app/.harness/hooks/logs
    environment:
      - NODE_ENV=production
    restart: unless-stopped

  hannah-web:
    build: .
    ports:
      - "4849:4849"
    command: hannah web --port=4849
    restart: unless-stopped
```

**部署：**

```bash
docker-compose up -d
```

### 步骤 3：集中监控多个项目

**项目结构：**

```
/projects
  /project-a
    .harness/
  /project-b
    .harness/
  /project-c
    .harness/
```

**统一监控脚本：**

```bash
#!/bin/bash
# monitor-all.sh

for project in /projects/*/; do
  echo "Monitoring $project..."
  cd "$project"

  # 启动监控（后台运行）
  hannah monitor --port=$((4848 + RANDOM % 100)) &

  cd -
done

echo "All projects monitoring started"
```

### 步骤 4：日志持久化

**配置日志轮转：**

```yaml
# .harness/config.yaml
trace:
  enabled: true
  dir: .harness/traces
  rotation:
    enabled: true
    maxSize: 10MB
    maxFiles: 10
    compress: true
```

**使用 logrotate（Linux）：**

```bash
# /etc/logrotate.d/hannah
/var/log/hannah/*.jsonl {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
```

---

## 场景十：故障排查实战

### 问题 1：Hook 不触发

**症状：** 配置了 Hannah，但 AI 代理的操作没有被拦截

**排查步骤：**

```bash
# 1. 检查配置文件是否存在
ls -la .harness/hooks/config/hooks-config.json
ls -la .github/hooks/hooks.json  # Copilot

# 2. 检查配置文件格式
cat .github/hooks/hooks.json | jq .

# 3. 检查 Handler 脚本是否可执行
ls -la .harness/hooks/handler.mjs
chmod +x .harness/hooks/handler.mjs

# 4. 手动测试 Handler
echo '{"tool_name":"Write","tool_input":{"file_path":"test.ts"}}' | \
  node .harness/hooks/handler.mjs pre-tool-use
echo $?  # 应该返回 0（允许）或 2（拒绝）

# 5. 查看 Handler 日志
tail -f .harness/hooks/logs/*.jsonl

# 6. 检查代理是否正确配置
cat .claude/settings.json  # Claude Code
cat .github/hooks/hooks.json  # Copilot
```

**常见原因：**

1. **配置文件路径错误**
   - Copilot: `.github/hooks/hooks.json`（不是 `.github/hooks.json`）
   - Claude Code: `.claude/settings.json`

2. **Handler 脚本没有执行权限**

   ```bash
   chmod +x .harness/hooks/handler.mjs
   ```

3. **Node.js 路径问题**
   ```bash
   # 使用绝对路径
   "command": "/usr/bin/node .harness/hooks/handler.mjs pre-tool-use"
   ```

### 问题 2：策略不生效

**症状：** 配置了策略，但没有拦截操作

**排查步骤：**

```bash
# 1. 验证策略文件
hannah policy validate

# 2. 检查策略是否加载
hannah policy list

# 3. 查看追踪，确认事件名称
hannah trace --json | jq '.event'

# 4. 检查字段路径
hannah trace --json | head -1 | jq .

# 5. 测试策略
hannah policy check src/index.ts
```

**常见原因：**

1. **事件名称错误**
   - 错误：`when: tool.before_use`
   - 正确：`when: tool.before`

2. **字段路径错误**
   - 错误：`field: file`
   - 正确：`field: filePath` 或 `field: input.file_path`

3. **Glob 模式错误**
   - 错误：`pattern: "*.env"`（只匹配当前目录）
   - 正确：`pattern: "**/*.env"`（匹配所有子目录）

### 问题 3：追踪日志为空

**症状：** 没有生成追踪日志

**排查步骤：**

```bash
# 1. 检查追踪配置
cat .harness/config.yaml | grep -A 5 trace

# 2. 检查目录权限
ls -la .harness/traces/

# 3. 手动触发事件
# 使用 AI 代理执行一些操作，然后查看追踪
hannah trace

# 4. 检查日志文件
ls -la .harness/hooks/logs/

# 5. 检查磁盘空间
df -h
```

### 问题 4：WebUI 无法访问

**症状：** 无法访问 WebUI 仪表板

**排查步骤：**

```bash
# 1. 检查服务器是否运行
netstat -ano | findstr :4849  # Windows
lsof -i :4849  # Linux/Mac

# 2. 重启服务器
hannah web --port=4849

# 3. 检查防火墙
# Windows
netsh advfirewall firewall show rule name=all | findstr 4849

# Linux
sudo ufw status

# 4. 查看服务器日志
# 查看终端输出
```

### 问题 5：文件监视器不工作

**症状：** `hannah watch` 没有保护文件

**排查步骤：**

```bash
# 1. 检查监视器配置
cat .harness/config.yaml | grep -A 5 watcher

# 2. 手动启动监视器
hannah watch

# 3. 测试保护
echo "test" >> agent.md
cat agent.md  # 检查是否被恢复

# 4. 查看监视器日志
# 查看终端输出
```

---

## 总结

通过以上 10 个实战场景，你已经掌握了：

1. ✅ **从零配置 Copilot 项目** — 完整的初始化、配置、测试流程
2. ✅ **配置 Claude Code 项目** — 数据库保护、密钥检测
3. ✅ **自定义策略开发** — 创建、验证、测试自定义策略
4. ✅ **监控与优化** — 模式分析、异常检测、策略优化
5. ✅ **多代理团队协作** — 统一管理多个 AI 代理
6. ✅ **Hook Handler 自定义** — 编写自定义逻辑、集成通知系统
7. ✅ **意图规则配置** — 基于意图的规则制定
8. ✅ **架构层规则** — 强制层级依赖规则
9. ✅ **生产环境部署** — CI/CD 集成、Docker 部署、日志持久化
10. ✅ **故障排查** — 常见问题的诊断和解决

现在你可以根据实际需求，灵活运用 Hannah Agent Runtime 来治理你的 AI 代理！

---

**文档版本：** 1.0  
**最后更新：** 2026-09-03  
**维护者：** Hannah Team
