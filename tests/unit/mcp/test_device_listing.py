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

"""G64: the read-only `list_devices` tool on the adb surface.

The one thing that matters here is that **"could not ask adb" never collapses into "no devices
attached"** -- `device_pool.py:354-356` exists precisely for that distinction, and a scheduler that
loses it would treat a transient adb blip as an empty fleet and stall every auto submission.
"""

import json

import pytest

from artemis.mcp import adb_server
from artemis.runtime.device_pool import DeviceStatus, device_pool


def patch_enumeration(monkeypatch, impl) -> None:
    # Patched on the singleton instance the tool imports, not by dotted module path.
    monkeypatch.setattr(device_pool, "try_list_devices_async", impl)


@pytest.mark.asyncio
async def test_enumerated_false_is_not_an_empty_fleet(monkeypatch):
    async def could_not_ask():
        return None  # try_list_devices_async's documented "no usable snapshot" answer

    patch_enumeration(monkeypatch, could_not_ask)
    payload = json.loads(await adb_server.list_devices())
    assert payload == {"enumerated": False, "devices": []}


@pytest.mark.asyncio
async def test_empty_answer_is_a_real_answer(monkeypatch):
    async def genuinely_none_attached():
        return []

    patch_enumeration(monkeypatch, genuinely_none_attached)
    payload = json.loads(await adb_server.list_devices())
    assert payload["enumerated"] is True
    assert payload["devices"] == []
    assert payload != {"enumerated": False, "devices": []}  # distinguishable from "could not ask"


@pytest.mark.asyncio
async def test_device_fields_come_through_unchanged(monkeypatch):
    async def one_device():
        return [DeviceStatus(serial="emulator-5554", state="device", is_busy=False)]

    patch_enumeration(monkeypatch, one_device)
    payload = json.loads(await adb_server.list_devices())
    assert payload["enumerated"] is True
    device = payload["devices"][0]
    assert device["serial"] == "emulator-5554"
    # The plugin's pool reads these fields to decide eligibility, so the shape is the contract.
    assert set(device) == {
        "serial",
        "state",
        "model",
        "product",
        "is_emulator",
        "is_busy",
        "active_pid",
        "active_task_desc",
        "active_session_id",
        "acquired_at",
    }


@pytest.mark.asyncio
async def test_enumeration_crash_never_raises_out_of_the_tool(monkeypatch):
    async def boom():
        raise RuntimeError("adb server died mid-call")

    patch_enumeration(monkeypatch, boom)
    payload = json.loads(await adb_server.list_devices())
    assert payload["enumerated"] is False  # a listing tool must not become a turn-killing error


@pytest.mark.asyncio
async def test_tool_is_exposed_read_only():
    tools = {tool.name: tool for tool in await adb_server.mcp.list_tools()}
    assert "list_devices" in tools
    # Nothing to address a device with: the tool takes no arguments at all.
    assert tools["list_devices"].inputSchema.get("properties") == {}
