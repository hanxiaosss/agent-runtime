#!/usr/bin/env node
/**
 * Guardian — Multi-layer Fallback Protection
 *
 * 当 Agent Hook 被绕过时，通过以下层级兜底：
 *
 * Layer 1: File System Watcher (实时回滚)
 *   - 监控受保护文件的修改
 *   - 检测到修改后立即从备份恢复
 *   - 记录到 trace 日志
 *
 * Layer 2: Git Pre-commit Hook (提交拦截)
 *   - 检查即将提交的内容是否包含红线文件
 *   - 如果包含，阻止提交并提示
 *
 * Layer 3: Git Post-commit Hook (提交后检测)
 *   - 检查最新提交是否修改了红线文件
 *   - 如果修改了，自动 revert 该提交
 *
 * Layer 4: Periodic Integrity Check (定期完整性检查)
 *   - 每 5 分钟检查一次红线文件完整性
 *   - 如果发现不一致，立即恢复
 *
 * Usage:
 *   hannah guardian start     — 启动所有保护层
 *   hannah guardian stop      — 停止所有保护层
 *   hannah guardian status    — 显示保护层状态
 *   hannah guardian check     — 立即执行一次完整性检查
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const PROJECT_ROOT = findProjectRoot();
const HARNESS_DIR = path.join(PROJECT_ROOT, ".harness");
const BACKUP_DIR = path.join(HARNESS_DIR, ".backups");
const TRACE_DIR = path.join(HARNESS_DIR, "traces");
const GUARDIAN_PID_FILE = path.join(HARNESS_DIR, ".guardian.pid");

// 红线文件列表
const REDLINE_FILES = [
  "agent.md",
  "AGENT.md",
  ".agent.md",
  "CLAUDE.md",
  "COPILOT.md",
  ".cursorrules",
  ".cursor/rules.md",
];

const REDLINE_DIRS = [
  ".harness/policies",
  ".harness/hooks",
  ".harness/semantic-hooks",
  ".harness/config.yaml",
];

// 状态管理
const fileHashes = new Map<string, string>();
const restoringFiles = new Set<string>();
let watcher: fs.FSWatcher | null = null;
let integrityTimer: NodeJS.Timeout | null = null;

// ─── 工具函数 ─────────────────────────────────────────────────────

function findProjectRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, ".harness"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Fallback to cwd
      return process.cwd();
    }
    dir = parent;
  }
}

function computeHash(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(content).digest("hex");
  } catch {
    return "";
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getBackupPath(filePath: string): string {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  return path.join(BACKUP_DIR, relativePath + ".backup");
}

function backupFile(filePath: string): boolean {
  ensureDir(BACKUP_DIR);
  const backupPath = getBackupPath(filePath);
  const backupDir = path.dirname(backupPath);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  try {
    fs.copyFileSync(filePath, backupPath);
    const hash = computeHash(filePath);
    fileHashes.set(filePath, hash);
    return true;
  } catch (err: any) {
    logError(`Failed to backup ${filePath}: ${err.message}`);
    return false;
  }
}

function restoreFile(filePath: string): boolean {
  const backupPath = getBackupPath(filePath);

  if (!fs.existsSync(backupPath)) {
    logError(`No backup found for ${filePath}`);
    return false;
  }

  restoringFiles.add(filePath);

  try {
    fs.copyFileSync(backupPath, filePath);
    const hash = computeHash(filePath);
    fileHashes.set(filePath, hash);
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    console.log(`[guardian] ✅ Restored: ${relativePath}`);
    return true;
  } catch (err: any) {
    logError(`Failed to restore ${filePath}: ${err.message}`);
    return false;
  } finally {
    setTimeout(() => {
      restoringFiles.delete(filePath);
    }, 500);
  }
}

function writeTrace(event: string, action: string, details: any): void {
  ensureDir(TRACE_DIR);
  const date = new Date().toISOString().slice(0, 10);
  const traceFile = path.join(TRACE_DIR, `${date}.jsonl`);

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    source: "guardian",
    action,
    payload: details,
    feedback: [
      "Redline file modification detected and reverted",
      "This file is protected by Guardian fallback mechanism",
    ],
  };

  fs.appendFileSync(traceFile, JSON.stringify(entry) + "\n");
}

function logError(message: string): void {
  console.error(`[guardian] ❌ ${message}`);
}

function logInfo(message: string): void {
  console.log(`[guardian] ${message}`);
}

// ─── Layer 1: File System Watcher ─────────────────────────────────

function isRedlinePath(filePath: string): boolean {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const basename = path.basename(filePath);

  // 精确匹配文件
  for (const redlineFile of REDLINE_FILES) {
    if (relativePath === redlineFile || basename === redlineFile) {
      return true;
    }
  }

  // 目录前缀匹配
  for (const redlineDir of REDLINE_DIRS) {
    if (
      relativePath.startsWith(redlineDir + path.sep) ||
      relativePath.startsWith(redlineDir + "/") ||
      relativePath === redlineDir
    ) {
      return true;
    }
  }

  return false;
}

function handleFileChange(filePath: string, eventType: string): void {
  if (!isRedlinePath(filePath)) return;
  if (restoringFiles.has(filePath)) return;

  // 检查内容是否真的改变了
  const currentHash = computeHash(filePath);
  const backupHash = fileHashes.get(filePath);

  if (currentHash === backupHash) return;

  const relativePath = path.relative(PROJECT_ROOT, filePath);
  logInfo(`⚠️  Redline file modified: ${relativePath}`);

  writeTrace("redline.violation", "deny", {
    filePath: relativePath,
    eventType,
    message: "AI agent attempted to modify protected file",
  });

  // 延迟恢复（等待文件写入完成）
  setTimeout(() => {
    restoreFile(filePath);
  }, 200);
}

function startFileWatcher(): void {
  logInfo("Starting file system watcher...");

  // 备份所有红线文件
  backupAllRedlineFiles();

  watcher = fs.watch(
    PROJECT_ROOT,
    { recursive: true },
    (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(PROJECT_ROOT, filename.toString());
      handleFileChange(fullPath, eventType);
    },
  );

  logInfo("✅ File watcher started");
}

function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    logInfo("File watcher stopped");
  }
}

// ─── Layer 2 & 3: Git Hooks ───────────────────────────────────────

function installGitHooks(): void {
  const gitDir = path.join(PROJECT_ROOT, ".git");
  if (!fs.existsSync(gitDir)) {
    logInfo("Not a git repository, skipping git hooks installation");
    return;
  }

  const hooksDir = path.join(gitDir, "hooks");
  ensureDir(hooksDir);

  // Pre-commit hook
  const preCommitPath = path.join(hooksDir, "pre-commit");
  const preCommitScript = generatePreCommitHook();
  fs.writeFileSync(preCommitPath, preCommitScript, { mode: 0o755 });
  logInfo("✅ Installed pre-commit hook");

  // Post-commit hook
  const postCommitPath = path.join(hooksDir, "post-commit");
  const postCommitScript = generatePostCommitHook();
  fs.writeFileSync(postCommitPath, postCommitScript, { mode: 0o755 });
  logInfo("✅ Installed post-commit hook");
}

function uninstallGitHooks(): void {
  const gitDir = path.join(PROJECT_ROOT, ".git");
  if (!fs.existsSync(gitDir)) return;

  const hooksDir = path.join(gitDir, "hooks");

  for (const hookName of ["pre-commit", "post-commit"]) {
    const hookPath = path.join(hooksDir, hookName);
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, "utf-8");
      if (content.includes("# Generated by hannah guardian")) {
        fs.unlinkSync(hookPath);
        logInfo(`Removed ${hookName} hook`);
      }
    }
  }
}

function generatePreCommitHook(): string {
  return `#!/usr/bin/env bash
# Generated by hannah guardian
# Pre-commit hook: Block commits containing redline file changes

REDLINE_FILES=(
  "agent.md"
  "AGENT.md"
  ".agent.md"
  "CLAUDE.md"
  "COPILOT.md"
  ".cursorrules"
  ".cursor/rules.md"
)

REDLINE_DIRS=(
  ".harness/policies"
  ".harness/hooks"
  ".harness/semantic-hooks"
)

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only)

# Check if any redline files are staged
for file in $STAGED_FILES; do
  # Check exact file matches
  for redline in "\${REDLINE_FILES[@]}"; do
    if [ "$file" = "$redline" ]; then
      echo "❌ Commit blocked: $file is a protected redline file"
      echo "   This file cannot be modified by AI agents."
      echo "   If you need to change it, ask a human to update it manually."
      exit 1
    fi
  done
  
  # Check directory matches
  for dir in "\${REDLINE_DIRS[@]}"; do
    if [[ "$file" == "$dir"/* ]]; then
      echo "❌ Commit blocked: $file is in protected directory $dir"
      echo "   Files in this directory cannot be modified by AI agents."
      exit 1
    fi
  done
done

exit 0
`;
}

function generatePostCommitHook(): string {
  return `#!/usr/bin/env bash
# Generated by hannah guardian
# Post-commit hook: Detect and revert redline file changes in commits

REDLINE_FILES=(
  "agent.md"
  "AGENT.md"
  ".agent.md"
  "CLAUDE.md"
  "COPILOT.md"
  ".cursorrules"
  ".cursor/rules.md"
)

REDLINE_DIRS=(
  ".harness/policies"
  ".harness/hooks"
  ".harness/semantic-hooks"
)

# Get files changed in the last commit
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD)

VIOLATION_FOUND=false

for file in $CHANGED_FILES; do
  # Check exact file matches
  for redline in "\${REDLINE_FILES[@]}"; do
    if [ "$file" = "$redline" ]; then
      echo "⚠️  Redline violation detected: $file was modified in last commit"
      VIOLATION_FOUND=true
      break 2
    fi
  done
  
  # Check directory matches
  for dir in "\${REDLINE_DIRS[@]}"; do
    if [[ "$file" == "$dir"/* ]]; then
      echo "⚠️  Redline violation detected: $file in protected directory was modified"
      VIOLATION_FOUND=true
      break 2
    fi
  done
done

if [ "$VIOLATION_FOUND" = true ]; then
  echo "🔄 Reverting last commit due to redline violation..."
  git revert --no-edit HEAD
  echo "✅ Commit reverted successfully"
fi

exit 0
`;
}

// ─── Layer 4: Periodic Integrity Check ────────────────────────────

function startIntegrityCheck(intervalMs: number = 5 * 60 * 1000): void {
  logInfo(`Starting periodic integrity check (every ${intervalMs / 1000}s)...`);

  // Run immediately
  runIntegrityCheck();

  // Then run periodically
  integrityTimer = setInterval(runIntegrityCheck, intervalMs);
}

function stopIntegrityCheck(): void {
  if (integrityTimer) {
    clearInterval(integrityTimer);
    integrityTimer = null;
    logInfo("Integrity check stopped");
  }
}

function runIntegrityCheck(): void {
  logInfo("Running integrity check...");

  let violations = 0;

  // Check redline files
  for (const redlineFile of REDLINE_FILES) {
    const fullPath = path.join(PROJECT_ROOT, redlineFile);
    if (!fs.existsSync(fullPath)) continue;

    const currentHash = computeHash(fullPath);
    const backupHash = fileHashes.get(fullPath);

    if (backupHash && currentHash !== backupHash) {
      logInfo(`⚠️  Integrity violation: ${redlineFile}`);
      restoreFile(fullPath);
      violations++;
    }
  }

  // Check redline directories
  for (const redlineDir of REDLINE_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, redlineDir);
    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      checkDirectoryIntegrity(fullPath);
    }
  }

  if (violations === 0) {
    logInfo("✅ Integrity check passed");
  } else {
    logInfo(`⚠️  Integrity check found ${violations} violation(s)`);
  }
}

function checkDirectoryIntegrity(dirPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile()) {
      const currentHash = computeHash(fullPath);
      const backupHash = fileHashes.get(fullPath);

      if (backupHash && currentHash !== backupHash) {
        logInfo(
          `⚠️  Integrity violation: ${path.relative(PROJECT_ROOT, fullPath)}`,
        );
        restoreFile(fullPath);
      }
    } else if (entry.isDirectory()) {
      checkDirectoryIntegrity(fullPath);
    }
  }
}

// ─── Backup Management ────────────────────────────────────────────

function backupAllRedlineFiles(): void {
  logInfo("Backing up redline files...");

  // Backup individual files
  for (const redlineFile of REDLINE_FILES) {
    const fullPath = path.join(PROJECT_ROOT, redlineFile);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      backupFile(fullPath);
    }
  }

  // Backup directories
  for (const redlineDir of REDLINE_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, redlineDir);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        backupDirectory(fullPath);
      } else if (stat.isFile()) {
        backupFile(fullPath);
      }
    }
  }

  logInfo("✅ Backup complete");
}

function backupDirectory(dirPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile()) {
      backupFile(fullPath);
    } else if (entry.isDirectory()) {
      backupDirectory(fullPath);
    }
  }
}

// ─── Guardian Lifecycle ───────────────────────────────────────────

function startGuardian(): void {
  logInfo("🛡️  Starting Guardian fallback protection...");
  logInfo(`Project root: ${PROJECT_ROOT}`);

  ensureDir(HARNESS_DIR);
  ensureDir(BACKUP_DIR);
  ensureDir(TRACE_DIR);

  // Save PID
  fs.writeFileSync(GUARDIAN_PID_FILE, process.pid.toString());

  // Start all layers
  startFileWatcher();
  installGitHooks();
  startIntegrityCheck();

  logInfo("🛡️  Guardian is active");
  logInfo("Press Ctrl+C to stop");

  // Keep process alive
  process.on("SIGINT", stopGuardian);
  process.on("SIGTERM", stopGuardian);
}

function stopGuardian(): void {
  logInfo("Stopping Guardian...");

  stopFileWatcher();
  stopIntegrityCheck();
  uninstallGitHooks();

  // Remove PID file
  if (fs.existsSync(GUARDIAN_PID_FILE)) {
    fs.unlinkSync(GUARDIAN_PID_FILE);
  }

  logInfo("Guardian stopped");
  process.exit(0);
}

function showStatus(): void {
  console.log("\n🛡️  Guardian Status");
  console.log("═══════════════════════════════════════\n");

  // Check if guardian is running
  const isRunning = fs.existsSync(GUARDIAN_PID_FILE);
  console.log(
    `  Guardian Process: ${isRunning ? "✅ Running" : "❌ Not running"}`,
  );

  // Check file watcher
  console.log(`  File Watcher: ${watcher ? "✅ Active" : "❌ Inactive"}`);

  // Check integrity timer
  console.log(
    `  Integrity Check: ${integrityTimer ? "✅ Active" : "❌ Inactive"}`,
  );

  // Check git hooks
  const gitDir = path.join(PROJECT_ROOT, ".git");
  if (fs.existsSync(gitDir)) {
    const hooksDir = path.join(gitDir, "hooks");
    const preCommitPath = path.join(hooksDir, "pre-commit");
    const postCommitPath = path.join(hooksDir, "post-commit");

    const preCommitInstalled =
      fs.existsSync(preCommitPath) &&
      fs
        .readFileSync(preCommitPath, "utf-8")
        .includes("# Generated by hannah guardian");
    const postCommitInstalled =
      fs.existsSync(postCommitPath) &&
      fs
        .readFileSync(postCommitPath, "utf-8")
        .includes("# Generated by hannah guardian");

    console.log(
      `  Pre-commit Hook: ${preCommitInstalled ? "✅ Installed" : "❌ Not installed"}`,
    );
    console.log(
      `  Post-commit Hook: ${postCommitInstalled ? "✅ Installed" : "❌ Not installed"}`,
    );
  } else {
    console.log("  Git Hooks: ⚠️  Not a git repository");
  }

  // Check backups
  const backupCount = countBackups();
  console.log(`  Backed up Files: ${backupCount}`);

  console.log("");
}

function countBackups(): number {
  if (!fs.existsSync(BACKUP_DIR)) return 0;

  let count = 0;
  function countDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        countDir(path.join(dir, entry.name));
      }
    }
  }
  countDir(BACKUP_DIR);
  return count;
}

function runSingleCheck(): void {
  logInfo("Running single integrity check...");
  backupAllRedlineFiles();
  runIntegrityCheck();
}

// ─── CLI Entry Point ──────────────────────────────────────────────

export function runGuardian(args: string[]): void {
  const command = args[0];

  switch (command) {
    case "start":
      startGuardian();
      break;
    case "stop":
      stopGuardian();
      break;
    case "status":
      showStatus();
      break;
    case "check":
      runSingleCheck();
      break;
    default:
      console.log("Usage: hannah guardian <command>");
      console.log("");
      console.log("Commands:");
      console.log("  start    Start all protection layers");
      console.log("  stop     Stop all protection layers");
      console.log("  status   Show protection status");
      console.log("  check    Run single integrity check");
      break;
  }
}
