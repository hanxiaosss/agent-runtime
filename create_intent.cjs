const fs = require('fs');
const content = /**
 * Intent Extractor
 */

import type { CodexHookInput } from '../hooks/codex-handler.js';

export interface Intent {
  type: IntentType;
  rawAction: string;
  confidence: number;
  evidence: string[];
}

export type IntentType =
  | 'force_push'
  | 'destructive_reset'
  | 'env_modification'
  | 'lock_file_modification'
  | 'database_write'
  | 'file_deletion'
  | 'secret_exposure'
  | 'dependency_change'
  | 'config_change'
  | 'unknown';

export interface IntentRule {
  name: string;
  intent: IntentType;
  minConfidence: number;
  action: 'allow' | 'deny' | 'warn';
  feedback: string;
  suggestions?: string[];
}

export function extractIntent(input: CodexHookInput): Intent {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');
  const filePath = String(toolInput.file_path || toolInput.path || '');
  const content = String(toolInput.content || toolInput.text || '');

  if (toolName === 'Bash' || toolName === 'terminal' || toolName === 'shell') {
    if (isForcePush(command)) {
      return { type: 'force_push', rawAction: command, confidence: 0.95, evidence: ['命令包含 --force 或 -f 标志'] };
    }
    if (isDestructiveReset(command)) {
      return { type: 'destructive_reset', rawAction: command, confidence: 0.95, evidence: ['使用 --hard 标志'] };
    }
  }

  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'ApplyPatch') {
    if (isEnvFile(filePath)) {
      return { type: 'env_modification', rawAction: '修改 ' + filePath, confidence: 0.9, evidence: ['目标文件是环境变量文件'] };
    }
    if (isLockFile(filePath)) {
      return { type: 'lock_file_modification', rawAction: '修改 ' + filePath, confidence: 0.9, evidence: ['目标文件是包管理器锁文件'] };
    }
    if (containsSecrets(content)) {
      return { type: 'secret_exposure', rawAction: '写入内容到 ' + filePath, confidence: 0.85, evidence: ['内容包含敏感信息'] };
    }
  }

  if (toolName === 'Bash' || toolName === 'terminal') {
    if (isFileDeletion(command)) {
      return { type: 'file_deletion', rawAction: command, confidence: 0.9, evidence: ['检测到文件删除操作'] };
    }
  }

  if (toolName.startsWith('mcp__') || toolName.startsWith('mcp_')) {
    const parts = toolName.split(/__|_/);
    if (parts.length >= 3) {
      const server = parts[1];
      const operation = parts.slice(2).join('_');
      if (server === 'database' && isWriteOperation(operation)) {
        return { type: 'database_write', rawAction: toolName, confidence: 0.9, evidence: ['数据库 ' + operation + ' 操作'] };
      }
    }
  }

  return { type: 'unknown', rawAction: toolName + ': ' + (command || filePath), confidence: 0.5, evidence: [] };
}

function isForcePush(command: string): boolean {
  return /push\s+--force/.test(command) || /push\s+-f\b/.test(command);
}

function isDestructiveReset(command: string): boolean {
  return /reset\s+--hard/.test(command);
}

function isEnvFile(filePath: string): boolean {
  return /\.env(\..+)?$/.test(filePath) || filePath.endsWith('.env');
}

function isLockFile(filePath: string): boolean {
  const lockFiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];
  return lockFiles.some(f => filePath.endsWith(f));
}

function containsSecrets(content: string): boolean {
  const patterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"]\w+['"]/i,
    /(?:password|passwd|pwd)\s*[:=]\s*['"]\w+['"]/i,
    /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/,
  ];
  return patterns.some(p => p.test(content));
}

function isFileDeletion(command: string): boolean {
  return /rm\s+-[rf]/.test(command) || /Remove-Item\s+/i.test(command);
}

function isWriteOperation(operation: string): boolean {
  return ['write', 'insert', 'update', 'delete', 'drop', 'truncate'].includes(operation.toLowerCase());
}

export function loadIntentRules(harnessDir: string): IntentRule[] {
  return [
    { name: 'block-force-push', intent: 'force_push', minConfidence: 0.9, action: 'deny', feedback: '[GIT-001] 禁止强制推送', suggestions: ['使用 git push --force-with-lease'] },
    { name: 'block-destructive-reset', intent: 'destructive_reset', minConfidence: 0.9, action: 'deny', feedback: '[GIT-002] 禁止 git reset --hard', suggestions: ['使用 git stash'] },
    { name: 'block-env-modification', intent: 'env_modification', minConfidence: 0.9, action: 'deny', feedback: '[SEC-001] 禁止修改环境变量文件', suggestions: ['请求人工审核'] },
    { name: 'block-secret-exposure', intent: 'secret_exposure', minConfidence: 0.8, action: 'deny', feedback: '[SEC-003] 检测到敏感信息写入', suggestions: ['使用环境变量'] },
  ];
}
;
fs.writeFileSync('src/intent/intent-extractor.ts', content, 'utf8');
