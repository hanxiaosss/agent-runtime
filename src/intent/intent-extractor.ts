/**
 * Intent Extractor
 *
 * Analyzes tool calls to extract the developer's intent,
 * enabling intent-based policy matching and rule evaluation.
 * Supports multiple agent platforms: Codex CLI, Claude Code,
 * GitHub Copilot, Qoder, Trae, Cursor.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// --- Types ---

export interface Intent {
  /** Classified intent type */
  type: IntentType;
  /** Confidence score 0-1 */
  confidence: number;
  /** Raw signals that contributed to classification */
  signals: string[];
  /** Target file paths if applicable */
  targetFiles?: string[];
  /** Command being executed if applicable */
  command?: string;
}

export type IntentType =
  | "file_create"
  | "file_modify"
  | "file_delete"
  | "file_read"
  | "code_execute"
  | "git_commit"
  | "git_push"
  | "git_force_push"
  | "git_reset"
  | "dependency_install"
  | "config_change"
  | "mcp_call"
  | "search"
  | "test_run"
  | "unknown";

export interface IntentRule {
  name: string;
  intent: IntentType;
  minConfidence: number;
  action: "allow" | "deny" | "warn";
  feedback?: string;
  suggestions?: string[];
}

// --- Intent Extraction ---

/**
 * Extract intent from a hook input payload.
 * Works across agent platforms by normalizing tool names and inputs.
 */
export function extractIntent(input: Record<string, unknown>): Intent {
  const toolName = String(input.tool_name || "");
  const toolInput = (input.tool_input || {}) as Record<string, unknown>;
  const signals: string[] = [];

  const normalizedTool = normalizeToolName(toolName);
  signals.push(`tool:${normalizedTool}`);

  const command = String(toolInput.command || "");
  const filePath = String(
    toolInput.file_path || toolInput.path || toolInput.file || "",
  );
  const content = String(toolInput.content || toolInput.text || "");

  const intentType = classifyIntent(normalizedTool, command, filePath, content, signals);
  const confidence = calculateConfidence(normalizedTool, command, filePath, signals);

  return {
    type: intentType,
    confidence,
    signals,
    targetFiles: filePath ? [filePath] : undefined,
    command: command || undefined,
  };
}

function normalizeToolName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === "bash" || lower === "shell" || lower === "terminal") return "bash";
  if (lower === "write" || lower === "edit" || lower === "writefile" || lower === "editfile") return "file_write";
  if (lower === "read" || lower === "readfile" || lower === "view") return "file_read";
  if (lower.includes("str_replace_editor")) return "file_write";
  if (lower.includes("create_file")) return "file_create";
  if (lower.includes("edit_file")) return "file_write";
  if (lower.startsWith("mcp__") || lower.startsWith("mcp_")) return "mcp_call";
  return lower;
}

function classifyIntent(
  tool: string,
  command: string,
  filePath: string,
  content: string,
  signals: string[],
): IntentType {
  if (tool === "bash" && command) {
    if (command.includes("git push") && command.includes("--force")) {
      signals.push("git:force_push");
      return "git_force_push";
    }
    if (command.includes("git push")) {
      signals.push("git:push");
      return "git_push";
    }
    if (command.includes("git commit")) {
      signals.push("git:commit");
      return "git_commit";
    }
    if (command.includes("git reset")) {
      signals.push("git:reset");
      return "git_reset";
    }
    if (command.includes("npm install") || command.includes("yarn add") || command.includes("pnpm add")) {
      signals.push("dep:install");
      return "dependency_install";
    }
    if (command.includes("npm test") || command.includes("jest") || command.includes("vitest") || command.includes("mocha")) {
      signals.push("test:run");
      return "test_run";
    }
    signals.push("cmd:execute");
    return "code_execute";
  }
  if (tool === "file_write") {
    if (filePath && !content) {
      signals.push("file:create");
      return "file_create";
    }
    signals.push("file:modify");
    return "file_modify";
  }
  if (tool === "file_read") {
    signals.push("file:read");
    return "file_read";
  }
  if (tool === "mcp_call") {
    signals.push("mcp:call");
    return "mcp_call";
  }
  if (tool.includes("search") || tool.includes("grep") || tool.includes("find")) {
    signals.push("search");
    return "search";
  }
  return "unknown";
}

function calculateConfidence(
  tool: string,
  command: string,
  filePath: string,
  signals: string[],
): number {
  let confidence = 0.5;
  if (tool === "bash" && command) confidence += 0.3;
  if (tool === "file_write" || tool === "file_read") confidence += 0.3;
  if (tool === "mcp_call") confidence += 0.2;
  if (signals.length >= 3) confidence += 0.1;
  if (signals.length >= 4) confidence += 0.05;
  if (filePath && (tool === "file_write" || tool === "file_read")) confidence += 0.05;
  return Math.min(confidence, 1.0);
}

// --- Intent Rule Loading ---

export function loadIntentRules(harnessDir: string): IntentRule[] {
  const rulesDir = path.join(harnessDir, "intent-rules");
  const rules: IntentRule[] = [];
  if (!fs.existsSync(rulesDir)) return rules;
  const files = fs.readdirSync(rulesDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(rulesDir, file), "utf-8");
      const parsed = parseIntentYaml(content);
      if (parsed.rules && Array.isArray(parsed.rules)) {
        rules.push(...(parsed.rules as IntentRule[]));
      }
    } catch {
      /* Skip invalid rule files */
    }
  }
  return rules;
}

function parseIntentYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    const topMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (topMatch && !lines[i].startsWith(" ") && !lines[i].startsWith("\t")) {
      const key = topMatch[1];
      const value = topMatch[2].trim();
      if (value === "") {
        i++;
        const blockResult = parseIntentBlock(lines, i, 0);
      result[key] = blockResult.value;
      i = blockResult.nextIndex;
      } else {
        result[key] = parseIntentValue(value);
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

function parseIntentBlock(
  lines: string[],
  startIndex: number,
  parentIndent: number,
): { value: unknown; nextIndex: number } {
  let i = startIndex;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("#")) break;
    i++;
  }
  if (i >= lines.length) return { value: null, nextIndex: i };
  const firstLine = lines[i];
  const firstIndent = (firstLine.match(/^(\s*)/) || ["", ""])[1].length;
  if (firstIndent <= parentIndent) return { value: null, nextIndex: i };
  const firstTrimmed = firstLine.trim();
  if (firstTrimmed.startsWith("- ")) {
    const items: unknown[] = [];
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      const indent = (lines[i].match(/^(\s*)/) || ["", ""])[1].length;
      if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
      if (indent < firstIndent) break;
      if (trimmed.startsWith("- ")) {
        const itemResult = parseIntentArrayItem(lines, i, indent);
        items.push(itemResult.value);
        i = itemResult.nextIndex;
      } else { break; }
    }
    return { value: items, nextIndex: i };
  }
  const obj: Record<string, unknown> = {};
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const indent = (lines[i].match(/^(\s*)/) || ["", ""])[1].length;
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    if (indent < firstIndent) break;
    const keyMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === "") {
        i++;
        const blockResult = parseIntentBlock(lines, i, indent);
        obj[key] = blockResult.value;
        i = blockResult.nextIndex;
      } else {
        obj[key] = parseIntentValue(value);
        i++;
      }
    } else { i++; }
  }
  return { value: obj, nextIndex: i };
}

function parseIntentArrayItem(
  lines: string[],
  startIndex: number,
  itemIndent: number,
): { value: unknown; nextIndex: number } {
  let i = startIndex;
  const firstLine = lines[i].trim();
  const afterDash = firstLine.replace(/^-\s+/, "").trim();
  const kvMatch = afterDash.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
  if (!kvMatch) {
    return { value: parseIntentValue(afterDash), nextIndex: i + 1 };
  }
  const obj: Record<string, unknown> = {};
  obj[kvMatch[1]] = kvMatch[2].trim() === "" ? null : parseIntentValue(kvMatch[2].trim());
  i++;
  const propIndent = itemIndent + 2;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const indent = (lines[i].match(/^(\s*)/) || ["", ""])[1].length;
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    if (indent < propIndent) break;
    if (trimmed.startsWith("- ")) break;
    const propMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (propMatch) {
      const key = propMatch[1];
      const value = propMatch[2].trim();
      if (value === "") {
        i++;
        const blockResult = parseIntentBlock(lines, i, indent);
        obj[key] = blockResult.value;
        i = blockResult.nextIndex;
      } else {
        obj[key] = parseIntentValue(value);
        i++;
      }
    } else { i++; }
  }
  return { value: obj, nextIndex: i };
}

function parseIntentValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    return inner.split(",").map((s) => parseIntentValue(s.trim()));
  }
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
