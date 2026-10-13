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

"""The device action manifest's conformance suite (contracted surface).

Two kinds of protection remain after the smart agent stack moved to the host:

* **Fixture pins** freeze the exact JSON schema the in-process action server and
  the MCP tool declarations expose (a schema change must be a conscious act:
  regenerate the fixture in the same commit and say why).
* **Wire/market coverage** checks that every wire dialect maps to an Actuator
  method and that the declared actions cover exactly the manifest's device
  actions without leaking internal-only actions.

The Operator/Validator LangChain shells and their projection tests lived here
before the contraction; they are gone with the LLM-facing tool layer.
"""

import json
from pathlib import Path

import pytest

from artemis.mcp.action_manifest import (
    INTERNAL_ACTIONS,
    OPTIONAL_ACTIONS,
    REQUIRED_ACTIONS,
)
from artemis.mcp.action_specs import (
    ACTION_SPECS,
    OPERATOR_SHELL_ORDER,
    tool_declaration,
    wire_dialects,
)
from artemis.mcp.actuators.base import Actuator

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "action_surfaces"

FIXTURE_HINT = (
    "The generated schema differs from the pinned fixture. If this change is"
    " intentional, regenerate the fixture in the same commit and explain the schema"
    " change in the commit message; models see this schema directly."
)


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# --- Fixture pins --------------------------------------------------------------------


def test_tool_declarations_match_fixture():
    expected = _fixture("tool_declarations.json")
    by_constant = {
        "CLICK_TOOL": "click",
        "CLICK_SEQUENCE_TOOL": "click_sequence",
        "LONG_PRESS_TOOL": "long_press",
        "INPUT_TEXT_TOOL": "input_text",
        "SWIPE_TOOL": "swipe",
        "PRESS_KEY_TOOL": "press_key",
        "MANAGE_APP_TOOL": "manage_app",
        "WAIT_FOR_DELAY_TOOL": "wait_for_delay",
    }
    assert set(expected) == set(by_constant)
    for constant, name in by_constant.items():
        assert dict(tool_declaration(name)) == expected[constant], (
            f"declaration '{name}': {FIXTURE_HINT}"
        )


@pytest.mark.asyncio
async def test_action_server_manifest_matches_fixture():
    from artemis.mcp.action_server import build_action_server
    from artemis.mcp.actuators import MockActuator

    expected = _fixture("action_server_manifest.json")
    server = build_action_server(MockActuator())
    tools = await server.list_tools()
    generated = {
        t.name: {
            "description": t.description,
            "inputSchema": t.inputSchema,
            "outputSchema": t.outputSchema,
        }
        for t in tools
    }
    assert set(generated) == set(expected)
    for name in expected:
        assert generated[name] == expected[name], f"server tool '{name}': {FIXTURE_HINT}"


# --- Declaration schema --------------------------------------------------------------


def test_point_targets_accept_an_index_or_coordinates_in_both_profiles():
    """click / long_press / input_text address an element by index or by
    normalized coordinates; the description is required only for coordinates."""
    for name in ("click", "long_press", "input_text"):
        target = tool_declaration(name).parameters["properties"]["target"]
        assert target["anyOf"] == [
            {"type": "integer"},
            {"type": "array", "items": {"type": "integer"}},
        ], name
        assert "target_description" not in tool_declaration(name).parameters["required"], name
    assert tool_declaration("click_sequence").parameters["required"] == [
        "sequence",
        "target_descriptions",
    ]


def test_documented_differences_concern_the_wire_only():
    """The agent dialect is single-sourced; a spec may only document how the
    agent dialect differs from the wire (spelling, vocabulary, resolution)."""
    for spec in ACTION_SPECS.values():
        assert "declaration dialect" not in spec.differences, spec.name


# --- Manifest coverage ---------------------------------------------------------------


def test_specs_cover_exactly_the_llm_reachable_device_actions():
    assert set(ACTION_SPECS) == (REQUIRED_ACTIONS | OPTIONAL_ACTIONS)
    assert not set(ACTION_SPECS) & INTERNAL_ACTIONS


def test_operator_shell_order_covers_operator_dialects():
    with_operator = {s.name for s in ACTION_SPECS.values() if s.operator is not None}
    assert set(OPERATOR_SHELL_ORDER) == with_operator
    assert len(OPERATOR_SHELL_ORDER) == len(set(OPERATOR_SHELL_ORDER))


def test_every_wire_dialect_matches_the_actuator_protocol():
    for spec in wire_dialects():
        method = getattr(Actuator, spec.name, None)
        assert callable(method), f"wire dialect '{spec.name}' has no corresponding Actuator method."


def test_manifest_wait_for_delay_uses_milliseconds():
    """The manifest's ``wait_for_delay`` takes ``time_in_ms``, never *seconds*.

    ``artemis/tools/actions/device_actions.py`` used to shadow-register a second
    ``wait_for_delay`` taking *seconds* while every prompt teaches milliseconds.
    The shadow ToolRegistry channel is deleted; the manifest is the only surface
    left, and its unit must stay milliseconds.
    """
    fields = set(tool_declaration("wait_for_delay").parameters["properties"])
    assert "seconds" not in fields
    assert "time_in_ms" in fields
