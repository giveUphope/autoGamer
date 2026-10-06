import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';
import { useSessionStore } from './session';
import { useTimelineStore } from './timeline';

const apiGetMock = apiGet as unknown as Mock;

/** 按路径给出 GET 响应。每次调用深拷贝，保证引用每次都不同（模拟真实网络）。 */
function mockApiRoutes(routes: Record<string, unknown>): void {
  apiGetMock.mockImplementation((url: string) =>
    Promise.resolve(structuredClone(routes[url] ?? (url.endsWith('/steps') ? [] : {}))),
  );
}

const STEPS_URL = '/api/sessions/sess-1/steps';
const CHECKS_URL = '/api/sessions/sess-1/checks';
const NOTES_URL = '/api/sessions/sess-1/notes';
const STARTUP_URL = '/api/sessions/sess-1/startup_progress';
const USAGE_URL = '/api/sessions/sess-1/usage';

function bootstrapSelection(sessionId: string | null): void {
  const sessionStore = useSessionStore();
  sessionStore.selectSession(sessionId ?? '', false);
}

describe('timeline store — 快照回填语义（§3.3 条款 2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockApiRoutes({});
  });

  it('选中会话时回填 steps 快照，history_snapshot 日志进入 sessionLogs', async () => {
    mockApiRoutes({
      [STEPS_URL]: [
        { step_id: 's1', step_number: '1', timestamp: 1756152001, action_taken: { action: 'click' } },
        { step_id: 's2', step_number: '2', timestamp: 1756152010 },
      ],
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.sessionLogs.length).toBe(2));

    expect(timeline.sessionLogs[0].history_snapshot).toBe(true);
    expect(timeline.sessionLogs[0].type).toBe('step_updated');
    expect(timeline.isSessionContentLoading).toBe(false);
    // 快照映射为 step_updated 日志后可直接聚合出 step 块
    expect(timeline.consolidatedBlocks.map((b) => b.id)).toEqual(['step-s1', 'step-s2']);
    expect(apiGetMock).toHaveBeenCalledWith(STEPS_URL);
  });

  it('重复回填 steps 快照幂等：history_snapshot 永远在 live 之前且无重复', async () => {
    mockApiRoutes({
      [STEPS_URL]: [{ step_id: 's1', step_number: 1, timestamp: 1756152001 }],
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.sessionLogs.length).toBe(1));

    // 模拟 M3 的 live 日志到达（append-only，无快照标记）
    timeline.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      data: { execution_id: 'e1', stream_type: 'text', text: 'live', isCompleted: false },
    } as any);

    // M3 复用语义：info 事件 / 重连会再次触发 backfill
    timeline.backfillSessionSteps('sess-1');
    await vi.waitFor(() =>
      expect(apiGetMock.mock.calls.filter((c) => c[0] === STEPS_URL).length).toBe(2),
    );

    // 快照永远在前，live 在后；重复快照不堆积
    const snapshots = timeline.sessionLogs.filter((l) => l.history_snapshot);
    const lives = timeline.sessionLogs.filter((l) => !l.history_snapshot);
    expect(snapshots.length).toBe(1);
    expect(lives.length).toBe(1);
    expect(timeline.sessionLogs[0].history_snapshot).toBe(true);
    expect(timeline.sessionLogs[timeline.sessionLogs.length - 1].history_snapshot).toBeUndefined();
    expect(timeline.consolidatedBlocks.filter((b) => b.id === 'step-s1').length).toBe(1);
  });

  it('重复拉取 checks 幂等：checks_snapshot 不产生重复 checker 块', async () => {
    mockApiRoutes({
      [STEPS_URL]: [],
      [CHECKS_URL]: {
        records: [
          {
            attempt_id: 'final#1',
            checkpoint_id: 'final',
            subgoal_text: "Final review against the user's original goal",
            kind: 'verify',
            status: 'passed',
            item_text: 'Android version visible',
            evidence: 'screen shows it',
            ts: 1756152005,
          },
        ],
        streams: [],
        run_outcome: { task_status: 'completed', tests: { passed: 1, failed: 0 } },
      },
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.sessionLogs.some((l) => l.checks_snapshot)).toBe(true));

    // 再次拉取（如 session_ended 后的对账）——旧快照整体替换，不产生重复块
    timeline.fetchChecks('sess-1');
    await vi.waitFor(() => {
      const checkerLogs = timeline.sessionLogs.filter((l) => l.checks_snapshot);
      expect(checkerLogs.length).toBe(2); // attempt + run_outcome，仅一份
    });

    const checkerBlocks = timeline.consolidatedBlocks.filter((b) => b.type === 'checker');
    expect(checkerBlocks.map((b) => b.id).sort()).toEqual(['checker-final#1', 'checker-outcome'].sort());
    const attempt = checkerBlocks.find((b) => b.id === 'checker-final#1')!;
    expect(attempt.data.phase).toBe('final');
    expect(attempt.data.verdicts.length).toBe(1);
    expect(attempt.data.verdicts[0].status).toBe('passed');
  });

  it('checks 回填携带 streams 时重建 stream_segments（Thought/Work 交错）', async () => {
    mockApiRoutes({
      [STEPS_URL]: [],
      [CHECKS_URL]: {
        records: [
          { attempt_id: 'cp#1', checkpoint_id: 'abc', kind: 'verify', status: 'passed', item_text: 'ok', evidence: 'e', ts: 1756152005 },
        ],
        streams: [
          {
            attempt_id: 'cp#1',
            checkpoint_id: 'abc',
            segments: [
              { execution_id: 'e1', role: 'thought', when: 1756152000, text: 'thinking out loud' },
              { execution_id: 'e2', role: 'answer', when: 1756152001, text: 'the answer' },
            ],
          },
        ],
        run_outcome: null,
      },
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.consolidatedBlocks.some((b) => b.id === 'checker-cp#1')).toBe(true));

    const attempt = timeline.consolidatedBlocks.find((b) => b.id === 'checker-cp#1')!;
    const segments = attempt.data.stream_segments;
    expect(segments.map((s: any) => s.stream_type)).toEqual(['thinking', 'text']);
    expect(attempt.data.operator_native_thinking).toBe('thinking out loud');
    expect(attempt.data.operator_raw_thinking).toBe('the answer');
  });

  it('notes 回填默认选中 task_plan.md', async () => {
    mockApiRoutes({
      [STEPS_URL]: [],
      [NOTES_URL]: { notes: { 'output.md': 'report', 'task_plan.md': '# Plan' } },
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(Object.keys(timeline.currentNotes).length).toBe(2));
    expect(timeline.selectedNoteKey).toBe('task_plan.md');

    timeline.selectNoteKey('output.md');
    expect(timeline.selectedNoteKey).toBe('output.md');
  });

  it('startup_progress 按 stage 幂等合并', async () => {
    mockApiRoutes({
      [STEPS_URL]: [],
      [STARTUP_URL]: [
        { stage: 'device_check', message: 'Checking device', timestamp: 1756151998 },
        { stage: 'device_ready', message: 'Android device connected', timestamp: 1756152000 },
      ],
    });
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.currentStartupProgress.length).toBe(2));

    // 重复拉取只保留同 stage 的第一份（幂等）
    timeline.fetchStartupProgress('sess-1');
    await vi.waitFor(() => expect(apiGetMock).toHaveBeenCalledWith(STARTUP_URL));
    expect(timeline.currentStartupProgress.length).toBe(2);
  });

  it('切换会话时清空日志并重新拉取；世代守卫丢弃过期响应', async () => {
    // 让 sess-1 的 steps 慢速返回，sess-2 快速返回
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/sess-1/steps') {
        return new Promise((resolve) =>
          setTimeout(() => resolve([{ step_id: 's-old', step_number: 1, timestamp: 1756152001 }]), 30),
        );
      }
      if (url === '/api/sessions/sess-2/steps') {
        return Promise.resolve([{ step_id: 's-new', step_number: 1, timestamp: 1756152001 }]);
      }
      return Promise.resolve({});
    });

    const sessionStore = useSessionStore();
    const timeline = useTimelineStore();
    timeline.start();

    sessionStore.selectSession('sess-1', false);
    sessionStore.selectSession('sess-2', false);
    await vi.waitFor(() => expect(timeline.sessionLogs.length).toBe(1));
    expect(timeline.sessionLogs[0].data.step_id).toBe('s-new');

    // sess-1 的过期响应落回来时不得污染 sess-2 的时间线
    await new Promise((r) => setTimeout(r, 60));
    expect(timeline.sessionLogs.map((l) => l.data.step_id)).toEqual(['s-new']);
  });

  it('清除选中（null）时重置时间线状态', async () => {
    mockApiRoutes({
      [STEPS_URL]: [{ step_id: 's1', step_number: 1, timestamp: 1756152001 }],
      [NOTES_URL]: { notes: { 'task_plan.md': '# P' } },
    });
    const sessionStore = useSessionStore();
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await vi.waitFor(() => expect(timeline.sessionLogs.length).toBe(1));

    sessionStore.selectSession('', false);
    // watcher 为 pre-flush：清除在下一个微任务生效
    await vi.waitFor(() => expect(timeline.sessionLogs.length).toBe(0));
    expect(timeline.currentNotes).toEqual({});
  });

  it('loadRunUsage 写入 usage 并在会话切换后丢弃过期响应', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === USAGE_URL) {
        return Promise.resolve({
          session_id: 'sess-1',
          llm_calls: 4,
          prompt_tokens: 16370,
          completion_tokens: 2751,
          total_tokens: 19121,
          cached_tokens: 0,
          operator_context_tokens: null,
          operator_context_window_tokens: 1000000,
          profile: 'flash',
          run_tuning: null,
        });
      }
      return Promise.resolve({});
    });
    const sessionStore = useSessionStore();
    const timeline = useTimelineStore();
    timeline.start();
    bootstrapSelection('sess-1');
    await timeline.loadRunUsage('sess-1');
    expect(timeline.runUsage?.total_tokens).toBe(19121);

    // 切走后返回的过期 usage 不得写入
    sessionStore.selectSession('sess-2', false);
    await timeline.loadRunUsage('sess-1');
    expect(timeline.runUsage).toBeNull();
  });
});
