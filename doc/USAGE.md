# Hannah Agent Runtime - Usage Guide

> Complete guide to using Hannah Agent Runtime for multi-agent hook alignment and semantic-level control.

---

## Quick Start

### Installation

```bash
npm install -g hannah-agent-runtime
```

### Initialize Project

```bash
cd your-project
hannah init
```

This will:
1. Create `.harness/` directory with policies and hooks
2. Detect your project's tech stack
3. Scan for agent instruction files (agent.md, CLAUDE.md, etc.)
4. Generate semantic hooks based on your project rules
5. Generate agent-specific configuration

### Select Agent

During initialization, you'll be prompted to select your AI agent:

```
? Select your AI coding agent:
  ❯ Claude Code - Anthropic Claude Code CLI
    GitHub Copilot - GitHub Copilot coding agent
    Qoder - Qoder AI coding assistant
    Codex CLI - OpenAI Codex CLI
    Trae - Trae AI coding assistant
```

Or specify directly:

```bash
hannah init --agent=copilot
```

---

## Core Commands

### `hannah init [dir] [options]`

Initialize Hannah in your project.

**Options:**
- `--agent=<name>` - Select agent directly (claude-code, copilot, qoder, codex, trae)

**What it does:**
1. Creates `.harness/` directory structure
2. Generates default policies (protected files, MCP safety, git safety)
3. Detects tech stack and generates semantic hooks
4. Scans agent.md and extracts rules
5. Generates agent-specific hook configuration

**Example:**
```bash
hannah init
hannah init --agent=copilot
hannah init ./my-project --agent=claude-code
```

### `hannah sync [dir]`

Synchronize semantic hooks with project rules.

**What it does:**
1. Re-scans agent.md for rule changes
2. Re-detects tech stack
3. Updates semantic hooks
4. Saves hook metadata

**When to use:**
- After modifying agent.md
- After changing project dependencies
- Periodically to keep hooks up-to-date

**Example:**
```bash
hannah sync
```

### `hannah trace [options]`

View agent runtime traces.

**Options:**
- `--all` - Show all entries (default: last 50)
- `--follow` - Follow traces in real-time
- `--json` - Output raw JSON
- `--denied` - Only show denied events

**Example:**
```bash
hannah trace
hannah trace --follow
hannah trace --denied
```

### `hannah summary [options]`

Show aggregate statistics.

**Options:**
- `--today` - Summary of today only
- `--days N` - Summary of last N days

**Example:**
```bash
hannah summary
hannah summary --today
```

---

## Semantic Hook System

### What are Semantic Hooks?

Semantic hooks are **project-level rules** that go beyond simple event matching. They understand:
- **Context**: What file is being modified? What's the project structure?
- **Intent**: What is the agent trying to do?
- **Semantics**: What does this operation mean in your project?

### How Semantic Hooks Work

1. **Tech Stack Detection**
   - Analyzes package.json and project structure
   - Detects frameworks (React, Vue, Next.js, etc.)
   - Detects databases (Prisma, MongoDB, etc.)
   - Generates preset hooks based on tech stack

2. **Agent.md Scanning**
   - Scans agent.md, CLAUDE.md, .cursorrules, etc.
   - Extracts red-line rules and constraints
   - Converts natural language rules to semantic hooks

3. **Hook Generation**
   - Creates semantic hooks from rules
   - Saves hook metadata to `.harness/semantic-hooks/`
   - Hooks are automatically applied during agent execution

### Supported Agent Instruction Files

Hannah scans for these files:
- `agent.md` / `AGENT.md`
- `.agent.md`
- `CLAUDE.md` / `.claude/CLAUDE.md`
- `COPILOT.md` / `.github/COPILOT.md`
- `.cursorrules`
- `.cursor/rules.md`

### Example: Agent.md Rules

```markdown
# Project Rules

## Security
- Don't commit .env files or secrets
- Never use eval() or innerHTML with user input
- Always validate API responses

## Database
- Don't drop tables or delete all records
- Always backup before migration

## Architecture
- Don't modify production configuration directly
- Use staging environment for testing
```

Hannah will automatically extract these rules and create semantic hooks.

### Built-in Semantic Hooks

Based on tech stack detection:

| Hook | Description | Tech Stack |
|------|-------------|------------|
| `database-protection` | Prevent dangerous DB operations | Any with database |
| `react-security` | Prevent insecure React patterns | React, Next.js |
| `vue-security` | Prevent insecure Vue patterns | Vue |
| `environment-protection` | Protect .env files | All |
| `secret-detection` | Detect hardcoded secrets | All |
| `production-protection` | Protect production configs | All |

---

## Project Structure

After initialization:

```
your-project/
├── .harness/
│   ├── config.yaml              # Hannah configuration
│   ├── policies/                # Declarative policies
│   │   ├── protected-files.yaml
│   │   ├── mcp-safety.yaml
│   │   └── git-safety.yaml
│   ├── hooks/
│   │   └── handler.mjs          # Unified hook handler
│   ├── traces/                  # Runtime traces (JSONL)
│   ├── semantic-hooks/          # Semantic hook metadata
│   │   └── hooks.json
│   └── README.md                # Setup guide
├── .claude/
│   └── settings.json            # Claude Code config (if selected)
├── .github/
│   └── copilot-instructions.md  # Copilot config (if selected)
└── agent.md                     # Your project rules (optional)
```

---

## Configuration

### config.yaml

```yaml
project: my-project

# Agent adapter
adapters:
  - copilot

# Trace configuration
trace:
  enabled: true
  dir: .harness/traces

# Policy directories
policies:
  - policies
```

### Custom Policies

Create custom policies in `.harness/policies/`:

```yaml
name: custom-policy
rules:
  - name: block-specific-pattern
    when: tool.before
    match:
      - field: toolName
        pattern: "Bash"
      - field: input.command
        pattern: "*dangerous-command*"
    action: deny
    feedback: "This command is not allowed"
```

---

## Advanced Usage

### Real-time Monitoring

```bash
# Terminal 1: Run agent
copilot chat

# Terminal 2: Follow traces
hannah trace --follow
```

### Debug Mode

Enable debug logging:

```bash
HANNAH_DEBUG=true node .harness/hooks/handler.mjs pre-tool-use
```

### Log to File

```bash
HANNAH_LOG_FILE=.harness/logs/hannah.log copilot chat
```

---

## Workflow

### Typical Development Flow

1. **Initialize**
   ```bash
   hannah init --agent=copilot
   ```

2. **Define Rules** (optional)
   Create `agent.md` with your project rules

3. **Sync Hooks**
   ```bash
   hannah sync
   ```

4. **Develop with Agent**
   Use your AI agent as normal

5. **Monitor**
   ```bash
   hannah trace --follow
   ```

6. **Review**
   ```bash
   hannah summary
   ```

### Team Workflow

1. Commit `.harness/` to version control
2. Team members run `hannah init` on clone
3. Define shared rules in `agent.md`
4. Sync hooks after rule changes: `hannah sync`

---

## 安全机制

### 红线规则保护

Hannah 包含一个关键的安全机制：**红线规则文件保护**。

#### 保护的文件

以下文件受到严格保护，AI Agent **无法修改**：

1. **Agent 指令文件**
   - `agent.md` / `AGENT.md` / `.agent.md`
   - `CLAUDE.md`
   - `COPILOT.md`
   - `.cursorrules`
   - `.cursor/rules.md`

2. **Hannah 配置文件**
   - `.harness/config.yaml`
   - `.harness/policies/*`
   - `.harness/hooks/*`
   - `.harness/semantic-hooks/*`

#### 为什么需要保护？

如果没有这个保护，AI Agent 可以：
1. 读取 agent.md 中的规则
2. 修改规则（例如将"禁止删除文件"改为"允许删除文件"）
3. 绕过所有安全限制

这相当于"自我解除武装"，是一个严重的安全漏洞。

#### 保护机制如何工作？

```
Agent 尝试修改 agent.md
    ↓
redline-protection hook 检测到
    ↓
立即拒绝 (deny)
    ↓
返回反馈："你不能修改 agent.md，只有人类用户可以修改"
```

#### 测试保护机制

```bash
# 运行测试脚本
node test-redline-protection.js
```

预期输出：
```
Test 1: Attempting to modify agent.md
✓ Decision: deny
  Reason: Redline file modification blocked

Test 2: Attempting to modify .harness/config.yaml
✓ Decision: deny
  Reason: Redline file modification blocked
```

#### 如何修改红线规则？

只有**人类用户**可以修改这些文件：

```bash
# 人类用户手动编辑
vim agent.md

# 然后同步语义 Hook
hannah sync
```

AI Agent 无法绕过这个保护机制。

---

## Troubleshooting

### Hooks Not Triggering

1. Check agent configuration:
   ```bash
   cat .claude/settings.json  # or .github/copilot-instructions.md
   ```

2. Verify hook command:
   ```bash
   node .harness/hooks/handler.mjs pre-tool-use
   ```

3. Check traces:
   ```bash
   hannah trace --all
   ```

### Semantic Hooks Not Working

1. Run sync:
   ```bash
   hannah sync
   ```

2. Check hook metadata:
   ```bash
   cat .harness/semantic-hooks/hooks.json
   ```

3. Verify agent.md exists and has rules

### Permission Errors

Ensure Node.js can execute the handler:

```bash
chmod +x .harness/hooks/handler.mjs
```

---

## API Reference

### Programmatic Usage

```typescript
import {
  AgentRuntime,
  ClaudeCodeAdapter,
  createSemanticEngine,
} from 'hannah-agent-runtime';

// Create runtime
const runtime = new AgentRuntime({ debug: false });

// Register adapter
const adapter = new ClaudeCodeAdapter();
adapter.attachRuntime(runtime);

// Create semantic engine
const engine = await createSemanticEngine(process.cwd());

// Process event
const result = await adapter.handlePreToolUse(input);
```

---

## Next Steps

- [Architecture Design](./architecture/ARCHITECTURE-v2.md) - Detailed architecture
- [Hook Adaptation Table](../guidelines/hook-adaptation-table.md) - Event mappings
- [PPT Summary](./architecture/PPT-SUMMARY.md) - Presentation outline

---

**Version**: 0.2.3  
**Last Updated**: 2026-08-26
