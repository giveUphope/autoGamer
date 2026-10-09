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
    (in todo.md only) appear exactly once; gap ids likewise

Usage:
  python -X utf8 scripts/check_doc_tables.py [file ...]
  python -X utf8 scripts/check_doc_tables.py --selftest
"""

import re
import sys
from pathlib import Path

DEFAULTS = [
    r"D:/DEV/autoGamer/AGENTS.md",
    r"D:/DEV/autoGamer/docs/todo.md",
    r"D:/DEV/autoGamer/docs/migration/README.md",
    r"D:/DEV/autoGamer/docs/migration/registry.md",
    r"D:/DEV/autoGamer/docs/migration/glossary.md",
    r"D:/DEV/autoGamer/docs/migration/upstream-plugin-forms.md",
    r"D:/DEV/autoGamer/docs/migration/plugin-contract-rules.md",
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
    if problems:
        print(f"CAUGHT [{label}]: {problems[0]}")
    else:
        raise SystemExit(f"FAIL: ruler is blind to [{label}]")


def inject(text, anchor, replacement, probe):
    out = text.replace(anchor, replacement, 1)
    if out == text:
        raise SystemExit(f"FAIL: anchor for injection ({probe}) not found - the text moved")
    return out


def read(path):
    return Path(path).read_text(encoding="utf-8")


def unique_flag_for(path):
    return path.endswith("todo.md")


def selftest():
    for path in DEFAULTS:
        report(check(read(path), path, unique_ids=unique_flag_for(path)), path)
    todo_path = next(p for p in DEFAULTS if p.endswith("todo.md"))
    good = read(todo_path)
    uniq = unique_flag_for(todo_path)
    expect_caught(
        check(inject(good, "2026-10-10 用户裁定", "2026-10-10|裁定", "a"), "inject a", uniq),
        "bare pipe inside a cell",
    )
    expect_caught(
        check(inject(good, "| G30 |", "\n| G30 |", "b"), "inject b", uniq),
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
    print("SELFTEST: ruler fires on all six injected defects")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    paths = [a for a in sys.argv[1:] if not a.startswith("--")] or DEFAULTS
    for path in paths:
        report(check(read(path), path, unique_ids=unique_flag_for(path)), path)


if __name__ == "__main__":
    main()
