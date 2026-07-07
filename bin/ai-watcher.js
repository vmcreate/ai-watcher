#!/usr/bin/env node

/**
 * ┌─────────────────────────────────────────────────────────────┐
 * │  bin/ai-watcher.js — CLI Entry Point                       │
 * │                                                             │
 * │  The shebang line allows this file to be executed directly  │
 * │  as a command-line tool after `npm link` or global install. │
 * │                                                             │
 * │  Usage:                                                     │
 * │    ai-watcher                 (watches current directory)   │
 * │    ai-watcher ./my-project    (watches specified path)      │
 * │                                                             │
 * │  This file intentionally contains no logic — it simply     │
 * │  delegates to src/main.js so the CLI entry point and the   │
 * │  application coordinator remain independently testable.    │
 * └─────────────────────────────────────────────────────────────┘
 */

require('../src/main');
