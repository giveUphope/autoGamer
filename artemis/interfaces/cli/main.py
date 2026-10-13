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

"""ARTEMIS Command Line Interface (CLI), contracted to the device surface (D18).

Only the device-facing commands remain: ``mcp`` (device MCP servers),
``doctor`` (device/ADB/toolchain readiness) and ``helper`` (Accessibility
Helper APK management). The autonomous ``run``/``batch`` agent, the API-key
``init`` wizard, the web ``ui``/server lifecycle and trace/cloud commands now
live in the DSH host or have been removed.
"""

from typing import Annotated

from artemis._version import __version__
from artemis.interfaces.cli.commands.doctor import doctor_command
from artemis.interfaces.cli.commands.helper import helper_app
from artemis.interfaces.cli.commands.mcp import mcp_command
from rich.console import Console
from rich.panel import Panel
import typer

app = typer.Typer(
    name="artemis",
    help="ARTEMIS device-action core (DSH plugin).",
    add_completion=False,
    pretty_exceptions_enable=False,
    no_args_is_help=True,
)

# Register subcommands
app.command(name="doctor", help="Check device, ADB and toolchain readiness.")(doctor_command)
app.command(name="mcp", help="Start a device-facing Model Context Protocol (MCP) server.")(
    mcp_command
)
app.add_typer(
    helper_app, name="helper", help="Manage the Accessibility Helper APK on attached devices."
)


def version_callback(value: bool):
    if value:
        console = Console()
        console.print(
            Panel(
                f"[bold cyan]ARTEMIS device-action core[/bold cyan] v{__version__}",
                title="ARTEMIS",
                expand=False,
            )
        )
        raise typer.Exit()


@app.callback()
def main_callback(
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            "-v",
            help="Show Artemis version and exit.",
            callback=version_callback,
            is_eager=True,
        ),
    ] = False,
):
    """ARTEMIS device-action CLI."""
    pass


def cli():
    """Main CLI entrypoint."""
    app()


if __name__ == "__main__":
    cli()
