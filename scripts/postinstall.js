/**
 * Post-install hook — prompts users to run `hannah init` after install.
 */

// Skip in CI / non-interactive environments
if (process.env.CI || !process.stdout.isTTY) {
  process.exit(0);
}

console.log("");
console.log("  ✨ hannah-agent-runtime installed successfully!");
console.log("");
console.log("  Next step: initialize your project with");
console.log("  ▶ npx hannah init");
console.log("");
console.log("  This will create the .harness/ directory and configure");
console.log("  hooks for your AI coding agent (Claude Code, Codex,");
console.log("  Qoder, Copilot, Trae, Cursor, or Antigravity).");
console.log("");
