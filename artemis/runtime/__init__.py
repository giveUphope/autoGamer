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

"""Device runtime: device locks, adb endpoints, device pool, awake service.

The task daemon, web-server lifecycle, process supervisor and trace store
shipped with the smart stack and web console; they now live in the DSH host
and have been removed.
"""

from artemis.runtime.device_lock import (
    ConcurrencyMode,
    DeviceBusyError,
    DeviceExecutionLock,
)
from artemis.runtime.adb_endpoint import (
    ADB_ENDPOINT_ID_ENV,
    AdbEndpoint,
    AdbSession,
    AdbTarget,
    InvalidAdbEndpoint,
    current_adb_endpoint,
)
from artemis.runtime.device_pool import DevicePool, DeviceStatus, device_pool
from artemis.runtime.process_probe import pid_is_alive
from artemis.runtime.awake_service import (
    ensure_device_awake,
    sanitize_device_state,
    screen_awake_service,
    shutdown_awake_service,
    start_awake_service,
)

__all__ = [
    "ADB_ENDPOINT_ID_ENV",
    "AdbEndpoint",
    "AdbSession",
    "AdbTarget",
    "ConcurrencyMode",
    "DeviceBusyError",
    "DeviceExecutionLock",
    "DevicePool",
    "DeviceStatus",
    "InvalidAdbEndpoint",
    "current_adb_endpoint",
    "device_pool",
    "ensure_device_awake",
    "pid_is_alive",
    "sanitize_device_state",
    "screen_awake_service",
    "shutdown_awake_service",
    "start_awake_service",
]
