/**
 * Demo — Multi-Runtime Closed Loop
 *
 * Demonstrates the complete event → policy → decision → feedback loop
 * across all 6 agent runtime adapters.
 *
 * Run: pnpm demo
 */

import {
  AgentRuntime,
  ClaudeCodeAdapter,
  QoderAdapter,
  CodexAdapter,
  CopilotAdapter,
  TraeAdapter,
  CursorAdapter,
  protectedFilesPolicy,
  mcpSafetyPolicy,
  gitSafetyPolicy,
  qualityGatePolicy,
  createEventId,
  createCorrelationId,
  type BaseHookInput,
} from "./index.js";

// ─── Helpers ────────────────────────────────────────────────────────

function divider(title: string): void {
  console.log("");
  console.log("═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
  console.log("");
}

function scenario(name: string): void {
  console.log(`\n▸ ${name}`);
  console.log("─".repeat(50));
}

// ─── Main Demo ──────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Agent Runtime — Multi-Runtime Closed Loop Demo        ║");
  console.log("║   6 Adapters → Unified Events → Policy → Decision       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // 1. Create the runtime
  const runtime = new AgentRuntime({ debug: false });

  // 2. Create all 6 adapters
  const claude = new ClaudeCodeAdapter();
  const qoder = new QoderAdapter();
  const codex = new CodexAdapter();
  const copilot = new CopilotAdapter();
  const trae = new TraeAdapter();
  const cursor = new CursorAdapter();

  // Attach all to the same runtime
  claude.attachRuntime(runtime);
  qoder.attachRuntime(runtime);
  codex.attachRuntime(runtime);
  copilot.attachRuntime(runtime);
  trae.attachRuntime(runtime);
  cursor.attachRuntime(runtime);

  // Register adapters
  runtime.registerAdapter(claude);
  runtime.registerAdapter(qoder);
  runtime.registerAdapter(codex);
  runtime.registerAdapter(copilot);
  runtime.registerAdapter(trae);
  runtime.registerAdapter(cursor);

  // 3. Load policies
  runtime.loadPolicy(protectedFilesPolicy);
  runtime.loadPolicy(mcpSafetyPolicy);
  runtime.loadPolicy(gitSafetyPolicy);
  runtime.loadPolicy(qualityGatePolicy);

  // 4. Start runtime
  await runtime.start();

  // ═══════════════════════════════════════════════════════════════════
  // PART 1: Same scenario across all 6 adapters
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 1: Agent tries to modify .env — across all 6 runtimes");

  const adapters = [
    { name: "Claude Code", adapter: claude, fileTools: ["Write", "Edit", "MultiEdit"] },
    { name: "Qoder", adapter: qoder, fileTools: ["Write", "SearchReplace"] },
    { name: "Codex CLI", adapter: codex, fileTools: ["shell_write_file", "shell_edit_file"] },
    { name: "Copilot", adapter: copilot, fileTools: ["write_file", "edit_file"] },
    { name: "Trae", adapter: trae, fileTools: ["write_file", "edit_file"] },
    { name: "Cursor", adapter: cursor, fileTools: ["write_file", "edit_file"] },
  ];

  for (const { name, adapter, fileTools } of adapters) {
    scenario(`${name}: ${fileTools[0]} tool on .env`);
    const input: BaseHookInput = {
      session_id: "demo-session",
      hook_event_name: "PreToolUse",
      cwd: "/project",
      tool_name: fileTools[0],
      tool_input: {
        file_path: "/project/.env",
        content: "DATABASE_URL=postgres://...",
      },
      tool_use_id: "tool_001",
    };
    const result = await adapter.handlePreToolUse(input);
    console.log(`  Decision: ${result.decision}`);
    if (result.reason) console.log(`  Reason: ${result.reason}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 2: MCP safety across runtimes
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 2: Agent tries MCP database write — across all 6 runtimes");

  const mcpTests = [
    { name: "Claude Code", adapter: claude, mcpTool: "mcp__database__write" },
    { name: "Qoder", adapter: qoder, mcpTool: "mcp_database_write" },
    { name: "Codex CLI", adapter: codex, mcpTool: "mcp__database__write" },
    { name: "Copilot", adapter: copilot, mcpTool: "mcp__database__write" },
    { name: "Trae", adapter: trae, mcpTool: "mcp__database__write" },
    { name: "Cursor", adapter: cursor, mcpTool: "mcp__database__write" },
  ];

  for (const { name, adapter, mcpTool } of mcpTests) {
    scenario(`${name}: ${mcpTool}`);
    const input: BaseHookInput = {
      session_id: "demo-session",
      hook_event_name: "PreToolUse",
      cwd: "/project",
      tool_name: mcpTool,
      tool_input: { query: "INSERT INTO users ..." },
      tool_use_id: "tool_002",
    };
    const result = await adapter.handlePreToolUse(input);
    console.log(`  Decision: ${result.decision}`);
    if (result.reason) console.log(`  Reason: ${result.reason}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 3: Git safety (force push)
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 3: Agent tries git push --force — across all 6 runtimes");

  const gitTests = [
    { name: "Claude Code", adapter: claude, bashTool: "Bash" },
    { name: "Qoder", adapter: qoder, bashTool: "Bash" },
    { name: "Codex CLI", adapter: codex, bashTool: "shell" },
    { name: "Copilot", adapter: copilot, bashTool: "terminal" },
    { name: "Trae", adapter: trae, bashTool: "terminal" },
    { name: "Cursor", adapter: cursor, bashTool: "terminal" },
  ];

  for (const { name, adapter, bashTool } of gitTests) {
    scenario(`${name}: ${bashTool} with force push`);
    const input: BaseHookInput = {
      session_id: "demo-session",
      hook_event_name: "PreToolUse",
      cwd: "/project",
      tool_name: bashTool,
      tool_input: { command: "git push --force origin main" },
      tool_use_id: "tool_003",
    };
    const result = await adapter.handlePreToolUse(input);
    console.log(`  Decision: ${result.decision}`);
    if (result.reason) console.log(`  Reason: ${result.reason}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 4: Normal file modification (should ALLOW everywhere)
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 4: Normal source file modification — should ALLOW");

  for (const { name, adapter, fileTools } of adapters) {
    scenario(`${name}: ${fileTools[0]} on src/App.tsx`);
    const input: BaseHookInput = {
      session_id: "demo-session",
      hook_event_name: "PreToolUse",
      cwd: "/project",
      tool_name: fileTools[0],
      tool_input: {
        file_path: "/project/src/App.tsx",
        content: "export default function App() { return <div>Hello</div> }",
      },
      tool_use_id: "tool_004",
    };
    const result = await adapter.handlePreToolUse(input);
    console.log(`  Decision: ${result.decision}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 5: Quality gate (task completion without tests)
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 5: Quality gate — task completion without tests");

  scenario("task.before_complete with testPassed=false");
  const qualityResult = await runtime.processEvent({
    id: createEventId(),
    name: "task.before_complete",
    category: "task",
    timestamp: new Date().toISOString(),
    source: "multi-runtime",
    correlationId: createCorrelationId(),
    payload: {
      summary: "Implemented feature X",
      testPassed: false,
    },
  });
  console.log(`  Final Action: ${qualityResult.finalAction}`);
  if (qualityResult.feedbackMessages.length > 0) {
    console.log(`  Feedback: ${qualityResult.feedbackMessages.join("; ")}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 6: Capability Matrix comparison
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 6: Capability Matrix — all 6 adapters");

  const matrix = runtime.getCapabilityMatrix();

  // Collect all unique event names
  const allEvents = new Set<string>();
  for (const caps of matrix.values()) {
    for (const cap of caps) {
      allEvents.add(cap.event);
    }
  }

  // Print header
  const adapterNames = ["claude-code", "qoder", "codex", "copilot", "trae"];
  const colWidth = 14;
  const eventWidth = 24;

  let header = "  " + "Event".padEnd(eventWidth);
  for (const name of adapterNames) {
    header += name.padEnd(colWidth);
  }
  console.log(header);
  console.log("  " + "─".repeat(eventWidth + colWidth * adapterNames.length));

  // Print each event row
  for (const eventName of [...allEvents].sort()) {
    let row = "  " + eventName.padEnd(eventWidth);
    for (const adapterName of adapterNames) {
      const caps = matrix.get(adapterName);
      const cap = caps?.find((c) => c.event === eventName);
      if (!cap) {
        row += "—".padEnd(colWidth);
      } else {
        const icon = cap.support === "native" ? "✓ native" : cap.support === "emulated" ? "~ emulated" : "✗ unsup";
        row += icon.padEnd(colWidth);
      }
    }
    console.log(row);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 7: Event Trace
  // ═══════════════════════════════════════════════════════════════════

  divider("Part 7: Event Trace (last 15 entries)");

  const trace = runtime.getTrace();
  const recentTrace = trace.slice(-15);

  console.log("  Time        Action  Event                  Source");
  console.log("  " + "─".repeat(65));

  for (const entry of recentTrace) {
    const time = new Date(entry.event.timestamp).toISOString().slice(11, 23);
    const action = entry.pipelineResult.finalAction.toUpperCase().padEnd(6);
    const event = entry.event.name.padEnd(22);
    const source = entry.event.source;
    console.log(`  ${time}  ${action}  ${event}  ${source}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════

  divider("Summary");

  const allTrace = runtime.getTrace();
  const denied = allTrace.filter((t) => t.pipelineResult.finalAction === "deny");
  const warned = allTrace.filter((t) => t.pipelineResult.finalAction === "warn");
  const allowed = allTrace.filter((t) => t.pipelineResult.finalAction === "allow");

  console.log(`  Adapters registered:  5 (claude-code, qoder, codex, copilot, trae)`);
  console.log(`  Policies loaded:      4 (protected-files, mcp-safety, git-safety, quality-gate)`);
  console.log(`  Total events:         ${allTrace.length}`);
  console.log(`  Allowed:              ${allowed.length}`);
  console.log(`  Warned:               ${warned.length}`);
  console.log(`  Denied:               ${denied.length}`);
  console.log("");
  console.log("  ✓ Multi-runtime closed loop demonstrated:");
  console.log("    5 Adapters → Unified Events → Policy Engine → Decision → Feedback");
  console.log("");

  await runtime.stop();
}

main().catch(console.error);
