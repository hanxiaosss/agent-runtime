/**
 * policy command
 *
 * Manage policies: list, validate, show, check.
 *
 * Usage:
 *   hannah policy                     # List all policies
 *   hannah policy validate            # Validate all policy files
 *   hannah policy show <name>         # Show policy details
 *   hannah policy check <file>        # Check a specific policy file
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadPoliciesFromDir, loadPolicyFromFile } from "./yaml-loader.js";
import type { PolicyDefinition, PolicyRule } from "../core/policy.js";

export function runPolicy(args: string[]): void {
  const subCommand = args[0] || "list";
  const flags = args.slice(1);

  switch (subCommand) {
    case "list":
      listPolicies(flags);
      break;
    case "validate":
      validatePolicies(flags);
      break;
    case "show":
      showPolicy(flags);
      break;
    case "check":
      checkPolicyFile(flags);
      break;
    default:
      console.error("Unknown policy command: " + subCommand);
      console.error("Usage: hannah policy [list|validate|show|check]");
      process.exit(1);
  }
}

function findPolicyDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".harness", "policies");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function listPolicies(_args: string[]): void {
  const policyDir = findPolicyDir();
  if (!policyDir) {
    console.error("No .harness/policies/ directory found.");
    process.exit(1);
  }

  const policies = loadPoliciesFromDir(policyDir);

  if (policies.length === 0) {
    console.log("No policies found. Add policy YAML files to .harness/policies/");
    return;
  }

  console.log("");
  console.log("=== Active Policies ===");
  console.log("");

  const header = "Name".padEnd(30) + "Rules".padStart(8) + "Enabled".padStart(10) + "Description";
  console.log(header);
  console.log("-".repeat(header.length + 20));

  for (const p of policies) {
    const name = p.name.length > 28 ? p.name.slice(0, 25) + "..." : p.name;
    const ruleCount = p.rules.length;
    const enabled = p.enabled !== false ? "Yes" : "No";
    const desc = p.description || "";

    console.log(
      name.padEnd(30) +
      String(ruleCount).padStart(8) +
      enabled.padStart(10) +
      "  " + desc,
    );
  }

  console.log("");
  console.log("Total: " + policies.length + " policy/policies");
  console.log("");
}

function validatePolicies(_args: string[]): void {
  const policyDir = findPolicyDir();
  if (!policyDir) {
    console.error("No .harness/policies/ directory found.");
    process.exit(1);
  }

  const files = fs.readdirSync(policyDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  let valid = 0;
  let invalid = 0;
  const errors: string[] = [];

  for (const file of files) {
    const filePath = path.join(policyDir, file);
    try {
      const policy = loadPolicyFromFile(filePath);
      const validationErrors = validatePolicyDef(policy, file);
      if (validationErrors.length > 0) {
        invalid++;
        errors.push(...validationErrors);
      } else {
        valid++;
      }
    } catch (err: unknown) {
      invalid++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(file + ": Parse error - " + msg);
    }
  }

  console.log("");
  console.log("=== Policy Validation ===");
  console.log("");

  if (errors.length > 0) {
    console.log("Errors found:");
    console.log("");
    for (const e of errors) {
      console.log("  [ERROR] " + e);
    }
    console.log("");
  }

  console.log("Files scanned: " + files.length);
  console.log("Valid policies: " + valid);
  console.log("Invalid policies: " + invalid);
  console.log("");

  if (invalid === 0) {
    console.log("All policies are valid.");
  } else {
    console.log(invalid + " policy/policies have issues.");
    process.exit(1);
  }
  console.log("");
}

function validatePolicyDef(policy: PolicyDefinition, sourceFile: string): string[] {
  const errors: string[] = [];

  if (!policy.name) {
    errors.push(sourceFile + ": Missing required field 'name'");
  }

  if (!policy.rules || !Array.isArray(policy.rules) || policy.rules.length === 0) {
    errors.push((policy.name || sourceFile) + ": Missing or empty 'rules' array");
    return errors;
  }

  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    const prefix = (policy.name || sourceFile) + " rule[" + i + "]";

    if (!rule.when) {
      errors.push(prefix + ": Missing required field 'when'");
    }

    if (!rule.action) {
      errors.push(prefix + ": Missing required field 'action'");
    } else if (!["allow", "deny", "warn", "block", "modify"].includes(rule.action)) {
      errors.push(prefix + ": Invalid action '" + rule.action + "'. Must be one of: allow, deny, warn, block, modify");
    }
  }

  return errors;
}

function showPolicy(args: string[]): void {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("Usage: hannah policy show <policy-name>");
    process.exit(1);
  }

  const policyDir = findPolicyDir();
  if (!policyDir) {
    console.error("No .harness/policies/ directory found.");
    process.exit(1);
  }

  const policies = loadPoliciesFromDir(policyDir);
  const policy = policies.find((p) => p.name === name);

  if (!policy) {
    console.error("Policy not found: " + name);
    console.error("Available policies: " + policies.map((p) => p.name).join(", "));
    process.exit(1);
  }

  console.log("");
  console.log("=== Policy: " + policy.name + " ===");
  console.log("");
  console.log("Name:        " + policy.name);
  console.log("Description: " + (policy.description || "N/A"));
  console.log("Enabled:     " + (policy.enabled !== false ? "Yes" : "No"));
  console.log("Rules:       " + policy.rules.length);
  console.log("");

  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    console.log("--- Rule " + (i + 1) + " ---");
    console.log("  Name:     " + (rule.name || "(unnamed)"));
    console.log("  When:     " + (Array.isArray(rule.when) ? rule.when.join(", ") : rule.when));
    console.log("  Action:   " + rule.action);
    if (rule.reason) console.log("  Reason:   " + rule.reason);
    if (rule.feedback) console.log("  Feedback: " + rule.feedback);
    if (rule.match && rule.match.length > 0) {
      console.log("  Match:");
      for (const m of rule.match) {
        const neg = m.negate ? " (negated)" : "";
        const pat = Array.isArray(m.pattern) ? m.pattern.join(", ") : m.pattern;
        console.log("    - " + m.field + " : " + pat + neg);
      }
    }
    console.log("");
  }
}

function checkPolicyFile(args: string[]): void {
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: hannah policy check <file-path>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error("File not found: " + resolved);
    process.exit(1);
  }

  try {
    const policy = loadPolicyFromFile(resolved);
    const errors = validatePolicyDef(policy, filePath);

    console.log("");
    console.log("=== Checking: " + filePath + " ===");
    console.log("");

    if (errors.length > 0) {
      console.log("[INVALID] " + (policy.name || "(unnamed)"));
      for (const e of errors) {
        console.log("  - " + e);
      }
      console.log("");
      console.log("Policy has validation errors.");
      process.exit(1);
    } else {
      console.log("[VALID] " + policy.name + " (" + policy.rules.length + " rules)");
      console.log("");
      console.log("Policy is valid.");
    }
    console.log("");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to parse file: " + msg);
    process.exit(1);
  }
}
