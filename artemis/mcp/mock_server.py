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

"""Device-free action surface: the real ``--type adb`` tools over an in-memory device.

One function stands between those 14 tools and a machine with no adb server:
``adb_server._get_controller`` opens ``AdbClient(...)``, calls ``device_list()`` and raises when
nothing is attached. Its two cache short-circuits run *before* that I/O, so seeding the cache
with a controller bound to :class:`~artemis.mcp.actuators.mock.MockActuator` makes the whole
surface run offline **without touching the existing server**.

Seeding has to cover both short-circuits. Setting only the global controller is not enough: the
app loads ``.env`` itself, so ``ADB_DEVICE_SERIAL`` is normally populated and the lookup takes the
``_CONTROLLERS[serial]`` path. ``seed_mock_controllers`` therefore pins
``ARTEMIS_DEVICE_ID`` -- which is consulted *first* -- to :data:`MOCK_SERIAL` and registers that
key, so every call resolves deterministically instead of silently falling through to real adb.
"""

from __future__ import annotations

import os

from artemis.mcp import adb_server
from artemis.mcp.actuators.mock import MockActuator

__all__ = ["MOCK_SERIAL", "seed_mock_controllers"]

MOCK_SERIAL = "mock-device"


def seed_mock_controllers(width: int = 1080, height: int = 2400) -> MockActuator:
    """Install an in-memory controller in ``adb_server``'s caches and return the actuator.

    ``ARTEMIS_DEVICE_ID`` wins over ``ADB_DEVICE_SERIAL`` in ``_get_controller``'s lookup, so
    pinning it is what makes the mock surface independent of whatever ``.env`` says.
    """
    actuator = MockActuator(width=width, height=height)
    controller = actuator.controller
    os.environ["ARTEMIS_DEVICE_ID"] = MOCK_SERIAL
    adb_server._GLOBAL_CONTROLLER = controller  # noqa: SLF001
    adb_server._CONTROLLERS[MOCK_SERIAL] = controller  # noqa: SLF001 - documented seam for this server
    serial = os.environ.get("ADB_DEVICE_SERIAL")
    if serial:
        # A tool call that passes the serial explicitly must land on the mock too.
        adb_server._CONTROLLERS[serial] = controller  # noqa: SLF001
    return actuator
