import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeCodeAdapterV2 } from "../claude-code-adapter-v2.js";

describe("ClaudeCodeAdapterV2", () => {
  let adapter: ClaudeCodeAdapterV2;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapterV2();
  });

  it("should have correct name", () => {
    expect(adapter.name).toBe("claude-code-v2");
  });

  it("should support 6 hooks", async () => {
    const supported = await adapter.getSupportedHooks();
    expect(supported).toHaveLength(6);
    expect(supported).toContain("SessionStart");
    expect(supported).toContain("PreToolUse");
    expect(supported).toContain("PostToolUse");
    expect(supported).toContain("PermissionRequest");
    expect(supported).toContain("Stop");
    expect(supported).toContain("UserPromptSubmit");
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
    expect(health.hooks).toHaveLength(6);
  });

  it("should export metrics", async () => {
    const metrics = await adapter.exportMetrics();
    expect(metrics.adapter).toBe("claude-code-v2");
    expect(metrics.capabilities).toBeDefined();
    expect(metrics.statistics).toBeDefined();
  });
});
