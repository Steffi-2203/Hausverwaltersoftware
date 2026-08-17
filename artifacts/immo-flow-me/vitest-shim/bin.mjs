#!/usr/bin/env node
/**
 * Vitest CLI-Shim für Replit-Umgebung.
 * Leitet alle Aufrufe an den nativen Node.js-Test-Runner weiter,
 * da npm-Registry-Zugriff im Replit-Sandbox gesperrt ist.
 *
 * Unterstützte Aufrufe:
 *   vitest --version
 *   vitest run [pattern]
 *   vitest [pattern]
 *   vitest watch [pattern]  (einmaliger Lauf — kein echtes Watch)
 */

import { spawnSync } from 'node:child_process';
import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);

// vitest --version
if (args.includes('--version') || args.includes('-v')) {
  console.log('0.0.0-shim (node:test backend)');
  process.exit(0);
}

// Globbing: alle .test.ts Dateien
const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(rootDir, '..');
const testDir = join(workspaceRoot, 'tests/unit');

// Pattern-Argument (nach optionalem 'run' oder 'watch')
const filteredArgs = args.filter(a => a !== 'run' && a !== 'watch' && !a.startsWith('--'));
const pattern = filteredArgs[0] || 'tests/unit';

// Testdateien ermitteln
let testFiles = [];
if (pattern.includes('*')) {
  // Glob-Pattern
  try {
    const { globSync } = await import('glob').catch(() => null) || {};
    testFiles = (globSync ? globSync(pattern, { cwd: workspaceRoot }) : []).map(f => join(workspaceRoot, f));
  } catch {
    testFiles = [];
  }
} else {
  // Verzeichnis oder Datei
  const fullPath = pattern.startsWith('/') ? pattern : join(workspaceRoot, pattern);
  if (fs.existsSync(fullPath)) {
    if (fs.statSync(fullPath).isDirectory()) {
      const entries = fs.readdirSync(fullPath).filter(f => f.endsWith('.test.ts')).map(f => join(fullPath, f));
      testFiles = entries;
    } else {
      testFiles = [fullPath];
    }
  }
}

if (testFiles.length === 0) {
  console.error(`Keine Testdateien gefunden für: ${pattern}`);
  process.exit(1);
}

const tsxLoader = join(workspaceRoot, 'node_modules/tsx/dist/esm/index.cjs');
const result = spawnSync(
  process.execPath,
  ['--import', tsxLoader, '--test', ...testFiles],
  { stdio: 'inherit', cwd: workspaceRoot }
);
process.exit(result.status ?? 1);
