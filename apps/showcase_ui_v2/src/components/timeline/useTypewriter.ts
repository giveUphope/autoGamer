/**
 * 时间线流文本逐字符打字机（B5，平移自 Angular agent-stream.component.ts 的
 * typedTextsSignal / typingTargets / rewindTargets 体系）：
 * - 每个 llm_stream 块两条泳道：text（Work，key = blockId）与 native（Thought，
 *   key = blockId + '-native'），各自维护"已打出的字符数"；
 * - 推进节奏等价移植母本常量：正向 667 chars/s、最小帧 28ms（28ms tick × 19 字符），
 *   断流 rewind 2600 chars/s（28ms tick × 73 字符）；
 * - live 流（isCompleted === false）首次出现从 0 起打、全文增长续推；非 live
 *   （历史快照 / 已完成）直接追平全文，零定时器开销；
 * - isReset 断流：已打出的内容按 rewind 速度回退到 0（同一块不重复触发），
 *   reset notice 由 StepCard 沿既有渲染路径显示（isWaiting 语义：流未完成显示等待态）；
 *   重试流到达（isReset 翻回 false）时取消 rewind、归零重推进（母本 startTyping 语义）。
 *
 * 状态主体为非响应式 Map（tick 高频读写），由 version ref 驱动重渲；定时器仅在
 * 存在推进 / 回退目标时存活，组件作用域销毁时清理（历史会话全程零定时器）。
 */
import { onScopeDispose, ref } from 'vue';

/** 打字帧间隔（母本 TYPING_MIN_FRAME_MS = 28）。 */
const TICK_MS = 28;
/** 每帧正向字符数（Math.round(667 × 28 / 1000)，母本 TYPING_CHARS_PER_SECOND = 667）。 */
const TYPING_CHARS_PER_TICK = 19;
/** 每帧回退字符数（Math.round(2600 × 28 / 1000)，母本 REWIND_CHARS_PER_SECOND = 2600）。 */
const REWIND_CHARS_PER_TICK = 73;

export interface StreamTypewriterSyncPayload {
  /** 时间线块 id（StepBlock.id） */
  blockId: string;
  /** Thought 泳道全文（block.data.operator_native_thinking，无则 null） */
  nativeText: string | null;
  /** Work/text 泳道全文（block.data.operator_raw_thinking，无则 null） */
  rawText: string | null;
  /** 是否为未完成的 live 流（block.data.isCompleted === false） */
  live: boolean;
  /** 断流重置标记（block.data.isReset） */
  isReset: boolean;
}

export interface StreamTypewriter {
  syncStreamBlock(payload: StreamTypewriterSyncPayload): void;
  /** Thought 泳道当前应显示的切片 */
  typedNative(blockId: string, fullText: string): string;
  /** Work/text 泳道当前应显示的切片 */
  typedRaw(blockId: string, fullText: string): string;
}

const laneKey = (blockId: string, lane: 'native' | 'raw'): string =>
  lane === 'native' ? `${blockId}-native` : blockId;

export function useStreamTypewriter(): StreamTypewriter {
  /** 版本号：tick 推进长度后自增，为渲染切片建立响应式依赖（长度本体存于非响应式 Map）。 */
  const version = ref(0);
  /** key → 已打出的字符数。 */
  const typedLengths = new Map<string, number>();
  /** key → 最近一次 sync 的全文（tick 的推进目标，随流增长由 sync 刷新）。 */
  const laneTexts = new Map<string, string>();
  const typingKeys = new Set<string>();
  const rewindKeys = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function stopLoop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function stopLoopIfIdle(): void {
    if (typingKeys.size === 0 && rewindKeys.size === 0) stopLoop();
  }

  function ensureLoop(): void {
    if (timer === null) {
      timer = setInterval(tick, TICK_MS);
    }
  }

  /** 每帧推进：先正向打字、再 rewind 回退，全部改动合并为一次 version bump（每帧至多一次重渲）。 */
  function tick(): void {
    let changed = false;
    for (const key of typingKeys) {
      const target = laneTexts.get(key) ?? '';
      const current = typedLengths.get(key) ?? 0;
      if (current < target.length) {
        typedLengths.set(key, Math.min(current + TYPING_CHARS_PER_TICK, target.length));
        changed = true;
      } else {
        // 已追平：移除目标（母本 advanceTyping 收敛分支）；流再增长时由 sync 重新挂目标
        typingKeys.delete(key);
      }
    }
    for (const key of rewindKeys) {
      const next = Math.max(0, (typedLengths.get(key) ?? 0) - REWIND_CHARS_PER_TICK);
      typedLengths.set(key, next);
      changed = true;
      if (next === 0) rewindKeys.delete(key);
    }
    if (changed) version.value += 1;
    stopLoopIfIdle();
  }

  /** 单泳道推进（母本 drive effect 的 raw / native 两分支合并；sync 仅在块变化时被 watch 调用）。 */
  function syncLane(key: string, fullText: string | null, live: boolean): void {
    if (fullText == null) {
      laneTexts.delete(key);
      return;
    }
    laneTexts.set(key, fullText);
    const current = typedLengths.get(key);
    if (current === undefined) {
      // 首次出现：live 从 0 起打；非 live（历史 / 已完成）直接全文
      typedLengths.set(key, live ? 0 : fullText.length);
      if (live) {
        typingKeys.add(key);
        ensureLoop();
      }
      return;
    }
    if (current >= fullText.length) return;
    if (rewindKeys.has(key)) {
      // 重试流开打（母本 startTyping）：取消 rewind、归零、重推进
      rewindKeys.delete(key);
      typedLengths.set(key, 0);
      typingKeys.add(key);
      ensureLoop();
      return;
    }
    if (live) {
      if (!typingKeys.has(key)) {
        typingKeys.add(key);
        ensureLoop();
      }
    } else {
      // 完成瞬间追平全文（母本 isCompleted 分支）
      typingKeys.delete(key);
      typedLengths.set(key, fullText.length);
    }
  }

  function syncStreamBlock(payload: StreamTypewriterSyncPayload): void {
    const { blockId, live, isReset } = payload;
    const rawKey = laneKey(blockId, 'raw');
    const nativeKey = laneKey(blockId, 'native');

    if (isReset) {
      // 断流 rewind：任一泳道已打出内容且本块回退未在途时触发一次（同一块不重复触发）；
      // 已无内容（rewind 完成或从未起打）则不动，notice 由 StepCard 既有路径显示。
      const hasTypedContent =
        (typedLengths.get(rawKey) ?? 0) > 0 || (typedLengths.get(nativeKey) ?? 0) > 0;
      if (hasTypedContent && rewindKeys.size === 0) {
        for (const key of [rawKey, nativeKey]) {
          if ((typedLengths.get(key) ?? 0) > 0) {
            typingKeys.delete(key);
            rewindKeys.add(key);
          }
        }
        ensureLoop();
      }
      return;
    }

    syncLane(rawKey, payload.rawText, live);
    syncLane(nativeKey, payload.nativeText, live);
    stopLoopIfIdle();
  }

  function typedSlice(blockId: string, lane: 'native' | 'raw', fullText: string): string {
    // 读取 version 建立响应式依赖：tick 推进后切片随 version 重算
    //（sync 时刻的长度变化则由块对象自身的响应性驱动重算）。
    version.value;
    const length = typedLengths.get(laneKey(blockId, lane));
    // 从未 sync 过的泳道回退全文（母本 getStreamDisplayText 的 fallback 语义）
    return length === undefined ? fullText : fullText.slice(0, Math.min(length, fullText.length));
  }

  onScopeDispose(stopLoop);

  return {
    syncStreamBlock,
    typedNative: (blockId: string, fullText: string) => typedSlice(blockId, 'native', fullText),
    typedRaw: (blockId: string, fullText: string) => typedSlice(blockId, 'raw', fullText),
  };
}
