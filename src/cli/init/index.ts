/**
 * init command - Generate .harness/ directory in the current project.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  CONFIG_YAML,
  PROTECTED_FILES_YAML,
  MCP_SAFETY_YAML,
  GIT_SAFETY_YAML,
  SEMANTIC_RULES_YAML,
  HANDLER_MJS,
  README_MD,
} from "./templates.js";
import { AgentConfig, AGENTS } from "./agent-config.js";
import { scanAgentResources, linkAgentResources } from "./agent-resources.js";

export async function runInit(args: string[]): Promise<void> {
  // Parse arguments: separate directory from options
  const dirArgs = args.filter(arg => !arg.startsWith("--"));
  const optionArgs = args.filter(arg => arg.startsWith("--"));
  
  const targetDir = dirArgs[0] || process.cwd();
  const harnessDir = path.join(targetDir, ".harness");

  // Check if .harness already exists
  if (fs.existsSync(harnessDir)) {
    console.log(".harness/ already exists. Overwriting...");
  }

  // Get project name from package.json or directory
  let projectName = path.basename(targetDir);
  const pkgPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      projectName = pkg.name || projectName;
    } catch {
      // ignore
    }
  }

  // Interactive agent selection
  console.log("\n? Select your AI coding agent:");
  
  let selectedAgent: AgentConfig;
  
  // Check if --agent flag is provided
  const agentFlag = optionArgs.find(arg => arg.startsWith("--agent="));
  if (agentFlag) {
    const agentValue = agentFlag.split("=")[1];
    const found = AGENTS.find(a => a.value === agentValue || a.name.toLowerCase() === agentValue.toLowerCase());
    if (found) {
      selectedAgent = found;
      console.log(`✓ Selected: ${selectedAgent.name}`);
    } else {
      console.error(`✗ Unknown agent: ${agentValue}`);
      console.error("Available agents:", AGENTS.map(a => a.value).join(", "));
      process.exit(1);
    }
  } else {
    // Interactive mode with arrow keys
    let currentIndex = 0;
    
    // Check if stdin supports raw mode (TTY)
    const isTTY = process.stdin.isTTY;
    
    if (!isTTY) {
      // Fallback to simple number input for non-TTY environments
      console.log(`\n  Enter number (1-${AGENTS.length}): `);
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question("  > ", (ans) => {
          rl.close();
          resolve(ans.trim());
        });
      });
      
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < AGENTS.length) {
        selectedAgent = AGENTS[index];
        console.log(`\n✓ Selected: ${selectedAgent.name}`);
      } else {
        console.error("\n✗ Invalid selection");
        process.exit(1);
      }
    } else {
      // Full interactive mode with arrow keys
      // Render options
      const renderOptions = () => {
        // Clear previous render
        process.stdout.write(`\x1b[${AGENTS.length}A\x1b[0J`);
        
        AGENTS.forEach((agent, index) => {
          const isSelected = index === currentIndex;
          const prefix = isSelected ? "❯" : " ";
          const highlight = isSelected ? "\x1b[36m" : "";
          const reset = isSelected ? "\x1b[0m" : "";
          console.log(`  ${prefix} ${highlight}${agent.name}${reset} - ${agent.description}`);
        });
      };
      
      // Initial render
      AGENTS.forEach((agent, index) => {
        console.log(`    ${agent.name} - ${agent.description}`);
      });
      renderOptions();
      
      // Setup stdin for raw input
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
    
    // Wait for user input
    selectedAgent = await new Promise<AgentConfig>((resolve) => {
      const onKeyPress = (key: string) => {
        // Ctrl+C
        if (key === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(0);
        }
        
        // Up arrow
        if (key === "\u001b[A" || key === "k") {
          currentIndex = currentIndex > 0 ? currentIndex - 1 : AGENTS.length - 1;
          renderOptions();
        }
        
        // Down arrow
        if (key === "\u001b[B" || key === "j") {
          currentIndex = currentIndex < AGENTS.length - 1 ? currentIndex + 1 : 0;
          renderOptions();
        }
        
        // Enter
        if (key === "\r" || key === "\n") {
          stdin.removeListener("data", onKeyPress);
          stdin.setRawMode(false);
          stdin.pause();
          console.log(`\n✓ Selected: ${AGENTS[currentIndex].name}`);
          resolve(AGENTS[currentIndex]);
        }
      };
      
      stdin.on("data", onKeyPress);
    });
    } // End of TTY mode else block
  }

  // Create directories
  fs.mkdirSync(path.join(harnessDir, "policies"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "semantic-rules"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "traces"), { recursive: true });

  // Write files
  const files: Array<[string, string]> = [
    ["config.yaml", CONFIG_YAML.replace("{project}", projectName).replace("{agent}", selectedAgent.value)],
    ["policies/protected-files.yaml", PROTECTED_FILES_YAML],
    ["policies/mcp-safety.yaml", MCP_SAFETY_YAML],
    ["policies/git-safety.yaml", GIT_SAFETY_YAML],
    ["semantic-rules/custom.yaml", SEMANTIC_RULES_YAML],
    ["hooks/handler.mjs", HANDLER_MJS],
    ["README.md", README_MD],
  ];

  for (const [filePath, content] of files) {
    const fullPath = path.join(harnessDir, filePath);
    fs.writeFileSync(fullPath, content.trimStart(), "utf-8");
    console.log(`  ✓ .harness/${filePath}`);
  }

  // Generate agent-specific configuration
  console.log(`\n  ✓ Generating ${selectedAgent.name} configuration...`);
  selectedAgent.generateConfig(targetDir);
  console.log(`  ✓ ${selectedAgent.configPath}`);

  // Scan and link agent resources (skills & MCP configs) from other agents
  console.log("\n  \u2713 Scanning for existing agent resources...");
  try {
    const discovered = scanAgentResources(targetDir, selectedAgent.value);
    if (discovered.length > 0) {
      console.log("    \u251c\u2500 Found " + discovered.length + " resource(s) from other agents:");
      for (const r of discovered) {
        console.log("    \u2502  \u2022 [" + r.sourceAgent + "] " + r.type + ": " + r.relativePath);
      }
      console.log("    \u2514\u2500 Linking to " + selectedAgent.name + "...");
      linkAgentResources(targetDir, discovered, selectedAgent.value);
    } else {
      console.log("    No existing agent resources found to link.");
    }
  } catch (err: any) {
    console.log("    \u26a0 Agent resource linking skipped: " + err.message);
  }

  // Initialize semantic hooks
  console.log("\n  ✓ Scanning project for semantic rules...");
  try {
    const { SemanticHookAdapter } = await import("../../semantic/adapter.js");
    const { loadSemanticRulesFromDir } = await import("../../cli/yaml-loader.js");

    const adapter = new SemanticHookAdapter({ projectRoot: targetDir });

    // Load user-defined semantic rules from YAML
    const yamlRulesDir = path.join(harnessDir, "semantic-rules");
    const yamlRules = loadSemanticRulesFromDir(yamlRulesDir);
    if (yamlRules.length > 0) {
      adapter.addRules(yamlRules);
      console.log(`    ├─ ${yamlRules.length} YAML semantic rules`);
    }

    // Scan agent.md and convert to semantic rules
    let agentMdRules: import("../../semantic/types.js").SemanticRule[] = [];
    try {
      const { scanProjectRules } = await import("../../semantic/agent-md-scanner.js");
      const { generateSemanticRulesFromExtracted } = await import("../../semantic/hook-generator.js");
      const extracted = await scanProjectRules(targetDir);
      agentMdRules = generateSemanticRulesFromExtracted(extracted);
      if (agentMdRules.length > 0) {
        adapter.addRules(agentMdRules);
        console.log(`    ├─ ${agentMdRules.length} agent.md rules`);

        // Write agent.md rules to semantic-rules/agent-md.yaml
        // so handler.mjs can load them at runtime
        const yamlLines: string[] = ["# Auto-generated from agent.md — do not edit manually", "rules:"];
        for (const r of agentMdRules) {
          yamlLines.push(`  - name: ${JSON.stringify(r.name)}`);
          if (r.description) yamlLines.push(`    description: ${JSON.stringify(r.description)}`);
          yamlLines.push(`    match:`);
          const m = r.match;
          const q = (s: string) => JSON.stringify(s);
          if (m.tool_name && m.tool_name.length) yamlLines.push(`      tool_name: [${m.tool_name.map(q).join(", ")}]`);
          if (m.file_path && m.file_path.length) yamlLines.push(`      file_path: [${m.file_path.map(q).join(", ")}]`);
          if (m.content && m.content.length) yamlLines.push(`      content: [${m.content.map(q).join(", ")}]`);
          if (m.command && m.command.length) yamlLines.push(`      command: [${m.command.map(q).join(", ")}]`);
          if (m.mcp_server && m.mcp_server.length) yamlLines.push(`      mcp_server: [${m.mcp_server.map(q).join(", ")}]`);
          if (m.file_type && m.file_type.length) yamlLines.push(`      file_type: [${m.file_type.map(q).join(", ")}]`);
          yamlLines.push(`    action: ${r.action}`);
          yamlLines.push(`    feedback: ${JSON.stringify(r.feedback)}`);
          if (r.suggestions && r.suggestions.length) {
            yamlLines.push(`    suggestions: [${r.suggestions.map(q).join(", ")}]`);
          }
        }
        fs.writeFileSync(
          path.join(harnessDir, "semantic-rules", "agent-md.yaml"),
          yamlLines.join("\n") + "\n",
          "utf-8"
        );
        console.log(`    └─ Written to semantic-rules/agent-md.yaml`);
      }
    } catch {
      // agent.md scanning is optional
    }

    const allRules = adapter.ruleEngine.getRules();
    const builtInRules = adapter.ruleEngine.getRulesBySource('built-in');
    console.log(`  ✓ ${allRules.length} semantic rules (${builtInRules.length} built-in)`);

    // Create semantic-hooks directory and save metadata
    const semanticDir = path.join(harnessDir, "semantic-hooks");
    if (!fs.existsSync(semanticDir)) {
      fs.mkdirSync(semanticDir, { recursive: true });
    }

    const rulesMetadata = allRules.map(r => ({
      name: r.name,
      description: r.description,
      source: r.source,
      action: r.action,
      enabled: r.enabled !== false,
      priority: r.priority ?? 100,
      match: r.match,
    }));

    fs.writeFileSync(
      path.join(semanticDir, "hooks.json"),
      JSON.stringify(rulesMetadata, null, 2)
    );
    console.log(`  ✓ Saved rules metadata to .harness/semantic-hooks/hooks.json`);
  } catch (err: any) {
    console.log(`  ⚠ Semantic hook initialization skipped: ${err.message}`);
  }

  console.log("");

  // VSCode detection and setup
  const vscodeDir = path.join(targetDir, ".vscode");
  const hasVSCode = fs.existsSync(vscodeDir);
  const withVSCode = optionArgs.includes("--with-vscode");
  const noVSCode = optionArgs.includes("--no-vscode");

  if (!noVSCode && (hasVSCode || withVSCode)) {
    // Write VSCode settings
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }

    const settingsPath = path.join(vscodeDir, "settings.json");
    let settings: Record<string, unknown> = {};

    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      } catch {
        // ignore
      }
    }

    settings["agentRuntime.traceDir"] = ".harness/traces";
    settings["agentRuntime.autoRefresh"] = true;
    settings["agentRuntime.maxEntries"] = 1000;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log("  \u2713 VSCode settings configured");

    if (hasVSCode) {
      console.log("");
      console.log("  \ud83d\udcfa VSCode detected. Install the Agent Runtime extension:");
      console.log("     code --install-extension editors/vscode/agent-runtime-trace-0.2.0.vsix");
      console.log("     Then open Secondary Sidebar (Ctrl+Shift+P \u2192 'View: Show Secondary Sidebar')");
    }
  }
  console.log("Done! Next steps:");

  console.log(`  1. Agent configuration generated: ${selectedAgent.configPath}`);
  console.log("  2. Sync semantic hooks:           hannah sync");
  console.log("  3. View traces:                   hannah trace");

}
