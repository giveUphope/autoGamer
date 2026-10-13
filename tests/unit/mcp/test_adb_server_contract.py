# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Contract for the stdio ADB MCP server's external (pixel-space) surface.

``artemis/mcp/adb_server.py`` deliberately keeps its historical *pixel-space*
contract for external MCP clients (absolute pixel coordinates, combined
``coordinates`` list parameters, ``KEYCODE_*`` vocabulary). These guards pin
that surface:

* **Fixture pin** -- the full generated schema of every adb_server tool is
  frozen in ``tests/fixtures/action_surfaces/adb_server_manifest.json``; any
  signature or docstring change must regenerate the fixture in the same commit
  (external clients see this schema directly).
* **Coordinate packing** -- the legacy combined ``coordinates`` lists keep
  their documented integer arity and stay required.
* **Vocabulary** -- ``press_key`` keeps teaching the ``KEYCODE_*`` vocabulary.
* **compare_ui_frames** -- the image-diff route's changed/unchanged and
  undecodable-fallback behaviour is exercised.
"""

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "action_surfaces"

FIXTURE_HINT = (
    "The generated schema differs from the pinned fixture. If this change is"
    " intentional, regenerate the fixture in the same commit and explain the schema"
    " change in the commit message; external MCP clients see this schema directly."
)


# --- Legacy combined-coordinates packaging --------------------------------------------

#: adb tool -> (marker in docstring, arity). ``coordinates`` packs the absolute
#: pixel coordinate pair(s) into one list; its shape is asserted here and pinned
#: by the fixture.
COORDINATE_PACKING: dict[str, tuple[str, int]] = {
    "tap": ("[x, y]", 2),
    "long_press_on": ("[x, y]", 2),
    "swipe": ("[start_x, start_y, end_x, end_y]", 4),
    "focus_and_input_text": ("[x, y]", 2),
    "focus_and_clear_text": ("[x, y]", 2),
}


async def _adb_server_tools() -> dict:
    from artemis.mcp import adb_server

    tools = await adb_server.mcp.list_tools()
    return {t.name: t for t in tools}


def _prop(tool, name: str) -> dict:
    props = tool.inputSchema.get("properties", {})
    assert name in props, f"tool '{tool.name}' lost parameter '{name}'"
    return props[name]


# --- Fixture pin -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adb_server_manifest_matches_fixture():
    expected = json.loads((FIXTURES / "adb_server_manifest.json").read_text(encoding="utf-8"))
    tools = await _adb_server_tools()
    generated = {
        name: {"description": t.description, "inputSchema": t.inputSchema}
        for name, t in tools.items()
    }
    assert set(generated) == set(expected), FIXTURE_HINT
    for name in expected:
        assert generated[name] == expected[name], f"adb_server tool '{name}': {FIXTURE_HINT}"


# --- Coordinate packing -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_coordinate_packing_shape_is_documented():
    """The combined `coordinates` legacy parameter keeps its documented arity."""
    tools = await _adb_server_tools()
    for adb_name, (marker, _arity) in COORDINATE_PACKING.items():
        tool = tools[adb_name]
        prop = _prop(tool, "coordinates")
        assert prop.get("type") == "array", f"'{adb_name}.coordinates' must be an array"
        assert prop.get("items", {}).get("type") == "integer", (
            f"'{adb_name}.coordinates' must be a list of integers"
        )
        assert "coordinates" in set(tool.inputSchema.get("required", [])), (
            f"'{adb_name}.coordinates' must stay required"
        )
        assert marker in (tool.description or ""), (
            f"'{adb_name}' docstring no longer documents the coordinate shape"
            f" '{marker}'; external clients rely on this wording."
        )


@pytest.mark.asyncio
async def test_press_key_teaches_keycode_vocabulary():
    """adb_server's press_key takes raw KEYCODE_* strings; its docstring must keep
    teaching that vocabulary to external clients."""
    tools = await _adb_server_tools()
    desc = tools["press_key"].description or ""
    assert "KEYCODE_" in desc, (
        "adb_server press_key docstring must keep teaching KEYCODE_* vocabulary"
    )


# --- compare_ui_frames behaviour --------------------------------------------------------

from artemis.mcp import adb_server  # noqa: E402  (the manifest tests import it lazily)


def _png_b64(array) -> str:
    import base64

    import cv2
    import numpy as np

    ok, buf = cv2.imencode(".png", np.asarray(array, dtype=np.uint8))
    assert ok
    return base64.b64encode(buf.tobytes()).decode("ascii")


@pytest.mark.asyncio
async def test_compare_ui_frames_reports_identical_frames_as_unchanged():
    import numpy as np

    frame = _png_b64(np.full((400, 800), 120))
    result = json.loads(await adb_server.compare_ui_frames(frame, frame, action="back"))
    assert result == {"changed": False}


@pytest.mark.asyncio
async def test_compare_ui_frames_reports_a_navigation_as_changed():
    import numpy as np

    after_img = np.full((400, 800), 40, dtype=np.uint8)
    after_img[:, 400:] = 240
    result = json.loads(
        await adb_server.compare_ui_frames(
            _png_b64(np.full((400, 800), 40)), _png_b64(after_img), "back"
        )
    )
    assert result == {"changed": True}


@pytest.mark.asyncio
async def test_compare_ui_frames_keeps_the_assume_changed_fallback():
    """Undecodable bytes must not read as "nothing happened" -- that would stall the router."""
    import base64

    junk = base64.b64encode(b"definitely not a jpeg").decode("ascii")
    result = json.loads(await adb_server.compare_ui_frames(junk, junk, action="tap"))
    assert result == {"changed": True}
