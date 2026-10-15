#!/usr/bin/env node
// check-docs.mjs — mechanical documentation gate (TS-only, zero python, zero deps).
//
// Why this exists: this branch migrated no documentation gate from the archive
// (the old ones were python), so ledger drift was caught by hand. Six real
// drifts were found and fixed in one review round; every one of them was a
// shape a machine can see. This script is that machine.
//
// Checks (each derived from one of those drifts):
//   C1 closed-vs-open   : an id the ledger calls closed must not hold an
//                         open-gap table row.              (drift: G81)
//   C2 links resolve    : relative markdown link targets must exist. There is
//                         no pending-path exemption any more - the one entry it
//                         held (docs/CHANGELOGS.md) now exists.
//   C3 count copies     : progress counts belong to their authority only.
//   C4 range self-check : "R1–R28" style ranges must equal the derived range.
//   C5 table shape      : pipe blocks need a separator row, equal cell counts
//                         (split on UNESCAPED pipes only) and closing pipes.
//   C6 claim vs boxes   : an entry claimed complete elsewhere may not keep
//                         un-ticked "Done means" boxes.     (drift: 前置-4)
//   C7 gap id uniqueness: one id may hold one row in the open-gap table. C1
//                         cannot see this - it collects the ids into a Set.
//                         (drift: 基建-2 measured it on itself)
//
// Scope: `git ls-files '*.md'` — the index, not history. CRLF is normalized
// before any measurement, so every verdict is checkout-independent.
//
// --selftest injects each check's drift shape into an in-memory copy of the
// corpus and asserts the owning check turns red. A mutation that does not land,
// or a check that stays green under it, is reported as blind and fails the run
// (R27: prove the criterion can fail before trusting its green).
//
// Exit codes: 0 = clean; 1 = findings; 2 = misuse.
// There is deliberately no warning tier: if something should not fail the run
// it does not belong in a gate.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const TODO = 'docs/TODO.md';
const RULES = 'docs/migration/plugin-contract-rules.md';

function repoRoot() {
  if (process.env.CHECK_DOCS_ROOT) return process.env.CHECK_DOCS_ROOT;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('check-docs: not inside a git repository');
    process.exit(2);
  }
}

const root = repoRoot();

function trackedDocs() {
  const out = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

function readDoc(rel) {
  // Normalize before measuring: byte-level judgements must not depend on how
  // this checkout stores line endings (R27: state the metric's subject).
  return readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

// --- shared helpers ------------------------------------------------------
const isPipeLine = (line) => line.startsWith('|');

/** Split a table row into cells, treating `\|` as content, not a delimiter. */
function splitRow(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '\\|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Problems with one contiguous pipe block; empty when the block is well-formed. */
function blockProblems(block) {
  const probs = [];
  if (block.length < 2) probs.push('block has fewer than 2 rows');
  const headerCells = splitRow(block[0]).length - 2;
  if (!/^\|[\s:|-]+\|$/.test(block[1] ?? '')) probs.push('second row is not a separator row');
  block.forEach((line, k) => {
    if (!line.endsWith('|')) probs.push(`row ${k + 1} does not close with |`);
    const cells = splitRow(line).length - 2;
    if (cells !== headerCells) probs.push(`row ${k + 1} has ${cells} cells, header has ${headerCells}`);
  });
  return probs;
}

function findPipedBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!isPipeLine(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    const block = [];
    while (i < lines.length && isPipeLine(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    blocks.push({ startLine: start + 1, block });
  }
  return blocks;
}

/** Body slice of the nearest "## " section whose heading matches; null when absent. */
function section(lines, headingPredicate) {
  const start = lines.findIndex((l) => /^## /.test(l) && headingPredicate(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end, heading: lines[start], lines: lines.slice(start + 1, end) };
}

const finding = (file, line, message) => ({ file, line, message });

// --- C1: closed ids must not hold open-gap rows ---------------------------
function checkClosedVsOpen(files) {
  const todo = files.get(TODO);
  if (todo === undefined) return [finding(TODO, 0, 'authority file missing from the index')];
  const gap = section(todo, (l) => l.includes('开放差距'));
  if (gap === null) return [finding(TODO, 0, 'anchor missing: no section heading containing "开放差距"')];
  const openIds = new Set();
  for (const line of gap.lines) {
    if (!isPipeLine(line)) continue;
    const id = splitRow(line)[1]?.trim();
    if (/^G\d+$/.test(id ?? '')) openIds.add(id);
  }
  if (openIds.size === 0) {
    return [finding(TODO, gap.start + 1, 'anchor missing: no G rows parsed out of the open-gap table')];
  }
  // A closed claim has to be ABOUT the id, not merely mention it: a ticked line
  // about some other item that happens to cite G<n> (a residual issue, a
  // structural claim) is not closure. Two shapes qualify:
  //   (a) the item's subject is the id:  - [x] **G81 · ...
  //   (b) an explicit closure sentence:  G81 ... 已于 ... 结清
  const closedLine = new Map();
  const subjectRe = /^\s*[-*]\s*\[x\]\s*(?:\*\*)?(G\d+)\b/;
  // Closure vocabulary must be adjacent to read as a claim: a sentence that says
  // an item is NOT settled ("≠ ... 整体结清") cites the words without claiming
  // them, and the loose form flagged exactly that sentence on its first run.
  const closureRe = /(G\d+)[^\n]{0,80}(?:已于[^\n]{0,30}结清|已结清|已结案)/;
  todo.forEach((line, idx) => {
    const id = line.match(subjectRe)?.[1] ?? line.match(closureRe)?.[1];
    if (id === undefined || !openIds.has(id)) return;
    const lineNo = idx + 1;
    if (lineNo >= gap.start && lineNo <= gap.end) return;
    if (!closedLine.has(id)) closedLine.set(id, lineNo);
  });
  return [...closedLine].map(([id, lineNo]) =>
    finding(TODO, lineNo, `${id} is called closed here but still holds an open-gap row`),
  );
}

// --- C7: open-gap table ids must be unique --------------------------------
/**
 * The second blind spot 基建-2 measured on itself: duplicating an id inside the
 * §四 table left the gate green, because C1 collects those ids into a Set - a
 * Set is precisely what cannot see a duplicate.
 *
 * Like C5 this guards a structural invariant rather than a drift that happens to
 * exist today (§四 is clean as of this writing), so its only real proof is the
 * mutation, not today's green.
 *
 * Scope note: the id shape is `/^G\d+$/`, the same shape C1 accepts, so the two
 * checks cannot drift apart on what counts as an id. The finding points at the
 * SECOND occurrence - the first one is the legitimate row.
 */
function checkGapIdUniqueness(files) {
  const todo = files.get(TODO);
  if (todo === undefined) return [finding(TODO, 0, 'authority file missing from the index')];
  const gap = section(todo, (l) => l.includes('开放差距'));
  if (gap === null) return [finding(TODO, 0, 'anchor missing: no section heading containing "开放差距"')];
  const firstSeen = new Map();
  const out = [];
  gap.lines.forEach((line, idx) => {
    if (!isPipeLine(line)) return;
    const id = splitRow(line)[1]?.trim();
    if (!/^G\d+$/.test(id ?? '')) return;
    const lineNo = gap.start + idx + 1;
    const seenAt = firstSeen.get(id);
    if (seenAt === undefined) {
      firstSeen.set(id, lineNo);
      return;
    }
    out.push(
      finding(TODO, lineNo, `${id} already holds an open-gap row at line ${seenAt}; an id may appear once`),
    );
  });
  if (firstSeen.size === 0) {
    return [finding(TODO, gap.start, 'anchor missing: no G rows parsed out of the open-gap table')];
  }
  return out;
}

// --- C2: relative markdown links must resolve ----------------------------
function checkLinksResolve(files) {
  const out = [];
  for (const [rel, lines] of files) {
    lines.forEach((line, idx) => {
      const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
      let m;
      while ((m = linkRe.exec(line)) !== null) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, file:, ...
        if (target.startsWith('#')) continue;
        const pathPart = target.split('#')[0];
        if (pathPart.length === 0) continue;
        const candidates = [resolve(root, dirname(rel), pathPart), resolve(root, pathPart)];
        if (candidates.some((abs) => existsSync(abs))) continue;
        out.push(finding(rel, idx + 1, `link target does not resolve: ${target}`));
      }
    });
  }
  return out;
}

// --- C3: derived counts belong to their authority only -------------------
// Scope matches the drift that produced the check: the normative docs that
// restated a reading as if current (spec + AGENTS, plus README). The rules
// ledger is exempt on purpose - it quotes historical measurements as lessons.
const COUNT_SCOPE = new Set(['AGENTS.md', 'README.md', 'docs/migration/ts-fullstack-spec.md']);
const COUNT_PATTERNS = [/\b\d+\s*(?:passed|failed|skipped)\b/i, /\b\d+\s*条(?:错误|断言|锁)/];
// Quoting a superseded reading is legal only when the line says so; the marker
// vocabulary is the one the ledger itself uses for retractions.
const RETRACTION_MARKERS = /原先|曾写|已撤下|被推翻|撤回|不再复述|历史读数|示例/;

function checkCountCopies(files) {
  const out = [];
  for (const [rel, lines] of files) {
    if (rel === TODO || !COUNT_SCOPE.has(rel)) continue;
    lines.forEach((line, idx) => {
      if (RETRACTION_MARKERS.test(line)) return;
      for (const re of COUNT_PATTERNS) {
        if (!re.test(line)) continue;
        out.push(
          finding(rel, idx + 1, `derived count outside its authority (${TODO}): ${line.trim().slice(0, 70)}`),
        );
        break;
      }
    });
  }
  return out;
}

// --- C4: whole-set ranges must equal the derived range -------------------
// A range whose family authority lives on the archive branch cannot be checked
// here; the exemption is per family and documented, not silent.
const ARCHIVE_RANGE_FAMILIES = new Set(['D', 'S', 'G']);

function checkRangeSelfCheck(files) {
  const rules = files.get(RULES);
  if (rules === undefined) return [finding(RULES, 0, 'anchor missing: rules file not in the index')];
  const numbers = [];
  rules.forEach((line, idx) => {
    const m = line.trimEnd().match(/^## R(\d+)\b/);
    if (m !== null) numbers.push({ n: Number(m[1]), line: idx + 1 });
  });
  if (numbers.length === 0) {
    return [finding(RULES, 0, 'anchor missing: no "## R<n>" headings found in the rules file')];
  }
  const sorted = numbers.map((x) => x.n).sort((a, b) => a - b);
  const out = [];
  const contiguous = sorted.every((n, i) => n === i + 1);
  if (!contiguous) {
    out.push(finding(RULES, numbers[0].line, `R headings are not contiguous 1..N (got ${sorted.join(',')})`));
  }
  const max = sorted[sorted.length - 1];
  const rangeRe = /\b([DGSR])(\d+)\s*[–—-]\s*(?:([DGSR])(\d+))\b/g;
  for (const [rel, lines] of files) {
    lines.forEach((line, idx) => {
      rangeRe.lastIndex = 0;
      let m;
      while ((m = rangeRe.exec(line)) !== null) {
        const [, famA, loRaw, famB, hiRaw] = m;
        if (famB !== undefined && famB !== famA) {
          out.push(finding(rel, idx + 1, `range mixes families: ${m[0]}`));
          continue;
        }
        if (ARCHIVE_RANGE_FAMILIES.has(famA)) continue; // authority is the archive branch
        // A range starting at 1 asserts the whole set, so it must equal the
        // derived range; a sub-range (R12–R19) describes a subset and is left
        // alone, except when its upper end cannot exist at all.
        const lo = Number(loRaw);
        const hi = Number(hiRaw);
        if (hi > max) {
          out.push(finding(rel, idx + 1, `range ${m[0]} runs past the derived R maximum ${max}`));
        } else if (lo === 1 && hi !== max) {
          out.push(finding(rel, idx + 1, `range ${m[0]} disagrees with the derived R range 1–${max}`));
        }
      }
    });
  }
  return out;
}

// --- C5: markdown table shape -------------------------------------------
function checkTableShape(files) {
  const out = [];
  for (const [rel, lines] of files) {
    for (const { startLine, block } of findPipedBlocks(lines)) {
      for (const problem of blockProblems(block)) {
        out.push(finding(rel, startLine, problem));
      }
    }
  }
  return out;
}

// --- C6: a claimed-complete entry may not keep un-ticked boxes ------------
/** Identifier at the head of a "### " or "#### " heading, e.g. 前置-4 / 基建-1 / T1. */
function headingId(heading) {
  const m = heading.match(/^#{3,4}\s+([A-Za-z0-9\u4e00-\u9fff]+(?:-\d+)?)/);
  return m?.[1];
}

function checkClaimVsBoxes(files) {
  const todo = files.get(TODO);
  if (todo === undefined) return [finding(TODO, 0, 'authority file missing from the index')];
  const headingLines = [];
  todo.forEach((line, idx) => {
    if (/^#{3,4} /.test(line)) headingLines.push(idx);
  });
  if (headingLines.length === 0) return [finding(TODO, 0, 'anchor missing: no "###"/"####" headings found')];
  const out = [];
  headingLines.forEach((start, k) => {
    const end = k + 1 < headingLines.length ? headingLines[k + 1] : todo.length;
    const body = todo.slice(start, end);
    const doneIdx = body.findIndex((l) => /\*\*Done means\*\*/.test(l));
    if (doneIdx < 0) return;
    const boxes = body.slice(doneIdx).filter((l) => /^\s*[-*]\s*\[ \]/.test(l));
    if (boxes.length === 0) return;
    const id = headingId(todo[start]);
    if (id === undefined) return;
    const mention = new RegExp(`(^|[^A-Za-z0-9-])${id}([^0-9]|$)`);
    const claimed = todo.some((line, idx) => {
      if (idx >= start && idx < end) return false; // the block cannot claim itself
      if (!mention.test(line)) return false;
      return /-\s*\[x\]/.test(line) && /已完成|已结清|已结案/.test(line);
    });
    if (claimed) {
      out.push(
        finding(
          TODO,
          start + 1,
          `entry is claimed complete elsewhere but keeps ${boxes.length} un-ticked Done means box(es): ${todo[start].trim().slice(0, 56)}`,
        ),
      );
    }
  });
  return out;
}

// --- registry ------------------------------------------------------------
const CHECKS = [
  { id: 'C1', name: 'closed-vs-open', run: checkClosedVsOpen },
  { id: 'C2', name: 'links-resolve', run: checkLinksResolve },
  { id: 'C3', name: 'count-copies', run: checkCountCopies },
  { id: 'C4', name: 'range-self-check', run: checkRangeSelfCheck },
  { id: 'C5', name: 'table-shape', run: checkTableShape },
  { id: 'C6', name: 'claim-vs-boxes', run: checkClaimVsBoxes },
  { id: 'C7', name: 'gap-id-uniqueness', run: checkGapIdUniqueness },
];

function runChecks(files) {
  return CHECKS.flatMap((check) => check.run(files).map((f) => ({ check: check.id, ...f })));
}

function printFindings(found) {
  console.error(`check-docs: ${found.length} finding(s):`);
  for (const f of found) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${f.check} ${where} -> ${f.message}`);
  }
}

// --- selftest: in-memory mutations, reverse of the real drifts -----------
// Each case mutates a copy of the corpus and asserts the owning check reacts.
// Landing is asserted first: a mutation that did not change the text proves
// nothing, so it fails as "did not land" rather than passing as green.
//
// ANCHOR RULE (learned the hard way, twice): a mutation must splice on document
// STRUCTURE - a section heading, a table separator row - never on the prose of a
// line. Prose gets reworded by the very measurements these docs exist to record,
// and the mutation then quietly stops landing while everything else stays green.
/** Splices `row` in as the first body row of the §四 open-gap table. */
function insertIntoGapTable(text, row) {
  const at = text.indexOf('## 四、开放差距');
  if (at < 0) return text;
  const sep = text.indexOf('|---|', at);
  if (sep < 0) return text;
  const after = text.indexOf('\n', sep);
  if (after < 0) return text;
  return `${text.slice(0, after + 1)}${row}\n${text.slice(after + 1)}`;
}

/**
 * Duplicates the first body row of the §四 open-gap table.
 *
 * Structural, like every other mutation here: it reads the row out of the table
 * instead of naming an id, so a future edit to which gaps are open cannot quietly
 * stop this from landing (two of this branch's mutations went BLIND that way).
 * Copying a whole row also keeps the cell count intact, so the mutation is
 * attributable to C7 rather than also tripping C5.
 */
function duplicateFirstGapRow(text) {
  const at = text.indexOf('## 四、开放差距');
  if (at < 0) return text;
  const sep = text.indexOf('|---|', at);
  if (sep < 0) return text;
  const firstBody = text.indexOf('\n', sep);
  if (firstBody < 0) return text;
  const rowEnd = text.indexOf('\n', firstBody + 1);
  if (rowEnd < 0) return text;
  const row = text.slice(firstBody + 1, rowEnd);
  return `${text.slice(0, rowEnd + 1)}${row}\n${text.slice(rowEnd + 1)}`;
}

/**
 * Flips the first ticked box inside the `**Done means**` block of the section
 * whose heading line starts with `prefix` (e.g. "### 前置-4") - which is where C6
 * looks. Two lessons are encoded here: never anchor on prose (a mutation that
 * stops landing proves nothing), and never anchor on a bare substring either -
 * the ledger quotes heading text in its own narrative, and the first such quote
 * used to send this mutation into the wrong section, where C6 stayed green.
 */
function untickFirstBoxAfter(text, prefix) {
  const at = text.indexOf(`\n${prefix}`);
  if (at < 0) return text;
  const next = text.indexOf("\n### ", at + 1);
  const end = next < 0 ? text.length : next;
  const block = text.slice(at, end);
  const done = block.indexOf('**Done means**');
  if (done < 0) return text;
  const box = block.indexOf("- [x] ", done);
  if (box < 0) return text;
  const where = at + box;
  return `${text.slice(0, where)}- [ ] ${text.slice(where + "- [x] ".length)}`;
}

const MUTATIONS = [
  {
    id: 'M1-C1',
    expect: 'red',
    check: 'C1',
    note: 'G81 row back in the open-gap table',
    // Anchored on the table's STRUCTURE, not on a row's prose: the earlier
    // version spliced after a literal G78 row, that row's wording was later
    // reworded by a measurement, and the mutation silently stopped landing
    // (selftest reported BLIND) while every other case stayed green.
    apply: (text) => insertIntoGapTable(text, '| G81 | 插件 spec 从未被类型检查（实测 144 条错误） | TS 侧独立债 |'),
    file: TODO,
  },
  {
    id: 'M2-C2',
    expect: 'red',
    check: 'C2',
    note: 'a relative link points at a missing file',
    apply: (text) => text.replace('(docs/TODO.md)', '(docs/TODO-missing.md)'),
    file: 'README.md',
  },
  {
    id: 'M3-C3',
    expect: 'red',
    check: 'C3',
    note: 'a progress count copied outside the ledger',
    apply: (text) => `${text}\n\n（方案基线 vitest 293 passed）\n`,
    file: 'docs/migration/ts-fullstack-spec.md',
  },
  {
    id: 'M4-C4',
    expect: 'red',
    check: 'C4',
    note: 'a whole-set range goes stale',
    apply: (text) => text.replace(/R1[–-]R28/, 'R1–R26'),
    file: 'AGENTS.md',
  },
  {
    id: 'M5-C5',
    expect: 'red',
    check: 'C5',
    note: 'a table row gains an extra unescaped cell',
    // Structural for the same reason as M1: this one anchored on the G86 row's
    // prose and stopped landing the day G86 was closed and its row removed.
    apply: (text) => insertIntoGapTable(text, '| G99 | broken | extra | fourth |'),
    file: TODO,
  },
  {
    id: 'M6-C5',
    expect: 'green',
    check: 'C5',
    note: 'an escaped pipe in a cell stays legal (the two-sided half)',
    apply: (text) => insertIntoGapTable(text, '| G99 | a \\| pipe inside a cell | fine |'),
    file: TODO,
  },
  {
    id: 'M7-C6',
    expect: 'red',
    check: 'C6',
    note: '前置-4 keeps an un-ticked box while claimed complete',
    apply: (text) => untickFirstBoxAfter(text, '### 前置-4'),
    file: TODO,
  },
  {
    id: 'M8-C7',
    expect: 'red',
    check: 'C7',
    note: 'an id holds two rows in the open-gap table',
    apply: (text) => duplicateFirstGapRow(text),
    file: TODO,
  },
];

function selftest(files) {
  const baseline = runChecks(files);
  if (baseline.length !== 0) {
    console.error('check-docs --selftest: baseline is not clean; fix the findings first so each colour is attributable.');
    printFindings(baseline);
    return 1;
  }
  let blind = 0;
  for (const mutation of MUTATIONS) {
    const clone = new Map([...files].map(([rel, lines]) => [rel, [...lines]]));
    const text = clone.get(mutation.file).join('\n');
    const mutated = mutation.apply(text);
    if (mutated === text) {
      console.error(`  ${mutation.id} BLIND -> mutation did not land (${mutation.note})`);
      blind++;
      continue;
    }
    clone.set(mutation.file, mutated.split('\n'));
    const found = runChecks(clone).filter((f) => f.check === mutation.check);
    if (mutation.expect === 'red' && found.length === 0) {
      console.error(`  ${mutation.id} BLIND -> ${mutation.check} stayed green under: ${mutation.note}`);
      blind++;
      continue;
    }
    if (mutation.expect === 'green' && found.length > 0) {
      console.error(`  ${mutation.id} BLIND -> ${mutation.check} fired on a legal shape: ${mutation.note}`);
      blind++;
      continue;
    }
    const colour = mutation.expect === 'red' ? `${found.length} finding(s)` : 'stays green';
    console.log(`  ${mutation.id} ok -> ${mutation.check} ${colour}: ${mutation.note}`);
  }
  if (blind > 0) {
    console.error(`check-docs --selftest: ${blind} blind case(s); the gate is not trustworthy yet.`);
    return 1;
  }
  console.log(`check-docs --selftest: OK (${CHECKS.length} checks, ${MUTATIONS.length} mutations, none blind).`);
  return 0;
}

// --- main ----------------------------------------------------------------
const docs = trackedDocs();
if (docs.length === 0) {
  console.error('check-docs: git ls-files found no markdown files');
  process.exit(2);
}
const files = new Map(docs.map((rel) => [rel, readDoc(rel).split('\n')]));

if (process.argv.slice(2).includes('--selftest')) {
  process.exit(selftest(files));
}

const found = runChecks(files);
if (found.length === 0) {
  console.log(`check-docs: OK (${CHECKS.length} checks over ${docs.length} tracked markdown file(s)).`);
  process.exit(0);
}
printFindings(found);
process.exit(1);