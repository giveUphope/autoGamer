/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type ProbeStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export type ProbeCategory = 'device' | 'auth' | 'toolchain' | 'runtime';

export interface ProbeAction {
  action_type: 'command' | 'hint' | 'link';
  label: string;
  payload: string;
}

export interface DeviceInfo {
  serial: string;
  state: string;
  model: string | null;
  product: string | null;
  android_version: string | null;
  screen_resolution: string | null;
  is_locked: boolean | null;
  is_emulator: boolean;
  installed_packages?: string[];
}

export interface AdbServerEndpoint {
  host: string;
  port: number;
  socket: string;
  identity: string;
  mode: 'local' | 'remote';
  is_local_default: boolean;
}

export interface AdbServerDevice {
  serial: string;
  state: string;
  model: string | null;
  product: string | null;
}

export interface AdbServerStatus {
  endpoint: AdbServerEndpoint;
}

export interface AdbServerConnectionResult {
  success: boolean;
  message: string;
  endpoint: AdbServerEndpoint;
  devices: AdbServerDevice[];
  persisted?: boolean;
  persistence_error?: string | null;
  error_code?: string;
  output?: string;
}

export interface AdbServerConnectionResponse {
  connection_result: AdbServerConnectionResult;
  report?: SystemReadinessReport;
}

export interface ProbeResult {
  id: string;
  category: ProbeCategory;
  title: string;
  status: ProbeStatus;
  is_blocker: boolean;
  summary: string;
  description: string;
  metadata: Record<string, any>;
  actions: ProbeAction[];
}

export interface SystemReadinessReport {
  overall_ready: boolean;
  blocker_count: number;
  passed_blocker_count: number;
  probes: ProbeResult[];
  active_device: DeviceInfo | null;
  os_type?: 'linux' | 'darwin' | 'windows' | string;
  timestamp: number;
}

export type EmulatorLaunchStage =
  | 'idle'
  | 'starting'
  | 'waiting_for_adb'
  | 'booting'
  | 'ready'
  | 'failed'
  | 'stopped';

export interface EmulatorLaunchState {
  avd_name: string | null;
  status: EmulatorLaunchStage;
  pid: number | null;
  serial: string | null;
  stage_message: string;
  progress_percent: number;
  started_at: number | null;
  elapsed_seconds: number;
  error: string | null;
  logs: string[];
  can_retry: boolean;
}

/**
 * model-config-env 响应：artemis.jsonc 配置与 .env 凭据状态
 * （自 Angular system.service.ts L581-609 原样平移）。
 */
export interface ModelConfigEnvResponse {
  config_path: string;
  config_filename: string;
  config_content: string;
  default_model: {
    provider?: string;
    model?: string;
    api_base?: string;
    thinking_level?: string;
    fallback?: {
      provider?: string;
      model?: string;
      thinking_level?: string;
    };
  };
  presets: Record<string, {
    provider: string;
    model: string;
    fallback?: { provider: string; model: string };
  }>;
  env_path: string;
  env_filename: string;
  env_vars: Array<{
    name: string;
    provider: string;
    is_set: boolean;
    preview: string | null;
    description: string;
  }>;
}

/** 端点表单提交负载：仅携带用户填写（非空）的字段，密钥单独传递不落 artemis.jsonc。 */
export interface ModelConfigUpdatePayload {
  provider?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  thinking_level?: string;
}

/** POST /api/system/model-config 响应（仅消费 message 与 default_model 摘要）。 */
export interface ModelConfigUpdateResult {
  status?: string;
  message?: string;
  provider?: string | null;
  default_model?: ModelConfigEnvResponse['default_model'];
}

/** 用户自定义凭据条目：环境变量名 → 提供商（值仅回显掩码，原文不出后端）。 */
export interface CredentialEntry {
  name: string;
  provider: string;
  is_set: boolean;
  preview: string | null;
}

/** GET /api/system/credentials/entries 响应。 */
export interface CredentialEntriesResponse {
  entries: CredentialEntry[];
  bindings_path: string;
}

/** 新增/更新凭据条目负载；value 留空表示仅改绑定、保留现值。 */
export interface CredentialEntryPayload {
  name: string;
  provider: string;
  value?: string;
}
