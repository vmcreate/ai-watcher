'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/parsers/code-generic.js — Multi-Language Regex Parser  │
 * │                                                             │
 * │  Regex-based fallback for languages not handled by the      │
 * │  specialised JS parser:                                     │
 * │    Python (.py)  → `def name(:`                            │
 * │    Rust   (.rs)  → `fn name(`                              │
 * │    Go     (.go)  → `func [receiver] name(`                 │
 * │    Dart   (.dart)→ modifier* Type name( pattern            │
 * │    Ruby   (.rb)  → `def name`                              │
 * │    Java/Kotlin/C# → modifier* Type name( pattern           │
 * │    PHP           → `function name(`                        │
 * │    C/C++/Swift   → modifier* Type name( pattern            │
 * │                                                             │
 * │  Imports : config (IGNORED_KEYWORDS)                        │
 * │  Exports : parseGeneric(content, relativePath, group, ext)  │
 * └─────────────────────────────────────────────────────────────┘
 */

const { IGNORED_KEYWORDS } = require('../config');

/**
 * Language-specific regex patterns matched against trimmed source lines.
 * Each pattern must capture the function/method name as group 1.
 *
 * Ordered by specificity — more specific languages first.
 * @type {Array<{ ext: string[], pattern: RegExp }>}
 */
const LANGUAGE_PATTERNS = [
  // Python: `def my_function(...):`
  { ext: ['.py'],         pattern: /^def\s+([a-zA-Z0-9_]+)\s*\(/ },
  // Rust:   `fn my_function(` or `pub fn my_function(`
  { ext: ['.rs'],         pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*[(<]/ },
  // Go:     `func myFunc(` or `func (r Receiver) myFunc(`
  { ext: ['.go'],         pattern: /^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/ },
  // Ruby:   `def my_method` or `def self.my_method`
  { ext: ['.rb'],         pattern: /^def\s+(?:self\.)?([a-zA-Z0-9_!?]+)/ },
  // PHP:    `function myFunc(` / `public function myFunc(`
  { ext: ['.php'],        pattern: /(?:public|private|protected|static|abstract|final|\s)*function\s+([a-zA-Z0-9_]+)\s*\(/ },
];

/**
 * Generic catch-all: matches common `modifier* Type name(` patterns used in
 * Java, Kotlin, C#, Swift, Dart, C, C++, and similar languages.
 * Used when no language-specific pattern matches.
 */
const GENERIC_PATTERN = /(?:(?:public|private|protected|static|async|override|abstract|final|void|Future|Widget|String|int|bool|double|var|let|const|fun|func)\s+)+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:async\s*)?[{=:]/;

/**
 * Selects the appropriate regex patterns for a given file extension.
 *
 * @param {string} ext - Lowercase file extension including dot (e.g. ".py")
 * @returns {RegExp[]} Ordered list of patterns to try
 */
function getPatternsForExt(ext) {
  for (const entry of LANGUAGE_PATTERNS) {
    if (entry.ext.includes(ext)) return [entry.pattern, GENERIC_PATTERN];
  }
  return [GENERIC_PATTERN];
}

/**
 * Parses a source file of any supported language and returns a list of
 * function/method descriptors using regex heuristics.
 *
 * This parser makes no attempt to understand scoping or ASTs — it operates
 * line-by-line and is intentionally conservative (low false-positive rate
 * is preferred over high recall).
 *
 * @param {string} content      - Raw file content
 * @param {string} relativePath - Project-relative forward-slash path
 * @param {string} group        - Architectural group/module label
 * @param {string} ext          - Lowercase file extension (e.g. ".py")
 * @returns {Array<object>} Array of function descriptor objects
 */
function parseGeneric(content, relativePath, group, ext) {
  const lines    = content.split('\n');
  const patterns = getPatternsForExt(ext);
  const rawFuncs = [];

  // Collect import-like paths for cross-file link resolution
  const fileImports = new Set();
  const importRe = /(?:import|require|from|use|include)\s*['"` ]?([^'"`\s;]+)/gi;
  let impMatch;
  while ((impMatch = importRe.exec(content)) !== null) {
    fileImports.add(impMatch[1].toLowerCase());
  }

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();

    // Skip blank lines and common comment styles
    if (!trimmed) return;
    if (trimmed.startsWith('//') || trimmed.startsWith('#') ||
        trimmed.startsWith('*') || trimmed.startsWith('/*') ||
        trimmed.startsWith('--') || trimmed.startsWith('"""')) return;

    let fnName = null;
    for (const pat of patterns) {
      const m = trimmed.match(pat);
      if (m) { fnName = m[1]; break; }
    }

    if (!fnName || fnName.length <= 1) return;

    const lower = fnName.toLowerCase();
    if (IGNORED_KEYWORDS.has(lower)) return;
    if (/^(if|for|while|switch|catch|return|def|fn|func|fun)$/.test(lower)) return;

    rawFuncs.push({ name: fnName, line: idx + 1, lineIdx: idx });
  });

  // Attach body slices for call-graph analysis
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

module.exports = { parseGeneric };
