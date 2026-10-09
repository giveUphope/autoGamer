/**
 * SSE 实时流 store —— 从 Angular `AgentService.ensureLiveStream`（L762-1110）及
 * 合批 / 重试 trace / 暂停卡 / 终态映射（L1112-1212、L1319-1470、L529-549）平移的 M3 部分：
 *
 * - `/api/stream` 单通道 EventSource（幂等 start；onerror 只告警，浏览器原生自动
 *   重连，不手动重建连接——调研报告 §3.1 决策）。
 * - 17 种事件逐条平移：info 断线重连对账、session_started / session_ended 联动、
 *   startup_progress 合并与自动跟随（pin 语义）、task_paused / task_resumed 状态机、
 *   llm_retrying 重试 trace、llm_stream_reset 流重置、llm_stream 合批。
 * - 合批与顺序保证（§3.3 条款 1）：llm_stream 按 key 缓冲，80ms（前台）/ 500ms
 *   （document.hidden）定时落库；任何非 llm_stream 事件先 flushStreamChunks() 再
 *   处理，保证缓冲文本先于事件日志落库。
 * - 泳道语义：新 execution_id 只关闭同 stream_type + 同 parent_trace_id 的未完成
 *   流，并发 agent（Operator vs Checker）互不关闭。
 * - 日志写入口：直接读写 timeline store 导出的 sessionLogs ref。
 * - recording_ready / recording_failed / session_ended 的录像 finalization 联动
 *   回调 stores/player.ts（M4）。
 *
 * 与 Angular 版的有意差异：retryMessage 文案信号拆为结构化 retryInfo
 * （attempt / max_retries / delay），文案由 UI 层用 i18n 组装。
 */

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { useSessionStore } from '@/stores/session';
import { usePlayerStore } from '@/stores/player';
import { useTimelineStore, type SessionLog } from '@/stores/timeline';
import type { Session } from '@/types/session.model';
import {
  DEFAULT_STREAM_RESET_MESSAGE,
  type LLMStreamResetEventData,
} from '@/types/stream.model';

/** 待落库的 llm_stream 合批缓冲（key = `${execution_id}|${stream_type}`）。 */
interface PendingStreamChunk {
  execId: string;
  stepId?: string;
  sessionId: string | null;
  /** 发出该流的 agent trace：泳道判定的依据（并发 agent 各自成道）。 */
  parentTraceId: string | null;
  streamType: string;
  chunk: string;
}

/** 订阅的事件类型（info / keep-alive 有独立监听，不在此列）。 */
const STREAM_EVENT_TYPES = [
  'llm_stream',
  'llm_stream_reset',
  'trace_recorded',
  'step_recorded',
  'step_updated',
  'background_tasks_updated',
  'task_paused',
  'task_resumed',
  'llm_retrying',
  'startup_progress',
  'session_started',
  'session_ended',
  'recording_ready',
  'recording_failed',
  'checker_event',
] as const;

export const useStreamStore = defineStore('stream', () => {
  // ---- 响应式状态（对应 Angular 同名信号）----
  const isRetrying = ref<boolean>(false);
  /** 结构化重试信息：Angular 把文案拼在 service 里，v2 交由 UI 用 i18n 组装。 */
  const retryInfo = ref<{ attempt: number; max_retries: number; delay: number } | null>(null);
  const streamResetEvent = ref<LLMStreamResetEventData | null>(null);

  // ---- 非响应式内部状态 ----
  let eventSource: EventSource | null = null;
  const pendingStreamChunks = new Map<string, PendingStreamChunk>();
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 暂停卡去重键（`${sessionId}:${errorText}`）；task_resumed / 状态恢复时清空。 */
  let activePauseCardKey: string | null = null;
  let stopSessionWatch: (() => void) | null = null;

  // ---- llm_stream 合批（平移自 Angular queueStreamChunk / flushStreamChunks）----

  /**
   * 缓冲一个 llm_stream chunk；同一 execution_id + stream_type 的 chunk 累加，
   * 短窗口内最多落库一次（非流事件到来前也会立即 flush，保持相对顺序）。
   */
  function queueStreamChunk(parsedData: any): void {
    const execId = parsedData.execution_id;
    const stepId = parsedData.step_id;
    const sessionId = parsedData.session_id || null;
    const parentTraceId = parsedData.parent_trace_id || null;
    const streamType = parsedData.stream_type || 'text';
    const key = `${execId}|${streamType}`;
    const chunk = parsedData.chunk !== undefined ? parsedData.chunk : (parsedData.text || '');
    const pending = pendingStreamChunks.get(key);
    if (pending) {
      pending.chunk += chunk;
      if (stepId) pending.stepId = stepId;
      if (sessionId) pending.sessionId = sessionId;
      if (parentTraceId) pending.parentTraceId = parentTraceId;
    } else {
      pendingStreamChunks.set(key, { execId, stepId, sessionId, parentTraceId, streamType, chunk });
    }
    if (!streamFlushTimer) {
      // 后台标签页降低刷新频率。
      const delay = typeof document !== 'undefined' && document.hidden ? 500 : 80;
      streamFlushTimer = setTimeout(() => flushStreamChunks(), delay);
    }
  }

  /** 丢弃缓冲并清掉 flush 定时器（切会话 / stop 时调用）。 */
  function discardPendingStreamChunks(): void {
    pendingStreamChunks.clear();
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
  }

  /** 把缓冲批量落库：命中既有 llm_stream 日志则追加文本，否则按泳道开新流。 */
  function flushStreamChunks(): void {
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
    if (!pendingStreamChunks.size) return;
    const batches = Array.from(pendingStreamChunks.values());
    pendingStreamChunks.clear();

    const timelineStore = useTimelineStore();
    let next = [...timelineStore.sessionLogs];
    for (const batch of batches) {
      const existingIndex = next.findIndex(
        (l) => l.type === 'llm_stream'
          && l.data.execution_id === batch.execId
          && (l.data.stream_type || 'text') === batch.streamType,
      );

      if (existingIndex > -1) {
        const existingLog = next[existingIndex];
        next[existingIndex] = {
          ...existingLog,
          session_id: batch.sessionId || existingLog.session_id,
          data: {
            ...existingLog.data,
            session_id: batch.sessionId || existingLog.data?.session_id,
            text: (existingLog.data.text || '') + batch.chunk,
            step_id: batch.stepId || existingLog.data.step_id,
            parent_trace_id: batch.parentTraceId || existingLog.data.parent_trace_id || null,
          },
        };
      } else {
        // 新 execution_id 只关闭同一 agent 泳道（同 stream_type + 同 parent_trace_id）
        // 的未完成流；并发 agent（如 Checker）的流保持打开。
        next = next.map((l) => {
          if (l.type === 'llm_stream'
            && (l.data.stream_type || 'text') === batch.streamType
            && !l.data.isCompleted
            && (l.data.parent_trace_id || null) === (batch.parentTraceId || null)) {
            return { ...l, data: { ...l.data, isCompleted: true } };
          }
          return l;
        });
        next.push({
          type: 'llm_stream',
          timestamp: new Date().toISOString(),
          session_id: batch.sessionId || undefined,
          data: {
            execution_id: batch.execId,
            session_id: batch.sessionId || undefined,
            step_id: batch.stepId,
            parent_trace_id: batch.parentTraceId || null,
            text: batch.chunk,
            stream_type: batch.streamType,
            isCompleted: false,
          },
        });
      }
    }
    timelineStore.sessionLogs = next;
  }

  /**
   * 停止任务时把未完成的 llm_stream 全部标记结束（先 flush 缓冲，平移自 Angular
   * stopTask L536-549）；无未完成流时不产生新数组引用。
   */
  function markStoppedSessionStreamsCompleted(): void {
    flushStreamChunks();
    const timelineStore = useTimelineStore();
    const logs = timelineStore.sessionLogs;
    if (!logs.some((l) => l.type === 'llm_stream' && !l.data?.isCompleted)) {
      return;
    }
    timelineStore.sessionLogs = logs.map((l) => {
      if (l.type === 'llm_stream' && !l.data?.isCompleted) {
        return { ...l, data: { ...l.data, isCompleted: true } };
      }
      return l;
    });
  }

  // ---- 重试 / 暂停卡片（平移自 Angular appendLiveLLMRetryTrace / appendPausedErrorCard）----

  /**
   * 把实时 llm_retrying 事件合成为与历史 API 相同形状的 trace 日志，实时流与
   * 刷新后渲染共用一套数据契约；同 trace_id 或同 request_id + scheduled_at
   * 原位替换、不新增。
   */
  function appendLiveLLMRetryTrace(data: any, sessionId: string): void {
    const timelineStore = useTimelineStore();
    const timestampSeconds = typeof data?.timestamp === 'number'
      ? (data.timestamp > 1e11 ? data.timestamp / 1000 : data.timestamp)
      : Date.now() / 1000;
    const traceId = data?.trace_id
      || `llm-retry-live-${data?.request_id || 'unknown'}-${timestampSeconds}`;
    const payload = {
      error: data?.error,
      delay: data?.delay,
      attempt: data?.attempt,
      max_retries: data?.max_retries,
      provider: data?.provider,
      source: data?.source,
      recoverable: data?.recoverable,
      request_id: data?.request_id,
      scheduled_at: data?.scheduled_at ?? timestampSeconds,
    };
    const retryTrace = {
      trace_id: traceId,
      session_id: sessionId,
      step_id: data?.step_id || null,
      type: 'llm_call',
      name: 'llm_retry',
      timestamp: timestampSeconds,
      status: 'retrying',
      payload,
    };

    const retryLog: SessionLog = {
      type: 'trace_recorded',
      session_id: sessionId,
      timestamp: new Date(timestampSeconds * 1000).toISOString(),
      data: retryTrace,
    };
    const logs = timelineStore.sessionLogs;
    const existingIndex = logs.findIndex((log) =>
      log.type === 'trace_recorded'
      && (
        log.data?.trace_id === traceId
        || (
          data?.request_id
          && log.data?.payload?.request_id === data.request_id
          && Number(log.data?.payload?.scheduled_at) === Number(payload.scheduled_at)
        )
      ),
    );
    if (existingIndex < 0) {
      timelineStore.sessionLogs = [...logs, retryLog];
      return;
    }
    const updatedLogs = [...logs];
    updatedLogs[existingIndex] = retryLog;
    timelineStore.sessionLogs = updatedLogs;
  }

  /**
   * 暂停失败写入常规的 failed-LLM 卡片流：新 runner 先落持久 failed trace（由
   * alreadyRecorded 检查识别），这里同时兜底旧 runner 只带错误字符串的
   * task_paused；activePauseCardKey 对同 session + 同错误去重。
   */
  function appendPausedErrorCard(
    error: unknown,
    sessionId: string,
    timestamp?: number | string,
    stepId?: string | null,
    details?: any,
  ): void {
    const timelineStore = useTimelineStore();
    const errorText = typeof error === 'string' ? error : JSON.stringify(error);
    const pauseKey = `${sessionId}:${errorText}`;
    if (activePauseCardKey === pauseKey) return;

    const logs = timelineStore.sessionLogs;
    const alreadyRecorded = logs.some((log) => {
      const traces = log?.type === 'trace_recorded'
        ? [log.data]
        : (Array.isArray(log?.data?.generic_tools) ? log.data.generic_tools : []);
      return traces.some((trace: any) =>
        trace?.type === 'llm_call'
        && trace?.status === 'failed'
        && String(trace?.payload?.error ?? trace?.error ?? '') === errorText,
      );
    });

    if (!alreadyRecorded) {
      // 未指定 step 时回退到最近一条 step 日志。
      const latestStepId = stepId || [...logs].reverse().find(
        (log) => (log.type === 'step_updated' || log.type === 'step_recorded') && log.data?.step_id,
      )?.data?.step_id || null;
      const timestampMs = typeof timestamp === 'number'
        ? (timestamp < 1e11 ? timestamp * 1000 : timestamp)
        : (timestamp ? new Date(timestamp).getTime() : Date.now());

      timelineStore.sessionLogs = [
        ...logs,
        {
          type: 'trace_recorded',
          session_id: sessionId,
          timestamp: new Date(timestampMs).toISOString(),
          data: {
            trace_id: `task-paused-${sessionId}-${timestampMs}`,
            session_id: sessionId,
            step_id: latestStepId,
            type: 'llm_call',
            name: 'llm_pause',
            status: 'failed',
            timestamp: timestampMs / 1000,
            payload: {
              error: errorText,
              pause: true,
              request_id: details?.request_id,
              provider: details?.provider,
              waited_seconds: details?.waited_seconds,
              retries: Array.isArray(details?.retries) ? details.retries : [],
            },
          },
        },
      ];
    }
    activePauseCardKey = pauseKey;
  }

  /** 清空暂停卡去重键（task_resumed / 状态轮询恢复非暂停态时）。 */
  function clearPauseCard(): void {
    activePauseCardKey = null;
  }

  /** 复位重试状态（平移自 Angular stopTask L529 的 isRetrying.set(false)）。 */
  function resetRetryState(): void {
    isRetrying.value = false;
    retryInfo.value = null;
  }

  // ---- session_ended 终态映射（平移自 Angular applySessionEndedStatus）----

  function applySessionEndedStatus(sessionId: unknown, data: any): void {
    if (!sessionId) return;
    const sessionStore = useSessionStore();
    const reportedStatus = String(data?.status || '').toLowerCase();
    const status: Session['status'] | null = data?.was_stopped_manually || reportedStatus === 'cancelled'
      ? 'cancelled'
      : reportedStatus === 'failed'
        ? 'failed'
        : reportedStatus === 'completed' || reportedStatus === 'success'
          ? 'completed'
          : null;

    if (status) {
      sessionStore.setSessionStatus(String(sessionId), status);
      sessionStore.invalidateStatusSignatures();
      sessionStore.activeTasks = sessionStore.activeTasks.filter(
        (at) => at.session_id !== String(sessionId),
      );
      // 落库前就结束的任务（DB 行不存在）以 tracking 桥接为唯一表示：
      // 终局后必须撤掉，否则第 4 步会把它永远复活成 running 幽灵。
      sessionStore.dropTrackedSession(String(sessionId));
    }
  }

  // ---- 事件分发（逐条对齐 Angular ensureLiveStream L774-1104）----

  function handleStreamEvent(eventType: string, event: MessageEvent): void {
    const sessionStore = useSessionStore();
    const timelineStore = useTimelineStore();
    try {
      const parsedData = JSON.parse(event.data);
      const evtSessionId = parsedData?.session_id;

      // 顺序保证（§3.3 条款 1）：缓冲中的流文本必须先于任何非流事件落库。
      if (eventType !== 'llm_stream') {
        flushStreamChunks();
      }

      if (eventType === 'recording_ready' || eventType === 'recording_failed') {
        // M4：录像 finalization 联动（平移自 Angular L816-836）。在会话过滤之前
        // 处理：视频窗口打开且事件属于正在回放的会话时驱动播放器状态机。
        const playerStore = usePlayerStore();
        if (playerStore.isVideoWindowOpen && evtSessionId && playerStore.isVideoSession(evtSessionId)) {
          if (eventType === 'recording_ready') {
            playerStore.refreshActiveRecording(true);
          } else {
            playerStore.notifyRecordingFailed(
              parsedData?.error || 'Recording finalization failed.',
            );
          }
        }
        return;
      }

      if (eventType === 'background_tasks_updated') {
        void sessionStore.fetchStatus();
        return;
      }

      if (eventType === 'session_started') {
        sessionStore.agentStatus = 'running';
        if (parsedData?.session_id) {
          sessionStore.runningSessionId = parsedData.session_id;
        }
        if (parsedData?.initial_goal) {
          sessionStore.runningGoal = parsedData.initial_goal;
        }
        void sessionStore.fetchSessions();

        // 自动跟随：用户未显式 pin 历史会话时，切换视图到新运行会话。
        // 与状态轮询共用 mayAutoFollowSession 准入：绝不跨线程——他线程的
        // 会话启动不得换走用户正在对话的线程，否则下一条消息会借
        // submitConversationId 误入那个线程的队列（跨线程竞态）。
        if (
          !sessionStore.userPinnedSessionId
          && parsedData?.session_id
          && sessionStore.mayAutoFollowSession(String(parsedData.session_id))
        ) {
          sessionStore.selectSession(parsedData.session_id, false);
        }
        return;
      }

      if (eventType === 'session_ended') {
        const endedId = evtSessionId || sessionStore.runningSessionId;
        if (endedId) {
          applySessionEndedStatus(endedId, parsedData);
          sessionStore.invalidateStatusSignatures();
          sessionStore.activeTasks = sessionStore.activeTasks.filter(
            (at) => at.session_id !== endedId,
          );
        }
        // 按剩余 activeTasks 推导全局运行状态。pending ≠ running：排队中的
        // 轮次（尤其队列被熔断挂起、暂无派发时）不得被提升为运行态——那会
        // 让队首所属的其他会话平白显示「运行中」，还会把排队轮渲染成空
        // 运行轮。真正派发时 session_started / 状态轮询会立即接手。
        const remaining = sessionStore.activeTasks;
        if (remaining.length > 0) {
          sessionStore.agentStatus = 'running';
          sessionStore.runningSessionId = remaining[0].session_id || null;
          sessionStore.runningGoal = remaining[0].goal || null;
        } else {
          sessionStore.agentStatus = 'idle';
          sessionStore.runningSessionId = null;
          sessionStore.runningGoal = null;
        }
        resetRetryState();
        sessionStore.isPaused = false;
        void sessionStore.fetchSessions();
        void sessionStore.fetchStatus();
        if (endedId) {
          timelineStore.fetchNotes(endedId);
          if (String(endedId) === String(sessionStore.currentSessionId || '')) {
            // 退出终审 / 运行结果可能在流断连期间落库：从持久账本对账。
            timelineStore.fetchChecks(endedId);
          }
          // M4：live 投屏中的会话结束时立即转入录像 finalization 轮询
          // （平移自 Angular L893-899）。
          const playerStore = usePlayerStore();
          if (
            playerStore.isVideoWindowOpen
            && playerStore.isVideoSession(endedId)
            && playerStore.recordingPlaybackStatus === 'live'
          ) {
            playerStore.beginRecordingFinalization(String(endedId));
          }
        }
        return;
      }

      if (eventType === 'startup_progress') {
        const targetSid = evtSessionId || sessionStore.currentSessionId;
        if (targetSid) {
          timelineStore.appendStartupEvent(parsedData, targetSid);
          const curId = sessionStore.currentSessionId;
          if (
            !sessionStore.userPinnedSessionId
            && (!curId
              || String(targetSid).trim().toLowerCase() !== String(curId).trim().toLowerCase())
            // 与 session_started 同一准入：跨线程的启动进度不得换走当前线程
            && sessionStore.mayAutoFollowSession(String(targetSid))
          ) {
            sessionStore.agentStatus = 'running';
            sessionStore.runningSessionId = targetSid;
            sessionStore.selectSession(targetSid, false);
          }
        }
        return;
      }

      // 其余日志类事件：其他会话的事件不写入当前日志。
      const curId = sessionStore.currentSessionId;
      if (
        evtSessionId
        && curId
        && String(evtSessionId).trim().toLowerCase() !== String(curId).trim().toLowerCase()
      ) {
        return;
      }

      if (eventType === 'llm_retrying') {
        isRetrying.value = true;
        retryInfo.value = {
          attempt: Number(parsedData.attempt || 0),
          max_retries: Number(parsedData.max_retries || 0),
          delay: Number(parsedData.delay || 0),
        };
        if (curId) {
          appendLiveLLMRetryTrace(parsedData, curId);
        }
        return;
      }

      if (eventType === 'task_paused') {
        sessionStore.isPaused = true;
        isRetrying.value = false;
        sessionStore.agentStatus = 'paused';
        if (curId) {
          sessionStore.runningSessionId = curId;
          sessionStore.setSessionStatus(curId, 'paused');
          const pauseError = parsedData.error || 'AI call failed';
          sessionStore.pausedError = pauseError;
          appendPausedErrorCard(
            pauseError,
            curId,
            parsedData.timestamp,
            parsedData.step_id,
            parsedData,
          );
        }
        return;
      }

      if (eventType === 'task_resumed') {
        sessionStore.isPaused = false;
        isRetrying.value = false;
        sessionStore.pausedError = null;
        if (curId && sessionStore.runningSessionId === curId) {
          sessionStore.agentStatus = 'running';
          sessionStore.setSessionStatus(curId, 'running');
        }
        activePauseCardKey = null;
        return;
      }

      if (eventType === 'step_updated' || eventType === 'step_recorded' || eventType === 'llm_stream') {
        isRetrying.value = false;
      }

      if (eventType === 'llm_stream_reset') {
        const streamExecId = parsedData?.stream_exec_id || parsedData?.stream_execution_id;
        if (streamExecId) {
          for (const key of Array.from(pendingStreamChunks.keys())) {
            if (key.startsWith(`${streamExecId}|`) || key === streamExecId) {
              pendingStreamChunks.delete(key);
            }
          }
        }
        const resetMessage = parsedData?.message || DEFAULT_STREAM_RESET_MESSAGE;
        streamResetEvent.value = {
          stream_exec_id: streamExecId,
          stream_execution_id: streamExecId,
          step_id: parsedData?.step_id,
          session_id: parsedData?.session_id,
          action: parsedData?.action || 'discard',
          reason: parsedData?.reason || 'mid_stream_failure',
          category: parsedData?.category,
          error: parsedData?.error,
          message: resetMessage,
          retry_attempt: parsedData?.retry_attempt,
          timestamp: Date.now(),
        };

        // 已有同 execution_id 的流日志就地标记重置；完全没有时追加合成重置日志。
        const logs = timelineStore.sessionLogs;
        let updated = false;
        let next = logs.map((log) => {
          if (log.type === 'llm_stream' && log.data?.execution_id === streamExecId) {
            updated = true;
            return {
              ...log,
              data: { ...log.data, isReset: true, resetMessage },
            };
          }
          return log;
        });
        if (!updated && streamExecId) {
          next = [...next, {
            type: 'llm_stream',
            timestamp: new Date().toISOString(),
            session_id: parsedData?.session_id,
            data: {
              execution_id: streamExecId,
              step_id: parsedData?.step_id,
              stream_type: 'text',
              text: '',
              isCompleted: false,
              isReset: true,
              resetMessage,
            },
          }];
        }
        timelineStore.sessionLogs = next;
        return;
      }

      if (eventType === 'llm_stream') {
        queueStreamChunk(parsedData);
      } else {
        const logs = timelineStore.sessionLogs;
        // 无未完成流时不复制日志数组；只重写真正变化的条目。
        const hasOpenStream = logs.some(
          (l) => l.type === 'llm_stream' && !l.data.isCompleted,
        );
        let updatedLogs = hasOpenStream
          ? logs.map((l) => {
              if (l.type === 'llm_stream' && !l.data.isCompleted) {
                return { ...l, data: { ...l.data, isCompleted: true } };
              }
              return l;
            })
          : logs;

        const evtTime = typeof parsedData?.timestamp === 'number'
          ? new Date(parsedData.timestamp * 1000).toISOString()
          : new Date().toISOString();

        const nextLog: SessionLog = {
          type: eventType,
          timestamp: evtTime,
          data: parsedData,
        };

        let replacedInPlace = false;
        if (eventType === 'trace_recorded' && parsedData?.trace_id) {
          // 同 trace_id 的 trace 事件原位替换（重试 / 进度类 trace 会重复推送）。
          const existingTraceIndex = updatedLogs.findIndex(
            (log) => log.type === 'trace_recorded' && log.data?.trace_id === parsedData.trace_id,
          );
          if (existingTraceIndex > -1) {
            const deduplicatedLogs = [...updatedLogs];
            deduplicatedLogs[existingTraceIndex] = nextLog;
            updatedLogs = deduplicatedLogs;
            replacedInPlace = true;
          }
        }
        timelineStore.sessionLogs = replacedInPlace ? updatedLogs : [...updatedLogs, nextLog];
      }

      if (eventType === 'trace_recorded' && parsedData) {
        // 笔记相关工具的 trace 落库后刷新笔记面板。
        const trName = parsedData.name || '';
        if (['save_note', 'read_note', 'update_note', 'append_note', 'list_notes', 'outputter']
          .includes(trName.toLowerCase())) {
          if (curId) {
            timelineStore.fetchNotes(curId);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to parse ${eventType} event data:`, e);
      timelineStore.sessionLogs = [
        ...timelineStore.sessionLogs,
        {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: event.data,
        },
      ];
    }
  }

  // ---- 连接管理 ----

  /** 建立 `/api/stream` 单通道连接（幂等；对应 Angular ensureLiveStream）。 */
  function start(): void {
    if (eventSource) return;
    const sessionStore = useSessionStore();

    eventSource = new EventSource('/api/stream');

    // 断线重连后的快照对账（§3.3 条款 5 / R9）：对当前会话重新回填 steps。
    eventSource.addEventListener('info', () => {
      const curId = useSessionStore().currentSessionId;
      if (curId) {
        useTimelineStore().backfillSessionSteps(curId);
      }
    });

    // 后端 5s keep-alive tick，无需处理。
    eventSource.addEventListener('keep-alive', () => {});

    STREAM_EVENT_TYPES.forEach((eventType) => {
      eventSource?.addEventListener(
        eventType,
        (event) => handleStreamEvent(eventType, event as MessageEvent),
      );
    });

    // 浏览器 EventSource 原生自动重连，不手动重建连接。
    eventSource.onerror = (err) => {
      console.warn('Persistent live stream issue, browser will auto-reconnect:', err);
    };

    // 切会话时同步清理流缓冲与暂停卡（平移自 Angular selectSession L722/L741；
    // 日志本体由 timeline store 的 adoptSession 重置）。
    stopSessionWatch = watch(
      () => sessionStore.currentSessionId,
      () => {
        discardPendingStreamChunks();
        activePauseCardKey = null;
      },
    );
  }

  /** 关闭连接、清空缓冲与定时器并移除内部 watch（App.vue onBeforeUnmount）。 */
  function stop(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    discardPendingStreamChunks();
    if (stopSessionWatch) {
      stopSessionWatch();
      stopSessionWatch = null;
    }
  }

  return {
    // state
    isRetrying,
    retryInfo,
    streamResetEvent,
    // lifecycle
    start,
    stop,
    // actions
    flushStreamChunks,
    discardPendingStreamChunks,
    markStoppedSessionStreamsCompleted,
    appendPausedErrorCard,
    clearPauseCard,
    resetRetryState,
  };
});
