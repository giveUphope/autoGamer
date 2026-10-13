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

"""Device-side configuration: settings, paths, runtime IPC and constants.

The LLM/agent configuration (``config.llm``, ``config.agent``) and the output
event writer were removed with the smart stack (D18): the DSH host owns LLM
configuration, so importing this package must not pull in the LLM package.
G72 route 4 note: the mcp_server provider subtree (restored from main) needs a
slice of the agent config surface back. Those names resolve through the module
``__getattr__`` below, which imports ``config.agent`` lazily — the action face
keeps importing this package without pulling the LLM stack.
"""


def __getattr__(name: str):  # noqa: D103 - PEP 562 lazy provider surface (G72)
    _AGENT_SURFACE = {
        "checker_overrides_for_level",
        "CheckerConfig",
        "ExplorerConfig",
        "ExplorerVersion",
        "FlashProfileConfig",
        "MemoryRuntimeConfig",
        "MemoryTranscriptConfig",
        "OutputterConfig",
        "ProProfileConfig",
        "StepSummarizerConfig",
        "VideoAnalyzerConfig",
        "load_agent_config",
        "resolve_explorer_version",
        "run_tuning_for_profile",
    }
    _LLM_SURFACE = {
        "AgentNodeWithFallback",
        "CyFunctionDetector",
        "LLM",
        "LLMConfig",
        "LLMUtilsNode",
        "LLMUtilsNodeWithFallback",
        "LLMWithFallback",
        "deep_merge_llm_config",
        "get_default_llm_config",
        "initialize_llm_config",
        "load_llm_config_override",
        "parse_llm_config",
        "validate_vertex_ai_credentials",
    }
    if name in _AGENT_SURFACE:
        from artemis.config import agent

        return getattr(agent, name)
    if name in _LLM_SURFACE:
        from artemis.config import llm

        return getattr(llm, name)
    if name in ("OutputConfig", "record_events", "prepare_output_files"):
        from third_party.mobile_use.config import output as _output

        return getattr(_output, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


from artemis.config.constants import (
    AGENT_CONFIG_FILENAME,
    DATA_ENGINE_DB_FILENAME,
    DEFAULT_ACTION_TIMEOUT,
    DEFAULT_ADB_HOST,
    DEFAULT_ADB_PORT,
    DEFAULT_EDGE_MONITOR_PORT,
    DEFAULT_EXPLORER_VERSION,
    DEFAULT_GATEWAY_PORT,
    DEFAULT_MODEL,
    DEFAULT_PROFILE,
    DEFAULT_STREAM_PING_INTERVAL,
    DOTENV_FILENAME,
    ENV_ADB_DEVICE_SERIAL,
    ENV_ADB_HOST,
    ENV_ADB_PORT,
    ENV_ADB_SERVER_SOCKET,
    ENV_ANTHROPIC_API_KEY,
    ENV_ANTIGRAVITY_APP_DIR,
    ENV_ANTIGRAVITY_LS_ADDRESS,
    ENV_DATA_ENGINE_DB_PATH,
    ENV_EVENTS_OUTPUT_PATH,
    ENV_GCP_API_KEY,
    ENV_GEMINI_API_KEY,
    ENV_GOOGLE_API_KEY,
    ENV_KEEP_VIDEOS,
    ENV_ARTEMIS_APP_DIR,
    ENV_ARTEMIS_CLOUD_GATEWAY_URL,
    ENV_ARTEMIS_CLOUD_MODE,
    ENV_ARTEMIS_CLOUD_SESSION_ID,
    ENV_ARTEMIS_DEBUG,
    ENV_ARTEMIS_DEFAULT_MODEL,
    ENV_ARTEMIS_DEFAULT_PROFILE,
    ENV_ARTEMIS_DEVICE_ID,
    ENV_ARTEMIS_EDGE_PORT,
    ENV_ARTEMIS_IPC_PORT,
    ENV_ARTEMIS_MCP_SERVER,
    ENV_ARTEMIS_TENANT_ID,
    ENV_ARTEMIS_TENANT_TOKEN,
    ENV_ARTEMIS_TRACES_DIR,
    ENV_ARTEMIS_USE_FILE_API,
    ENV_ARTEMIS_USE_USER_DIR,
    ENV_OPEN_ROUTER_API_KEY,
    ENV_OPENAI_API_KEY,
    ENV_OPENAI_BASE_URL,
    ENV_RESULTS_OUTPUT_PATH,
    ENV_XAI_API_KEY,
    IPC_PORT_FILENAME,
    LLM_CONFIG_FILENAME,
    LLM_CONFIG_OVERRIDE_FILENAME,
    LS_ADDRESS_FILENAME,
    AgentNode,
    ExplorerVersion,
    LLMProvider,
    LLMUtilsNode,
)
from artemis.config.paths import (
    CONFIG_DIR,
    DB_PATH,
    GLOBAL_APP_DIR,
    GLOBAL_JETSKI_DIR,
    IMAGES_DIR,
    PAUSE_FILE,
    REPLAY_BASE_DIR,
    ROOT_DIR,
    TEST_DATA_DIR,
    TEST_OUTPUTS_DIR,
    TRACES_PATH,
    WORKSPACE_ROOT,
    get_app_dir,
    get_config_path,
    get_data_engine_db_path,
    get_default_traces_path,
    get_env_file,
    get_images_dir,
    get_ipc_port_file,
    get_ls_address_file,
    get_pause_file,
    get_replay_dir,
    get_temp_dir,
    get_test_data_dir,
    get_test_outputs_dir,
    get_traces_dir,
    is_frozen_bundle,
    is_source_checkout,
)
from artemis.config.runtime import (
    cleanup_temp_dir,
    clear_ipc_port,
    clear_ls_address,
    init_ls_address,
    read_ipc_port,
    read_ls_address,
    write_ipc_port,
    write_ls_address,
)
from artemis.config.settings import (
    Settings,
    settings,
)

__all__ = [
    # Settings & Singleton
    "Settings",
    "settings",
    # Paths & Dirs
    "ROOT_DIR",
    "WORKSPACE_ROOT",
    "CONFIG_DIR",
    "GLOBAL_APP_DIR",
    "GLOBAL_JETSKI_DIR",
    "TRACES_PATH",
    "DB_PATH",
    "PAUSE_FILE",
    "REPLAY_BASE_DIR",
    "TEST_DATA_DIR",
    "TEST_OUTPUTS_DIR",
    "IMAGES_DIR",
    "get_app_dir",
    "get_traces_dir",
    "get_default_traces_path",
    "get_env_file",
    "get_temp_dir",
    "get_config_path",
    "get_data_engine_db_path",
    "get_pause_file",
    "is_source_checkout",
    "get_replay_dir",
    "get_test_data_dir",
    "get_test_outputs_dir",
    "get_images_dir",
    "get_ipc_port_file",
    "get_ls_address_file",
    "is_frozen_bundle",
    # Runtime & IPC State
    "read_ipc_port",
    "write_ipc_port",
    "clear_ipc_port",
    "read_ls_address",
    "write_ls_address",
    "clear_ls_address",
    "init_ls_address",
    "cleanup_temp_dir",
    # Types & Literals
    "LLMProvider",
    "ExplorerVersion",
    "LLMUtilsNode",
    "AgentNode",
    # Filenames
    "LLM_CONFIG_FILENAME",
    "LLM_CONFIG_OVERRIDE_FILENAME",
    "AGENT_CONFIG_FILENAME",
    "DATA_ENGINE_DB_FILENAME",
    "IPC_PORT_FILENAME",
    "LS_ADDRESS_FILENAME",
    "DOTENV_FILENAME",
    # Defaults
    "DEFAULT_ADB_HOST",
    "DEFAULT_ADB_PORT",
    "DEFAULT_GATEWAY_PORT",
    "DEFAULT_EDGE_MONITOR_PORT",
    "DEFAULT_ACTION_TIMEOUT",
    "DEFAULT_STREAM_PING_INTERVAL",
    "DEFAULT_PROFILE",
    "DEFAULT_MODEL",
    "DEFAULT_EXPLORER_VERSION",
    # Environment Variables
    "ENV_ARTEMIS_APP_DIR",
    "ENV_ANTIGRAVITY_APP_DIR",
    "ENV_ARTEMIS_USE_USER_DIR",
    "ENV_ARTEMIS_TRACES_DIR",
    "ENV_DATA_ENGINE_DB_PATH",
    "ENV_ARTEMIS_CLOUD_MODE",
    "ENV_ARTEMIS_CLOUD_SESSION_ID",
    "ENV_ARTEMIS_CLOUD_GATEWAY_URL",
    "ENV_ARTEMIS_TENANT_ID",
    "ENV_ARTEMIS_TENANT_TOKEN",
    "ENV_ARTEMIS_EDGE_PORT",
    "ENV_ARTEMIS_IPC_PORT",
    "ENV_ANTIGRAVITY_LS_ADDRESS",
    "ENV_ARTEMIS_MCP_SERVER",
    "ENV_ADB_DEVICE_SERIAL",
    "ENV_ARTEMIS_DEVICE_ID",
    "ENV_ADB_HOST",
    "ENV_ADB_PORT",
    "ENV_ADB_SERVER_SOCKET",
    "ENV_GOOGLE_API_KEY",
    "ENV_GEMINI_API_KEY",
    "ENV_GCP_API_KEY",
    "ENV_OPENAI_API_KEY",
    "ENV_OPENAI_BASE_URL",
    "ENV_ANTHROPIC_API_KEY",
    "ENV_OPEN_ROUTER_API_KEY",
    "ENV_XAI_API_KEY",
    "ENV_ARTEMIS_EXPLORER_VERSION",
    "ENV_ARTEMIS_DEFAULT_PROFILE",
    "ENV_ARTEMIS_DEFAULT_MODEL",
    "ENV_ARTEMIS_USE_FILE_API",
    "ENV_KEEP_VIDEOS",
    "ENV_ARTEMIS_DEBUG",
    "ENV_EVENTS_OUTPUT_PATH",
    "ENV_RESULTS_OUTPUT_PATH",
]
