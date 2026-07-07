#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   AI-WATCHER v2.6.0 — Balanced Readable Architecture Visualizer ║
 * ║  Zero-Configuration · Real-Time · Perfectly Spaced Layout       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage   : ai-watcher [target-directory]
 * Default : Current working directory
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const { exec } = require('child_process');
const chokidar = require('chokidar');

// ─────────────────────────────────────────────────────────────────────────────
// ANSI COLORS & LOGGING
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bgRed:    '\x1b[41m',
};

const log = {
  info:    (...m) => console.log(`${C.blue}[AI-WATCHER]${C.reset}`, ...m),
  success: (...m) => console.log(`${C.green}[SYNC OK]${C.reset}   `, ...m),
  warn:    (...m) => console.log(`${C.yellow}[WARN]${C.reset}      `, ...m),
  error:   (...m) => console.error(`${C.red}[ERROR]${C.reset}     `, ...m),

  critical: (fnA, fnB) => {
    const msg = `Broken function call chain between ${fnA} and ${fnB}`;
    console.log('');
    console.log(`${C.bgRed}${C.bold}${C.white}  ⚠️  CRITICAL: ${msg}  ${C.reset}`);
    console.log('');
    return msg;
  },

  banner: () => {
    console.log(`\n${C.cyan}${C.bold}`);
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║  AI-WATCHER v2.6.0 — Balanced Layout Visualizer  ║');
    console.log('  ║  Language-Agnostic Code Execution & ERD Schema   ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log(`${C.reset}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION & PATTERNS
// ─────────────────────────────────────────────────────────────────────────────
const PORT      = 4321;
const SINK_FILE = '.ai_context.json';

const IGNORED_PATTERNS = [
  /(^|[/\\])\../,
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

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.dart', '.py', '.rb', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.vue', '.svelte', '.php', '.cs', '.sql', '.prisma',
]);

const IGNORED_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'try', 'finally',
  'return', 'throw', 'yield', 'await', 'async', 'import', 'export', 'require',
  'super', 'this', 'self', 'constructor', 'class', 'struct', 'interface', 'enum',
  'console', 'log', 'print', 'println', 'printf', 'sizeof', 'typeof', 'instanceof',
  'main', 'void', 'int', 'string', 'bool', 'double', 'float', 'list', 'map', 'set',
  'widget', 'build', 'initstate', 'dispose', 'setstate', 'override'
]);

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE (Functions Graph & Multi-Tenant DB ERD Graph)
// ─────────────────────────────────────────────────────────────────────────────

const allFunctions = new Map();
const fileToFunctionsMap = new Map();
const funcNameToKeysMap = new Map();
const graphLinks = new Map();
const previousLinks = new Set();
const previousContent = new Map();

const dbTables = new Map();
const dbLinks = new Map();
const fileToDbTablesMap = new Map();

const runtimeErrors = new Map();
const syntaxErrors = new Map();


const { execSync } = require('child_process');

function checkSyntax(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    try {
      execSync(`node --check "${absPath}"`, { stdio: 'pipe' });
      return null;
    } catch (err) {
      const msg = err.stderr ? err.stderr.toString() : err.message;
      return msg.split('\n')[0] || msg; // Clean first line of syntax error
    }
  }
  return null;
}

function getEditDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function findSimilarFunctions(targetName) {
  const suggestions = [];
  const lowerTarget = targetName.toLowerCase();
  for (const [key, fn] of allFunctions) {
    const fnNameLower = fn.name.toLowerCase();
    if (fnNameLower.includes(lowerTarget) || lowerTarget.includes(fnNameLower) || getEditDistance(lowerTarget, fnNameLower) <= 3) {
      suggestions.push(`${fn.name}()`);
    }
  }
  // Return unique suggestions
  return [...new Set(suggestions)].slice(0, 3);
}

const ROOT = path.resolve(process.argv[2] || process.cwd());

function rel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, '/');
}

function detectGroup(relativePath) {
  const parts = relativePath.split('/');
  if (parts.length === 1) return 'root';
  const knownRoots = new Set(['lib', 'src', 'app', 'packages', 'modules', 'db', 'models', 'entities']);
  if (parts.length >= 3 && knownRoots.has(parts[0])) return parts[1];
  return parts[parts.length - 2] || parts[0];
}

function isIgnored(p) {
  const n = p.replace(/\\/g, '/');
  return IGNORED_PATTERNS.some((re) => re.test(n));
}

function isTracked(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function readFileSafe(absPath) {
  try { return fs.readFileSync(absPath, 'utf8'); } catch { return ''; }
}

function openBrowser(url) {
  const cmds = {
    win32:  `start "" "${url}"`,
    darwin: `open "${url}"`,
    linux:  `xdg-open "${url}"`,
  };
  const cmd = cmds[process.platform] || cmds.linux;
  exec(cmd, (err) => {
    if (err) log.warn(`Could not automatically open browser: ${err.message}`);
    else log.info(`${C.green}Browser opened automatically: ${C.cyan}${url}${C.reset}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SCHEMA EXTRACTION & LINK RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

function registerDatabaseSchema(absPath) {
  const relativePath = rel(absPath);
  const content = readFileSafe(absPath);
  if (!content) return;

  unregisterDatabaseSchema(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const group = detectGroup(relativePath);
  const tableSet = new Set();

  if (ext === '.sql') {
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?\s*\(([\s\S]*?)\);/gi;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
      const tableName = match[1];
      const body = match[2];
      const fields = [];

      const colLines = body.split('\n');
      colLines.forEach((line) => {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed || /^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|KEY|INDEX)/i.test(trimmed)) return;
        const colMatch = trimmed.match(/^["`]?([a-zA-Z0-9_]+)["`]?\s+([a-zA-Z0-9_()]+)/);
        if (colMatch) {
          const colName = colMatch[1];
          const colType = colMatch[2];
          const isPk = /PRIMARY\s+KEY/i.test(trimmed) || colName.toLowerCase() === 'id';
          const isFk = /REFERENCES/i.test(trimmed) || (colName.toLowerCase() !== 'id' && (/_id$/i.test(colName) || /id$/i.test(colName)));
          fields.push({ name: colName, type: colType, isPk, isFk });
        }
      });

      tableSet.add(tableName);
      dbTables.set(tableName, { id: tableName, name: tableName, file: relativePath, group: group, fields: fields, type: 'SQL Table' });
    }
  } else if (ext === '.prisma') {
    const modelRegex = /model\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/gi;
    let match;
    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const fields = [];

      body.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) return;
        const fMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_?\[\]]+)/);
        if (fMatch) {
          const fName = fMatch[1];
          const fType = fMatch[2];
          const isPk = /@id/i.test(trimmed) || fName.toLowerCase() === 'id';
          const isFk = /@relation/i.test(trimmed) || (fName.toLowerCase() !== 'id' && fName.toLowerCase().endsWith('id'));
          fields.push({ name: fName, type: fType, isPk, isFk });
        }
      });

      tableSet.add(modelName);
      dbTables.set(modelName, { id: modelName, name: modelName, file: relativePath, group: group, fields: fields, type: 'Prisma Model' });
    }
  } else {
    const lines = content.split('\n');
    let currentClass = null;
    let classFields = [];

    lines.forEach((lineText) => {
      const trimmed = lineText.trim();
      let m;

      if ((m = trimmed.match(/(?:class|struct)\s+([a-zA-Z0-9_]+)/))) {
        if (currentClass && classFields.length > 0) {
          tableSet.add(currentClass);
          dbTables.set(currentClass, { id: currentClass, name: currentClass, file: relativePath, group: group, fields: classFields, type: 'Code Model' });
        }
        const candidate = m[1];
        if (['User','Patient','Clinic','Tenant','Doctor','Appointment','Order','Product','Customer','Account','Invoice','Role','Organization'].some(k => candidate.toLowerCase().includes(k.toLowerCase())) || /Model|Entity|Table/i.test(trimmed)) {
          currentClass = candidate;
          classFields = [];
        } else {
          currentClass = null;
        }
      } else if (currentClass) {
        if ((m = trimmed.match(/^(?:public|private|protected|final|late|readonly)?\s*(?:[a-zA-Z0-9_<>?]+[\s*]+)?([a-zA-Z0-9_]+)\s*[:=;]/))) {
          const fname = m[1];
          if (!['constructor','function','get','set'].includes(fname) && fname.length > 1) {
            const isPk = fname.toLowerCase() === 'id';
            const isFk = fname.toLowerCase() !== 'id' && (fname.toLowerCase().endsWith('id') || fname.toLowerCase().endsWith('_id'));
            classFields.push({ name: fname, type: 'field', isPk, isFk });
          }
        }
      }
    });

    if (currentClass && classFields.length > 0) {
      tableSet.add(currentClass);
      dbTables.set(currentClass, { id: currentClass, name: currentClass, file: relativePath, group: group, fields: classFields, type: 'Code Model' });
    }
  }

  fileToDbTablesMap.set(relativePath, tableSet);
  rebuildDbLinks();
}

function unregisterDatabaseSchema(absPath) {
  const relativePath = rel(absPath);
  const oldTables = fileToDbTablesMap.get(relativePath) || new Set();

  for (const table of oldTables) {
    dbTables.delete(table);
  }
  fileToDbTablesMap.delete(relativePath);
  rebuildDbLinks();
}

function rebuildDbLinks() {
  dbLinks.clear();
  const allTableNames = Array.from(dbTables.keys());

  for (const [srcName, srcTable] of dbTables) {
    for (const field of srcTable.fields) {
      if (field.isFk && field.name.length > 2) {
        const rawTarget = field.name.replace(/_?id$/i, '');
        const targetLower = rawTarget.toLowerCase();

        for (const tgtCandidate of allTableNames) {
          if (tgtCandidate === srcName) continue;
          const candLower = tgtCandidate.toLowerCase();

          if (candLower === targetLower || candLower === `${targetLower}s` || candLower === `tbl_${targetLower}`) {
            const linkId = `${srcName}→${tgtCandidate}`;
            dbLinks.set(linkId, { source: srcName, target: tgtCandidate, id: linkId, label: field.name });
          }
        }
      }
    }
  }
}

function getDatabaseGraphData() {
  return {
    nodes: Array.from(dbTables.values()),
    links: Array.from(dbLinks.values()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION EXTRACTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function extractFunctionsFromFile(content, relativePath) {
  const lines = content.split('\n');
  const fileImports = new Set();
  
  const importRe = /(?:import|require|from|use|include)\s*['"`]?([^'"`\s;]+)/gi;
  let impMatch;
  while ((impMatch = importRe.exec(content)) !== null) {
    fileImports.add(impMatch[1].toLowerCase());
  }

  const rawFuncs = [];

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('#')) return;

    let fnName = null;
    let m;

    if ((m = trimmed.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/)) ||
        (m = trimmed.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)?\s*=>/)) ||
        (m = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\(/)) ||
        (m = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/)) ||
        (m = trimmed.match(/^fn\s+([a-zA-Z0-9_]+)\s*\(/))
       ) {
      fnName = m[1];
    } else if ((m = trimmed.match(/(?:(?:public|private|protected|static|async|override|abstract|final|void|Future|Widget|String|int|bool|double|var|let|const)\s+)+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:async\s*)?[{=]/))) {
      fnName = m[1];
    } else if ((m = trimmed.match(/^([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/))) {
      fnName = m[1];
    }

    if (fnName && fnName.length > 1) {
      const lower = fnName.toLowerCase();
      if (!IGNORED_KEYWORDS.has(lower) && !/^(if|for|while|switch|catch|return)$/.test(lower)) {
        rawFuncs.push({ name: fnName, line: lineNum, lineIdx: idx });
      }
    }
  });

  const extracted = [];
  const group = detectGroup(relativePath);

  for (let i = 0; i < rawFuncs.length; i++) {
    const current = rawFuncs[i];
    const nextLineIdx = (i + 1 < rawFuncs.length) ? rawFuncs[i + 1].lineIdx : lines.length;
    const bodyText = lines.slice(current.lineIdx, nextLineIdx).join('\n');
    const funcKey = `${relativePath}::${current.name}`;

    extracted.push({
      key: funcKey,
      name: current.name,
      file: relativePath,
      group: group,
      line: current.line,
      body: bodyText,
      imports: fileImports,
    });
  }

  return extracted;
}

function registerFileFunctions(absPath) {
  const relativePath = rel(absPath);

  // Syntax validation
  const synErr = checkSyntax(absPath);
  if (synErr) {
    syntaxErrors.set(relativePath, synErr);
  } else {
    syntaxErrors.delete(relativePath);
  }

  const content = readFileSafe(absPath);
  if (!content) return;

  unregisterFileFunctions(absPath);

  const funcs = extractFunctionsFromFile(content, relativePath);
  const keySet = new Set();

  for (const fn of funcs) {
    allFunctions.set(fn.key, fn);
    keySet.add(fn.key);

    const lower = fn.name.toLowerCase();
    if (!funcNameToKeysMap.has(lower)) {
      funcNameToKeysMap.set(lower, new Set());
    }
    funcNameToKeysMap.get(lower).add(fn.key);
  }

  fileToFunctionsMap.set(relativePath, keySet);
}

function unregisterFileFunctions(absPath) {
  const relativePath = rel(absPath);
  syntaxErrors.delete(relativePath);
  const oldKeys = fileToFunctionsMap.get(relativePath) || new Set();

  for (const key of oldKeys) {
    const fn = allFunctions.get(key);
    if (fn) {
      const lower = fn.name.toLowerCase();
      const nameSet = funcNameToKeysMap.get(lower);
      if (nameSet) {
        nameSet.delete(key);
        if (nameSet.size === 0) funcNameToKeysMap.delete(lower);
      }
      allFunctions.delete(key);
    }
  }

  fileToFunctionsMap.delete(relativePath);
}

function rebuildAllLinks() {
  const newLinkSet = new Set();
  const newGraphLinks = new Map();

  for (const [srcKey, srcFn] of allFunctions) {
    const body = srcFn.body;

    for (const [targetNameLower, candidateKeys] of funcNameToKeysMap) {
      if (candidateKeys.size === 0) continue;

      const escaped = targetNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callRe = new RegExp(`\\b${escaped}\\b\\s*\\(`, 'i');

      if (callRe.test(body)) {
        let resolvedTargetKey = null;

        for (const candKey of candidateKeys) {
          if (candKey.startsWith(`${srcFn.file}::`)) {
            if (candKey !== srcKey) resolvedTargetKey = candKey;
            break;
          }
        }

        if (!resolvedTargetKey) {
          for (const candKey of candidateKeys) {
            const candFn = allFunctions.get(candKey);
            if (candFn) {
              const candFileLower = candFn.file.toLowerCase();
              for (const imp of srcFn.imports) {
                if (candFileLower.includes(imp)) {
                  resolvedTargetKey = candKey;
                  break;
                }
              }
            }
            if (resolvedTargetKey) break;
          }
        }

        if (!resolvedTargetKey && candidateKeys.size === 1) {
          const onlyKey = Array.from(candidateKeys)[0];
          if (onlyKey !== srcKey) resolvedTargetKey = onlyKey;
        }

        if (resolvedTargetKey && resolvedTargetKey !== srcKey) {
          const linkId = `${srcKey}→${resolvedTargetKey}`;
          newGraphLinks.set(linkId, {
            source: srcKey,
            target: resolvedTargetKey,
            id: linkId
          });
          newLinkSet.add(linkId);
        }
      }
    }
  }

  const brokenMessages = [];
  if (previousLinks.size > 0) {
    for (const oldLinkId of previousLinks) {
      if (!newLinkSet.has(oldLinkId)) {
        const [srcKey, tgtKey] = oldLinkId.split('→');
        const srcName = srcKey.split('::').pop();
        const tgtName = tgtKey.split('::').pop();
        const suggestions = findSimilarFunctions(tgtName);
        let suggText = "";
        if (suggestions.length > 0) {
          suggText = ` (Did you mean: ${suggestions.join(', ')}?)`;
        }
        const msg = log.critical(`${srcName}()`, `${tgtName}()`) + suggText;
        brokenMessages.push(msg);
      }
    }
  }

  graphLinks.clear();
  for (const [k, v] of newGraphLinks) {
    graphLinks.set(k, v);
  }

  previousLinks.clear();
  for (const l of newLinkSet) {
    previousLinks.add(l);
  }

  return brokenMessages.length > 0 ? brokenMessages.join(' | ') : null;
}

function getGraphData() {
  const nodes = [];
  for (const [key, fn] of allFunctions) {
    let hasRuntimeError = false;
    let runtimeErrorMsg = null;

    const err = runtimeErrors.get(fn.key) || runtimeErrors.get(fn.name);
    if (err) {
      hasRuntimeError = true;
      runtimeErrorMsg = err;
    }

    nodes.push({
      id: key,
      name: `${fn.name}()`,
      file: fn.file,
      group: fn.group,
      path: fn.file,
      line: fn.line,
      hasRuntimeError: hasRuntimeError,
      runtimeError: runtimeErrorMsg,
    });
  }

  return {
    nodes: nodes,
    links: Array.from(graphLinks.values()),
    syntaxError: syntaxErrors.size > 0 ? Array.from(syntaxErrors.values())[0] : null,
  };
}

function writeSink(absPath, brokenAlert = null) {
  const relativePath = rel(absPath);
  const sinkPath     = path.join(ROOT, SINK_FILE);
  const timestamp    = new Date().toISOString();

  let change_history = [];
  try {
    if (fs.existsSync(sinkPath)) {
      const parsed = JSON.parse(fs.readFileSync(sinkPath, 'utf8'));
      change_history = parsed.change_history || parsed.istorija_izmena || [];
    }
  } catch { change_history = []; }

  const activeSyntaxError = syntaxErrors.size > 0 ? Array.from(syntaxErrors.values())[0] : null;
  let statusText = 'OK';
  if (brokenAlert) {
    statusText = `CRITICAL: ${brokenAlert}`;
  } else if (activeSyntaxError) {
    statusText = `SYNTAX ERROR: ${activeSyntaxError}`;
  }

  const newEntry = {
    timestamp: timestamp,
    file: relativePath,
    status: statusText,
    total_functions: allFunctions.size,
    total_links: graphLinks.size,
  };

  change_history.unshift(newEntry);

  const payload = {
    last_modified_file: relativePath,
    sync_timestamp: timestamp,
    total_nodes: allFunctions.size,
    total_links: graphLinks.size,
    broken_link: brokenAlert,
    syntax_error: activeSyntaxError,
    change_history: change_history,
  };

  try { fs.writeFileSync(sinkPath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML VISUALIZATION — Balanced High-Readability Layout
// ─────────────────────────────────────────────────────────────────────────────

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>AI-Watcher — Code & DB Visualisation</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
:root {
  --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
  --border: #30363d; --text: #e6edf3; --muted: #8b949e;
  --accent: #388bfd; --danger: #f85149; --success: #3fb950; --warn: #d29922; --db: #a371f7;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 16px; }
.brand { display: flex; align-items: center; gap: 12px; }
header h1 { font-size: 15px; font-weight: 600; letter-spacing: .5px; display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); display: inline-block; animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.55)} }

.tabs { display: flex; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 3px; gap: 4px; }
.tab { padding: 5px 16px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; color: var(--muted); transition: all .2s; }
.tab:hover { color: var(--text); }
.tab.active { background: var(--bg3); color: var(--accent); border: 1px solid var(--border); }
.tab.active.db-tab { color: var(--db); }

.stats { display: flex; gap: 12px; }
.stat { display: flex; flex-direction: column; align-items: center; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 4px 14px; min-width: 75px; }
.stat-val { font-size: 18px; font-weight: 700; color: var(--accent); }
.stat-val.db { color: var(--db); }
.stat-lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }

main { display: flex; flex: 1; overflow: hidden; }
#gc { flex: 1; position: relative; overflow: hidden; }
svg { width: 100%; height: 100%; display: block; }
.link { stroke: #388bfd; stroke-opacity: .6; stroke-width: 1.5px; transition: stroke .3s; }
.link.db-link { stroke: #a371f7; stroke-dasharray: 4,4; stroke-width: 2px; }

.node circle { stroke: rgba(255,255,255,.2); stroke-width: 1.5px; cursor: pointer; transition: stroke-width .2s; }
.node circle:hover { stroke: white; stroke-width: 3px; }
.node text { font-size: 11px; font-weight: 600; fill: #e6edf3; pointer-events: none; text-anchor: middle; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }

aside { width: 280px; background: var(--bg2); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
.sec { padding: 12px 14px; border-bottom: 1px solid var(--border); overflow-y: auto; flex: 1; }
.sec h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin-bottom: 8px; }
#legend { display: flex; flex-direction: column; gap: 5px; }
.li { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 6px 8px; border-radius: 6px; cursor: pointer; user-select: none; transition: background .15s, opacity .15s; border: 1px solid transparent; }
.li:hover { background: var(--bg3); border-color: var(--border); }
.li.li-off { opacity: .4; }
.li.li-off .ld { background: #30363d !important; filter: grayscale(1); }
.li.li-off .li-name { text-decoration: line-through; color: var(--muted); }
.li-count { margin-left: auto; font-size: 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 1px 6px; color: var(--muted); }
.ld { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
#legend-hint { font-size: 10px; color: var(--muted); margin-top: 8px; text-align: center; opacity: .7; }

#tip { position: fixed; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; font-size: 12px; line-height: 1.6; pointer-events: none; opacity: 0; transition: opacity .15s; max-width: 340px; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
#tip.v { opacity: 1; }
#tip strong { color: var(--accent); display: block; margin-bottom: 6px; font-size: 14px; }
#tip strong.db { color: var(--db); border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.field-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; max-height: 200px; overflow-y: auto; }
.field-item { display: flex; align-items: center; justify-content: space-between; font-size: 11px; background: var(--bg2); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); }
.field-name { font-weight: 600; color: #e6edf3; }
.field-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 700; text-transform: uppercase; }
.tag-pk { background: rgba(210,153,34,.2); color: var(--warn); border: 1px solid var(--warn); }
.tag-fk { background: rgba(163,113,247,.25); color: var(--db); border: 1px solid var(--db); }

#banner { display: none; position: fixed; top: 0; left: 0; right: 0; background: var(--danger); color: white; text-align: center; padding: 10px 16px; font-weight: 700; font-size: 13px; z-index: 500; box-shadow: 0 4px 20px rgba(248,81,73,.5); }
#banner-close { cursor: pointer; margin-left: 16px; opacity: .8; font-size: 16px; }

/* Toggle styles */
.toggle-container {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.toggle-container input {
  cursor: pointer;
}

/* History list inside sidebar */
#history-list {
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-item {
  padding: 8px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
}
.history-item.critical {
  border-left: 3px solid var(--danger);
}
.history-item-header {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  margin-bottom: 4px;
}
.history-item-file {
  font-weight: 600;
  color: var(--text);
}
.history-item-msg {
  color: var(--danger);
  margin-top: 4px;
  white-space: pre-wrap;
}

/* Screen shake animation */
@keyframes shake {
  0%, 100% { transform: translate(0, 0); }
  10%, 30%, 50%, 70%, 90% { transform: translate(-5px, 0); }
  20%, 40%, 60%, 80% { transform: translate(5px, 0); }
}
.shake {
  animation: shake 0.6s ease-in-out;
}

/* Red overlay flash animation */
#red-flash-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  z-index: 2000;
  opacity: 0;
  box-shadow: inset 0 0 100px rgba(248, 81, 73, 0.8);
  transition: opacity 0.15s ease;
}
#red-flash-overlay.active {
  animation: flash-red 1.5s ease-out;
}
@keyframes flash-red {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 0; }
}

/* Floating screen overlay alert */
#screen-alert {
  position: fixed;
  top: 30%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  background: rgba(248, 81, 73, 0.95);
  color: white;
  padding: 20px 40px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 18px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.7);
  z-index: 2500;
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  text-align: center;
}
#screen-alert.show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
#screen-alert-sub {
  font-size: 12px;
  font-weight: 400;
  margin-top: 8px;
  opacity: 0.9;
}

/* Pulsing outline for runtime errors */
@keyframes pulse-error {
  0% { stroke: var(--danger); stroke-width: 2px; }
  50% { stroke: #bc8cff; stroke-width: 6px; }
  100% { stroke: var(--danger); stroke-width: 2px; }
}
.node.runtime-error circle {
  animation: pulse-error 1.5s infinite !important;
}
.pulse-danger {
  animation: danger-pulse 1.5s infinite;
  border-color: var(--danger) !important;
}
@keyframes danger-pulse {
  0% { box-shadow: inset 0 0 0 0 rgba(248, 81, 73, 0.4); }
  70% { box-shadow: inset 0 0 10px 2px rgba(248, 81, 73, 0.4); }
  100% { box-shadow: inset 0 0 0 0 rgba(248, 81, 73, 0); }
}

/* Custom scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: var(--bg);
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--muted);
}
</style>
</head>
<body>
<div id="banner"><span id="banner-text"></span><span id="banner-close" onclick="closeBanner()">✕</span></div>
<div id="syntax-banner" style="display:none; background:var(--warn); color:black; text-align:center; padding:10px 16px; font-weight:700; font-size:13px; z-index: 500; box-shadow: 0 4px 20px rgba(210,153,34,.5); position:fixed; top:0; left:0; right:0;"><span id="syntax-banner-text"></span></div>
<header>
  <div class="brand">
    <h1><span class="dot"></span> AI-Watcher</h1>
    <div class="tabs">
      <div class="tab active" id="tab-fn" onclick="switchTab('fn')">⚡ Functions Graph</div>
      <div class="tab db-tab" id="tab-db" onclick="switchTab('db')">🗄️ DB visualisation</div>
    </div>
  </div>
  <div style="display:flex; align-items:center; gap:20px;">
    <div class="toggle-container">
      <input type="checkbox" id="chk-connected" checked onchange="toggleConnectedOnly()"/>
      <label for="chk-connected" style="cursor:pointer; user-select:none; font-size:12px; color:var(--muted); font-weight:600;">Connected only</label>
    </div>
    <div class="stats">
      <div class="stat"><span class="stat-val" id="nc">0</span><span class="stat-lbl" id="lbl-n">Functions</span></div>
      <div class="stat"><span class="stat-val" id="lc">0</span><span class="stat-lbl" id="lbl-l">Calls</span></div>
      <div class="stat"><span class="stat-val" id="gc2">0</span><span class="stat-lbl">Modules</span></div>
    </div>
  </div>
</header>
<main>
  <div id="gc"><svg id="svg"></svg></div>
  <aside>
    <div class="sec"><h2 id="legend-title">Groups / Modules</h2><div id="legend"></div></div>
    <div class="sec" style="border-top:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; flex: 1;">
      <h2>⚠️ Break History (<span id="history-count">0</span>)</h2>
      <div id="history-list"></div>
    </div>
  </aside>
</main>
<div id="tip"></div>

<!-- Red flash overlay and screen alert -->
<div id="red-flash-overlay"></div>
<div id="screen-alert">
  <div>⚠️ LINKAGE BREAK DETECTED!</div>
  <div id="screen-alert-sub"></div>
</div>

<script>
var PAL=['#388bfd','#3fb950','#d29922','#f78166','#bc8cff','#39d353','#ff7b72','#ffa657','#79c0ff','#56d364','#e3b341','#c9d1d9'];
var DB_PAL=['#a371f7','#d2a8ff','#f0883e','#79c0ff','#56d364','#ff7b72'];
var color=d3.scaleOrdinal(PAL);
var dbColor=d3.scaleOrdinal(DB_PAL);

var currentTab='fn';
var sim,gEl,linkSel,nodeSel,curNodes=[],curLinks=[],lastFullData={nodes:[],links:[]},lastDbData={nodes:[],links:[]};
var hiddenGroups=new Set(), lastSync="", bannerT;

var showConnectedOnly = true;

function toggleConnectedOnly() {
  showConnectedOnly = document.getElementById("chk-connected").checked;
  renderGraph();
}

function updateCrashHistory(historyData) {
  if (!historyData) return;
  var listEl = document.getElementById("history-list");
  listEl.innerHTML = "";
  
  var criticalRuns = historyData.filter(function(item) {
    return item.status && item.status.indexOf("CRITICAL") !== -1;
  });
  
  criticalRuns.forEach(function(item) {
    var div = document.createElement("div");
    div.className = "history-item critical";
    
    var timestampStr = item.timestamp;
    var time = "";
    var date = "";
    try {
      var d = new Date(timestampStr);
      time = d.toLocaleTimeString();
      date = d.toLocaleDateString();
    } catch(e) {}
    
    div.innerHTML = 
      '<div class="history-item-header">' +
        '<span class="history-item-file">' + item.file + '</span>' +
        '<span>' + date + ' ' + time + '</span>' +
      '</div>' +
      '<div class="history-item-msg">' + item.status + '</div>';
    
    listEl.appendChild(div);
  });
  
  document.getElementById("history-count").textContent = criticalRuns.length;
}

function triggerBreakAnimation(msg) {
  // 1. Screen Shake
  var mainEl = document.querySelector("main");
  if (mainEl) {
    mainEl.classList.remove("shake");
    void mainEl.offsetWidth; // force reflow
    mainEl.classList.add("shake");
    setTimeout(function() {
      mainEl.classList.remove("shake");
    }, 600);
  }
  
  // 2. Red Flash Overlay
  var flashEl = document.getElementById("red-flash-overlay");
  if (flashEl) {
    flashEl.classList.remove("active");
    void flashEl.offsetWidth;
    flashEl.classList.add("active");
    setTimeout(function() {
      flashEl.classList.remove("active");
    }, 1500);
  }
  
  // 3. Center Screen Alert Overlay
  var alertEl = document.getElementById("screen-alert");
  var subEl = document.getElementById("screen-alert-sub");
  if (alertEl && subEl) {
    subEl.textContent = msg;
    alertEl.classList.add("show");
    setTimeout(function() {
      alertEl.classList.remove("show");
    }, 3500);
  }
  
  // 4. Pulse the sidebar history container
  var listEl = document.getElementById("history-list");
  if (listEl && listEl.parentElement) {
    listEl.parentElement.classList.add("pulse-danger");
    setTimeout(function() {
      listEl.parentElement.classList.remove("pulse-danger");
    }, 8000);
  }
}

function highlightBlastRadius(centerNodeId) {
  var upstream = new Set();
  var downstream = new Set();
  
  var queue = [centerNodeId];
  var visited = new Set([centerNodeId]);
  while (queue.length > 0) {
    var curr = queue.shift();
    curLinks.forEach(function(l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      if (s === curr && !visited.has(t)) {
        visited.add(t);
        downstream.add(t);
        queue.push(t);
      }
    });
  }
  
  queue = [centerNodeId];
  visited = new Set([centerNodeId]);
  while (queue.length > 0) {
    var curr = queue.shift();
    curLinks.forEach(function(l) {
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      if (t === curr && !visited.has(s)) {
        visited.add(s);
        upstream.add(s);
        queue.push(s);
      }
    });
  }
  
  nodeSel.select("circle")
    .transition().duration(150)
    .attr("stroke", function(d) {
      if (d.id === centerNodeId) return "var(--accent)";
      if (upstream.has(d.id)) return "var(--danger)";
      if (downstream.has(d.id)) return "var(--warn)";
      return "rgba(255,255,255,.2)";
    })
    .attr("stroke-width", function(d) {
      if (d.id === centerNodeId || upstream.has(d.id) || downstream.has(d.id)) return 4;
      return 1.5;
    });

  linkSel
    .transition().duration(150)
    .style("stroke-opacity", function(d) {
      var s = d.source.id || d.source;
      var t = d.target.id || d.target;
      if ((s === centerNodeId || downstream.has(s)) && downstream.has(t)) return 1.0;
      if (upstream.has(s) && (t === centerNodeId || upstream.has(t))) return 1.0;
      return 0.15;
    })
    .style("stroke", function(d) {
      var s = d.source.id || d.source;
      var t = d.target.id || d.target;
      if (upstream.has(s) && (t === centerNodeId || upstream.has(t))) return "var(--danger)";
      if ((s === centerNodeId || downstream.has(s)) && downstream.has(t)) return "var(--warn)";
      return currentTab === 'db' ? "#a371f7" : "#388bfd";
    });
}

function resetBlastRadius() {
  nodeSel.select("circle")
    .transition().duration(150)
    .attr("stroke", "rgba(255,255,255,.2)")
    .attr("stroke-width", 1.5);
    
  linkSel
    .transition().duration(150)
    .style("stroke-opacity", 0.6)
    .style("stroke", function(d) { return currentTab === 'db' ? "#a371f7" : "#388bfd"; });
}



function initSvg(){
  var svg=d3.select("#svg");
  svg.append("defs").append("marker")
    .attr("id","arr").attr("viewBox","0 -5 10 10")
    .attr("refX",22).attr("refY",0)
    .attr("markerWidth",6).attr("markerHeight",6)
    .attr("orient","auto")
    .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#388bfd");

  svg.select("defs").append("marker")
    .attr("id","arr-db").attr("viewBox","0 -5 10 10")
    .attr("refX",24).attr("refY",0)
    .attr("markerWidth",7).attr("markerHeight",7)
    .attr("orient","auto")
    .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#a371f7");

  gEl=svg.append("g");
  svg.call(d3.zoom().scaleExtent([.04,8]).on("zoom",function(e){gEl.attr("transform",e.transform);}));
}

function initSim(){
  var r=document.getElementById("gc").getBoundingClientRect();
  // Balanced, highly readable spacing physics
  sim=d3.forceSimulation()
    .alphaDecay(0.04)
    .force("link",d3.forceLink().id(function(d){return d.id;}).distance(120).strength(.5))
    .force("charge",d3.forceManyBody().strength(-200))
    .force("center",d3.forceCenter(r.width/2,r.height/2))
    .force("x",d3.forceX(r.width/2).strength(0.04))
    .force("y",d3.forceY(r.height/2).strength(0.04))
    .force("col",d3.forceCollide().radius(function(d){ return Math.max(45, (d.name||'').length * 4); }))
    .on("tick",tick);
}

function switchTab(t){
  currentTab=t;
  document.getElementById("tab-fn").className="tab"+(t==='fn'?' active':'');
  document.getElementById("tab-db").className="tab db-tab"+(t==='db'?' active':'');
  document.getElementById("nc").className="stat-val"+(t==='db'?' db':'');
  document.getElementById("lc").className="stat-val"+(t==='db'?' db':'');
  document.getElementById("lbl-n").textContent=t==='fn'?'Functions':'Entities';
  document.getElementById("lbl-l").textContent=t==='fn'?'Calls':'Relations';
  document.getElementById("legend-title").textContent=t==='fn'?'Groups / Modules':'DB Models';
  hiddenGroups.clear();
  
  if (sim) {
    sim.force("col").radius(function(d){ 
      return t === 'db' ? 95 : Math.max(45, (d.name||'').length * 4); 
    });
  }
  
  renderGraph();
}

function updateGraph(fnData, dbData){
  if(fnData) {
    lastFullData=fnData;
    showSyntaxError(fnData.syntaxError);
  }
  if(dbData) lastDbData=dbData;
  renderGraph();
}

function showSyntaxError(msg) {
  var b = document.getElementById("syntax-banner");
  var t = document.getElementById("syntax-banner-text");
  if (msg) {
    t.textContent = "⚠️ SYNTAX ERROR — " + msg;
    b.style.display = "block";
  } else {
    b.style.display = "none";
  }
}

function renderGraph(){
  var isDb = (currentTab==='db');
  var activeData = isDb ? lastDbData : lastFullData;

  var allNodes=activeData.nodes||[];
  var allLinks=activeData.links||[];

  // Calculate connected nodes if showConnectedOnly is active
  var connectedNodeIds = new Set();
  if (showConnectedOnly) {
    allLinks.forEach(function(l){
      var s = l.source.id || l.source;
      var t = l.target.id || l.target;
      connectedNodeIds.add(s);
      connectedNodeIds.add(t);
    });
  }

  var allGroups=[...new Set(allNodes.map(function(n){return n.group;}))];

  updateLegend(allGroups, allNodes);

  var nodes = allNodes.filter(function(n) {
    if (hiddenGroups.has(n.group)) return false;
    if (showConnectedOnly && !connectedNodeIds.has(n.id)) return false;
    return true;
  });

  var visIds=new Set(nodes.map(function(n){return n.id;}));
  var links=allLinks.filter(function(l){
    return visIds.has(l.source.id||l.source)&&visIds.has(l.target.id||l.target);
  });

  document.getElementById("nc").textContent=nodes.length+(hiddenGroups.size>0 || showConnectedOnly ? " / "+allNodes.length : "");
  document.getElementById("lc").textContent=links.length+(hiddenGroups.size>0 || showConnectedOnly ? " / "+allLinks.length : "");
  document.getElementById("gc2").textContent=allGroups.length;

  var em=new Map(curNodes.map(function(n){return [n.id,n];}));
  curNodes=nodes.map(function(n){var e=em.get(n.id);return e?Object.assign(e,n):n;});
  curLinks=links;

  linkSel=gEl.selectAll(".link").data(curLinks,function(d){return d.id;}).join(
    function(en){
      return en.append("line")
        .attr("class",isDb ? "link db-link" : "link")
        .attr("marker-end",isDb ? "url(#arr-db)" : "url(#arr)");
    },
    function(u){
      return u.attr("class",isDb ? "link db-link" : "link")
              .attr("marker-end",isDb ? "url(#arr-db)" : "url(#arr)");
    },
    function(ex){return ex.remove();}
  );

  nodeSel=gEl.selectAll(".node").data(curNodes,function(d){return d.id;}).join(
    function(en){
      var g=en.append("g").call(drag());
      return g;
    },
    function(u){return u;},
    function(ex){return ex.remove()}
  );

  nodeSel.attr("class",function(d){
    return "node" + (d.hasRuntimeError ? " runtime-error" : "") + (isDb ? " db-card-node" : "");
  });

  // Clear previous contents of the group to allow clean switch between circle and foreignObject
  nodeSel.selectAll("*").remove();

  if (isDb) {
    var fo = nodeSel.append("foreignObject")
      .attr("width", 160)
      .attr("height", function(d) {
        var fieldCount = (d.fields && d.fields.length) || 0;
        return 32 + (fieldCount * 18);
      })
      .attr("x", -80)
      .attr("y", function(d) {
        var fieldCount = (d.fields && d.fields.length) || 0;
        return -(32 + (fieldCount * 18)) / 2;
      });

    var div = fo.append("xhtml:div")
      .attr("style", "width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.5); font-family:sans-serif; background:var(--bg2);");

    div.append("xhtml:div")
      .attr("style", function(d) {
        return "background:" + dbColor(d.group) + "; color:white; padding:6px 10px; font-weight:bold; font-size:11px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
      })
      .text(function(d){ return d.name; });

    var fieldsDiv = div.append("xhtml:div")
      .attr("style", "padding:6px; display:flex; flex-direction:column; gap:4px; flex:1; background:var(--bg3); overflow-y:auto;");

    fieldsDiv.each(function(d) {
      var el = d3.select(this);
      if (d.fields && d.fields.length > 0) {
        d.fields.forEach(function(f) {
          var row = el.append("xhtml:div")
            .attr("style", "display:flex; justify-content:space-between; align-items:center; font-size:10px; line-height:1.2;");
          
          row.append("xhtml:span")
            .attr("style", "color:var(--text); font-weight:" + (f.isPk || f.isFk ? "bold" : "normal") + "; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;")
            .text(f.name);

          if (f.isPk) {
            row.append("xhtml:span")
              .attr("style", "color:var(--warn); font-size:8px; font-weight:bold; background:rgba(210,153,34,0.15); border:1px solid var(--warn); padding:0 3px; border-radius:3px; flex-shrink:0;")
              .text("PK");
          } else if (f.isFk) {
            row.append("xhtml:span")
              .attr("style", "color:var(--db); font-size:8px; font-weight:bold; background:rgba(163,113,247,0.15); border:1px solid var(--db); padding:0 3px; border-radius:3px; flex-shrink:0;")
              .text("FK");
          }
        });
      } else {
        el.append("xhtml:span")
          .attr("style", "color:var(--muted); font-size:9px; font-style:italic;")
          .text("No fields");
      }
    });

    nodeSel.on("mouseover", showTip).on("mousemove", moveTip).on("mouseout", hideTip);

  } else {
    nodeSel.append("circle")
      .attr("r", 11)
      .attr("fill", function(d){ return color(d.group); });

    nodeSel.append("text")
      .attr("dy", 25)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("font-weight", "600")
      .style("fill", "#e6edf3")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 4px rgba(0,0,0,0.8)")
      .text(function(d){ return d.name; });

    nodeSel.on("mouseover", function(e,d){
      showTip(e,d);
      highlightBlastRadius(d.id);
    })
    .on("mousemove", moveTip)
    .on("mouseout", function(e,d){
      hideTip();
      resetBlastRadius();
    });
  }

  var r=document.getElementById("gc").getBoundingClientRect();
  sim.force("center", d3.forceCenter(r.width/2, r.height/2));
  sim.force("x", d3.forceX(r.width/2).strength(0.04));
  sim.force("y", d3.forceY(r.height/2).strength(0.04));

  sim.nodes(curNodes);
  sim.force("link").links(curLinks);
  sim.alpha(.3).restart();
}

function tick(){
  if(linkSel) linkSel.attr("x1",function(d){return d.source.x;}).attr("y1",function(d){return d.source.y;}).attr("x2",function(d){return d.target.x;}).attr("y2",function(d){return d.target.y;});
  if(nodeSel) nodeSel.attr("transform",function(d){return "translate("+d.x+","+d.y+")";});
}

function drag(){
  return d3.drag()
    .on("start",function(e,d){if(!e.active)sim.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y;})
    .on("drag",function(e,d){d.fx=e.x;d.fy=e.y;})
    .on("end",function(e,d){if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;});
}

var tip=document.getElementById("tip");
function showTip(e,d){
  var isDb = (currentTab==='db');
  var html = "";
  if(isDb){
    html += "<strong class='db'>🗄️ Entity: "+d.name+"</strong>";
    html += "<span>File: <b>"+d.file+"</b></span><br>";
    html += "<span>Type: <b style='color:#a371f7'>"+(d.type||'Table')+"</b></span>";
    if(d.fields && d.fields.length>0){
      html += "<div class='field-list'>";
      d.fields.forEach(function(f){
        html += "<div class='field-item'>";
        html += "<span class='field-name'>"+f.name+"</span>";
        if(f.isPk) html += "<span class='field-tag tag-pk'>PK</span>";
        else if(f.isFk) html += "<span class='field-tag tag-fk'>FK / TENANT</span>";
        html += "</div>";
      });
      html += "</div>";
    }
  }else{
    html += "<strong>"+d.name+"</strong>";
    html += "<span>File: <b>"+d.file+"</b> (Line "+d.line+")</span><br>";
    html += "<span>Module: <b style='color:#d29922'>"+d.group+"</b></span>";
    if (d.hasRuntimeError && d.runtimeError) {
      html += "<br><span style='color:var(--danger); font-weight:bold; display:block; margin-top:8px;'>💥 RUNTIME ERROR:</span>";
      html += "<span style='color:var(--danger); font-size:10px; font-family:monospace; display:block; background:rgba(248,81,73,0.1); border:1px solid rgba(248,81,73,0.2); padding:6px; border-radius:4px; margin-top:4px; max-height:100px; overflow-y:auto; white-space:pre-wrap;'>" + d.runtimeError + "</span>";
    }
  }
  tip.innerHTML=html;
  tip.classList.add("v");
}
function moveTip(e){tip.style.left=(e.clientX+14)+"px";tip.style.top=(e.clientY+14)+"px";}
function hideTip(){tip.classList.remove("v");}

function updateLegend(groups, allNodes){
  var isDb = (currentTab==='db');
  var leg=document.getElementById("legend");
  leg.innerHTML="";
  groups.slice().sort().forEach(function(g){
    var isOff=hiddenGroups.has(g);
    var cnt=(allNodes||[]).filter(function(n){return n.group===g;}).length;
    var d=document.createElement("div");
    d.className="li"+(isOff?" li-off":"");
    d.title=(isOff?"Click to show":"Click to hide")+" group: "+g;
    d.innerHTML=
      '<span class="ld" style="background:'+(isOff?"#30363d":(isDb?dbColor(g):color(g)))+'"></span>'
      +'<span class="li-name">'+g+'</span>'
      +'<span class="li-count">'+cnt+'</span>'
      +'<span class="li-eye">'+(isOff?"👁️":"")+'</span>';
    d.addEventListener("click",function(){
      if(hiddenGroups.has(g)) hiddenGroups.delete(g); else hiddenGroups.add(g);
      renderGraph();
    });
    leg.appendChild(d);
  });
  var hint=document.createElement("div");
  hint.id="legend-hint";
  hint.textContent="💡 Click group to toggle visibility";
  leg.appendChild(hint);
}

function showBanner(msg){
  var b=document.getElementById("banner");
  document.getElementById("banner-text").textContent="⚠️  CRITICAL LINKAGE BROKEN — "+msg;
  b.style.display="block";
  clearTimeout(bannerT);
  bannerT=setTimeout(closeBanner,10000);
}
function closeBanner(){
  document.getElementById("banner").style.display="none";
  clearTimeout(bannerT);
}

async function poll(){
  try{
    var resFn=await fetch("/data");
    var resDb=await fetch("/db-data");
    updateGraph(await resFn.json(), await resDb.json());
  }catch(e){}

  try{
    var cr=await fetch("/.ai_context",{cache:"no-store"});
    if(cr.ok){
      var ctx=await cr.json();
      if(ctx.sync_timestamp && ctx.sync_timestamp!==lastSync){
        var isInitial = (lastSync === "");
        lastSync=ctx.sync_timestamp;
        if(ctx.change_history) {
          updateCrashHistory(ctx.change_history);
        }
        if(ctx.broken_link){
          showBanner(ctx.broken_link);
          if(!isInitial) {
            triggerBreakAnimation(ctx.broken_link);
          }
        }
      }
    }
  }catch(e){}
}

(function init(){
  initSvg();
  initSim();
  poll();
  setInterval(poll,2000);
})();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER & WATCHER
// ─────────────────────────────────────────────────────────────────────────────

function startServer() {
  const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    const url = (req.url || '/').split('?')[0];

    // POST /error
    if (req.method === 'POST' && url === '/error') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.functionName && payload.error) {
            runtimeErrors.set(payload.functionName, payload.error);
            writeSink(payload.file || 'runtime_environment', `Runtime crash in ${payload.functionName}(): ${payload.error}`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }



    if (url === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(getGraphData()));
      return;
    }

    if (url === '/db-data') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(getDatabaseGraphData()));
      return;
    }

    if (url === '/.ai_context') {
      try {
        const data = fs.readFileSync(path.join(ROOT, SINK_FILE), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(data);
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ broken_link: null }));
      }
      return;
    }

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml());
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    const serverUrl = `http://localhost:${PORT}`;
    log.info(`${C.bold}Visualization App: ${C.cyan}${serverUrl}${C.reset}`);
    openBrowser(serverUrl);
  });
}

function scanDirectory(dirPath) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (isIgnored(absPath)) continue;

    if (entry.isDirectory()) {
      scanDirectory(absPath);
    } else if (entry.isFile() && isTracked(absPath)) {
      registerFileFunctions(absPath);
      registerDatabaseSchema(absPath);
      previousContent.set(rel(absPath), readFileSafe(absPath));
    }
  }
}

function startWatcher() {
  const watcher = chokidar.watch(ROOT, {
    ignored: IGNORED_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher
    .on('add', (p) => {
      if (!isTracked(p) || isIgnored(p)) return;
      registerFileFunctions(p);
      registerDatabaseSchema(p);
      const brokenAlert = rebuildAllLinks();
      writeSink(p, brokenAlert);
      log.info(`New file indexed: ${rel(p)}`);
    })
    .on('change', (p) => {
      if (!isTracked(p) || isIgnored(p)) return;
      const relativePath = rel(p);
      previousContent.set(relativePath, readFileSafe(p));

      registerFileFunctions(p);
      registerDatabaseSchema(p);
      const brokenAlert = rebuildAllLinks();
      writeSink(p, brokenAlert);

      if (brokenAlert) {
        log.warn(`${C.yellow}Broken linkage detected in${C.reset} ${C.bold}${relativePath}${C.reset}`);
      } else {
        log.success(`${C.bold}${relativePath}${C.reset} (${allFunctions.size} functions · ${dbTables.size} DB entities)`);
      }
    })
    .on('unlink', (p) => {
      if (!isTracked(p)) return;
      unregisterFileFunctions(p);
      unregisterDatabaseSchema(p);
      const brokenAlert = rebuildAllLinks();
      writeSink(p, brokenAlert);
      log.warn(`Removed file entities: ${rel(p)}`);
    });
}

async function main() {
  log.banner();
  log.info(`Scanning code & ERD schema entities in: ${C.cyan}${ROOT}${C.reset}`);

  scanDirectory(ROOT);
  rebuildAllLinks();

  log.success(`Graphs ready: ${C.bold}${allFunctions.size}${C.reset} functions · ${C.bold}${dbTables.size}${C.reset} DB entities`);

  startServer();
  startWatcher();
}

main().catch((err) => log.error('Fatal error:', err));
