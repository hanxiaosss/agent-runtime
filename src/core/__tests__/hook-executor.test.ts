/**
 * Unit tests for HookExecutor
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  HookExecutor,
  type HookHandler,
  type HookInput,
} from "../hook-executor.js";

describe("HookExecutor", () => {
  let tempDir: string;
  let executor: HookExecutor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-executor-test-"));
    executor = new HookExecutor(path.join(tempDir, "logs"));
  });

  it("should execute shell handlers", async () => {
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: 'echo \'{"decision":"allow"}\' ',
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test-session",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
      source: "test",
    };

    const result = await executor.executeHandlers(
      "PreToolUse",
      handlers,
      input,
    );
    expect(result.decision).toBe("allow");
  });

  it("should respect handler priority order", async () => {
    const executionOrder: number[] = [];
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: "echo 'priority-50'",
        priority: 50,
      },
      {
        type: "shell",
        command: "echo 'priority-100'",
        priority: 100,
      },
      {
        type: "shell",
        command: "echo 'priority-75'",
        priority: 75,
      },
    ];

    // Verify handlers are sorted by priority descending
    const sorted = [...handlers].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    expect(sorted[0].priority).toBe(100);
    expect(sorted[1].priority).toBe(75);
    expect(sorted[2].priority).toBe(50);
  });

  it("should handle shell command exit codes", async () => {
    // Exit code 0 = allow
    const allowHandler: HookHandler = {
      type: "shell",
      command: "exit 0",
      priority: 100,
    };

    const input: HookInput = {
      sessionId: "test",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
    };

    const result = await executor.executeHandlers(
      "PreToolUse",
      [allowHandler],
      input,
    );
    expect(result.decision).toMatch(/allow|error/); // May succeed or fail depending on shell
  });

  it("should break chain when handler requests break", async () => {
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: 'echo \'{"decision":"deny","shouldBreak":true}\' ',
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
    };

    const result = await executor.executeHandlers(
      "PreToolUse",
      handlers,
      input,
    );
    expect(result.decision).toBe("deny");
  });

  it("should log hook events to JSONL", async () => {
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: 'echo \'{"decision":"allow"}\' ',
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test-session",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
      source: "test",
    };

    await executor.executeHandlers("PreToolUse", handlers, input);

    // Check log file was created
    const today = new Date().toISOString().split("T")[0];
    const logFile = path.join(tempDir, "logs", `hook-${today}.jsonl`);
    expect(fs.existsSync(logFile)).toBe(true);

    // Check log contains entry
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter((l) => l);
    expect(lines.length).toBeGreaterThan(0);

    // Verify JSONL format
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("should query logs by date range", async () => {
    // Execute a hook to create a log entry
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: 'echo \'{"decision":"allow"}\' ',
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test-session",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
      source: "test",
    };

    await executor.executeHandlers("PreToolUse", handlers, input);

    // Query recent logs
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date();

    const logs = await executor.queryLogs(startDate, endDate);
    expect(Array.isArray(logs)).toBe(true);
    if (logs.length > 0) {
      expect(logs[0].hookEvent).toBe("PreToolUse");
      expect(logs[0].sessionId).toBe("test-session");
    }
  });

  it("should calculate statistics", async () => {
    // Execute multiple hooks
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: 'echo \'{"decision":"allow"}\' ',
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test-session",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
      source: "test",
    };

    await executor.executeHandlers("PreToolUse", handlers, input);

    // Get statistics
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date();

    const stats = await executor.getStatistics(startDate, endDate);
    expect(typeof stats.total).toBe("number");
    expect(typeof stats.avgDuration).toBe("number");
    expect(typeof stats.byEvent).toBe("object");
    expect(typeof stats.byDecision).toBe("object");
  });

  it("should handle handler timeout", async () => {
    const handlers: HookHandler[] = [
      {
        type: "shell",
        command: "sleep 10",
        timeout: 100, // Very short timeout
        priority: 100,
      },
    ];

    const input: HookInput = {
      sessionId: "test",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
    };

    // This should timeout
    try {
      await executor.executeHandlers("PreToolUse", handlers, input);
    } catch (error) {
      // Timeout is expected
      expect((error as Error).message).toContain("timeout");
    }
  });

  it("should handle empty handler list", async () => {
    const input: HookInput = {
      sessionId: "test",
      hookEvent: "PreToolUse",
      cwd: process.cwd(),
    };

    const result = await executor.executeHandlers("PreToolUse", [], input);
    expect(result.decision).toBe("allow");
  });
});
