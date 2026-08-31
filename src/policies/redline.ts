/**
 * Redline Policy
 *
 * Built-in "redline" rules that must never be crossed by any agent.
 * These rules replace the `BUILT_IN_RULES` previously embedded in handler.mjs
 * and are loaded automatically alongside any user-defined YAML policies.
 *
 * All rules match on `tool.before` events, inspecting the raw tool input
 * via dot-notation field paths (e.g. `input.file_path`, `input.content`).
 *
 * Rules use three actions:
 *   - deny:   block the action entirely
 *   - modify: rewrite the tool input before execution
 *   - warn:   allow but log a warning
 *
 * NOTE on private-key patterns: the literal header strings are assembled at
 * runtime via `privateKeyPatterns()` so this source file does not itself
 * contain substrings that would trip secret-detection scanners.
 */

import type { PolicyDefinition } from "../core/policy.js";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build the private-key header patterns at runtime.
 * We intentionally avoid writing the literal `-----BEGIN <TYPE> PRIVATE KEY-----`
 * strings in source — they would be flagged by any secret scanner that reads
 * this file (including our own semantic secret-detection hook).
 */
function privateKeyPatterns(): string[] {
  const hdr = ["\x2d\x2d\x2d\x2d\x2d", "BEGIN"].join(" ");
  const ftr = ["PRIVATE", "KEY\x2d\x2d\x2d\x2d\x2d"].join(" ");
  return ["RSA", "EC", "OPENSSH"].map((t) => `${hdr} ${t} ${ftr}`);
}

// ── Policy ───────────────────────────────────────────────────────────

export const redlinePolicy: PolicyDefinition = {
  name: "redline",
  description:
    "Non-negotiable guard rails. Protects agent instruction files, " +
    "harness configuration, environment files, lock files, production " +
    "configs, and blocks dangerous shell / database / secret patterns.",
  rules: [
    // ── Agent instruction files ──────────────────────────────────────
    {
      name: "redline-agent-files",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: [
            "**/agent.md",
            "**/AGENT.md",
            "**/.agent.md",
            "**/agents.md",
            "**/AGENTS.md",
            "**/CLAUDE.md",
            "**/COPILOT.md",
            "**/.cursorrules",
            "**/.cursor/rules.md",
          ],
        },
      ],
      action: "deny",
      reason: "Agent instruction files are read-only for agents",
      feedback:
        "You cannot modify agent instruction files. These define your behavior and must only be changed by the human user.",
    },

    // ── Harness configuration ────────────────────────────────────────
    {
      name: "redline-harness-config",
      when: "tool.before",
      match: [{ field: "input.file_path", pattern: ["**/.harness/**"] }],
      action: "deny",
      reason: "Harness configuration is read-only for agents",
      feedback:
        "You cannot modify .harness/ configuration. This directory contains runtime guard policies and hooks.",
    },

    // ── Environment files ────────────────────────────────────────────
    {
      name: "env-protection",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: ["**/.env", "**/.env.*", "**/*.env"],
        },
      ],
      action: "deny",
      reason: "Environment files may contain secrets",
      feedback:
        "Environment files are protected. They may contain secrets and must be edited manually.",
    },

    // ── Lock files ───────────────────────────────────────────────────
    {
      name: "lock-file-protection",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: [
            "**/package-lock.json",
            "**/pnpm-lock.yaml",
            "**/yarn.lock",
            "**/poetry.lock",
            "**/Gemfile.lock",
            "**/Cargo.lock",
            "**/go.sum",
          ],
        },
      ],
      action: "deny",
      reason: "Lock files are auto-generated",
      feedback:
        "Lock files are auto-generated. Use the package manager instead of editing directly.",
    },

    // ── Production config ────────────────────────────────────────────
    {
      name: "production-config",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: [
            "**/production.yaml",
            "**/production.yml",
            "**/production.json",
            "**/production.env",
            "**/prod.yaml",
            "**/prod.yml",
            "**/prod.json",
            "**/prod.env",
            "**/production/**",
            "**/prod/**",
          ],
        },
      ],
      action: "deny",
      reason: "Production configuration requires deployment pipeline",
      feedback:
        "Production configuration must be changed through the deployment pipeline, not directly.",
    },

    // ── Dangerous shell: rm ──────────────────────────────────────────
    {
      name: "dangerous-rm",
      when: "tool.before",
      match: [
        {
          field: "input.command",
          pattern: ["rm -rf /", "rm -rf ~", "rm -rf .", "rm -rf *"],
        },
      ],
      action: "modify",
      reason: "Destructive rm commands are blocked",
      feedback: "Destructive rm commands are blocked.",
      modifiedInput: { command: "echo 'Blocked: dangerous rm command'" },
    },

    // ── Dangerous shell: git force push ──────────────────────────────
    {
      name: "dangerous-git-force",
      when: "tool.before",
      match: [
        {
          field: "input.command",
          pattern: ["git push --force", "git push -f"],
        },
      ],
      action: "modify",
      reason: "Force push is not allowed",
      feedback: "Force push is not allowed. Use regular push or push with lease.",
      modifiedInput: { command: "git push --force-with-lease" },
    },

    // ── Dangerous DB operations ──────────────────────────────────────
    {
      name: "dangerous-db-drop",
      when: "tool.before",
      match: [
        {
          field: "input.content",
          pattern: ["DROP TABLE", "DROP DATABASE", "TRUNCATE TABLE"],
        },
      ],
      action: "modify",
      reason: "Destructive database operations are blocked",
      feedback:
        "Destructive database operations (DROP/TRUNCATE) are blocked.",
      modifiedInput: {
        content: "-- Blocked: Use ALTER TABLE or conditional DELETE instead",
      },
    },

    // ── Secret: password ─────────────────────────────────────────────
    {
      name: "secret-password",
      when: "tool.before",
      match: [
        {
          field: "input.content",
          pattern: [
            'password = "',
            "password = '",
            'passwd = "',
            "passwd = '",
            'pwd = "',
            "pwd = '",
          ],
        },
      ],
      action: "deny",
      reason: "Hardcoded password detected",
      feedback:
        "Hardcoded passwords detected. Use environment variables or a secrets manager.",
    },

    // ── Secret: API key ──────────────────────────────────────────────
    {
      name: "secret-api-key",
      when: "tool.before",
      match: [
        {
          field: "input.content",
          pattern: [
            'api_key = "',
            "api_key = '",
            'apiKey = "',
            "apiKey = '",
            'API_KEY = "',
            "API_KEY = '",
          ],
        },
      ],
      action: "deny",
      reason: "Hardcoded API key detected",
      feedback:
        "Hardcoded API keys detected. Use environment variables or a secrets manager.",
    },

    // ── Secret: private key ──────────────────────────────────────────
    {
      name: "secret-private-key",
      when: "tool.before",
      match: [
        {
          field: "input.content",
          pattern: privateKeyPatterns(),
        },
      ],
      action: "deny",
      reason: "Private key embedded in source",
      feedback: "Private keys must not be embedded in source code.",
    },

    // ── MCP: database write ──────────────────────────────────────────
    {
      name: "mcp-db-write",
      when: "mcp.before",
      match: [
        {
          field: "server",
          pattern: ["database", "db", "sql", "postgres", "mysql", "mongodb"],
        },
        {
          field: "operation",
          pattern: [
            "write",
            "delete",
            "drop",
            "truncate",
            "alter",
            "update",
            "insert",
            "execute",
          ],
        },
      ],
      action: "deny",
      reason: "Direct database write via MCP is not allowed",
      feedback:
        "Direct database write via MCP is not allowed. Use the application API layer.",
    },

    // ── Frontend: React XSS ──────────────────────────────────────────
    {
      name: "react-xss",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js"],
        },
        {
          field: "input.content",
          pattern: ["dangerouslySetInnerHTML"],
        },
      ],
      action: "warn",
      reason: "dangerouslySetInnerHTML can lead to XSS",
      feedback:
        "dangerouslySetInnerHTML can lead to XSS. Ensure content is sanitized.",
    },

    // ── Frontend: Vue XSS ────────────────────────────────────────────
    {
      name: "vue-xss",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: ["**/*.vue"],
        },
        {
          field: "input.content",
          pattern: ["v-html"],
        },
      ],
      action: "warn",
      reason: "v-html can lead to XSS",
      feedback: "v-html can lead to XSS. Use text interpolation when possible.",
    },

    // ── eval() injection ─────────────────────────────────────────────
    {
      name: "eval-injection",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: [
            "**/*.ts",
            "**/*.js",
            "**/*.tsx",
            "**/*.jsx",
            "**/*.py",
            "**/*.rb",
          ],
        },
        {
          field: "input.content",
          pattern: ["eval(", "new Function("],
        },
      ],
      action: "warn",
      reason: "eval() can lead to code injection",
      feedback: "eval() can lead to code injection. Consider safer alternatives.",
    },

    // ── Core module protection ───────────────────────────────────────
    {
      name: "core-module",
      when: "tool.before",
      match: [
        {
          field: "input.file_path",
          pattern: [
            "**/src/core/**",
            "**/src/kernel/**",
            "**/src/runtime/**",
          ],
        },
      ],
      action: "warn",
      reason: "Core module files require human review",
      feedback:
        "You are modifying core module files. These changes require human review.",
    },
  ],
};
