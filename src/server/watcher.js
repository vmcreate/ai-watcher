'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/server/watcher.js — Chokidar File-System Event Loop   │
 * │                                                             │
 * │  Owns the two responsibilities:                            │
 * │   1. scanDirectory(root) — initial full scan at startup    │
 * │   2. startWatcher(root)  — live chokidar event listener    │
 * │                                                             │
 * │  On every file event it:                                   │
 * │   a) Calls parsers/index to register/unregister entities   │
 * │   b) Calls graph-engine to rebuild all links               │
 * │   c) Calls graph-engine.writeSink to persist state         │
 * │                                                             │
 * │  Imports : chokidar, config, parsers/index, graph-engine   │
 * │  Exports : scanDirectory(root), startWatcher(root)         │
 * └─────────────────────────────────────────────────────────────┘
 */

const fs       = require('fs');
const path     = require('path');
const chokidar = require('chokidar');

const config      = require('../config');
const parser      = require('../parsers/index');
const graphEngine = require('../core/graph-engine');

// ─── ANSI logging ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
};

const log = {
  info:    (...m) => console.log(`${C.blue}[AI-WATCHER]${C.reset}`, ...m),
  success: (...m) => console.log(`${C.green}[SYNC OK]${C.reset}   `, ...m),
  warn:    (...m) => console.log(`${C.yellow}[WARN]${C.reset}      `, ...m),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the absolute path matches any ignored pattern.
 * @param {string} p
 * @returns {boolean}
 */
function isIgnored(p) {
  const n = p.replace(/\\/g, '/');
  return config.IGNORED_PATTERNS.some(re => re.test(n));
}

/**
 * Returns true if the file extension is in the tracked set.
 * @param {string} filePath
 * @returns {boolean}
 */
function isTracked(filePath) {
  return config.SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Reads file content safely; returns empty string on error.
 * @param {string} absPath
 * @returns {string}
 */
function readFileSafe(absPath) {
  try { return fs.readFileSync(absPath, 'utf8'); } catch { return ''; }
}

// ─── Initial Scan ─────────────────────────────────────────────────────────────

/**
 * Recursively walks `dirPath`, registering every tracked file it finds.
 * Runs synchronously at startup before the HTTP server and watcher are
 * initialised, so state is fully populated before the first HTTP request
 * can arrive.
 *
 * @param {string} dirPath - Absolute path to the directory to scan
 * @param {string} root    - Absolute path to the project root
 */
function scanDirectory(dirPath, root) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (isIgnored(absPath)) continue;

    if (entry.isDirectory()) {
      scanDirectory(absPath, root);
    } else if (entry.isFile() && isTracked(absPath)) {
      parser.registerFile(absPath, root);
    }
  }
}

// ─── Live Watcher ─────────────────────────────────────────────────────────────

/**
 * Starts the Chokidar file-system watcher on the project root.
 * Handles `add`, `change`, and `unlink` events.
 *
 * awaitWriteFinish is set to debounce rapid successive saves (e.g. from
 * editors that do atomic writes via temp-file rename).
 *
 * @param {string} root - Absolute path to the project root
 */
function startWatcher(root) {
  // Access the shared state for the "previous content" dedup check
  const state = require('../core/state');
  let accumulatedChanges = 0;

  const watcher = chokidar.watch(root, {
    ignored:          config.IGNORED_PATTERNS,
    persistent:       true,
    ignoreInitial:    true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher
    // ── New file added to the project ──────────────────────────────────────
    .on('add', (p) => {
      if (!isTracked(p) || isIgnored(p)) return;

      const content = readFileSafe(p);
      accumulatedChanges += content.split('\n').length;

      parser.registerFile(p, root);
      graphEngine.rebuildDbLinks();
      const brokenAlert = graphEngine.rebuildAllLinks();
      graphEngine.writeSink(p, root, brokenAlert);
      log.info(`New file indexed: ${parser.rel(p, root)}`);

      if (accumulatedChanges >= 10000) {
        console.log(`\n${C.yellow}${C.bold}[AI BRAIN WARNING]${C.reset} ${C.bold}Accumulated changes have exceeded 10000 lines (${accumulatedChanges} lines)!${C.reset}`);
        console.log(`${C.yellow}AI Agent: Please pause, read .ai_context.json, and digest/summarize the current architecture into your AI brain memory.\n${C.reset}`);
        accumulatedChanges = 0;
      }
    })

    // ── Existing file changed ──────────────────────────────────────────────
    .on('change', (p) => {
      if (!isTracked(p) || isIgnored(p)) return;

      const relativePath  = parser.rel(p, root);
      const currentContent = readFileSafe(p);

      // De-duplicate: skip re-parse if content hasn't actually changed
      // (some editors touch mtime without changing bytes)
      if (state.previousContent.get(relativePath) === currentContent) return;

      const prevContent = state.previousContent.get(relativePath) || '';
      const diff = Math.abs(currentContent.split('\n').length - prevContent.split('\n').length);
      accumulatedChanges += diff;

      state.previousContent.set(relativePath, currentContent);

      parser.registerFile(p, root);
      graphEngine.rebuildDbLinks();
      const brokenAlert = graphEngine.rebuildAllLinks();
      graphEngine.writeSink(p, root, brokenAlert);

      if (brokenAlert) {
        log.warn(`${C.yellow}Broken linkage in${C.reset} ${C.bold}${relativePath}${C.reset}`);
      } else {
        const { allFunctions, dbTables } = state;
        log.success(`${C.bold}${relativePath}${C.reset} (${allFunctions.size} functions · ${dbTables.size} DB entities)`);
      }

      if (accumulatedChanges >= 10000) {
        console.log(`\n${C.yellow}${C.bold}[AI BRAIN WARNING]${C.reset} ${C.bold}Accumulated changes have exceeded 10000 lines (${accumulatedChanges} lines)!${C.reset}`);
        console.log(`${C.yellow}AI Agent: Please pause, read .ai_context.json, and digest/summarize the current architecture into your AI brain memory.\n${C.reset}`);
        accumulatedChanges = 0;
      }
    })

    // ── File removed from the project ─────────────────────────────────────
    .on('unlink', (p) => {
      if (!isTracked(p)) return;

      parser.unregisterFile(p, root);
      graphEngine.rebuildDbLinks();
      const brokenAlert = graphEngine.rebuildAllLinks();
      graphEngine.writeSink(p, root, brokenAlert);
      log.warn(`Removed file entities: ${parser.rel(p, root)}`);
    });

  return watcher;
}

module.exports = { scanDirectory, startWatcher };
