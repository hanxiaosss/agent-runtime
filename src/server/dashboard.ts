/**
 * WebUI Dashboard server
 *
 * Serves a single-page dashboard for monitoring agent activity.
 *
 * Usage:
 *   hannah web                  # Start dashboard (default port 4849)
 *   hannah web --port=9090      # Custom port
 *   hannah web --open           # Open browser after start
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

export function runWeb(args: string[]): void {
  const port = parseInt(getArgValue(args, "--port") || "4849");
  const shouldOpen = args.includes("--open");

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error("No traces directory found. Run some agent operations first.");
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      serveDashboard(res);
    } else if (url.pathname === "/api/traces") {
      handleTraces(res, tracesDir);
    } else if (url.pathname === "/api/stats") {
      handleStats(res, tracesDir);
    } else if (url.pathname === "/api/sessions") {
      handleSessions(res, tracesDir);
    } else if (url.pathname === "/events") {
      handleSSE(res, tracesDir);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, () => {
    console.log("");
    console.log("=== Hannah Dashboard ===");
    console.log("");
    console.log("Dashboard:  http://localhost:" + port);
    console.log("");
    console.log("Press Ctrl+C to stop.");
    console.log("");

    if (shouldOpen) {
      const { exec } = require("node:child_process");
      const platform = process.platform;
      const url = "http://localhost:" + port;
      if (platform === "win32") exec("start " + url);
      else if (platform === "darwin") exec("open " + url);
      else exec("xdg-open " + url);
    }
  });
}

function serveDashboard(res: http.ServerResponse): void {
  const html = getDashboardHTML();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleTraces(res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 200);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ entries, count: entries.length }));
}

function handleStats(res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 10000);
  const stats = {
    totalEvents: entries.length,
    deniedEvents: entries.filter((e: TraceEntry) => e.action === "deny").length,
    warnedEvents: entries.filter((e: TraceEntry) => e.action === "warn").length,
    allowedEvents: entries.filter((e: TraceEntry) => e.action === "allow").length,
    sessions: new Set(entries.map((e: TraceEntry) => e.sessionId).filter(Boolean)).size,
  };
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(stats));
}

function handleSessions(res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 10000);
  const sessionMap = new Map<string, { count: number; lastSeen: string; sources: Set<string> }>();

  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, { count: 0, lastSeen: e.timestamp, sources: new Set() });
    }
    const s = sessionMap.get(sid)!;
    s.count++;
    if (e.timestamp > s.lastSeen) s.lastSeen = e.timestamp;
    if (e.source) s.sources.add(e.source);
  }

  const sessions = Array.from(sessionMap.entries()).map(([id, data]) => ({
    id,
    name: id.includes('#') ? id.split('#')[0] : id,
    eventCount: data.count,
    lastSeen: data.lastSeen,
    sources: Array.from(data.sources),
  }));

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ sessions }));
}

function handleSSE(res: http.ServerResponse, tracesDir: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": connected\n\n");

  // Poll for new entries
  let lastSize = 0;
  const today = new Date().toISOString().split("T")[0];
  const traceFile = path.join(tracesDir, today + ".jsonl");

  if (fs.existsSync(traceFile)) {
    lastSize = fs.statSync(traceFile).size;
  }

  const interval = setInterval(() => {
    if (!fs.existsSync(traceFile)) return;
    const stat = fs.statSync(traceFile);
    if (stat.size <= lastSize) return;

    const fd = fs.openSync(traceFile, "r");
    const buffer = Buffer.alloc(stat.size - lastSize);
    fs.readSync(fd, buffer, 0, buffer.length, lastSize);
    fs.closeSync(fd);
    lastSize = stat.size;

    const lines = buffer.toString("utf8").split("\n").filter((l: string) => l.trim());
    for (const line of lines) {
      try {
        res.write("event: trace\ndata: " + line + "\n\n");
      } catch {
        clearInterval(interval);
      }
    }
  }, 1000);

  res.on("close", () => clearInterval(interval));
}

// --- Helpers ---

interface TraceEntry {
  timestamp: string;
  event: string;
  source: string;
  action: string;
  toolName?: string;
  payload: Record<string, unknown>;
  feedback?: string[];
  sessionId?: string;
}

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
      } catch { /* skip */ }
    }
  }
  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hannah Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; }
  .header { background: #161b22; padding: 16px 24px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .status { color: #3fb950; font-size: 13px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 32px; font-weight: 700; margin-top: 4px; }
  .stat-card .value.denied { color: #f85149; }
  .stat-card .value.warned { color: #d29922; }
  .stat-card .value.allowed { color: #3fb950; }
  .section { padding: 0 24px 24px; }
  .section h2 { font-size: 15px; margin-bottom: 12px; color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 10px 16px; background: #1c2128; font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 16px; border-top: 1px solid #21262d; font-size: 13px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.deny { background: #f8514922; color: #f85149; }
  .badge.allow { background: #3fb95022; color: #3fb950; }
  .badge.warn { background: #d2992222; color: #d29922; }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3fb950; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
</head>
<body>
  <div class="header">
    <h1>Hannah Dashboard</h1>
    <div class="status"><span class="live-dot"></span>Live</div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="label">Total Events</div>
      <div class="value" id="total">-</div>
    </div>
    <div class="stat-card">
      <div class="label">Denied</div>
      <div class="value denied" id="denied">-</div>
    </div>
    <div class="stat-card">
      <div class="label">Warned</div>
      <div class="value warned" id="warned">-</div>
    </div>
    <div class="stat-card">
      <div class="label">Sessions</div>
      <div class="value" id="sessions">-</div>
    </div>
  </div>

  <div class="section">
    <h2>Recent Events</h2>
    <table>
      <thead>
        <tr><th>Time</th><th>Action</th><th>Event</th><th>Source</th><th>Tool</th></tr>
      </thead>
      <tbody id="events"></tbody>
    </table>
  </div>

  <div class="section">
    <h2>Active Sessions</h2>
    <table>
      <thead>
        <tr><th>Session</th><th>Events</th><th>Sources</th><th>Last Active</th></tr>
      </thead>
      <tbody id="sessions-table"></tbody>
    </table>
  </div>

<script>
async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  document.getElementById('total').textContent = data.totalEvents;
  document.getElementById('denied').textContent = data.deniedEvents;
  document.getElementById('warned').textContent = data.warnedEvents;
  document.getElementById('sessions').textContent = data.sessions;
}

async function loadTraces() {
  const res = await fetch('/api/traces');
  const data = await res.json();
  const tbody = document.getElementById('events');
  tbody.innerHTML = '';
  const recent = data.entries.slice(-50).reverse();
  for (const e of recent) {
    const tr = document.createElement('tr');
    const time = new Date(e.timestamp).toLocaleTimeString();
    const badge = '<span class="badge ' + (e.action || 'allow') + '">' + (e.action || 'allow').toUpperCase() + '</span>';
    const toolName = e.payload?.toolName || e.toolName || '-';
    tr.innerHTML = '<td>' + time + '</td><td>' + badge + '</td><td>' + (e.event || '-') + '</td><td>' + (e.source || '-') + '</td><td>' + toolName + '</td>';
    tbody.appendChild(tr);
  }
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  const data = await res.json();
  const tbody = document.getElementById('sessions-table');
  tbody.innerHTML = '';
  for (const s of data.sessions) {
    const tr = document.createElement('tr');
    const time = new Date(s.lastSeen).toLocaleTimeString();
    tr.innerHTML = '<td>' + (s.name || s.id) + '</td><td>' + s.eventCount + '</td><td>' + s.sources.join(', ') + '</td><td>' + time + '</td>';
    tbody.appendChild(tr);
  }
}

// SSE for live updates
const evtSource = new EventSource('/events');
evtSource.addEventListener('trace', function(e) {
  loadStats();
  loadTraces();
});

loadStats();
loadTraces();
loadSessions();
setInterval(loadStats, 10000);
setInterval(loadSessions, 30000);
</script>
</body>
</html>`;
}
