"""Markdown table ruler for the migration docs.

Checks EVERY table in every `## ` section of a file:
  - column count matches that table's own header row
  - every row closes with a pipe
  - the row interval is contiguous (a blank line splits a table in Markdown)
  - no table spills past its section heading
  - decision ids D1..Dn stay contiguous, unique, and match the range the
    section heading claims; gap ids stay unique

Usage:
  python -X utf8 scripts/check_doc_tables.py [file ...]
  python -X utf8 scripts/check_doc_tables.py --selftest
"""

import re
import sys

DEFAULTS = [
    r"D:/DEV/autoGamer/docs/todo.md",
    r"D:/DEV/autoGamer/docs/migration/upstream-plugin-forms.md",
]


def sections(lines):
    """Yield (title, start, end) for every level-2 section."""
    marks = [i for i, ln in enumerate(lines) if ln.startswith("## ")]
    for pos, start in enumerate(marks):
        end = marks[pos + 1] if pos + 1 < len(marks) else len(lines)
        yield lines[start].strip(), start, end


def check(text, label):
    lines = text.split("\n")
    problems = []
    tables = 0
    for title, start, end in sections(lines):
        rows = [(i, ln) for i in range(start + 1, end) for ln in [lines[i]] if ln.startswith("|")]
        if len(rows) < 2:
            continue
        tables += 1
        expected = len(rows[0][1].strip().strip("|").split("|"))
        first, last = rows[0][0], rows[-1][0]
        anchor = f"{title} line {first + 1}"
        # contiguity: no non-table line between the first and last row
        for pos in range(first, last + 1):
            if not lines[pos].startswith("|"):
                problems.append(
                    f"{label} [{anchor}]: row interval broken at line {pos + 1} "
                    "(blank or prose splits the table)"
                )
        for pos, ln in rows:
            if not ln.rstrip().endswith("|"):
                problems.append(f"{label} [{anchor}]: line {pos + 1} does not close with a pipe")
            cells = ln.strip().strip("|").split("|")
            if len(cells) != expected:
                problems.append(
                    f"{label} [{anchor}]: line {pos + 1} has {len(cells)} cells, "
                    f"header declares {expected} (raw pipe inside a cell?)"
                )
        if last >= end:
            problems.append(
                f"{label} [{anchor}]: rows spill past the next heading at line {end + 1}"
            )
        ids = [ln.strip().strip("|").split("|")[0].strip() for _, ln in rows]
        decisions = [i for i in ids if re.fullmatch(r"D\d+", i)]
        if decisions:
            nums = sorted(int(i[1:]) for i in decisions)
            if nums != list(range(1, max(nums) + 1)):
                problems.append(f"{label} [{anchor}]: decision ids not contiguous: {nums}")
            dupes = {i for i in decisions if decisions.count(i) > 1}
            if dupes:
                problems.append(f"{label} [{anchor}]: duplicate decision ids: {sorted(dupes)}")
            claimed = re.search(r"D1-D(\d+)", title)
            if claimed and int(claimed.group(1)) != max(nums):
                problems.append(
                    f"{label} [{anchor}]: heading claims D1-D{claimed.group(1)} "
                    f"but the table holds up to D{max(nums)}"
                )
        gaps = [i for i in ids if re.fullmatch(r"G\d+", i)]
        if gaps:
            gnums = sorted(int(i[1:]) for i in gaps)
            dupg = {i for i in gaps if gaps.count(i) > 1}
            if dupg:
                problems.append(f"{label} [{anchor}]: duplicate gap ids: {sorted(dupg)}")
            print(f"  [{title}] {len(rows)} table rows, gap ids: {gnums}")
    print(f"{label}: {tables} table(s) checked")
    if tables == 0:
        problems.append(f"{label}: no tables found at all — ruler proved nothing")
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
    """Apply one injection, refusing to report success if the anchor moved."""
    out = text.replace(anchor, replacement, 1)
    if out == text:
        raise SystemExit(f"FAIL: anchor for injection ({probe}) not found — the text moved")
    return out


def selftest():
    todo = next(t for t in DEFAULTS if t.endswith("todo.md"))
    forms = next(t for t in DEFAULTS if "upstream-plugin-forms" in t)
    for path in (todo, forms):
        with open(path, encoding="utf-8") as fh:
            report(check(fh.read(), path), path)
    with open(todo, encoding="utf-8") as fh:
        good = fh.read()
    # (a) a bare pipe inside a cell splits the row
    expect_caught(
        check(inject(good, "2026-10-10 用户裁定", "2026-10-10|裁定", "a"), "inject a"),
        "bare pipe inside a cell",
    )
    # (b) a blank line inside the gap table breaks its interval
    expect_caught(
        check(inject(good, "| G30 |", "\n| G30 |", "b"), "inject b"),
        "blank line inside a table",
    )
    # (c) a row that stops closing with a pipe
    lines = good.split("\n")
    hit = next((i for i, ln in enumerate(lines) if ln.startswith("| D16 |")), None)
    if hit is None:
        raise SystemExit("FAIL: anchor for injection (c) not found — the text moved")
    lines[hit] = lines[hit].rstrip().rstrip("|")
    expect_caught(check("\n".join(lines), "inject c"), "row not closing with a pipe")
    # (d) a duplicate decision id
    expect_caught(
        check(inject(good, "| D15 |", "| D14 |", "d"), "inject d"),
        "duplicate decision id",
    )
    # (e) a heading that under-claims the decision range
    expect_caught(
        check(inject(good, "D1-D16", "D1-D14", "e"), "inject e"),
        "heading under-claiming the decision range",
    )
    print("SELFTEST: ruler fires on all five injected defects")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    paths = [a for a in sys.argv[1:] if not a.startswith("--")] or DEFAULTS
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            report(check(fh.read(), path), path)


if __name__ == "__main__":
    main()
