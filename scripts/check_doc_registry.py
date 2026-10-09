"""Numbered-reference gate for the migration docs.

Why this exists: the docs cross-reference each other by bare ids (D7, S11, G30,
R13). A mechanical sweep found 14 gap ids referenced with no findable row and
three ids (G8/G10/G11) carrying different meanings in docs/migration/inventory
than in docs/todo.md. docs/migration/registry.md is the declared authority; this
script proves it stays true.

Judgments (each fails loudly, none of them prints-and-forgets):
  1. registry lists exactly the ids that todo.md / plugin-contract-rules.md define
  2. every id referenced anywhere in the tracked markdown corpus exists in registry
  3. ids that inventory/* defines with a different meaning are all listed as clashes
  4. the "closed" ids are individual registry rows, not folded back into one line
  5. paths and scripts registry.md points at actually exist

Usage:
  python -X utf8 scripts/check_doc_registry.py
  python -X utf8 scripts/check_doc_registry.py --selftest
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "docs" / "todo.md"
RULES = ROOT / "docs" / "migration" / "plugin-contract-rules.md"
REGISTRY = ROOT / "docs" / "migration" / "registry.md"
INVENTORY_GLOB = "docs/migration/inventory"

KINDS = ("D", "S", "G", "R")
# inventory-side ids that registry.md already declares as clashing / reused
CLASHABLE = {"G8", "G9", "G10", "G11", "G12"}


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
    # ids folded into the "| 已关闭 | G1（…）/G2（…） |" row
    for row in re.findall(r"^\| 已关闭 \|(.*)\|$", text, re.M):
        got["G"] |= {f"G{m}" for m in re.findall(r"G(\d+)", row)}
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
    candidates = [ROOT / base, ROOT / "plugins" / "autogamer-device" / base]
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
                f"{ident} is only folded into todo.md's 已关闭 row and has no registry row"
            )

    # 5. pointers inside registry.md must resolve
    for rel in referenced_paths_in_registry():
        if not resolve(rel):
            problems.append(f"registry.md points at {rel} which does not exist")

    print(
        f"corpus: {len(files)} md files; authoritative ids: {len(authoritative)} "
        f"(D{len(todo_ids['D'])} S{len(todo_ids['S'])} G{len(todo_ids['G'])} R{len(rules_ids)}); "
        f"registry rows: {len(reg)}"
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
    finally:
        REGISTRY.write_bytes(registry_bytes)
    if REGISTRY.read_bytes() != registry_bytes:
        raise SystemExit("FAIL: selftest did not restore registry.md byte-for-byte")
    print("OK: registry.md restored byte-for-byte after selftest")
    # invent a dangling id in a doc and expect it to be reported
    todo_bytes = TODO.read_bytes()
    todo = todo_bytes.decode("utf-8")
    tampered = todo.replace("G30", "G77", 1)
    if tampered == todo:
        raise SystemExit("FAIL: selftest anchor not found in todo.md")
    TODO.write_bytes(tampered.encode("utf-8"))
    try:
        problems = check()
        caught = [p for p in problems if "G77" in p]
        if not caught:
            raise SystemExit("FAIL: ruler is blind to a renamed/dangling id")
        print(f"CAUGHT [dangling id]: {caught[0]}")
    finally:
        TODO.write_bytes(todo_bytes)
    if TODO.read_bytes() != todo_bytes:
        raise SystemExit("FAIL: selftest did not restore todo.md byte-for-byte")
    print("SELFTEST: reference gate fires on both injected defects")


def main() -> None:
    import sys

    if "--selftest" in sys.argv:
        selftest()
        return
    report(check())


if __name__ == "__main__":
    main()
