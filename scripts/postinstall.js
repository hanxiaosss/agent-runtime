/**
 * Post-install hook — writes a marker file so the CLI can show
 * the welcome message on first run.
 *
 * npm suppresses stdout from lifecycle scripts, so we can't just
 * console.log here. Instead, we write a marker file that bin.ts
 * checks on first invocation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Skip in CI environments
if (process.env.CI) {
  process.exit(0);
}

try {
  // Write marker file to package root
  const markerPath = path.join(__dirname, "..", ".hannah-init-pending");
  fs.writeFileSync(markerPath, new Date().toISOString() + "\n", "utf-8");
} catch {
  // Silently ignore errors — this is a best-effort feature
}
