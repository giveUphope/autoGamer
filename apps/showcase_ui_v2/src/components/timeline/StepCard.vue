<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCamera,
  IconCheckCircle,
  IconCloseCircle,
  IconExclamationCircle,
  IconFile,
  IconMindMapping,
  IconPlayArrow,
  IconRight,
  IconSync,
} from '@arco-design/web-vue/es/icon';

import { usePlayerStore } from '@/stores/player';
import { useSessionStore } from '@/stores/session';
import { useTimelineStore } from '@/stores/timeline';
import { DEFAULT_STREAM_RESET_MESSAGE } from '@/types/stream.model';
import type { StepBlock, StepEvent, ActionParam } from '@/types/stream.model';
import {
  extractActionExtraParams,
  getActionBounds,
  getActionClass,
  getActionCoords,
  getActionErrorMessage,
  getActionIcon,
  getActionInputLabel,
  getActionInputText,
  getActionTargetText,
  getActionTitle,
  isActionFailed,
  isAndroidAction,
  isKeyAction,
  isReportStatusAction,
  getReportStatusValue,
  getReportStatusExplanation,
  getStepPostImageUrl,
  getStepPreImageUrl,
} from '@/utils/action-formatter';
import {
  cleanErrorMessage,
  extractToolExtraParams,
  formatVideoTime,
  getAdbCommandLine,
  getAdbCwd,
  getAdbTerminalId,
  getCompressionPhaseLabel,
  getToolAgentName,
  getToolAnalysisText,
  getToolCoords,
  getToolDisplayLabel,
  getToolErrorMessage,
  getToolGenericDetails,
  getToolInputLabel,
  getToolInputText,
  getToolIcon,
  getToolKey,
  getToolTargetText,
  getToolTitle,
  getVideoAnalysisView,
  isAdbCommandTool,
  isCompressionTool,
  isDeviceActionTool,
  isHumanThinking,
  isNoteTool,
  isToolFailed,
  isVideoTool,
  shouldShowTool,
  getUniqueGenericTools,
} from '@/utils/tool-formatter';
import { formatTokenCount, getSortedStepEvents, isBackendSwitchNote } from '@/utils/stream-aggregator';
import { renderMarkdown } from '@/utils/markdown';
import { useStreamTypewriter } from './useTypewriter';

/**
 * 单步动作卡片（对应 Angular agent-stream 的 step/llm_stream 块，UI 按 Arco 重做）：
 * 思考（Thought）/ 执行（Work）流文本（markdown 安全渲染）、任务报告卡、
 * Android 动作卡（目标 / 输入 / 坐标 / 前后截图）、工具行与工具卡、LLM 重试与失败卡。
 * 字段取值全部平移自 action-formatter / tool-formatter util（以 Angular 实际字段为准）。
 */
const { t } = useI18n();

const props = defineProps<{
  block: StepBlock;
  /** 当前会话是否处于运行/暂停态（历史会话为 false，所有条目视为已完成）。 */
  sessionActive: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-note', key: string): void;
  /** 在轨迹树抽屉中定位查看该动作的轨迹（全树展开定位）。 */
  (e: 'view-trace', traceId: string): void;
}>();

const sessionStore = useSessionStore();
const timelineStore = useTimelineStore();
const playerStore = usePlayerStore();

// ---- 展开状态（标准手风琴：默认收起仅标题行，点击展开完整详情；流文本块同模式） ----
const expandedCards = reactive(new Set<string>());
const streamCollapsed = reactive(new Set<string>());

function toggleCard(cardId: string): void {
  if (expandedCards.has(cardId)) expandedCards.delete(cardId);
  else expandedCards.add(cardId);
}

function toggleStream(key: string): void {
  if (streamCollapsed.has(key)) streamCollapsed.delete(key);
  else streamCollapsed.add(key);
}

// ---- 事件时间线（文本 / 工具 / 动作按时间交错，平移自 getSortedStepEvents） ----
const sortedEvents = computed<StepEvent[]>(() => getSortedStepEvents(props.block.data));

const eventKey = (item: StepEvent, index: number): string => {
  if (item.type === 'thinking' || item.type === 'text') return item.type;
  return (
    item.type
    + '-'
    + (item.data?.trace_id
      || item.data?.timestamp
      || item.data?.start_time
      || item.data?.created_at
      || item.data?.id
      || (item.data?.action || item.data?.name || '') + '-' + index)
  );
};

// ---- 步骤头（步骤号 / 耗时 / token：字段取自 StepItemData 实际字段） ----
const stepNumber = computed<number | null>(() => {
  const n = Number(props.block.data?.step_number);
  return Number.isFinite(n) && props.block.data?.step_number !== undefined && props.block.data?.step_number !== null
    ? n
    : null;
});

const durationSeconds = computed<number | null>(() => {
  const d = Number(props.block.data?.duration);
  return Number.isFinite(d) && d > 0 ? Math.max(1, Math.round(d)) : null;
});

const tokenCount = computed<number | null>(() => {
  const direct = Number(props.block.data?.total_tokens);
  const fromUsage = Number(props.block.data?.token_usage?.total_tokens);
  const n = direct > 0 ? direct : fromUsage;
  return Number.isFinite(n) && n > 0 ? n : null;
});

// ---- 流文本（平移自 getThinkingTexts，含 JSON 检测启发式） ----
const nativeThinking = computed<string | null>(() => {
  const text = props.block.data?.operator_native_thinking;
  return typeof text === 'string' && text.trim() ? text : null;
});

const rawThinking = computed<string | null>(() => {
  const text = props.block.data?.operator_raw_thinking;
  return typeof text === 'string' && text.trim() && isHumanThinking(text) ? text : null;
});

// ---- 断流重置提示（M3：llm_stream 块被服务端重置时，聚合器把 isReset / resetMessage
// 透传到 block.data；文案优先后端 resetMessage，缺省 DEFAULT_STREAM_RESET_MESSAGE。
// B5 补齐 isWaiting 语义：流未完成显示等待态（旋转指示）；已完成时按 Angular
// formatResetMessage 去掉 "Retrying automatically..." 尾缀） ----
const streamResetWaiting = computed(
  () => Boolean(props.block.data?.isReset) && props.block.data?.isCompleted === false,
);

const streamResetNotice = computed<string | null>(() => {
  const data = props.block.data;
  if (!data?.isReset) return null;
  const message = data.resetMessage || DEFAULT_STREAM_RESET_MESSAGE;
  const finalMessage =
    typeof message === 'string' && message.trim() ? message : DEFAULT_STREAM_RESET_MESSAGE;
  return streamResetWaiting.value ? finalMessage : formatResetMessage(finalMessage);
});

function formatResetMessage(message: string): string {
  return message.replace(/[,.\s]*(?:Retrying automatically(?:\.{3}|\.\.\.)?)\s*$/i, '').trim();
}

// ---- B5 打字机（平移自 Angular typedTexts 体系，节奏与 rewind 见 useTypewriter.ts） ----
// 块每次因流式 chunk 更新都会以新对象出现（聚合器整体重建块），以它为 watch 源驱动 sync。
const typewriter = useStreamTypewriter();

watch(
  () => [props.block, props.sessionActive] as const,
  ([block]) => {
    typewriter.syncStreamBlock({
      blockId: block.id,
      nativeText: nativeThinking.value,
      rawText: rawThinking.value,
      live: block.data?.isCompleted === false,
      isReset: Boolean(block.data?.isReset),
    });
  },
  { immediate: true },
);

// 渲染切片：live 流随打字机 tick 增长；历史 / 已完成块为全文
const nativeStreamText = computed<string | null>(() => {
  const text = nativeThinking.value;
  return text ? typewriter.typedNative(props.block.id, text) : null;
});

const rawStreamText = computed<string | null>(() => {
  const text = rawThinking.value;
  return text ? typewriter.typedRaw(props.block.id, text) : null;
});

// ---- 工具行辅助 ----
function toolLabel(tool: any): string {
  return getToolDisplayLabel(tool, isFirstSaveNote(tool));
}

/** 每个 note key 的第一次 save_note 显示为「创建笔记」（平移自 firstSaveNoteByKey，
 *  扫描范围是整个会话的 consolidatedBlocks，与 Angular 版一致）。 */
function isFirstSaveNote(tool: any): boolean {
  if (!tool || String(tool.name || '').toLowerCase() !== 'save_note') return false;
  const key = getToolKey(tool);
  if (!key) return true;
  const firstByKey = new Map<string, any>();
  for (const block of timelineStore.consolidatedBlocks) {
    if (block.type !== 'step') continue;
    for (const cand of getUniqueGenericTools(block.data?.generic_tools)) {
      if (String(cand?.name || '').toLowerCase() === 'save_note') {
        const candKey = getToolKey(cand);
        if (candKey && !firstByKey.has(candKey)) {
          firstByKey.set(candKey, cand);
        }
      }
    }
  }
  const firstCall = firstByKey.get(key);
  if (!firstCall) return true;
  return tool.trace_id && firstCall.trace_id
    ? tool.trace_id === firstCall.trace_id
    : tool === firstCall;
}

function compressionTitle(tool: any): string | null {
  return isCompressionTool(tool) ? getCompressionPhaseLabel(tool) : null;
}

function adbCommandValue(tool: any): string {
  return getAdbCommandLine(tool);
}

function actionParams(item: StepEvent): ActionParam[] {
  return extractActionExtraParams(item.data);
}

function toolParams(item: StepEvent): ActionParam[] {
  return extractToolExtraParams(item.data);
}

// 与 Angular 组件内 isLLMRetry / isDisplayableLLMFailure 判定一致
function isLLMRetry(tool: any): boolean {
  return (
    tool?.type === 'llm_call'
    && tool?.status === 'retrying'
    && tool?.payload?.source === 'provider_sdk'
    && ['google', 'gemini'].includes(String(tool?.payload?.provider || '').toLowerCase())
  );
}

function isDisplayableLLMFailure(tool: any): boolean {
  return (
    tool?.type === 'llm_call'
    && tool?.status === 'failed'
    && (tool?.name === 'llm_pause' || tool?.payload?.pause === true)
  );
}

function failureErrorText(tool: any): string {
  const noDetails = t('workspace.timeline.noErrorDetails');
  if (!tool) return noDetails;
  const rawError = tool.payload?.error || tool.error;
  if (!rawError) return noDetails;
  const cleaned = cleanErrorMessage(rawError);
  return cleaned === 'Unknown error' ? noDetails : cleaned;
}

function llmRetries(tool: any): any[] {
  const retries = tool?.payload?.retries;
  return Array.isArray(retries) && retries.length > 0 ? retries : [tool?.payload || tool];
}

function retryDelayText(entry: any): string | null {
  const delay = Number(entry?.delay);
  if (!Number.isFinite(delay) || delay <= 0) return null;
  return `${delay.toFixed(2).replace(/\.00$/, '')}s`;
}

function retryWaitedText(entry: any): string {
  const delay = Number(entry?.delay);
  if (!Number.isFinite(delay) || delay <= 0) return '0s';
  // M2 无实时流：重试均已结束，展示完整延迟时长
  if (delay < 10) return `${delay.toFixed(1).replace(/\.0$/, '')}s`;
  return `${Math.round(delay)}s`;
}

function isRetryEntry(entry: any): boolean {
  return (
    entry?.source === 'provider_sdk'
    && ['google', 'gemini'].includes(String(entry?.provider || '').toLowerCase())
  );
}

function llmFailureRetries(tool: any): any[] {
  const retries = tool?.payload?.retries;
  if (!Array.isArray(retries)) return [];
  return retries.filter((retry: any) => isRetryEntry(retry));
}

function llmFailureWaited(tool: any): string | null {
  const waited = Number(tool?.payload?.waited_seconds);
  if (!Number.isFinite(waited) || waited < 0) return null;
  if (waited < 0.05) return '0s';
  if (waited < 10) return `${waited.toFixed(1).replace(/\.0$/, '')}s`;
  return `${Math.round(waited)}s`;
}

function isTerminalFailure(tool: any): boolean {
  return Boolean(tool?.name === 'llm_pause' || tool?.payload?.pause === true) && props.sessionActive;
}

function backendSwitchMessage(tool: any): string {
  return String(tool?.payload?.message || t('workspace.timeline.backendSwitch'));
}

function hasToolDetails(item: StepEvent): boolean {
  return Boolean(
    getToolTargetText(item.data)
    || getToolInputText(item.data)
    || getToolCoords(item.data)
    || getToolAnalysisText(item.data)
    || getToolGenericDetails(item.data)
    || toolParams(item).length > 0,
  );
}

// ---- M4：video_analysis 工具行 → 打开录像回放（平移自 Angular onVideoToolClick L1547-1553） ----

/** 视频分析请求区间标签（平移自 getVideoAnalysisRangeLabel；无区间时回退「屏幕录像」）。 */
function videoRangeLabel(tool: any): string {
  const range = getVideoAnalysisView(tool)?.requestedRange;
  if (!range) return t('workspace.player.screenRecording');
  return `${formatVideoTime(range.start)}–${formatVideoTime(range.end)}`;
}

function videoPillTitle(tool: any): string {
  return t('workspace.player.openAtRange', { range: videoRangeLabel(tool) });
}

/** 分段保存进度（平移自 getVideoAnalysisDetail 的 partial/running 文案）。 */
function videoDetailText(tool: any): string {
  const view = getVideoAnalysisView(tool);
  if (!view || view.totalCount <= 1) return '';
  if (view.outcome === 'running' || view.outcome === 'recovering' || view.outcome === 'partial') {
    return view.completedCount > 0
      ? t('workspace.player.segmentsSaved', { completed: view.completedCount, total: view.totalCount })
      : '';
  }
  return '';
}

function onVideoToolClick(tool: any): void {
  const curSessionId = sessionStore.currentSessionId;
  if (curSessionId) {
    const start = getVideoAnalysisView(tool)?.requestedRange?.start;
    playerStore.openVideoPlayer(curSessionId, undefined, undefined, start);
  }
}

function resumePausedTask(): void {
  void sessionStore.resumeTask();
}
</script>

<template>
  <div class="step-card">
    <div v-if="stepNumber !== null || durationSeconds || tokenCount" class="step-meta">
      <a-tag v-if="stepNumber !== null" size="small" color="gray">
        {{ t('workspace.timeline.stepLabel', { n: stepNumber }) }}
      </a-tag>
      <span v-if="durationSeconds" class="meta-item">{{ t('workspace.timeline.workedFor', { seconds: durationSeconds }) }}</span>
      <span v-if="tokenCount" class="meta-item" :title="formatTokenCount(tokenCount)">{{ formatTokenCount(tokenCount) }}</span>
    </div>

    <!-- 断流重置提示（M3：isReset 透传自 llm_stream 聚合块，后端语义文案不 i18n；
      B5：isWaiting 语义——流未完成显示等待态旋转指示） -->
    <div v-if="streamResetNotice" class="reset-row" role="alert">
      <icon-sync v-if="streamResetWaiting" class="spin-icon" />
      <icon-exclamation-circle v-else />
      <span>{{ streamResetNotice }}</span>
    </div>

    <!-- Thought（原生思考流；B5：live 流逐字符打出，历史块为全文） -->
    <div v-if="nativeThinking" class="thinking-section" :class="{ collapsed: streamCollapsed.has('native') }">
      <button type="button" class="section-header" @click="toggleStream('native')">
        <span class="status-dot done" />
        <span class="header-label">{{ t('workspace.timeline.thought') }}</span>
        <icon-right class="expand-icon" :class="{ expanded: !streamCollapsed.has('native') }" />
      </button>
      <div v-show="!streamCollapsed.has('native')" class="section-content stream-text" v-html="renderMarkdown(nativeStreamText || '')" />
    </div>

    <!-- Work（原始思考 / 计划 / 消息；B5：live 流逐字符打出，历史块为全文） -->
    <div v-if="rawThinking" class="work-section">
      <div class="section-header static">
        <span class="status-dot done" />
        <span class="header-label">{{ t('workspace.timeline.work') }}</span>
      </div>
      <div class="section-content stream-text" v-html="renderMarkdown(rawStreamText || '')" />
    </div>

    <!-- 事件时间线 -->
    <div v-if="sortedEvents.length > 0" class="events">
      <template v-for="(item, itemIdx) in sortedEvents" :key="eventKey(item, itemIdx)">
        <!-- 任务报告卡（report_task_status） -->
        <div
          v-if="isReportStatusAction(item.data)"
          class="action-card report-card"
          :class="{
            'is-failed': getReportStatusValue(item.data) === 'failed',
            'is-expanded': expandedCards.has(`report-${itemIdx}`),
          }"
          @click="toggleCard(`report-${itemIdx}`)"
        >
          <div class="card-header">
            <span class="action-icon" :class="{ 'is-failed': getReportStatusValue(item.data) === 'failed' }">
              <icon-close-circle v-if="getReportStatusValue(item.data) === 'failed'" />
              <icon-check-circle v-else />
            </span>
            <span class="action-title">
              {{
                getReportStatusValue(item.data) === 'failed'
                  ? t('workspace.timeline.taskFailed')
                  : t('workspace.timeline.taskCompleted')
              }}
            </span>
            <a-tag size="small" :color="getReportStatusValue(item.data) === 'failed' ? 'red' : 'green'">
              {{ getReportStatusValue(item.data) === 'failed' ? t('workspace.timeline.failed') : t('workspace.timeline.completed') }}
            </a-tag>
            <icon-right class="expand-icon" :class="{ expanded: expandedCards.has(`report-${itemIdx}`) }" />
          </div>
          <div v-if="expandedCards.has(`report-${itemIdx}`)" class="card-expanded" @click.stop>
            <div v-if="getReportStatusExplanation(item.data)" class="expanded-grid">
              <div class="grid-item full-width">
                <span class="grid-label">{{ t('workspace.timeline.reportFindings') }}</span>
                <span class="grid-value report-markdown" v-html="renderMarkdown(getReportStatusExplanation(item.data))" />
              </div>
            </div>
            <div
              v-if="getStepPreImageUrl(props.block.data, item.data) || getStepPostImageUrl(props.block.data, item.data)"
              class="screenshots"
            >
              <div v-if="getStepPreImageUrl(props.block.data, item.data)" class="screenshot-col">
                <span class="screenshot-label">{{ t('workspace.timeline.finalVerifiedState') }}</span>
                <a-image
                  :src="getStepPreImageUrl(props.block.data, item.data) || ''"
                  width="100%"
                  fit="contain"
                  :alt="t('workspace.timeline.finalVerifiedState')"
                />
              </div>
              <div v-if="getStepPostImageUrl(props.block.data, item.data)" class="screenshot-col">
                <span class="screenshot-label">{{ t('workspace.timeline.postVerification') }}</span>
                <a-image
                  :src="getStepPostImageUrl(props.block.data, item.data) || ''"
                  width="100%"
                  fit="contain"
                  :alt="t('workspace.timeline.postVerification')"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Android 动作卡 -->
        <div
          v-else-if="item.type === 'action' && !isReportStatusAction(item.data) && (isAndroidAction(item.data) || item.data?.type === 'action')"
          class="action-card"
          :class="{
            'is-failed': isActionFailed(item.data, props.block.data),
            'is-expanded': expandedCards.has(`action-${itemIdx}`),
          }"
          @click="toggleCard(`action-${itemIdx}`)"
        >
          <div class="card-header">
            <span class="action-icon" :class="{ 'is-failed': isActionFailed(item.data, props.block.data) }">
              <span class="icon-glyph">{{ getActionIcon(item.data) }}</span>
            </span>
            <span class="action-title">{{ getActionTitle(item.data) }}</span>
            <a-tag v-if="isActionFailed(item.data, props.block.data)" size="small" color="red">
              {{ t('workspace.timeline.failed') }}
            </a-tag>
            <button
              v-if="item.data?.trace_id"
              class="trace-link"
              :title="t('workspace.timeline.viewTraceTitle')"
              @click.stop="emit('view-trace', String(item.data.trace_id))"
            >
              <icon-mind-mapping />
              {{ t('workspace.timeline.viewTrace') }}
            </button>
            <icon-right class="expand-icon" :class="{ expanded: expandedCards.has(`action-${itemIdx}`) }" />
          </div>
          <div v-if="expandedCards.has(`action-${itemIdx}`)" class="card-expanded" @click.stop>
            <div class="expanded-grid">
              <div v-if="getActionTargetText(item.data)" class="grid-item">
                <span class="grid-label">{{ t('workspace.timeline.target') }}</span>
                <span class="grid-value">"{{ getActionTargetText(item.data) }}"</span>
              </div>
              <!-- 按键类动作的键名/按压时长收敛进轨迹树载荷，不在卡内平铺 -->
              <div v-if="getActionInputText(item.data) && !isKeyAction(item.data)" class="grid-item">
                <span class="grid-label">{{ getActionInputLabel(item.data) }}</span>
                <span class="grid-value">"{{ getActionInputText(item.data) }}"</span>
              </div>
              <div v-if="getActionCoords(item.data)" class="grid-item">
                <span class="grid-label">{{ t('workspace.timeline.coordinates') }}</span>
                <span class="grid-value code-pill">{{ getActionCoords(item.data) }}</span>
              </div>
              <div v-if="getActionBounds(item.data)" class="grid-item">
                <span class="grid-label">{{ t('workspace.timeline.bounds') }}</span>
                <span class="grid-value code-pill">[{{ getActionBounds(item.data) }}]</span>
              </div>
              <div v-if="getActionClass(item.data)" class="grid-item">
                <span class="grid-label">{{ t('workspace.timeline.targetClass') }}</span>
                <span class="grid-value code-pill">{{ getActionClass(item.data) }}</span>
              </div>
              <div v-for="param in actionParams(item)" :key="param.key" class="grid-item">
                <span class="grid-label">{{ param.key }}</span>
                <span class="grid-value code-pill">{{ param.value }}</span>
              </div>
            </div>
            <div
              v-if="getStepPreImageUrl(props.block.data, item.data) || getStepPostImageUrl(props.block.data, item.data)"
              class="screenshots"
            >
              <div v-if="getStepPreImageUrl(props.block.data, item.data)" class="screenshot-col">
                <span class="screenshot-label">{{ t('workspace.timeline.preAction') }}</span>
                <a-image
                  :src="getStepPreImageUrl(props.block.data, item.data) || ''"
                  width="100%"
                  fit="contain"
                  :alt="t('workspace.timeline.preAction')"
                />
              </div>
              <div v-if="getStepPostImageUrl(props.block.data, item.data)" class="screenshot-col">
                <span class="screenshot-label">{{ t('workspace.timeline.postAction') }}</span>
                <a-image
                  :src="getStepPostImageUrl(props.block.data, item.data) || ''"
                  width="100%"
                  fit="contain"
                  :alt="t('workspace.timeline.postAction')"
                />
              </div>
            </div>
            <div v-if="isActionFailed(item.data, props.block.data)" class="error-banner">
              <icon-exclamation-circle />
              <span>{{ getActionErrorMessage(item.data, props.block.data) }}</span>
            </div>
          </div>
        </div>

        <!-- 工具 -->
        <template v-else-if="item.type === 'tool'">
          <!-- UI 层级来源切换提示 -->
          <div v-if="isBackendSwitchNote(item.data)" class="note-row">
            <span class="status-dot done" />
            <span>{{ backendSwitchMessage(item.data) }}</span>
          </div>

          <!-- SDK 观察到的 LLM 重试 -->
          <div v-else-if="isLLMRetry(item.data)" class="note-row-stack">
            <div v-for="(retry, retryIdx) in llmRetries(item.data)" :key="retryIdx" class="note-row">
              <span class="status-dot done" />
              <span>
                <template v-if="isRetryEntry(retry)">
                  {{ t('workspace.timeline.retriedLlm', { waited: retryWaitedText(retry) }) }}
                </template>
                <template v-else>
                  {{ t('workspace.timeline.llmTempUnavailable') }}
                  <template v-if="retryDelayText(retry)">
                    · {{ t('workspace.timeline.retryingIn', { delay: retryDelayText(retry) }) }}
                  </template>
                </template>
              </span>
            </div>
          </div>

          <!-- 失败的 LLM 调用（llm_pause） -->
          <div v-else-if="isDisplayableLLMFailure(item.data)" class="llm-failure-stack">
            <div class="action-card is-failed">
              <div class="card-header">
                <span class="action-icon is-failed"><icon-close-circle /></span>
                <span class="action-title">{{ t('workspace.timeline.llmRequestFailed') }}</span>
                <a-tag size="small" :color="isTerminalFailure(item.data) ? 'orange' : 'red'">
                  {{ isTerminalFailure(item.data) ? t('workspace.timeline.pausedTag') : t('workspace.timeline.failed') }}
                </a-tag>
              </div>
              <div class="card-body">
                <div class="detail-row">
                  <span class="detail-label">{{ t('workspace.timeline.llmFailureWhat') }}:</span>
                  <span class="detail-value">{{ t('workspace.timeline.llmFailureWhatValue') }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t('workspace.timeline.failureReason') }}:</span>
                  <span class="detail-value">{{ failureErrorText(item.data) }}</span>
                </div>
                <div v-if="llmFailureWaited(item.data)" class="detail-row">
                  <span class="detail-label">{{ t('workspace.timeline.waitedLabel') }}:</span>
                  <span class="detail-value">{{ llmFailureWaited(item.data) }}</span>
                </div>
                <div v-if="llmFailureRetries(item.data).length > 0" class="failure-retries">
                  <div class="failure-retries-title">{{ t('workspace.timeline.retryDetails') }}</div>
                  <div v-for="(retry, retryIdx) in llmFailureRetries(item.data)" :key="retryIdx" class="failure-retry-row">
                    <span>{{ t('workspace.timeline.retryN', { n: retryIdx + 1 }) }}</span>
                    <span>
                      {{ t('workspace.timeline.planned', { delay: retryDelayText(retry) || '0s', waited: retryWaitedText(retry) }) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="isTerminalFailure(item.data)" class="resume-row">
              <a-button size="small" type="primary" @click.stop="resumePausedTask">
                <template #icon><icon-play-arrow /></template>
                {{ t('workspace.timeline.continueTask') }}
              </a-button>
              <span class="resume-hint">{{ t('workspace.timeline.resumeHint') }}</span>
            </div>
          </div>

          <!-- 普通工具行 / 工具卡 -->
          <template v-else-if="shouldShowTool(item.data, props.block.data)">
            <!-- 文本行：note 工具、视频分析与其他子 agent -->
            <div
              v-if="!isDeviceActionTool(item.data)"
              class="tool-row"
              :class="{ 'is-note-tool': isNoteTool(item.data) }"
              :title="compressionTitle(item.data) || undefined"
            >
              <span class="status-dot done" />
              <span class="tool-text">
                {{ toolLabel(item.data) }}{{ isNoteTool(item.data) && getToolKey(item.data) ? ':' : '' }}
                <a
                  v-if="isNoteTool(item.data) && getToolKey(item.data)"
                  class="tool-key-pill"
                  :title="t('workspace.timeline.viewNote')"
                  @click.stop="emit('open-note', getToolKey(item.data)!)"
                >
                  <icon-file />
                  {{ getToolKey(item.data) }}
                </a>
                <!-- 视频分析区间 pill：点击打开录像回放并定位到请求区间（M4） -->
                <a
                  v-if="isVideoTool(item.data)"
                  class="tool-key-pill video-pill"
                  :title="videoPillTitle(item.data)"
                  @click.stop="onVideoToolClick(item.data)"
                >
                  <icon-camera />
                  {{ videoRangeLabel(item.data) }}
                </a>
                <span v-if="videoDetailText(item.data)" class="video-detail">· {{ videoDetailText(item.data) }}</span>
                <span v-if="getToolAgentName(item.data)" class="tool-agent">· {{ getToolAgentName(item.data) }}</span>
              </span>
            </div>

            <!-- 动作卡：设备动作与 ADB 命令 -->
            <div
              v-else
              class="action-card tool-action-card"
              :class="{
                'is-failed': isToolFailed(item.data),
                'is-expanded': expandedCards.has(`tool-${itemIdx}`),
              }"
              @click="hasToolDetails(item) && toggleCard(`tool-${itemIdx}`)"
            >
              <div class="card-header">
                <span class="action-icon" :class="{ 'is-failed': isToolFailed(item.data) }">
                  <span class="icon-glyph">{{ getToolIcon(item.data) }}</span>
                </span>
                <span class="action-title">{{ getToolTitle(item.data) }}</span>
                <a-tag v-if="isToolFailed(item.data)" size="small" color="red">{{ t('workspace.timeline.failed') }}</a-tag>
                <button
                  v-if="item.data?.trace_id"
                  class="trace-link"
                  :title="t('workspace.timeline.viewTraceTitle')"
                  @click.stop="emit('view-trace', String(item.data.trace_id))"
                >
                  <icon-mind-mapping />
                  {{ t('workspace.timeline.viewTrace') }}
                </button>
                <icon-right v-if="hasToolDetails(item)" class="expand-icon" :class="{ expanded: expandedCards.has(`tool-${itemIdx}`) }" />
              </div>
              <div v-if="expandedCards.has(`tool-${itemIdx}`)" class="card-expanded" @click.stop>
                <div class="expanded-grid">
                  <template v-if="isAdbCommandTool(item.data)">
                    <div v-if="adbCommandValue(item.data)" class="grid-item full-width">
                      <span class="grid-label">{{ t('workspace.timeline.command') }}</span>
                      <span class="grid-value command-value"><code>{{ adbCommandValue(item.data) }}</code></span>
                    </div>
                    <div v-if="getAdbCwd(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.workingDir') }}</span>
                      <span class="grid-value">"{{ getAdbCwd(item.data) }}"</span>
                    </div>
                    <div v-if="getAdbTerminalId(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.terminalId') }}</span>
                      <span class="grid-value code-pill">{{ getAdbTerminalId(item.data) }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <div v-if="getToolTargetText(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.target') }}</span>
                      <span class="grid-value">"{{ getToolTargetText(item.data) }}"</span>
                    </div>
                    <div v-if="getToolInputText(item.data)" class="grid-item">
                      <span class="grid-label">{{ getToolInputLabel(item.data) }}</span>
                      <span class="grid-value">"{{ getToolInputText(item.data) }}"</span>
                    </div>
                    <div v-if="getToolCoords(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.coordinates') }}</span>
                      <span class="grid-value code-pill">{{ getToolCoords(item.data) }}</span>
                    </div>
                    <div v-if="getToolAnalysisText(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.analysis') }}</span>
                      <span class="grid-value">"{{ getToolAnalysisText(item.data) }}"</span>
                    </div>
                    <div v-if="getToolGenericDetails(item.data)" class="grid-item">
                      <span class="grid-label">{{ t('workspace.timeline.details') }}</span>
                      <span class="grid-value">"{{ getToolGenericDetails(item.data) }}"</span>
                    </div>
                    <div v-for="param in toolParams(item)" :key="param.key" class="grid-item">
                      <span class="grid-label">{{ param.key }}</span>
                      <span class="grid-value code-pill">{{ param.value }}</span>
                    </div>
                  </template>
                </div>
                <div
                  v-if="getStepPreImageUrl(props.block.data, item.data) || getStepPostImageUrl(props.block.data, item.data)"
                  class="screenshots"
                >
                  <div v-if="getStepPreImageUrl(props.block.data, item.data)" class="screenshot-col">
                    <span class="screenshot-label">{{ t('workspace.timeline.preAction') }}</span>
                    <a-image
                      :src="getStepPreImageUrl(props.block.data, item.data) || ''"
                      width="100%"
                      fit="contain"
                      :alt="t('workspace.timeline.preAction')"
                    />
                  </div>
                  <div v-if="getStepPostImageUrl(props.block.data, item.data)" class="screenshot-col">
                    <span class="screenshot-label">{{ t('workspace.timeline.postAction') }}</span>
                    <a-image
                      :src="getStepPostImageUrl(props.block.data, item.data) || ''"
                      width="100%"
                      fit="contain"
                      :alt="t('workspace.timeline.postAction')"
                    />
                  </div>
                </div>
                <div v-if="isToolFailed(item.data)" class="error-banner">
                  <icon-exclamation-circle />
                  <span>{{ getToolErrorMessage(item.data) }}</span>
                </div>
              </div>
            </div>
          </template>
        </template>
      </template>
    </div>
  </div>
</template>


<style scoped>
.step-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
}

.step-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--color-text-3);
}

.meta-item {
  font-variant-numeric: tabular-nums;
}

.thinking-section,
.work-section {
  border: 1px solid var(--color-border-1);
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-1);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.section-header.static {
  cursor: default;
}

.section-content {
  padding: 4px 12px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-1);
  max-height: 260px;
  overflow-y: auto;
  overflow-wrap: anywhere;
}

.expand-icon {
  margin-left: auto;
  transition: transform 0.2s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background-color: rgb(var(--green-6));
}

.status-dot.done {
  background-color: var(--color-text-4);
}

.events {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-1);
  color: var(--color-text-2);
  font-size: 12.5px;
}

.note-row-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
  font-size: 12.5px;
}

.tool-row.is-note-tool {
  background-color: rgb(var(--arcoblue-1) / 50%);
}

.tool-text {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.tool-key-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 999px;
  background-color: rgb(var(--arcoblue-6) / 12%);
  color: rgb(var(--arcoblue-6));
  font-size: 11px;
  cursor: pointer;
}

.tool-agent {
  color: var(--color-text-3);
  font-size: 11px;
}

.video-pill {
  color: rgb(var(--arcoblue-6));
}

.video-detail {
  color: var(--color-text-3);
  font-size: 11px;
}

.action-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-1);
  overflow: hidden;
  cursor: pointer;
}

.action-card.is-failed {
  border-color: rgb(var(--red-6) / 45%);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

/* 轨迹入口：默认低存在感，hover 卡片时浮现；点击打开轨迹树并定位本步骤 */
.trace-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  padding: 2px 8px;
  border: none;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-3);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
}

.action-card:hover .trace-link {
  opacity: 1;
}

.trace-link:hover {
  color: rgb(var(--arcoblue-6));
  background-color: var(--color-fill-2);
}

.action-icon {
  display: inline-flex;
  font-size: 16px;
  color: rgb(var(--arcoblue-6));
}

.action-icon.is-failed {
  color: rgb(var(--red-6));
}

.icon-glyph {
  font-size: 13px;
}

.action-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-1);
  flex: 1;
  min-width: 0;
}

.card-body {
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  gap: 6px;
  font-size: 12.5px;
  min-width: 0;
}

.detail-label {
  color: var(--color-text-3);
  flex-shrink: 0;
}

.detail-value {
  color: var(--color-text-1);
  min-width: 0;
  overflow-wrap: anywhere;
}

.coordinate-badge,
.code-pill {
  font-family: monospace;
  font-size: 11.5px;
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-3);
}

.command-value code {
  padding: 1px 6px;
  border-radius: 4px;
  background-color: var(--color-fill-3);
  font-size: 11.5px;
}

.card-expanded {
  padding: 4px 10px 10px;
  border-top: 1px dashed var(--color-border-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: default;
}

.expanded-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.grid-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.grid-item.full-width {
  grid-column: 1 / -1;
}

.grid-label {
  font-size: 11px;
  color: var(--color-text-3);
}

.grid-value {
  font-size: 12.5px;
  color: var(--color-text-1);
  overflow-wrap: anywhere;
}

.report-markdown :deep(pre) {
  overflow-x: auto;
}

.screenshots {
  display: flex;
  gap: 10px;
}

.screenshot-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.screenshot-label {
  font-size: 11px;
  color: var(--color-text-3);
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  background-color: rgb(var(--red-1) / 60%);
  color: rgb(var(--red-6));
  font-size: 12.5px;
}

.reset-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  background-color: rgb(var(--orange-1) / 60%);
  color: rgb(var(--orange-6));
  font-size: 12.5px;
}

/* B5：断流等待态（isWaiting）旋转指示 */
.reset-row .spin-icon {
  flex-shrink: 0;
  animation: step-card-spin 1.2s linear infinite;
}

@keyframes step-card-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.failure-retries {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-border-2);
}

.failure-retries-title {
  font-size: 11px;
  color: var(--color-text-3);
}

.failure-retry-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-2);
}

.llm-failure-stack,
.resume-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resume-row {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.resume-hint {
  font-size: 12px;
  color: var(--color-text-3);
}

.stream-text :deep(pre) {
  overflow-x: auto;
  padding: 8px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
  font-size: 12px;
}

.stream-text :deep(code) {
  padding: 0 4px;
  border-radius: 4px;
  background-color: var(--color-fill-3);
  font-size: 12px;
}

.stream-text :deep(.md-verify-badge) {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  font-family: monospace;
  font-size: 11px;
  color: rgb(var(--arcoblue-6));
  background-color: rgb(var(--arcoblue-6) / 12%);
}

.stream-text :deep(.md-verify-badge.assert) {
  color: rgb(var(--purple-6));
  background-color: rgb(var(--purple-6) / 12%);
}

.stream-text :deep(ul),
.stream-text :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}
</style>
