/**
 * Git Hook Runner
 *
 * Executes git hook callback chains including builtin behaviors and user-defined callbacks.
 */

import { spawn } from "child_process";
import {
  ArtifactLifecycleManager,
  LifecycleConfig,
} from "./artifact-lifecycle.js";

export type GitHookName =
  | "pre-commit"
  | "post-commit"
  | "pre-push"
  | "post-checkout"
  | "prepare-commit-msg";

export interface HookConfig {
  builtin?: {
    clearArtifacts?: boolean;
    archiveBeforeClear?: boolean;
    resetDashboard?: boolean;
    logCommit?: boolean;
  };
  callbacks?: CallbackConfig[];
}

export interface CallbackConfig {
  name: string;
  command: string;
  timeout?: number;
  onFailure?: "abort" | "warn" | "skip";
  env?: Record<string, string>;
  cwd?: string;
  condition?: string;
}

export interface HookResult {
  success: boolean;
  builtinResults: BuiltinResult[];
  callbackResults: CallbackResult[];
}

export interface BuiltinResult {
  name: string;
  success: boolean;
  message: string;
  details?: any;
}

export interface CallbackResult {
  name: string;
  success: boolean;
  exitCode: number;
  output: string;
  duration: number;
  onFailure: "abort" | "warn" | "skip";
}

export class GitHookRunner {
  private targetDir: string;
  private lifecycleManager: ArtifactLifecycleManager;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
    this.lifecycleManager = new ArtifactLifecycleManager();
  }

  /**
   * Run a git hook with its configured callbacks
   */
  async runHook(
    hookName: GitHookName,
    config: HookConfig,
  ): Promise<HookResult> {
    console.log(`\n🔧 Running ${hookName} hook...\n`);

    const result: HookResult = {
      success: true,
      builtinResults: [],
      callbackResults: [],
    };

    // Execute builtin behaviors first
    if (config.builtin) {
      await this.executeBuiltinBehaviors(hookName, config.builtin, result);
    }

    // Execute user-defined callbacks
    if (config.callbacks && config.callbacks.length > 0) {
      for (const callback of config.callbacks) {
        const callbackResult = await this.executeCallback(callback);
        result.callbackResults.push(callbackResult);

        // Check if we should abort
        if (!callbackResult.success && callbackResult.onFailure === "abort") {
          result.success = false;
          console.log(
            `\n❌ Callback '${callback.name}' failed with abort policy`,
          );
          break;
        }
      }
    }

    return result;
  }

  /**
   * Execute builtin behaviors
   */
  private async executeBuiltinBehaviors(
    hookName: GitHookName,
    builtin: HookConfig["builtin"],
    result: HookResult,
  ): Promise<void> {
    // Archive and clear artifacts (pre-commit)
    if (builtin?.clearArtifacts || builtin?.archiveBeforeClear) {
      const archiveResult = await this.executeClearArtifacts(builtin);
      result.builtinResults.push(archiveResult);
    }

    // Reset dashboard state (post-commit)
    if (builtin?.resetDashboard) {
      const resetResult = await this.executeResetDashboard();
      result.builtinResults.push(resetResult);
    }

    // Log commit event (post-commit)
    if (builtin?.logCommit) {
      const logResult = await this.executeLogCommit();
      result.builtinResults.push(logResult);
    }
  }

  /**
   * Execute clear artifacts builtin behavior
   */
  private async executeClearArtifacts(
    builtin: HookConfig["builtin"],
  ): Promise<BuiltinResult> {
    try {
      // Get commit info for archive metadata
      const commitInfo = await this.getCommitInfo();

      // Load lifecycle config from .harness/config.yaml
      const lifecycleConfig = await this.loadLifecycleConfig();

      const { archived, clearedFiles } =
        await this.lifecycleManager.archiveAndClear(
          lifecycleConfig,
          commitInfo,
        );

      const messages: string[] = [];
      if (archived) {
        messages.push(`Archived to ${lifecycleConfig.archive.dir}`);
      }
      if (clearedFiles.length > 0) {
        messages.push(`Cleared ${clearedFiles.length} files`);
      }

      console.log(`  📦 [builtin] clear-artifacts: ${messages.join(", ")}`);

      return {
        name: "clear-artifacts",
        success: true,
        message: messages.join(", "),
        details: { archived, clearedFiles },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ [builtin] clear-artifacts failed: ${message}`);
      return {
        name: "clear-artifacts",
        success: false,
        message,
      };
    }
  }

  /**
   * Execute reset dashboard builtin behavior
   */
  private async executeResetDashboard(): Promise<BuiltinResult> {
    try {
      // Dashboard is stateless (reads from traces), so clearing traces is enough
      console.log(`  🔄 [builtin] reset-dashboard: Dashboard state reset`);
      return {
        name: "reset-dashboard",
        success: true,
        message: "Dashboard state reset",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name: "reset-dashboard",
        success: false,
        message,
      };
    }
  }

  /**
   * Execute log commit builtin behavior
   */
  private async executeLogCommit(): Promise<BuiltinResult> {
    try {
      const commitInfo = await this.getCommitInfo();
      console.log(
        `  📝 [builtin] log-commit: ${commitInfo.hash} - ${commitInfo.message}`,
      );
      return {
        name: "log-commit",
        success: true,
        message: `Logged commit ${commitInfo.hash}`,
        details: commitInfo,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name: "log-commit",
        success: false,
        message,
      };
    }
  }

  /**
   * Execute a user-defined callback
   */
  private async executeCallback(
    callback: CallbackConfig,
  ): Promise<CallbackResult> {
    const startTime = Date.now();
    const onFailure = callback.onFailure || "warn";

    console.log(`  ▶  [user] ${callback.name}: ${callback.command}`);

    try {
      const { exitCode, output } = await this.runCommand(
        callback.command,
        callback.cwd || this.targetDir,
        callback.timeout || 30000,
        callback.env,
      );

      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        console.log(`     ✅ ${callback.name} completed (${duration}ms)`);
        return {
          name: callback.name,
          success: true,
          exitCode,
          output,
          duration,
          onFailure,
        };
      } else {
        const statusIcon =
          onFailure === "abort" ? "❌" : onFailure === "warn" ? "⚠️" : "⏭️";
        console.log(
          `     ${statusIcon} ${callback.name} failed (exit ${exitCode}, ${onFailure})`,
        );
        return {
          name: callback.name,
          success: false,
          exitCode,
          output,
          duration,
          onFailure,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`     ❌ ${callback.name} error: ${message}`);
      return {
        name: callback.name,
        success: false,
        exitCode: -1,
        output: message,
        duration,
        onFailure,
      };
    }
  }

  /**
   * Run a shell command with timeout
   */
  private runCommand(
    command: string,
    cwd: string,
    timeout: number,
    env?: Record<string, string>,
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let timeoutId: NodeJS.Timeout;

      // Set timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code || 0, output });
      });

      child.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Get current commit info
   */
  private async getCommitInfo(): Promise<{
    hash: string;
    message: string;
    author: string;
  }> {
    try {
      const hash = await this.runGitCommand("rev-parse --short HEAD");
      const message = await this.runGitCommand("log -1 --pretty=%s");
      const author = await this.runGitCommand("log -1 --pretty=%an");
      return {
        hash: hash.trim(),
        message: message.trim(),
        author: author.trim(),
      };
    } catch {
      return { hash: "unknown", message: "", author: "" };
    }
  }

  /**
   * Run a git command and return output
   */
  private runGitCommand(args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args.split(" "), {
        cwd: this.targetDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Git command failed: ${output}`));
        }
      });

      child.on("error", reject);
    });
  }

  /**
   * Load lifecycle config from .harness/config.yaml
   */
  private async loadLifecycleConfig(): Promise<LifecycleConfig> {
    const fs = await import("fs");
    const path = await import("path");
    const yaml = await import("js-yaml");

    const configPath = path.join(this.targetDir, ".harness", "config.yaml");

    if (!fs.existsSync(configPath)) {
      return {
        commitScoped: [],
        archive: { enabled: false, dir: ".harness/archive" },
      };
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const config = yaml.load(content) as any;

    return {
      commitScoped: config.gitHooks?.lifecycle?.commitScoped || [],
      archive: {
        enabled: config.gitHooks?.lifecycle?.archive?.enabled || false,
        dir: config.gitHooks?.lifecycle?.archive?.dir || ".harness/archive",
      },
    };
  }
}
