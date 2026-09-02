/**
 * WebSocket / SSE server for real-time trace monitoring
 *
 * Provides real-time event streaming to connected clients.
 * Uses Server-Sent Events (SSE) for browser compatibility.
 *
 * Usage:
 *   hannah monitor              # Start monitoring server (default port 4848)
 *   hannah monitor --port=9090  # Custom port
 *   hannah monitor --open       # Open browser after start
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

interface TraceEntry {
  timestamp: string;
  event: string;
  source: string;
  action: string;
  toolName?: string;
  payload: Record<string, unknown>;
  feedback?: string[];
  sessionId?: string;
  duration?: number;
  modifiedFiles?: string[];
  exitCode?: number;
}

interface SSEClient {
  id: number;
  response: http.ServerResponse;
  connectedAt: number;
}

let nextClientId = 1;
const clients: Map<number, SSEClient> = new Map();
let watcher: fs.FSWatcher | null = null;
let lastKnownSize = 0;
let currentTraceFile = "";

export function runMonitor(args: string[]): void {
  const port = parseInt(getArgValue(args, "--port") || "4848");
  const shouldOpen = args.includes("--open");

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found. Run some agent operations first.");
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/events") {
      handleSSE(req, res);
    } else if (url.pathname === "/api/traces") {
      handleGetTraces(req, res, tracesDir);
    } else if (url.pathname === "/api/stats") {
      handleGetStats(req, res, tracesDir);
    } else if (url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: clients.size }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  server.listen(port, () => {
    console.log("");
    console.log("=== Hannah Real-time Monitor ===");
    console.log("");
    console.log("Server running at http://localhost:" + port);
    console.log("SSE endpoint:  http://localhost:" + port + "/events");
    console.log("API endpoint:  http://localhost:" + port + "/api/traces");
    console.log("Stats:         http://localhost:" + port + "/api/stats");
    console.log("");
    console.log("Watching for trace changes...");
    console.log("Press Ctrl+C to stop.");
    console.log("");

    startWatching(tracesDir);
  });

  if (shouldOpen) {
    setTimeout(() => {
      const { exec } = require("node:child_process");
      const platform = process.platform;
      const url = "http://localhost:" + port;
      if (platform === "win32") exec("start " + url);
      else if (platform === "darwin") exec("open " + url);
      else exec("xdg-open " + url);
    }, 1000);
  }

  server.on("close", () => {
    stopWatching();
  });
}

function handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const clientId = nextClientId++;
  const client: SSEClient = {
    id: clientId,
    response: res,
    connectedAt: Date.now(),
  };
  clients.set(clientId, client);

  console.log("[Monitor] Client #" + clientId + " connected (total: " + clients.size + ")");

  // Send initial heartbeat
  res.write(": connected\n\n");

  req.on("close", () => {
    clients.delete(clientId);
    console.log("[Monitor] Client #" + clientId + " disconnected (total: " + clients.size + ")");
  });
}

function handleGetTraces(req: http.IncomingMessage, res: http.ServerResponse, tracesDir: string): void {
  const url = new URL(req.url || "/", "http://localhost");
  const limit = parseInt(url.searchParams.get("limit") || "100");

  const entries = loadRecentTraces(tracesDir, limit);

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ entries, count: entries.length }));
}

function handleGetStats(req: http.IncomingMessage, res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 10000);

  const stats = {
    totalEvents: entries.length,
    deniedEvents: entries.filter((e) => e.action === "deny").length,
    warnedEvents: entries.filter((e) => e.action === "warn").length,
    allowedEvents: entries.filter((e) => e.action === "allow").length,
    activeClients: clients.size,
    sessions: new Set(entries.map((e) => e.sessionId).filter(Boolean)).size,
    sources: Object.fromEntries(
      [...new Set(entries.map((e) => e.source))].map((s) => [
        s,
        entries.filter((e) => e.source === s).length,
      ]),
    ),
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(stats));
}

function startWatching(tracesDir: string): void {
  // Find the current trace file
  updateCurrentTraceFile(tracesDir);

  // Watch for new trace files
  try {
    watcher = fs.watch(tracesDir, (eventType, filename) => {
      if (filename && filename.endsWith(".jsonl")) {
        updateCurrentTraceFile(tracesDir);
        checkForNewEntries(tracesDir);
      }
    });
  } catch {
    // Fallback: poll every 2 seconds
    setInterval(() => checkForNewEntries(tracesDir), 2000);
  }

  // Initial check
  checkForNewEntries(tracesDir);
}

function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

function updateCurrentTraceFile(tracesDir: string): void {
  const today = new Date().toISOString().split("T")[0];
  currentTraceFile = path.join(tracesDir, today + ".jsonl");
}

function checkForNewEntries(tracesDir: string): void {
  updateCurrentTraceFile(tracesDir);

  if (!fs.existsSync(currentTraceFile)) return;

  const stat = fs.statSync(currentTraceFile);
  if (stat.size <= lastKnownSize) return;

  const fd = fs.openSync(currentTraceFile, "r");
  const buffer = Buffer.alloc(stat.size - lastKnownSize);
  fs.readSync(fd, buffer, 0, buffer.length, lastKnownSize);
  fs.closeSync(fd);

  lastKnownSize = stat.size;

  const newData = buffer.toString("utf8");
  const lines = newData.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TraceEntry;
      broadcastEvent(entry);
    } catch {
      // Skip invalid lines
    }
  }
}

function broadcastEvent(entry: TraceEntry): void {
  const data = JSON.stringify(entry);
  const message = "event: trace\ndata: " + data + "\n\n";

  for (const [, client] of clients) {
    try {
      client.response.write(message);
    } catch {
      clients.delete(client.id);
    }
  }
}

// --- Helpers ---

function findTracesDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".harness", "traces");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getArgValue(args: string[], flag: string): string | null {
  const idx = args.findIndex((a) => a.startsWith(flag));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.includes("=")) return arg.split("=")[1];
  if (idx + 1 < args.length) return args[idx + 1];
  return null;
}

function loadRecentTraces(tracesDir: string, limit: number): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl")).sort().reverse();

  for (const file of files) {
    if (entries.length >= limit) break;
    const filePath = path.join(tracesDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as TraceEntry);
        if (entries.length >= limit) break;
      } catch {
        // Skip
      }
    }
  }

  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
