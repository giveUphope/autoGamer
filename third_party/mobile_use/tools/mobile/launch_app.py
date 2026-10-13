# Copyright 2025-2026 Minitap, Inc.
# Modifications Copyright 2026 Google LLC
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
#
# Originally from mobile-use (https://github.com/minitap-ai/mobile-use).
# See third_party/mobile_use/METADATA for the upstream source and local modifications.

"""Resolve an application name to an installed package (deterministic).

Natural-language app-name resolution previously ran through an LLM "Hopper"
subagent. Under the DSH plugin split (decision D18) the LLM lives in the host, so
the device surface only resolves a concrete package id (an exact installed
match) and caches it; fuzzy/natural-language matching is the host's job before it
calls the device action.
"""

from artemis.context import ArtemisContext
from third_party.mobile_use.controllers.platform_specific_commands_controller import (
    list_packages_async,
)
from third_party.mobile_use.utils.logger import get_logger

logger = get_logger(__name__)


LAUNCH_APP_DOCSTRING = (
    "[ACTION] Finds and launches an application on the device using its package name."
)


async def find_package(ctx: ArtemisContext, app_name: str, use_fallback: bool = True) -> str | None:
    """Return the package id when ``app_name`` is installed, else None.

    Results are cached on ``ctx.package_cache``. The ``use_fallback`` argument is
    retained for signature compatibility with the old Hopper-based call; it no
    longer triggers LLM resolution (the host resolves natural-language names).
    """
    package_cache = getattr(ctx, "package_cache", None)
    if package_cache is None or not isinstance(package_cache, dict):
        try:
            ctx.package_cache = {}
            package_cache = ctx.package_cache
        except Exception:  # pylint: disable=broad-exception-caught
            package_cache = {}

    if isinstance(package_cache, dict) and app_name in package_cache:
        logger.info(f"Cache hit for app '{app_name}': {package_cache[app_name]}")
        return package_cache[app_name]

    try:
        all_packages = await list_packages_async(ctx=ctx)
        package_set = {p.strip() for p in all_packages.split("\n") if p.strip()}

        # Deterministic path: accept the name only when it is physically installed.
        if app_name in package_set:
            if isinstance(package_cache, dict):
                package_cache[app_name] = app_name
            return app_name

        # Not an installed package id. Natural-language resolution is the host
        # LLM's responsibility (D18), so the device surface reports "not found"
        # rather than guessing with an on-device model.
        if isinstance(package_cache, dict):
            package_cache[app_name] = None
        return None
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.error(f"Failed to find package for '{app_name}': {e}")
        return None
