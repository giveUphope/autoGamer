<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCamera,
  IconCheckCircle,
  IconEye,
  IconFile,
  IconHistory,
  IconImage,
  IconLiveBroadcast,
  IconMindMapping,
  IconPauseCircle,
  IconPlayArrow,
  IconRight,
  IconSync,
} from '@arco-design/web-vue/es/icon';

import { usePlayerStore } from '@/stores/player';
import { useSessionStore } from '@/stores/session';
import { useStreamStore } from '@/stores/stream';
import { useTimelineStore } from '@/stores/timeline';
import { formatSessionTime, getTaskStatus, sessionStatusColor } from '@/utils/session-merge';
import { buildStartupWorkItems } from '@/utils/startup-progress';
import { checkPlanningLoader, formatTokenCount } from '@/utils/stream-aggregator';
import { isAndroidAction, isReportStatusAction } from '@/utils/action-formatter';
import { parseNote } from '@/utils/markdown';
import type { PhaseBlock, StepBlock } from '@/types/stream.model';
import ReplayDrawer from '@/components/session-extras/ReplayDrawer.vue';
import SessionTreeDrawer from '@/components/session-extras/SessionTreeDrawer.vue';
import CheckerPanel from './CheckerPanel.vue';
import NoteDocument from './NoteDocument.vue';
import NotesPanel from './NotesPanel.vue';
import RunInfoPopover from './RunInfoPopover.vue';
import StepCard from './StepCard.vue';

/**
 * 会话时间线容器（对应 Angular AgentStreamComponent 的 M2/M3 子集）：
 * - 选中会话变化时由 timeline store 重新拉取 steps/notes/checks 快照并渲染
 *   （快照回填语义见 stores/timeline.ts，§3.3 条款 2）；
 * - 会话头：当前会话的目标 / 状态 / 设备（选中历史会话后时间线可自证「在看哪个会话」）；
 * - 阶段分组（Worked for Xs · tokens）+ StepCard / CheckerPanel 路由；
 * - 启动准备块（startup_progress）与任务报告卡（output.md）；
 * - 顶部工具条：架构 chip（RunInfoPopover）+ 笔记与计划（NotesPanel）；
 * - M3 实时流：planning loader、LLM 重试警示条、任务暂停卡 + 恢复、
 *   自动滚动（接近底部才跟随，平移自 Angular scheduleAutoScroll）。
 */
const { t, tm } = useI18n();
const sessionStore = useSessionStore();
const streamStore = useStreamStore();
const timelineStore = useTimelineStore();
const playerStore = usePlayerStore();

timelineStore.start();

const notesPopoverOpen = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

// ---- 多轮对话流：每个任务是一轮（轮头 = 用户目标气泡），选中任务的轮身内嵌
// 其执行轨迹（步骤回合，惰性拉取）；未选中轮只显示摘要头，点击即选中展开。 ----

/** 对话轮列表：旧 → 新（聊天顺序；store 的 sessions 是最新在前，翻转渲染）。 */
const rounds = computed(() => {
  const list = [...sessionStore.sessions].reverse();
  return list.map((session) => {
    const status = getTaskStatus(session, sessionStore.runningSessionId, sessionStore.agentStatus);
    return {
      id: session.session_id,
      goal: session.initial_goal,
      status,
      statusText: t(`status.${status}`),
      statusColor: sessionStatusColor(status),
      time: formatSessionTime(session.start_time),
      isSelected: session.session_id === sessionStore.currentSessionId,
    };
  });
});

function selectRound(sessionId: string): void {
  if (sessionId !== sessionStore.currentSessionId) {
    sessionStore.selectSession(sessionId, true);
  }
}

/** 用户手动收起的选中轮。仅选中轮可收起；任何来源的选中切换都恢复展开。 */
const manuallyCollapsed = ref(new Set<string>());

watch(
  () => sessionStore.currentSessionId,
  () => {
    manuallyCollapsed.value = new Set<string>();
  },
);

function isRoundOpen(round: { id: string; isSelected: boolean }): boolean {
  return round.isSelected && !manuallyCollapsed.value.has(round.id);
}

function toggleRound(round: { id: string; isSelected: boolean }): void {
  if (!round.isSelected) {
    // 未选中轮：点击即选中展开
    selectRound(round.id);
    return;
  }
  const next = new Set(manuallyCollapsed.value);
  if (next.has(round.id)) {
    next.delete(round.id);
  } else {
    next.add(round.id);
  }
  manuallyCollapsed.value = next;
}

// ---- B6 轨迹树 / 步骤回放抽屉（仅点击时打开，抽屉自行按需拉取） ----
const treeDrawerVisible = ref(false);
const replayDrawerVisible = ref(false);

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

// ---- M3 实时流状态（平移自 Angular AgentStreamComponent L444-461 / L573-587）----

/** planning loader（平移自 showPlanningLoader：运行中、无活动流、且查看的是运行会话）。 */
const showPlanningLoader = computed(() =>
  checkPlanningLoader(
    timelineStore.filteredLogs,
    sessionStore.agentStatus === 'running',
    !sessionStore.currentSessionId || sessionStore.currentSessionId === sessionStore.runningSessionId,
  ),
);

const startupPreparationIsComplete = computed(() => {
  const items = startupWorkItems.value;
  return items.length > 0 && !items.some((item) => item.isActive);
});

/** 加载条展示条件（平移自 Angular html L1410：不在启动准备进行中时才显示）。 */
const showPlanningRow = computed(() =>
  showPlanningLoader.value
  && (startupWorkItems.value.length === 0
    || startupPreparationIsComplete.value
    || timelineStore.consolidatedBlocks.length > 0),
);

// ---- 回合级折叠：输出中的回合自动展开，输出完毕自动收起；点击头部手动开合 ----
// （放在 showPlanningLoader 之后：activePhaseId 的流间隙分支引用它，且下方 watch
//   immediate 会在 setup 期间同步求值 getter，前置会踩 const TDZ。）

/** 受控展开集合：回合 body 是否可见只由它决定，自动推进与手动点击都改写它。 */
const expandedPhaseIds = ref(new Set<string>());

/**
 * 活动回合 = 可见回合中的最后一个，且尚未输出完毕（任一块 isCompleted === false）。
 * 流间隙（运行中等待下一步，planning loader 可见）时回合尚未结束，仍视为活动。
 */
const activePhaseId = computed<string | null>(() => {
  const phases = visiblePhases.value;
  if (phases.length === 0) return null;
  const last = phases[phases.length - 1];
  if (last.blocks.some((block) => Boolean(block?.data) && block.data.isCompleted === false)) {
    return last.id;
  }
  if (sessionStore.agentStatus === 'running' && showPlanningLoader.value) return last.id;
  return null;
});

// 回合推进：新活动回合展开（旧回合随之收起）；活动结束（全部输出完毕）整体收起。
watch(
  activePhaseId,
  (id, prev) => {
    if (id) {
      if (id !== prev) {
        expandedPhaseIds.value = new Set([id]);
      }
    } else if (prev) {
      expandedPhaseIds.value = new Set();
    }
  },
  { immediate: true },
);

function isPhaseExpanded(phaseId: string): boolean {
  return expandedPhaseIds.value.has(phaseId);
}

function togglePhase(phaseId: string): void {
  const next = new Set(expandedPhaseIds.value);
  if (next.has(phaseId)) {
    next.delete(phaseId);
  } else {
    next.add(phaseId);
  }
  expandedPhaseIds.value = next;
}

// ---- B5 planning loader 轮换短语（平移自 PLANNING_LOADER_PHRASES 16 条 + 轮换 effect） ----

/** vue-i18n `tm()` 取数组消息：条目可能是字符串或编译 AST（含 source），统一归一为字符串。 */
function normalizeMessageValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'source' in value) {
    return String((value as { source?: unknown }).source ?? '');
  }
  return '';
}

const planningPhrases = computed<string[]>(() => {
  const messages: unknown = tm('workspace.timeline.planningPhrases');
  if (!Array.isArray(messages)) return [];
  return messages.map(normalizeMessageValue).filter((text) => text.length > 0);
});

/** 轮换间隔（母本 2800ms，游戏加载提示式轮换）。 */
const PLANNING_ROTATE_MS = 2800;
let planningPhraseIndex = 0;
let planningRotateTimer: ReturnType<typeof setInterval> | null = null;
const currentPlanningText = ref('');

function stopPlanningRotation(): void {
  if (planningRotateTimer !== null) {
    clearInterval(planningRotateTimer);
    planningRotateTimer = null;
  }
}

/** 仅 loader 可见时轮转（watch 启停 interval，避免常驻定时器；不可见 / 卸载时清理）。 */
watch(
  showPlanningLoader,
  (visible) => {
    if (visible) {
      const phrases = planningPhrases.value;
      if (phrases.length === 0 || planningRotateTimer) return;
      // 随机起点（母本：Math.floor(Math.random() * length)）
      planningPhraseIndex = Math.floor(Math.random() * phrases.length);
      currentPlanningText.value = phrases[planningPhraseIndex] ?? t('workspace.timeline.planning');
      planningRotateTimer = setInterval(() => {
        const list = planningPhrases.value;
        if (list.length === 0) return;
        planningPhraseIndex = (planningPhraseIndex + 1) % list.length;
        currentPlanningText.value = list[planningPhraseIndex] ?? t('workspace.timeline.planning');
      }, PLANNING_ROTATE_MS);
    } else {
      stopPlanningRotation();
    }
  },
  { immediate: true },
);

/** LLM 重试警示文案（组装自 stream store 的 retryInfo，语义对齐 Angular agent.service L932-933）。 */
const retryMessage = computed<string | null>(() => {
  if (!streamStore.isRetrying) return null;
  const info = streamStore.retryInfo;
  let text = t('workspace.timeline.retrying');
  if (info) {
    const attempt = Number(info.attempt) || 0;
    const maxRetries = Number(info.max_retries) || 0;
    const delay = Number(info.delay) || 0;
    if (attempt > 0 && maxRetries > 0) {
      text += t('workspace.timeline.retryAttempt', { attempt, max: maxRetries });
    }
    if (delay > 0) {
      text += t('workspace.timeline.retryDelay', { delay: formatRetryDelay(delay) });
    }
  }
  return `${text}…`;
});

/** 重试延迟展示：保留 1 位小数，整数不带 .0（如 2 → "2"、2.5 → "2.5"）。 */
function formatRetryDelay(delay: number): string {
  return delay.toFixed(1).replace(/\.0$/, '');
}

/** 查看中的会话是否为已暂停的当前任务（平移自 isViewingPausedTask：live 事件与轮询状态须一致）。 */
const isViewingPausedTask = computed(() => {
  if (!sessionStore.isPaused || sessionStore.agentStatus !== 'paused') return false;
  const currentSessionId = sessionStore.currentSessionId;
  return !currentSessionId || currentSessionId === sessionStore.runningSessionId;
});

/** 主列表可见性：内容之外，实时流状态条（loader / 重试 / 暂停）出现时也展示列表。 */
const hasListContent = computed(() =>
  anyContent.value
  || showPlanningLoader.value
  || isViewingPausedTask.value
  || Boolean(retryMessage.value),
);

// ---- 自动滚动（平移自 Angular scheduleAutoScroll：50ms 合批；仅当用户仍接近底部才跟随主容器）----
const AUTO_SCROLL_BOTTOM_THRESHOLD = 150;
const isUserAtBottom = ref(true);
let autoScrollTimer: ReturnType<typeof setTimeout> | null = null;
let autoScrollStreamBoxes = false;

function onScrollContainerScroll(): void {
  const container = scrollContainer.value;
  if (!container) return;
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  isUserAtBottom.value = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function scheduleAutoScroll(includeStreamBoxes: boolean): void {
  autoScrollStreamBoxes = autoScrollStreamBoxes || includeStreamBoxes;
  if (autoScrollTimer) return;
  autoScrollTimer = setTimeout(() => {
    autoScrollTimer = null;
    const includeBoxes = autoScrollStreamBoxes;
    autoScrollStreamBoxes = false;
    const container = scrollContainer.value;
    // 流文本盒（StepCard 的 .stream-text）在流式更新期间始终钉在底部；
    // 主容器仅在用户未向上滚离底部（150px 阈值）时跟随。
    const boxes = includeBoxes && container
      ? Array.from(container.querySelectorAll<HTMLElement>('.stream-text'))
      : [];
    const boxTargets = boxes.map((el) => el.scrollHeight);
    const containerTarget = container && isUserAtBottom.value ? container.scrollHeight : null;
    boxes.forEach((el, i) => { el.scrollTop = boxTargets[i]; });
    if (container && containerTarget !== null) {
      container.scrollTop = containerTarget;
    }
  }, 50);
}

// 有未完成 llm_stream 块（流式更新中）或块/文本变化时触发合批滚动
// （对应 Angular 的两个 effect：activeStream → includeStreamBoxes、blocks 变化 → 主容器）。
watch(
  () => timelineStore.consolidatedBlocks,
  (blocks) => {
    const hasActiveStream = blocks.some((block) => Boolean(block?.data) && block.data.isCompleted === false);
    scheduleAutoScroll(hasActiveStream);
  },
);

onMounted(() => {
  scrollContainer.value?.addEventListener('scroll', onScrollContainerScroll, { passive: true });
});

onBeforeUnmount(() => {
  if (autoScrollTimer) {
    clearTimeout(autoScrollTimer);
    autoScrollTimer = null;
  }
  stopPlanningRotation();
  scrollContainer.value?.removeEventListener('scroll', onScrollContainerScroll);
});

// ---- 任务报告卡（output.md，平移自 outputterReport / parsedOutputReport） ----
const outputterReport = computed(() => timelineStore.currentNotes['output.md'] || null);
const parsedOutputReport = computed(() => (outputterReport.value ? parseNote(outputterReport.value) : null));

function openOutputterNote(): void {
  timelineStore.selectNoteKey('output.md');
  notesPopoverOpen.value = true;
}

/** 恢复暂停任务（平移自 Angular resumePausedTask）。 */
function resumePausedTask(): void {
  void sessionStore.resumeTask();
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

// ---- M4 屏幕录像开关（平移自 Angular getScreenRecordingButtonTitle L1555-1574 的各态语义） ----
const recordButtonTitle = computed<string>(() => {
  if (sessionStore.isCurrentSessionRunning) return t('workspace.player.recordBtnRunning');
  if (playerStore.currentSessionRecordingStatus === 'processing') return t('workspace.player.recordBtnProcessing');
  if (playerStore.currentSessionVideoUrl) return t('workspace.player.recordBtnPlay');
  if (playerStore.hasCurrentSessionStepFrames) {
    return playerStore.currentSessionRecordingStatus === 'failed'
      ? t('workspace.player.recordBtnStepsFailed')
      : t('workspace.player.recordBtnSteps');
  }
  if (playerStore.currentSessionRecordingStatus === 'failed') return t('workspace.player.recordBtnFailed');
  return t('workspace.player.recordBtnDefault');
});

const recordButtonIcon = computed(() => {
  if (sessionStore.isCurrentSessionRunning) return IconLiveBroadcast;
  if (playerStore.currentSessionRecordingStatus === 'processing') return IconSync;
  if (playerStore.currentSessionVideoUrl) return IconPlayArrow;
  if (playerStore.hasCurrentSessionStepFrames) return IconImage;
  return IconCamera;
});

const isRecordBtnProcessing = computed(
  () => !sessionStore.isCurrentSessionRunning && playerStore.currentSessionRecordingStatus === 'processing',
);

</script>

<template>
  <section class="agent-timeline">
    <!-- 会话工具行：操作按钮（属于选中的那轮任务） -->
    <div v-if="anyContent" class="timeline-toolbar">
      <div class="toolbar-actions">
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
        <a-button
          size="small"
          class="record-btn"
          :class="{ 'is-processing': isRecordBtnProcessing }"
          :title="recordButtonTitle"
          @click="playerStore.toggleVideoPlayer()"
        >
          <template #icon>
            <component :is="recordButtonIcon" :class="{ 'record-spin': isRecordBtnProcessing }" />
          </template>
          {{ t('workspace.player.recordBtnDefault') }}
        </a-button>
        <!-- B6：轨迹树 / 步骤回放入口（点击时才拉取数据） -->
        <a-button size="small" class="tree-btn" @click="treeDrawerVisible = true">
          <template #icon><icon-mind-mapping /></template>
          {{ t('workspace.tree.button') }}
        </a-button>
        <a-button size="small" class="replay-btn" @click="replayDrawerVisible = true">
          <template #icon><icon-history /></template>
          {{ t('workspace.replay.button') }}
        </a-button>
      </div>
    </div>

    <main ref="scrollContainer" class="timeline-content">
      <a-spin v-if="timelineStore.isSessionContentLoading" :loading="true" class="loading-state">
        <div class="loading-inner">{{ t('workspace.timeline.loadingRunHistory') }}</div>
      </a-spin>

      <!-- 多轮对话流：一个任务一轮，轮头是用户目标气泡；选中轮的轮身内嵌其执行轨迹 -->
      <div v-else-if="rounds.length === 0" class="empty-state">
        <a-empty :description="t('workspace.timeline.emptyTitle')" />
        <div class="empty-hint">{{ t('workspace.timeline.emptyHint') }}</div>
      </div>

      <div v-else class="rounds-list">
        <div
          v-for="round in rounds"
          :key="round.id"
          class="round-block"
          :class="{ active: round.isSelected }"
        >
          <div
            class="round-head"
            role="button"
            :aria-expanded="isRoundOpen(round)"
            @click="toggleRound(round)"
          >
            <icon-right
              class="round-chevron"
              :class="{ expanded: isRoundOpen(round) }"
            />
            <a-tag :color="round.statusColor" size="small" class="round-status">
              {{ round.statusText }}
            </a-tag>
            <span class="round-goal" :title="round.goal">{{ round.goal }}</span>
            <span class="round-time">{{ round.time }}</span>
          </div>

          <div v-if="isRoundOpen(round)" class="round-body">
            <template v-if="hasListContent">
              <!-- LLM 重试警示条（M3：stream store isRetrying 驱动，文案由 retryInfo 组装） -->
              <div v-if="retryMessage" class="retry-banner" role="alert">
                <icon-sync class="spin-icon" />
                <span class="retry-text">{{ retryMessage }}</span>
              </div>

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

              <!-- 阶段分组（回合块）：输出中的回合自动展开，完毕自动收起；点击头部手动开合 -->
              <div
                v-for="phase in visiblePhases"
                :key="phase.id"
                class="phase-container"
                :class="{ collapsed: !isPhaseExpanded(phase.id) }"
              >
                <div
                  class="phase-header"
                  role="button"
                  :aria-expanded="isPhaseExpanded(phase.id)"
                  @click="togglePhase(phase.id)"
                >
                  <icon-right class="phase-chevron" :class="{ expanded: isPhaseExpanded(phase.id) }" />
                  <span class="phase-worked-time">
                    {{ isCheckerPhase(phase)
                      ? t('workspace.timeline.checkedFor', { seconds: phase.durationSeconds })
                      : t('workspace.timeline.workedFor', { seconds: phase.durationSeconds }) }}
                  </span>
                  <span v-if="phase.tokens" class="phase-token-usage" :title="formatTokenCount(phase.tokens)">
                    · {{ formatTokenCount(phase.tokens) }}
                  </span>
                  <span class="phase-step-count">
                    {{ t('workspace.timeline.stepsCount', { n: phase.blocks.length }) }}
                  </span>
                </div>
                <div v-show="isPhaseExpanded(phase.id)" class="phase-body">
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

              <!-- Planning loader（M3：运行中等待下一步，平移自 Angular html L1410 展示条件；
                B5：文案为轮换短语之一，随机起点 + 2.8s 间隔，`planning` 键保留为兜底文案） -->
              <div v-if="showPlanningRow" class="planning-loader" aria-live="polite">
                <icon-sync class="spin-icon" />
                <span>{{ currentPlanningText || t('workspace.timeline.planning') }}</span>
              </div>

              <!-- 任务暂停卡（M3：isViewingPausedTask，恢复按钮走 sessionStore.resumeTask） -->
              <div v-if="isViewingPausedTask" class="paused-card" role="alert">
                <div class="paused-header">
                  <icon-pause-circle />
                  <span class="paused-title">{{ t('workspace.timeline.pausedTitle') }}</span>
                </div>
                <div v-if="sessionStore.pausedError" class="paused-error">{{ sessionStore.pausedError }}</div>
                <div class="paused-footer">
                  <a-button size="small" type="primary" @click="resumePausedTask">
                    <template #icon><icon-play-arrow /></template>
                    {{ t('workspace.timeline.continueTask') }}
                  </a-button>
                  <span class="paused-hint">{{ t('workspace.timeline.resumeHint') }}</span>
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
            </template>

            <div v-else class="round-empty">
              {{ t('workspace.timeline.roundEmpty') }}
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- B6：轨迹树 / 步骤回放抽屉（数据由抽屉打开时按需拉取，不进 store） -->
    <SessionTreeDrawer v-model:visible="treeDrawerVisible" :session-id="sessionStore.currentSessionId" />
    <ReplayDrawer v-model:visible="replayDrawerVisible" :session-id="sessionStore.currentSessionId" />
  </section>
</template>

<style scoped>
.agent-timeline {
  /* 占满 main 剩余高度（底部还有输入区 CommandDock），而非固定 100% 把它挤出可视区 */
  flex: 1;
  min-height: 0;
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

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.notes-btn {
  font-size: 12px;
}

.record-btn {
  font-size: 12px;
}

.record-spin {
  animation: timeline-spin 1.2s linear infinite;
}

.timeline-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 内容（长 token 数/坐标/流文本）不得撑出横向滚动条 */
  overflow-x: hidden;
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
  padding: 44px 0;
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

/* ---- 多轮对话流 ---- */
.rounds-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.round-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 轮头 = 用户目标气泡：底色区分「用户说」与「agent 做」 */
.round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  border-radius: var(--border-radius-medium);
  background-color: var(--color-fill-1);
  cursor: pointer;
  transition: background-color 0.15s;
}

.round-chevron {
  flex-shrink: 0;
  color: var(--color-text-3);
  transition: transform 0.15s;
}

.round-chevron.expanded {
  transform: rotate(90deg);
}

.round-head:hover {
  background-color: var(--color-fill-2);
}

.round-block.active .round-head {
  background-color: var(--color-fill-2);
}

.round-status {
  flex-shrink: 0;
}

.round-goal {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.round-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
}

/* 轮身 = 选中任务的执行轨迹；左侧竖线表达「属于这一轮」 */
.round-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-left: 6px;
  padding-left: 12px;
  border-left: 2px solid var(--color-border-2);
  min-width: 0;
}

.round-empty {
  padding: 14px 12px;
  border: 1px dashed var(--color-border-2);
  border-radius: var(--border-radius-medium);
  color: var(--color-text-3);
  font-size: 12.5px;
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
  cursor: pointer;
  user-select: none;
  border-radius: var(--border-radius-small);
  padding: 2px 4px 4px;
  transition: background-color 0.15s, color 0.15s;
}

.phase-header:hover {
  background-color: var(--color-fill-2);
  color: var(--color-text-2);
}

.phase-chevron {
  flex-shrink: 0;
  transition: transform 0.15s;
}

.phase-chevron.expanded {
  transform: rotate(90deg);
}

.phase-step-count {
  margin-left: auto;
  flex-shrink: 0;
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

.retry-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--orange-6) / 40%);
  border-radius: var(--border-radius-medium);
  background-color: rgb(var(--orange-1) / 40%);
  color: rgb(var(--orange-6));
  font-size: 12.5px;
}

.planning-loader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  color: var(--color-text-2);
  font-size: 12.5px;
}

.spin-icon {
  flex-shrink: 0;
  animation: timeline-spin 1.2s linear infinite;
}

@keyframes timeline-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.paused-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgb(var(--orange-6) / 45%);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
}

.paused-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(var(--orange-6));
  font-weight: 600;
  font-size: 13px;
}

.paused-error {
  color: var(--color-text-1);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.paused-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.paused-hint {
  color: var(--color-text-3);
  font-size: 12px;
}
</style>
