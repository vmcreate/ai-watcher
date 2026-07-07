'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/config.js — Static Configuration                      │
 * │                                                             │
 * │  The single source of truth for all constants and patterns. │
 * │  This module has NO imports from src/ and NO side-effects.  │
 * │  Every other module pulls from here; nothing writes here.   │
 * └─────────────────────────────────────────────────────────────┘
 */

// ─── HTTP Server ────────────────────────────────────────────────────────────

/** Port the dashboard HTTP server listens on. */
const PORT = 4321;

/** Filename written to the watched root with live graph state (AI sink file). */
const SINK_FILE = '.ai_context.json';

// ─── File-System Filtering ───────────────────────────────────────────────────

/**
 * Patterns that cause a file/directory to be excluded from scanning.
 * Matched against the full absolute path (forward-slash normalised).
 * @type {RegExp[]}
 */
const IGNORED_PATTERNS = [
  /(^|[/\\])\../,    // dot-files / dot-directories (.git, .env, …)
  /node_modules/,
  /\.git/,
  /\bbuild\b/,
  /\bdist\b/,
  /\bout\b/,
  /\.dart_tool/,
  /\.idea/,
  /__pycache__/,
  /\.pytest_cache/,
  /\bcoverage\b/,
  /\.next/,
  /\.nuxt/,
  /\bvenv\b/,
  /\.venv/,
];

/**
 * File extensions that are indexed by the parser ecosystem.
 * @type {Set<string>}
 */
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.dart', '.py', '.rb', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.vue', '.svelte', '.php', '.cs', '.sql', '.prisma',
]);

// ─── Parser Filtering ────────────────────────────────────────────────────────

/**
 * Control-flow keywords and common built-ins that must never be treated as
 * user-defined function names during extraction.
 * @type {Set<string>}
 */
const IGNORED_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'try', 'finally',
  'return', 'throw', 'yield', 'await', 'async', 'import', 'export', 'require',
  'super', 'this', 'self', 'constructor', 'class', 'struct', 'interface', 'enum',
  'console', 'log', 'print', 'println', 'printf', 'sizeof', 'typeof', 'instanceof',
  'main', 'void', 'int', 'string', 'bool', 'double', 'float', 'list', 'map', 'set',
  'widget', 'build', 'initstate', 'dispose', 'setstate', 'override',
]);

// ─── Architecture View — Layer Classification ────────────────────────────────

/**
 * Maps top-level directory name prefixes to a human-readable architectural
 * layer label used in the Tab 3 "Architecture View" tree.
 *
 * Ordered from most-specific to least-specific — first match wins.
 * @type {Array<{ pattern: RegExp, label: string }>}
 */
const LAYER_RULES = [
  { pattern: /^bin$/i,                             label: 'CLI Entry'      },
  { pattern: /^src[/\\]?parsers/i,                 label: 'Parsers'        },
  { pattern: /^src[/\\]?core/i,                    label: 'Core Engine'    },
  { pattern: /^src[/\\]?server/i,                  label: 'Server'         },
  { pattern: /^src$/i,                             label: 'Application'    },
  { pattern: /^(lib|src)[/\\]?(models?|entities)/i,label: 'Data Models'    },
  { pattern: /^(db|database|schema|migrations?)/i, label: 'Database'       },
  { pattern: /^(test|spec|__tests__)/i,            label: 'Tests'          },
  { pattern: /^(docs?|documentation)/i,            label: 'Documentation'  },
  { pattern: /^(scripts?|tools?|utils?)/i,         label: 'Utilities'      },
];

/**
 * Resolves a relative file path to an architectural layer label.
 * Falls back to the top-level directory name, or "Root" for flat files.
 *
 * @param {string} relativePath - Forward-slash separated path from project root
 * @returns {string} Human-readable layer label
 */
function resolveLayer(relativePath) {
  for (const { pattern, label } of LAYER_RULES) {
    if (pattern.test(relativePath)) return label;
  }
  const parts = relativePath.split('/');
  if (parts.length === 1) return 'Root';
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

module.exports = {
  PORT,
  SINK_FILE,
  IGNORED_PATTERNS,
  SOURCE_EXTENSIONS,
  IGNORED_KEYWORDS,
  LAYER_RULES,
  resolveLayer,
};
