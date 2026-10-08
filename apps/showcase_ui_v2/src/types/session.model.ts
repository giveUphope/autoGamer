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

export interface ModelInfo {
  name: string;
  id: string;
  provider: string;
  architecture?: string;
  /**
   * 端点库记录名。会话把模型 pin 到某条记录时后端才带这个字段，
   * 未 pin（跟随全局默认）时不下发。记录被删除后仍带名字、id 为空——
   * 「不知道型号」比拿今天的全局默认冒充历史真相诚实。
   */
  endpoint?: string;
}

export interface TaskQueueItem {
  session_id: string;
  goal: string;
  profile?: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  created_at?: number;
  start_time?: number;
  device_serial?: string | null;
  device_id?: string | null;
  model_endpoint?: string | null;
  /** 提交时指派的对话线程 id（pending/running 表示据此并入正确会话线程）。 */
  conversation_id?: string | null;
}

export interface Session {
  session_id: string;
  initial_goal: string;
  start_time: number;
  end_time?: number;
  status?: string;
  video_url?: string;
  recording_status?: 'recording' | 'finalizing' | 'processing' | 'ready' | 'failed' | 'unavailable';
  model_info?: ModelInfo;
  /** 本次运行 pin 的端点库记录名；null/缺失表示跟随提交时的全局默认。 */
  model_endpoint?: string | null;
  device_serial?: string | null;
  device_id?: string | null;
  device_info?: any;
  /** 所属对话线程（提交时带 conversation_id 的任务才有）；会话列表按它聚合。 */
  conversation_id?: string | null;
  /** 提交（入队）时刻。轮次排序/展示用它：start_time 是获得设备使用权后的
   * 引擎启动时刻，会让排队轮次在发射时乱序。旧数据为空则回退 start_time。 */
  submitted_at?: number | null;
}

/** 单段屏幕录像：scrcpy 重启（转屏 / 崩溃恢复）时录像切分为多段（M4，平移自 agent.service.ts L30-40）。 */
export interface VideoSegment {
  url: string;
  /** Back-to-back playlist timeline start (seconds); gaps between segments are not represented. */
  start: number;
  duration: number;
  width: number;
  height: number;
  /** Session-relative first-frame offset in milliseconds (manifest v2). */
  offset_ms?: number;
  duration_ms?: number;
}

/** 视频播放器回放状态（M4，平移自 agent.service.ts L42-48 的 RecordingPlaybackStatus）。 */
export type RecordingPlaybackStatus =
  | 'idle'
  | 'live'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'unavailable';

/** `GET /api/sessions/{id}/video` 的响应契约（后端 apps/admin_console/routers/media.py L110-176）。 */
export interface SessionVideoResponse {
  session_id: string;
  status?: 'processing' | 'ready' | 'failed' | 'unavailable';
  has_video: boolean;
  video_url: string | null;
  video_segments?: VideoSegment[];
  retry_after_ms?: number;
  message?: string;
}

export interface AgentStatusResponse {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'offline';
  session_id?: string | null;
  goal?: string | null;
  pid?: number | null;
  queue?: (TaskQueueItem | string)[];
  background_tasks?: any[];
  model_info?: ModelInfo | null;
  paused_error?: string | null;
}

/** Per-run Pro tuning persisted with the session (`device_info.run_tuning`). */
export interface SessionRunTuning {
  verification_level?: string | null;
  explorer_mode?: string | null;
}

/** `GET /api/sessions/{id}/usage`: session-wide LLM usage and the live executor context. */
export interface SessionUsage {
  session_id: string;
  llm_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  /** Prompt size of the latest Operator / Flash runner call; null before the first call. */
  operator_context_tokens: number | null;
  operator_context_window_tokens: number;
  operator_context_updated_at?: number | null;
  profile?: string | null;
  run_tuning?: SessionRunTuning | null;
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'offline' | string;

export type TaskStatus = 'running' | 'paused' | 'completed' | 'pending' | 'failed' | 'cancelled';

