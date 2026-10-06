/**
 * 会话时间线 store —— 从 Angular `AgentService` 逻辑平移的 M2 部分：
 *
 * - `/api/sessions/{id}/steps` 快照回填（backfillSessionSteps）：快照日志可整体
 *   替换、live 日志 append-only，**history_snapshot 永远排在 live 之前**
 *   （§3.3 条款 2，M3 实时流直接复用本合并规则）。
 * - `/api/sessions/{id}/checks` 回填（fetchChecks + buildCheckerSnapshotLogs）：
 *   把 checker 账本重建为合成 `checker_event` 日志，**checks_snapshot 可重复
 *   拉取不产生重复块**（先剔除旧快照再追加，attempt_id 由聚合器去重）。
 * - `/api/sessions/{id}/notes`（fetchNotes）与 `/api/sessions/{id}/startup_progress`
 *   （按 stage 幂等合并）。
 * - `/api/sessions/{id}/usage`（loadRunUsage，供 RunInfoPopover 驱动）。
 * - 会话切换的世代守卫（loadGeneration / snapshotRequestId / pendingSnapshotRequests），
 *   过期的快照响应不落库——平移自 Angular selectSession / backfillSessionSteps。
 *
 * 未平移部分（M3）：SSE 连接与 llm_stream 合批、暂停/重试卡片、session_ended 联动。
 */

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { apiGet } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import type { SessionUsage } from '@/types/session.model';
import type { PersistedCheckerStream, StreamSegment } from '@/types/stream.model';
import { consolidateLogsToBlocks, groupBlocksToPhases, persistedStreamToSegments } from '@/utils/stream-aggregator';
import type { PhaseBlock, StepBlock } from '@/types/stream.model';
import type { StartupProgressEvent } from '@/utils/startup-progress';

/** sessionLogs 中的原始日志（Angular 版为 any[]，这里收敛出最小类型契约）。 */
export interface SessionLog {
  type: string;
  timestamp: string;
  session_id?: string;
  /** `true` = 来自 /steps 快照回填，永远排在 live 日志之前且可整体替换。 */
  history_snapshot?: boolean;
  /** `true` = 来自 /checks 账本回填，可重复拉取（幂等替换）。 */
  checks_snapshot?: boolean;
  data: any;
}

interface NotesResponse {
  notes?: Record<string, string>;
}

interface ChecksResponse {
  records?: any[];
  streams?: PersistedCheckerStream[];
  run_outcome?: any;
}

export const useTimelineStore = defineStore('timeline', () => {
  const sessionStore = useSessionStore();

  // ---- 状态（对应 AgentService 的同名字段）----
  const sessionLogs = ref<SessionLog[]>([]);
  const isSessionContentLoading = ref<boolean>(false);
  const currentNotes = ref<Record<string, string>>({});
  const selectedNoteKey = ref<string>('task_plan.md');
  const runUsage = ref<SessionUsage | null>(null);
  const startupProgressBySession = ref<Record<string, StartupProgressEvent[]>>({});
  const pendingStartupProgress = ref<StartupProgressEvent[]>([]);

  // ---- 会话加载世代守卫（平移自 AgentService）----
  let sessionLoadGeneration = 0;
  let sessionSnapshotRequestId = 0;
  let sessionSnapshotAppliedId = 0;
  const pendingSnapshotRequests = new Set<number>();

  // ---- computed ----

  /** 只保留当前会话的日志（平移自 filteredLogs）。 */
  const filteredLogs = computed<SessionLog[]>(() => {
    const logs = sessionLogs.value;
    const currentId = sessionStore.currentSessionId;
    if (!currentId) return logs;
    return logs.filter((log) => {
      const logSessionId = log.session_id || log.data?.session_id;
      return !logSessionId || String(logSessionId) === String(currentId);
    });
  });

  /** 去重排序后的时间线块（平移自 consolidatedBlocks）。 */
  const consolidatedBlocks = computed<StepBlock[]>(() => consolidateLogsToBlocks(filteredLogs.value));

  /** 阶段分组（平移自 phases；当前会话不存在时 start_time 以 0 兜底）。 */
  const phases = computed<PhaseBlock[]>(() => {
    const currentSession = sessionStore.currentSession;
    return groupBlocksToPhases(consolidatedBlocks.value, currentSession?.start_time || 0);
  });

  /** 当前会话的启动进度（平移自 currentStartupProgress）。 */
  const currentStartupProgress = computed<StartupProgressEvent[]>(() => {
    const sessionId = sessionStore.currentSessionId;
    if (sessionId) {
      const normalized = String(sessionId).trim().toLowerCase();
      const bySession = startupProgressBySession.value;
      const direct = bySession[sessionId];
      if (direct?.length) return direct;
      const matched = Object.entries(bySession).find(
        ([key]) => key.trim().toLowerCase() === normalized,
      );
      if (matched?.[1]?.length) return matched[1];
    }
    return pendingStartupProgress.value;
  });

  // ---- 会话选择（由 session store 的 currentSessionId 驱动）----

  /**
   * 切换会话：重置流状态与世代守卫，随即拉取 notes / checks / steps 快照。
   * 平移自 AgentService.selectSession 的数据装载分支（SSE 部分在 M3 接入）。
   */
  function adoptSession(sessionId: string | null): void {
    if (!sessionId) {
      sessionLoadGeneration++;
      pendingSnapshotRequests.clear();
      isSessionContentLoading.value = false;
      sessionLogs.value = [];
      currentNotes.value = {};
      runUsage.value = null;
      return;
    }

    if (sessionStore.currentSessionId !== sessionId) return;

    const loadGeneration = ++sessionLoadGeneration;
    pendingSnapshotRequests.clear();
    sessionSnapshotAppliedId = 0;
    isSessionContentLoading.value = true;
    sessionLogs.value = [];
    currentNotes.value = {};
    runUsage.value = null;
    fetchNotes(sessionId);
    fetchChecks(sessionId);
    backfillSessionSteps(sessionId, loadGeneration);
  }

  // ---- steps 快照回填（§3.3 条款 2：history_snapshot 永远在 live 之前）----

  /**
   * Load a fresh persisted snapshot without replacing events already received
   * from SSE. Snapshot logs are replaceable, while live logs remain append-only;
   * the stream aggregator merges matching steps and trace IDs within each step.
   * （平移自 AgentService.backfillSessionSteps）
   */
  function backfillSessionSteps(sessionId: string, loadGeneration: number = sessionLoadGeneration): void {
    const requestId = ++sessionSnapshotRequestId;
    pendingSnapshotRequests.add(requestId);
    apiGet<any[]>(`/api/sessions/${encodeURIComponent(sessionId)}/steps`)
      .then((steps) => {
        pendingSnapshotRequests.delete(requestId);
        if (
          sessionStore.currentSessionId !== sessionId
          || loadGeneration !== sessionLoadGeneration
          || requestId < sessionSnapshotAppliedId
        ) return;
        sessionSnapshotAppliedId = requestId;
        const historicalLogs: SessionLog[] = (Array.isArray(steps) ? steps : []).map((step) => ({
          type: 'step_updated',
          session_id: sessionId,
          timestamp: new Date((Number(step.timestamp) || Date.now() / 1000) * 1000).toISOString(),
          data: step,
          history_snapshot: true,
        }));

        // 合并规则：快照整体替换并排在最前，live 日志保持 append-only。
        sessionLogs.value = [
          ...historicalLogs,
          ...sessionLogs.value.filter((log) => !log.history_snapshot),
        ];
        isSessionContentLoading.value = false;
      })
      .catch((err) => {
        pendingSnapshotRequests.delete(requestId);
        console.error('Failed to backfill session steps:', err);
        if (
          sessionStore.currentSessionId === sessionId
          && loadGeneration === sessionLoadGeneration
          && pendingSnapshotRequests.size === 0
        ) {
          isSessionContentLoading.value = false;
        }
      });

    fetchStartupProgress(sessionId);
  }

  /** 按 stage 幂等合并启动进度（平移自 backfillSessionSteps 的 startup_progress 分支）。 */
  function fetchStartupProgress(sessionId: string): void {
    apiGet<StartupProgressEvent[]>(`/api/sessions/${encodeURIComponent(sessionId)}/startup_progress`)
      .then((events) => {
        if (Array.isArray(events) && events.length > 0) {
          startupProgressBySession.value = {
            ...startupProgressBySession.value,
            [sessionId]: mergeStartupEvents(startupProgressBySession.value[sessionId] || [], events),
          };
        }
      })
      .catch(() => {});
  }

  function mergeStartupEvents(
    existing: StartupProgressEvent[],
    events: StartupProgressEvent[],
  ): StartupProgressEvent[] {
    const merged = [...existing];
    for (const ev of events) {
      if (!merged.some((m) => m.stage === ev.stage)) {
        merged.push(ev);
      }
    }
    return merged;
  }

  // ---- checker 账本回填（§3.3 条款 2：checks_snapshot 幂等）----

  /**
   * Backfill the Checker's attempts and run outcome from the persisted verdict
   * ledger (`/api/sessions/{id}/checks`) as synthetic `checker_event` logs, so
   * historical sessions show the same timeline blocks as live ones. Live
   * events for attempts already known are merged by attempt id in the
   * aggregator, so re-fetching is idempotent.
   * （平移自 AgentService.fetchChecks）
   */
  function fetchChecks(sessionId: string): void {
    if (!sessionId) return;
    apiGet<ChecksResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/checks`)
      .then((res) => {
        if (sessionStore.currentSessionId !== sessionId) return;
        const snapshot = buildCheckerSnapshotLogs(
          sessionId,
          res?.records || [],
          res?.run_outcome || null,
          res?.streams || [],
        );
        // 幂等合并：先剔除全部旧快照日志，再追加新构建的快照。
        sessionLogs.value = [
          ...sessionLogs.value.filter((log) => !log.checks_snapshot),
          ...snapshot,
        ];
      })
      .catch((err) => {
        console.error(`Failed to fetch checks for session ${sessionId}:`, err);
      });
  }

  /**
   * `streams` are the attempts' persisted transcripts (what the Checker
   * streamed while reaching its verdict): they become the attempt's
   * `stream_segments`, the same shape the live `llm_stream` chunks build, so
   * a reopened session interleaves Thought/Work text with tool rows exactly
   * like the live view did.
   * （平移自 AgentService.buildCheckerSnapshotLogs）
   */
  function buildCheckerSnapshotLogs(
    sessionId: string,
    records: any[],
    runOutcome: any,
    streams: PersistedCheckerStream[] = [],
  ): SessionLog[] {
    const byAttempt = new Map<string, any>();
    const segmentsByAttempt = new Map<string, StreamSegment[]>();
    for (const stream of streams || []) {
      if (!stream || !stream.attempt_id) continue;
      const segments = persistedStreamToSegments(stream);
      if (segments.length > 0) segmentsByAttempt.set(String(stream.attempt_id), segments);
    }
    for (const rec of records) {
      if (!rec || !rec.attempt_id) continue;
      const attemptId = String(rec.attempt_id);
      const checkpointId = String(rec.checkpoint_id || '');
      let attempt = byAttempt.get(attemptId);
      if (!attempt) {
        attempt = {
          event: 'attempt_finished',
          phase: checkpointId === 'final' ? 'final' : 'checkpoint',
          attempt_id: attemptId,
          checkpoint_id: checkpointId,
          subgoal_text: String(rec.subgoal_text || (checkpointId === 'final'
            ? "Final review against the user's original goal"
            : `Subgoal ${checkpointId.slice(0, 8)}`)),
          anchor_step_id: rec.anchor_step_id ?? null,
          trace_id: rec.trace_id ?? null,
          status: 'done',
          verdicts: [],
          findings: [],
          ts: typeof rec.ts === 'number' ? rec.ts : undefined,
          session_id: sessionId,
        };
        byAttempt.set(attemptId, attempt);
      }
      if (typeof rec.ts === 'number') {
        attempt.ts = attempt.ts === undefined ? rec.ts : Math.min(attempt.ts, rec.ts);
      }
      if (!attempt.trace_id && rec.trace_id) {
        attempt.trace_id = rec.trace_id;
      }
      attempt.verdicts.push({
        item_text: String(rec.item_text || ''),
        kind: String(rec.kind || ''),
        status: String(rec.status || ''),
        evidence: String(rec.evidence || ''),
        suggestion: rec.suggestion ? String(rec.suggestion) : '',
        when: rec.when ? String(rec.when) : undefined,
      });
    }

    const logs: SessionLog[] = [];
    for (const attempt of byAttempt.values()) {
      const statuses = new Set(attempt.verdicts.map((v: any) => v.status));
      if (statuses.size === 1) {
        const only = [...statuses][0];
        if (only === 'superseded' || only === 'unchecked') attempt.status = only;
      }
      const ts = attempt.ts ?? Date.now() / 1000;
      attempt.timestamp = ts;
      const segments = segmentsByAttempt.get(attempt.attempt_id);
      if (segments) attempt.stream_segments = segments;
      logs.push({
        type: 'checker_event',
        session_id: sessionId,
        timestamp: new Date(ts * 1000).toISOString(),
        checks_snapshot: true,
        data: attempt,
      });
    }
    if (runOutcome && typeof runOutcome === 'object') {
      const lastTs = logs.length > 0
        ? Math.max(...logs.map((l) => new Date(l.timestamp).getTime() / 1000))
        : Date.now() / 1000;
      const ts = lastTs + 0.001;
      logs.push({
        type: 'checker_event',
        session_id: sessionId,
        timestamp: new Date(ts * 1000).toISOString(),
        checks_snapshot: true,
        data: { event: 'run_outcome', phase: 'outcome', ...runOutcome, ts, timestamp: ts, session_id: sessionId },
      });
    }
    return logs;
  }

  // ---- notes ----

  /** （平移自 AgentService.fetchNotes） */
  function fetchNotes(sessionId: string): void {
    if (!sessionId) {
      currentNotes.value = {};
      return;
    }
    apiGet<NotesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/notes`)
      .then((res) => {
        if (sessionStore.currentSessionId !== sessionId) return;
        if (res && res.notes) {
          currentNotes.value = res.notes;
          // Default to task_plan.md if available, otherwise first note
          const keys = Object.keys(res.notes);
          if (keys.length > 0) {
            const currentSelected = selectedNoteKey.value;
            if (!keys.includes(currentSelected)) {
              if (keys.includes('task_plan.md')) {
                selectedNoteKey.value = 'task_plan.md';
              } else {
                selectedNoteKey.value = keys[0];
              }
            }
          }
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch notes for session ${sessionId}:`, err);
      });
  }

  // ---- usage（RunInfoPopover 驱动；M2 无实时流，打开/会话变化时拉取）----

  /** （平移自 AgentService.getSessionUsage + 组件 loadRunUsage 的会话守卫） */
  async function loadRunUsage(sessionId: string): Promise<void> {
    try {
      const usage = await apiGet<SessionUsage>(`/api/sessions/${encodeURIComponent(sessionId)}/usage`);
      if (sessionStore.currentSessionId !== sessionId) return;
      runUsage.value = usage;
    } catch (err) {
      console.error('Failed to load session usage:', err);
    }
  }

  /** 笔记 tab 切换（NotesPanel）。 */
  function selectNoteKey(key: string): void {
    selectedNoteKey.value = key;
  }

  // ---- 生命周期：跟随 session store 的选中会话 ----

  let started = false;

  function start(): void {
    if (started) return;
    started = true;
    watch(
      () => sessionStore.currentSessionId,
      (id) => adoptSession(id),
      { immediate: true },
    );
  }

  return {
    // state
    sessionLogs,
    isSessionContentLoading,
    currentNotes,
    selectedNoteKey,
    runUsage,
    startupProgressBySession,
    pendingStartupProgress,
    // computed
    filteredLogs,
    consolidatedBlocks,
    phases,
    currentStartupProgress,
    // actions
    start,
    adoptSession,
    backfillSessionSteps,
    fetchChecks,
    fetchNotes,
    fetchStartupProgress,
    loadRunUsage,
    selectNoteKey,
    buildCheckerSnapshotLogs,
  };
});
