"""Numbered-reference gate for the migration docs.

Why this exists: the docs cross-reference each other by bare ids (D7, S11, G30,
R13). A mechanical sweep found 14 gap ids referenced with no findable row and
three ids (G8/G10/G11) carrying different meanings in docs/migration/inventory
than in docs/TODO.md. docs/migration/registry.md is the declared authority; this
script proves it stays true.

Judgments (each fails loudly, none of them prints-and-forgets):
  1. registry lists exactly the ids that TODO.md / CHANGELOGS.md / plugin-contract-rules.md define
  2. every id referenced anywhere in the tracked markdown corpus exists in registry
  3. ids that inventory/* defines with a different meaning are all listed as clashes
  4. the "closed" ids are individual registry rows, not folded back into one line
  5. paths and scripts registry.md points at actually exist
  6. no doc restates an id range that means "the whole set" (D1-Dn / S1-Sn / G1-Gn /
     R1-Rn) - only the authority (registry.md), the archive (CHANGELOGS.md, which
     quotes pre-fix text) and the heading that DEFINES the sequence may say so

Usage:
  python -X utf8 scripts/check_doc_registry.py
  python -X utf8 scripts/check_doc_registry.py --selftest
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "docs" / "TODO.md"
CHANGELOGS = ROOT / "docs" / "CHANGELOGS.md"
RULES = ROOT / "docs" / "migration" / "plugin-contract-rules.md"
REGISTRY = ROOT / "docs" / "migration" / "registry.md"
INVENTORY_GLOB = "docs/migration/inventory"

KINDS = ("D", "S", "G", "R")
# inventory-side ids that registry.md already declares as clashing / reused
CLASHABLE = {"G8", "G9", "G10", "G11", "G12"}

# A range that STARTS at 1 reads as "the whole set", so it is a copy of a derived
# fact: it goes wrong the moment anything is added. Only the authority itself may
# hold it, plus the archive that quotes pre-fix wording verbatim, plus the heading
# that defines the sequence.
TOTAL_RANGE = re.compile(r"\b([DSGR])1-\1?(\d+)")


def total_range_claims(files: list[Path]) -> list[tuple[str, int, str]]:
    """Every 'the whole set' range claim outside the authority (headings excepted)."""
    hits: list[tuple[str, int, str]] = []
    for path in files:
        if path in (REGISTRY, CHANGELOGS):
            continue
        for no, line in enumerate(read(path).split("\n"), start=1):
            if line.startswith("#"):
                # the section that DEFINES the sequence may name its own range
                continue
            for m in TOTAL_RANGE.finditer(line):
                rel = path.relative_to(ROOT).as_posix()
                hits.append((rel, no, m.group(0)))
    return hits


def tracked_markdown() -> list[Path]:
    """Use git ls-files as the scope; rglob would drag in node_modules."""
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "*.md"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    files = []
    for rel in out.stdout.splitlines():
        p = ROOT / rel.strip().replace("\\", "/")
        if p.exists():
            files.append(p)
    return files


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def defined_in_todo() -> dict[str, set[str]]:
    text = read(TODO)
    got = {k: set() for k in KINDS}
    got["D"] |= {f"D{m}" for m in re.findall(r"^\| D(\d+) \|", text, re.M)}
    got["S"] |= {f"S{m}" for m in re.findall(r"^\*\*S(\d+)\b", text, re.M)}
    got["G"] |= {f"G{m}" for m in re.findall(r"^\| G(\d+) \|", text, re.M)}
    # ids folded into the "| 已关闭 | ... |" row (kept for the legacy shape)
    for row in re.findall(r"^\| 已关闭 \|(.*)\|$", text, re.M):
        got["G"] |= {f"G{m}" for m in re.findall(r"G(\d+)", row)}
    # closed gaps now live in CHANGELOGS.md's 已关闭差距史 table: one row per id
    if CHANGELOGS.exists():
        log = read(CHANGELOGS)
        got["G"] |= {f"G{m}" for m in re.findall(r"^\| G(\d+) \|", log, re.M)}
    return got


def defined_in_rules() -> set[str]:
    return {f"R{m}" for m in re.findall(r"^## R(\d+)", read(RULES), re.M)}


def registry_ids() -> set[str]:
    ids: set[str] = set()
    for row in re.findall(r"^\| ([DSGR]\d+) \|", read(REGISTRY), re.M):
        ids.add(row)
    return ids


def referenced_ids(files: list[Path]) -> dict[str, set[str]]:
    """Every id mentioned in the corpus, expanding ranges like R1-R19."""
    where: dict[str, set[str]] = {}
    for path in files:
        text = read(path)
        for kind in KINDS:
            for m in re.findall(rf"\b{kind}(\d+)\b", text):
                where.setdefault(f"{kind}{m}", set()).add(path.name)
            for lo, hi in re.findall(rf"{kind}(\d+)[-–]{kind}?(\d+)", text):
                for i in range(int(lo), int(hi) + 1):
                    where.setdefault(f"{kind}{i}", set()).add(path.name)
    return where


def inventory_side_ids() -> set[str]:
    """Ids inventory/* uses its own numbering for (``**G10 · …**`` or bullets)."""
    found: set[str] = set()
    for path in sorted((ROOT / INVENTORY_GLOB).glob("*.md")):
        text = read(path)
        found |= {f"G{m}" for m in re.findall(r"\*\*G(\d+) ·", text)}
    return found


def referenced_paths_in_registry() -> list[str]:
    """Every file path registry.md points at, whether or not it exists."""
    text = read(REGISTRY)
    cited = set(re.findall(r"scripts/[\w.\-/]+\.py", text))
    cited |= set(re.findall(r"tests/fixtures/[\w.\-/]+\.json", text))
    cited |= set(re.findall(r"(?:docs|plugins|artemis)/[\w.\-/]+\.(?:md|json|ts)", text))
    return sorted(cited)


def resolve(rel: str) -> bool:
    """A cited path resolves if it exists at the root or inside the plugin."""
    base = rel.replace("\\", "/").lstrip("/")
    candidates = [ROOT / base, ROOT / "plugins" / "dsh-autogamer" / base]
    if not base.startswith(("docs/", "plugins/", "scripts/")):
        candidates.insert(0, ROOT / "docs" / base)
    return any(c.exists() for c in candidates)


def check() -> list[str]:
    problems: list[str] = []
    files = tracked_markdown()
    todo_ids = defined_in_todo()
    rules_ids = defined_in_rules()
    reg = registry_ids()

    authoritative = set().union(*todo_ids.values()) | rules_ids

    # 1. registry must list exactly the authoritative ids
    missing_in_registry = sorted(authoritative - reg)
    invented_in_registry = sorted(reg - authoritative)
    for ident in missing_in_registry:
        problems.append(f"registry.md is missing a row for {ident} (defined in todo/rules)")
    for ident in invented_in_registry:
        problems.append(f"registry.md lists {ident} but nothing defines it any more")

    # 2. no dangling references anywhere
    for ident, sources in sorted(referenced_ids(files).items()):
        if ident not in reg:
            problems.append(f"dangling reference {ident} used in {sorted(sources)}")

    # 3. inventory's private numbering must be declared as a clash
    undeclared = sorted(inventory_side_ids() - CLASHABLE)
    for ident in undeclared:
        problems.append(
            f"inventory/* re-defines {ident} with its own meaning; "
            "add it to the clash table in registry.md or rename the reference"
        )
    if "编号冲突" not in read(REGISTRY):
        problems.append("registry.md lost its clash table section")

    # 4. closed ids stay as rows
    closed = {
        ident for ident in todo_ids["G"] if re.search(rf"^\| {ident} \|", read(TODO), re.M) is None
    }
    for ident in sorted(closed):
        row = re.search(rf"^\| {ident} \|", read(REGISTRY), re.M)
        if row is None:
            problems.append(
                f"{ident} is only folded into TODO.md's 已关闭 row and has no registry row"
            )

    # 5. pointers inside registry.md must resolve
    for rel in referenced_paths_in_registry():
        if not resolve(rel):
            problems.append(f"registry.md points at {rel} which does not exist")

    # 6. no second copy of "the whole set"
    claims = total_range_claims(files)
    for name, no, text in claims:
        problems.append(
            f"{name}:{no} restates the total id range {text}; cite registry.md instead "
            "- a copied range is wrong the moment one id is added"
        )

    print(
        f"corpus: {len(files)} md files; authoritative ids: {len(authoritative)} "
        f"(D{len(todo_ids['D'])} S{len(todo_ids['S'])} G{len(todo_ids['G'])} R{len(rules_ids)}); "
        f"registry rows: {len(reg)}; total-range restatements outside the authority: {len(claims)}"
    )
    return problems


def report(problems: list[str]) -> None:
    if problems:
        for p in problems:
            print("PROBLEM:", p)
        raise SystemExit(f"FAIL: {len(problems)} doc-reference problem(s)")
    print("OK: every numbered reference resolves and registry matches the sources")


def selftest() -> None:
    """Inject defects, then restore byte-for-byte.

    write_text() would re-line-end the file on Windows, so every mutation here
    goes through bytes and the restore check compares bytes too.
    """
    report(check())
    fired = 0
    registry_bytes = REGISTRY.read_bytes()
    original = registry_bytes.decode("utf-8")
    # drop a whole class of rows: registry must then report them missing
    gutted = "\n".join(ln for ln in original.split("\n") if not re.match(r"^\| R\d+ \|", ln))
    REGISTRY.write_bytes(gutted.encode("utf-8"))
    try:
        problems = check()
        caught = [p for p in problems if "missing a row for R" in p]
        if not caught:
            raise SystemExit("FAIL: ruler is blind to deleted R rows")
        print(f"CAUGHT [deleted R rows]: {caught[0]}")
        fired += 1
    finally:
        REGISTRY.write_bytes(registry_bytes)
    if REGISTRY.read_bytes() != registry_bytes:
        raise SystemExit("FAIL: selftest did not restore registry.md byte-for-byte")
    print("OK: registry.md restored byte-for-byte after selftest")
    # invent a dangling id in a doc and expect it to be reported.
    # The ghost id is DERIVED (max registered G + 1), never a literal: a hardcoded
    # one rots the moment that number gets defined, and then the mutation silently
    # stops firing - which is the exact failure class rule R27 warns about.
    todo_bytes = TODO.read_bytes()
    todo = todo_bytes.decode("utf-8")
    known = {int(m) for m in re.findall(r"^\| G(\d+) \|", original, re.M)}
    ghost = f"G{(max(known) + 1) if known else 9999}"
    tampered = re.sub(r"\bG\d+\b", ghost, todo, count=1)
    if tampered == todo:
        raise SystemExit("FAIL: selftest anchor not found in TODO.md")
    if ghost in original:
        raise SystemExit(f"FAIL: ghost id {ghost} is not actually dangling")
    TODO.write_bytes(tampered.encode("utf-8"))
    try:
        problems = check()
        caught = [p for p in problems if ghost in p]
        if not caught:
            raise SystemExit(f"FAIL: ruler is blind to a renamed/dangling id ({ghost})")
        print(f"CAUGHT [dangling id]: {caught[0]}")
        fired += 1
    finally:
        TODO.write_bytes(todo_bytes)
    if TODO.read_bytes() != todo_bytes:
        raise SystemExit("FAIL: selftest did not restore TODO.md byte-for-byte")
    print("OK: TODO.md restored byte-for-byte after selftest")
    # copy a "the whole set" range into a doc body: only registry.md may say that.
    # Anchor on whatever gap row exists, else a decision row (TODO may carry no
    # open gap rows at all after the 2026-10-14 clearing); the range literal is
    # built from the registry's current D max so the anchor cannot rot again.
    gap_row = next((ln for ln in todo.split("\n") if re.match(r"^\| G\d+ \|", ln)), None)
    if gap_row is None:
        gap_row = next((ln for ln in todo.split("\n") if re.match(r"^\| D\d+ \|", ln)), None)
    if gap_row is None:
        raise SystemExit(
            "FAIL: no gap or decision row to inject the range defect into - the tables moved"
        )
    max_d = max(int(i[1:]) for i in registry_ids() if i.startswith("D"))
    copied = gap_row.rstrip().rstrip("|") + f" 完整口径见 D1-D{max_d} |\n"
    TODO.write_bytes(todo.replace(gap_row, copied, 1).encode("utf-8"))
    try:
        problems = check()
        caught = [p for p in problems if "restates the total id range" in p]
        if not caught:
            raise SystemExit("FAIL: ruler is blind to a copied total id range")
        print(f"CAUGHT [total-range restatement]: {caught[0]}")
        fired += 1
    finally:
        TODO.write_bytes(todo_bytes)
    if TODO.read_bytes() != todo_bytes:
        raise SystemExit("FAIL: selftest did not restore TODO.md byte-for-byte (range defect)")
    print(f"SELFTEST: reference gate fires on all {fired} injected defects")


def main() -> None:
    import sys

    if "--selftest" in sys.argv:
        selftest()
        return
    report(check())


if __name__ == "__main__":
    main()
