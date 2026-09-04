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
import { exec } from "node:child_process";

export function runWeb(args: string[]): void {
  const port = parseInt(getArgValue(args, "--port") || "4849");
  const shouldOpen = args.includes("--open");

  const tracesDir = findTracesDir();
  if (!tracesDir) {
    console.error(
      "No traces directory found. Run some agent operations first.",
    );
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
    } else if (url.pathname === "/api/rounds") {
      handleRounds(res, tracesDir);
    } else if (url.pathname === "/events") {
      handleSSE(res, tracesDir);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error("");
      console.error(`Error: Port ${port} is already in use.`);
      console.error("");
      console.error("Solutions:");
      console.error(`  1. Use a different port: hannah web --port=${port + 1}`);
      console.error(`  2. Kill the process using port ${port}:`);
      if (process.platform === "win32") {
        console.error(`     netstat -ano | findstr :${port}`);
        console.error(`     taskkill /PID <pid> /F`);
      } else {
        console.error(`     lsof -ti:${port} | xargs kill -9`);
      }
      console.error("");
      process.exit(1);
    } else {
      console.error("Server error:", err.message);
      process.exit(1);
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
  const metadata = loadSessionMetadata(tracesDir);
  const rounds = detectRounds(entries, metadata);
  const stats = {
    totalEvents: entries.length,
    deniedEvents: entries.filter((e: TraceEntry) => e.action === "deny").length,
    warnedEvents: entries.filter((e: TraceEntry) => e.action === "warn").length,
    allowedEvents: entries.filter((e: TraceEntry) => e.action === "allow")
      .length,
    sessions: new Set(
      entries.map((e: TraceEntry) => e.sessionId).filter(Boolean),
    ).size,
    rounds: rounds.length,
  };
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(stats));
}

function handleSessions(res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 10000);
  const metadata = loadSessionMetadata(tracesDir);
  const allRounds = detectRounds(entries, metadata);

  // Group rounds by session
  const roundsBySession = new Map<string, RoundInfo[]>();
  for (const r of allRounds) {
    if (!roundsBySession.has(r.sessionId)) {
      roundsBySession.set(r.sessionId, []);
    }
    roundsBySession.get(r.sessionId)!.push(r);
  }

  // Build session map from traces
  const sessionMap = new Map<
    string,
    { count: number; lastSeen: string; sources: Set<string> }
  >();
  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        count: 0,
        lastSeen: e.timestamp,
        sources: new Set(),
      });
    }
    const s = sessionMap.get(sid)!;
    s.count++;
    if (e.timestamp > s.lastSeen) s.lastSeen = e.timestamp;
    if (e.source) s.sources.add(e.source);
  }

  const sessions: SessionInfo[] = Array.from(sessionMap.entries()).map(
    ([id, data]) => {
      const meta = metadata.get(id);
      const name = meta?.title || (id.includes("#") ? id.split("#")[0] : id);
      const rounds = (roundsBySession.get(id) || []).sort((a, b) =>
        b.endTime.localeCompare(a.endTime),
      );
      return {
        id,
        name,
        eventCount: data.count,
        lastSeen: data.lastSeen,
        sources: Array.from(data.sources),
        rounds,
      };
    },
  );

  // Sort by lastSeen descending
  sessions.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ sessions }));
}

/** Gap threshold in ms — events separated by more than this start a new round. */
const ROUND_GAP_MS = 30_000;

interface RoundInfo {
  roundId: string;
  sessionId: string;
  sessionName: string;
  roundNumber: number;
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  eventCount: number;
  deniedCount: number;
  warnedCount: number;
  allowedCount: number;
}

interface SessionInfo {
  id: string;
  name: string;
  eventCount: number;
  lastSeen: string;
  sources: string[];
  rounds: RoundInfo[];
}

/**
 * Detect rounds from trace entries.
 * Groups by sessionId, then within each session splits by time gaps.
 */
function loadSessionMetadata(tracesDir: string): Map<string, any> {
  const metadata = new Map<string, any>();
  const harnessDir = path.dirname(tracesDir);
  const sessionsDir = path.join(harnessDir, "sessions");
  try {
    if (fs.existsSync(sessionsDir)) {
      const files = fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(
            path.join(sessionsDir, file),
            "utf-8",
          );
          const data = JSON.parse(content);
          if (data.sessionId) {
            metadata.set(data.sessionId, data);
          }
        } catch {}
      }
    }
  } catch {}
  return metadata;
}

function detectRounds(
  entries: TraceEntry[],
  sessionMetadata?: Map<string, any>,
): RoundInfo[] {
  const sessionMap = new Map<string, TraceEntry[]>();
  for (const e of entries) {
    const sid = e.sessionId || "unknown";
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);
  }

  const rounds: RoundInfo[] = [];

  for (const [sessionId, sessionEntries] of sessionMap) {
    sessionEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const meta = sessionMetadata?.get(sessionId);
    const metaRounds: any[] = meta?.rounds || [];

    let roundStart = 0;
    let roundNumber = 1;

    for (let i = 1; i <= sessionEntries.length; i++) {
      const isNewRound =
        i === sessionEntries.length ||
        new Date(sessionEntries[i].timestamp).getTime() -
          new Date(sessionEntries[i - 1].timestamp).getTime() >
          ROUND_GAP_MS;

      if (isNewRound) {
        const roundEntries = sessionEntries.slice(roundStart, i);
        const startTime = roundEntries[0].timestamp;
        const endTime = roundEntries[roundEntries.length - 1].timestamp;
        const duration =
          new Date(endTime).getTime() - new Date(startTime).getTime();

        let deniedCount = 0,
          warnedCount = 0,
          allowedCount = 0;
        for (const e of roundEntries) {
          const action = (e.action || "allow").toLowerCase();
          if (action === "deny") deniedCount++;
          else if (action === "warn") warnedCount++;
          else allowedCount++;
        }

        const sessionName =
          meta?.title ||
          (sessionId.includes("#") ? sessionId.split("#")[0] : sessionId);

        // Get round title from metadata (1-indexed to match roundNumber)
        const metaRound = metaRounds[roundNumber - 1];
        const title = metaRound?.title || `Round ${roundNumber}`;

        rounds.push({
          roundId: `${sessionId}#round${roundNumber}`,
          sessionId,
          sessionName,
          roundNumber,
          title,
          startTime,
          endTime,
          duration,
          eventCount: roundEntries.length,
          deniedCount,
          warnedCount,
          allowedCount,
        });

        roundStart = i;
        roundNumber++;
      }
    }
  }

  // Sort by endTime descending (most recent first)
  rounds.sort((a, b) => b.endTime.localeCompare(a.endTime));
  return rounds;
}

function handleRounds(res: http.ServerResponse, tracesDir: string): void {
  const entries = loadRecentTraces(tracesDir, 10000);
  const metadata = loadSessionMetadata(tracesDir);
  const rounds = detectRounds(entries, metadata);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ rounds, count: rounds.length }));
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

    const lines = buffer
      .toString("utf8")
      .split("\n")
      .filter((l: string) => l.trim());
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
  const files = fs
    .readdirSync(tracesDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .reverse();

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
        /* skip */
      }
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
  .stat-card .value.rounds { color: #58a6ff; }
  .section { padding: 0 24px 24px; }
  .section h2 { font-size: 15px; margin-bottom: 12px; color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 10px 16px; background: #1c2128; font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 16px; border-top: 1px solid #21262d; font-size: 13px; }
  tr.session-row { cursor: pointer; background: #161b22; }
  tr.session-row:hover { background: #1c2128; }
  tr.session-detail { display: none; }
  tr.session-detail.open { display: table-row; }
  tr.session-detail td { padding: 0; background: #0d1117; }
  .session-content { padding: 0 16px 16px; }
  .session-content table { border: none; border-radius: 0; background: transparent; }
  .session-content th { background: #161b22; font-size: 11px; }
  .session-content td { font-size: 12px; border-top: 1px solid #1c2128; }
  tr.round-row { cursor: pointer; }
  tr.round-row:hover { background: #1c2128; }
  tr.round-detail { display: none; }
  tr.round-detail.open { display: table-row; }
  tr.round-detail td { padding: 0; background: #0d1117; }
  .round-events { padding: 12px 16px; }
  .round-events table { border: none; border-radius: 0; }
  .round-events th { background: #161b22; font-size: 11px; }
  .round-events td { font-size: 12px; border-top: 1px solid #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.deny { background: #f8514922; color: #f85149; }
  .badge.allow { background: #3fb95022; color: #3fb950; }
  .badge.warn { background: #d2992222; color: #d29922; }
  .mini-stats { display: flex; gap: 8px; font-size: 11px; color: #8b949e; }
  .mini-stats .mini-denied { color: #f85149; }
  .mini-stats .mini-warned { color: #d29922; }
  .mini-stats .mini-allowed { color: #3fb950; }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3fb950; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .time-range { color: #8b949e; font-size: 12px; }
  .session-name { font-weight: 600; color: #e1e4e8; font-size: 14px; }
  .session-meta { color: #8b949e; font-size: 12px; margin-top: 2px; }
  .round-title { font-weight: 500; color: #c9d1d9; }
  .round-num { font-weight: 700; color: #58a6ff; margin-right: 8px; }
  .toggle-arrow { display: inline-block; transition: transform 0.2s; color: #8b949e; margin-right: 6px; }
  .toggle-arrow.open { transform: rotate(90deg); }
  .rounds-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .rounds-count { background: #30363d; color: #8b949e; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
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
      <div class="label">Rounds</div>
      <div class="value rounds" id="rounds">-</div>
    </div>
  </div>

  <div class="section">
    <h2>Sessions</h2>
    <table>
      <thead>
        <tr><th style="width:30px"></th><th>Session</th><th>Events</th><th>Rounds</th><th>Sources</th><th>Last Active</th></tr>
      </thead>
      <tbody id="sessions-table"></tbody>
    </table>
  </div>

<script>
function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return m + 'm ' + rs + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  document.getElementById('total').textContent = data.totalEvents;
  document.getElementById('denied').textContent = data.deniedEvents;
  document.getElementById('warned').textContent = data.warnedEvents;
  document.getElementById('rounds').textContent = data.rounds;
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  const data = await res.json();
  const tbody = document.getElementById('sessions-table');
  tbody.innerHTML = '';

  for (const s of data.sessions) {
    // Main session row
    const tr = document.createElement('tr');
    tr.className = 'session-row';
    const time = new Date(s.lastSeen).toLocaleTimeString();
    const roundCount = s.rounds.length;
    tr.innerHTML =
      '<td><span class="toggle-arrow" id="arrow-' + s.id + '">&#9654;</span></td>' +
      '<td><div class="session-name">' + s.name + '</div><div class="session-meta">' + s.id + '</div></td>' +
      '<td>' + s.eventCount + '</td>' +
      '<td><span class="rounds-count">' + roundCount + ' rounds</span></td>' +
      '<td>' + s.sources.join(', ') + '</td>' +
      '<td><span class="time-range">' + time + '</span></td>';

    // Detail row (rounds within this session)
    const detailTr = document.createElement('tr');
    detailTr.className = 'session-detail';
    detailTr.id = 'detail-' + s.id;
    detailTr.innerHTML = '<td colspan="6"><div class="session-content" id="rounds-' + s.id + '">Loading...</div></td>';

    tr.addEventListener('click', function() {
      const detail = document.getElementById('detail-' + s.id);
      const arrow = document.getElementById('arrow-' + s.id);
      const isOpen = detail.classList.contains('open');
      detail.classList.toggle('open');
      arrow.classList.toggle('open');
      if (!isOpen && detail.querySelector('.session-content').textContent === 'Loading...') {
        loadSessionRounds(s.id, s.rounds);
      }
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }
}

async function loadSessionRounds(sessionId, rounds) {
  const container = document.getElementById('rounds-' + sessionId);
  let html = '<table><thead><tr><th style="width:30px"></th><th>Round</th><th>Events</th><th>Stats</th><th>Time Range</th></tr></thead><tbody>';

  for (const r of rounds) {
    const startTime = new Date(r.startTime).toLocaleTimeString();
    const endTime = new Date(r.endTime).toLocaleTimeString();
    const statsHtml = '<span class="mini-stats">' +
      '<span class="mini-allowed">' + r.allowedCount + ' ok</span>' +
      (r.deniedCount > 0 ? '<span class="mini-denied">' + r.deniedCount + ' denied</span>' : '') +
      (r.warnedCount > 0 ? '<span class="mini-warned">' + r.warnedCount + ' warned</span>' : '') +
      '</span>';

    html += '<tr class="round-row" data-round-id="' + r.roundId + '">' +
      '<td><span class="toggle-arrow" id="arrow-' + r.roundId + '">&#9654;</span></td>' +
      '<td><span class="round-num">#' + r.roundNumber + '</span><span class="round-title">' + r.title + '</span></td>' +
      '<td>' + r.eventCount + '</td>' +
      '<td>' + statsHtml + '</td>' +
      '<td><span class="time-range">' + startTime + ' → ' + endTime + ' (' + formatDuration(r.duration) + ')</span></td>' +
      '</tr>';

    html += '<tr class="round-detail" id="detail-' + r.roundId + '">' +
      '<td colspan="5"><div class="round-events" id="events-' + r.roundId + '">Loading...</div></td>' +
      '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // Add click handlers for round rows
  const roundRows = container.querySelectorAll('.round-row');
  roundRows.forEach(function(row) {
    row.addEventListener('click', function(e) {
      e.stopPropagation();
      const roundId = this.getAttribute('data-round-id');
      const detail = document.getElementById('detail-' + roundId);
      const arrow = document.getElementById('arrow-' + roundId);
      const isOpen = detail.classList.contains('open');
      detail.classList.toggle('open');
      arrow.classList.toggle('open');
      if (!isOpen && detail.querySelector('.round-events').textContent === 'Loading...') {
        loadRoundEvents(roundId);
      }
    });
  });
}

async function loadRoundEvents(roundId) {
  const res = await fetch('/api/traces');
  const data = await res.json();
  const container = document.getElementById('events-' + roundId);

  // Filter entries belonging to this round
  const roundParts = roundId.split('#round');
  const sessionId = roundParts[0];
  const roundNum = parseInt(roundParts[1]);

  // Reconstruct round boundaries from entries
  const sessionEntries = data.entries
    .filter(e => (e.sessionId || 'unknown') === sessionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Detect rounds to find the target round's entries
  let roundStart = 0;
  let currentRound = 1;
  let targetEntries = [];

  for (let i = 1; i <= sessionEntries.length; i++) {
    const isNew = i === sessionEntries.length ||
      new Date(sessionEntries[i].timestamp).getTime() - new Date(sessionEntries[i-1].timestamp).getTime() > 30000;
    if (isNew) {
      if (currentRound === roundNum) {
        targetEntries = sessionEntries.slice(roundStart, i);
        break;
      }
      roundStart = i;
      currentRound++;
    }
  }

  let html = '<table><thead><tr><th>Time</th><th>Action</th><th>Event</th><th>Source</th><th>Tool</th></tr></thead><tbody>';
  for (const e of targetEntries) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const action = e.action || 'allow';
    const badge = '<span class="badge ' + action + '">' + action.toUpperCase() + '</span>';
    const toolName = e.payload?.toolName || e.toolName || '-';
    html += '<tr><td>' + time + '</td><td>' + badge + '</td><td>' + (e.event || '-') + '</td><td>' + (e.source || '-') + '</td><td>' + toolName + '</td></tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}



// SSE for live updates
const evtSource = new EventSource('/events');
evtSource.addEventListener('trace', function(e) {
  loadStats();
  loadSessions();
});

loadStats();
loadSessions();
setInterval(loadStats, 10000);
setInterval(loadSessions, 15000);
</script>
</body>
</html>`;
}
