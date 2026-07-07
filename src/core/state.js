'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/core/state.js — Shared In-Memory Data Store           │
 * │                                                             │
 * │  All live graph state lives here as module-level singletons.│
 * │  This module has NO imports from src/ and ZERO logic.       │
 * │  It is the only file that all other modules share.          │
 * └─────────────────────────────────────────────────────────────┘
 */

// ─── Functions Graph State ───────────────────────────────────────────────────

/**
 * Primary function registry.
 * key   : "<relPath>::<fnName>"  (e.g. "src/core/state.js::getState")
 * value : { key, name, file, group, line, body, imports }
 * @type {Map<string, object>}
 */
const allFunctions = new Map();

/**
 * Maps a relative file path to the Set of function keys it owns.
 * Used for fast unregistration when a file changes or is deleted.
 * key   : relative file path
 * value : Set<string> of function keys
 * @type {Map<string, Set<string>>}
 */
const fileToFunctionsMap = new Map();

/**
 * Reverse-index: maps a lowercase function name to all keys that share it.
 * Enables cross-file call resolution without scanning all functions every tick.
 * key   : lowercase function name
 * value : Set<string> of fully-qualified keys
 * @type {Map<string, Set<string>>}
 */
const funcNameToKeysMap = new Map();

/**
 * Currently active call-graph links between functions.
 * key   : "<srcKey>→<tgtKey>"
 * value : { source, target, id }
 * @type {Map<string, object>}
 */
const graphLinks = new Map();

/**
 * Snapshot of link IDs from the previous rebuild cycle.
 * Diffed against the new link set to detect broken linkages.
 * @type {Set<string>}
 */
const previousLinks = new Set();

/**
 * Last-seen raw content per file.
 * Used to suppress redundant processing on no-op saves.
 * key   : relative file path
 * value : string (raw file content)
 * @type {Map<string, string>}
 */
const previousContent = new Map();

// ─── Database / ERD Graph State ──────────────────────────────────────────────

/**
 * All extracted DB tables / Prisma models / Code models.
 * key   : table/model name
 * value : { id, name, file, group, fields[], type }
 * @type {Map<string, object>}
 */
const dbTables = new Map();

/**
 * Foreign-key relationships between DB entities.
 * key   : "<srcTable>→<tgtTable>"
 * value : { source, target, id, label }
 * @type {Map<string, object>}
 */
const dbLinks = new Map();

/**
 * Maps a relative file path to the Set of table/model names it owns.
 * Used for fast unregistration on file change/delete.
 * @type {Map<string, Set<string>>}
 */
const fileToDbTablesMap = new Map();

// ─── Error State ─────────────────────────────────────────────────────────────

/**
 * Runtime errors reported via POST /error from instrumented code.
 * key   : function name or function key
 * value : error message string
 * @type {Map<string, string>}
 */
const runtimeErrors = new Map();

/**
 * Syntax errors detected by the JS/TS parser via `node --check`.
 * key   : relative file path
 * value : first line of the compiler error message
 * @type {Map<string, string>}
 */
const syntaxErrors = new Map();

module.exports = {
  // Functions graph
  allFunctions,
  fileToFunctionsMap,
  funcNameToKeysMap,
  graphLinks,
  previousLinks,
  previousContent,
  // DB / ERD graph
  dbTables,
  dbLinks,
  fileToDbTablesMap,
  // Errors
  runtimeErrors,
  syntaxErrors,
};
