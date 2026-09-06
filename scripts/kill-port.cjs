#!/usr/bin/env node
/**
 * Kill the process occupying a given port (cross-platform).
 * Usage: node scripts/kill-port.cjs [port]
 * Default port: 4849
 */

const { execSync } = require("node:child_process");

const port = parseInt(process.argv[2] || "4849");

function killPortOccupier(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        "netstat -ano | findstr :" + port + " | findstr LISTENING",
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const lines = output.trim().split("\n").filter(Boolean);
      if (lines.length === 0) {
        console.log("  \u2713 Port " + port + " is free");
        return false;
      }
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync("taskkill /PID " + pid + " /F", {
            stdio: ["pipe", "pipe", "pipe"],
          });
          console.log(
            "  \u26a0\ufe0f  Killed process PID " +
              pid +
              " occupying port " +
              port,
          );
        } catch (_) {
          // Process may have already exited
        }
      }
      return pids.size > 0;
    } else {
      const output = execSync("lsof -ti:" + port, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pids = output.trim().split("\n").filter(Boolean);
      if (pids.length === 0) {
        console.log("  \u2713 Port " + port + " is free");
        return false;
      }
      for (const pid of pids) {
        try {
          execSync("kill -9 " + pid, { stdio: ["pipe", "pipe", "pipe"] });
          console.log(
            "  \u26a0\ufe0f  Killed process PID " +
              pid +
              " occupying port " +
              port,
          );
        } catch (_) {
          // Process may have already exited
        }
      }
      return true;
    }
  } catch (_) {
    console.log("  \u2713 Port " + port + " is free");
    return false;
  }
}

console.log("  \ud83d\udd0d Checking port " + port + "...");
killPortOccupier(port);
