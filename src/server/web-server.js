'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/server/web-server.js — Pure HTTP Server               │
 * │                                                             │
 * │  Routes:                                                    │
 * │   GET  /                  → dashboard.html (fs.readFileSync)│
 * │   GET  /data              → getGraphData()       (Tab 1)   │
 * │   GET  /db-data           → getDatabaseGraphData() (Tab 2) │
 * │   GET  /architecture-data → getArchitectureData()  (Tab 3) │
 * │   GET  /.ai_context       → raw sink JSON                  │
 * │   POST /error             → runtime error ingestion        │
 * │                                                             │
 * │  Imports : http, fs, path, config, graph-engine            │
 * │  Exports : startServer(root)                               │
 * └─────────────────────────────────────────────────────────────┘
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const config      = require('../config');
const graphEngine = require('../core/graph-engine');
const state       = require('../core/state');

// ─── Dashboard HTML path ──────────────────────────────────────────────────────

/** Absolute path to the separated dashboard HTML file. */
const DASHBOARD_PATH = path.join(__dirname, 'dashboard.html');

// ─── ANSI logging ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', blue: '\x1b[34m', yellow: '\x1b[33m',
};

const log = {
  info: (...m) => console.log(`${C.blue}[AI-WATCHER]${C.reset}`, ...m),
  warn: (...m) => console.log(`${C.yellow}[WARN]${C.reset}      `, ...m),
};

// ─── Browser Opener ───────────────────────────────────────────────────────────

/**
 * Opens the dashboard URL in the default system browser.
 * Silently ignores errors (e.g. headless environments).
 *
 * @param {string} url
 */
function openBrowser(url) {
  const cmds = {
    win32:  `start "" "${url}"`,
    darwin: `open "${url}"`,
    linux:  `xdg-open "${url}"`,
  };
  const cmd = cmds[process.platform] || cmds.linux;
  exec(cmd, (err) => {
    if (err) log.warn(`Could not automatically open browser: ${err.message}`);
    else     log.info(`${C.green}Browser opened: ${C.cyan}${url}${C.reset}`);
  });
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

/** Common CORS + JSON response headers. */
const JSON_HEADERS = {
  'Content-Type':                'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Sends a JSON response.
 * @param {http.ServerResponse} res
 * @param {object}              data
 * @param {number}              [statusCode=200]
 */
function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

// ─── Request Handlers ────────────────────────────────────────────────────────

/**
 * POST /error — ingests a runtime error report from instrumented code.
 *
 * Expected body: { functionName: string, error: string, file?: string }
 */
function handleErrorIngestion(req, res, root) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      if (payload.functionName && payload.error) {
        state.runtimeErrors.set(payload.functionName, payload.error);
        graphEngine.writeSink(
          payload.file || path.join(root, 'runtime_environment'),
          root,
          `Runtime crash in ${payload.functionName}(): ${payload.error}`,
        );
      }
      sendJson(res, { status: 'ok' });
    } catch {
      sendJson(res, { error: 'Invalid JSON payload' }, 400);
    }
  });
}

// ─── Server Factory ───────────────────────────────────────────────────────────

/**
 * Creates and starts the HTTP server.
 *
 * The dashboard HTML is read from disk on **every request** to `/` so that
 * changes to `dashboard.html` during development are reflected without a restart.
 * (In production a cache could be added here trivially.)
 *
 * @param {string} root - Absolute path to the watched project root
 * @returns {http.Server}
 */
function startServer(root) {
  const server = http.createServer((req, res) => {
    // ── CORS Preflight ────────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = (req.url || '/').split('?')[0];

    // ── POST /error ───────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/error') {
      handleErrorIngestion(req, res, root);
      return;
    }

    // ── GET /data — Tab 1: Functions Graph ────────────────────────────────
    if (url === '/data') {
      sendJson(res, graphEngine.getGraphData());
      return;
    }

    // ── GET /db-data — Tab 2: DB Visualisation ────────────────────────────
    if (url === '/db-data') {
      sendJson(res, graphEngine.getDatabaseGraphData());
      return;
    }

    // ── GET /architecture-data — Tab 3: Architecture View ─────────────────
    if (url === '/architecture-data') {
      sendJson(res, graphEngine.getArchitectureData());
      return;
    }

    // ── GET /.ai_context — Raw sink file for AI agents ────────────────────
    if (url === '/.ai_context') {
      try {
        const data = fs.readFileSync(path.join(root, config.SINK_FILE), 'utf8');
        res.writeHead(200, JSON_HEADERS);
        res.end(data);
      } catch {
        sendJson(res, { broken_link: null });
      }
      return;
    }

    // ── GET / — Serve Dashboard HTML ──────────────────────────────────────
    if (url === '/' || url === '/index.html') {
      try {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Dashboard not found at ${DASHBOARD_PATH}.\n${err.message}`);
      }
      return;
    }

    // ── 404 ───────────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(config.PORT, '127.0.0.1', () => {
    const serverUrl = `http://localhost:${config.PORT}`;
    log.info(`${C.bold}Visualization App: ${C.cyan}${serverUrl}${C.reset}`);
    openBrowser(serverUrl);
  });

  return server;
}

module.exports = { startServer };
