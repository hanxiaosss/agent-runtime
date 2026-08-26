/**
 * End-to-end test: simulates the handler.mjs flow
 *
 * 1. Load policies from .harness/policies/
 * 2. Create runtime + adapter
 * 3. Process simulated tool calls
 * 4. Write traces to .harness/traces/
 * 5. Verify trace output
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AgentRuntime,
  ClaudeCodeAdapter,
  loadPoliciesFromDir,
} from "./index.js";

const testProject = "E:\\code\\test-project";
const harnessDir = path.join(testProject, ".harness");
const traceDir = path.join(harnessDir, "traces");

async function main() {
  console.log("=== E2E Test: init → hook → trace ===\n");

  // 1. Load policies from YAML
  console.log("1. Loading policies from .harness/policies/ ...");
  const policies = loadPoliciesFromDir(path.join(harnessDir, "policies"));
  console.log(`   Loaded ${policies.length} policies: ${policies.map((p) => p.name).join(", ")}`);

  // 2. Create runtime
  console.log("\n2. Creating runtime ...");
  const runtime = new AgentRuntime({ debug: false });
  for (const policy of policies) {
    runtime.loadPolicy(policy);
  }

  const adapter = new ClaudeCodeAdapter();
  adapter.attachRuntime(runtime);
  runtime.registerAdapter(adapter);
  await runtime.start();

  // 3. Simulate tool calls
  console.log("\n3. Simulating tool calls ...\n");

  const scenarios = [
    {
      name: "Write .env (should DENY)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "Write",
        tool_input: { file_path: "/project/.env", content: "SECRET=123" },
        tool_use_id: "tool_001",
      },
    },
    {
      name: "Write src/App.tsx (should ALLOW)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "Write",
        tool_input: { file_path: "/project/src/App.tsx", content: "export default () => {}" },
        tool_use_id: "tool_002",
      },
    },
    {
      name: "Bash git push --force (should DENY)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "Bash",
        tool_input: { command: "git push --force origin main" },
        tool_use_id: "tool_003",
      },
    },
    {
      name: "MCP database write (should DENY)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "mcp__database__write",
        tool_input: { query: "DELETE FROM users" },
        tool_use_id: "tool_004",
      },
    },
    {
      name: "Edit package-lock.json (should DENY)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "Edit",
        tool_input: { file_path: "/project/package-lock.json" },
        tool_use_id: "tool_005",
      },
    },
    {
      name: "Read src/index.ts (should ALLOW)",
      input: {
        session_id: "test-1",
        hook_event_name: "PreToolUse",
        cwd: "/project",
        tool_name: "Read",
        tool_input: { file_path: "/project/src/index.ts" },
        tool_use_id: "tool_006",
      },
    },
  ];

  // Ensure trace directory exists
  fs.mkdirSync(traceDir, { recursive: true });

  for (const scenario of scenarios) {
    const result = await adapter.handlePreToolUse(scenario.input);
    const action = result.decision === "deny" ? "DENY" : "ALLOW";
    console.log(`   ${action.padEnd(5)} ${scenario.name}`);

    // Write trace entry (simulating what handler.mjs does)
    const traceEntry = {
      timestamp: new Date().toISOString(),
      event: "tool.before",
      source: "claude-code",
      action: result.decision,
      payload: {
        toolName: scenario.input.tool_name,
        input: scenario.input.tool_input,
      },
      feedback: result.reason ? [result.reason] : [],
    };

    const date = new Date().toISOString().slice(0, 10);
    const traceFile = path.join(traceDir, `${date}.jsonl`);
    fs.appendFileSync(traceFile, JSON.stringify(traceEntry) + "\n");
  }

  await runtime.stop();

  // 4. Test trace viewer
  console.log("\n4. Trace output:\n");

  // Import and run trace
  const { runTrace } = await import("./cli/trace.js");
  process.chdir(testProject);
  runTrace([]);

  // 5. Test summary
  console.log("\n5. Summary output:\n");

  const { runSummary } = await import("./cli/summary.js");
  runSummary([]);

  console.log("\n=== E2E Test Complete ===");
}

main().catch(console.error);
