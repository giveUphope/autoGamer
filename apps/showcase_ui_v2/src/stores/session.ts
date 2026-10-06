/**
 * 会话 store —— 从 Angular `AgentService`（2012 行）逻辑平移的 M1 部分：
 *
 * - 会话合并 4 步算法（`utils/session-merge.ts` 的 mergeSessions，§3.3 条款 3）
 * - 2s / 6s 双频轮询 + 轮询签名去重（payload 不变不触发响应式更新，§3.3 条款 4）
 * - 停止 / 删除 / 清空的乐观更新 + 签名失效（防止 2s 轮询回写旧状态，§3.3 条款 4）
 * - localStorage 会话缓存（restore / persist，key 与 Angular 版一致）
 * - 页面隐藏时暂停轮询、visibilitychange 恢复时立即刷新（§3.3 条款 6）
 *
 * 未平移部分（后续里程碑）：SSE 流与 sessionLogs（M3）、视频状态机（M4）。
 * steps/notes/checks/usage 回填自 M2 起由 `stores/timeline.ts` 承接（跟随本 store
 * 的 currentSessionId 联动）。
 *
 * M1 之外刻意保留的 Angular 语义：startup progress 追踪在 M2 随快照回填一起接入。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { apiGet, apiPost } from '@/services/api';
import type { ModelInfo, Session, TaskQueueItem } from '@/types/session.model';
import {
  mapPendingQueue,
  mergeSessions,
  statusSignature,
} from '@/utils/session-merge';
import type { ActiveTaskInfo } from '@/utils/session-merge';

const SESSION_CACHE_KEY = 'artemis.sessions.v1';
const STATUS_POLL_INTERVAL_MS = 2000;
/** 每 3 个轮询周期（6s）刷新一次 sessions，与外部 DB 修改保持同步。 */
const SESSIONS_REFRESH_EVERY_POLLS = 3;
const DEFAULT_PAUSE_ERROR = 'AI model request failed. The task is paused.';

/** `GET /api/run` 的 Pro 调优可选项（pro-tuning.model 中的 id）。 */
export interface RunTaskOptions {
  expectedOutput?: string;
  enableOutputter?: boolean;
  verificationLevel?: string;
  explorerMode?: string;
}

interface StatusResponse {
  status: string;
  session_id?: string | null;
  goal?: string | null;
  queue?: Array<TaskQueueItem | string>;
  active_tasks?: ActiveTaskInfo[];
  model_info?: ModelInfo | null;
  paused_error?: string | null;
}

export const useSessionStore = defineStore('session', () => {
  // ---- 与 Angular AgentService 一一对应的信号状态 ----
  const rawSessions = ref<Session[]>([]);
  const pendingQueue = ref<Session[]>([]);
  const activeTasks = ref<ActiveTaskInfo[]>([]);
  const agentStatus = ref<string>('idle');
  const runningSessionId = ref<string | null>(null);
  const runningGoal = ref<string | null>(null);
  const isPaused = ref(false);
  const pausedError = ref<string | null>(null);
  const activeModel = ref<ModelInfo | null>(null);
  /** 用户显式点选的非运行会话（pin），未 pin 时自动跟随运行中的任务。 */
  const userPinnedSessionId = ref<string | null>(null);
  const currentSessionId = ref<string | null>(null);

  /**
   * 跨轮询持久的 active/pending 会话追踪表（§3.3 条款 3 的桥接数据源）。
   * 非响应式：仅在 sessions computed 内经 mergeSessions 原地读写，
   * 与 Angular 版在 computed 中更新 `activeSessionTracking` 的语义一致。
   */
  const activeSessionTracking = new Map<string, Session>();

  // ---- computed ----

  /** 合并后的完整会话列表（4 步算法），按 start_time 倒序。 */
  const sessions = computed<Session[]>(() =>
    mergeSessions(
      {
        raw: rawSessions.value,
        pending: pendingQueue.value,
        activeTasks: activeTasks.value,
        agentStatus: agentStatus.value,
        runningSessionId: runningSessionId.value,
        runningGoal: runningGoal.value,
        activeModel: activeModel.value,
        nowMs: Date.now(),
      },
      activeSessionTracking,
    ),
  );

  const currentSession = computed<Session | null>(() => {
    const curId = currentSessionId.value;
    if (!curId) return null;
    return sessions.value.find((s) => s.session_id === curId) || null;
  });

  /** 当前查看的会话是否处于运行 / 暂停态（查看历史任务时为 false）。 */
  const isCurrentSessionRunning = computed<boolean>(() => {
    const curId = currentSessionId.value;
    if (!curId) return false;
    const session = currentSession.value;
    if (session) {
      return session.status === 'running' || session.status === 'paused';
    }
    // 刚提交 / 刚选中、尚未合并进 sessions 列表时的兜底
    const isActiveStatus = agentStatus.value === 'running' || agentStatus.value === 'paused';
    if (isActiveStatus && runningSessionId.value === curId) {
      return true;
    }
    if (activeTasks.value.some((at) => at.session_id === curId)) {
      return true;
    }
    return false;
  });

  const isRunningTask = computed<boolean>(() => {
    if (agentStatus.value === 'running' || agentStatus.value === 'paused') return true;
    return sessions.value.some((s) => s.status === 'running' || s.status === 'paused');
  });

  // ---- 轮询签名（§3.3 条款 4）----
  let lastQueueSignature: string | null = null;
  let lastActiveTasksSignature: string | null = null;
  // Angular 版每个轮询周期都无条件 set 新的 model_info 对象引用；为保证
  // 「payload 不变 → 零响应式更新」的 M1 验收标准，这里补一层内容签名。
  let lastModelInfoSignature: string | null = null;

  function invalidateStatusSignatures(): void {
    lastQueueSignature = null;
    lastActiveTasksSignature = null;
    lastModelInfoSignature = null;
  }

  // ---- 生命周期 / 轮询 ----
  let started = false;
  let statusInterval: ReturnType<typeof setInterval> | null = null;
  let pollCounter = 0;

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void fetchStatus();
      void fetchSessions();
    }
  };

  /** 应用启动时调用（App.vue setup）：恢复缓存 → 拉取会话 → 启动轮询。 */
  function start(): void {
    if (started) return;
    started = true;
    restoreSessionsCache();
    void fetchSessions();
    startStatusPolling();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  function stop(): void {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    started = false;
  }

  function startStatusPolling(): void {
    void fetchStatus();
    statusInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return; // 页面隐藏时暂停轮询；由 visibilitychange 恢复时立即刷新（§3.3 条款 6）。
      }
      void fetchStatus();
      pollCounter++;
      // 每 3 个 2s 周期（6s）刷新 sessions
      if (pollCounter % SESSIONS_REFRESH_EVERY_POLLS === 0) {
        void fetchSessions();
      }
    }, STATUS_POLL_INTERVAL_MS);
  }

  // ---- 数据获取 ----

  /** 拉取运行器状态（2s 轮询）。 */
  async function fetchStatus(): Promise<void> {
    try {
      const data = await apiGet<StatusResponse>('/api/status');
      if (data && data.status) {
        const oldStatus = agentStatus.value;
        const oldRunningSessionId = runningSessionId.value;
        const isActive = data.status === 'running' || data.status === 'paused';
        agentStatus.value = data.status;
        runningSessionId.value = data.session_id || null;
        runningGoal.value = data.goal || null;
        if (data.model_info) {
          const modelSignature = statusSignature(data.model_info);
          if (modelSignature !== lastModelInfoSignature) {
            lastModelInfoSignature = modelSignature;
            activeModel.value = data.model_info;
          }
        }
        isPaused.value = data.status === 'paused';

        if (data.status === 'paused') {
          const pauseError = data.paused_error || pausedError.value || DEFAULT_PAUSE_ERROR;
          pausedError.value = pauseError;
          // M3：暂停错误卡片追加到 sessionLogs（appendPausedErrorCard）随流状态接入。
        } else {
          pausedError.value = null;
        }

        // payload 未变化时跳过赋值：每 2s 生成新数组引用会迫使整条 sessions
        // computed 链为相同数据重新求值（签名去重，§3.3 条款 4）。
        const queueSignature = statusSignature(data.queue || []);
        if (queueSignature !== lastQueueSignature) {
          lastQueueSignature = queueSignature;
          pendingQueue.value = mapPendingQueue(data.queue || [], Date.now());
        }
        const activeTasksSignature = statusSignature(data.active_tasks || []);
        if (activeTasksSignature !== lastActiveTasksSignature) {
          lastActiveTasksSignature = activeTasksSignature;
          activeTasks.value = data.active_tasks || [];
        }

        if (oldStatus !== data.status || oldRunningSessionId !== data.session_id) {
          void fetchSessions();
        }

        // M4：运行器由 active 转 idle 时的录像 finalization 联动随播放器状态机接入。

        // 用户未显式 pin 历史会话时，自动选中运行中的会话
        if (isActive && data.session_id) {
          const currentId = currentSessionId.value;
          if (!currentId || (!userPinnedSessionId.value && currentId !== data.session_id)) {
            selectSession(data.session_id, false);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch status from backend:', err);
      agentStatus.value = 'offline';
      runningSessionId.value = null;
      runningGoal.value = null;
    }
  }

  /** 拉取全部历史与进行中的会话（6s 轮询 + 关键动作后手动刷新）。 */
  async function fetchSessions(): Promise<void> {
    try {
      const data = await apiGet<Session[]>('/api/sessions');
      rawSessions.value = data;
      persistSessionsCache(data);
      // 初次加载：未选中、未 pin、无运行任务且有历史时，选中最新一条
      if (
        !currentSessionId.value &&
        !userPinnedSessionId.value &&
        agentStatus.value !== 'running' &&
        data.length > 0
      ) {
        selectSession(data[0].session_id, false);
      }
    } catch (err) {
      console.error('Failed to fetch sessions from backend:', err);
    }
  }

  // ---- 任务提交与控制 ----

  /** 提交新任务到后端队列（`POST /api/run`）。错误向调用方抛出，由组件负责展示。 */
  async function runTask(
    goal: string,
    profile: string = 'flash',
    proTuning?: RunTaskOptions,
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { goal, profile };
    if (proTuning?.expectedOutput && proTuning.expectedOutput.trim()) {
      payload.expected_output = proTuning.expectedOutput.trim();
    }
    if (proTuning?.enableOutputter !== undefined) {
      payload.enable_outputter = proTuning.enableOutputter;
    }
    if (proTuning?.verificationLevel) {
      payload.verification_level = proTuning.verificationLevel;
    }
    if (proTuning?.explorerMode) {
      payload.explorer_mode = proTuning.explorerMode;
    }
    clearUserPinnedSession();
    const res = await apiPost<{ tasks?: Array<{ session_id?: string }> }>('/api/run', payload);
    if (res && res.tasks && res.tasks.length > 0) {
      const newSessionId = res.tasks[0].session_id;
      if (newSessionId) {
        // M2：startup progress 的 submitting 里程碑随快照回填一起接入。
        const isCurrentlyRunning =
          agentStatus.value === 'running' ||
          sessions.value.some((s) => s.status === 'running');
        const activeSessionId =
          runningSessionId.value ||
          sessions.value.find((s) => s.status === 'running' || s.status === 'paused')?.session_id;
        // 状态轮询可能在 /api/run 返回前就观察到新 runner——那仍是刚提交的
        // 任务而不是应保持选中的旧任务。
        if (!isCurrentlyRunning || activeSessionId === newSessionId) {
          selectSession(newSessionId, false);
        }
      }
    }
    return res;
  }

  /**
   * 停止任务（指定 session 或全部），带乐观更新：
   * 先把目标会话置为 cancelled 并清空运行器状态，再发请求；
   * 签名失效确保下一个 2s 轮询即使 payload 未变也会重新应用后端数据
   * （§3.3 条款 4：防止旧状态回写）。
   */
  async function stopTask(targetOrStopAll?: string | boolean | null, stopAll = false): Promise<void> {
    let targetSessionId: string | null = null;
    let effectiveStopAll = stopAll;

    if (typeof targetOrStopAll === 'boolean') {
      effectiveStopAll = targetOrStopAll;
    } else if (typeof targetOrStopAll === 'string' && targetOrStopAll.trim()) {
      targetSessionId = targetOrStopAll.trim();
    } else {
      // 默认：当前查看的会话，或当前运行的会话
      targetSessionId = currentSessionId.value || runningSessionId.value || null;
    }

    if (!effectiveStopAll && !targetSessionId) {
      targetSessionId =
        sessions.value.find(
          (session) => session.status === 'running' || session.status === 'paused',
        )?.session_id || null;
    }

    // 在 stop 请求与 DB 行更新跨网络交错期间，保持任务的终态稳定：
    // 若先清空全局运行器状态，合并器会从仍陈旧的 DB 行推断出 completed，
    // 造成短暂的 completed → cancelled 闪烁。
    if (targetSessionId) {
      setSessionStatus(targetSessionId, 'cancelled');
    }

    // 判断是否还有其他会话在多设备上执行
    const otherRunningSessions = sessions.value.filter(
      (s) => (s.status === 'running' || s.status === 'paused') && s.session_id !== targetSessionId,
    );

    // 乐观更新：仅在 stopAll 或无其他任务运行时置为 idle
    if (effectiveStopAll || otherRunningSessions.length === 0) {
      agentStatus.value = 'idle';
      runningSessionId.value = null;
      runningGoal.value = null;
    } else if (runningSessionId.value === targetSessionId) {
      runningSessionId.value = otherRunningSessions[0].session_id;
      runningGoal.value = otherRunningSessions[0].initial_goal || null;
    }

    isPaused.value = false;
    pausedError.value = null;
    invalidateStatusSignatures();
    if (effectiveStopAll) {
      pendingQueue.value = [];
    }

    // M3：标记目标会话未完成的 llm_stream 为已结束（flushStreamChunks）随流状态接入。

    // 乐观地从 activeTasks 移除
    if (targetSessionId) {
      activeTasks.value = activeTasks.value.filter((at) => at.session_id !== targetSessionId);
    }

    let url = `/api/stop?all=${effectiveStopAll}`;
    if (!effectiveStopAll && targetSessionId) {
      url += `&session_id=${encodeURIComponent(targetSessionId)}`;
    }
    const payload: { all: boolean; session_id?: string } = { all: effectiveStopAll };
    if (targetSessionId) {
      payload.session_id = targetSessionId;
    }

    try {
      await apiPost<{ status?: string }>(url, payload);
    } catch (err) {
      console.error('Failed to stop task:', err);
    } finally {
      void fetchStatus();
      void fetchSessions();
    }
  }

  /** 恢复暂停的任务（`POST /api/resume`）。 */
  async function resumeTask(): Promise<void> {
    try {
      const response = await apiPost<{ status?: string }>('/api/resume', {});
      if (response?.status !== 'resumed') {
        // 后端说无可恢复任务时，陈旧的恢复操作不得乐观地把任务改回 running。
        void fetchStatus();
        return;
      }
      const resumedSessionId = runningSessionId.value;
      isPaused.value = false;
      pausedError.value = null;
      agentStatus.value = 'running';
      setSessionStatus(resumedSessionId, 'running');
      void fetchStatus();
    } catch (err) {
      console.error('Failed to resume task:', err);
    }
  }

  /** 删除单个会话 / 任务：先乐观移除，再请求后端。 */
  async function deleteSession(sessionId: string): Promise<unknown> {
    // 1. 立即乐观更新本地会话状态
    invalidateStatusSignatures();
    rawSessions.value = rawSessions.value.filter((s) => s.session_id !== sessionId);
    persistSessionsCache(rawSessions.value);
    pendingQueue.value = pendingQueue.value.filter((s) => s.session_id !== sessionId);

    if (userPinnedSessionId.value === sessionId) {
      userPinnedSessionId.value = null;
    }

    if (currentSessionId.value === sessionId) {
      selectSession('', false);
      // M4：关闭打开中的视频窗口随播放器状态机接入。
      const runningId = runningSessionId.value;
      if (runningId && agentStatus.value === 'running') {
        selectSession(runningId, false);
      }
    }

    // 2. 发送请求
    try {
      const res = await apiPost<{ status?: string; message?: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/delete`,
        {},
      );
      void fetchSessions();
      void fetchStatus();
      return res;
    } catch (err) {
      console.error(`Failed to delete session ${sessionId}:`, err);
      void fetchSessions();
      void fetchStatus();
      throw err;
    }
  }

  /** 清空全部会话、任务与历史：先乐观清空，再请求后端。 */
  async function clearAllHistory(): Promise<unknown> {
    // 1. 立即乐观清空本地会话状态
    invalidateStatusSignatures();
    userPinnedSessionId.value = null;
    rawSessions.value = [];
    clearSessionsCache();
    pendingQueue.value = [];
    selectSession('', false);

    // 2. 发送请求
    try {
      const res = await apiPost<{ status?: string; message?: string }>('/api/cleanup', {});
      void fetchSessions();
      void fetchStatus();
      return res;
    } catch (err) {
      console.error('Failed to cleanup history:', err);
      void fetchSessions();
      void fetchStatus();
      throw err;
    }
  }

  // ---- 会话选择 ----

  /**
   * 选中会话。isUserAction 时维护 pin 语义：
   * 点当前运行中的任务 → 取消 pin 继续跟随；点其他任务 → pin 到该任务。
   */
  function selectSession(sessionId: string, isUserAction = false): void {
    if (isUserAction) {
      if (sessionId && sessionId === runningSessionId.value && agentStatus.value === 'running') {
        userPinnedSessionId.value = null;
      } else if (sessionId) {
        userPinnedSessionId.value = sessionId;
      } else {
        userPinnedSessionId.value = null;
      }
    }

    if (!sessionId) {
      currentSessionId.value = null;
      // timeline store 通过 watch(currentSessionId) 清空 sessionLogs / 快照状态。
      return;
    }

    if (currentSessionId.value === sessionId) {
      return;
    }
    currentSessionId.value = sessionId;
    // notes/checks/steps 快照拉取由 stores/timeline.ts 监听 currentSessionId 触发（M2）。
  }

  /** 清除用户的 pin，后续运行恢复自动跟随。 */
  function clearUserPinnedSession(): void {
    userPinnedSessionId.value = null;
  }

  // ---- 内部工具 ----

  /** 乐观的会话状态变更（raw + pending 两份列表），并使轮询签名失效。 */
  function setSessionStatus(sessionId: string | null, status: Session['status']): void {
    if (!sessionId) return;

    invalidateStatusSignatures();
    rawSessions.value = rawSessions.value.map((session) =>
      session.session_id === sessionId ? { ...session, status } : session,
    );
    pendingQueue.value = pendingQueue.value.map((session) =>
      session.session_id === sessionId ? { ...session, status } : session,
    );
  }

  // ---- localStorage 会话缓存（key 与 Angular 版一致，两端共享） ----

  function restoreSessionsCache(): void {
    try {
      const cached = localStorage.getItem(SESSION_CACHE_KEY);
      if (!cached) return;
      const sessionsFromCache = JSON.parse(cached);
      if (Array.isArray(sessionsFromCache)) {
        lastPersistedSessionsJson = cached;
        rawSessions.value = sessionsFromCache;
      }
    } catch {
      clearSessionsCache();
    }
  }

  let lastPersistedSessionsJson: string | null = null;

  function persistSessionsCache(sessionsToPersist: Session[]): void {
    try {
      const serialized = JSON.stringify(sessionsToPersist);
      if (serialized === lastPersistedSessionsJson) return;
      lastPersistedSessionsJson = serialized;
      localStorage.setItem(SESSION_CACHE_KEY, serialized);
    } catch {
      // 隐私浏览或内嵌环境可能无可用存储。
    }
  }

  function clearSessionsCache(): void {
    lastPersistedSessionsJson = null;
    try {
      localStorage.removeItem(SESSION_CACHE_KEY);
    } catch {
      // 存储不可用时静默。
    }
  }

  return {
    // state
    rawSessions,
    pendingQueue,
    activeTasks,
    agentStatus,
    runningSessionId,
    runningGoal,
    isPaused,
    pausedError,
    activeModel,
    userPinnedSessionId,
    currentSessionId,
    // computed
    sessions,
    currentSession,
    isCurrentSessionRunning,
    isRunningTask,
    // lifecycle
    start,
    stop,
    // data
    fetchStatus,
    fetchSessions,
    // actions
    runTask,
    stopTask,
    resumeTask,
    deleteSession,
    clearAllHistory,
    selectSession,
    clearUserPinnedSession,
  };
});
