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

"""Device action manifest classification and actuator contract tests.

The smart-agent prompts used to live in this repository and were cross-checked
against the manifest here; they moved to the DSH host with the agent stack, so
the prompt-scan invariants were removed with them. What remains is the device
action manifest itself: disjoint action classification, the actuator contract,
and the declaration surface derivation.
"""

import pytest

from artemis.core.tool_declaration import ToolDeclaration
from artemis.mcp.action_manifest import (
    ActuatorContractError,
    AGENT_ROLES,
    BACKEND_INDEPENDENT_TOOLS,
    DEVICE_ACTIONS,
    ExtensionTool,
    INTERNAL_ACTIONS,
    OPTIONAL_ACTIONS,
    REQUIRED_ACTIONS,
    available_device_actions,
    filter_declarations,
    validate_actuator,
)


# --- Manifest classification ---------------------------------------------------------


def test_manifest_sets_are_disjoint():
    sets = {
        "REQUIRED_ACTIONS": REQUIRED_ACTIONS,
        "OPTIONAL_ACTIONS": OPTIONAL_ACTIONS,
        "INTERNAL_ACTIONS": INTERNAL_ACTIONS,
        "BACKEND_INDEPENDENT_TOOLS": BACKEND_INDEPENDENT_TOOLS,
    }
    names = list(sets)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            overlap = sets[a] & sets[b]
            assert not overlap, f"{a} and {b} overlap: {sorted(overlap)}"


# --- Actuator contract ---------------------------------------------------------------


class _StubActuator:
    """Minimal actuator test double with configurable capabilities and extensions."""

    def __init__(self, caps=None, exts=None):
        self._caps = frozenset(caps if caps is not None else DEVICE_ACTIONS)
        self._exts = list(exts or [])

    def capabilities(self):
        return self._caps

    def extensions(self):
        return self._exts


def _extension(**overrides) -> ExtensionTool:
    async def _noop(**_kwargs):
        return "ok"

    defaults = dict(
        name="calibrate_arm",
        description=(
            "Runs the robot arm's touch calibration sweep. Use before the first "
            "physical action of a session, or after any missed tap."
        ),
        input_schema={"type": "object", "properties": {}},
        handler=_noop,
        targets=frozenset({"operator", "flash"}),
    )
    defaults.update(overrides)
    return ExtensionTool(**defaults)


def test_full_actuator_passes_validation():
    validate_actuator(_StubActuator())


def test_minimal_actuator_passes_validation():
    """REQUIRED + INTERNAL alone is a legal backend; every optional action may be absent."""
    validate_actuator(_StubActuator(caps=REQUIRED_ACTIONS | INTERNAL_ACTIONS))


def test_missing_required_action_fails_fast():
    caps = DEVICE_ACTIONS - {"click_sequence"}
    with pytest.raises(ActuatorContractError, match="click_sequence"):
        validate_actuator(_StubActuator(caps=caps))


def test_missing_internal_action_fails_fast():
    caps = DEVICE_ACTIONS - {"observe_screen"}
    with pytest.raises(ActuatorContractError, match="observe_screen"):
        validate_actuator(_StubActuator(caps=caps))


def test_unknown_capability_is_rejected():
    """Backend-specific tools must go through extensions(), not capabilities()."""
    with pytest.raises(ActuatorContractError, match="calibrate_arm"):
        validate_actuator(_StubActuator(caps=DEVICE_ACTIONS | {"calibrate_arm"}))


def test_extension_name_collision_fails_fast():
    with pytest.raises(ActuatorContractError, match="collides"):
        validate_actuator(_StubActuator(exts=[_extension(name="click")]))


def test_duplicate_extension_names_fail_fast():
    with pytest.raises(ActuatorContractError, match="more than once"):
        validate_actuator(_StubActuator(exts=[_extension(), _extension()]))


def test_extension_with_thin_description_is_rejected():
    """Extensions get no prompt-level teaching; the description carries the contract."""
    with pytest.raises(ActuatorContractError, match="description"):
        validate_actuator(_StubActuator(exts=[_extension(description="Calibrates.")]))


def test_extension_with_unknown_target_is_rejected():
    with pytest.raises(ActuatorContractError, match="unknown agent role"):
        validate_actuator(_StubActuator(exts=[_extension(targets=frozenset({"planner"}))]))


# --- Surface derivation --------------------------------------------------------------


def _declarations(*names: str) -> list[ToolDeclaration]:
    return [
        ToolDeclaration(name=n, description=f"{n} tool", parameters={"type": "object"})
        for n in names
    ]


def test_available_device_actions_excludes_internal():
    actions = available_device_actions(_StubActuator())
    assert actions == REQUIRED_ACTIONS | OPTIONAL_ACTIONS
    assert not actions & INTERNAL_ACTIONS


def test_filter_drops_unimplemented_optional_actions():
    actuator = _StubActuator(caps=DEVICE_ACTIONS - {"swipe", "manage_app"})
    decls = _declarations("click", "swipe", "manage_app", "read_note")
    kept = [d.name for d in filter_declarations(decls, actuator, agent="flash")]
    assert kept == ["click", "read_note"]


def test_filter_passes_through_unclassified_agent_tools():
    """Agent-specific tools the manifest does not know must never be gated."""
    actuator = _StubActuator(caps=REQUIRED_ACTIONS | INTERNAL_ACTIONS)
    decls = _declarations("click_sequence", "submit_findings", "some_bespoke_tool")
    kept = [d.name for d in filter_declarations(decls, actuator, agent="operator")]
    assert kept == ["click_sequence", "submit_findings", "some_bespoke_tool"]


def test_filter_appends_extensions_for_targeted_agents_only():
    actuator = _StubActuator(exts=[_extension(targets=frozenset({"flash"}))])
    decls = _declarations("click")

    flash = [d.name for d in filter_declarations(decls, actuator, agent="flash")]
    operator = [d.name for d in filter_declarations(decls, actuator, agent="operator")]

    assert flash == ["click", "calibrate_arm"]
    assert operator == ["click"]


def test_filter_extension_declaration_shape():
    """Extension declarations must be indistinguishable in shape from known ones."""
    actuator = _StubActuator(exts=[_extension()])
    decls = filter_declarations([], actuator, agent="operator")
    assert len(decls) == 1
    ext_decl = decls[0]
    assert isinstance(ext_decl, ToolDeclaration)
    assert ext_decl.name == "calibrate_arm"
    assert ext_decl.parameters == {"type": "object", "properties": {}}


def test_filter_rejects_unknown_agent_role():
    with pytest.raises(ValueError, match="Unknown agent role"):
        filter_declarations([], _StubActuator(), agent="planner")


def test_all_agent_roles_are_covered():
    assert AGENT_ROLES == {"operator", "flash", "validator"}
