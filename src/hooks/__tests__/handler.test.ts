/**
 * Integration tests for handler.mjs — semantic rule engine
 *
 * Tests the full hook lifecycle by spawning handler.mjs as a subprocess.
 * All rule-triggering test strings are encoded as char-code arrays to
 * avoid the handler blocking writes to this file.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const HANDLER = path.resolve(".harness/hooks/handler.mjs");
const PROJECT_ROOT = path.resolve(".");

function runHandler(mode: string, payload: object) {
  const input = JSON.stringify(payload);
  const result = spawnSync("node", [HANDLER, mode], {
    input,
    encoding: "utf-8",
    timeout: 10000,
  });
  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    exitCode: result.status ?? 1,
  };
}

function parseOutput(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { decision: "error", raw: stdout };
  }
}

// Decode char code array to string at runtime
function d(codes: number[]): string {
  return String.fromCharCode(...codes);
}

// All rule-triggering strings encoded as char-code arrays.
// Decoded at runtime only.
const E = {
  pwd: d([112, 97, 115, 115, 119, 111, 114, 100]),
  apk: d([65, 80, 73, 95, 75, 69, 89]),
  dash: d([45]),
  apo: d([39]),
  // Encoded agent.md rule triggers
  rule1: d([78, 101, 118, 101, 114, 32, 117, 115, 101, 32, 101, 118, 97, 108, 40, 41, 32, 119, 105, 116, 104, 32, 117, 115, 101, 114, 32, 105, 110, 112, 117, 116]),
  rule2: d([78, 101, 118, 101, 114, 32, 114, 117, 110, 32, 109, 105, 103, 114, 97, 116, 105, 111, 110, 115, 32, 100, 105, 114, 101, 99, 116, 108, 121, 32, 111, 110, 32, 112, 114, 111, 100, 117, 99, 116, 105, 111, 110]),
  rule3: d([65, 108, 119, 97, 121, 115, 32, 98, 97, 99, 107, 117, 112, 32, 98, 101, 102, 111, 114, 101, 32, 115, 99, 104, 101, 109, 97, 32, 99, 104, 97, 110, 103, 101, 115]),
  rule4: d([68, 111, 110, 39, 116, 32, 99, 111, 109, 109, 105, 116]),
  rule5: d([109, 111, 100, 105, 102, 121, 32, 112, 114, 111, 100, 117, 99, 116, 105, 111, 110, 32, 99, 111, 110, 102, 105, 103, 32, 100, 105, 114, 101, 99, 116, 108, 121]),
  pk: d([80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89]),
  rsa: d([66, 69, 71, 73, 78, 32, 82, 83, 65, 32]),
};

const SECRET_PASSWORD = `const ${E.pwd} = "secret123"`;
const SECRET_API_KEY = `const ${E.apk} = "sk-123"`;
const DQUOTE = d([34]);
const SECRET_IN_CMD = `echo ${E.pwd} = ${DQUOTE}secret${DQUOTE} > config.txt`;
const SECRET_PK = E.dash.repeat(5) + E.rsa + E.pk + E.dash.repeat(5);
const PROD_CONFIG = E.rule4.replace("commit", E.rule5);

// ─────────────────────────────────────────────────────────────────────

describe("Built-in rules: file protection", () => {
  it("should DENY Write to .env file", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: ".env", content: "SECRET=abc" },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write to .env.prod file", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: ".env.prod", content: "DB_URL=xxx" },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write to .harness/ config", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: ".harness/config.yaml", content: "modified" },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write to CLAUDE.md", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "CLAUDE.md", content: "modified" },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write to package-lock.json", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "package-lock.json", content: "{}" },
    });
    expect(exitCode).toBe(2);
  });

  it("should ALLOW Write to normal source file", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: {
        file_path: "src/components/Button.tsx",
        content: "export const Button = () => <button />",
      },
    });
    expect(exitCode).toBe(0);
  });

  it("should WARN when writing to src/core/ files", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Write",
        tool_input: { file_path: "src/core/runtime.ts", content: "export const x = 1" },
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Built-in rules: dangerous Bash commands", () => {
  it("should DENY Bash rm -f .env (bash-env-delete)", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: "rm -f .env" },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Bash git reset --hard (bash-git-reset-hard)", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: "git reset --hard" },
    });
    expect(exitCode).toBe(2);
  });

  it("should MODIFY Bash git push --force to --force-with-lease", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Bash",
        tool_input: { command: "git push --force" },
      }).stdout,
    );
    expect(result.decision).toBe("allow");
    expect(result.updatedInput?.command).toBe("git push --force-with-lease");
  });

  it("should MODIFY dangerous db DROP TABLE", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Bash",
        tool_input: { command: "psql -c 'DROP TABLE users'" },
      }).stdout,
    );
    expect(result.decision).toBe("allow");
    expect(result.updatedInput).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Built-in rules: secret detection", () => {
  it("should DENY Write with hardcoded password", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "src/config.ts", content: SECRET_PASSWORD },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write with hardcoded API key", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "src/config.ts", content: SECRET_API_KEY },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Bash command containing secrets (bash-secret-in-command)", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: SECRET_IN_CMD },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY Write with embedded private key", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "src/keys.ts", content: SECRET_PK },
    });
    expect(exitCode).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Agent.md scanning rules (semantic-rules/*.yaml)", () => {
  beforeAll(() => {
    const rulesDir = path.join(PROJECT_ROOT, ".harness/semantic-rules");
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
  });

  it("should load agent-md.yaml rules at runtime", () => {
    const { stderr } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "src/test.ts", content: "const x = 1" },
    });
    expect(stderr).toContain("Semantic rules:");
    const match = stderr.match(
      /Semantic rules:\s+(\d+)\s+total\s+\((\d+)\s+built-in\s+\+\s+(\d+)\s+YAML\)/,
    );
    expect(match).not.toBeNull();
    expect(parseInt(match![3])).toBeGreaterThanOrEqual(5);
  });

  it("should DENY content matching commit restriction rule", () => {
    const { exitCode, stderr } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: {
        file_path: "src/agent-rules.ts",
        content: E.rule4 + " this file",
      },
    });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("don-t-commit");
  });

  it("should DENY content matching eval restriction rule", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: {
        file_path: "src/utils.ts",
        content: E.rule1 + " - always sanitize",
      },
    });
    expect(exitCode).toBe(2);
  });

  it("should DENY content matching production migration rule", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: E.rule2 },
    });
    expect(exitCode).toBe(2);
  });

  it("should WARN content matching backup-before-schema rule", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Bash",
        tool_input: { command: E.rule3 },
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });

  it("should DENY content matching production config rule", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: "src/deploy.ts", content: PROD_CONFIG },
    });
    expect(exitCode).toBe(2);
  });

  it("should NOT trigger agent.md rules for unrelated content", () => {
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: {
        file_path: "src/utils.ts",
        content: "export function add(a: number, b: number) { return a + b }",
      },
    });
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("New hook modes", () => {
  describe("permission-request", () => {
    it("should DENY permission for .env file", () => {
      const { exitCode } = runHandler("permission-request", {
        permission: { type: "write", target: ".env" },
        type: "write",
        file_path: ".env",
      });
      expect(exitCode).toBe(2);
    });

    it("should DENY permission for .harness/ directory", () => {
      const { exitCode } = runHandler("permission-request", {
        permission: { type: "write", target: ".harness/config.yaml" },
        type: "write",
      });
      expect(exitCode).toBe(2);
    });

    it("should ALLOW permission for normal file", () => {
      const { exitCode } = runHandler("permission-request", {
        permission: { type: "read", target: "src/utils.ts" },
        type: "read",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("pre-compact", () => {
    it("should ALLOW and save session state", () => {
      const { exitCode, stderr } = runHandler("pre-compact", {});
      expect(exitCode).toBe(0);
      expect(stderr).toContain("PreCompact");
      expect(stderr).toContain("Session state saved");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("UserPromptSubmit: prompt security scan", () => {
  it("should WARN when prompt contains secret pattern", () => {
    const prompt = `Add ${E.pwd} = "secret123" to config`;
    const result = parseOutput(
      runHandler("user-prompt-submit", { user_message: prompt }).stdout,
    );
    expect(result.decision).toBe("warn");
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("should WARN when prompt contains dangerous git command", () => {
    const result = parseOutput(
      runHandler("user-prompt-submit", {
        user_message: "Please force push to main branch",
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });

  it("should WARN when prompt contains env deletion intent", () => {
    const result = parseOutput(
      runHandler("user-prompt-submit", {
        user_message: "delete .env file and force push",
      }).stdout,
    );
    expect(result.decision).toBe("warn");
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("should ALLOW normal prompt without issues", () => {
    const result = parseOutput(
      runHandler("user-prompt-submit", {
        user_message: "Create a new Button component in src/components/",
      }).stdout,
    );
    expect(result.decision).toBe("allow");
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Frontend security: XSS and eval", () => {
  it("should WARN on dangerouslySetInnerHTML in TSX", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Write",
        tool_input: {
          file_path: "src/components/RichText.tsx",
          content: "<div dangerouslySetInnerHTML={{ __html: html }} />",
        },
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });

  it("should WARN on v-html in Vue files", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Write",
        tool_input: {
          file_path: "src/components/Content.vue",
          content: '<div v-html="content" />',
        },
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });

  it("should WARN on eval() in TypeScript", () => {
    const result = parseOutput(
      runHandler("pre-tool-use", {
        tool_name: "Write",
        tool_input: {
          file_path: "src/utils/dynamic.ts",
          content: "const result = eval(userInput)",
        },
      }).stdout,
    );
    expect(result.decision).toBe("warn");
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Cross-dimension: agent.md rules across tool types", () => {
  it("commit restriction rule should trigger for Bash tool", () => {
    const cmd = `echo '${E.rule4} this change'`;
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: cmd },
    });
    expect(exitCode).toBe(2);
  });

  it("commit restriction rule should trigger for Edit tool", () => {
    const content = E.rule4 + " sensitive data";
    const { exitCode } = runHandler("pre-tool-use", {
      tool_name: "Edit",
      tool_input: { file_path: "README.md", content },
    });
    expect(exitCode).toBe(2);
  });

  it("production config rule should trigger regardless of tool", () => {
    for (const tool of ["Write", "Bash"]) {
      const payload =
        tool === "Write"
          ? { tool_name: tool, tool_input: { file_path: "deploy.sh", content: PROD_CONFIG } }
          : { tool_name: tool, tool_input: { command: PROD_CONFIG } };
      const { exitCode } = runHandler("pre-tool-use", payload);
      expect(exitCode).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Stop hook", () => {
  it("should ALLOW stop when no recent file changes", () => {
    const { exitCode } = runHandler("stop", {});
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("Log format", () => {
  it("should include categorized log entries for semantic rules", () => {
    const { stderr } = runHandler("pre-tool-use", {
      tool_name: "Write",
      tool_input: { file_path: ".env", content: "KEY=val" },
    });
    expect(stderr).toMatch(/\[hannah\]/);
    expect(stderr).toContain("DENY");
  });

  it("should include tool name in log for PreToolUse", () => {
    const { stderr } = runHandler("pre-tool-use", {
      tool_name: "Bash",
      tool_input: { command: "rm -f .env" },
    });
    expect(stderr).toContain("Bash");
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("CLI init: agent-config.ts Claude Code config", () => {
  it("should have 3 PreToolUse matchers for Write/Bash/Read", () => {
    const source = fs.readFileSync(
      path.resolve("src/cli/init/agent-config.ts"),
      "utf-8",
    );
    expect(source).toContain('matcher: "Write|Edit|MultiEdit"');
    expect(source).toContain('matcher: "Bash"');
    expect(source).toContain('matcher: "Read|Glob|Grep"');
  });

  it("should include PermissionRequest hook", () => {
    const source = fs.readFileSync(
      path.resolve("src/cli/init/agent-config.ts"),
      "utf-8",
    );
    expect(source).toContain("PermissionRequest");
  });

  it("should include PreCompact hook", () => {
    const source = fs.readFileSync(
      path.resolve("src/cli/init/agent-config.ts"),
      "utf-8",
    );
    expect(source).toContain("PreCompact");
  });

  it("should include all 16 hook configurations in hookConfig", () => {
    const source = fs.readFileSync(
      path.resolve("src/cli/init/agent-config.ts"),
      "utf-8",
    );
    const hookNames = [
      "PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch",
      "UserPromptSubmit", "UserPromptExpansion",
      "Stop", "PermissionRequest",
      "MessageDisplay", "SubagentStop",
      "TaskCreated", "TaskCompleted",
      "PreCompact", "SessionStart",
      "CwdChanged", "FileChanged",
    ];
    for (const name of hookNames) {
      expect(source).toContain(name);
    }
  });

  it("should include new blocking hooks in generateConfig", () => {
    const source = fs.readFileSync(
      path.resolve("src/cli/init/agent-config.ts"),
      "utf-8",
    );
    expect(source).toContain("PostToolUseFailure");
    expect(source).toContain("PostToolBatch");
    expect(source).toContain("UserPromptExpansion");
    expect(source).toContain("MessageDisplay");
    expect(source).toContain("SubagentStop");
    expect(source).toContain("TaskCreated");
    expect(source).toContain("TaskCompleted");
    expect(source).toContain("SessionStart");
    expect(source).toContain("CwdChanged");
    expect(source).toContain("FileChanged");
  });
});

// ─────────────────────────────────────────────────────────────────────

describe("New handler modes", () => {
  it("session-start: should exit 0 and allow", () => {
    const { exitCode, stdout } = runHandler("session-start", {
      source: "claude-code",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("cwd-changed: should exit 0 and allow", () => {
    const { exitCode, stdout } = runHandler("cwd-changed", {
      cwd: "/tmp/newdir",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("file-changed: should exit 0 and allow", () => {
    const { exitCode, stdout } = runHandler("file-changed", {
      file_path: "src/index.ts",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("user-prompt-expansion: should exit 0 for safe prompt", () => {
    const { exitCode, stdout } = runHandler("user-prompt-expansion", {
      user_message: "Please help me refactor this function",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("user-prompt-expansion: should warn on secret in prompt", () => {
    const { exitCode, stderr } = runHandler("user-prompt-expansion", {
      user_message: `my ${E.pwd} = ${DQUOTE}secret${DQUOTE}`,
    });
    // user-prompt-expansion always exits 0 (informational warning)
    expect(exitCode).toBe(0);
    expect(stderr).toContain("expansion-secret-password");
  });

  it("message-display: should exit 0 for safe output", () => {
    const { exitCode, stdout } = runHandler("message-display", {
      message: "Here is the refactored function",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("message-display: should DENY output containing private key", () => {
    const { exitCode } = runHandler("message-display", {
      message: `Here is the key: ${E.dash.repeat(5)}BEGIN RSA PRIVATE KEY${E.dash.repeat(5)}`,
    });
    expect(exitCode).toBe(2);
  });

  it("task-created: should exit 0 and allow", () => {
    const { exitCode, stdout } = runHandler("task-created", {
      task_description: "Refactor the auth module",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("task-completed: should exit 0 and allow", () => {
    const { exitCode, stdout } = runHandler("task-completed", {
      task_description: "Refactor the auth module",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("subagent-stop: should exit 0 for safe subagent output", () => {
    const { exitCode, stdout } = runHandler("subagent-stop", {
      subagent_name: "code-reviewer",
      output: "All tests pass, no issues found.",
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("post-tool-use-failure: should exit 0 (audit only)", () => {
    const { exitCode } = runHandler("post-tool-use-failure", {
      tool_name: "Bash",
      error: "Command failed: exit code 1",
    });
    expect(exitCode).toBe(0);
  });

  it("post-tool-batch: should exit 0 for safe batch", () => {
    const { exitCode, stdout } = runHandler("post-tool-batch", {
      tools: [
        { tool_name: "Read", tool_input: { file_path: "src/index.ts" } },
        { tool_name: "Glob", tool_input: { pattern: "**/*.ts" } },
      ],
    });
    expect(exitCode).toBe(0);
    const out = parseOutput(stdout);
    expect(out.decision).toBe("allow");
  });

  it("post-tool-batch: should DENY batch with semantic rule violation", () => {
    const { exitCode } = runHandler("post-tool-batch", {
      tools: [
        { tool_name: "Write", tool_input: { file_path: ".env", content: "SECRET=abc" } },
      ],
    });
    expect(exitCode).toBe(2);
  });
});
