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

"""Device-facing MCP server command (``artemis mcp``), contracted for D18.

Only the device MCP servers remain:

- ``adb``  -- the raw device-action tool surface over a real ADB device;
- ``mock`` -- the same tool surface over an in-memory device (no adb, no hardware);
- ``xml``  -- fuzzy XML / history search over a recorded trace store.

The LLM-driven ``agent`` server and the IDE ``--install`` / ``--generate-config``
rule injection now live in the DSH host and have been removed.
"""

import threading
from typing import Annotated

import typer

from artemis.mcp.adb_server import mcp as adb_mcp
from artemis.runtime import shutdown_awake_service, start_awake_service
from third_party.mobile_use.utils.logger import get_logger

logger = get_logger(__name__)


def mcp_command(
    server_type: Annotated[
        str,
        typer.Option(
            "--type",
            "-t",
            help=(
                "Device MCP server to start: 'adb' (default, raw adb), 'mock' (the adb "
                "tool surface over an in-memory device, no adb and no hardware), "
                "'xml' (xml fuzzy search over a trace store)."
            ),
        ),
    ] = "adb",
    transport: Annotated[
        str,
        typer.Option(
            "--transport",
            help="MCP transport protocol ('stdio' or 'sse').",
        ),
    ] = "stdio",
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help="Host address when running with SSE transport.",
        ),
    ] = "127.0.0.1",
    port: Annotated[
        int,
        typer.Option(
            "--port",
            "-p",
            help="Port number when running with SSE transport.",
        ),
    ] = 8001,
) -> None:
    """Launch a device-facing ARTEMIS Model Context Protocol (MCP) server."""
    threading.Thread(target=start_awake_service, daemon=True, name="artemis-awake-init").start()
    try:
        st = server_type.lower()
        if st == "adb":
            if transport.lower() == "sse":
                logger.info(f"Starting Artemis ADB MCP Server over {transport}...")
                adb_mcp.run(transport="sse", host=host, port=port)
            else:
                # stdio carries the MCP JSON-RPC stream: redirect logging and detach
                # from the parent before any output can corrupt it.
                from artemis.mcp.adb_server import configure_stdio_mode

                configure_stdio_mode()
                logger.info("Starting Artemis ADB MCP Server over stdio...")
                adb_mcp.run(transport="stdio")
        elif st == "mock":
            from artemis.mcp.mock_server import seed_mock_controllers

            # Same FastMCP object and the same tool set as 'adb'; only the device is
            # in-memory, so contract tests exercise the py implementation, not a stub.
            seed_mock_controllers()
            if transport.lower() == "sse":
                logger.info(f"Starting Artemis MOCK (device-free) MCP Server over {transport}...")
                adb_mcp.run(transport="sse", host=host, port=port)
            else:
                from artemis.mcp.adb_server import configure_stdio_mode

                configure_stdio_mode()
                logger.info("Starting Artemis MOCK (device-free) MCP Server over stdio...")
                adb_mcp.run(transport="stdio")
        elif st == "xml":
            from artemis.mcp.xml_search_server import mcp as xml_mcp

            logger.info(f"Starting Artemis XML Fuzzy Search MCP Server over {transport}...")
            if transport.lower() == "sse":
                xml_mcp.run(transport="sse", host=host, port=port)
            else:
                xml_mcp.run(transport="stdio")
        else:
            logger.error(
                f"Unsupported MCP server type: {server_type}. Use 'adb', 'mock', or 'xml'."
            )
            raise typer.Exit(1)
    finally:
        shutdown_awake_service()
