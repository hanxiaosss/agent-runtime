/**
 * Claude Code Hook Adapter V2
 *
 * 针对 Anthropic Claude Code 运行时的 hook 适配器实现
 * 支持 31 个 hook 事件（v2.1.233+）
 */

import * as path from "path";
import * as fs from "fs";
import type { HookCapabilities } from "./hook-adapter-v2.js";
import { HookAdapterV2 } from "./hook-adapter-v2.js";
import type { EventCapability } from "../core/event.js";

/**
 * Claude Code Hook Adapter V2 实现
 *
 * Claude Code 运行时支持 7 个标准 hook 事件：
 * - SessionStart: 会话启动时触发
 * - PreToolUse: 工具调用前触发
 * - PostToolUse: 工具调用后触发
 * - PermissionRequest: 权限请求时触发
 * - Stop: 会话停止时触发
 * - UserPromptSubmit: 用户提示提交时触发
 * - PreCompact: 上下文压缩前触发
 *
 * 不支持的 hooks：
 * - PostCompact
 */
export class ClaudeCodeAdapterV2 extends HookAdapterV2 {
  declare readonly name: string;

  /**
   * Claude Code 支持全部 31 个 hook 事件（v2.1.233+）
   *
   * Blocking hooks（12 个，可通过 exit 2 拦截）:
   *   PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch,
   *   PermissionRequest, SubagentStop, TaskCreated, TaskCompleted,
   *   Stop, UserPromptSubmit, UserPromptExpansion, MessageDisplay
   *
   * Informational hooks（19 个，仅审计/追踪）:
   *   SessionStart, Setup, SessionEnd, StopFailure, PermissionDenied,
   *   SubagentStart, PreCompact, PostCompact, CwdChanged, FileChanged,
   *   DirectoryAdded, WorktreeCreate, WorktreeRemove, Notification,
   *   TeammateIdle, ConfigChange, InstructionsLoaded, Elicitation, ElicitationResult
   */
  readonly hookCapabilities: HookCapabilities = {
    // Session
    SessionStart: true,
    Setup: true,
    SessionEnd: true,
    // Turn
    UserPromptSubmit: true,
    UserPromptExpansion: true,
    Stop: true,
    StopFailure: true,
    // Tool
    PreToolUse: true,
    PostToolUse: true,
    PostToolUseFailure: true,
    PostToolBatch: true,
    // Permission
    PermissionRequest: true,
    PermissionDenied: true,
    // Subagent
    SubagentStart: true,
    SubagentStop: true,
    // Task
    TaskCreated: true,
    TaskCompleted: true,
    // Compact
    PreCompact: true,
    PostCompact: true,
    // File / Dir
    CwdChanged: true,
    FileChanged: true,
    DirectoryAdded: true,
    // Worktree
    WorktreeCreate: true,
    WorktreeRemove: true,
    // Other
    Notification: true,
    MessageDisplay: true,
    TeammateIdle: true,
    ConfigChange: true,
    InstructionsLoaded: true,
    Elicitation: true,
    ElicitationResult: true,
  };

  constructor(harnessDir: string = ".harness") {
    super("claude-code-v2", harnessDir);
  }

  /**
   * 初始化 Claude Code 适配器
   *
   * 创建必要的目录结构和日志文件
   */
  async initialize(): Promise<void> {
    try {
      // 创建 .harness/hooks 目录结构
      const logsDir = path.join(this.harnessDir, "hooks", "logs");
      const configDir = path.join(this.harnessDir, "hooks", "config");

      // 确保目录存在
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 初始化配置加载器
      await this.configLoader.load();

      console.log(`[${this.name}] Initialization complete`);
    } catch (error) {
      console.error(`[${this.name}] Initialization failed: ${error}`);
      throw error;
    }
  }

  /**
   * 获取基于 BaseAdapter 的能力（用于兼容性）
   */
  getCapabilities(): EventCapability[] {
    return Object.entries(this.hookCapabilities)
      .filter(([_, supported]) => supported)
      .map(([name]) => ({
        event: name as any,
        support: "native" as const,
      }));
  }

  /**
   * 处理 tool use 前的事件（BaseAdapter 抽象方法）
   */
  async handlePreToolUse() {
    // 通过 HookAdapterV2 的 onPreToolUse 处理
    return { decision: "allow" } as any;
  }

  /**
   * 处理 tool use 后的事件（BaseAdapter 抽象方法）
   */
  async handlePostToolUse() {
    // 通过 HookAdapterV2 的 onPostToolUse 处理
  }

  /**
   * 获取适配器的健康状态
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    version: string;
    hooks: string[];
    lastError?: string;
  }> {
    const supportedHooks = await this.getSupportedHooks();

    return {
      healthy: true,
      version: "2.0.0",
      hooks: supportedHooks,
    };
  }

  /**
   * 导出适配器的指标数据
   */
  async exportMetrics(): Promise<Record<string, unknown>> {
    const stats = await this.hookExecutor.getStatistics(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      new Date(),
    );

    return {
      adapter: this.name,
      capabilities: this.hookCapabilities,
      statistics: stats,
      supportedHooks: await this.getSupportedHooks(),
    };
  }

  /**
   * 获取适配器支持的所有 hook 名称列表
   */
  async getSupportedHooks(): Promise<string[]> {
    return Object.entries(this.hookCapabilities)
      .filter(([_, supported]) => supported)
      .map(([name]) => name);
  }
}

// ─── Exports ────────────────────────────────────────────────────────

export default ClaudeCodeAdapterV2;
