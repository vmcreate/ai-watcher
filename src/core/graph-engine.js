'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/core/graph-engine.js — Graph Reconstruction Engine    │
 * │                                                             │
 * │  All graph-level computation lives here:                   │
 * │   • rebuildAllLinks()      — call-graph edge reconstruction │
 * │   • rebuildDbLinks()       — FK cross-referencing          │
 * │   • getGraphData()         — shape data for Tab 1          │
 * │   • getDatabaseGraphData() — shape data for Tab 2          │
 * │   • getArchitectureData()  — shape data for Tab 3 (NEW)    │
 * │   • writeSink()            — persist .ai_context.json      │
 * │                                                             │
 * │  Imports : core/state, config                              │
 * │  No imports from parsers/ or server/ — no circular deps.   │
 * └─────────────────────────────────────────────────────────────┘
 */

const fs   = require('fs');
const path = require('path');

const state  = require('./state');
const config = require('../config');

// ─── ANSI logging (engine-level only) ────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', yellow: '\x1b[33m', white: '\x1b[37m', bgRed: '\x1b[41m',
};

function logCritical(fnA, fnB) {
  const msg = `Broken function call chain between ${fnA} and ${fnB}`;
  console.log('');
  console.log(`${C.bgRed}${C.bold}${C.white}  ⚠️  CRITICAL: ${msg}  ${C.reset}`);
  console.log('');
  return msg;
}

// ─── Levenshtein Distance ─────────────────────────────────────────────────────

/**
 * Computes the edit distance between two strings.
 * Used for "did you mean?" suggestions on broken links.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function getEditDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Returns up to 3 function names from the registry that are similar
 * (substring match or Levenshtein distance ≤ 3) to the target name.
 *
 * @param {string} targetName
 * @returns {string[]}
 */
function findSimilarFunctions(targetName) {
  const suggestions = [];
  const lowerTarget = targetName.toLowerCase();
  for (const [, fn] of state.allFunctions) {
    const fnLower = fn.name.toLowerCase();
    if (fnLower.includes(lowerTarget) || lowerTarget.includes(fnLower) ||
        getEditDistance(lowerTarget, fnLower) <= 3) {
      suggestions.push(`${fn.name}()`);
    }
  }
  return [...new Set(suggestions)].slice(0, 3);
}

// ─── Call-Graph Link Reconstruction ──────────────────────────────────────────

/**
 * Full O(F × N) rebuild of all call-graph edges.
 *
 * Resolution priority for each call-site:
 *  1. Same-file function (highest confidence — avoids cross-file ambiguity)
 *  2. Function in a file that is explicitly imported by the caller's file
 *  3. Any function with that name if it is unique across the entire project
 *
 * Compares the new link set against the snapshot in `state.previousLinks`
 * and emits "CRITICAL" log messages for any links that disappeared.
 *
 * @returns {string|null} Concatenated broken-link alert messages, or null
 */
function rebuildAllLinks() {
  const newLinkSet    = new Set();
  const newGraphLinks = new Map();

  for (const [srcKey, srcFn] of state.allFunctions) {
    const body = srcFn.body;

    for (const [targetNameLower, candidateKeys] of state.funcNameToKeysMap) {
      if (candidateKeys.size === 0) continue;

      const escaped  = targetNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callRe   = new RegExp(`\\b${escaped}\\b\\s*\\(`, 'i');
      if (!callRe.test(body)) continue;

      let resolvedTargetKey = null;

      // Priority 1 — same file, different function
      for (const candKey of candidateKeys) {
        if (candKey.startsWith(`${srcFn.file}::`) && candKey !== srcKey) {
          resolvedTargetKey = candKey;
          break;
        }
      }

      // Priority 2 — imported file
      if (!resolvedTargetKey) {
        outer: for (const candKey of candidateKeys) {
          const candFn = state.allFunctions.get(candKey);
          if (candFn) {
            const candFileLower = candFn.file.toLowerCase();
            for (const imp of srcFn.imports) {
              if (candFileLower.includes(imp)) {
                resolvedTargetKey = candKey;
                break outer;
              }
            }
          }
        }
      }

      // Priority 3 — unique global name
      if (!resolvedTargetKey && candidateKeys.size === 1) {
        const onlyKey = Array.from(candidateKeys)[0];
        if (onlyKey !== srcKey) resolvedTargetKey = onlyKey;
      }

      if (resolvedTargetKey && resolvedTargetKey !== srcKey) {
        const linkId = `${srcKey}→${resolvedTargetKey}`;
        newGraphLinks.set(linkId, { source: srcKey, target: resolvedTargetKey, id: linkId });
        newLinkSet.add(linkId);
      }
    }
  }

  // Diff against previous snapshot to find broken links
  const brokenMessages = [];
  if (state.previousLinks.size > 0) {
    for (const oldLinkId of state.previousLinks) {
      if (!newLinkSet.has(oldLinkId)) {
        const [srcKey, tgtKey] = oldLinkId.split('→');
        const srcName = srcKey.split('::').pop();
        const tgtName = tgtKey.split('::').pop();
        const suggestions = findSimilarFunctions(tgtName);
        let suggText = suggestions.length > 0 ? ` (Did you mean: ${suggestions.join(', ')}?)` : '';
        const msg = logCritical(`${srcName}()`, `${tgtName}()`) + suggText;
        brokenMessages.push(msg);
      }
    }
  }

  // Commit new state
  state.graphLinks.clear();
  for (const [k, v] of newGraphLinks) state.graphLinks.set(k, v);
  state.previousLinks.clear();
  for (const l of newLinkSet) state.previousLinks.add(l);

  return brokenMessages.length > 0 ? brokenMessages.join(' | ') : null;
}

// ─── DB FK Link Reconstruction ────────────────────────────────────────────────

/**
 * Rebuilds all foreign-key links between DB entities by matching FK field names
 * against known table/model names (with common suffix patterns).
 *
 * Stored into `state.dbLinks`.
 */
function rebuildDbLinks() {
  state.dbLinks.clear();
  const allTableNames = Array.from(state.dbTables.keys());

  for (const [srcName, srcTable] of state.dbTables) {
    for (const field of srcTable.fields) {
      if (!field.isFk || field.name.length <= 2) continue;

      const rawTarget  = field.name.replace(/_?id$/i, '');
      const targetLower = rawTarget.toLowerCase();

      for (const tgtCandidate of allTableNames) {
        if (tgtCandidate === srcName) continue;
        const candLower = tgtCandidate.toLowerCase();

        if (candLower === targetLower ||
            candLower === `${targetLower}s` ||
            candLower === `tbl_${targetLower}`) {
          const linkId = `${srcName}→${tgtCandidate}`;
          state.dbLinks.set(linkId, {
            source: srcName, target: tgtCandidate, id: linkId, label: field.name,
          });
        }
      }
    }
  }
}

// ─── Graph Data Serializers ───────────────────────────────────────────────────

/**
 * Shapes the function graph state into the wire format consumed by Tab 1
 * (Functions Graph) on the frontend.
 *
 * @returns {{ nodes: object[], links: object[], syntaxError: string|null }}
 */
function getGraphData() {
  const nodes = [];
  for (const [, fn] of state.allFunctions) {
    const err = state.runtimeErrors.get(fn.key) || state.runtimeErrors.get(fn.name);
    nodes.push({
      id:              fn.key,
      name:            `${fn.name}()`,
      file:            fn.file,
      group:           fn.group,
      path:            fn.file,
      line:            fn.line,
      hasRuntimeError: !!err,
      runtimeError:    err || null,
    });
  }

  return {
    nodes,
    links:       Array.from(state.graphLinks.values()),
    syntaxError: state.syntaxErrors.size > 0
      ? Array.from(state.syntaxErrors.values())[0]
      : null,
  };
}

/**
 * Shapes the DB entity state into the wire format consumed by Tab 2
 * (DB Visualisation / ERD) on the frontend.
 *
 * @returns {{ nodes: object[], links: object[] }}
 */
function getDatabaseGraphData() {
  return {
    nodes: Array.from(state.dbTables.values()),
    links: Array.from(state.dbLinks.values()),
  };
}

// ─── Architecture View Data Builder ──────────────────────────────────────────

/**
 * Builds a hierarchical tree structure for the Tab 3 "Architecture View".
 *
 * Output shape (D3-compatible):
 * {
 *   name: "Project Root",
 *   children: [
 *     {
 *       name: "Parsers",       ← architectural layer label
 *       layer: "Parsers",
 *       children: [
 *         {
 *           name: "db-sql.js", ← file
 *           type: "file",
 *           path: "src/parsers/db-sql.js",
 *           children: [
 *             { name: "parseSql()", type: "function", line: 12 },
 *             …
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * The tree is built bottom-up from `state.fileToFunctionsMap` and
 * `state.fileToDbTablesMap`, so only actually-indexed files appear.
 *
 * @returns {object} D3-compatible hierarchy root
 */
function getArchitectureData() {
  // Step 1: collect all indexed files
  const allFiles = new Set([
    ...state.fileToFunctionsMap.keys(),
    ...state.fileToDbTablesMap.keys(),
  ]);

  // Step 1.5: Read activity heatmap from .ai_context.json
  const changeCounts = new Map();
  if (state.ROOT) {
    try {
      const sinkPath = path.join(state.ROOT, config.SINK_FILE);
      if (fs.existsSync(sinkPath)) {
        const raw = fs.readFileSync(sinkPath, 'utf8');
        const parsed = JSON.parse(raw);
        const changeHistory = parsed.change_history || [];
        for (const entry of changeHistory) {
          if (entry.file) {
            const count = changeCounts.get(entry.file) || 0;
            changeCounts.set(entry.file, count + 1);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Step 1.6: Calculate file-level incoming/outgoing call dependencies
  const incomingMap = new Map();
  const outgoingMap = new Map();
  for (const [linkId, link] of state.graphLinks) {
    if (!link.source || !link.target) continue;
    const srcFile = link.source.split('::')[0];
    const tgtFile = link.target.split('::')[0];
    if (srcFile && tgtFile && srcFile !== tgtFile) {
      if (!incomingMap.has(tgtFile)) incomingMap.set(tgtFile, new Set());
      incomingMap.get(tgtFile).add(srcFile);

      if (!outgoingMap.has(srcFile)) outgoingMap.set(srcFile, new Set());
      outgoingMap.get(srcFile).add(tgtFile);
    }
  }

  // Step 2: group files by architectural layer
  const layerMap = new Map(); // layer label → Map<filePath, { functions[], dbEntities[] }>

  for (const filePath of allFiles) {
    const layer    = config.resolveLayer(filePath);
    if (!layerMap.has(layer)) layerMap.set(layer, new Map());

    const fileMap  = layerMap.get(layer);
    if (!fileMap.has(filePath)) fileMap.set(filePath, { functions: [], dbEntities: [] });

    const fileEntry = fileMap.get(filePath);

    // Attach functions
    const funcKeys = state.fileToFunctionsMap.get(filePath) || new Set();
    for (const key of funcKeys) {
      const fn = state.allFunctions.get(key);
      if (fn) fileEntry.functions.push({ name: `${fn.name}()`, type: 'function', line: fn.line });
    }

    // Attach DB entities
    const tableNames = state.fileToDbTablesMap.get(filePath) || new Set();
    for (const tName of tableNames) {
      const tbl = state.dbTables.get(tName);
      if (tbl) fileEntry.dbEntities.push({ name: tName, type: tbl.type || 'entity' });
    }
  }

  // Step 3: convert layerMap → D3 children hierarchy
  const layerNodes = [];

  for (const [layerLabel, fileMap] of layerMap) {
    const fileNodes = [];

    for (const [filePath, { functions, dbEntities }] of fileMap) {
      const leaves = [
        ...functions.map(f => ({ name: f.name, type: 'function', line: f.line })),
        ...dbEntities.map(e => ({ name: e.name, type: e.type })),
      ];

      const changes = changeCounts.get(filePath) || 0;
      const incoming = (incomingMap.get(filePath) || new Set()).size;
      const outgoing = (outgoingMap.get(filePath) || new Set()).size;

      fileNodes.push({
        name:     path.basename(filePath),
        type:     'file',
        path:     filePath,
        changes,
        incoming,
        outgoing,
        // Only attach children array if there are leaves (avoids empty expansion)
        ...(leaves.length > 0 ? { children: leaves } : {}),
      });
    }

    // Sort files alphabetically within each layer
    fileNodes.sort((a, b) => a.name.localeCompare(b.name));

    layerNodes.push({
      name:     layerLabel,
      layer:    layerLabel,
      type:     'layer',
      children: fileNodes,
    });
  }

  // Sort layers by a fixed display order for visual consistency
  const LAYER_ORDER = [
    'CLI Entry', 'Application', 'Core Engine', 'Parsers', 'Server',
    'Data Models', 'Database', 'Tests', 'Utilities', 'Documentation', 'Root',
  ];
  layerNodes.sort((a, b) => {
    const ai = LAYER_ORDER.indexOf(a.name);
    const bi = LAYER_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return {
    name:     'Project Root',
    type:     'root',
    children: layerNodes,
  };
}

// ─── Sink File Writer ─────────────────────────────────────────────────────────

/**
 * Persists the current graph state to the `.ai_context.json` sink file
 * at the project root. This file is consumed by AI agents that cannot
 * poll the HTTP server directly.
 *
 * @param {string} absPath     - Absolute path to the file that triggered the update
 * @param {string} root        - Absolute path to the project root
 * @param {string|null} brokenAlert - Broken-link message, or null if graph is healthy
 */
function writeSink(absPath, root, brokenAlert = null) {
  const relativePath = path.relative(root, absPath).replace(/\\/g, '/');
  const sinkPath     = path.join(root, config.SINK_FILE);
  const timestamp    = new Date().toISOString();

  let change_history = [];
  try {
    if (fs.existsSync(sinkPath)) {
      const parsed = JSON.parse(fs.readFileSync(sinkPath, 'utf8'));
      change_history = parsed.change_history || parsed.istorija_izmena || [];
    }
  } catch { change_history = []; }

  const activeSyntaxError = state.syntaxErrors.size > 0
    ? Array.from(state.syntaxErrors.values())[0]
    : null;

  let statusText = 'OK';
  if (brokenAlert)       statusText = `CRITICAL: ${brokenAlert}`;
  else if (activeSyntaxError) statusText = `SYNTAX ERROR: ${activeSyntaxError}`;

  change_history.unshift({
    timestamp,
    file:            relativePath,
    status:          statusText,
    total_functions: state.allFunctions.size,
    total_links:     state.graphLinks.size,
  });

  const payload = {
    last_modified_file: relativePath,
    sync_timestamp:     timestamp,
    total_nodes:        state.allFunctions.size,
    total_links:        state.graphLinks.size,
    broken_link:        brokenAlert,
    syntax_error:       activeSyntaxError,
    change_history,
  };

  try { fs.writeFileSync(sinkPath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
}

module.exports = {
  rebuildAllLinks,
  rebuildDbLinks,
  getGraphData,
  getDatabaseGraphData,
  getArchitectureData,
  writeSink,
  // Exposed for tests / diagnostics
  getEditDistance,
  findSimilarFunctions,
};
