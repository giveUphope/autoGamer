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
async def test_tool_stays_read_only_and_addresses_no_device():
    tools = {tool.name: tool for tool in await adb_server.mcp.list_tools()}
    assert "list_devices" in tools
    schema = tools["list_devices"].inputSchema
    # The only knob is "do you want the expensive part". There is no serial parameter: the tool
    # lists everything or nothing, and cannot address -- let alone wake -- a device.
    assert set(schema.get("properties", {})) == {"include_lock_state"}
    assert schema["properties"]["include_lock_state"]["type"] == "boolean"
    assert schema["properties"]["include_lock_state"].get("default") is False


@pytest.mark.asyncio
async def test_lock_state_is_not_queried_unless_asked(monkeypatch):
    """Default shape is the cheap one: no `is_locked` key at all, and no dumpsys either.

    "not asked" and "asked but unknown" mean opposite things to the caller (one must fail open, the
    other fail closed), so absence of the key is part of the contract, not an accident.
    """
    from artemis.core.diagnostics.probes import adb_probe as probe_module
    from artemis.runtime.device_pool import DeviceStatus

    async def one():
        return [DeviceStatus(serial="A", state="device")]

    def boom(*a, **kw):  # pragma: no cover - must never run
        raise AssertionError("lock state must not be probed when it was not asked for")

    monkeypatch.setattr(probe_module.AdbDeviceProbe, "device_lock_state", boom)
    patch_enumeration(monkeypatch, one)
    entry = json.loads(await adb_server.list_devices())["devices"][0]
    assert "is_locked" not in entry


@pytest.mark.asyncio
async def test_lock_state_is_tri_state_when_asked(monkeypatch):
    from artemis.core.diagnostics.probes import adb_probe as probe_module
    from artemis.runtime.device_pool import DeviceStatus

    async def two():
        return [
            DeviceStatus(serial="locked-one", state="device"),
            DeviceStatus(serial="open-one", state="device"),
        ]

    async def fake_lock(self, serial, timeout_seconds=1.0):  # noqa: ANN001, ARG001
        return {"locked-one": True, "open-one": None}[serial]  # unknown stays None

    monkeypatch.setattr(probe_module.AdbDeviceProbe, "device_lock_state", fake_lock)
    patch_enumeration(monkeypatch, two)
    devices = {
        d["serial"]: d
        for d in json.loads(await adb_server.list_devices(include_lock_state=True))["devices"]
    }
    assert devices["locked-one"]["is_locked"] is True
    assert (
        devices["open-one"]["is_locked"] is None
    )  # asked, could not tell -- NOT the same as false
