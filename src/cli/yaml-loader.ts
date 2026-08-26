/**
 * YAML Policy Loader
 *
 * Loads policy definitions from YAML files.
 * Supports the declarative policy format defined in the adaptation table.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { PolicyDefinition, PolicyRule, PolicyMatch } from "../core/policy.js";

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
  action: "allow" | "deny" | "warn" | "retry" | "trace";
  reason?: string;
  feedback?: string;
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

  const validActions = ["allow", "deny", "warn", "retry", "trace"];
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
