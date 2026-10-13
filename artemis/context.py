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

"""Device-facing runtime context (contracted for the DSH plugin split, D18).

The smart stack (LLM config, data engine, graph checkpoints, memory, video and
background agent tasks) has been removed: the LLM-driven agent now lives in the
DSH host. The device surface only carries the device descriptor, the ADB
clients, and caches for the lazily-created controller/driver and package
resolution. The device-context primitives are re-exported from the vendored
``mobile_use`` layer so existing ``from artemis.context import ...`` lines keep
working.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from third_party.mobile_use.context import (
    AppLaunchResult,
    DeviceClientAccessors,
    DeviceContext,
    DevicePlatform,
)

logger = logging.getLogger(__name__)

__all__ = [
    "AppLaunchResult",
    "ArtemisContext",
    "DeviceClientAccessors",
    "DeviceContext",
    "DevicePlatform",
]


class ArtemisContext(DeviceClientAccessors, BaseModel):
    """Per-device runtime state for the headless device action surface."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="allow",
    )

    device: DeviceContext
    adb_client: Any | None = None
    ui_adb_client: Any | None = None
    package_cache: dict[str, str | None] = Field(default_factory=dict)

    #: Device actuator (``artemis.mcp.actuators.adb.AdbActuator``) and its
    #: in-process action session; typed ``Any`` to keep this module free of an
    #: import cycle with the ``mcp`` package. Created lazily and cached here.
    actuator: Any | None = None
    action_session: Any | None = None

    #: Lazily-created unified controller, cached per context.
    _mobile_controller: Any = PrivateAttr(default=None)
    #: Active device driver (real ADB or mock), cached per context.
    _active_driver: Any = PrivateAttr(default=None)
