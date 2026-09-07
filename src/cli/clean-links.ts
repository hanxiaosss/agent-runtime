/**
 * clean-links command
 *
 * Removes all symlinks created by `hannah init` agent resource linking.
 * This helps keep git status clean when switching between agents.
 *
 * Usage:
 *   hannah clean-links              - dry run, show what would be removed
 *   hannah clean-links --force      - actually remove symlinks
 *   hannah clean-links -f           - short form
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Agent resource definitions — must match agent-resources.ts
 */
const AGENT_SKILLS_DIRS: Record<string, string[]> = {
  "claude-code": [".claude/commands", ".claude/skills"],
  copilot: [".github/instructions"],
  qoder: [".qoder/skills"],
  codex: [".codex/skills"],
  trae: [".trae/skills"],
  cursor: [".cursor/rules"],
  antigravity: [".agents/skills"],
};

const AGENT_MCP_FILES: Record<string, string[]> = {
  "claude-code": [],
  copilot: [],
  qoder: [],
  codex: [".codex/mcp.json"],
  trae: [],
  cursor: [".cursor/mcp.json"],
  antigravity: [".agents/mcp.json"],
};

interface SymlinkInfo {
  path: string;
  relativePath: string;
  target: string;
  type: "file" | "dir";
}

/**
 * Find all symlinks in agent resource directories
 */
function findAgentSymlinks(projectRoot: string): SymlinkInfo[] {
  const symlinks: SymlinkInfo[] = [];

  // Check all known agent directories for symlinks
  for (const [agent, skillsDirs] of Object.entries(AGENT_SKILLS_DIRS)) {
    for (const dir of skillsDirs) {
      const absDir = path.join(projectRoot, dir);
      if (!fs.existsSync(absDir)) continue;

      try {
        const entries = fs.readdirSync(absDir);
        for (const entry of entries) {
          const entryPath = path.join(absDir, entry);
          try {
            const lstat = fs.lstatSync(entryPath);
            if (lstat.isSymbolicLink()) {
              const target = fs.readlinkSync(entryPath);
              symlinks.push({
                path: entryPath,
                relativePath: path.relative(projectRoot, entryPath),
                target,
                type: lstat.isDirectory() ? "dir" : "file",
              });
            }
          } catch {
            // skip entries we can't stat
          }
        }
      } catch {
        // skip dirs we can't read
      }
    }
  }

  // Check MCP config files
  for (const [agent, mcpFiles] of Object.entries(AGENT_MCP_FILES)) {
    for (const file of mcpFiles) {
      const absPath = path.join(projectRoot, file);
      if (!fs.existsSync(absPath)) continue;

      try {
        const lstat = fs.lstatSync(absPath);
        if (lstat.isSymbolicLink()) {
          const target = fs.readlinkSync(absPath);
          symlinks.push({
            path: absPath,
            relativePath: path.relative(projectRoot, absPath),
            target,
            type: "file",
          });
        }
      } catch {
        // skip
      }
    }
  }

  return symlinks;
}

export function runCleanLinks(args: string[]): void {
  const projectRoot = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const dryRun = !force;

  console.log("");
  console.log("  🔗 Hannah Clean Links");
  console.log("  " + "─".repeat(40));
  console.log("");

  if (dryRun) {
    console.log("  (dry run — use --force or -f to actually remove)");
    console.log("");
  }

  const symlinks = findAgentSymlinks(projectRoot);

  if (symlinks.length === 0) {
    console.log("  ✓ No agent symlinks found.");
    console.log("");
    return;
  }

  console.log(`  Found ${symlinks.length} symlink(s):`);
  console.log("");

  for (const link of symlinks) {
    const typeIcon = link.type === "dir" ? "📁" : "📄";
    console.log(`    ${typeIcon} ${link.relativePath}`);
    console.log(`       → ${link.target}`);
  }

  console.log("");

  if (dryRun) {
    console.log("  Run with --force to remove these symlinks.");
    console.log("");
    return;
  }

  // Remove symlinks
  let removed = 0;
  let failed = 0;

  for (const link of symlinks) {
    try {
      fs.unlinkSync(link.path);
      console.log(`    ✓ Removed: ${link.relativePath}`);
      removed++;
    } catch (err: any) {
      console.log(`    ✗ Failed: ${link.relativePath} — ${err.message}`);
      failed++;
    }
  }

  console.log("");
  console.log(`  Done: ${removed} removed, ${failed} failed.`);
  console.log("");
}
