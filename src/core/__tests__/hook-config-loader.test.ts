/**
 * Unit tests for HookConfigurationLoader
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  HookConfigurationLoader,
  type HookConfig,
} from "../hook-config-loader.js";

describe("HookConfigurationLoader", () => {
  let tempDir: string;
  let loader: HookConfigurationLoader;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-config-test-"));
    loader = new HookConfigurationLoader(tempDir);
  });

  it("should load default configuration", async () => {
    const config = await loader.load();

    expect(config.hooks).toBeDefined();
    expect(Object.keys(config.hooks).length).toBeGreaterThan(0);
  });

  it("should support all 8 hook types", async () => {
    const config = await loader.load();

    const expectedHooks = [
      "SessionStart",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
      "UserPromptSubmit",
      "PreCompact",
      "PostCompact",
    ];

    for (const hookName of expectedHooks) {
      expect(config.hooks[hookName]).toBeDefined();
      expect(Array.isArray(config.hooks[hookName])).toBe(true);
    }
  });

  it("should load shared configuration file", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    const sharedConfig: HookConfig = {
      hooks: {
        PreToolUse: [
          {
            type: "shell",
            command: "echo 'shared'",
            priority: 100,
          },
        ],
      } as any,
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.json"),
      JSON.stringify(sharedConfig),
      "utf-8",
    );

    const config = await loader.load();
    expect(config.hooks.PreToolUse).toBeDefined();
  });

  it("should respect local override configuration", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    // Create local override
    const localConfig = {
      disablePreToolUseHook: true,
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.local.json"),
      JSON.stringify(localConfig),
      "utf-8",
    );

    const config = await loader.load();
    expect(config.disablePreToolUseHook).toBe(true);
  });

  it("should get handlers for specific hook", async () => {
    const handlers = await loader.getHandlers("PreToolUse");
    expect(Array.isArray(handlers)).toBe(true);
  });

  it("should return empty array for disabled hooks", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    const localConfig = {
      disablePreToolUseHook: true,
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.local.json"),
      JSON.stringify(localConfig),
      "utf-8",
    );

    // Reload to pick up new config
    loader.reload();
    const handlers = await loader.getHandlers("PreToolUse");
    expect(handlers.length).toBe(0);
  });

  it("should enable/disable hooks", async () => {
    // Disable hook
    await loader.setHookEnabled("PreToolUse", false);

    // Verify it's disabled
    loader.reload();
    let handlers = await loader.getHandlers("PreToolUse");
    expect(handlers.length).toBe(0);

    // Enable hook
    await loader.setHookEnabled("PreToolUse", true);

    // Verify it's enabled
    loader.reload();
    handlers = await loader.getHandlers("PreToolUse");
    expect(handlers.length).toBeGreaterThan(0);
  });

  it("should list available hooks", async () => {
    const hooks = await loader.getAvailableHooks();
    expect(Array.isArray(hooks)).toBe(true);
    expect(hooks.length).toBe(8);
  });

  it("should cache loaded configuration", async () => {
    const config1 = await loader.load();
    const config2 = await loader.load();
    expect(config1).toBe(config2);
  });

  it("should reload configuration on demand", async () => {
    const config1 = await loader.load();

    loader.reload();

    const config2 = await loader.load();
    expect(config1).not.toBe(config2);
    expect(config1.hooks).toEqual(config2.hooks);
  });

  it("should validate configuration", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    // Invalid: missing 'type' field
    const invalidConfig = {
      hooks: {
        PreToolUse: [
          {
            command: "echo 'test'",
          },
        ],
      },
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.json"),
      JSON.stringify(invalidConfig),
      "utf-8",
    );

    loader.reload();

    expect(async () => {
      await loader.load();
    }).rejects.toThrow();
  });

  it("should merge configurations correctly", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    // Create shared config with custom timeout
    const sharedConfig = {
      hooks: {
        PreToolUse: [
          {
            type: "shell",
            command: "echo 'custom'",
            timeout: 5000,
            priority: 50,
          },
        ],
      },
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.json"),
      JSON.stringify(sharedConfig),
      "utf-8",
    );

    const config = await loader.load();
    const handlers = config.hooks.PreToolUse;

    // Should merge with defaults
    expect(handlers).toBeDefined();
  });

  it("should handle missing configuration files gracefully", async () => {
    // No config files created, should use defaults
    const config = await loader.load();
    expect(config.hooks).toBeDefined();
    expect(Object.keys(config.hooks).length).toBeGreaterThan(0);
  });

  it("should support hook handler priority", async () => {
    const configDir = path.join(tempDir, "hooks", "config");
    fs.mkdirSync(configDir, { recursive: true });

    const config = {
      hooks: {
        PreToolUse: [
          {
            type: "shell",
            command: "echo '1'",
            priority: 100,
          },
          {
            type: "shell",
            command: "echo '2'",
            priority: 50,
          },
        ],
      },
    };

    fs.writeFileSync(
      path.join(configDir, "hooks-config.json"),
      JSON.stringify(config),
      "utf-8",
    );

    loader.reload();
    const handlers = await loader.getHandlers("PreToolUse");

    // Should preserve order
    expect(handlers.length).toBe(2);
    expect(handlers[0].priority).toBe(100);
    expect(handlers[1].priority).toBe(50);
  });
});
