/**
 * Hook Executor v2
 *
 * 执行配置的 hook 处理器链，支持：
 * - 多个处理器优先级执行
 * - Shell/JavaScript/Python 处理器
 * - 超时控制
 * - 详细的日志记录
 *
 * 参考 Codex CLI Hooks 的设计模式
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ─── Type Definitions ───────────────────────────────────────────────

export interface HookHandler {
  type: "shell" | "javascript" | "python";
  command?: string;
  statusMessage?: string;
  timeout?: number; // milliseconds
  priority?: number;
  retryCount?: number;
}

export interface HookInput {
  sessionId: string;
  hookEvent: string;
  cwd: string;
  [key: string]: unknown;
}

export interface HookResult {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  shouldBreak?: boolean; // 是否中断后续处理器链
  context?: Record<string, unknown>;
}

export interface HookLogEntry {
  timestamp: string;
  hookEvent: string;
  hookName: string;
  source: string;
  sessionId: string;
  status: "success" | "failure" | "timeout";
  decision: string;
  duration: number;
  payload: HookInput;
  error?: string;
  feedback: string[];
}

// ─── Hook Executor Implementation ───────────────────────────────────

export class HookExecutor {
  private logDir: string;
  private config: HookExecutorConfig;

  constructor(
    logDir: string = ".harness/hooks/logs",
    config: HookExecutorConfig = {},
  ) {
    this.logDir = logDir;
    this.config = {
      enableLogging: config.enableLogging !== false,
      maxRetries: config.maxRetries ?? 3,
      defaultTimeout: config.defaultTimeout ?? 10000,
      ...config,
    };

    // Create log directory if it doesn't exist
    fs.mkdirSync(logDir, { recursive: true });
  }

  /**
   * Execute a chain of hook handlers in priority order
   */
  async executeHandlers(
    eventName: string,
    handlers: HookHandler[],
    input: HookInput,
  ): Promise<HookResult> {
    // Sort by priority (descending)
    const sorted = [...handlers].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    for (const handler of sorted) {
      const startTime = Date.now();
      const logEntry: Partial<HookLogEntry> = {
        timestamp: new Date().toISOString(),
        hookEvent: eventName,
        sessionId: input.sessionId as string,
        source: input.source as string,
        payload: input,
      };

      try {
        // Display status message if provided
        if (handler.statusMessage) {
          console.log(`[${eventName}] ${handler.statusMessage}`);
        }

        let result: HookResult;

        if (handler.type === "shell") {
          result = await this.executeShell(handler, input, handler.timeout);
        } else if (handler.type === "javascript") {
          result = await this.executeJavaScript(
            handler,
            input,
            handler.timeout,
          );
        } else if (handler.type === "python") {
          result = await this.executePython(handler, input, handler.timeout);
        } else {
          throw new Error(`Unknown handler type: ${handler.type}`);
        }

        const duration = Date.now() - startTime;

        // Log the execution
        if (this.config.enableLogging) {
          await this.logHookEvent({
            ...logEntry,
            status: "success",
            decision: result.decision,
            duration,
            feedback: result.reason ? [result.reason] : [],
          } as HookLogEntry);
        }

        // Break the chain if handler requests it
        if (result.shouldBreak) {
          return result;
        }

        // Return on deny decision
        if (result.decision === "deny") {
          return result;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (this.config.enableLogging) {
          await this.logHookEvent({
            ...logEntry,
            status: "failure",
            decision: "warn",
            duration,
            error: errorMsg,
            feedback: [`Handler execution failed: ${errorMsg}`],
          } as HookLogEntry);
        }

        // Continue to next handler on error (unless retrying)
        console.error(`[${eventName}] Handler error: ${errorMsg}`);
      }
    }

    return { decision: "allow" };
  }

  /**
   * Execute a shell command handler
   */
  private executeShell(
    handler: HookHandler,
    input: HookInput,
    timeout?: number,
  ): Promise<HookResult> {
    return new Promise((resolve, reject) => {
      if (!handler.command) {
        return reject(new Error("Shell handler missing command"));
      }

      const timeoutMs = timeout ?? this.config.defaultTimeout;
      const proc = spawn("bash", ["-c", handler.command], {
        cwd: input.cwd as string,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Handler timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);

        if (code === 0) {
          // Parse JSON output if present
          try {
            if (stdout.trim()) {
              const result = JSON.parse(stdout);
              resolve(result as HookResult);
            } else {
              resolve({ decision: "allow" });
            }
          } catch {
            resolve({ decision: "allow", reason: stdout.trim() });
          }
        } else if (code === 1 || code === 2) {
          // Exit code 1 or 2 = deny
          // Different agents use different conventions:
          // - Claude Code / Qoder / Cursor / Codex: exit 2 = deny
          // - Copilot / Trae: exit 1 (non-zero) = deny
          // Try to parse JSON from stdout first (rich decision), fall back to stderr
          try {
            if (stdout.trim()) {
              const result = JSON.parse(stdout);
              // Ensure decision is "deny" even if JSON says otherwise
              result.decision = "deny";
              if (!result.reason && stderr.trim()) {
                result.reason = stderr.trim();
              }
              resolve(result as HookResult);
            } else {
              resolve({
                decision: "deny",
                reason: stderr.trim() || "Handler denied action",
              });
            }
          } catch {
            resolve({
              decision: "deny",
              reason: stderr.trim() || "Handler denied action",
            });
          }
        } else {
          // Other exit codes = error
          reject(new Error(`Handler exit code ${code}: ${stderr}`));
        }
      });

      // Pass input via stdin
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    });
  }

  /**
   * Execute a JavaScript handler (in-process)
   */
  private async executeJavaScript(
    handler: HookHandler,
    input: HookInput,
    timeout?: number,
  ): Promise<HookResult> {
    // This would require dynamic require/import
    // For now, defer to shell execution
    throw new Error("JavaScript handler type not yet implemented");
  }

  /**
   * Execute a Python handler
   */
  private async executePython(
    handler: HookHandler,
    input: HookInput,
    timeout?: number,
  ): Promise<HookResult> {
    // Similar to shell, but runs python3
    return new Promise((resolve, reject) => {
      if (!handler.command) {
        return reject(new Error("Python handler missing command"));
      }

      const timeoutMs = timeout ?? this.config.defaultTimeout;
      const proc = spawn("python3", ["-c", handler.command], {
        cwd: input.cwd as string,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Handler timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);

        if (code === 0) {
          try {
            if (stdout.trim()) {
              const result = JSON.parse(stdout);
              resolve(result as HookResult);
            } else {
              resolve({ decision: "allow" });
            }
          } catch {
            resolve({ decision: "allow", reason: stdout.trim() });
          }
        } else if (code === 1 || code === 2) {
          // Exit code 1 or 2 = deny (same convention as shell handler)
          try {
            if (stdout.trim()) {
              const result = JSON.parse(stdout);
              result.decision = "deny";
              if (!result.reason && stderr.trim()) {
                result.reason = stderr.trim();
              }
              resolve(result as HookResult);
            } else {
              resolve({
                decision: "deny",
                reason: stderr.trim() || "Handler denied action",
              });
            }
          } catch {
            resolve({
              decision: "deny",
              reason: stderr.trim() || "Handler denied action",
            });
          }
        } else {
          reject(new Error(`Python handler exit code ${code}: ${stderr}`));
        }
      });

      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    });
  }

  /**
   * Log hook event to JSONL file
   */
  private async logHookEvent(entry: HookLogEntry): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(this.logDir, `hook-${date}.jsonl`);

    return new Promise((resolve, reject) => {
      fs.appendFile(logFile, JSON.stringify(entry) + "\n", "utf-8", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Query logs within a date range
   */
  async queryLogs(startDate: Date, endDate: Date): Promise<HookLogEntry[]> {
    const entries: HookLogEntry[] = [];
    const files = fs
      .readdirSync(this.logDir)
      .filter((f) => f.startsWith("hook-") && f.endsWith(".jsonl"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.logDir, file), "utf-8");
      for (const line of content.trim().split("\n")) {
        if (line) {
          try {
            const entry = JSON.parse(line) as HookLogEntry;
            const timestamp = new Date(entry.timestamp);
            if (timestamp >= startDate && timestamp <= endDate) {
              entries.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get statistics for a date range
   */
  async getStatistics(startDate: Date, endDate: Date): Promise<HookStatistics> {
    const entries = await this.queryLogs(startDate, endDate);

    return {
      total: entries.length,
      byEvent: this.countByField(entries, "hookEvent"),
      byDecision: this.countByField(entries, "decision"),
      byStatus: this.countByField(entries, "status"),
      avgDuration:
        entries.length > 0
          ? entries.reduce((sum, e) => sum + e.duration, 0) / entries.length
          : 0,
    };
  }

  private countByField(
    entries: HookLogEntry[],
    field: keyof HookLogEntry,
  ): Record<string, number> {
    const result: Record<string, number> = {};
    for (const entry of entries) {
      const key = String(entry[field]);
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }
}

// ─── Config Interface ───────────────────────────────────────────────

export interface HookExecutorConfig {
  enableLogging?: boolean;
  maxRetries?: number;
  defaultTimeout?: number;
}

// ─── Hook Statistics ────────────────────────────────────────────────

export interface HookStatistics {
  total: number;
  byEvent: Record<string, number>;
  byDecision: Record<string, number>;
  byStatus: Record<string, number>;
  avgDuration: number;
}

// ─── Exports ────────────────────────────────────────────────────────

export default HookExecutor;
