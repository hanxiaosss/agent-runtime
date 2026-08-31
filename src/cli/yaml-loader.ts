/**
 * YAML Policy Loader
 *
 * Loads policy definitions and semantic rules from YAML files.
 * Supports two YAML schemas:
 *
 *   1. Policy YAML — declarative event-field rules (when/match/action)
 *   2. Semantic YAML — multi-dimensional rules (match dimensions)
 *
 * Schema detection: if the top-level has `rules` with `when` fields,
 * it's a policy; if it has `rules` with `match.tool_name` / `match.file_path`
 * etc., it's a semantic rule file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { PolicyDefinition, PolicyRule, PolicyMatch } from "../core/policy.js";
import type { SemanticRule, SemanticMatchDimensions } from "../semantic/types.js";

// ─── YAML Schema Types ──────────────────────────────────────────────

interface YAMLPolicy {
  name: string;
  description?: string;
  enabled?: boolean;
  rules: YAMLRule[];
}

interface YAMLRule {
  name?: string;
  when: string | string[];
  match?: YAMLMatch[];
  action: "allow" | "deny" | "warn" | "retry" | "trace" | "modify";
  reason?: string;
  feedback?: string;
  modifiedInput?: Record<string, unknown>;
}

interface YAMLMatch {
  field: string;
  pattern: string | string[];
  negate?: boolean;
}

// ─── Loader Functions ───────────────────────────────────────────────

/**
 * Load a single policy from a YAML file.
 */
export function loadPolicyFromFile(filePath: string): PolicyDefinition {
  const content = fs.readFileSync(filePath, "utf-8");
  return loadPolicyFromYAML(content);
}

/**
 * Load a policy from a YAML string.
 */
export function loadPolicyFromYAML(yamlContent: string): PolicyDefinition {
  const raw = yaml.load(yamlContent) as YAMLPolicy;

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML: expected an object");
  }

  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Invalid policy: missing 'name' field");
  }

  if (!Array.isArray(raw.rules)) {
    throw new Error(`Invalid policy '${raw.name}': 'rules' must be an array`);
  }

  const rules: PolicyRule[] = raw.rules.map((r, i) => parseRule(r, raw.name, i));

  return {
    name: raw.name,
    description: raw.description,
    enabled: raw.enabled !== false,
    rules,
  };
}

/**
 * Load all policies from a directory.
 * Reads all .yaml and .yml files in the directory.
 */
export function loadPoliciesFromDir(dirPath: string): PolicyDefinition[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  const policies: PolicyDefinition[] = [];

  for (const file of files) {
    try {
      const policy = loadPolicyFromFile(path.join(dirPath, file));
      policies.push(policy);
    } catch (err) {
      console.warn(`Warning: failed to load policy from ${file}: ${err}`);
    }
  }

  return policies;
}

// ─── Internal Parsers ───────────────────────────────────────────────

function parseRule(raw: YAMLRule, policyName: string, index: number): PolicyRule {
  if (!raw.when) {
    throw new Error(`Invalid rule #${index} in policy '${policyName}': missing 'when' field`);
  }

  if (!raw.action) {
    throw new Error(`Invalid rule #${index} in policy '${policyName}': missing 'action' field`);
  }

  const validActions = ["allow", "deny", "warn", "retry", "trace", "modify"];
  if (!validActions.includes(raw.action)) {
    throw new Error(
      `Invalid rule '${raw.name ?? `#${index}`}' in policy '${policyName}': ` +
      `action must be one of ${validActions.join(", ")}`,
    );
  }

  const match: PolicyMatch[] | undefined = raw.match?.map((m, mi) => {
    if (!m.field) {
      throw new Error(
        `Invalid match #${mi} in rule '${raw.name ?? `#${index}`}' of policy '${policyName}': ` +
        "missing 'field'",
      );
    }
    if (m.pattern === undefined) {
      throw new Error(
        `Invalid match #${mi} in rule '${raw.name ?? `#${index}`}' of policy '${policyName}': ` +
        "missing 'pattern'",
      );
    }
    return {
      field: m.field,
      pattern: m.pattern,
      negate: m.negate,
    };
  });

  return {
    name: raw.name ?? `rule-${index}`,
    when: raw.when,
    match,
    action: raw.action,
    reason: raw.reason,
    feedback: raw.feedback,
    modifiedInput: raw.modifiedInput,
  };
}

// ─── Config Loader ──────────────────────────────────────────────────

export interface HarnessConfig {
  project: string;
  adapters: string[];
  trace: {
    enabled: boolean;
    dir: string;
  };
  policies: string[];
}

/**
 * Load the harness config from a .harness directory.
 */
export function loadHarnessConfig(harnessDir: string): HarnessConfig {
  const configPath = path.join(harnessDir, "config.yaml");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const raw = yaml.load(content) as Partial<HarnessConfig>;

  return {
    project: raw.project ?? path.basename(process.cwd()),
    adapters: raw.adapters ?? ["claude-code"],
    trace: {
      enabled: raw.trace?.enabled !== false,
      dir: raw.trace?.dir ?? ".harness/traces",
    },
    policies: raw.policies ?? ["policies"],
  };
}

// ─── Semantic Rule YAML Loader ──────────────────────────────────────
//
// Semantic rules use a multi-dimensional match schema:
//
//   name: no-hardcoded-secrets
//   description: Block hardcoded secrets in source code
//   source: custom
//   events: [tool.before, code.before_modify]    # optional
//   priority: 50                                  # optional
//   match:
//     file_type: [ts, js, py, go]
//     content:
//       - 'api_key = "'
//       - "password = '"
//   action: deny
//   feedback: Use environment variables for secrets
//   suggestions:
//     - Use process.env.API_KEY

interface YAMLSemanticRuleFile {
  /** Optional file-level name (used as prefix for unnamed rules) */
  name?: string;
  /** File-level source tag — applied to rules without explicit source */
  source?: string;
  /** File-level events override — applied to rules without explicit events */
  events?: string[];
  rules: YAMLSemanticRule[];
}

interface YAMLSemanticRule {
  name?: string;
  description?: string;
  source?: string;
  line?: number;
  events?: string[];
  enabled?: boolean;
  priority?: number;
  match: YAMLSemanticMatch;
  action: "deny" | "warn" | "modify";
  feedback?: string;
  suggestions?: string[];
  modifiedInput?: Record<string, unknown>;
}

interface YAMLSemanticMatch {
  tool_name?: string[];
  file_path?: string[];
  content?: string[];
  command?: string[];
  mcp_server?: string[];
  mcp_operation?: string[];
  file_type?: string[];
}

/**
 * Load a single semantic rule file from disk.
 */
export function loadSemanticRuleFile(filePath: string): SemanticRule[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return loadSemanticRulesFromYAML(content, filePath);
}

/**
 * Parse semantic rules from a YAML string.
 */
export function loadSemanticRulesFromYAML(
  yamlContent: string,
  sourceFile = "<yaml>",
): SemanticRule[] {
  const raw = yaml.load(yamlContent) as YAMLSemanticRuleFile;

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid semantic YAML: expected an object");
  }

  if (!Array.isArray(raw.rules)) {
    throw new Error(`Invalid semantic YAML '${sourceFile}': 'rules' must be an array`);
  }

  return raw.rules.map((r, i) => parseSemanticRule(r, raw, sourceFile, i));
}

/**
 * Load all semantic rule files from a directory.
 * Reads all .yaml / .yml files that contain a `match:` key at rule level.
 */
export function loadSemanticRulesFromDir(dirPath: string): SemanticRule[] {
  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  const rules: SemanticRule[] = [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      // Quick sniff: if it has "match:" followed by a dimension key, treat as semantic
      if (isSemanticYAML(content)) {
        rules.push(...loadSemanticRulesFromYAML(content, fullPath));
      }
    } catch (err) {
      console.warn(`Warning: failed to load semantic rules from ${file}: ${err}`);
    }
  }

  return rules;
}

// ─── Schema Detection ───────────────────────────────────────────────

const SEMANTIC_DIMENSION_KEYS = [
  "tool_name",
  "file_path",
  "content",
  "command",
  "mcp_server",
  "mcp_operation",
  "file_type",
];

/**
 * Heuristic: does this YAML look like a semantic rule file?
 * Checks whether any rule-level `match:` block contains a
 * dimension key.
 */
function isSemanticYAML(content: string): boolean {
  // Look for "match:" followed (within a few lines) by a dimension key
  const lines = content.split("\n");
  let inMatch = false;
  let matchIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.search(/\S/);

    // If we were inside a match block and indent decreased, exit it
    if (inMatch && indent <= matchIndent) {
      inMatch = false;
    }

    if (trimmed === "match:" || trimmed.startsWith("match:")) {
      inMatch = true;
      matchIndent = indent;
      continue;
    }

    if (inMatch) {
      // Check if the key before ':' is a dimension
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        if (SEMANTIC_DIMENSION_KEYS.includes(key)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ─── Internal Parsers ───────────────────────────────────────────────

function parseSemanticRule(
  raw: YAMLSemanticRule,
  file: YAMLSemanticRuleFile,
  sourceFile: string,
  index: number,
): SemanticRule {
  if (!raw.match) {
    throw new Error(
      `Invalid semantic rule #${index} in '${sourceFile}': missing 'match'`,
    );
  }

  if (!raw.action) {
    throw new Error(
      `Invalid semantic rule #${index} in '${sourceFile}': missing 'action'`,
    );
  }

  const validActions = ["deny", "warn", "modify"];
  if (!validActions.includes(raw.action)) {
    throw new Error(
      `Invalid semantic rule '${raw.name ?? `#${index}`}' in '${sourceFile}': ` +
      `action must be one of ${validActions.join(", ")}`,
    );
  }

  // Validate that at least one dimension is provided
  const dims = raw.match;
  const hasAnyDim = SEMANTIC_DIMENSION_KEYS.some(
    (k) => (dims as Record<string, unknown>)[k] !== undefined,
  );
  if (!hasAnyDim) {
    throw new Error(
      `Invalid semantic rule '${raw.name ?? `#${index}`}' in '${sourceFile}': ` +
      `'match' must specify at least one dimension (${SEMANTIC_DIMENSION_KEYS.join(", ")})`,
    );
  }

  const match: SemanticMatchDimensions = {};
  if (dims.tool_name) match.tool_name = asArray(dims.tool_name);
  if (dims.file_path) match.file_path = asArray(dims.file_path);
  if (dims.content) match.content = asArray(dims.content);
  if (dims.command) match.command = asArray(dims.command);
  if (dims.mcp_server) match.mcp_server = asArray(dims.mcp_server);
  if (dims.mcp_operation) match.mcp_operation = asArray(dims.mcp_operation);
  if (dims.file_type) match.file_type = asArray(dims.file_type);

  return {
    name: raw.name ?? `semantic-rule-${index}`,
    description: raw.description ?? raw.name ?? `Semantic rule #${index}`,
    source: raw.source ?? file.source ?? sourceFile,
    line: raw.line,
    events: raw.events ?? file.events,
    enabled: raw.enabled,
    priority: raw.priority,
    match,
    action: raw.action,
    feedback: raw.feedback ?? `Blocked by semantic rule: ${raw.name ?? `#${index}`}`,
    suggestions: raw.suggestions,
    modifiedInput: raw.modifiedInput,
  };
}

function asArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}
