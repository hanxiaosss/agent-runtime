/**
 * Hook Adapter V2 Base Class
 *
 * 统一的适配器基类，集成 HookExecutor 和 HookConfigurationLoader
 * 所有运行时适配器（Codex, Copilot, ClaudeCode等）应继承此类
 *
 * 设计考虑：
 * - 向后兼容性：保留 v1 方法签名
 * - 事件映射：将运行时特定事件映射到统一的 8 个 hook 事件
 * - 配置继承：自动加载 .harness/ 中的配置
 * - 优雅降级：如果 hook 不可用，继续正常流程
 */

import * as path from "path";
import { BaseAdapter } from "./base-adapter.js";
import {
  HookExecutor,
  type HookHandler,
  type HookInput,
  type HookResult,
} from "../core/hook-executor.js";
import { HookConfigurationLoader } from "../core/hook-config-loader.js";

// ─── Event Mapping ──────────────────────────────────────────────────

/**
 * Hook 事件能力矩阵 - 表示每个运行时支持的 hook 事件
 */
export interface HookCapabilities {
  SessionStart: boolean;
  PreToolUse: boolean;
  PermissionRequest: boolean;
  PostToolUse: boolean;
  Stop: boolean;
  UserPromptSubmit: boolean;
  PreCompact: boolean;
  PostCompact: boolean;
}

// ─── Input/Output Types ─────────────────────────────────────────────

/**
 * Hook 执行上下文
 */
export interface HookExecutionContext {
  sessionId: string;
  source: string; // 运行时名称: "codex", "copilot", etc.
  timestamp: Date;
  cwd: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool 使用信息
 */
export interface ToolUsageInfo {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
}

/**
 * 权限请求信息
 */
export interface PermissionRequestInfo {
  resource: string;
  action: string;
  details?: Record<string, unknown>;
}

/**
 * 用户提示信息
 */
export interface UserPromptInfo {
  promptText: string;
  context?: Record<string, unknown>;
}

/**
 * 上下文压缩信息
 */
export interface CompactInfo {
  oldSize: number;
  newSize: number;
  strategy: string;
  details?: Record<string, unknown>;
}

// ─── Hook Adapter V2 Implementation ─────────────────────────────────

export abstract class HookAdapterV2 extends BaseAdapter {
  protected hookExecutor: HookExecutor;
  protected configLoader: HookConfigurationLoader;
  protected harnessDir: string;

  /**
   * 运行时应该覆盖此属性以声明支持的 hooks
   */
  abstract hookCapabilities: Partial<HookCapabilities>;

  declare readonly name: string;

  constructor(name: string, harnessDir: string = ".harness") {
    super();
    Object.defineProperty(this, "name", {
      value: name,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    this.harnessDir = harnessDir;

    // 初始化 hook 基础设施
    const logsDir = path.join(harnessDir, "hooks", "logs");
    this.hookExecutor = new HookExecutor(logsDir, {
      enableLogging: true,
      defaultTimeout: 10000,
    });

    this.configLoader = new HookConfigurationLoader(harnessDir);
  }

  // ─── Hook Execution Methods ─────────────────────────────────────

  /**
   * 执行 SessionStart hook
   */
  async onSessionStart(context: HookExecutionContext): Promise<HookResult> {
    if (!this.hookCapabilities.SessionStart) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("SessionStart");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("SessionStart", handlers, {
      sessionId: context.sessionId,
      hookEvent: "SessionStart",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      ...context.metadata,
    });
  }

  /**
   * 执行 PreToolUse hook
   */
  async onPreToolUse(
    context: HookExecutionContext,
    toolInfo: ToolUsageInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.PreToolUse) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("PreToolUse");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("PreToolUse", handlers, {
      sessionId: context.sessionId,
      hookEvent: "PreToolUse",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      toolName: toolInfo.toolName,
      toolInput: toolInfo.toolInput,
      ...context.metadata,
    });
  }

  /**
   * 执行 PostToolUse hook
   */
  async onPostToolUse(
    context: HookExecutionContext,
    toolInfo: ToolUsageInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.PostToolUse) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("PostToolUse");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("PostToolUse", handlers, {
      sessionId: context.sessionId,
      hookEvent: "PostToolUse",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      toolName: toolInfo.toolName,
      toolOutput: toolInfo.toolOutput,
      ...context.metadata,
    });
  }

  /**
   * 执行 PermissionRequest hook
   */
  async onPermissionRequest(
    context: HookExecutionContext,
    permissionInfo: PermissionRequestInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.PermissionRequest) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("PermissionRequest");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("PermissionRequest", handlers, {
      sessionId: context.sessionId,
      hookEvent: "PermissionRequest",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      resource: permissionInfo.resource,
      action: permissionInfo.action,
      details: permissionInfo.details,
      ...context.metadata,
    });
  }

  /**
   * 执行 Stop hook
   */
  async onStop(context: HookExecutionContext): Promise<HookResult> {
    if (!this.hookCapabilities.Stop) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("Stop");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("Stop", handlers, {
      sessionId: context.sessionId,
      hookEvent: "Stop",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      ...context.metadata,
    });
  }

  /**
   * 执行 UserPromptSubmit hook
   */
  async onUserPromptSubmit(
    context: HookExecutionContext,
    promptInfo: UserPromptInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.UserPromptSubmit) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("UserPromptSubmit");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("UserPromptSubmit", handlers, {
      sessionId: context.sessionId,
      hookEvent: "UserPromptSubmit",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      promptText: promptInfo.promptText,
      context: promptInfo.context,
      ...context.metadata,
    });
  }

  /**
   * 执行 PreCompact hook
   */
  async onPreCompact(
    context: HookExecutionContext,
    compactInfo: CompactInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.PreCompact) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("PreCompact");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("PreCompact", handlers, {
      sessionId: context.sessionId,
      hookEvent: "PreCompact",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      oldSize: compactInfo.oldSize,
      newSize: compactInfo.newSize,
      strategy: compactInfo.strategy,
      details: compactInfo.details,
      ...context.metadata,
    });
  }

  /**
   * 执行 PostCompact hook
   */
  async onPostCompact(
    context: HookExecutionContext,
    compactInfo: CompactInfo,
  ): Promise<HookResult> {
    if (!this.hookCapabilities.PostCompact) {
      return { decision: "allow" };
    }

    const handlers = await this.configLoader.getHandlers("PostCompact");
    if (handlers.length === 0) {
      return { decision: "allow" };
    }

    return this.executeHookChain("PostCompact", handlers, {
      sessionId: context.sessionId,
      hookEvent: "PostCompact",
      source: context.source,
      cwd: context.cwd,
      timestamp: context.timestamp.toISOString(),
      oldSize: compactInfo.oldSize,
      newSize: compactInfo.newSize,
      strategy: compactInfo.strategy,
      details: compactInfo.details,
      ...context.metadata,
    });
  }

  // ─── Internal Methods ───────────────────────────────────────────

  /**
   * 执行 hook 处理器链（内部使用）
   */
  protected async executeHookChain(
    eventName: string,
    handlers: any[],
    input: HookInput,
  ): Promise<HookResult> {
    try {
      return await this.hookExecutor.executeHandlers(
        eventName,
        handlers,
        input,
      );
    } catch (error) {
      // 日志错误但继续
      console.error(`[${this.name}] Hook execution failed: ${error}`);
      return {
        decision: "allow",
        reason: `Hook execution failed: ${error}`,
      };
    }
  }

  /**
   * 获取支持的 hooks 列表
   */
  async getSupportedHooks(): Promise<string[]> {
    const supported: string[] = [];

    if (this.hookCapabilities.SessionStart) supported.push("SessionStart");
    if (this.hookCapabilities.PreToolUse) supported.push("PreToolUse");
    if (this.hookCapabilities.PermissionRequest)
      supported.push("PermissionRequest");
    if (this.hookCapabilities.PostToolUse) supported.push("PostToolUse");
    if (this.hookCapabilities.Stop) supported.push("Stop");
    if (this.hookCapabilities.UserPromptSubmit)
      supported.push("UserPromptSubmit");
    if (this.hookCapabilities.PreCompact) supported.push("PreCompact");
    if (this.hookCapabilities.PostCompact) supported.push("PostCompact");

    return supported;
  }

  /**
   * 获取 hook 统计信息
   */
  async getHookStatistics(days: number = 1) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.hookExecutor.getStatistics(startDate, endDate);
  }

  /**
   * 启用/禁用特定 hook
   */
  async enableHook(hookName: string, enabled: boolean): Promise<void> {
    await this.configLoader.setHookEnabled(hookName, enabled);
  }
}

// ─── Exports ────────────────────────────────────────────────────────

export default HookAdapterV2;
