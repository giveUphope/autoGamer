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

"""G62: the adb tool surface must be runnable with no adb server and no device.

``artemis mcp --type mock`` (``artemis.mcp.mock_server.seed_mock_controllers``) is the offline
path the plugin's contract tests were missing: until now the only device-free surface was a
hand-written JS stub, so the py implementation itself could never be exercised offline.

These tests pin the *mechanism*, not a copy of the tool list: seeding makes calls succeed while
``AdbClient`` is an intentional bomb, and un-seeded the same call fails. They also pin the
``compare_ui_frames`` shape to exactly what the py server emits -- a day of believing a stub
invented a ``ratio`` key that never existed upstream (changelogs #50/#51).
"""

import json
import os

import pytest

from artemis.mcp import adb_server, mock_server


@pytest.fixture
def isolated_server_state(monkeypatch):
    """Seed, then restore: the caches and ARTEMIS_DEVICE_ID are process globals."""
    saved_controllers = dict(adb_server._CONTROLLERS)
    saved_global = adb_server._GLOBAL_CONTROLLER
    saved_serial = os.environ.get("ARTEMIS_DEVICE_ID")
    # No test may reach a real adb server: an un-seeded call has to fail on this bomb, and a
    # seeded one has to succeed without touching the network at all.
    monkeypatch.setattr(
        adb_server, "AdbClient", lambda *a, **kw: pytest.fail("mock surface reached real adb")
    )
    yield mock_server.seed_mock_controllers()
    adb_server._CONTROLLERS.clear()
    adb_server._CONTROLLERS.update(saved_controllers)
    adb_server._GLOBAL_CONTROLLER = saved_global
    if saved_serial is None:
        os.environ.pop("ARTEMIS_DEVICE_ID", None)
    else:
        os.environ["ARTEMIS_DEVICE_ID"] = saved_serial


def test_without_seeding_the_surface_needs_adb(isolated_server_state):
    """The short-circuit is load-bearing: un-seeded, the same call cannot resolve a device."""
    isolated_server_state  # seeded by the fixture; undo it to observe the un-seeded behaviour
    adb_server._GLOBAL_CONTROLLER = None
    adb_server._CONTROLLERS.clear()
    with pytest.raises(pytest.fail.Exception):
        adb_server._get_controller()


@pytest.mark.asyncio
async def test_screenshot_and_action_run_offline(isolated_server_state):
    shot = await adb_server.take_screenshot(None)
    assert not str(shot).startswith("Error"), shot
    assert str(shot)[:8] == "iVBORw0K"  # a real PNG, not a canned placeholder

    assert await adb_server.tap(None, coordinates=[500, 500]) == "Success"
    assert await adb_server.back(None) == "Success"
    actions = [entry["action"] for entry in isolated_server_state.action_history]
    assert actions == ["tap", "press_key"]


@pytest.mark.asyncio
async def test_hierarchy_offline_is_json_the_plugin_can_parse(isolated_server_state):
    hierarchy = await adb_server.get_ui_hierarchy(None)
    parsed = json.loads(hierarchy)
    assert isinstance(parsed, list)
    assert {"text", "bounds"} <= set(parsed[0])


@pytest.mark.asyncio
async def test_mock_frames_feed_the_real_comparator(isolated_server_state):
    """The offline loop yields decodable pixels, so effect verification works with no device.

    The shape of ``compare_ui_frames`` is already pinned in ``test_adb_server_contract.py``; what
    is new here is that the *frames come from the mock surface itself* rather than from a
    synthetic array -- a stub that only answered text could never satisfy this.
    """
    before = await adb_server.take_screenshot(None)
    after = await adb_server.take_screenshot(None)
    verdict = json.loads(await adb_server.compare_ui_frames(before, after, action="tap"))
    assert verdict == {"changed": False}

    await adb_server.tap(None, coordinates=[10, 10])
    changed = await adb_server.take_screenshot(None)
    after_tap = json.loads(await adb_server.compare_ui_frames(before, changed, action="tap"))
    assert isinstance(after_tap["changed"], bool)
