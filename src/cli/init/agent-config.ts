/**
 * Agent configuration definitions and registry.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentConfig {
  name: string;
  value: string;
  description: string;
  configPath: string;
  hookConfig: string;
  generateConfig: (projectRoot: string) => void;
}

/**
 * Build the Codex hooks.json content.
 * Codex CLI loads hooks from .codex/hooks.json (not config.toml).
 * See: https://github.com/openai/codex/issues/17532
 *
 * Format: top-level `hooks` is a map keyed by event name, each value
 * is an array of { matcher, hooks: [{ type, command }] } entries.
 */
function buildCodexHooksJson(): string {
  const handlerPath = "node .harness/hooks/handler.mjs";
  const config = {
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: `${handlerPath} pre-tool-use` }],
        },
      ],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: `${handlerPath} post-tool-use` }],
        },
      ],
      UserPromptSubmit: [
        {
          matcher: "",
          hooks: [
            { type: "command", command: `${handlerPath} user-prompt-submit` },
          ],
        },
      ],
      Stop: [
        {
          matcher: "",
          hooks: [{ type: "command", command: `${handlerPath} stop` }],
        },
      ],
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

export const AGENTS: AgentConfig[] = [
  {
    name: "Claude Code",
    value: "claude-code",
    description: "Anthropic Claude Code CLI",
    configPath: ".claude/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-tool-use", "timeout": 15, "statusMessage": "Checking file write policies..." }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-tool-use", "timeout": 15, "statusMessage": "Checking shell command safety..." }] },
      { "matcher": "Read|Glob|Grep", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-tool-use", "timeout": 10, "statusMessage": "Auditing sensitive file access..." }] }
    ],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs post-tool-use", "timeout": 15, "statusMessage": "Verifying tool side effects..." }]
    }],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs user-prompt-submit", "timeout": 15, "statusMessage": "Scanning prompt for security risks..." }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs stop", "timeout": 30, "statusMessage": "Running pre-stop validation..." }]
    }],
    "PermissionRequest": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs permission-request", "timeout": 15, "statusMessage": "Checking permission request..." }]
    }],
    "PreCompact": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-compact", "timeout": 10, "statusMessage": "Saving session state before compaction..." }]
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".claude");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: "Write|Edit|MultiEdit",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-tool-use", timeout: 15, statusMessage: "Checking file write policies..." }],
            },
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-tool-use", timeout: 15, statusMessage: "Checking shell command safety..." }],
            },
            {
              matcher: "Read|Glob|Grep",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-tool-use", timeout: 10, statusMessage: "Auditing sensitive file access..." }],
            },
          ],
          PostToolUse: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs post-tool-use", timeout: 15, statusMessage: "Verifying tool side effects..." }],
            },
          ],
          UserPromptSubmit: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs user-prompt-submit", timeout: 15, statusMessage: "Scanning prompt for security risks..." }],
            },
          ],
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs stop", timeout: 30, statusMessage: "Running pre-stop validation..." }],
            },
          ],
          PermissionRequest: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs permission-request", timeout: 15, statusMessage: "Checking permission request..." }],
            },
          ],
          PreCompact: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-compact", timeout: 10, statusMessage: "Saving session state before compaction..." }],
            },
          ],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "GitHub Copilot",
    value: "copilot",
    description: "GitHub Copilot coding agent",
    configPath: ".github/hooks/hooks.json",
    hookConfig: `{
  "version": 1,
  "hooks": {
    "preToolUse": [{ "type": "command", "bash": "node .harness/hooks/handler.mjs pre-tool-use", "powershell": "node .harness/hooks/handler.mjs pre-tool-use" }],
    "postToolUse": [{ "type": "command", "bash": "node .harness/hooks/handler.mjs post-tool-use", "powershell": "node .harness/hooks/handler.mjs post-tool-use" }],
    "userPromptSubmit": [{ "type": "command", "bash": "node .harness/hooks/handler.mjs user-prompt-submit", "powershell": "node .harness/hooks/handler.mjs user-prompt-submit" }],
    "stop": [{ "type": "command", "bash": "node .harness/hooks/handler.mjs stop", "powershell": "node .harness/hooks/handler.mjs stop" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".github", "hooks");
      const configPath = path.join(configDir, "hooks.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: "command",
              bash: "node .harness/hooks/handler.mjs pre-tool-use",
              powershell: "node .harness/hooks/handler.mjs pre-tool-use",
            },
          ],
          postToolUse: [
            {
              type: "command",
              bash: "node .harness/hooks/handler.mjs post-tool-use",
              powershell: "node .harness/hooks/handler.mjs post-tool-use",
            },
          ],
          userPromptSubmit: [
            {
              type: "command",
              bash: "node .harness/hooks/handler.mjs user-prompt-submit",
              powershell: "node .harness/hooks/handler.mjs user-prompt-submit",
            },
          ],
          stop: [
            {
              type: "command",
              bash: "node .harness/hooks/handler.mjs stop",
              powershell: "node .harness/hooks/handler.mjs stop",
            },
          ],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Qoder",
    value: "qoder",
    description: "Qoder AI coding assistant",
    configPath: ".qoder/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-tool-use" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs post-tool-use" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs user-prompt-submit" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs stop" }] }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".qoder");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs pre-tool-use",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs post-tool-use",
                },
              ],
            },
          ],
          UserPromptSubmit: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs user-prompt-submit",
                },
              ],
            },
          ],
          Stop: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs stop",
                },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Codex CLI",
    value: "codex",
    description: "OpenAI Codex CLI",
    configPath: ".codex/hooks.json",
    hookConfig: buildCodexHooksJson(),
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".codex");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const hooksPath = path.join(configDir, "hooks.json");
      fs.writeFileSync(hooksPath, buildCodexHooksJson());
    },
  },
  {
    name: "Trae",
    value: "trae",
    description: "Trae AI coding assistant",
    configPath: ".trae/settings.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{ "command": "node .harness/hooks/handler.mjs pre-tool-use" }],
    "PostToolUse": [{ "command": "node .harness/hooks/handler.mjs post-tool-use" }],
    "UserPromptSubmit": [{ "command": "node .harness/hooks/handler.mjs user-prompt-submit" }],
    "Stop": [{ "command": "node .harness/hooks/handler.mjs stop" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".trae");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [
            { command: "node .harness/hooks/handler.mjs pre-tool-use" },
          ],
          PostToolUse: [
            { command: "node .harness/hooks/handler.mjs post-tool-use" },
          ],
          UserPromptSubmit: [
            { command: "node .harness/hooks/handler.mjs user-prompt-submit" },
          ],
          Stop: [{ command: "node .harness/hooks/handler.mjs stop" }],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Cursor",
    value: "cursor",
    description: "Cursor AI code editor",
    configPath: ".cursor/hooks.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{ "command": "node .harness/hooks/handler.mjs pre-tool-use" }],
    "PostToolUse": [{ "command": "node .harness/hooks/handler.mjs post-tool-use" }],
    "UserPromptSubmit": [{ "command": "node .harness/hooks/handler.mjs user-prompt-submit" }],
    "Stop": [{ "command": "node .harness/hooks/handler.mjs stop" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".cursor");
      const configPath = path.join(configDir, "hooks.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [
            { command: "node .harness/hooks/handler.mjs pre-tool-use" },
          ],
          PostToolUse: [
            { command: "node .harness/hooks/handler.mjs post-tool-use" },
          ],
          UserPromptSubmit: [
            { command: "node .harness/hooks/handler.mjs user-prompt-submit" },
          ],
          Stop: [{ command: "node .harness/hooks/handler.mjs stop" }],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
  {
    name: "Antigravity",
    value: "antigravity",
    description: "Google Antigravity (Gemini CLI successor)",
    configPath: ".agents/hooks.json",
    hookConfig: `{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs pre-tool-use" }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs post-tool-use" }]
    }],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs user-prompt-submit" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs stop" }]
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".agents");
      const configPath = path.join(configDir, "hooks.json");
      if (!fs.existsSync(configDir))
        fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs pre-tool-use",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs post-tool-use",
                },
              ],
            },
          ],
          UserPromptSubmit: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs user-prompt-submit",
                },
              ],
            },
          ],
          Stop: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node .harness/hooks/handler.mjs stop",
                },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
];
