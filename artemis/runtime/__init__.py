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

# Task-daemon surface restored for the mcp_server provider (G72 route 4: the
# provider subtree came back from main onto this branch). The DSH host replaced
# the daemon in the plugin world, but the provider's task face imports these
# names unconditionally at module level, so they must resolve.
from artemis.runtime.daemon_client import (  # noqa: E402
    ensure_daemon_running,
    get_daemon_session,
    get_daemon_status,
    is_artemis_daemon,
    is_daemon_running,
    stop_task_on_daemon,
    submit_batch_to_daemon,
    submit_task_to_daemon,
    wait_for_daemon_task,
)
from artemis.runtime.supervisor import ProcessSupervisor, process_supervisor  # noqa: E402

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
    "ProcessSupervisor",
    "current_adb_endpoint",
    "device_pool",
    "ensure_daemon_running",
    "ensure_device_awake",
    "get_daemon_session",
    "get_daemon_status",
    "is_artemis_daemon",
    "is_daemon_running",
    "pid_is_alive",
    "process_supervisor",
    "sanitize_device_state",
    "screen_awake_service",
    "shutdown_awake_service",
    "start_awake_service",
    "stop_task_on_daemon",
    "submit_batch_to_daemon",
    "submit_task_to_daemon",
    "wait_for_daemon_task",
]
