#!/usr/bin/env node
/**
 * File System Watcher for Redline Protection
 *
 * 监控关键文件（agent.md, .harness/）的修改，
 * 当检测到修改时自动回滚并记录到 trace。
 *
 * 这个方案不依赖 agent 的 hook 支持，适用于所有 agent。
 *
 * 关键设计：
 * 1. 内容哈希比对：只在内容真正改变时才恢复
 * 2. 恢复锁：恢复操作本身不触发新的恢复
 * 3. 冷却期：同一文件在短时间内不重复处理
 * 4. 智能备份：只在首次启动或人工确认时更新备份
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 需要保护的文件和目录
const PROTECTED_FILES = [
  'agent.md',
  'AGENT.md',
  '.agent.md',
  'CLAUDE.md',
  'COPILOT.md',
  '.cursorrules',
  '.harness/config.yaml',
];

const PROTECTED_PATTERNS = [
  '.env',
  '.env.*',
  '*.env',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'poetry.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
];

const PROTECTED_DIRS = [
  '.harness/policies',
  '.harness/hooks',
  '.harness/semantic-hooks',
];

// 备份目录
const BACKUP_DIR = path.join(PROJECT_ROOT, '.harness', '.backups');

// Trace 目录
const TRACE_DIR = path.join(PROJECT_ROOT, '.harness', 'traces');

// ─── 状态管理 ─────────────────────────────────────────────────────

// 恢复锁：标记正在恢复的文件，避免无限循环
const restoringFiles = new Set<string>();

// 冷却期：记录上次处理时间，避免短时间内重复处理
const lastProcessed = new Map<string, number>();
const COOLDOWN_MS = 2000; // 2秒冷却期

// 文件内容哈希缓存
const fileHashes = new Map<string, string>();

// ─── 工具函数 ─────────────────────────────────────────────────────

function computeHash(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getBackupPath(filePath: string): string {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  return path.join(BACKUP_DIR, relativePath + '.backup');
}

function backupFile(filePath: string): boolean {
  ensureBackupDir();
  const backupPath = getBackupPath(filePath);

  // 确保备份目录存在
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  try {
    fs.copyFileSync(filePath, backupPath);
    const hash = computeHash(filePath);
    fileHashes.set(filePath, hash);
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    console.error(`[watcher] Backed up: ${relativePath}`);
    return true;
  } catch (err: any) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    console.error(`[watcher] Failed to backup ${relativePath}:`, err.message);
    return false;
  }
}

function restoreFile(filePath: string): boolean {
  const backupPath = getBackupPath(filePath);

  if (!fs.existsSync(backupPath)) {
    return false;
  }

  // 加锁：标记正在恢复
  restoringFiles.add(filePath);

  try {
    fs.copyFileSync(backupPath, filePath);
    const hash = computeHash(filePath);
    fileHashes.set(filePath, hash);
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    console.error(`[watcher] ✅ Restored: ${relativePath}`);
    return true;
  } catch (err: any) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    console.error(`[watcher] Failed to restore ${relativePath}:`, err.message);
    return false;
  } finally {
    // 延迟解锁，等待文件系统事件稳定
    setTimeout(() => {
      restoringFiles.delete(filePath);
    }, 500);
  }
}

function writeTrace(event: string, action: string, details: any) {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }

  const date = new Date().toISOString().slice(0, 10);
  const traceFile = path.join(TRACE_DIR, `${date}.jsonl`);

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    source: 'file-watcher',
    action,
    payload: details,
    feedback: [
      'Redline file modification detected and reverted',
      'This file is protected and cannot be modified by AI agents',
    ],
  };

  fs.appendFileSync(traceFile, JSON.stringify(entry) + '\n');
}

function isProtectedPath(filePath: string): boolean {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const basename = path.basename(relativePath);

  // 精确匹配文件
  for (const protectedFile of PROTECTED_FILES) {
    if (relativePath === protectedFile) {
      return true;
    }
  }

  // Pattern 匹配（.env、lock files 等）
  for (const pattern of PROTECTED_PATTERNS) {
    if (matchGlob(basename, pattern)) {
      return true;
    }
    // 也匹配嵌套路径中的文件名（如 config/.env）
    if (matchGlob(relativePath, '**/' + pattern)) {
      return true;
    }
  }

  // 目录前缀匹配
  for (const protectedDir of PROTECTED_DIRS) {
    if (
      relativePath.startsWith(protectedDir + path.sep) ||
      relativePath.startsWith(protectedDir + '/') ||
      relativePath === protectedDir
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Simple glob matcher for filename patterns.
 * Supports: * (any chars except /), ? (single char), ** (any path depth)
 */
function matchGlob(value: string, pattern: string): boolean {
  const regexStr = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*') + '$';
  return new RegExp(regexStr, 'i').test(value);
}

function isInCooldown(filePath: string): boolean {
  const now = Date.now();
  const lastTime = lastProcessed.get(filePath) || 0;
  return now - lastTime < COOLDOWN_MS;
}

function markProcessed(filePath: string) {
  lastProcessed.set(filePath, Date.now());
}

// ─── 扫描并备份所有受保护文件 ─────────────────────────────────────

function backupAllProtected() {
  // 备份精确匹配的文件
  for (const protectedFile of PROTECTED_FILES) {
    const fullPath = path.join(PROJECT_ROOT, protectedFile);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      backupFile(fullPath);
    }
  }

  // 扫描并备份 pattern 匹配的文件（.env、lock files 等）
  const allFiles = scanProjectFiles(PROJECT_ROOT);
  for (const filePath of allFiles) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    const basename = path.basename(relativePath);
    for (const pattern of PROTECTED_PATTERNS) {
      if (matchGlob(basename, pattern) || matchGlob(relativePath, '**/' + pattern)) {
        backupFile(filePath);
        break;
      }
    }
  }

  // 备份目录中的文件
  for (const protectedDir of PROTECTED_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, protectedDir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const files = fs.readdirSync(fullPath, { recursive: true });
      for (const file of files) {
        const filePath = path.join(fullPath, file.toString());
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          backupFile(filePath);
        }
      }
    }
  }
}

/**
 * Recursively scan project directory for files, skipping node_modules etc.
 */
function scanProjectFiles(root: string): string[] {
  const results: string[] = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.backups']);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  return results;
}

// ─── 处理文件变更 ─────────────────────────────────────────────────

function handleFileChange(filePath: string, eventType: string) {
  // 检查是否是受保护的文件
  if (!isProtectedPath(filePath)) {
    return;
  }

  // 检查是否正在恢复（避免无限循环）
  if (restoringFiles.has(filePath)) {
    return;
  }

  // 检查冷却期
  if (isInCooldown(filePath)) {
    return;
  }

  // 检查内容是否真的改变了（与备份比对）
  const currentHash = computeHash(filePath);
  const backupHash = fileHashes.get(filePath);

  if (currentHash === backupHash) {
    // 内容没有变化，忽略
    return;
  }

  // 标记已处理
  markProcessed(filePath);

  const relativePath = path.relative(PROJECT_ROOT, filePath);
  console.error(`[watcher] ⚠️  Protected file modified: ${relativePath}`);

  // 写入 trace
  writeTrace('redline.violation', 'deny', {
    filePath: relativePath,
    eventType,
    message: 'AI agent attempted to modify protected file',
  });

  // 延迟恢复（等待文件写入完成）
  setTimeout(() => {
    restoreFile(filePath);
  }, 200);
}

// ─── 主函数 ─────────────────────────────────────────────────────

function createWatcher() {
  console.error('[watcher] Starting file system watcher...');
  console.error('[watcher] Project root:', PROJECT_ROOT);
  console.error('[watcher] Protected files:', PROTECTED_FILES.join(', '));
  console.error('[watcher] Protected patterns:', PROTECTED_PATTERNS.join(', '));
  console.error('[watcher] Protected dirs:', PROTECTED_DIRS.join(', '));
  console.error('');

  // 备份所有受保护的文件
  backupAllProtected();

  // 监控项目根目录
  const watcher = fs.watch(
    PROJECT_ROOT,
    { recursive: true },
    (eventType, filename) => {
      if (!filename) return;

      const fullPath = path.join(PROJECT_ROOT, filename.toString());
      handleFileChange(fullPath, eventType);
    }
  );

  console.error('[watcher] ✅ Watcher started. Monitoring for redline violations...');
  console.error('[watcher] Press Ctrl+C to stop.\n');

  // 处理退出
  process.on('SIGINT', () => {
    console.error('\n[watcher] Stopping watcher...');
    watcher.close();
    process.exit(0);
  });

  // 保持进程运行
  process.on('SIGTERM', () => {
    console.error('\n[watcher] Stopping watcher...');
    watcher.close();
    process.exit(0);
  });

  return watcher;
}

// 启动监控
createWatcher();
