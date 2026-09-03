/**
 * Hook Configuration Loader
 *
 * 加载和管理 hook 配置，支持：
 * - 多层配置（全局 + 本地覆盖）
 * - JSON 和 YAML 格式
 * - 配置验证
 * - 配置合并
 *
 * 配置优先级：
 * 1. hooks-config.local.json (git-ignored)
 * 2. hooks-config.json (shared)
 * 3. 默认值
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// ─── Type Definitions ───────────────────────────────────────────────

export interface HookHandlerConfig {
  type: "shell" | "javascript" | "python";
  command?: string;
  statusMessage?: string;
  timeout?: number; // milliseconds
  priority?: number;
  retryCount?: number;
}

export interface HookConfig {
  hooks: Record<string, HookHandlerConfig[]>;
}

export interface HookFeatureFlags {
  disableSessionStartHook?: boolean;
  disablePreToolUseHook?: boolean;
  disablePermissionRequestHook?: boolean;
  disablePostToolUseHook?: boolean;
  disableStopHook?: boolean;
  disableUserPromptSubmitHook?: boolean;
  disablePreCompactHook?: boolean;
  disablePostCompactHook?: boolean;
  disableLogging?: boolean;
}

export interface HookConfigFull extends HookConfig, HookFeatureFlags {}

// ─── Default Configurations ─────────────────────────────────────────

const DEFAULT_HOOKS: HookConfig = {
  hooks: {
    SessionStart: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs session-start",
        statusMessage: "Initializing session hooks...",
        timeout: 10000,
        priority: 100,
      },
    ],
    PreToolUse: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs pre-tool-use",
        statusMessage: "Running pre-tool-use hook...",
        timeout: 10000,
        priority: 100,
      },
    ],
    PermissionRequest: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs permission-request",
        statusMessage: "Requesting permission...",
        timeout: 30000,
        priority: 100,
      },
    ],
    PostToolUse: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs post-tool-use",
        statusMessage: "Running post-tool-use hook...",
        timeout: 10000,
        priority: 100,
      },
    ],
    Stop: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs stop",
        statusMessage: "Running session stop hook...",
        timeout: 10000,
        priority: 100,
      },
    ],
    UserPromptSubmit: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs user-prompt-submit",
        statusMessage: "Processing user prompt...",
        timeout: 10000,
        priority: 100,
      },
    ],
    PreCompact: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs pre-compact",
        statusMessage: "Running pre-compact hook...",
        timeout: 10000,
        priority: 100,
      },
    ],
    PostCompact: [
      {
        type: "shell",
        command: "node .harness/hooks/handler.mjs post-compact",
        statusMessage: "Running post-compact hook...",
        timeout: 10000,
        priority: 100,
      },
    ],
  },
};

const DEFAULT_FEATURE_FLAGS: HookFeatureFlags = {
  disableSessionStartHook: false,
  disablePreToolUseHook: false,
  disablePermissionRequestHook: false,
  disablePostToolUseHook: false,
  disableStopHook: false,
  disableUserPromptSubmitHook: false,
  disablePreCompactHook: false,
  disablePostCompactHook: false,
  disableLogging: false,
};

// ─── Hook Configuration Loader ──────────────────────────────────────

export class HookConfigurationLoader {
  private harnessDir: string;
  private config: HookConfigFull | null = null;

  constructor(harnessDir: string = ".harness") {
    this.harnessDir = harnessDir;
  }

  /**
   * Load hook configuration from files
   *
   * Priority:
   * 1. .harness/hooks/config/hooks-config.local.json (personal override)
   * 2. .harness/hooks/config/hooks-config.json (shared)
   * 3. .harness/hooks.json (legacy)
   * 4. Default configuration
   */
  async load(): Promise<HookConfigFull> {
    if (this.config) {
      return this.config;
    }

    let config: HookConfigFull = {
      ...DEFAULT_HOOKS,
      ...DEFAULT_FEATURE_FLAGS,
    };

    // Load shared config
    const sharedConfigPath = path.join(
      this.harnessDir,
      "hooks",
      "config",
      "hooks-config.json",
    );
    if (fs.existsSync(sharedConfigPath)) {
      const sharedConfig = this.loadJSON(sharedConfigPath);
      config = this.mergeConfigs(config, sharedConfig);
    }

    // Load hooks.json (legacy)
    const legacyHooksPath = path.join(this.harnessDir, "hooks.json");
    if (fs.existsSync(legacyHooksPath)) {
      const legacyConfig = this.loadJSON(legacyHooksPath);
      config = this.mergeConfigs(config, legacyConfig);
    }

    // Load local override (personal)
    const localConfigPath = path.join(
      this.harnessDir,
      "hooks",
      "config",
      "hooks-config.local.json",
    );
    if (fs.existsSync(localConfigPath)) {
      const localConfig = this.loadJSON(localConfigPath);
      config = this.mergeConfigs(config, localConfig);
    }

    // Validate
    this.validate(config);

    this.config = config;
    return config;
  }

  /**
   * Get handlers for a specific hook event (respecting feature flags)
   */
  async getHandlers(hookName: string): Promise<HookHandlerConfig[]> {
    const config = await this.load();

    // Check if hook is disabled
    const disableFlagKey = `disable${hookName}Hook` as keyof HookFeatureFlags;
    if (config[disableFlagKey] === true) {
      return [];
    }

    return config.hooks[hookName] ?? [];
  }

  /**
   * Enable/disable a specific hook
   */
  async setHookEnabled(hookName: string, enabled: boolean): Promise<void> {
    const config = await this.load();
    const disableFlagKey = `disable${hookName}Hook` as keyof HookFeatureFlags;
    config[disableFlagKey] = !enabled;

    // Save to local override file
    const localConfigPath = path.join(
      this.harnessDir,
      "hooks",
      "config",
      "hooks-config.local.json",
    );
    fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
    fs.writeFileSync(
      localConfigPath,
      JSON.stringify({ [disableFlagKey]: !enabled }, null, 2),
      "utf-8",
    );
  }

  /**
   * Get all available hook names
   */
  async getAvailableHooks(): Promise<string[]> {
    const config = await this.load();
    return Object.keys(config.hooks);
  }

  /**
   * Reload configuration (clear cache)
   */
  reload(): void {
    this.config = null;
  }

  // ─── Private Methods ────────────────────────────────────────────

  private loadJSON(filePath: string): any {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load config from ${filePath}: ${error}`);
    }
  }

  private loadYAML(filePath: string): any {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return yaml.load(content);
    } catch (error) {
      throw new Error(`Failed to load YAML config from ${filePath}: ${error}`);
    }
  }

  private mergeConfigs(base: any, override: any): any {
    if (!override) {
      return base;
    }

    const result = { ...base };

    // Merge hooks object
    if (override.hooks) {
      result.hooks = {
        ...result.hooks,
        ...override.hooks,
      };
    }

    // Merge feature flags
    for (const key of Object.keys(override)) {
      if (key !== "hooks") {
        result[key] = override[key];
      }
    }

    return result;
  }

  private validate(config: HookConfigFull): void {
    if (!config.hooks || typeof config.hooks !== "object") {
      throw new Error("Invalid config: missing or invalid 'hooks' field");
    }

    for (const [hookName, handlers] of Object.entries(config.hooks)) {
      if (!Array.isArray(handlers)) {
        throw new Error(`Invalid config: hooks.${hookName} must be an array`);
      }

      for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];
        if (!handler.type) {
          throw new Error(
            `Invalid handler in hooks.${hookName}[${i}]: missing 'type' field`,
          );
        }
        if (!["shell", "javascript", "python"].includes(handler.type)) {
          throw new Error(`Invalid handler type: ${handler.type}`);
        }
        if (handler.type !== "javascript" && !handler.command) {
          throw new Error(
            `Invalid handler in hooks.${hookName}[${i}]: missing 'command' field for type '${handler.type}'`,
          );
        }
      }
    }
  }
}

// ─── Exports ────────────────────────────────────────────────────────

export default HookConfigurationLoader;
