/**
 * Semantic Rule Engine — 多维度正则匹配触发方案
 *
 * 核心思路：
 *   语义 hook 没有特定的触发点（不像 PreToolUse 是 agent 原生事件），
 *   而是从 agent 的每一次操作中"嗅探"是否违反了项目规则。
 *
 *   匹配维度：
 *   ┌──────────────┬──────────────────────────────────────────────┐
 *   │ 维度          │ 匹配目标                                      │
 *   ├──────────────┼──────────────────────────────────────────────┤
 *   │ tool_name    │ 工具名称（Write, Bash, mcp__*...）             │
 *   │ file_path    │ 文件路径（.env, src/core/*, prod.yaml...）     │
 *   │ content      │ 写入内容（DROP TABLE, password=..., eval()）   │
 *   │ command      │ Shell 命令（git push --force, rm -rf...）      │
 *   │ mcp_server   │ MCP 服务名（database, filesystem...）          │
 *   │ mcp_op       │ MCP 操作名（write, delete, drop...）           │
 *   │ file_type    │ 文件类型（ts, py, go, sql, yaml...）           │
 *   │ section      │ agent.md 中的规则所属章节                       │
 *   └──────────────┴──────────────────────────────────────────────┘
 */

import type { SemanticContext, SemanticMatch, SemanticDecision } from './types.js';

// ─── 规则定义 ─────────────────────────────────────────────────────

export interface SemanticRule {
  /** 规则名 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 来源文件 */
  source: string;
  /** 来源行号 */
  line?: number;

  /** 触发条件：至少一个维度匹配才触发 */
  match: RuleMatch;

  /** 动作 */
  action: 'deny' | 'warn' | 'modify';
  /** 反馈消息 */
  feedback: string;
  /** 建议 */
  suggestions?: string[];
  /** 修改后的输入（当 action 为 modify 时使用） */
  modifiedInput?: Record<string, unknown>;
}

/**
 * 匹配条件 — 所有字段都是正则或 glob 字符串数组。
 * 同一维度内多个 pattern 是 OR 关系；
 * 不同维度之间是 AND 关系（至少提供一个维度）。
 */
export interface RuleMatch {
  /** 匹配工具名 */
  tool_name?: string[];
  /** 匹配文件路径 */
  file_path?: string[];
  /** 匹配写入内容 */
  content?: string[];
  /** 匹配 shell 命令（从 Bash/terminal 工具的 input.command 提取） */
  command?: string[];
  /** 匹配 MCP 服务器名 */
  mcp_server?: string[];
  /** 匹配 MCP 操作名 */
  mcp_operation?: string[];
  /** 匹配文件类型/扩展名 */
  file_type?: string[];
}

// ─── 上下文提取器 ─────────────────────────────────────────────────

/**
 * 从 SemanticContext 中提取各维度的匹配值
 */
export function extractDimensions(ctx: SemanticContext): DimensionValues {
  const result: DimensionValues = {
    tool_name: '',
    file_path: '',
    content: '',
    command: '',
    mcp_server: '',
    mcp_operation: '',
    file_type: '',
  };

  const event = ctx.event as any;
  const payload = event.payload || {};

  // tool_name
  result.tool_name = payload.toolName || '';

  // file_path — 从 code context 或 tool input 中提取
  if (ctx.code?.filePath) {
    result.file_path = ctx.code.filePath;
    result.file_type = ctx.code.fileType || '';
  } else if (payload.input?.file_path) {
    result.file_path = payload.input.file_path;
    const ext = payload.input.file_path.split('.').pop() || '';
    result.file_type = ext;
  } else if (payload.input?.path) {
    result.file_path = payload.input.path;
  }

  // content — 写入内容
  if (ctx.code?.content) {
    result.content = ctx.code.content;
  } else if (payload.input?.content) {
    result.content = String(payload.input.content);
  }

  // command — 从 Bash/terminal/shell 工具中提取
  if (payload.input?.command) {
    result.command = String(payload.input.command);
  }

  // MCP — 从 mcp__server__operation 格式中提取
  const tn = result.tool_name;
  if (tn.startsWith('mcp__')) {
    const parts = tn.split('__');
    if (parts.length >= 3) {
      result.mcp_server = parts[1];
      result.mcp_operation = parts.slice(2).join('__');
    }
  } else if (tn.startsWith('mcp_')) {
    const parts = tn.split('_');
    if (parts.length >= 3) {
      result.mcp_server = parts[1];
      result.mcp_operation = parts.slice(2).join('_');
    }
  }

  return result;
}

interface DimensionValues {
  tool_name: string;
  file_path: string;
  content: string;
  command: string;
  mcp_server: string;
  mcp_operation: string;
  file_type: string;
}

// ─── 匹配引擎 ─────────────────────────────────────────────────────

/**
 * 将 glob 字符串转为正则
 */
function globToRegex(glob: string): RegExp {
  let regexStr = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          regexStr += '(.*/)?';
          i += 2;
        } else {
          regexStr += '.*';
          i++;
        }
      } else {
        regexStr += '[^/]*';
      }
    } else if (c === '?') {
      regexStr += '.';
    } else if ('.+^${}()|[]\\'.indexOf(c) >= 0) {
      regexStr += '\\' + c;
    } else {
      regexStr += c;
    }
  }
  return new RegExp(regexStr, 'i');
}

/**
 * 检查单个维度是否匹配
 */
function matchDimension(patterns: string[], value: string): boolean {
  if (!value) return false;
  return patterns.some(p => {
    // 如果包含通配符，用 glob 匹配
    if (p.includes('*') || p.includes('?')) {
      return globToRegex(p).test(value);
    }
    // 否则用包含匹配（大小写不敏感）
    return value.toLowerCase().includes(p.toLowerCase());
  });
}

/**
 * 评估一条规则是否匹配当前上下文。
 *
 * 匹配逻辑：
 *   1. 不同维度之间是 AND — 所有提供的维度都必须匹配
 *   2. 同一维度内多个 pattern 是 OR — 任一 pattern 匹配即可
 *   3. 至少要提供一个维度
 */
export function evaluateRule(rule: SemanticRule, ctx: SemanticContext): SemanticMatch | null {
  const dims = extractDimensions(ctx);
  const match = rule.match;
  const evidence: string[] = [];
  let matchedDimensions = 0;
  let totalDimensions = 0;

  // 逐维度检查
  if (match.tool_name) {
    totalDimensions++;
    if (matchDimension(match.tool_name, dims.tool_name)) {
      matchedDimensions++;
      evidence.push(`tool_name "${dims.tool_name}" matches [${match.tool_name.join(', ')}]`);
    }
  }

  if (match.file_path) {
    totalDimensions++;
    if (matchDimension(match.file_path, dims.file_path)) {
      matchedDimensions++;
      evidence.push(`file_path "${dims.file_path}" matches [${match.file_path.join(', ')}]`);
    }
  }

  if (match.content) {
    totalDimensions++;
    if (matchDimension(match.content, dims.content)) {
      matchedDimensions++;
      evidence.push(`content matches [${match.content.join(', ')}]`);
    }
  }

  if (match.command) {
    totalDimensions++;
    if (matchDimension(match.command, dims.command)) {
      matchedDimensions++;
      evidence.push(`command "${dims.command}" matches [${match.command.join(', ')}]`);
    }
  }

  if (match.mcp_server) {
    totalDimensions++;
    if (matchDimension(match.mcp_server, dims.mcp_server)) {
      matchedDimensions++;
      evidence.push(`mcp_server "${dims.mcp_server}" matches [${match.mcp_server.join(', ')}]`);
    }
  }

  if (match.mcp_operation) {
    totalDimensions++;
    if (matchDimension(match.mcp_operation, dims.mcp_operation)) {
      matchedDimensions++;
      evidence.push(`mcp_operation "${dims.mcp_operation}" matches [${match.mcp_operation.join(', ')}]`);
    }
  }

  if (match.file_type) {
    totalDimensions++;
    if (matchDimension(match.file_type, dims.file_type)) {
      matchedDimensions++;
      evidence.push(`file_type "${dims.file_type}" matches [${match.file_type.join(', ')}]`);
    }
  }

  // 至少要有一个维度，且所有提供的维度都必须匹配
  if (totalDimensions === 0 || matchedDimensions < totalDimensions) {
    return null;
  }

  return {
    hookName: rule.name,
    confidence: totalDimensions > 1 ? 0.95 : 0.8,
    rule: rule.description,
    evidence,
    metadata: {
      source: rule.source,
      line: rule.line,
      action: rule.action,
      dimensions: matchedDimensions,
    },
  };
}

// ─── 内置规则库 ─────────────────────────────────────────────────────

/**
 * 内置语义规则 — 不依赖 agent.md，始终生效
 */
export const BUILT_IN_RULES: SemanticRule[] = [
  // ── 红线保护：agent 不能修改自己的指令文件 ──
  {
    name: 'redline-agent-files',
    description: 'Agent instruction files are read-only for AI agents',
    source: 'built-in',
    match: {
      file_path: [
        '**/agent.md', '**/AGENT.md', '**/.agent.md',
        '**/agents.md', '**/AGENTS.md', '**/.agents.md',
        '**/CLAUDE.md', '**/COPILOT.md',
        '**/.cursorrules', '**/.cursor/rules.md',
      ],
    },
    action: 'deny',
    feedback: 'You cannot modify agent instruction files. These files define your behavior and must only be changed by the human user.',
    suggestions: ['Continue without modifying instruction files'],
  },
  {
    name: 'redline-harness-config',
    description: 'Harness configuration is read-only for AI agents',
    source: 'built-in',
    match: {
      file_path: ['**/.harness/**'],
    },
    action: 'deny',
    feedback: 'You cannot modify .harness/ configuration. This directory contains the runtime guard policies and hooks.',
    suggestions: ['Continue without modifying .harness/ files'],
  },

  // ── 环境文件保护 ──
  {
    name: 'env-protection',
    description: 'Environment files contain secrets and must not be modified by agents',
    source: 'built-in',
    match: {
      file_path: ['**/.env', '**/.env.*', '**/*.env'],
    },
    action: 'deny',
    feedback: 'Environment files are protected. They may contain secrets and must be edited manually by the human user.',
  },

  // ── Lock 文件保护 ──
  {
    name: 'lock-file-protection',
    description: 'Lock files must not be modified directly',
    source: 'built-in',
    match: {
      file_path: [
        '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
        '**/poetry.lock', '**/Pipfile.lock', '**/Gemfile.lock',
        '**/Cargo.lock', '**/go.sum',
      ],
    },
    action: 'deny',
    feedback: 'Lock files are auto-generated. Use the package manager (npm install, pnpm add, etc.) instead of editing directly.',
  },

  // ── 生产配置保护 ──
  {
    name: 'production-config-protection',
    description: 'Production configuration must not be modified directly',
    source: 'built-in',
    match: {
      file_path: [
        '**/production.yaml', '**/production.yml', '**/production.json',
        '**/production.env', '**/prod.yaml', '**/prod.yml',
        '**/prod.json', '**/prod.env',
        '**/production/**', '**/prod/**',
      ],
    },
    action: 'deny',
    feedback: 'Production configuration must be changed through the deployment pipeline, not directly.',
    suggestions: [
      'Modify staging/dev configuration first',
      'Use CI/CD pipeline for production deployment',
    ],
  },

  // ── 危险 Shell 命令 ──
  {
    name: 'dangerous-shell-rm',
    description: 'Dangerous rm commands are blocked',
    source: 'built-in',
    match: {
      command: ['rm -rf /', 'rm -rf ~', 'rm -rf .', 'rm -rf *'],
    },
    action: 'modify',
    feedback: 'Destructive rm commands are blocked. This could destroy the entire filesystem or project.',
    modifiedInput: { command: 'echo "Blocked: dangerous rm command"' },
    suggestions: [
      'Use specific file paths instead of wildcards',
      'Use `rm -i` for interactive deletion',
    ],
  },
  {
    name: 'dangerous-shell-git-force',
    description: 'Git force push is blocked',
    source: 'built-in',
    match: {
      command: ['git push --force', 'git push -f'],
    },
    action: 'modify',
    feedback: 'Force push is not allowed. Use regular push or push with lease.',
    modifiedInput: { command: 'git push --force-with-lease' },
    suggestions: ['Use `git push --force-with-lease` instead'],
  },

  // ── 危险数据库操作 ──
  {
    name: 'dangerous-db-drop',
    description: 'DROP TABLE/DATABASE is blocked',
    source: 'built-in',
    match: {
      content: ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE'],
    },
    action: 'modify',
    feedback: 'Destructive database operations (DROP/TRUNCATE) are blocked.',
    modifiedInput: { content: '-- Blocked: Use ALTER TABLE or conditional DELETE instead' },
    suggestions: ['Use ALTER TABLE instead', 'Add conditional checks before DELETE'],
  },

  // ── 密钥检测 ──
  {
    name: 'secret-hardcoded-password',
    description: 'Hardcoded passwords detected',
    source: 'built-in',
    match: {
      content: [
        'password = "', "password = '",
        'passwd = "', "passwd = '",
        'pwd = "', "pwd = '",
      ],
    },
    action: 'deny',
    feedback: 'Hardcoded passwords detected. Use environment variables or a secrets manager.',
    suggestions: ['Use process.env.PASSWORD', 'Use a secrets manager (Vault, AWS Secrets Manager)'],
  },
  {
    name: 'secret-hardcoded-api-key',
    description: 'Hardcoded API keys detected',
    source: 'built-in',
    match: {
      content: [
        'api_key = "', "api_key = '",
        'apiKey = "', "apiKey = '",
        'API_KEY = "', "API_KEY = '",
        'apikey = "', "apikey = '",
      ],
    },
    action: 'deny',
    feedback: 'Hardcoded API keys detected. Use environment variables or a secrets manager.',
  },
  {
    name: 'secret-private-key',
    description: 'Private key embedded in code',
    source: 'built-in',
    match: {
      content: ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN EC PRIVATE KEY-----', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    },
    action: 'deny',
    feedback: 'Private keys must not be embedded in source code. Use a secrets manager or SSH agent.',
  },

  // ── MCP 安全 ──
  {
    name: 'mcp-database-write',
    description: 'Direct database write via MCP is blocked',
    source: 'built-in',
    match: {
      mcp_server: ['database', 'db', 'sql', 'postgres', 'mysql', 'mongodb'],
      mcp_operation: ['write', 'delete', 'drop', 'truncate', 'alter', 'update', 'insert', 'execute'],
    },
    action: 'deny',
    feedback: 'Direct database write operations via MCP are not allowed. Use the application API layer.',
  },

  // ── 前端安全 ──
  {
    name: 'react-xss-dangerouslySetInnerHTML',
    description: 'dangerouslySetInnerHTML can lead to XSS',
    source: 'built-in',
    match: {
      file_type: ['tsx', 'jsx', 'ts', 'js'],
      content: ['dangerouslySetInnerHTML'],
    },
    action: 'warn',
    feedback: 'Using dangerouslySetInnerHTML can lead to XSS vulnerabilities. Ensure content is sanitized.',
    suggestions: ['Use DOMPurify to sanitize HTML', 'Use textContent instead when possible'],
  },
  {
    name: 'vue-xss-v-html',
    description: 'v-html can lead to XSS',
    source: 'built-in',
    match: {
      file_type: ['vue'],
      content: ['v-html'],
    },
    action: 'warn',
    feedback: 'Using v-html can lead to XSS vulnerabilities. Use text interpolation when possible.',
  },
  {
    name: 'eval-injection',
    description: 'eval() is a security risk',
    source: 'built-in',
    match: {
      file_type: ['ts', 'js', 'tsx', 'jsx', 'py', 'rb'],
      content: ['eval(', 'new Function('],
    },
    action: 'warn',
    feedback: 'eval() and new Function() can lead to code injection. Consider safer alternatives.',
  },

  // ── 核心模块保护 ──
  {
    name: 'core-module-protection',
    description: 'Core module files require human review',
    source: 'built-in',
    match: {
      file_path: ['**/src/core/**', '**/src/kernel/**', '**/src/runtime/**'],
    },
    action: 'warn',
    feedback: 'You are modifying core module files. These changes may affect the entire system and require human review.',
  },
];

// ─── 规则引擎 ─────────────────────────────────────────────────────

export class SemanticRuleEngine {
  private rules: SemanticRule[] = [];

  constructor() {
    // 加载内置规则
    this.rules = [...BUILT_IN_RULES];
  }

  /** 添加自定义规则 */
  addRule(rule: SemanticRule): void {
    this.rules.push(rule);
  }

  /** 批量添加规则 */
  addRules(rules: SemanticRule[]): void {
    this.rules.push(...rules);
  }

  /** 移除规则 */
  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  /** 获取所有规则 */
  getRules(): SemanticRule[] {
    return [...this.rules];
  }

  /**
   * 评估所有规则，返回匹配结果列表
   */
  evaluate(ctx: SemanticContext): SemanticMatch[] {
    const matches: SemanticMatch[] = [];

    for (const rule of this.rules) {
      const match = evaluateRule(rule, ctx);
      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }

  /**
   * 评估并返回最严格的决策
   */
  resolve(ctx: SemanticContext): SemanticDecision | null {
    const matches = this.evaluate(ctx);
    if (matches.length === 0) return null;

    // 找到最严格的匹配
    const priority: Record<string, number> = { deny: 0, modify: 1, warn: 2 };
    let best: SemanticMatch | null = null;
    let bestPriority = Infinity;

    for (const match of matches) {
      const action = match.metadata?.action || 'warn';
      const p = priority[action] ?? 3;
      if (p < bestPriority) {
        best = match;
        bestPriority = p;
      }
    }

    if (!best) return null;

    // 找到对应的规则
    const rule = this.rules.find(r => r.name === best!.hookName);

    const decision: SemanticDecision = {
      action: best.metadata?.action || 'warn',
      reason: best.rule,
      feedback: rule?.feedback || best.rule,
      suggestions: rule?.suggestions,
    };

    // 如果是 modify 动作，添加 modifiedInput
    if (decision.action === 'modify' && rule?.modifiedInput) {
      decision.modifiedInput = rule.modifiedInput;
    }

    return decision;
  }
}
