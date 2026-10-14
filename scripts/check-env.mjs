#!/usr/bin/env node
// check-env.mjs — D19 working-tree residue guard (TS-only, zero python).
//
// Why this exists: switching to the orphan `main` branch makes git delete only
// tracked sources; files matched by .gitignore (.venv, __pycache__, node_modules,
// traces, old stack dirs) are left on disk and are invisible to `git status`.
// This script turns that into a red/green signal for fresh clones and branch
// switches. It never deletes anything; it only reports and suggests a command.
//
// Checks:
//   H1 (FAIL): any tracked python file (`git ls-files`) -> D19 violation.
//   H2 (FAIL): python-stack leftovers anywhere in the working tree, outside the
//              whitelist (sources/bytecode, venvs, caches, egg-info, manifests).
//   NOTE     : runtime data / temp dirs (traces, scratch, data_engine.db, .artemis_*).
//
// Whitelist (never reported): .git, every node_modules/, every dist/.
//
// Exit codes: 0 = clean (or only NOTE items); 1 = FAIL items found; 2 = misuse.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error('check-env: not inside a git repository');
    process.exit(2);
  }
}

const root = repoRoot();
const toRepo = (abs) => relative(root, abs).split(sep).join('/');

// --- H1: tracked python -------------------------------------------------
function trackedPython() {
  try {
    return execFileSync('git', ['ls-files', '*.py', '*.pyc', '*.pyo', '*.pyd'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

// --- H2: working-tree python-stack leftovers ----------------------------
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']); // whitelist, any depth
// Tool-cache dirs have distinctive names and may be flagged at any depth.
const FAIL_DIRS_ANY = new Set([
  '__pycache__',
  '.venv',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  '.tox',
  '.nox',
]);
// Generic virtualenv names are anchored to the root (a source dir such as
// src/env is legitimate; .gitignore anchors these too).
const FAIL_DIRS_ROOT = new Set(['venv', 'env', 'ENV']);
const FAIL_FILE_EXT = ['.py', '.pyc', '.pyo', '.pyd'];
const FAIL_FILE_NAMES = new Set([
  'pyproject.toml',
  'uv.lock',
  'setup.py',
  'setup.cfg',
  'pipfile',
  'pipfile.lock',
]);
const NOTE_DIRS = new Set(['traces', 'scratch']);

function isFailFile(name) {
  const lower = name.toLowerCase();
  if (FAIL_FILE_EXT.some((ext) => lower.endsWith(ext))) return true;
  if (FAIL_FILE_NAMES.has(lower)) return true;
  if (/^requirements.*\.txt$/.test(lower)) return true;
  return false;
}

function isEggInfoDir(name) {
  return /\.egg-info$/.test(name);
}

function isNoteFile(name) {
  const lower = name.toLowerCase();
  return (
    lower === 'data_engine.db' ||
    lower.startsWith('data_engine.db-') ||
    lower.startsWith('.artemis_')
  );
}

const fail = [];
const note = [];

function walk(dir, isRoot) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const abs = join(dir, name);

    if (entry.isDirectory()) {
      // Prune whitelist dirs entirely.
      if (SKIP_DIRS.has(name)) continue;
      // Record the directory and prune it (avoids dumping thousands of files).
      const failDir =
        FAIL_DIRS_ANY.has(name) ||
        isEggInfoDir(name) ||
        (isRoot && FAIL_DIRS_ROOT.has(name));
      if (failDir) {
        fail.push(toRepo(abs) + '/');
        continue;
      }
      if (isRoot && NOTE_DIRS.has(name)) {
        note.push(toRepo(abs) + '/');
        continue;
      }
      walk(abs, false);
    } else if (entry.isFile()) {
      if (isFailFile(name)) {
        fail.push(toRepo(abs));
      } else if (isNoteFile(name)) {
        note.push(toRepo(abs));
      }
    }
  }
}

const h1 = trackedPython();
walk(root, true);

// Deduplicate while preserving order.
const uniq = (arr) => [...new Set(arr)];
const h1List = uniq(h1);
const failList = uniq(fail);
const noteList = uniq(note);

const show = (list, limit = 30) =>
  list.slice(0, limit).map((p) => '  ' + p).join('\n') +
  (list.length > limit ? `\n  ... and ${list.length - limit} more` : '');

let problems = 0;
if (h1List.length) {
  problems++;
  console.error(
    `\nH1 FAIL: ${h1List.length} tracked python file(s) (D19 = TS-only, zero py):`
  );
  console.error(show(h1List));
}
if (failList.length) {
  problems++;
  console.error(
    `\nH2 FAIL: ${failList.length} python-stack leftover path(s) in the working tree:`
  );
  console.error(show(failList));
}
if (noteList.length) {
  console.warn(
    `\nNOTE: ${noteList.length} runtime/temp path(s) (ignored, not tracked; safe to remove):`
  );
  console.warn(show(noteList));
}

if (problems) {
  console.error(
    '\nClean up: `git clean -ndX` to preview, `git clean -fdX` to remove every ignored file, or delete the listed paths manually.'
  );
  process.exit(1);
}

console.log('check-env: OK (no python stack in the tree; D19 satisfied).');
process.exit(0);
