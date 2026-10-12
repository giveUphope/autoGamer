"""Markdown table ruler for the docs that carry numbered decisions.

Groups every CONTIGUOUS block of `|` lines as one table (a section may legally
hold several tables, which the first version of this script mistook for a
broken table). Per table it proves:

  - row 1 is a header and row 2 is a separator, otherwise the block is a
    fragment split off a real table by a blank line
  - every row closes with a pipe
  - every row has exactly as many cells as that table's own header
  - no table spills past its `## ` section
  - decision ids D1..Dn are contiguous, match the range the heading claims, and
    (in TODO.md only) appear exactly once; gap ids likewise

A second, different duty lives here too: docs/migration/README.md's 体量 table is a
COPY of derived facts (line counts, KB) - hand-copied, it goes stale on every edit
(it did, twice: changelogs #30). So the ruler verifies each row against the real file
and `--refresh-sizes` rewrites the column instead of a human typing numbers again.

Usage:
  python -X utf8 scripts/check_doc_tables.py [file ...]
  python -X utf8 scripts/check_doc_tables.py --selftest
  python -X utf8 scripts/check_doc_tables.py --refresh-sizes
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULTS = [
    ROOT / "AGENTS.md",
    ROOT / "docs" / "TODO.md",
    ROOT / "docs" / "CHANGELOGS.md",
    ROOT / "docs" / "migration" / "README.md",
    ROOT / "docs" / "migration" / "registry.md",
    ROOT / "docs" / "migration" / "glossary.md",
    ROOT / "docs" / "migration" / "upstream-plugin-forms.md",
    ROOT / "docs" / "migration" / "plugin-contract-rules.md",
]
SEPARATOR = re.compile(r"^\|[\s:|-]+\|?\s*$")


def blocks(lines):
    """Yield (start_index, rows) for each contiguous run of table lines."""
    start = None
    rows = []
    for i, ln in enumerate(lines):
        if ln.startswith("|"):
            if start is None:
                start = i
            rows.append((i, ln))
        elif start is not None:
            yield start, rows
            start, rows = None, []
    if start is not None:
        yield start, rows


def heading_of(lines, index):
    heads = [ln for ln in lines[:index] if ln.startswith("## ")]
    return heads[-1].strip() if heads else "(no ## heading)"


def next_heading_at(lines, end_row):
    for i in range(end_row + 1, len(lines)):
        if lines[i].startswith("## "):
            return i
    return len(lines)


def check(text, label, unique_ids=False):
    lines = text.split("\n")
    problems = []
    tables = 0
    all_decision_ids = []
    for start, rows in blocks(lines):
        if len(rows) < 2:
            problems.append(
                f"{label}: table-like block at line {start + 1} has no separator row "
                "(a blank line probably split a real table)"
            )
            continue
        tables += 1
        header = rows[0][1]
        expected = len(header.strip().strip("|").split("|"))
        if not SEPARATOR.match(rows[1][1].strip()):
            problems.append(f"{label}: block at line {start + 1} row 2 is not a separator row")
        if not header.rstrip().endswith("|"):
            problems.append(f"{label}: header at line {start + 1} does not close with a pipe")
        end_row = rows[-1][0]
        for pos, ln in rows:
            if not ln.rstrip().endswith("|"):
                problems.append(f"{label}: line {pos + 1} does not close with a pipe")
            cells = ln.strip().strip("|").split("|")
            if len(cells) != expected:
                problems.append(
                    f"{label}: line {pos + 1} has {len(cells)} cells, "
                    f"header at line {start + 1} declares {expected}"
                )
        heading = heading_of(lines, start)
        if next_heading_at(lines, start) <= end_row:
            problems.append(f"{label}: block starting line {start + 1} spills past its section")
        ids = [ln.strip().strip("|").split("|")[0].strip() for _, ln in rows]
        decisions = [i for i in ids if re.fullmatch(r"D\d+", i)]
        gaps = [i for i in ids if re.fullmatch(r"G\d+", i)]
        all_decision_ids += decisions
        if decisions:
            nums = sorted(int(i[1:]) for i in decisions)
            claimed = re.search(r"D1-D(\d+)", heading)
            if claimed and int(claimed.group(1)) != max(nums):
                problems.append(
                    f"{label} [{heading}]: heading claims D1-D{claimed.group(1)} "
                    f"but rows reach D{max(nums)}"
                )
        if gaps:
            print(
                f"  [{heading or label}] {len(gaps)} gap rows: {sorted(int(g[1:]) for g in gaps)}"
            )
        if unique_ids:
            for pool, kind in ((decisions, "decision"), (gaps, "gap")):
                dupes = sorted({i for i in pool if pool.count(i) > 1})
                if dupes:
                    problems.append(f"{label}: duplicate {kind} ids in one table: {dupes}")
    print(f"{label}: {tables} table block(s) checked")
    if tables == 0:
        problems.append(f"{label}: no tables found at all - ruler proved nothing")
    return problems


def report(problems, label):
    if problems:
        for p in problems:
            print("PROBLEM:", p)
        raise SystemExit(f"FAIL: {label}")
    print(f"OK: {label}")


def expect_caught(problems, label):
    global FIRED
    if problems:
        FIRED += 1
        print(f"CAUGHT [{label}]: {problems[0]}")
    else:
        raise SystemExit(f"FAIL: ruler is blind to [{label}]")


FIRED = 0


def inject(text, anchor, replacement, probe):
    out = text.replace(anchor, replacement, 1)
    if out == text:
        raise SystemExit(f"FAIL: anchor for injection ({probe}) not found - the text moved")
    return out


def read(path):
    return Path(path).read_text(encoding="utf-8")


def unique_flag_for(path):
    return Path(path).name == "TODO.md"


# --- the derived-fact table in docs/migration/README.md (体量/实测) -------------

DOC_README = ROOT / "docs" / "migration" / "README.md"
SIZE_HEADER = "| 文档 | 体量（实测）"
SIZE_CELL = re.compile(r"^(\d+) 行 / ([\d.]+) KB$")


def size_rows(lines):
    """Row indexes of the 体量 table, or None when the table is not there."""
    head = next((i for i, ln in enumerate(lines) if ln.startswith(SIZE_HEADER)), None)
    if head is None:
        return None
    rows = []
    i = head + 2
    while i < len(lines) and lines[i].startswith("|"):
        rows.append(i)
        i += 1
    return rows


def row_targets(cell, base):
    """Resolve a row's doc cell to the file(s) its size must come from.

    Convention (docs/migration/README.md §三 note): the first column is written
    RELATIVE TO THE REPO ROOT. The doc's own directory is kept as a fallback so a
    bare sibling filename still resolves, but an unresolvable cell is a failure -
    silently skipping it is how a copied number goes unwatched again.
    """
    if "inventory/01" in cell:
        return sorted((ROOT / "docs" / "migration" / "inventory").glob("*.md")) or None
    text = cell.replace("`", "").strip()
    for cand in ((ROOT / text).resolve(), (base / text).resolve()):
        if cand.is_file():
            return [cand]
    return None


def measured(paths):
    total_lines = total_bytes = 0
    for p in paths:
        raw = p.read_bytes()
        total_lines += raw.count(b"\n")
        total_bytes += len(raw)
    return total_lines, f"{total_bytes / 1024:.1f}"


def check_sizes(text, label):
    lines = text.split("\n")
    base = Path(label).parent
    rows = size_rows(lines)
    if rows is None:
        return [f"{label}: the 体量 table is gone - the size gate would prove nothing"], 0
    problems = []
    for idx in rows:
        cells = [c.strip() for c in lines[idx].strip().strip("|").split("|")]
        targets = row_targets(cells[0], base)
        if targets is None:
            problems.append(f"{label}: 体量 row line {idx + 1} ({cells[0]}) resolves to no file")
            continue
        want_lines, want_kb = measured(targets)
        m = SIZE_CELL.match(cells[1])
        if not m:
            problems.append(
                f"{label}: 体量 row line {idx + 1}: cell '{cells[1]}' is not 'N 行 / X KB'"
            )
            continue
        if int(m.group(1)) != want_lines or m.group(2) != want_kb:
            names = "+".join(p.name for p in targets)
            problems.append(
                f"{label}: 体量 row {names} says {m.group(1)} 行 / {m.group(2)} KB, "
                f"measured {want_lines} 行 / {want_kb} KB"
            )
    print(f"{label}: {len(rows)} size row(s) checked")
    return problems, len(rows)


def refresh_sizes():
    path = DOC_README
    original = path.read_bytes()
    text = original.decode("utf-8")
    lines = text.split("\n")
    rows = size_rows(lines)
    if rows is None:
        raise SystemExit(f"FAIL: {path} has no 体量 table to refresh")
    base = path.parent
    changed = 0
    for idx in rows:
        cells = [c.strip() for c in lines[idx].strip().strip("|").split("|")]
        targets = row_targets(cells[0], base)
        if targets is None:
            raise SystemExit(f"FAIL: 体量 row line {idx + 1} ({cells[0]}) resolves to no file")
        want_lines, want_kb = measured(targets)
        cells[1] = f"{want_lines} 行 / {want_kb} KB"
        rebuilt = "| " + " | ".join(cells) + " |"
        if rebuilt != lines[idx]:
            lines[idx] = rebuilt
            changed += 1
    path.write_bytes("\n".join(lines).encode("utf-8"))
    print(f"OK: sizes refreshed - {changed} of {len(rows)} row(s) rewritten")


def selftest():
    for path in DEFAULTS:
        report(check(read(path), path, unique_ids=unique_flag_for(path)), path)
    todo_path = next(p for p in DEFAULTS if unique_flag_for(p))
    good = read(todo_path)
    uniq = unique_flag_for(todo_path)
    expect_caught(
        check(inject(good, "2026-10-10 用户裁定", "2026-10-10|裁定", "a"), "inject a", uniq),
        "bare pipe inside a cell",
    )
    # Anchor on whatever gap row currently exists: gap rows get removed when a
    # gap closes, so a hardcoded id rots (it did - `| G30 |` moved to
    # CHANGELOGS and this selftest failed loudly, which is the point of it).
    gap_row = next((ln for ln in good.split("\n") if re.match(r"^\| G\d+ \|", ln)), None)
    if gap_row is None:
        raise SystemExit("FAIL: no gap row to inject into - the gap table moved")
    expect_caught(
        check(inject(good, gap_row, "\n" + gap_row, "b"), "inject b", uniq),
        "blank line splitting a table",
    )
    lines = good.split("\n")
    hit = next((i for i, ln in enumerate(lines) if ln.startswith("| D16 |")), None)
    if hit is None:
        raise SystemExit("FAIL: anchor for injection (c) not found")
    lines[hit] = lines[hit].rstrip().rstrip("|")
    expect_caught(check("\n".join(lines), "inject c", uniq), "row not closing with a pipe")
    expect_caught(
        check(inject(good, "| D15 |", "| D14 |", "d"), "inject d", uniq),
        "duplicate decision id",
    )
    expect_caught(
        check(inject(good, "D1-D17", "D1-D14", "e"), "inject e", uniq),
        "heading under-claiming the decision range",
    )
    # (f) a separator row must exist, so a header-only fragment is reported
    expect_caught(
        check(inject(good, "| D1 |", "| DX |\n", "f"), "inject f", uniq),
        "headerless or separatorless fragment",
    )
    # (g) a size row that no longer matches the real file must be reported, and the
    #     anchor is taken from the table itself so the selftest cannot rot by date
    readme_text = read(DOC_README)
    rlines = readme_text.split("\n")
    rows = size_rows(rlines)
    if not rows:
        raise SystemExit("FAIL: no 体量 rows to inject into - the size table moved")
    report(check_sizes(readme_text, DOC_README)[0], f"{DOC_README} (size table, clean)")
    first = rows[0]
    cells = [c.strip() for c in rlines[first].strip().strip("|").split("|")]
    stale = "\n".join(
        ln.replace(cells[1], "999 行 / 1.0 KB", 1) if i == first else ln
        for i, ln in enumerate(rlines)
    )
    expect_caught(
        check_sizes(stale, DOC_README)[0],
        "体量 copy out of date with the real file",
    )
    # (h) a missing size table must not read as "nothing to check"
    expect_caught(
        check_sizes("\n".join(ln for ln in rlines if not ln.startswith(SIZE_HEADER)), DOC_README)[
            0
        ],
        "体量 table missing entirely",
    )
    print(f"SELFTEST: ruler fires on all {FIRED} injected defects")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if "--refresh-sizes" in sys.argv:
        refresh_sizes()
        return
    paths = [Path(a) for a in sys.argv[1:] if not a.startswith("--")] or DEFAULTS
    for path in paths:
        report(check(read(path), path, unique_ids=unique_flag_for(path)), path)
    if DOC_README in paths:
        problems, _ = check_sizes(read(DOC_README), DOC_README)
        report(problems, f"{DOC_README} (size table)")


if __name__ == "__main__":
    main()
