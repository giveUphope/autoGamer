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

"""ARTEMIS device-action core for the DSH plugin (contracted, D18).

The smart agent stack (the ``Agent``/``Builders`` SDK, the ``artemis_client``
task client and the LLM-facing interfaces) now lives in the DSH host. Importing
:mod:`artemis` only re-exports the device driver base; the device-action MCP
servers and drivers are imported directly by module path.

G72 route 4: the mcp_server provider subtree is back on this branch as an
external provider process, and ``third_party.mobile_use.main`` imports
``Agent``/``Builders`` from this namespace. They resolve through the module
``__getattr__`` below, which pulls :mod:`artemis.sdk` lazily — importing
``artemis`` alone still does not drag in the LLM stack.
"""

from artemis._version import __version__
from artemis.drivers.base import BaseDeviceDriver

__all__ = [
    "__version__",
    "BaseDeviceDriver",
]


def __getattr__(name: str):  # noqa: D103 - PEP 562 lazy provider surface (G72)
    if name == "Agent":
        from artemis.sdk import Agent

        return Agent
    if name == "Builders":
        from artemis.sdk.builders import Builders

        return Builders
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
