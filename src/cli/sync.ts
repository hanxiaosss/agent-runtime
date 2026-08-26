/**
 * sync command
 *
 * Synchronizes semantic hooks with project rules and tech stack
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createSemanticEngine } from "../semantic/engine.js";

export async function runSync(args: string[]): Promise<void> {
  const targetDir = args[0] || process.cwd();
  
  // Check if .harness exists
  const harnessDir = path.join(targetDir, ".harness");
  if (!fs.existsSync(harnessDir)) {
    console.error("Error: .harness/ directory not found.");
    console.error("Run 'hannah init' first to initialize the project.");
    process.exit(1);
  }
  
  console.log("Syncing semantic hooks...");
  console.log("");
  
  try {
    // Create and initialize semantic engine
    const engine = await createSemanticEngine(targetDir);
    
    // Get sync results
    const hooks = engine.getHooks();
    const techStackHooks = engine.getHooksBySource('tech-stack');
    const agentMdHooks = engine.getHooksBySource('agent-md');
    
    console.log("✓ Semantic hooks synced successfully");
    console.log("");
    console.log(`  Total hooks: ${hooks.length}`);
    console.log(`  ├─ Tech stack hooks: ${techStackHooks.length}`);
    console.log(`  └─ Agent.md hooks: ${agentMdHooks.length}`);
    console.log("");
    
    // List hooks
    if (hooks.length > 0) {
      console.log("  Active hooks:");
      for (const hook of hooks) {
        const sourceIcon = hook.source === 'tech-stack' ? '⚙' : 
                          hook.source === 'agent-md' ? '📄' : '🔧';
        console.log(`    ${sourceIcon} ${hook.name} - ${hook.description}`);
      }
      console.log("");
    }
    
    // Save hooks metadata
    const semanticDir = path.join(harnessDir, "semantic-hooks");
    if (!fs.existsSync(semanticDir)) {
      fs.mkdirSync(semanticDir, { recursive: true });
    }
    
    const hooksMetadata = hooks.map(h => ({
      name: h.name,
      description: h.description,
      version: h.version,
      source: h.source,
    }));
    
    fs.writeFileSync(
      path.join(semanticDir, "hooks.json"),
      JSON.stringify(hooksMetadata, null, 2)
    );
    
    console.log("  ✓ Saved hooks metadata to .harness/semantic-hooks/hooks.json");
    console.log("");
    
  } catch (err: any) {
    console.error("Error syncing semantic hooks:", err.message);
    process.exit(1);
  }
}
