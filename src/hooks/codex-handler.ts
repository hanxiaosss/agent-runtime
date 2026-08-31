/**
 * Codex CLI Hook Handler
 *
 * Standalone entry point for Codex CLI lifecycle hooks.
 * Codex calls this script for PreToolUse / PostToolUse / Stop events.
 *
 * Protocol:
 *   - Receives JSON via stdin: { tool_name, tool_input, tool_output?, ... }
 *   - Communicates decision via exit code:
 *       0 = allow (stderr message shown to agent for warnings)
 *       2 = deny  (stderr message shown to agent as feedback)
 *   - Writes traces to .harness/traces/YYYY-MM-DD.jsonl
 *
 * Configuration: .codex/config.toml
 *   [[hooks.PreToolUse]]
 *   matcher = "*"
 *   command = "node dist/hooks/codex-handler.js pre-tool-use"
 *
 *   [[hooks.PostToolUse]]
 *   matcher = "*"
 *   command = "node dist/hooks/codex-handler.js post-tool-use"
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodexHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: unknown;
  tool_use_id?: string;
  session_id?: string;
  cwd?: string;
  model?: string;
  [key: string]: unknown;
}

interface PolicyRule {
  name: string;
  when: string;
  match: Array<{
    field: string;
    pattern: string | string[];
  }>;
  action: "allow" | "deny" | "warn" | "modify";
  feedback?: string;
  suggestions?: string[];
  modifiedInput?: Record<string, unknown>;
}

interface SemanticRule {
  name: string;
  description?: string;
  match: {
    tool_name?: string[];
    file_path?: string[];
    content?: string[];
    command?: string[];
    mcp_server?: string[];
    mcp_operation?: string[];
    file_type?: string[];
  };
  action: "allow" | "deny" | "warn";
  feedback?: string;
  suggestions?: string[];
  enabled?: boolean;
  reflection_prompt?: string;
}

interface TraceEntry {
  timestamp: string;
  event: string;
  toolName: string;
  decision: string;
  reason: string;
  ruleName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  sessionId?: string;
}

interface HookDecision {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  feedback?: string;
  ruleName?: string;
  suggestions?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEBUG = process.env.HARNESS_DEBUG === "1";
const HARNESS_DIR = findHarnessDir();
const TRACES_DIR = path.join(HARNESS_DIR, "traces");
const POLICIES_DIR = path.join(HARNESS_DIR, "policies");
const SEMANTIC_DIR = path.join(HARNESS_DIR, "semantic-rules");

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const phase = process.argv[2]; // "pre-tool-use" | "post-tool-use" | "stop"
  if (!phase) {
    log("Usage: codex-handler.js <pre-tool-use|post-tool-use|stop>");
    process.exit(1);
  }

  const input = await readStdin();
  log(`[${phase}] tool=${input.tool_name}`);

  // Ensure traces directory exists
  ensureDir(TRACES_DIR);

  if (phase === "pre-tool-use") {
    const result = evaluatePreToolUse(input);
    writeTrace("tool.before", input, result);

    if (result.decision === "deny") {
      const feedback = result.feedback || result.reason || "Blocked by policy";
      process.stderr.write(feedback + "\n");
      if (result.suggestions?.length) {
        process.stderr.write("Suggestions:\n");
        for (const s of result.suggestions) {
          process.stderr.write(`  - ${s}\n`);
        }
      }
      process.exit(2);
    }

    if (result.decision === "warn") {
      const feedback = result.feedback || result.reason || "Warning";
      process.stderr.write(`[WARN] ${feedback}\n`);
      if (result.suggestions?.length) {
        process.stderr.write("Suggestions:\n");
        for (const s of result.suggestions) {
          process.stderr.write(`  - ${s}\n`);
        }
      }
    }

    process.exit(0);
  }

  if (phase === "post-tool-use") {
    writeTrace("tool.after", input, { decision: "allow" });
    process.exit(0);
  }

  if (phase === "stop") {
    const result = evaluateStop(input);
    writeTrace("confirm.before", input, result);

    if (result.decision === "deny") {
      process.stderr.write((result.feedback || result.reason || "Blocked") + "\n");
      process.exit(2);
    }
    process.exit(0);
  }

  log(`Unknown phase: ${phase}`);
  process.exit(1);
}

// ─── Policy Evaluation ────────────────────────────────────────────────────────

function evaluatePreToolUse(input: CodexHookInput): HookDecision {
  const allow: HookDecision = { decision: "allow" };

  // 1. Load and evaluate declarative policies
  const policyResult = evaluatePolicies(input);
  if (policyResult.decision === "deny") return policyResult;

  // 2. Load and evaluate semantic rules
  const semanticResult = evaluateSemanticRules(input);
  if (semanticResult.decision === "deny") return semanticResult;

  // 3. Return the most restrictive result
  if (policyResult.decision === "warn") return policyResult;
  if (semanticResult.decision === "warn") return semanticResult;

  return allow;
}

function evaluateStop(input: CodexHookInput): HookDecision {
  // For stop events, check if any policy blocks completion
  return evaluatePolicies(input, "confirm.before");
}

function evaluatePolicies(
  input: CodexHookInput,
  eventOverride?: string,
): HookDecision {
  const policies = loadPolicies();
  let mostRestrictive: HookDecision = { decision: "allow" };

  for (const policy of policies) {
    for (const rule of policy.rules || []) {
      const eventName = eventOverride || mapPolicyEvent(rule.when);
      if (!matchesEvent(eventName, input)) continue;

      if (matchesRule(rule, input)) {
        const result: HookDecision = {
          decision: rule.action === "modify" ? "warn" : rule.action,
          reason: `Policy rule "${rule.name}" matched`,
          feedback: rule.feedback,
          ruleName: rule.name,
          suggestions: rule.suggestions,
        };

        if (priority(result) > priority(mostRestrictive)) {
          mostRestrictive = result;
        }
        if (mostRestrictive.decision === "deny") return mostRestrictive;
      }
    }
  }

  return mostRestrictive;
}

function evaluateSemanticRules(input: CodexHookInput): HookDecision {
  const rules = loadSemanticRules();
  let mostRestrictive: HookDecision = { decision: "allow" };

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (matchesSemanticRule(rule, input)) {
      // Check for reflection_prompt (zero-cost agent self-analysis)
      if (rule.reflection_prompt) {
        const result: HookDecision = {
          decision: "deny",
          reason: `Semantic rule "${rule.name}" requires reflection`,
          feedback: `[REFLECTION_REQUIRED] ${rule.reflection_prompt}`,
          ruleName: rule.name,
          suggestions: rule.suggestions,
        };
        return result;
      }

      const result: HookDecision = {
        decision: rule.action,
        reason: `Semantic rule "${rule.name}" matched`,
        feedback: rule.feedback,
        ruleName: rule.name,
        suggestions: rule.suggestions,
      };

      if (priority(result) > priority(mostRestrictive)) {
        mostRestrictive = result;
      }
      if (mostRestrictive.decision === "deny") return mostRestrictive;
    }
  }

  return mostRestrictive;
}

// ─── Rule Matching ────────────────────────────────────────────────────────────

function matchesEvent(eventName: string, input: CodexHookInput): boolean {
  // All pre-tool-use events match tool.before / tool.before_modify
  if (eventName === "tool.before" || eventName === "code.before_modify") {
    return true;
  }
  return true; // Default: evaluate all rules
}

function mapPolicyEvent(when: string): string {
  const eventMap: Record<string, string> = {
    "tool.before": "tool.before",
    "tool.after": "tool.after",
    "code.before_modify": "code.before_modify",
    "code.after_modify": "code.after_modify",
    "mcp.before": "mcp.before",
    "mcp.after": "mcp.after",
    "confirm.before": "confirm.before",
  };
  return eventMap[when] || when;
}

function matchesRule(rule: PolicyRule, input: CodexHookInput): boolean {
  for (const condition of rule.match) {
    const value = resolveField(condition.field, input);
    const patterns = Array.isArray(condition.pattern)
      ? condition.pattern
      : [condition.pattern];

    const matched = patterns.some((p) => matchPattern(String(value ?? ""), p));
    if (!matched) return false;
  }
  return true;
}

function matchesSemanticRule(rule: SemanticRule, input: CodexHookInput): boolean {
  const m = rule.match;
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || "");
  const filePath = String(
    toolInput.file_path || toolInput.path || toolInput.file || "",
  );
  const content = String(toolInput.content || toolInput.text || "");

  // All specified dimensions must match (AND logic)
  if (m.tool_name?.length && !m.tool_name.some((p) => matchGlob(toolName, p))) {
    return false;
  }
  if (m.command?.length && !m.command.some((p) => matchPattern(command, p))) {
    return false;
  }
  if (m.file_path?.length && !m.file_path.some((p) => matchGlob(filePath, p))) {
    return false;
  }
  if (m.content?.length && !m.content.some((c) => content.includes(c))) {
    return false;
  }
  if (m.file_type?.length) {
    const ext = path.extname(filePath).replace(".", "");
    if (!m.file_type.some((t) => ext === t || `.${ext}` === t)) return false;
  }
  if (m.mcp_server?.length) {
    const isMcp = toolName.startsWith("mcp__") || toolName.startsWith("mcp_");
    if (!isMcp) return false;
    const parts = toolName.split("__");
    const server = parts.length >= 2 ? parts[1] : "";
    if (!m.mcp_server.some((p) => matchGlob(server, p))) return false;
  }

  return true;
}

function resolveField(field: string, input: CodexHookInput): unknown {
  const parts = field.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchPattern(value: string, pattern: string): boolean {
  if (pattern.includes("*") || pattern.includes("?")) {
    return matchGlob(value, pattern);
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

function matchGlob(value: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "{{GLOBSTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\{\{GLOBSTAR\}\}/g, ".*") +
      "$",
    "i",
  );
  return regex.test(value);
}

// ─── YAML Loader (minimal, no external deps) ─────────────────────────────────

interface PolicyFile {
  name?: string;
  description?: string;
  rules: PolicyRule[];
}

function loadPolicies(): PolicyFile[] {
  const policies: PolicyFile[] = [];
  if (!fs.existsSync(POLICIES_DIR)) return policies;

  const files = fs.readdirSync(POLICIES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(POLICIES_DIR, file), "utf-8");
      const parsed = parseSimpleYaml(content);
      if (parsed.rules) {
        policies.push(parsed as PolicyFile);
      }
    } catch (err: any) {
      log(`Failed to load policy ${file}: ${err.message}`);
    }
  }
  return policies;
}

function loadSemanticRules(): SemanticRule[] {
  const rules: SemanticRule[] = [];
  if (!fs.existsSync(SEMANTIC_DIR)) return rules;

  const files = fs.readdirSync(SEMANTIC_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(SEMANTIC_DIR, file), "utf-8");
      const parsed = parseSimpleYaml(content);
      if (parsed.rules && Array.isArray(parsed.rules)) {
        rules.push(...(parsed.rules as SemanticRule[]));
      }
    } catch (err: any) {
      log(`Failed to load semantic rules ${file}: ${err.message}`);
    }
  }
  return rules;
}

/**
 * Minimal YAML parser for policy files.
 * Handles the specific structure used by policy YAML:
 *   - Top-level scalar fields (name, description)
 *   - rules: array of objects with nested fields
 *   - Supports: strings, arrays (inline [a, b] and block - item), booleans
 */
function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    // Top-level key
    const topMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (topMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      const key = topMatch[1];
      const value = topMatch[2].trim();

      if (value === "") {
        // Could be a block array or nested object
        i++;
        const blockResult = parseBlock(lines, i, 0);
        result[key] = blockResult.value;
        i = blockResult.nextIndex;
      } else {
        result[key] = parseYamlValue(value);
        i++;
      }
    } else {
      i++;
    }
  }

  return result;
}

function parseBlock(
  lines: string[],
  startIndex: number,
  parentIndent: number,
): { value: any; nextIndex: number } {
  let i = startIndex;

  // Skip empty/comment lines to find the first content line
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("#")) break;
    i++;
  }

  if (i >= lines.length) return { value: null, nextIndex: i };

  const firstLine = lines[i];
  const firstIndent = getIndent(firstLine);
  if (firstIndent <= parentIndent) return { value: null, nextIndex: i };

  const firstTrimmed = firstLine.trim();

  // Array of objects (e.g., rules: - name: ...)
  if (firstTrimmed.startsWith("- ")) {
    const items: any[] = [];
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      const indent = getIndent(lines[i]);

      if (!trimmed || trimmed.startsWith("#")) {
        i++;
        continue;
      }
      if (indent < firstIndent) break;

      if (trimmed.startsWith("- ")) {
        const itemResult = parseArrayItem(lines, i, indent);
        items.push(itemResult.value);
        i = itemResult.nextIndex;
      } else {
        break;
      }
    }
    return { value: items, nextIndex: i };
  }

  // Nested object
  const obj: Record<string, any> = {};
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const indent = getIndent(lines[i]);

    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indent < firstIndent) break;

    const keyMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === "") {
        i++;
        const blockResult = parseBlock(lines, i, indent);
        obj[key] = blockResult.value;
        i = blockResult.nextIndex;
      } else {
        obj[key] = parseYamlValue(value);
        i++;
      }
    } else {
      i++;
    }
  }
  return { value: obj, nextIndex: i };
}

function parseArrayItem(
  lines: string[],
  startIndex: number,
  itemIndent: number,
): { value: any; nextIndex: number } {
  let i = startIndex;
  const firstLine = lines[i].trim();

  // Simple array item: - value
  const simpleMatch = firstLine.match(/^-\s+(.+)$/);
  if (!simpleMatch) return { value: null, nextIndex: i + 1 };

  const afterDash = simpleMatch[1].trim();

  // Check if it's a key-value pair: - key: value
  const kvMatch = afterDash.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
  if (!kvMatch) {
    return { value: parseYamlValue(afterDash), nextIndex: i + 1 };
  }

  // It's an object starting on the same line as the dash
  const obj: Record<string, any> = {};
  obj[kvMatch[1]] = kvMatch[2].trim() === "" ? null : parseYamlValue(kvMatch[2].trim());
  i++;

  // Continue reading object properties at deeper indent
  const propIndent = itemIndent + 2; // Properties are indented relative to the dash
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const indent = getIndent(lines[i]);

    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indent < propIndent) break;
    if (trimmed.startsWith("- ")) break; // Next array item

    const propMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (propMatch) {
      const key = propMatch[1];
      const value = propMatch[2].trim();
      if (value === "") {
        i++;
        const blockResult = parseBlock(lines, i, indent);
        obj[key] = blockResult.value;
        i = blockResult.nextIndex;
      } else {
        obj[key] = parseYamlValue(value);
        i++;
      }
    } else {
      i++;
    }
  }

  return { value: obj, nextIndex: i };
}

function parseYamlValue(value: string): any {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;

  // Inline array: [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    return inner.split(",").map((s) => parseYamlValue(s.trim()));
  }

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

// ─── Trace Writer ─────────────────────────────────────────────────────────────

function writeTrace(
  event: string,
  input: CodexHookInput,
  result: HookDecision,
): void {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const traceFile = path.join(TRACES_DIR, `${dateStr}.jsonl`);

  const entry: TraceEntry = {
    timestamp: now.toISOString(),
    event,
    toolName: input.tool_name || "unknown",
    decision: result.decision,
    reason: result.reason || "",
    ruleName: result.ruleName,
    input: sanitizeInput(input.tool_input),
    output: input.tool_output,
    sessionId: input.session_id,
  };

  try {
    fs.appendFileSync(traceFile, JSON.stringify(entry) + "\n", "utf-8");
    log(`Trace written: ${event} ${input.tool_name} -> ${result.decision}`);
  } catch (err: any) {
    log(`Failed to write trace: ${err.message}`);
  }
}

function sanitizeInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  // Truncate large values for trace readability
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + "...(truncated)";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function readStdin(): Promise<CodexHookInput> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        const parsed = data.trim() ? JSON.parse(data) : {};
        resolve(parsed as CodexHookInput);
      } catch (err: any) {
        log(`Failed to parse stdin JSON: ${err.message}`);
        resolve({ tool_name: "unknown", tool_input: {} });
      }
    });
    process.stdin.on("error", reject);
  });
}

function findHarnessDir(): string {
  // Walk up from CWD to find .harness/
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".harness");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume .harness is in CWD
  return path.join(process.cwd(), ".harness");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function priority(d: HookDecision): number {
  switch (d.decision) {
    case "deny": return 3;
    case "warn": return 2;
    case "allow": return 1;
    default: return 0;
  }
}

function log(...args: unknown[]): void {
  if (DEBUG) {
    process.stderr.write(`[codex-handler] ${args.map(String).join(" ")}\n`);
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

main().catch((err) => {
  if (DEBUG) {
    process.stderr.write(`[codex-handler] Error: ${err.message}\n${err.stack}\n`);
  }
  // On error, allow by default (don't block the agent)
  process.exit(0);
});
