<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconCheckCircle, IconEye, IconFile } from '@arco-design/web-vue/es/icon';

import { useSessionStore } from '@/stores/session';
import { useTimelineStore } from '@/stores/timeline';
import { buildStartupWorkItems } from '@/utils/startup-progress';
import { formatTokenCount } from '@/utils/stream-aggregator';
import { isAndroidAction, isReportStatusAction } from '@/utils/action-formatter';
import { parseNote } from '@/utils/markdown';
import type { PhaseBlock, StepBlock } from '@/types/stream.model';
import CheckerPanel from './CheckerPanel.vue';
import NoteDocument from './NoteDocument.vue';
import NotesPanel from './NotesPanel.vue';
import RunInfoPopover from './RunInfoPopover.vue';
import StepCard from './StepCard.vue';

/**
 * 会话时间线容器（对应 Angular AgentStreamComponent 的 M2 子集）：
 * - 选中会话变化时由 timeline store 重新拉取 steps/notes/checks 快照并渲染
 *   （快照回填语义见 stores/timeline.ts，§3.3 条款 2）；
 * - 阶段分组（Worked for Xs · tokens）+ StepCard / CheckerPanel 路由；
 * - 启动准备块（startup_progress）与任务报告卡（output.md）；
 * - 顶部工具条：架构 chip（RunInfoPopover）+ 笔记与计划（NotesPanel）。
 * M3 在此容器接入实时流（打字机 / 暂停 / 重试卡片）；M4 接入录像按钮。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();
const timelineStore = useTimelineStore();

timelineStore.start();

const notesPopoverOpen = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

// ---- 启动准备（平移自 startupWorkItems computed） ----
const startupWorkItems = computed(() => {
  const agentIsActive = ['running', 'paused'].includes(sessionStore.agentStatus);
  return buildStartupWorkItems(
    timelineStore.currentStartupProgress,
    Date.now() / 1000,
    timelineStore.consolidatedBlocks.length > 0,
    agentIsActive,
  );
});

const startupPreparationDuration = computed<number>(() => {
  const items = startupWorkItems.value;
  if (items.length === 0) return 0;
  const events = timelineStore.currentStartupProgress;
  const startedAt = events[0]?.timestamp || items[0].timestamp;
  const completedAt = events.find((event) => event.stage === 'environment_ready')?.timestamp
    || events.find((event) => event.stage === 'first_response')?.timestamp;
  const isRunning = items.some((item) => item.isActive);
  const endedAt = isRunning ? Date.now() / 1000 : completedAt || Math.max(...items.map((item) => item.timestamp));
  return Math.max(1, Math.round(endedAt - startedAt));
});

// ---- 阶段与可见性（平移自 hasVisibleBlocks / hasVisibleContent） ----
function hasVisibleContent(block: StepBlock): boolean {
  if (!block) return false;
  if (block.type === 'checker') return true;
  const d = block.data || {};
  const hasNative = Boolean(typeof d.operator_native_thinking === 'string' && d.operator_native_thinking.trim());
  const hasRaw = Boolean(typeof d.operator_raw_thinking === 'string' && d.operator_raw_thinking.trim() && d.operator_raw_thinking);
  const hasVisibleTools = Boolean(d.generic_tools) && d.generic_tools.some((tool: any) => Boolean(tool && tool.name && tool.type !== 'llm_call' && tool.type !== 'agent' && tool.type !== 'log'));
  const hasAndroidActions = Boolean(d.action_taken)
    && (isAndroidAction(d.action_taken) || isReportStatusAction(d.action_taken));
  return hasNative || hasRaw || hasVisibleTools || hasAndroidActions;
}

function hasVisibleBlocks(phase: PhaseBlock): boolean {
  return phase.blocks.some((b) => hasVisibleContent(b));
}

function isCheckerPhase(phase: PhaseBlock): boolean {
  return phase.blocks.length > 0 && phase.blocks.every((b) => b.type === 'checker');
}

const visiblePhases = computed(() => timelineStore.phases.filter(hasVisibleBlocks));

const anyContent = computed(
  () => visiblePhases.value.length > 0 || startupWorkItems.value.length > 0,
);

// ---- 任务报告卡（output.md，平移自 outputterReport / parsedOutputReport） ----
const outputterReport = computed(() => timelineStore.currentNotes['output.md'] || null);
const parsedOutputReport = computed(() => (outputterReport.value ? parseNote(outputterReport.value) : null));

function openOutputterNote(): void {
  timelineStore.selectNoteKey('output.md');
  notesPopoverOpen.value = true;
}

// ---- 会话切换后滚动到底部（平移自 Angular 的 setTimeout 滚动） ----
watch(
  () => sessionStore.currentSessionId,
  () => {
    void nextTick(() => {
      setTimeout(() => {
        const container = scrollContainer.value;
        if (container) container.scrollTop = container.scrollHeight;
      }, 100);
    });
  },
);
</script>

<template>
  <section class="agent-timeline">
    <!-- 浮动工具条（有内容时显示）：架构 chip + 笔记与计划 -->
    <div v-if="anyContent" class="timeline-toolbar">
      <RunInfoPopover />
      <a-popover v-model:popup-visible="notesPopoverOpen" position="bl" trigger="click">
        <a-button size="small" class="notes-btn">
          <template #icon><icon-file /></template>
          {{ t('workspace.timeline.notes') }}
        </a-button>
        <template #content>
          <div class="notes-popover-body">
            <div class="notes-popover-title">{{ t('workspace.timeline.notes') }}</div>
            <NotesPanel />
          </div>
        </template>
      </a-popover>
    </div>

    <main ref="scrollContainer" class="timeline-content">
      <a-spin v-if="timelineStore.isSessionContentLoading" :loading="true" class="loading-state">
        <div class="loading-inner">{{ t('workspace.timeline.loadingRunHistory') }}</div>
      </a-spin>

      <div v-else-if="!anyContent" class="empty-state">
        <a-empty :description="t('workspace.timeline.emptyTitle')" />
        <div class="empty-hint">{{ t('workspace.timeline.emptyHint') }}</div>
      </div>

      <div v-else class="logs-list">
        <!-- 启动准备块 -->
        <div v-if="startupWorkItems.length > 0" class="phase-container startup-phase">
          <div class="phase-header">
            <span class="phase-worked-time">{{ t('workspace.timeline.workedFor', { seconds: startupPreparationDuration }) }}</span>
          </div>
          <div class="phase-body">
            <div class="startup-rows">
              <div v-for="item in startupWorkItems" :key="item.stage" class="startup-row">
                <span class="startup-dot" :class="{ active: item.isActive }" />
                <span>
                  {{ item.message }}
                  ·
                  {{ item.isActive
                    ? t('workspace.timeline.waiting', { time: item.elapsed })
                    : t('workspace.timeline.waited', { time: item.elapsed }) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 阶段分组（每块一个阶段头：Worked/Checked for Xs · tokens） -->
        <div v-for="phase in visiblePhases" :key="phase.id" class="phase-container">
          <div class="phase-header">
            <span class="phase-worked-time">
              {{ isCheckerPhase(phase)
                ? t('workspace.timeline.checkedFor', { seconds: phase.durationSeconds })
                : t('workspace.timeline.workedFor', { seconds: phase.durationSeconds }) }}
            </span>
            <span v-if="phase.tokens" class="phase-token-usage" :title="formatTokenCount(phase.tokens)">
              · {{ formatTokenCount(phase.tokens) }}
            </span>
          </div>
          <div class="phase-body">
            <template v-for="block in phase.blocks" :key="block.id">
              <CheckerPanel v-if="block.type === 'checker'" :block="block" />
              <StepCard
                v-else
                :block="block"
                :session-active="sessionStore.isCurrentSessionRunning"
                @open-note="timelineStore.selectNoteKey($event)"
              />
            </template>
          </div>
        </div>

        <!-- 任务报告卡（output.md，渲染一次于时间线末尾） -->
        <div v-if="parsedOutputReport" class="report-card">
          <div class="report-header">
            <span class="report-title">
              <icon-check-circle />
              {{ t('workspace.timeline.taskReport') }}
            </span>
            <a-button size="mini" type="text" @click="openOutputterNote">
              <template #icon><icon-eye /></template>
              {{ t('workspace.timeline.viewInNotes') }}
            </a-button>
          </div>
          <div class="report-preview">
            <NoteDocument :parsed="parsedOutputReport" />
          </div>
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.agent-timeline {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.timeline-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 0 10px;
}

.notes-btn {
  font-size: 12px;
}

.timeline-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px;
}

.loading-state {
  display: block;
  width: 100%;
  padding: 40px 0;
}

.loading-inner {
  padding: 20px;
  color: var(--color-text-3);
  font-size: 13px;
}

.empty-state {
  padding: 60px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.empty-hint {
  margin-top: 8px;
  color: var(--color-text-3);
  font-size: 13px;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.phase-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.phase-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-3);
}

.phase-worked-time {
  font-weight: 600;
}

.phase-token-usage {
  font-variant-numeric: tabular-nums;
}

.phase-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.startup-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  font-size: 12.5px;
  color: var(--color-text-2);
}

.startup-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.startup-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-text-4);
  flex-shrink: 0;
}

.startup-dot.active {
  background-color: rgb(var(--green-6));
  animation: startup-pulse 1.2s ease-in-out infinite;
}

@keyframes startup-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.report-card {
  border: 1px solid rgb(var(--green-6) / 35%);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  overflow: hidden;
}

.report-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: rgb(var(--green-1) / 40%);
}

.report-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13px;
  color: rgb(var(--green-6));
}

.report-preview {
  padding: 10px 12px;
  max-height: 320px;
  overflow-y: auto;
}

.notes-popover-body {
  width: 420px;
  max-width: 76vw;
}

.notes-popover-title {
  font-weight: 700;
  font-size: 13px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-2);
  margin-bottom: 8px;
}
</style>
