import { describe, it, expect, beforeEach } from "vitest";
import { CopilotAdapterV2 } from "../copilot-adapter-v2.js";

describe("CopilotAdapterV2", () => {
  let adapter: CopilotAdapterV2;

  beforeEach(() => {
    adapter = new CopilotAdapterV2();
  });

  it("should have correct name", () => {
    expect(adapter.name).toBe("copilot-v2");
  });

  it("should support 5 hooks", async () => {
    const supported = await adapter.getSupportedHooks();
    expect(supported).toHaveLength(5);
    expect(supported).toContain("SessionStart");
    expect(supported).toContain("PreToolUse");
    expect(supported).toContain("PostToolUse");
    expect(supported).toContain("PermissionRequest");
    expect(supported).toContain("Stop");
  });

  it("should not support UserPromptSubmit", async () => {
    const supported = await adapter.getSupportedHooks();
    expect(supported).not.toContain("UserPromptSubmit");
  });

  it("should not support compact hooks", async () => {
    const supported = await adapter.getSupportedHooks();
    expect(supported).not.toContain("PreCompact");
    expect(supported).not.toContain("PostCompact");
  });

  it("should get health status", async () => {
    const health = await adapter.getHealthStatus();
    expect(health.healthy).toBe(true);
    expect(health.version).toBe("2.0.0");
    expect(health.hooks).toHaveLength(5);
  });

  it("should export metrics", async () => {
    const metrics = await adapter.exportMetrics();
    expect(metrics.adapter).toBe("copilot-v2");
    expect(metrics.capabilities).toBeDefined();
    expect(metrics.statistics).toBeDefined();
  });
});
