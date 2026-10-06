/**
 * 视频回放状态机 —— M4 自 Angular `AgentService` 的视频相关信号与方法平移
 * （agent.service.ts L236-278 / L1776-2011），保持全部时序语义：
 *
 * - generation 守卫：每次 open/close/finalization/refresh 递增，过期响应不落库；
 * - /api/sessions/{id}/video 轮询四态（ready / processing / failed / unavailable），
 *   processing 按 retry_after_ms 重试并钳制到 500~3000ms，累计等待超 120s 判超时；
 * - live 分支：running / paused 会话直接进入 MJPEG 投屏态，不做录像轮询；
 * - ready 时同步 session store 的 rawSessions（video_url / recording_status='ready'，
 *   Angular L1892-1896）。
 *
 * 与 Angular 的有意偏差：
 * - `recordingPlaybackMessage` 只存后端透传 message（res.message；recording_failed
 *   的 error 由 stream store 传入）。固定提示文案（Loading / Finalizing / 超时 /
 *   HTTP 错误兜底）不放 store，由 UI 按 status 走 i18n。
 * - Angular 的 `stepLogsForReplay` computed 使用自定义 equal 在「步进日志长度 +
 *   逐元素引用不变」时短路下游帧提取；Vue computed 无 equal 选项，这里用等价实现：
 *   先算步进日志数组，其长度与引用均未变化时复用上一次帧数组（同一引用），
 *   Vue 的 computed 仅在值变化时向下游传播，语义一致。
 * - Angular 的 activeVideoSessionId 为 service 私有字段；Vue 版额外导出
 *   `isVideoSession()` 判定方法供 stream / session store 接线比较（不暴露可变本体）。
 *
 * 定时器与世代计数器为本 store 实例内普通 let 变量（非响应式，随 Pinia 实例
 * 生命周期存在，保证测试隔离）；播放器按需打开、无全局轮询，故无 start/stop。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { apiGet } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useTimelineStore, type SessionLog } from '@/stores/timeline';
import { extractStepReplayFrames } from '@/utils/action-formatter';
import type {
  RecordingPlaybackStatus,
  SessionVideoResponse,
  VideoSegment,
} from '@/types/session.model';
import type { StepReplayFrame } from '@/types/stream.model';

export const usePlayerStore = defineStore('player', () => {
  const sessionStore = useSessionStore();
  const timelineStore = useTimelineStore();

  // ---- 响应式状态（对应 Angular 同名 signals，agent.service.ts L237-248）----
  const isVideoWindowOpen = ref<boolean>(false);
  const isVideoMinimized = ref<boolean>(false);
  const activeVideoUrl = ref<string | null>(null);
  const activeVideoSegments = ref<VideoSegment[]>([]);
  const activeVideoTitle = ref<string>('');
  const isVideoLoading = ref<boolean>(false);
  const recordingPlaybackStatus = ref<RecordingPlaybackStatus>('idle');
  /** 只存后端透传 message；固定提示文案由 UI 按 status 走 i18n（有意偏差，见文件头）。 */
  const recordingPlaybackMessage = ref<string>('');
  const shouldAutoplayVideo = ref<boolean>(false);
  const videoSeekRequest = ref<{ seconds: number; requestId: number } | null>(null);
  const stepSeekRequest = ref<{ index: number; requestId: number } | null>(null);
  const playerMode = ref<'video' | 'steps'>('video');

  // ---- 非响应式内部状态（对应 Angular service 私有字段，L250-255）----
  let activeVideoSessionId: string | null = null;
  let videoSeekRequestId = 0;
  let stepSeekRequestId = 0;
  let videoRequestGeneration = 0;
  let videoRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let videoWaitStartedAt = 0;

  // ---- 步帧提取（平移自 stepLogsForReplay + currentSessionStepFrames，L257-278）----

  /** 上一次的步进日志数组与帧结果：引用/长度不变时复用帧数组（LLM 流更新不触发重提取）。 */
  let lastStepLogs: SessionLog[] | null = null;
  let lastFrames: StepReplayFrame[] = [];

  /**
   * Computed step replay frames from current session logs.
   * 流式文本 chunk 无法改变回放帧：步进日志数组长度与逐元素引用不变时，
   * 直接复用上次帧数组（等价于 Angular stepLogsForReplay 的自定义 equal 短路）。
   */
  const currentSessionStepFrames = computed<StepReplayFrame[]>(() => {
    const stepLogs = timelineStore.sessionLogs.filter(
      (log) => log && (log.type === 'step_updated' || log.type === 'step_recorded'),
    );
    if (
      lastStepLogs
      && lastStepLogs.length === stepLogs.length
      && lastStepLogs.every((log, i) => log === stepLogs[i])
    ) {
      return lastFrames;
    }
    lastStepLogs = stepLogs;
    lastFrames = extractStepReplayFrames(stepLogs);
    return lastFrames;
  });

  const hasCurrentSessionStepFrames = computed<boolean>(() => currentSessionStepFrames.value.length > 0);

  // ---- 当前会话的录像视图（平移自 L347-360）----

  const currentSessionVideoUrl = computed<string | null>(() => {
    const curId = sessionStore.currentSessionId;
    if (!curId) return null;
    const session = sessionStore.sessions.find((s) => s.session_id === curId);
    return session?.video_url || null;
  });

  const currentSessionRecordingStatus = computed<RecordingPlaybackStatus | undefined>(() => {
    const status = sessionStore.currentSession?.recording_status;
    return status === 'recording' || status === 'finalizing' || status === 'processing'
      ? 'processing'
      : status;
  });

  // ---- 打开 / 关闭（平移自 openVideoPlayer L1776-1830、close/toggle L1995-2011）----

  function openVideoPlayer(
    sessionId?: string,
    videoUrl?: string,
    title?: string,
    seekSeconds?: number,
    stepIndex?: number,
  ): void {
    const targetSessionId = sessionId || sessionStore.currentSessionId || undefined;
    const session = sessionStore.sessions.find((s) => s.session_id === targetSessionId);
    const targetUrl = videoUrl || session?.video_url || null;
    const goalTitle = title || session?.initial_goal
      || (targetSessionId ? `Task: ${targetSessionId.slice(0, 8)}...` : 'Screen Recording');

    activeVideoTitle.value = goalTitle;
    isVideoWindowOpen.value = true;
    isVideoMinimized.value = false;
    activeVideoSessionId = targetSessionId || null;
    cancelVideoRetry();
    videoRequestGeneration++;
    shouldAutoplayVideo.value = false;
    recordingPlaybackMessage.value = '';
    activeVideoSegments.value = [];
    if (Number.isFinite(seekSeconds)) requestVideoSeek(Number(seekSeconds));
    if (Number.isFinite(stepIndex)) {
      playerMode.value = 'steps';
      requestStepSeek(Number(stepIndex));
    }
    if (!targetSessionId) {
      activeVideoUrl.value = null;
      isVideoLoading.value = false;
      recordingPlaybackStatus.value = 'unavailable';
      return;
    }

    // live 分支：运行 / 暂停中的会话直接 MJPEG 投屏，不做录像轮询（Angular L1809-1814）。
    if (session?.status === 'running' || session?.status === 'paused') {
      activeVideoUrl.value = null;
      isVideoLoading.value = false;
      recordingPlaybackStatus.value = 'live';
      return;
    }

    activeVideoUrl.value = targetUrl;
    shouldAutoplayVideo.value = true;
    videoWaitStartedAt = Date.now();
    isVideoLoading.value = true;
    recordingPlaybackStatus.value = 'processing';
    // 有意偏差：Angular 此处 set 'Loading screen recording...'，固定文案由 UI i18n。
    recordingPlaybackMessage.value = '';
    if (targetUrl) {
      playerMode.value = 'video';
    } else if (hasCurrentSessionStepFrames.value) {
      playerMode.value = 'steps';
    } else {
      playerMode.value = 'video';
    }
    requestSessionVideo(targetSessionId, videoRequestGeneration);
  }

  function closeVideoPlayer(): void {
    isVideoWindowOpen.value = false;
    cancelVideoRetry();
    videoRequestGeneration++;
    activeVideoSessionId = null;
  }

  function toggleVideoPlayer(): void {
    if (isVideoWindowOpen.value) {
      isVideoWindowOpen.value = false;
    } else {
      openVideoPlayer();
    }
  }

  function toggleVideoMinimized(): void {
    isVideoMinimized.value = !isVideoMinimized.value;
  }

  function setPlayerMode(mode: 'video' | 'steps'): void {
    playerMode.value = mode;
  }

  // ---- seek / autoplay（平移自 L1978-1990 与 L288-291）----

  function consumeVideoAutoplay(): boolean {
    const shouldAutoplay = shouldAutoplayVideo.value;
    shouldAutoplayVideo.value = false;
    return shouldAutoplay;
  }

  function requestVideoSeek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    videoSeekRequest.value = {
      seconds: Math.max(0, seconds),
      requestId: ++videoSeekRequestId,
    };
  }

  function requestStepSeek(index: number): void {
    stepSeekRequestId++;
    stepSeekRequest.value = { index, requestId: stepSeekRequestId };
  }

  // ---- 录像轮询状态机（平移自 L1863-1976，generation 守卫与退避钳制保持一致）----

  function beginRecordingFinalization(sessionId: string): void {
    if (activeVideoSessionId !== sessionId) return;
    cancelVideoRetry();
    videoRequestGeneration++;
    videoWaitStartedAt = Date.now();
    activeVideoUrl.value = null;
    activeVideoSegments.value = [];
    shouldAutoplayVideo.value = true;
    isVideoLoading.value = true;
    recordingPlaybackStatus.value = 'processing';
    // 有意偏差：Angular 此处 set 'Finalizing screen recording...'，文案由 UI i18n。
    recordingPlaybackMessage.value = '';
    requestSessionVideo(sessionId, videoRequestGeneration);
  }

  function requestSessionVideo(sessionId: string, generation: number): void {
    apiGet<SessionVideoResponse>(`/api/sessions/${sessionId}/video`)
      .then((res) => {
        if (generation !== videoRequestGeneration || sessionId !== activeVideoSessionId) {
          return;
        }
        const status = res.status || (res.has_video && res.video_url ? 'ready' : 'unavailable');
        if (status === 'ready' && res.video_url) {
          cancelVideoRetry();
          isVideoLoading.value = false;
          recordingPlaybackStatus.value = 'ready';
          recordingPlaybackMessage.value = '';
          activeVideoUrl.value = res.video_url;
          activeVideoSegments.value = res.video_segments || [];
          playerMode.value = 'video';
          // 同步会话列表，避免下次打开重复轮询（平移自 Angular L1892-1896 的
          // rawSessions.update；最小侵入：直接写 session store 的 rawSessions ref）。
          sessionStore.rawSessions = sessionStore.rawSessions.map((s) =>
            s.session_id === sessionId
              ? { ...s, video_url: res.video_url || undefined, recording_status: 'ready' }
              : s,
          );
          return;
        }
        if (status === 'processing') {
          activeVideoUrl.value = null;
          activeVideoSegments.value = [];
          isVideoLoading.value = true;
          recordingPlaybackStatus.value = 'processing';
          // 有意偏差：Angular 此处 set 'Finalizing screen recording...'，文案由 UI i18n。
          recordingPlaybackMessage.value = '';
          scheduleVideoRetry(sessionId, generation, res.retry_after_ms);
          return;
        }

        cancelVideoRetry();
        isVideoLoading.value = false;
        activeVideoUrl.value = null;
        activeVideoSegments.value = [];
        recordingPlaybackStatus.value = status === 'failed' ? 'failed' : 'unavailable';
        // 有意偏差：Angular 的兜底文案（'Recording finalization failed.' /
        // 'No screen recording is available for this task.'）由 UI 按 status i18n。
        recordingPlaybackMessage.value = res.message || '';
        if (hasCurrentSessionStepFrames.value) {
          playerMode.value = 'steps';
        }
      })
      .catch(() => {
        if (generation !== videoRequestGeneration || sessionId !== activeVideoSessionId) {
          return;
        }
        if (recordingPlaybackStatus.value === 'processing') {
          scheduleVideoRetry(sessionId, generation, 1000);
          return;
        }
        isVideoLoading.value = false;
        recordingPlaybackStatus.value = 'failed';
        // 有意偏差：Angular 此处 set 'Unable to load the screen recording.'，文案由 UI i18n。
        recordingPlaybackMessage.value = '';
        if (hasCurrentSessionStepFrames.value) {
          playerMode.value = 'steps';
        }
      });
  }

  function scheduleVideoRetry(sessionId: string, generation: number, retryAfterMs = 1000): void {
    cancelVideoRetry();
    if (Date.now() - videoWaitStartedAt > 120_000) {
      isVideoLoading.value = false;
      recordingPlaybackStatus.value = 'failed';
      // 有意偏差：Angular 此处 set 'Recording finalization timed out...'，文案由 UI i18n。
      recordingPlaybackMessage.value = '';
      return;
    }
    const delay = Math.max(500, Math.min(3000, retryAfterMs));
    videoRetryTimer = setTimeout(() => {
      videoRetryTimer = null;
      requestSessionVideo(sessionId, generation);
    }, delay);
  }

  function cancelVideoRetry(): void {
    if (videoRetryTimer) {
      clearTimeout(videoRetryTimer);
      videoRetryTimer = null;
    }
  }

  function refreshActiveRecording(autoplay: boolean): void {
    const sessionId = activeVideoSessionId;
    if (!sessionId) return;
    cancelVideoRetry();
    videoRequestGeneration++;
    if (autoplay) shouldAutoplayVideo.value = true;
    requestSessionVideo(sessionId, videoRequestGeneration);
  }

  function retryVideoRecording(): void {
    const sessionId = activeVideoSessionId;
    if (!sessionId) return;
    beginRecordingFinalization(sessionId);
  }

  /**
   * SSE recording_failed 的落库入口（stream store 调用；平移自 Angular L825-832，
   * message 由调用方传入 parsedData.error 或兜底文案）。
   */
  function notifyRecordingFailed(message: string): void {
    cancelVideoRetry();
    isVideoLoading.value = false;
    activeVideoUrl.value = null;
    activeVideoSegments.value = [];
    recordingPlaybackStatus.value = 'failed';
    recordingPlaybackMessage.value = message;
  }

  /**
   * 判定给定会话是否为当前打开视频窗口的会话（替代 Angular 私有字段
   * activeVideoSessionId 的跨 store 比较；字符串化比较与 recording_ready/failed
   * 分支的 String() 比较语义一致）。
   */
  function isVideoSession(sessionId: unknown): boolean {
    return !!sessionId && !!activeVideoSessionId && String(sessionId) === String(activeVideoSessionId);
  }

  return {
    // state
    isVideoWindowOpen,
    isVideoMinimized,
    activeVideoUrl,
    activeVideoSegments,
    activeVideoTitle,
    isVideoLoading,
    recordingPlaybackStatus,
    recordingPlaybackMessage,
    shouldAutoplayVideo,
    videoSeekRequest,
    stepSeekRequest,
    playerMode,
    // computed
    currentSessionStepFrames,
    hasCurrentSessionStepFrames,
    currentSessionVideoUrl,
    currentSessionRecordingStatus,
    // actions
    openVideoPlayer,
    closeVideoPlayer,
    toggleVideoPlayer,
    toggleVideoMinimized,
    setPlayerMode,
    consumeVideoAutoplay,
    requestVideoSeek,
    requestStepSeek,
    beginRecordingFinalization,
    retryVideoRecording,
    refreshActiveRecording,
    notifyRecordingFailed,
    isVideoSession,
  };
});
