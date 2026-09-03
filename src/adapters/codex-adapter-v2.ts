/**
 * Codex Hook Adapter V2
 *
 * 针对 Codex 运行时的 hook 适配器实现
 * 支持所有 8 个 hook 事件
 *
 * 参考：https://github.com/shanraisshan/codex-cli-hooks
 */

import * as path from "path";
import * as fs from "fs";
import type { HookCapabilities } from "./hook-adapter-v2.js";
import { HookAdapterV2 } from "./hook-adapter-v2.js";
import type { EventCapability } from "../core/event.js";

export class CodexAdapterV2 extends HookAdapterV2 {
  readonly name = "codex-v2";

  /**
   * Codex 支持所有 8 个 hook 事件
   */
  readonly hookCapabilities: HookCapabilities = {
    SessionStart: true,
    PreToolUse: true,
    PermissionRequest: true,
    PostToolUse: true,
    Stop: true,
    UserPromptSubmit: true,
    PreCompact: true,
    PostCompact: true,
  };

  constructor(harnessDir: string = ".harness") {
    super("codex-v2", harnessDir);
  }

  /**
   * 初始化 Codex 适配器
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
      supportedHooks: this.getSupportedHooks(),
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

export default CodexAdapterV2;
