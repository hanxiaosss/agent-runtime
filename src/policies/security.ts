/**
 * Example Policies
 *
 * A collection of ready-to-use policy definitions that demonstrate
 * the kinds of runtime guards you can set up for AI agents.
 */

import type { PolicyDefinition } from "../core/policy.js";

// ─── Protected Files Policy ─────────────────────────────────────────
// Prevents agents from modifying sensitive files.

export const protectedFilesPolicy: PolicyDefinition = {
  name: "protected-files",
  description: "Prevents modification of sensitive configuration and lock files",
  rules: [
    {
      name: "block-env-files",
      when: "code.before_modify",
      match: [{ field: "filePath", pattern: ["**/.env", "**/.env.*", "**/*.env", "**/*.env.*"] }],
      action: "deny",
      reason: "Environment files are protected",
      feedback:
        "Cannot modify environment files (.env). These contain secrets and must be edited manually.",
    },
    {
      name: "block-lock-files",
      when: "code.before_modify",
      match: [
        {
          field: "filePath",
          pattern: ["**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock"],
        },
      ],
      action: "deny",
      reason: "Lock files are auto-generated",
      feedback:
        "Cannot modify lock files directly. Run the appropriate package manager command instead (npm install, pnpm install, etc.).",
    },
    {
      name: "block-core-files",
      when: "code.before_modify",
      match: [{ field: "filePath", pattern: ["src/core/**", "src/kernel/**"] }],
      action: "deny",
      reason: "Core module files require human review",
      feedback:
        "Files in src/core/ and src/kernel/ are protected. Changes to core modules require explicit human approval.",
    },
    {
      name: "warn-on-config-changes",
      when: "code.before_modify",
      match: [
        {
          field: "filePath",
          pattern: ["**/tsconfig.json", "**/package.json", "**/.eslintrc*", "**/prettier.config.*"],
        },
      ],
      action: "warn",
      reason: "Configuration file modification detected",
      feedback:
        "You are modifying a project configuration file. Ensure this change is intentional and does not break the build.",
    },
  ],
};

// ─── MCP Safety Policy ──────────────────────────────────────────────
// Controls which MCP operations agents can perform.

export const mcpSafetyPolicy: PolicyDefinition = {
  name: "mcp-safety",
  description: "Controls agent access to MCP servers and operations",
  rules: [
    {
      name: "block-database-writes",
      when: "mcp.before",
      match: [
        { field: "server", pattern: "database" },
        { field: "operation", pattern: ["write", "delete", "drop", "truncate"] },
      ],
      action: "deny",
      reason: "Database write operations are blocked",
      feedback:
        "Direct database write operations are not allowed. Use the application's API layer instead.",
    },
    {
      name: "warn-database-reads",
      when: "mcp.before",
      match: [{ field: "server", pattern: "database" }],
      action: "warn",
      reason: "Database access detected",
      feedback: "Database access detected. Ensure queries are read-only and do not expose sensitive data.",
    },
    {
      name: "block-filesystem-delete",
      when: "mcp.before",
      match: [
        { field: "server", pattern: "filesystem" },
        { field: "operation", pattern: ["delete", "remove", "unlink"] },
      ],
      action: "deny",
      reason: "File deletion via MCP is blocked",
      feedback:
        "File deletion through MCP is not allowed. Use the terminal with explicit confirmation instead.",
    },
  ],
};

// ─── Git Safety Policy ──────────────────────────────────────────────
// Prevents dangerous git operations.

export const gitSafetyPolicy: PolicyDefinition = {
  name: "git-safety",
  description: "Prevents dangerous git operations by agents",
  rules: [
    {
      name: "block-force-push",
      when: "tool.before",
      match: [
        { field: "toolName", pattern: ["Bash", "bash", "terminal", "shell"] },
        { field: "input.command", pattern: ["*push --force*", "*push -f*"] },
      ],
      action: "deny",
      reason: "Force push is blocked",
      feedback:
        "Force push (git push --force) is not allowed. This can overwrite remote history. Use regular push or push with lease.",
    },
    {
      name: "block-hard-reset",
      when: "tool.before",
      match: [
        { field: "toolName", pattern: ["Bash", "bash", "terminal", "shell"] },
        { field: "input.command", pattern: ["*reset --hard*"] },
      ],
      action: "deny",
      reason: "Hard reset is blocked",
      feedback:
        "git reset --hard is not allowed. This discards uncommitted changes permanently.",
    },
    {
      name: "block-main-push",
      when: "tool.before",
      match: [
        { field: "toolName", pattern: ["Bash", "bash", "terminal", "shell"] },
        { field: "input.command", pattern: ["*push*main*", "*push*master*"] },
      ],
      action: "deny",
      reason: "Direct push to main/master is blocked",
      feedback:
        "Direct push to main/master branch is not allowed. Create a feature branch and use pull requests.",
    },
  ],
};

// ─── Quality Gate Policy ────────────────────────────────────────────
// Ensures agents meet quality standards before completing tasks.

export const qualityGatePolicy: PolicyDefinition = {
  name: "quality-gate",
  description: "Ensures agents meet quality standards before declaring tasks complete",
  rules: [
    {
      name: "require-tests-passed",
      when: "task.before_complete",
      match: [{ field: "testPassed", pattern: "false" }],
      action: "deny",
      reason: "Tests must pass before completion",
      feedback:
        "Cannot declare task complete: tests have not passed. Run the test suite and fix any failures before completing.",
    },
  ],
};

// ─── All Policies ───────────────────────────────────────────────────

export const allPolicies: PolicyDefinition[] = [
  protectedFilesPolicy,
  mcpSafetyPolicy,
  gitSafetyPolicy,
  qualityGatePolicy,
];
