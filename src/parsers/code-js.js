'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/parsers/code-js.js — JavaScript / TypeScript Parser   │
 * │                                                             │
 * │  Two responsibilities:                                      │
 * │  1. Syntax validation via `node --check` (JS/MJS/CJS only) │
 * │  2. Structural extraction — finds function declarations,    │
 * │     arrow functions, method definitions, and class methods. │
 * │                                                             │
 * │  Imports : config (IGNORED_KEYWORDS)                        │
 * │  Exports : checkSyntax(absPath)                             │
 * │            parseJs(absPath, content, relativePath, group)   │
 * └─────────────────────────────────────────────────────────────┘
 */

const { execSync }       = require('child_process');
const { IGNORED_KEYWORDS } = require('../config');

// ─── Syntax Checker ──────────────────────────────────────────────────────────

/**
 * Runs `node --check` against a JS/MJS/CJS file to detect syntax errors
 * without executing the file. Returns the first line of the compiler message
 * on failure, or `null` if the file is valid (or not a JS file).
 *
 * @param {string} absPath - Absolute path to the file
 * @returns {string|null}
 */
function checkSyntax(absPath) {
  const ext = absPath.slice(absPath.lastIndexOf('.')).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') return null;

  try {
    execSync(`node --check "${absPath}"`, { stdio: 'pipe' });
    return null; // No errors
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message;
    return msg.split('\n')[0] || msg;
  }
}

// ─── Function Extractor ──────────────────────────────────────────────────────

/**
 * Builds a Set of module paths referenced by import/require statements
 * inside the given source content. Used later for cross-file link resolution.
 *
 * @param {string} content - Raw file content
 * @returns {Set<string>} Lowercase import paths
 */
function extractImports(content) {
  const fileImports = new Set();
  const importRe = /(?:import|require|from|use|include)\s*['"` ]?([^'"`\s;]+)/gi;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    fileImports.add(m[1].toLowerCase());
  }
  return fileImports;
}

/**
 * Attempts to match a single source line against all known JS/TS function
 * declaration patterns. Returns the captured function name, or null.
 *
 * Pattern priority (top to bottom):
 *  1. Named function declarations:  `function foo(` / `async function foo(`
 *  2. Arrow function assignments:   `const foo = () =>` / `const foo = async x =>`
 *  3. Class / object methods with modifiers: `public async getFoo() {`
 *  4. Bare method shorthand:        `getFoo() {`
 *
 * @param {string} trimmed - Pre-trimmed line of source code
 * @returns {string|null}
 */
function matchFunctionName(trimmed) {
  let m;

  // 1. Traditional function declaration
  if ((m = trimmed.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/))) return m[1];

  // 2. Arrow function assigned to a variable
  if ((m = trimmed.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)?\s*=>/))) return m[1];

  // 3. Method with access/type modifier keywords
  if ((m = trimmed.match(/(?:(?:public|private|protected|static|async|override|abstract|final|void|Future|Widget|String|int|bool|double|var|let|const)\s+)+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:async\s*)?[{=]/))) return m[1];

  // 4. Bare method shorthand `name(...) {`
  if ((m = trimmed.match(/^([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/))) return m[1];

  return null;
}

/**
 * Parses a JS/TS file and returns a structured list of function descriptors.
 * Each descriptor includes the function name, its line number, its body text
 * (used for call-graph link resolution), and the file's import paths.
 *
 * @param {string} absPath      - Absolute path (used only for display)
 * @param {string} content      - Raw file content
 * @param {string} relativePath - Project-relative forward-slash path
 * @param {string} group        - Architectural group/module label
 * @returns {Array<object>} Array of function descriptor objects
 */
function parseJs(absPath, content, relativePath, group) {
  const lines       = content.split('\n');
  const fileImports = extractImports(content);
  const rawFuncs    = [];

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();

    // Skip comment lines — avoids false matches inside JSDoc blocks
    if (trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('/*') || trimmed.startsWith('#')) return;

    const fnName = matchFunctionName(trimmed);
    if (!fnName || fnName.length <= 1) return;

    const lower = fnName.toLowerCase();
    if (IGNORED_KEYWORDS.has(lower)) return;
    if (/^(if|for|while|switch|catch|return)$/.test(lower)) return;

    rawFuncs.push({ name: fnName, line: idx + 1, lineIdx: idx });
  });

  // Build full descriptors, including body text for call-graph analysis
  return rawFuncs.map((fn, i) => {
    const nextLineIdx = i + 1 < rawFuncs.length ? rawFuncs[i + 1].lineIdx : lines.length;
    const bodyText    = lines.slice(fn.lineIdx, nextLineIdx).join('\n');

    return {
      key:     `${relativePath}::${fn.name}`,
      name:    fn.name,
      file:    relativePath,
      group:   group,
      line:    fn.line,
      body:    bodyText,
      imports: fileImports,
    };
  });
}

module.exports = { checkSyntax, parseJs };
