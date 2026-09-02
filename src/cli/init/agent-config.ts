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
 */
function buildCodexHooksJson(): string {
  const handlerPath = "dist/hooks/codex-handler.js";
  const config = {
    PreToolUse: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: `node ${handlerPath} pre-tool-use` }],
      },
    ],
    PostToolUse: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: `node ${handlerPath} post-tool-use` }],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [{ type: "command", command: `node ${handlerPath} stop` }],
      },
    ],
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
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs pre-tool-use"
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node .harness/hooks/handler.mjs post-tool-use"
      }]
    }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".claude");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-tool-use" }] }],
          PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs post-tool-use" }] }],
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
    "postToolUse": [{ "type": "command", "bash": "node .harness/hooks/handler.mjs post-tool-use", "powershell": "node .harness/hooks/handler.mjs post-tool-use" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".github", "hooks");
      const configPath = path.join(configDir, "hooks.json");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", bash: "node .harness/hooks/handler.mjs pre-tool-use", powershell: "node .harness/hooks/handler.mjs pre-tool-use" }],
          postToolUse: [{ type: "command", bash: "node .harness/hooks/handler.mjs post-tool-use", powershell: "node .harness/hooks/handler.mjs post-tool-use" }],
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
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .harness/hooks/handler.mjs post-tool-use" }] }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".qoder");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs pre-tool-use" }] }],
          PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node .harness/hooks/handler.mjs post-tool-use" }] }],
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
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
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
    "PostToolUse": [{ "command": "node .harness/hooks/handler.mjs post-tool-use" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".trae");
      const configPath = path.join(configDir, "settings.json");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [{ command: "node .harness/hooks/handler.mjs pre-tool-use" }],
          PostToolUse: [{ command: "node .harness/hooks/handler.mjs post-tool-use" }],
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
    "PostToolUse": [{ "command": "node .harness/hooks/handler.mjs post-tool-use" }]
  }
}`,
    generateConfig: (projectRoot: string) => {
      const configDir = path.join(projectRoot, ".cursor");
      const configPath = path.join(configDir, "hooks.json");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const config = {
        hooks: {
          PreToolUse: [{ command: "node .harness/hooks/handler.mjs pre-tool-use" }],
          PostToolUse: [{ command: "node .harness/hooks/handler.mjs post-tool-use" }],
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  },
];
