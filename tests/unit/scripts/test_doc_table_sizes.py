"""Locks for the 体量 measurement in scripts/check_doc_tables.py (changelogs #45).

The size column is a derived fact that had already drifted twice by hand-copying.
The third drift came from the environment instead of from a person: the table was
refreshed on a CRLF worktree, and every row went stale once those same files were
rewritten as LF. These tests pin the measurement to line-ending-independent bytes
and pin that a row disagreeing with its file is still reported.

The samples are hundreds of lines wide on purpose: KB is printed to one decimal, so
a one-step difference is 102.4 bytes and a short sample measures the same either way.
The first draft of this file used a 4-line body and passed against the unnormalized
measurement - caught by mutation check, recorded in changelogs #45.
"""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "check_doc_tables.py"
LINE = b"line-0000\n"  # 10 bytes LF, 11 as CRLF


@pytest.fixture(scope="module")
def ruler():
    spec = importlib.util.spec_from_file_location("check_doc_tables", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_doc(tmp_path: Path, name: str, body: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(body)
    return path


def test_size_does_not_track_line_endings(ruler, tmp_path):
    body = LINE * 400
    lf = write_doc(tmp_path, "lf.md", body)
    crlf = write_doc(tmp_path, "crlf.md", body.replace(b"\n", b"\r\n"))
    assert ruler.measured([lf]) == ruler.measured([crlf])
    assert ruler.measured([lf]) == (400, "3.9")


def test_multi_file_row_is_a_sum_across_line_endings(ruler, tmp_path):
    first = write_doc(tmp_path, "a.md", LINE * 300)
    second = write_doc(tmp_path, "b.md", (LINE * 500).replace(b"\n", b"\r\n"))
    lines, kb = ruler.measured([first, second])
    assert lines == 800
    # 800 rows x 10 bytes normalized, not 800 x 11: the CRs must not reach the sum
    assert float(kb) == pytest.approx(8000 / 1024, abs=0.05)


def test_stale_row_is_reported(ruler):
    text = ruler.read(ruler.DOC_README)
    lines = text.split("\n")
    rows = ruler.size_rows(lines)
    assert rows, "the 体量 table moved - this lock would prove nothing"
    cells = [c.strip() for c in lines[rows[0]].strip().strip("|").split("|")]
    stale = "\n".join(
        ln.replace(cells[1], "999 行 / 1.0 KB", 1) if i == rows[0] else ln
        for i, ln in enumerate(lines)
    )
    problems, _ = ruler.check_sizes(stale, ruler.DOC_README)
    assert problems, "a row that disagrees with its file must be reported"
