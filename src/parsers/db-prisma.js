'use strict';

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  src/parsers/db-prisma.js — Prisma Schema Parser           │
 * │                                                             │
 * │  Extracts `model` blocks from Prisma schema files.         │
 * │  Detects @id (primary key) and @relation (foreign key)     │
 * │  field decorators, as well as naming-convention FKs.       │
 * │                                                             │
 * │  Imports : none                                             │
 * │  Exports : parsePrisma(content, relativePath, group)       │
 * └─────────────────────────────────────────────────────────────┘
 */

/**
 * Parses a single Prisma model body and returns structured field descriptors.
 *
 * @param {string} body - Raw text of the model block (between `{` and `}`)
 * @returns {Array<{ name: string, type: string, isPk: boolean, isFk: boolean }>}
 */
function parseModelFields(body) {
  const fields = [];

  body.split('\n').forEach((line) => {
    const trimmed = line.trim();

    // Skip empty lines, comments, and block-level attributes (@@index, @@unique, …)
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) return;

    // Match: fieldName  FieldType[@modifier] [?] [[]]
    // Examples: "id  Int @id", "userId  String", "posts Post[]"
    const fMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_?[\]]+)/);
    if (!fMatch) return;

    const fName = fMatch[1];
    const fType = fMatch[2];

    const isPk = /@id\b/i.test(trimmed) || fName.toLowerCase() === 'id';
    // A field referencing another model via @relation is a FK relationship anchor
    const isFk = /@relation\b/i.test(trimmed) ||
                 (fName.toLowerCase() !== 'id' && fName.toLowerCase().endsWith('id'));

    fields.push({ name: fName, type: fType, isPk, isFk });
  });

  return fields;
}

/**
 * Parses a complete Prisma schema file and returns all discovered model entities.
 *
 * @param {string} content      - Raw file content
 * @param {string} relativePath - Project-relative file path (for display)
 * @param {string} group        - Architectural group/module label
 * @returns {Map<string, object>} Model name → entity descriptor
 */
function parsePrisma(content, relativePath, group) {
  const models = new Map();

  // Match: model ModelName { … }
  // Non-greedy [\s\S]*? prevents runaway matching across multiple models.
  const modelRegex = /model\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/gi;

  let match;
  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body      = match[2];
    const fields    = parseModelFields(body);

    models.set(modelName, {
      id:     modelName,
      name:   modelName,
      file:   relativePath,
      group:  group,
      fields: fields,
      type:   'Prisma Model',
    });
  }

  return models;
}

module.exports = { parsePrisma };
