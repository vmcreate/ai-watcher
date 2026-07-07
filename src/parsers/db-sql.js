'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/parsers/db-sql.js — SQL DDL Parser                    │
 * │                                                             │
 * │  Extracts table definitions from SQL DDL files.            │
 * │  Handles standard ANSI SQL and common dialect variants     │
 * │  (PostgreSQL, MySQL, SQLite) via regex-based parsing.      │
 * │                                                             │
 * │  Imports : none                                             │
 * │  Exports : parseSql(content, relativePath, group)          │
 * └─────────────────────────────────────────────────────────────┘
 */

/**
 * Determines if a column definition carries a PRIMARY KEY constraint,
 * either inline or by convention (column named exactly "id").
 *
 * @param {string} trimmedLine - Trimmed column definition line
 * @param {string} colName     - Extracted column name
 * @returns {boolean}
 */
function detectPk(trimmedLine, colName) {
  return /PRIMARY\s+KEY/i.test(trimmedLine) || colName.toLowerCase() === 'id';
}

/**
 * Determines if a column definition is a foreign key, either via an explicit
 * REFERENCES clause or by name convention (*_id / *Id suffixes).
 *
 * @param {string} trimmedLine - Trimmed column definition line
 * @param {string} colName     - Extracted column name
 * @returns {boolean}
 */
function detectFk(trimmedLine, colName) {
  if (/REFERENCES/i.test(trimmedLine)) return true;
  const lower = colName.toLowerCase();
  // Exclude bare "id" — that's a PK, not a FK
  if (lower === 'id') return false;
  return /_id$/i.test(colName) || /id$/i.test(colName);
}

/**
 * Parses the body of a CREATE TABLE block and returns a structured array
 * of column descriptors.
 *
 * @param {string} body - Raw text between the opening `(` and closing `)` of CREATE TABLE
 * @returns {Array<{ name: string, type: string, isPk: boolean, isFk: boolean }>}
 */
function parseColumns(body) {
  const fields = [];
  const colLines = body.split('\n');

  colLines.forEach((line) => {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed) return;

    // Skip table-level constraint lines — they are not column definitions
    if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|KEY|INDEX|UNIQUE|CHECK)/i.test(trimmed)) return;

    // Match: `column_name TYPE ...` — backtick, quote, or unquoted identifiers
    const colMatch = trimmed.match(/^["`]?([a-zA-Z0-9_]+)["`]?\s+([a-zA-Z0-9_()]+)/);
    if (!colMatch) return;

    const colName = colMatch[1];
    const colType = colMatch[2];

    fields.push({
      name:  colName,
      type:  colType,
      isPk:  detectPk(trimmed, colName),
      isFk:  detectFk(trimmed, colName),
    });
  });

  return fields;
}

/**
 * Parses a complete SQL file and returns all discovered table definitions.
 *
 * @param {string} content      - Raw file content
 * @param {string} relativePath - Project-relative file path (for display)
 * @param {string} group        - Architectural group/module label
 * @returns {Map<string, object>} Table name → entity descriptor
 */
function parseSql(content, relativePath, group) {
  const tables = new Map();

  // Match CREATE TABLE [IF NOT EXISTS] `name` ( … );
  // The [\s\S]*? non-greedy match safely handles multi-line bodies.
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?\s*\(([\s\S]*?)\);/gi;

  let match;
  while ((match = tableRegex.exec(content)) !== null) {
    const tableName = match[1];
    const body      = match[2];
    const fields    = parseColumns(body);

    tables.set(tableName, {
      id:     tableName,
      name:   tableName,
      file:   relativePath,
      group:  group,
      fields: fields,
      type:   'SQL Table',
    });
  }

  return tables;
}

module.exports = { parseSql };
