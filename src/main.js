'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/main.js — Application Coordinator                     │
 * │                                                             │
 * │  Orchestrates the startup sequence in strict order:        │
 * │   1. Print banner                                          │
 * │   2. Determine the watched project root from CLI args      │
 * │   3. Run initial synchronous directory scan                │
 * │   4. Rebuild all function call-graph links                 │
 * │   5. Start HTTP server                                     │
 * │   6. Start live file-system watcher                        │
 * │                                                             │
 * │  Imports : config, graph-engine, watcher, web-server       │
 * │  No parsers or state direct access — delegates to modules. │
 * └─────────────────────────────────────────────────────────────┘
 */

'use strict';

const path = require('path');

const graphEngine = require('./core/graph-engine');
const { scanDirectory, startWatcher } = require('./server/watcher');
const { startServer } = require('./server/web-server');

// ─── ANSI helpers (main.js-local — avoids a shared logger module) ────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  blue:   '\x1b[34m',
  red:    '\x1b[31m',
};

const log = {
  info:    (...m) => console.log(`${C.blue}[AI-WATCHER]${C.reset}`, ...m),
  success: (...m) => console.log(`${C.green}[SYNC OK]${C.reset}   `, ...m),
  error:   (...m) => console.error(`${C.red}[ERROR]${C.reset}     `, ...m),

  banner: () => {
    console.log(`\n${C.cyan}${C.bold}`);
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log('  ║  AI-WATCHER v3.0.0 — Modular Architecture Edition   ║');
    console.log('  ║  Functions Graph · DB ERD · Architecture View        ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log(`${C.reset}`);
  },
};

// ─── Root Directory Resolution ────────────────────────────────────────────────

/**
 * Determines the watched root directory.
 * Priority: CLI argument (process.argv[2]) → current working directory.
 */
const ROOT = path.resolve(process.argv[2] || process.cwd());

// ─── Startup Sequence ─────────────────────────────────────────────────────────

async function main() {
  log.banner();
  log.info(`Watching root: ${C.cyan}${ROOT}${C.reset}`);
  log.info('Scanning for source files and DB schemas…');

  // Share root with state so other modules can locate .ai_context.json
  const state = require('./core/state');
  state.ROOT = ROOT;

  // Phase 1: Initial full scan — populates state synchronously
  scanDirectory(ROOT, ROOT);

  // Phase 2: Rebuild DB foreign-key links from freshly populated state
  graphEngine.rebuildDbLinks();

  // Phase 3: Rebuild function call-graph links
  const brokenAlert = graphEngine.rebuildAllLinks();

  // Report initial scan results
  log.success(
    `Graphs ready: ${C.bold}${state.allFunctions.size}${C.reset} functions · ` +
    `${C.bold}${state.dbTables.size}${C.reset} DB entities · ` +
    `${C.bold}${state.graphLinks.size}${C.reset} links`,
  );

  if (brokenAlert) {
    log.error(`Initial scan detected broken links: ${brokenAlert}`);
  }

  // Phase 4: Start the HTTP server (serves dashboard + API endpoints)
  startServer(ROOT);

  // Phase 5: Start the live file-system watcher
  startWatcher(ROOT);
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(`\x1b[31m[FATAL]\x1b[0m`, err);
  process.exit(1);
});
