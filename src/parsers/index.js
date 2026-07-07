'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/parsers/index.js — Parser Factory                     │
 * │                                                             │
 * │  The single dispatch layer between the file-system events  │
 * │  (watcher.js) and the parser ecosystem.                    │
 * │                                                             │
 * │  Given an absolute file path, it:                          │
 * │   1. Determines the architectural group for the file       │
 * │   2. Routes to the correct parser (code-js / code-generic  │
 * │      / db-sql / db-prisma)                                 │
 * │   3. Writes the resulting entities into shared state       │
 * │   4. Exposes clean register / unregister API               │
 * │                                                             │
 * │  Imports : config, core/state, parsers/*                   │
 * │  Exports : registerFile(absPath, root)                     │
 * │            unregisterFile(absPath, root)                   │
 * └─────────────────────────────────────────────────────────────┘
 */

const path = require('path');
const fs   = require('fs');

const { IGNORED_KEYWORDS, SOURCE_EXTENSIONS } = require('../config');
const state = require('../core/state');

const { checkSyntax, parseJs }       = require('./code-js');
const { parseGeneric }               = require('./code-generic');
const { parseSql }                   = require('./db-sql');
const { parsePrisma }                = require('./db-prisma');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts an absolute path to a forward-slash relative path from the root.
 * @param {string} absPath
 * @param {string} root
 * @returns {string}
 */
function rel(absPath, root) {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

/**
 * Reads a file safely — returns empty string on any I/O error.
 * @param {string} absPath
 * @returns {string}
 */
function readFileSafe(absPath) {
  try { return fs.readFileSync(absPath, 'utf8'); } catch { return ''; }
}

/**
 * Resolves the "group" label for a file — used as the module/cluster key
 * throughout the graph visualisation.
 *
 * Heuristic (in priority order):
 *  1. Single-level files → "root"
 *  2. Files inside a known root dir (src/lib/app/…) at depth ≥ 3 → second segment
 *  3. Otherwise → parent directory name
 *
 * @param {string} relativePath
 * @returns {string}
 */
function detectGroup(relativePath) {
  const parts = relativePath.split('/');
  if (parts.length === 1) return 'root';
  const knownRoots = new Set(['lib', 'src', 'app', 'packages', 'modules', 'db', 'models', 'entities']);
  if (parts.length >= 3 && knownRoots.has(parts[0])) return parts[1];
  return parts[parts.length - 2] || parts[0];
}

// ─── DB File Extension Check ─────────────────────────────────────────────────

/**
 * Returns true if the file should be processed by a DB parser.
 * @param {string} ext
 * @returns {boolean}
 */
function isDbFile(ext) {
  return ext === '.sql' || ext === '.prisma';
}

/**
 * Returns true if the file should be processed by a code parser.
 * (Anything tracked but not exclusively DB.)
 * @param {string} ext
 * @returns {boolean}
 */
function isCodeFile(ext) {
  return SOURCE_EXTENSIONS.has(ext) && !isDbFile(ext);
}

// ─── DB Registration ─────────────────────────────────────────────────────────

/**
 * Parses a DB schema file (SQL or Prisma) and writes results into shared state.
 *
 * @param {string} absPath
 * @param {string} root
 */
function registerDbFile(absPath, root) {
  const relativePath = rel(absPath, root);
  const content      = readFileSafe(absPath);
  if (!content) return;

  // Clear existing entities from this file before re-parsing
  unregisterDbFile(absPath, root);

  const ext   = path.extname(absPath).toLowerCase();
  const group = detectGroup(relativePath);
  const tableSet = new Set();

  let parsedTables;
  if (ext === '.sql') {
    parsedTables = parseSql(content, relativePath, group);
  } else if (ext === '.prisma') {
    parsedTables = parsePrisma(content, relativePath, group);
  } else {
    // For generic code files, look for class/struct patterns that resemble ORM models
    parsedTables = parseCodeModels(content, relativePath, group);
  }

  for (const [name, entity] of parsedTables) {
    state.dbTables.set(name, entity);
    tableSet.add(name);
  }

  state.fileToDbTablesMap.set(relativePath, tableSet);
}

/**
 * Removes all DB entities owned by a file from shared state.
 *
 * @param {string} absPath
 * @param {string} root
 */
function unregisterDbFile(absPath, root) {
  const relativePath = rel(absPath, root);
  const oldTables    = state.fileToDbTablesMap.get(relativePath) || new Set();
  for (const name of oldTables) {
    state.dbTables.delete(name);
  }
  state.fileToDbTablesMap.delete(relativePath);
}

/**
 * Extracts ORM-style class/struct entities from generic code files.
 * Triggered for non-JS code files that aren't .sql or .prisma but may
 * contain class definitions that look like data models.
 *
 * @param {string} content
 * @param {string} relativePath
 * @param {string} group
 * @returns {Map<string, object>}
 */
function parseCodeModels(content, relativePath, group) {
  const result = new Map();
  const lines = content.split('\n');
  let currentClass = null;
  let classFields = [];
  let braceDepth = 0;
  let hasEnteredClass = false;

  const MODEL_KEYWORDS = [
    'User','Patient','Clinic','Tenant','Doctor','Appointment','Order',
    'Product','Customer','Account','Invoice','Role','Organization',
  ];

  lines.forEach((lineText) => {
    const trimmed = lineText.trim();
    let m;

    if ((m = trimmed.match(/(?:class|struct)\s+([a-zA-Z0-9_]+)/))) {
      // Persist the previous class if it had fields
      if (currentClass && classFields.length > 0) {
        result.set(currentClass, {
          id: currentClass, name: currentClass,
          file: relativePath, group, fields: [...classFields], type: 'Code Model',
        });
      }
      const candidate = m[1];
      const isModel = MODEL_KEYWORDS.some(k => candidate.toLowerCase().includes(k.toLowerCase()))
                   || /Model|Entity|Table/i.test(trimmed);
      if (isModel) {
        currentClass = candidate;
        classFields  = [];
        braceDepth   = 0;
        hasEnteredClass = false;
      } else {
        currentClass = null;
      }
    }
    
    if (currentClass) {
      // 1. Process close braces first (lines closing a block)
      const closeBraces = (trimmed.match(/\}/g) || []).length;
      braceDepth -= closeBraces;

      // 2. If we are at depth 1 (directly inside the class body) and not opening a block
      const hasOpenBrace = trimmed.includes('{');
      if (braceDepth === 1 && !hasOpenBrace) {
        if ((m = trimmed.match(/^(?:public|private|protected|final|late|readonly)?\s*(?:[a-zA-Z0-9_<>?]+[\s*]+)?([a-zA-Z0-9_]+)\s*[:=;]/))) {
          const fname = m[1];
          if (!['constructor','function','get','set'].includes(fname) && fname.length > 1) {
            const isPk = fname.toLowerCase() === 'id';
            const isFk = !isPk && (fname.toLowerCase().endsWith('id') || fname.toLowerCase().endsWith('_id'));
            classFields.push({ name: fname, type: 'field', isPk, isFk });
          }
        }
      }

      // 3. Process open braces
      const openBraces = (trimmed.match(/\{/g) || []).length;
      braceDepth += openBraces;
      if (openBraces > 0) {
        hasEnteredClass = true;
      }

      // 4. Exit class if depth drops to 0 after we entered it
      if (hasEnteredClass && braceDepth <= 0) {
        if (classFields.length > 0) {
          result.set(currentClass, {
            id: currentClass, name: currentClass,
            file: relativePath, group, fields: [...classFields], type: 'Code Model',
          });
        }
        currentClass = null;
        classFields  = [];
        braceDepth   = 0;
        hasEnteredClass = false;
      }
    }
  });

  if (currentClass && classFields.length > 0 && !result.has(currentClass)) {
    result.set(currentClass, {
      id: currentClass, name: currentClass,
      file: relativePath, group, fields: classFields, type: 'Code Model',
    });
  }

  return result;
}

// ─── Code Function Registration ───────────────────────────────────────────────

/**
 * Parses a source code file, extracts functions/methods, and writes them
 * into shared state. Also runs the syntax checker for JS files.
 *
 * @param {string} absPath
 * @param {string} root
 */
function registerCodeFile(absPath, root) {
  const relativePath = rel(absPath, root);
  const ext          = path.extname(absPath).toLowerCase();
  const group        = detectGroup(relativePath);

  // Syntax check (JS/MJS/CJS only)
  const synErr = checkSyntax(absPath);
  if (synErr) {
    state.syntaxErrors.set(relativePath, synErr);
  } else {
    state.syntaxErrors.delete(relativePath);
  }

  const content = readFileSafe(absPath);
  if (!content) return;

  // Wipe old entries from this file before re-indexing
  unregisterCodeFile(absPath, root);

  let funcs;
  const jsExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte']);
  if (jsExts.has(ext)) {
    funcs = parseJs(absPath, content, relativePath, group);
  } else {
    funcs = parseGeneric(content, relativePath, group, ext);
  }

  const keySet = new Set();
  for (const fn of funcs) {
    state.allFunctions.set(fn.key, fn);
    keySet.add(fn.key);

    const lower = fn.name.toLowerCase();
    if (!state.funcNameToKeysMap.has(lower)) {
      state.funcNameToKeysMap.set(lower, new Set());
    }
    state.funcNameToKeysMap.get(lower).add(fn.key);
  }

  state.fileToFunctionsMap.set(relativePath, keySet);
}

/**
 * Removes all function entries owned by a file from shared state.
 *
 * @param {string} absPath
 * @param {string} root
 */
function unregisterCodeFile(absPath, root) {
  const relativePath = rel(absPath, root);
  state.syntaxErrors.delete(relativePath);

  const oldKeys = state.fileToFunctionsMap.get(relativePath) || new Set();
  for (const key of oldKeys) {
    const fn = state.allFunctions.get(key);
    if (fn) {
      const lower   = fn.name.toLowerCase();
      const nameSet = state.funcNameToKeysMap.get(lower);
      if (nameSet) {
        nameSet.delete(key);
        if (nameSet.size === 0) state.funcNameToKeysMap.delete(lower);
      }
      state.allFunctions.delete(key);
    }
  }
  state.fileToFunctionsMap.delete(relativePath);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registers all entities (functions and/or DB tables) from a file.
 * Routes to the correct sub-parser based on file extension.
 *
 * @param {string} absPath - Absolute path to the file
 * @param {string} root    - Absolute path to the project root
 */
function registerFile(absPath, root) {
  const ext = path.extname(absPath).toLowerCase();

  if (isDbFile(ext)) {
    registerDbFile(absPath, root);
  } else if (isCodeFile(ext)) {
    registerCodeFile(absPath, root);
    // Code files may also contain ORM model classes — run both
    registerDbFile(absPath, root);
  }
}

/**
 * Removes all entities owned by a file from shared state.
 *
 * @param {string} absPath - Absolute path to the file
 * @param {string} root    - Absolute path to the project root
 */
function unregisterFile(absPath, root) {
  const ext = path.extname(absPath).toLowerCase();

  if (isDbFile(ext)) {
    unregisterDbFile(absPath, root);
  } else {
    unregisterCodeFile(absPath, root);
    unregisterDbFile(absPath, root);
  }
}

module.exports = { registerFile, unregisterFile, rel, detectGroup };
