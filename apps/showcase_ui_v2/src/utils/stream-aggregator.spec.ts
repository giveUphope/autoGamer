import { describe, expect, it } from 'vitest';

import {
  consolidateLogsToBlocks,
  formatTokenCount,
  getSortedStepEvents,
  groupBlocksToPhases,
  persistedStreamToSegments,
} from './stream-aggregator';
import { extractBlockTokens } from './stream-aggregator';

/**
 * 平移自 Angular `stream-aggregator.util.spec.ts` 的关键用例（checker 车道、
 * 步骤归属、时间线排序），并补充 M2 快照回填（§3.3 条款 2）的幂等语义用例。
 */

const started = {
  type: 'checker_event',
  timestamp: '2026-08-25T20:00:05.000Z',
  data: {
    event: 'attempt_started',
    phase: 'checkpoint',
    attempt_id: 'abc#1',
    checkpoint_id: 'abc',
    subgoal_text: 'Create the alarm',
    trace_id: 'trace-checker-1',
    items: [{ kind: 'verify', text: 'alarm exists' }],
    ts: 1756152005,
  },
};

describe('stream aggregator checker lane（平移用例）', () => {
  it('creates a running checker block from attempt_started and finishes it by attempt id', () => {
    const blocks = consolidateLogsToBlocks([
      started,
      {
        type: 'checker_event',
        timestamp: '2026-08-25T20:00:09.000Z',
        data: {
          event: 'attempt_finished',
          attempt_id: 'abc#1',
          status: 'done',
          verdicts: [{ item_text: 'alarm exists', kind: 'verify', status: 'passed', evidence: 'seen' }],
          findings: [],
          ts: 1756152009,
        },
      },
    ]);

    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe('checker');
    expect(blocks[0].id).toBe('checker-abc#1');
    expect(blocks[0].data.isCompleted).toBe(true);
    expect(blocks[0].data.status).toBe('done');
    expect(blocks[0].data.trace_id).toBe('trace-checker-1');
    expect(blocks[0].data.verdicts.length).toBe(1);
    expect(blocks[0].data.duration).toBe(4);
  });

  it("routes the checker's stream and tool traces by parent trace id, not by the current step", () => {
    const blocks = consolidateLogsToBlocks([
      {
        type: 'step_recorded',
        timestamp: '2026-08-25T20:00:01.000Z',
        data: { step_id: 'step-1', step_number: 1, timestamp: 1756152001 },
      },
      started,
      {
        type: 'llm_stream',
        timestamp: '2026-08-25T20:00:06.000Z',
        data: {
          execution_id: 'exec-checker',
          step_id: 'step-1',
          parent_trace_id: 'trace-checker-1',
          stream_type: 'thinking',
          text: 'Inspecting the alarm list',
          isCompleted: false,
        },
      },
      {
        type: 'trace_recorded',
        timestamp: '2026-08-25T20:00:07.000Z',
        data: {
          trace_id: 'tool-probe',
          parent_trace_id: 'trace-checker-1',
          agent_name: 'checker',
          type: 'tool',
          name: 'probe_device',
          step_id: 'step-1',
          status: 'success',
        },
      },
    ]);

    const step = blocks.find((b) => b.id === 'step-step-1')!;
    const checker = blocks.find((b) => b.id === 'checker-abc#1')!;
    expect(step.data.operator_native_thinking).toBeUndefined();
    expect(step.data.generic_tools || []).toEqual([]);
    expect(checker.data.operator_native_thinking).toBe('Inspecting the alarm list');
    expect(checker.data.generic_tools.map((t: any) => t.trace_id)).toEqual(['tool-probe']);
    expect(checker.data.step_id).toBeUndefined();
    expect(blocks.map((b) => b.id)).toEqual(['step-step-1', 'checker-abc#1']);
  });

  it('rebuilds the persisted transcript into the same interleaved segments as the live stream', () => {
    const transcript = {
      attempt_id: 'abc#1',
      checkpoint_id: 'abc',
      phase: 'checkpoint',
      trace_id: 'trace-checker-1',
      ts: 1787688009,
      truncated: false,
      segments: [
        { execution_id: 'exec-1', role: 'thought', when: 1787688006, text: 'Inspecting the alarm list' },
        { execution_id: 'exec-1', role: 'answer', when: 1787688006.5, text: 'Let me look at step 2.' },
        { execution_id: 'exec-2', role: 'answer', when: 1787688008, text: 'The alarm is there.' },
        { execution_id: 'exec-3', role: 'answer', when: 1787688008.5, text: '' },
      ],
    };
    const segments = persistedStreamToSegments(transcript);
    expect(segments).toEqual([
      { execution_id: 'exec-1', stream_type: 'thinking', text: 'Inspecting the alarm list', timestamp: '2026-08-25T20:00:06.000Z', isCompleted: true },
      { execution_id: 'exec-1', stream_type: 'text', text: 'Let me look at step 2.', timestamp: '2026-08-25T20:00:06.500Z', isCompleted: true },
      { execution_id: 'exec-2', stream_type: 'text', text: 'The alarm is there.', timestamp: '2026-08-25T20:00:08.000Z', isCompleted: true },
    ]);
  });

  it('builds the run outcome block once and keeps it idempotent', () => {
    const outcome = {
      type: 'checker_event',
      timestamp: '2026-08-25T20:00:20.000Z',
      data: {
        event: 'run_outcome',
        task_status: 'completed',
        tests: { passed: 2, failed: 0 },
      },
    };
    const blocks = consolidateLogsToBlocks([outcome, { ...outcome }]);
    const outcomeBlocks = blocks.filter((b) => b.id === 'checker-outcome');
    expect(outcomeBlocks.length).toBe(1);
    expect(outcomeBlocks[0].data.task_status).toBe('completed');
  });
});

describe('stream aggregator step ownership（平移用例）', () => {
  it('does not duplicate action_taken when generic_tools already contains the action trace', () => {
    const blocks = consolidateLogsToBlocks([
      {
        type: 'step_updated',
        timestamp: '2026-08-25T20:00:01.000Z',
        data: {
          step_id: 's1',
          step_number: 1,
          action_taken: { action: 'click', target_text: 'OK' },
          generic_tools: [
            { trace_id: 't1', type: 'action', name: 'click', timestamp: 1756152001, payload: { args: { target_text: 'OK' } } },
          ],
        },
      },
    ]);
    const events = getSortedStepEvents(blocks[0].data);
    const actionEvents = events.filter((e) => e.type === 'action');
    expect(actionEvents.length).toBe(1);
  });

  it('merges step_updated snapshots by step_id without duplicating tools', () => {
    const logs = [
      {
        type: 'step_updated',
        timestamp: '2026-08-25T20:00:01.000Z',
        data: { step_id: 's1', step_number: 1, generic_tools: [{ trace_id: 't1', type: 'tool', name: 'probe_device', status: 'success' }] },
      },
      {
        type: 'step_updated',
        timestamp: '2026-08-25T20:00:02.000Z',
        data: { step_id: 's1', step_number: 1, action_taken: { action: 'tap', target_text: 'OK' }, generic_tools: [{ trace_id: 't1', type: 'tool', name: 'probe_device', status: 'success' }] },
      },
    ];
    const blocks = consolidateLogsToBlocks(logs);
    expect(blocks.length).toBe(1);
    expect(blocks[0].id).toBe('step-s1');
    expect(blocks[0].data.generic_tools.map((t: any) => t.trace_id)).toEqual(['t1']);
    expect(blocks[0].data.action_taken).toBeDefined();
  });
});

describe('stream aggregator snapshot backfill（§3.3 条款 2 的聚合面语义）', () => {
  /**
   * 复刻 stores/timeline.ts 的合并规则：history_snapshot 永远整体替换并排在
   * live 之前。重复回填（steps 快照重复拉取）不应产生重复块。
   */
  function mergeWithBackfill(existingLogs: any[], snapshotSteps: any[]): any[] {
    const historicalLogs = snapshotSteps.map((step) => ({
      type: 'step_updated',
      session_id: 'sess-1',
      timestamp: new Date((step.timestamp || Date.now() / 1000) * 1000).toISOString(),
      data: step,
      history_snapshot: true,
    }));
    return [...historicalLogs, ...existingLogs.filter((log) => !log.history_snapshot)];
  }

  it('repeated steps backfill is idempotent（重复回填无重复块）', () => {
    const step = { step_id: 's1', step_number: 1, timestamp: 1756152001, action_taken: { action: 'tap' } };
    const liveLog = {
      type: 'llm_stream',
      timestamp: '2026-08-25T20:00:06.000Z',
      data: { execution_id: 'e1', stream_type: 'text', text: 'live text', isCompleted: false },
    };

    const once = mergeWithBackfill([liveLog], [step]);
    const twice = mergeWithBackfill(once, [step]);

    expect(twice.filter((l) => l.history_snapshot).length).toBe(1);
    const blocksOnce = consolidateLogsToBlocks(once);
    const blocksTwice = consolidateLogsToBlocks(twice);
    expect(blocksTwice.map((b) => b.id)).toEqual(blocksOnce.map((b) => b.id));
    expect(blocksTwice.filter((b) => b.id === 'step-s1').length).toBe(1);
    // history_snapshot 日志永远排在 live 之前
    expect(twice[0].history_snapshot).toBe(true);
    expect(twice[twice.length - 1].history_snapshot).toBeUndefined();
  });

  it('repeated checks backfill is idempotent（checks_snapshot 可重复拉取不产生重复块）', () => {
    const ledgerRecord = {
      attempt_id: 'final#1',
      checkpoint_id: 'final',
      subgoal_text: "Final review against the user's original goal",
      kind: 'verify',
      status: 'passed',
      item_text: 'Android version visible',
      evidence: 'screen shows it',
      ts: 1756152005,
    };
    const liveAttempt = {
      type: 'checker_event',
      timestamp: '2026-08-25T20:00:09.000Z',
      data: { event: 'attempt_finished', attempt_id: 'final#1', status: 'done', verdicts: [], ts: 1756152009 },
    };

    // checks_snapshot 合并规则：先剔除旧的快照日志，再追加新构建的快照
    const mergeChecks = (existing: any[], snapshot: any[]) => [
      ...existing.filter((log) => !log.checks_snapshot),
      ...snapshot,
    ];
    // buildCheckerSnapshotLogs 的产物（构造细节由 store 层测试覆盖）：快照日志带 checks_snapshot 标记
    const snapshot = [
      {
        type: 'checker_event',
        timestamp: '2026-08-25T20:00:09.000Z',
        checks_snapshot: true,
        data: { event: 'attempt_finished', attempt_id: 'final#1', status: 'done', verdicts: [], ts: 1756152009 },
      },
    ];
    const once = mergeChecks([liveAttempt], snapshot);
    const twice = mergeChecks(once, snapshot);

    expect(twice.filter((l) => l.checks_snapshot).length).toBe(1);
    const blocksTwice = consolidateLogsToBlocks(twice);
    expect(blocksTwice.filter((b) => b.id === 'checker-final#1').length).toBe(1);
    // 同一 attempt_id 的 live 与 ledger 回填合并为一个块
    expect(blocksTwice.length).toBe(1);

    // 聚合本身对重复 ledger 记录也幂等（attempt_id 去重）
    const ledgerLogs = [ledgerRecord, { ...ledgerRecord }].map((rec) => ({
      type: 'checker_event',
      timestamp: '2026-08-25T20:00:05.000Z',
      checks_snapshot: true,
      data: { event: 'attempt_finished', ...rec, verdicts: [{ item_text: rec.item_text, kind: rec.kind, status: rec.status, evidence: rec.evidence }] },
    }));
    const blocksFromLedger = consolidateLogsToBlocks(ledgerLogs);
    expect(blocksFromLedger.filter((b) => b.id === 'checker-final#1').length).toBe(1);
  });
});

describe('stream aggregator phases & tokens', () => {
  it('groups blocks to phases with durations and token totals', () => {
    const blocks = consolidateLogsToBlocks([
      {
        type: 'step_updated',
        timestamp: '2026-08-25T20:00:01.000Z',
        data: { step_id: 's1', step_number: 1, timestamp: 1756152001, total_tokens: 3096, token_usage: { prompt_tokens: 3095, completion_tokens: 1, total_tokens: 3096 } },
      },
    ]);
    const phases = groupBlocksToPhases(blocks, 1756151995);
    expect(phases.length).toBe(1);
    expect(phases[0].tokens).toBe(3096);
    expect(phases[0].promptTokens).toBe(3095);
    expect(phases[0].completionTokens).toBe(1);
    expect(extractBlockTokens(blocks[0]).total).toBe(3096);
    expect(formatTokenCount(842)).toBe('842 tokens');
    expect(formatTokenCount(76400)).toBe('76.4k tokens');
    expect(formatTokenCount(1_200_000)).toBe('1.2M tokens');
  });
});
