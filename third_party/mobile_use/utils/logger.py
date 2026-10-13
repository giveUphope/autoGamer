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

from enum import Enum
import logging
import os
from pathlib import Path
import sys

from colorama import Fore, Style, init

init(autoreset=True)


class LogLevel(Enum):
    DEBUG = ("DEBUG", Fore.MAGENTA, "🔍")
    INFO = ("INFO", Fore.WHITE, "ℹ")
    SUCCESS = ("SUCCESS", Fore.GREEN, "✓")
    WARNING = ("WARNING", Fore.YELLOW, "⚠")
    ERROR = ("ERROR", Fore.RED, "❌")
    CRITICAL = ("CRITICAL", Fore.RED + Style.BRIGHT, "💥")


class ArtemisLogger:
    def __init__(
        self,
        name: str,
        console_level: str = "INFO",
    ):
        """Initialize the ARTEMIS logger.

        Args:
            name: Logger name (usually __name__)
            console_level: Minimum level for console output
        """
        self.name = name
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)

        self.logger.handlers.clear()
        self.logger.propagate = False

        self._setup_console_handler(console_level)

        formatter = logging.Formatter(fmt="%(asctime)s | %(name)s | %(levelname)s | %(message)s")

        if os.environ.get("ARTEMIS_MCP_SERVER") == "true":
            traces_dir = os.environ.get("ARTEMIS_TRACES_PATH", "traces")
            log_path = Path(traces_dir) / "mcp_server.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_path, encoding="utf-8")
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)

    def _setup_console_handler(self, level: str):
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(getattr(logging, level.upper()))

        console_formatter = ColoredFormatter()
        console_handler.setFormatter(console_formatter)

        self.logger.addHandler(console_handler)

    def debug(self, message: str, **kwargs):
        self.logger.debug(message, extra={"log_level": LogLevel.DEBUG}, **kwargs)

    def info(self, message: str, **kwargs):
        self.logger.info(message, extra={"log_level": LogLevel.INFO}, **kwargs)

    def success(self, message: str, **kwargs):
        self.logger.info(message, extra={"log_level": LogLevel.SUCCESS}, **kwargs)

    def warning(self, message: str, **kwargs):
        self.logger.warning(message, extra={"log_level": LogLevel.WARNING}, **kwargs)

    def error(self, message: str, **kwargs):
        self.logger.error(message, extra={"log_level": LogLevel.ERROR}, **kwargs)

    def critical(self, message: str, **kwargs):
        self.logger.critical(message, extra={"log_level": LogLevel.CRITICAL}, **kwargs)

    def header(self, message: str, **_kwargs):
        separator = "=" * 60
        colored_separator = f"{Fore.CYAN}{separator}{Style.RESET_ALL}"
        colored_message = f"{Fore.CYAN}{message}{Style.RESET_ALL}"

        print(colored_separator, file=sys.stderr)
        print(colored_message, file=sys.stderr)
        print(colored_separator, file=sys.stderr)
        self.logger.info(f"\n{separator}\n{message}\n{separator}")


class ColoredFormatter(logging.Formatter):
    def format(self, record):
        log_level = getattr(record, "log_level", LogLevel.INFO)
        _level_name, color, symbol = log_level.value

        colored_message = f"{color}{symbol} {record.getMessage()}{Style.RESET_ALL}"

        return colored_message


_loggers = {}


def get_logger(
    name: str,
    console_level: str = "INFO",
) -> ArtemisLogger:
    """Get or create a logger instance.

    Args:
        name: Logger name (usually __name__)
        log_file: Path to log file (defaults to logs/{name}.log)
        console_level: Minimum level for console output
        file_level: Minimum level for file output
        enable_file_logging: Whether to enable file logging

    Returns:
        ArtemisLogger instance
    """
    if name not in _loggers:
        _loggers[name] = ArtemisLogger(
            name=name,
            console_level=console_level,
        )

    return _loggers[name]
