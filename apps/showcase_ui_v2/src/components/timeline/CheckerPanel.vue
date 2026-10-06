<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCheckCircle,
  IconCloseCircle,
  IconHistory,
  IconMinusCircle,
  IconQuestionCircle,
  IconRecord,
} from '@arco-design/web-vue/es/icon';

import type { CheckerVerdict, StepBlock } from '@/types/stream.model';
import { getSortedStepEvents } from '@/utils/stream-aggregator';
import { renderMarkdown } from '@/utils/markdown';

/**
 * Checker attempt 面板（对应 Angular 的 checker 块，按映射表用 a-collapse 重做）：
 * 头部（阶段标签 + 子目标 + 状态）、声明检查项、按时间交错的 Thought/Work 流、
 * 逐项结论（verdicts）与附注。数据经 checks_snapshot 回填时按 attempt_id 幂等合并，
 * 不会产生重复块（见 stores/timeline.ts / utils/stream-aggregator.ts）。
 */
const { t } = useI18n();

const props = defineProps<{ block: StepBlock }>();

/** 阶段标签（平移自 getCheckerPhaseLabel）。 */
const phaseLabel = computed<string>(() => {
  switch (props.block.data?.phase) {
    case 'final':
      return t('workspace.timeline.finalCheck');
    case 'outcome':
      return t('workspace.timeline.result');
    default:
      return t('workspace.timeline.check');
  }
});

const verdicts = computed<CheckerVerdict[]>(() =>
  Array.isArray(props.block.data?.verdicts) ? props.block.data.verdicts : [],
);

/** 声明检查项（持久化 attempt 只有 verdicts 时按 Angular 逻辑推导）。 */
const checkItems = computed<any[]>(() => {
  const d = props.block.data || {};
  if (Array.isArray(d.items) && d.items.length > 0) return d.items;
  return verdicts.value.map((v) => ({ kind: v.kind, text: v.item_text, when: v.when }));
});

const isMuted = computed<boolean>(() => {
  const status = props.block.data?.status;
  return status === 'superseded' || status === 'unchecked';
});

const isRunning = computed<boolean>(() => props.block.data?.isCompleted === false);

function checkMethodLabel(item: any): string {
  const parts: string[] = [item?.kind === 'assert' ? t('workspace.timeline.checkMethodAssert') : t('workspace.timeline.checkMethodVerify')];
  if (item?.when === 'at_end' && props.block.data?.phase !== 'final') parts.push(t('workspace.timeline.checkMethodAtEnd'));
  return parts.join(' · ');
}

/** 结论行的状态文案（平移自 getVerdictStatusText）。 */
function verdictStatusText(status: string): string {
  switch (status) {
    case 'passed':
      return t('workspace.timeline.verdictPassed');
    case 'failed':
      return t('workspace.timeline.verdictFailed');
    case 'inconclusive':
      return t('workspace.timeline.verdictInconclusive');
    case 'superseded':
      return t('workspace.timeline.verdictSuperseded');
    case 'unchecked':
      return t('workspace.timeline.verdictUnchecked');
    default:
      return status || '';
  }
}

/** 结论编号与上方检查项对应（平移自 getVerdictItemNumber）。 */
function verdictItemNumber(verdict: any, fallbackIndex: number): number {
  const idx = checkItems.value.findIndex((i) => i.text === verdict?.item_text);
  return (idx > -1 ? idx : fallbackIndex) + 1;
}

/** 未出现在结论里的附注（平移自 getCheckerNotes）。 */
const checkerNotes = computed<string[]>(() => {
  const d = props.block.data || {};
  if (d.phase === 'outcome') return Array.isArray(d.last_findings) ? d.last_findings : [];
  const notes: string[] = [];
  if (Array.isArray(d.unmet_subgoals)) {
    for (const text of d.unmet_subgoals) notes.push(t('workspace.timeline.unmetSubgoal', { text }));
  }
  if (d.reverted) notes.push(t('workspace.timeline.reverted'));
  if (d.error) notes.push(String(d.error));
  return notes;
});

const hasResult = computed<boolean>(() => {
  if (isRunning.value || isMuted.value) return false;
  if (props.block.data?.phase === 'outcome') return checkerNotes.value.length > 0;
  return verdicts.value.length > 0 || checkerNotes.value.length > 0;
});

/** 色调（平移自 getCheckerTone）。 */
const tone = computed<string>(() => {
  const d = props.block.data || {};
  if (d.phase === 'outcome') {
    return d.task_status === 'completed' ? 'passed' : d.task_status === 'blocked' ? 'failed' : 'inconclusive';
  }
  if (d.isCompleted === false) return 'running';
  if (d.status === 'superseded' || d.status === 'unchecked') return 'muted';
  if (d.status === 'error') return 'inconclusive';
  if (verdicts.value.some((v) => v.status === 'failed')) return 'failed';
  if (verdicts.value.some((v) => v.status === 'inconclusive')) return 'inconclusive';
  return 'passed';
});

/** 状态行（平移自 getCheckerStatusLabel）。 */
const statusLabel = computed<string>(() => {
  const d = props.block.data || {};
  if (d.phase === 'outcome') {
    const tests = d.tests || {};
    const label = d.task_status === 'completed'
      ? t('workspace.timeline.goalCompleted')
      : d.task_status === 'blocked'
        ? t('workspace.timeline.blocked')
        : t('workspace.timeline.partiallyCompleted');
    const counts: string[] = [];
    if (Number(tests.passed) > 0) counts.push(t('workspace.timeline.passedCount', { n: tests.passed }));
    if (Number(tests.failed) > 0) counts.push(t('workspace.timeline.failedCount', { n: tests.failed }));
    if (Number(tests.inconclusive) > 0) counts.push(t('workspace.timeline.inconclusiveCount', { n: tests.inconclusive }));
    if (Number(tests.unchecked) > 0) counts.push(t('workspace.timeline.uncheckedCount', { n: tests.unchecked }));
    return counts.length > 0 ? `${label} · ${counts.join(' · ')}` : label;
  }
  if (d.isCompleted === false) return t('workspace.timeline.checking');
  switch (d.status) {
    case 'superseded':
      return t('workspace.timeline.superseded');
    case 'unchecked':
      return t('workspace.timeline.notChecked');
    case 'error':
      return t('workspace.timeline.noVerdict');
  }
  const failed = verdicts.value.filter((v) => v.status === 'failed').length;
  if (failed > 0) return t('workspace.timeline.failedCount', { n: failed });
  if (verdicts.value.some((v) => v.status === 'inconclusive')) return t('workspace.timeline.inconclusiveCountShort');
  return verdicts.value.length > 0 ? t('workspace.timeline.verdictPassed') : t('workspace.timeline.done');
});

/** 按时间交错的 Thought / Work 段（多轮 turn 各占一段，平移语义）。 */
const streamEvents = computed(() => getSortedStepEvents(props.block.data));

function verdictIcon(status: string): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'inconclusive':
      return 'inconclusive';
    case 'superseded':
      return 'superseded';
    case 'unchecked':
      return 'unchecked';
    default:
      return 'pending';
  }
}

const defaultExpanded = computed<string[]>(() => [props.block.id]);
</script>

<template>
  <a-collapse :active-key="defaultExpanded" :bordered="false" class="checker-collapse" expandable>
    <a-collapse-item :key="block.id">
      <template #header>
        <div class="check-header" :class="`tone-${tone}`">
          <span class="phase-dot" :class="{ running: isRunning }" />
          <span class="check-title">{{ phaseLabel }}</span>
          <span v-if="block.data.phase !== 'outcome' && block.data.subgoal_text" class="check-subject" :title="block.data.subgoal_text">
            {{ block.data.subgoal_text }}
          </span>
          <span class="check-status">{{ statusLabel }}</span>
        </div>
      </template>

      <div class="check-body">
        <!-- 声明的检查项 -->
        <ol v-if="!isMuted && checkItems.length > 0" class="check-items">
          <li v-for="(item, i) in checkItems" :key="i" class="check-item">
            <span class="check-index">{{ i + 1 }}</span>
            <span class="check-text">{{ item.text }}</span>
            <span class="check-method">{{ checkMethodLabel(item) }}</span>
          </li>
        </ol>

        <!-- 按时间交错的 Thought / Work 流 -->
        <template v-for="(item, itemIdx) in streamEvents" :key="itemIdx">
          <div v-if="item.type === 'thinking' && item.data?.text" class="stream-section">
            <div class="stream-header">
              <span class="phase-dot done" />
              <span class="stream-label">{{ t('workspace.timeline.thought') }}</span>
            </div>
            <div class="stream-content" v-html="renderMarkdown(item.data.text)" />
          </div>
          <div
            v-else-if="item.type === 'text' && item.data?.text && item.data?.text.trim()"
            class="stream-section"
          >
            <div class="stream-header">
              <span class="phase-dot done" />
              <span class="stream-label">{{ t('workspace.timeline.work') }}</span>
            </div>
            <div class="stream-content" v-html="renderMarkdown(item.data.text)" />
          </div>
        </template>

        <!-- 逐项结论 -->
        <div v-if="hasResult" class="check-result" :class="`tone-${tone}`">
          <div
            v-for="(verdict, i) in verdicts"
            :key="i"
            class="check-verdict"
            :class="verdict.status"
          >
            <span class="check-index">{{ verdictItemNumber(verdict, i) }}</span>
            <span class="verdict-icon">
              <icon-check-circle v-if="verdictIcon(verdict.status) === 'passed'" />
              <icon-close-circle v-else-if="verdictIcon(verdict.status) === 'failed'" />
              <icon-question-circle v-else-if="verdictIcon(verdict.status) === 'inconclusive'" />

              <icon-history v-else-if="verdictIcon(verdict.status) === 'superseded'" />
              <icon-record v-else-if="verdictIcon(verdict.status) === 'unchecked'" />
              <icon-minus-circle v-else />
            </span>
            <span class="verdict-body">
              <span class="verdict-evidence">{{ verdict.evidence || verdictStatusText(verdict.status) }}</span>
              <span v-if="verdict.suggestion" class="verdict-suggestion">{{ verdict.suggestion }}</span>
            </span>
          </div>
          <div v-for="(note, i) in checkerNotes" :key="`note-${i}`" class="check-note">{{ note }}</div>
        </div>
      </div>
    </a-collapse-item>
  </a-collapse>
</template>

<style scoped>
.checker-collapse {
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  overflow: hidden;
}

.checker-collapse :deep(.arco-collapse-item-header) {
  background-color: var(--color-bg-2);
}

.checker-collapse :deep(.arco-collapse-item-content) {
  background-color: var(--color-bg-2);
  padding: 0;
}

.checker-collapse :deep(.arco-collapse-item-content-box) {
  padding: 0 12px 10px;
}

.check-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
  font-size: 13px;
}

.phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background-color: rgb(var(--purple-6));
}

.tone-passed .phase-dot {
  background-color: rgb(var(--green-6));
}

.tone-failed .phase-dot {
  background-color: rgb(var(--red-6));
}

.tone-inconclusive .phase-dot {
  background-color: rgb(var(--orange-6));
}

.tone-muted .phase-dot,
.phase-dot.done {
  background-color: var(--color-text-4);
}

.phase-dot.running {
  box-shadow: 0 0 6px rgb(var(--purple-6) / 60%);
  animation: checker-pulse 1.2s ease-in-out infinite;
}

@keyframes checker-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.check-title {
  font-weight: 700;
  color: var(--color-text-1);
  flex-shrink: 0;
}

.check-subject {
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.check-status {
  color: var(--color-text-3);
  font-size: 12px;
  flex-shrink: 0;
  margin-left: auto;
}

.check-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}

.check-items {
  margin: 0;
  padding: 0 0 0 4px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.check-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-1);
}

.check-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: rgb(var(--purple-6) / 15%);
  color: rgb(var(--purple-6));
  font-size: 11px;
  margin-top: 1px;
}

.check-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.check-method {
  flex-shrink: 0;
  color: var(--color-text-3);
  font-size: 11.5px;
  margin-left: auto;
}

.stream-section {
  border: 1px solid var(--color-border-1);
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-1);
  overflow: hidden;
}

.stream-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 600;
}

.stream-label {
  text-transform: none;
}

.stream-content {
  padding: 4px 12px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-1);
  max-height: 260px;
  overflow-y: auto;
  overflow-wrap: anywhere;
}

.stream-content :deep(pre) {
  overflow-x: auto;
  padding: 8px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
  font-size: 12px;
}

.stream-content :deep(.md-verify-badge) {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  font-family: monospace;
  font-size: 11px;
  color: rgb(var(--arcoblue-6));
  background-color: rgb(var(--arcoblue-6) / 12%);
}

.stream-content :deep(.md-verify-badge.assert) {
  color: rgb(var(--purple-6));
  background-color: rgb(var(--purple-6) / 12%);
}

.check-result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--border-radius-small);
  border: 1px solid var(--color-border-1);
}

.check-result.tone-passed {
  border-color: rgb(var(--green-6) / 30%);
  background-color: rgb(var(--green-1) / 30%);
}

.check-result.tone-failed {
  border-color: rgb(var(--red-6) / 30%);
  background-color: rgb(var(--red-1) / 30%);
}

.check-result.tone-inconclusive {
  border-color: rgb(var(--orange-6) / 30%);
  background-color: rgb(var(--orange-1) / 30%);
}

.check-verdict {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
}

.verdict-icon {
  display: inline-flex;
  font-size: 15px;
  margin-top: 1px;
}

.check-verdict.passed .verdict-icon {
  color: rgb(var(--green-6));
}

.check-verdict.failed .verdict-icon {
  color: rgb(var(--red-6));
}

.check-verdict.inconclusive .verdict-icon {
  color: rgb(var(--orange-6));
}

.check-verdict.superseded .verdict-icon,
.check-verdict.unchecked .verdict-icon {
  color: var(--color-text-4);
}

.check-verdict.superseded,
.check-verdict.unchecked {
  color: var(--color-text-3);
}

.verdict-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.verdict-evidence {
  overflow-wrap: anywhere;
  color: var(--color-text-1);
}

.verdict-suggestion {
  color: var(--color-text-3);
  font-size: 12px;
}

.check-note {
  color: var(--color-text-2);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}
</style>
