/**
 * Agent resource scanning and symlinking.
 * Discovers skills/MCP configs from other agents and links them to the selected agent.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface AgentResourceDef {
  agentValue: string;
  skillsDirs: string[];
  mcpConfigFiles: string[];
  mcpSettingsFiles: Array<{ path: string; field: string }>;
}

const AGENT_RESOURCE_MAP: AgentResourceDef[] = [
  {
    agentValue: "claude-code",
    skillsDirs: [".claude/commands", ".claude/skills"],
    mcpConfigFiles: [],
    mcpSettingsFiles: [{ path: ".claude/settings.json", field: "mcpServers" }],
  },
  {
    agentValue: "copilot",
    skillsDirs: [".github/instructions"],
    mcpConfigFiles: [],
    mcpSettingsFiles: [],
  },
  {
    agentValue: "qoder",
    skillsDirs: [".qoder/skills"],
    mcpConfigFiles: [],
    mcpSettingsFiles: [{ path: ".qoder/settings.json", field: "mcpServers" }],
  },
  {
    agentValue: "codex",
    skillsDirs: [".codex/skills"],
    mcpConfigFiles: [".codex/mcp.json"],
    mcpSettingsFiles: [],
  },
  {
    agentValue: "trae",
    skillsDirs: [".trae/skills"],
    mcpConfigFiles: [],
    mcpSettingsFiles: [{ path: ".trae/settings.json", field: "mcpServers" }],
  },
  {
    agentValue: "cursor",
    skillsDirs: [".cursor/rules"],
    mcpConfigFiles: [".cursor/mcp.json"],
    mcpSettingsFiles: [],
  },
  {
    agentValue: "antigravity",
    skillsDirs: [".agents/skills"],
    mcpConfigFiles: [".agents/mcp.json"],
    mcpSettingsFiles: [{ path: ".agents/settings.json", field: "mcpServers" }],
  },
];

interface DiscoveredResource {
  sourceAgent: string;
  type: "skills-dir" | "mcp-file" | "mcp-settings";
  sourcePath: string;
  relativePath: string;
  mcpServers?: Record<string, unknown>;
}

const GENERIC_MCP_CONFIG_PATTERNS = [
  "mcp.json",
  "mcp-config.json",
  "mcp-servers.json",
  ".mcp.json",
  "mcp_settings.json",
];

/**
 * Discover MCP config files generically across the project.
 * Scans common locations and patterns that may not be tied to a specific agent.
 */
export function discoverProjectMcpConfigs(projectRoot: string): Array<{ path: string; relativePath: string }> {
  const found: Array<{ path: string; relativePath: string }> = [];
  const seen = new Set<string>();

  // Scan project root for common MCP config filenames
  for (const pattern of GENERIC_MCP_CONFIG_PATTERNS) {
    const absPath = path.join(projectRoot, pattern);
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      const realPath = fs.realpathSync(absPath);
      if (!seen.has(realPath)) {
        seen.add(realPath);
        found.push({ path: absPath, relativePath: pattern });
      }
    }
  }

  // Scan common subdirectories for MCP configs
  const scanDirs = [".vscode", ".config", "config", "."];
  for (const dir of scanDirs) {
    const absDir = path.join(projectRoot, dir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;

    try {
      const entries = fs.readdirSync(absDir);
      for (const entry of entries) {
        const lower = entry.toLowerCase();
        if (lower.includes("mcp") && lower.endsWith(".json")) {
          const absPath = path.join(absDir, entry);
          if (!fs.statSync(absPath).isFile()) continue;
          const realPath = fs.realpathSync(absPath);
          if (seen.has(realPath)) continue;
          seen.add(realPath);
          const relPath = path.relative(projectRoot, absPath);
          found.push({ path: absPath, relativePath: relPath });
        }
      }
    } catch {
      // ignore permission errors
    }
  }

  return found;
}

export function scanAgentResources(projectRoot: string, selectedAgentValue: string): DiscoveredResource[] {
  const discovered: DiscoveredResource[] = [];

  for (const agentDef of AGENT_RESOURCE_MAP) {
    if (agentDef.agentValue === selectedAgentValue) continue;

    for (const skillsDir of agentDef.skillsDirs) {
      const absPath = path.join(projectRoot, skillsDir);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
        const entries = fs.readdirSync(absPath);
        if (entries.length > 0) {
          discovered.push({
            sourceAgent: agentDef.agentValue,
            type: "skills-dir",
            sourcePath: absPath,
            relativePath: skillsDir,
          });
        }
      }
    }

    for (const mcpFile of agentDef.mcpConfigFiles) {
      const absPath = path.join(projectRoot, mcpFile);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        discovered.push({
          sourceAgent: agentDef.agentValue,
          type: "mcp-file",
          sourcePath: absPath,
          relativePath: mcpFile,
        });
      }
    }

    for (const settingsFile of agentDef.mcpSettingsFiles) {
      const absPath = path.join(projectRoot, settingsFile.path);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        try {
          const content = JSON.parse(fs.readFileSync(absPath, "utf-8"));
          const mcpServers = content[settingsFile.field];
          if (mcpServers && typeof mcpServers === "object" && Object.keys(mcpServers).length > 0) {
            discovered.push({
              sourceAgent: agentDef.agentValue,
              type: "mcp-settings",
              sourcePath: absPath,
              relativePath: settingsFile.path,
              mcpServers,
            });
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  }

  // Also discover generic project-level MCP configs
  const projectMcpConfigs = discoverProjectMcpConfigs(projectRoot);
  for (const mcpConfig of projectMcpConfigs) {
    // Skip if this config is already associated with a known agent
    const isKnownAgentConfig = AGENT_RESOURCE_MAP.some(agent =>
      agent.mcpConfigFiles.some(f => mcpConfig.relativePath === f) ||
      agent.mcpSettingsFiles.some(s => mcpConfig.relativePath === s.path)
    );
    if (isKnownAgentConfig) continue;

    discovered.push({
      sourceAgent: "project",
      type: "mcp-file",
      sourcePath: mcpConfig.path,
      relativePath: mcpConfig.relativePath,
    });
  }

  return discovered;
}

function getSelectedAgentTargets(selectedAgentValue: string): { skillsDir: string; mcpTarget: string } {
  const agentDef = AGENT_RESOURCE_MAP.find(a => a.agentValue === selectedAgentValue);
  if (!agentDef) {
    return { skillsDir: "", mcpTarget: "" };
  }
  return {
    skillsDir: agentDef.skillsDirs[0] || "",
    mcpTarget: agentDef.mcpConfigFiles[0] || agentDef.mcpSettingsFiles[0]?.path || "",
  };
}

export function linkAgentResources(
  projectRoot: string,
  resources: DiscoveredResource[],
  selectedAgentValue: string,
): void {
  if (resources.length === 0) return;

  const targets = getSelectedAgentTargets(selectedAgentValue);
  const mergedMcpServers: Record<string, unknown> = {};

  for (const resource of resources) {
    if (resource.type === "skills-dir") {
      if (!targets.skillsDir) continue;
      const targetSkillsAbs = path.join(projectRoot, targets.skillsDir);
      if (!fs.existsSync(targetSkillsAbs)) {
        fs.mkdirSync(targetSkillsAbs, { recursive: true });
      }

      const entries = fs.readdirSync(resource.sourcePath);
      for (const entry of entries) {
        const srcEntry = path.join(resource.sourcePath, entry);
        const dstEntry = path.join(targetSkillsAbs, entry);

        if (fs.existsSync(dstEntry)) {
          console.log("    ⚠ Skipped (already exists): " + entry);
          continue;
        }

        try {
          const stat = fs.statSync(srcEntry);
          if (stat.isDirectory()) {
            fs.symlinkSync(srcEntry, dstEntry, "junction");
          } else {
            fs.symlinkSync(srcEntry, dstEntry, "file");
          }
          console.log("    🔗 Linked skill: " + entry + " ← " + resource.relativePath + "/" + entry);
        } catch (err: any) {
          console.log("    ⚠ Failed to link " + entry + ": " + err.message);
        }
      }
    } else if (resource.type === "mcp-file") {
      if (!targets.mcpTarget) continue;
      const targetMcpAbs = path.join(projectRoot, targets.mcpTarget);
      const targetDir = path.dirname(targetMcpAbs);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(targetMcpAbs)) {
        console.log("    ⚠ Skipped MCP config (already exists): " + targets.mcpTarget);
        continue;
      }

      try {
        fs.symlinkSync(resource.sourcePath, targetMcpAbs, "file");
        console.log("    🔗 Linked MCP config: " + targets.mcpTarget + " ← " + resource.relativePath);
      } catch (err: any) {
        console.log("    ⚠ Failed to link MCP config: " + err.message);
      }
    } else if (resource.type === "mcp-settings") {
      if (resource.mcpServers) {
        for (const [name, config] of Object.entries(resource.mcpServers)) {
          if (!mergedMcpServers[name]) {
            mergedMcpServers[name] = config;
          }
        }
      }
    }
  }

  // Merge collected MCP servers into the selected agent settings
  if (Object.keys(mergedMcpServers).length > 0) {
    const agentDef = AGENT_RESOURCE_MAP.find(a => a.agentValue === selectedAgentValue);
    const settingsEntry = agentDef?.mcpSettingsFiles[0];

    if (settingsEntry) {
      const settingsAbs = path.join(projectRoot, settingsEntry.path);
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsAbs)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsAbs, "utf-8"));
        } catch {
          // ignore
        }
      }

      const existing = (settings[settingsEntry.field] as Record<string, unknown>) || {};
      settings[settingsEntry.field] = { ...mergedMcpServers, ...existing };

      const dir = path.dirname(settingsAbs);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(settingsAbs, JSON.stringify(settings, null, 2), "utf-8");

      const serverNames = Object.keys(mergedMcpServers).join(", ");
      console.log("    🔗 Merged MCP servers from other agents: " + serverNames);
    } else {
      const targets2 = getSelectedAgentTargets(selectedAgentValue);
      if (targets2.mcpTarget) {
        const mcpAbs = path.join(projectRoot, targets2.mcpTarget);
        const dir = path.dirname(mcpAbs);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(mcpAbs)) {
          fs.writeFileSync(mcpAbs, JSON.stringify({ mcpServers: mergedMcpServers }, null, 2), "utf-8");
          const serverNames = Object.keys(mergedMcpServers).join(", ");
          console.log("    🔗 Wrote MCP servers to " + targets2.mcpTarget + ": " + serverNames);
        }
      }
    }
  }


/**
 * Generic MCP config file patterns to discover in the project.
 * These are common filenames used across various tools and editors.
 */}