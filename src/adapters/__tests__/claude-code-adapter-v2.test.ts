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

  it("should support 31 hooks (v2.1.233+)", async () => {
    const supported = await adapter.getSupportedHooks();
    expect(supported).toHaveLength(31);

    // Session hooks
    expect(supported).toContain("SessionStart");
    expect(supported).toContain("Setup");
    expect(supported).toContain("SessionEnd");
    // Turn hooks
    expect(supported).toContain("UserPromptSubmit");
    expect(supported).toContain("UserPromptExpansion");
    expect(supported).toContain("Stop");
    expect(supported).toContain("StopFailure");
    // Tool hooks
    expect(supported).toContain("PreToolUse");
    expect(supported).toContain("PostToolUse");
    expect(supported).toContain("PostToolUseFailure");
    expect(supported).toContain("PostToolBatch");
    // Permission hooks
    expect(supported).toContain("PermissionRequest");
    expect(supported).toContain("PermissionDenied");
    // Subagent hooks
    expect(supported).toContain("SubagentStart");
    expect(supported).toContain("SubagentStop");
    // Task hooks
    expect(supported).toContain("TaskCreated");
    expect(supported).toContain("TaskCompleted");
    // Compact hooks
    expect(supported).toContain("PreCompact");
    expect(supported).toContain("PostCompact");
    // File/Dir hooks
    expect(supported).toContain("CwdChanged");
    expect(supported).toContain("FileChanged");
    expect(supported).toContain("DirectoryAdded");
    // Worktree hooks
    expect(supported).toContain("WorktreeCreate");
    expect(supported).toContain("WorktreeRemove");
    // Other hooks
    expect(supported).toContain("Notification");
    expect(supported).toContain("MessageDisplay");
    expect(supported).toContain("TeammateIdle");
    expect(supported).toContain("ConfigChange");
    expect(supported).toContain("InstructionsLoaded");
    expect(supported).toContain("Elicitation");
    expect(supported).toContain("ElicitationResult");
  });

  it("should include all 12 blocking hooks", async () => {
    const supported = await adapter.getSupportedHooks();
    const blockingHooks = [
      "PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch",
      "PermissionRequest", "SubagentStop", "TaskCreated", "TaskCompleted",
      "Stop", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay",
    ];
    for (const hook of blockingHooks) {
      expect(supported).toContain(hook);
    }
  });

  it("should get health status", async () => {
    const health = await adapter.getHealthStatus();
    expect(health.healthy).toBe(true);
    expect(health.version).toBe("2.0.0");
    expect(health.hooks).toHaveLength(31);
  });

  it("should export metrics", async () => {
    const metrics = await adapter.exportMetrics();
    expect(metrics.adapter).toBe("claude-code-v2");
    expect(metrics.capabilities).toBeDefined();
    expect(metrics.statistics).toBeDefined();
  });
});
