<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSessionStore } from '@/stores/session';
import { useTimelineStore } from '@/stores/timeline';
import { IconStar, IconThunderbolt } from '@arco-design/web-vue/es/icon';
import {
  contextPercent,
  formatCompactTokens,
  formatElapsed,
  parseRunTuning,
  sessionElapsedSeconds,
  tuningLabel,
} from '@/utils/run-info';
import type { SessionRunTuning } from '@/types/session.model';

/**
 * 运行信息（挂在命令条下排，与发射凭据构成「发射前凭据 → 发射后账单」）：
 * 按钮内联核心指标（Tokens · 用时），点击弹出详情——耗时 / LLM 调用次数 /
 * 步骤数 / 平均输出速度 / token 用量 / 上下文占比 / Pro 调优。
 * 指标行集中在一个 computed 数组里，统计口径调整只改这一处。
 * usage 拉取语义：打开或会话变化时拉取；会话仍在运行时每 3s 刷新。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();
const timelineStore = useTimelineStore();

const popoverOpen = ref(false);
/** 耗时展示的秒级时钟（仅打开且会话运行时走针）。 */
const clock = ref<number>(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
let usageTimer: ReturnType<typeof setInterval> | null = null;

const model = computed(() => sessionStore.currentSession?.model_info || sessionStore.activeModel);

/** 本次运行 pin 的端点库记录名（会话自带的事实）；未 pin 的由全局默认服务，不显示这一行。 */
const pinnedEndpoint = computed(() => sessionStore.currentSession?.model_endpoint || '');

const isPro = computed(() => {
  const name = (model.value?.name || '').toLowerCase();
  return name.includes('pro');
});

const modelDisplayName = computed(() => {
  const name = model.value?.name;
  if (!name) return 'Flash';
  const lower = name.toLowerCase();
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('flash')) return 'Flash';
  return name.replace(/^artemis\s+/i, '');
});

const elapsedSeconds = computed(() =>
  sessionElapsedSeconds(
    sessionStore.currentSession,
    sessionStore.isCurrentSessionRunning,
    clock.value,
  ),
);

const elapsed = computed(() => formatElapsed(elapsedSeconds.value));

const tuning = computed<SessionRunTuning | null>(() => {
  const usage = timelineStore.runUsage;
  if (usage?.run_tuning && (usage.run_tuning.verification_level || usage.run_tuning.explorer_mode)) {
    return usage.run_tuning;
  }
  return parseRunTuning(sessionStore.currentSession?.device_info);
});

const contextPercentValue = computed<number | null>(() => {
  const usage = timelineStore.runUsage;
  if (!usage) return null;
  return contextPercent(usage.operator_context_tokens, usage.operator_context_window_tokens);
});

/** 执行回合步骤总数（轮身时间线里的块数，checker 核查块不计）。 */
const stepsCount = computed(
  () =>
    timelineStore.phases
      .map((phase) => phase.blocks.filter((block) => block.type !== 'checker').length)
      .reduce((sum, n) => sum + n, 0),
);

/** 平均输出速度：completion tokens / 会话已进行秒数。 */
const outputSpeed = computed<string | null>(() => {
  const usage = timelineStore.runUsage;
  if (!usage?.completion_tokens || !elapsedSeconds.value) return null;
  return `${(usage.completion_tokens / elapsedSeconds.value).toFixed(1)} tok/s`;
});

/** 详情指标行（统计口径调整只改这里）。 */
const metricRows = computed(() => {
  const usage = timelineStore.runUsage;
  return [
    { label: t('workspace.timeline.runInfo.elapsed'), value: elapsed.value },
    { label: t('workspace.timeline.runInfo.calls'), value: usage?.llm_calls ?? null },
    { label: t('workspace.timeline.runInfo.steps'), value: stepsCount.value || null },
    { label: t('workspace.timeline.runInfo.speed'), value: outputSpeed.value },
  ];
});

/** 按钮内联的核心指标：Tokens · 用时（无数据时退回「运行信息」占位）。 */
const inlineLabel = computed(() => {
  const usage = timelineStore.runUsage;
  const parts: string[] = [];
  if (usage) {
    parts.push(`${formatCompactTokens(usage.total_tokens)} tokens`);
  }
  if (elapsedSeconds.value > 0) {
    parts.push(elapsed.value);
  }
  return parts.length > 0 ? parts.join(' · ') : t('workspace.timeline.runInfo.button');
});

const hasSession = computed(() => Boolean(sessionStore.currentSessionId));

function loadUsage(): void {
  const sessionId = sessionStore.currentSessionId;
  if (sessionId) {
    void timelineStore.loadRunUsage(sessionId);
  }
}

// 挂载/会话变化即拉取：内联按钮要显示 tokens，不等到气泡打开
watch(() => sessionStore.currentSessionId, loadUsage, { immediate: true });

watch(
  () => [sessionStore.isCurrentSessionRunning] as const,
  ([running]) => {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (usageTimer) {
      clearInterval(usageTimer);
      usageTimer = null;
    }
    if (running) {
      clock.value = Date.now();
      clockTimer = setInterval(() => {
        clock.value = Date.now();
      }, 1000);
      usageTimer = setInterval(loadUsage, 3000);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (usageTimer) clearInterval(usageTimer);
});
</script>

<template>
  <a-popover
    v-model:popup-visible="popoverOpen"
    position="top"
    trigger="click"
    content-class="run-info-popover-content"
  >
    <a-button
      size="small"
      class="run-info-btn"
      :class="{ 'is-pro': isPro }"
      :disabled="!hasSession"
      :title="t('workspace.timeline.runInfo.button')"
    >
      <template #icon>
        <icon-star v-if="isPro" />
        <icon-thunderbolt v-else />
      </template>
      {{ inlineLabel }}
    </a-button>
    <template #content>
      <div class="run-info" role="dialog" :aria-label="t('workspace.timeline.runInfo.button')">
        <div class="run-info-header">
          <span class="run-info-title" :class="{ 'is-pro': isPro }">{{ modelDisplayName }}</span>
          <span v-if="model?.id" class="run-info-model" :title="model.id">{{ model.id }}</span>
        </div>

        <div v-if="pinnedEndpoint" class="run-info-row">
          <span class="run-info-label">{{ t('workspace.timeline.runInfo.endpoint') }}</span>
          <span class="run-info-value" :title="pinnedEndpoint">{{ pinnedEndpoint }}</span>
        </div>

        <div v-for="metric in metricRows" :key="metric.label" class="run-info-row">
          <span class="run-info-label">{{ metric.label }}</span>
          <span v-if="metric.value !== null && metric.value !== ''" class="run-info-value">
            {{ metric.value }}
          </span>
          <span v-else class="run-info-value is-muted">—</span>
        </div>

        <div class="run-info-row">
          <span class="run-info-label">{{ t('workspace.timeline.runInfo.tokens') }}</span>
          <span v-if="timelineStore.runUsage" class="run-info-value">
            {{ formatCompactTokens(timelineStore.runUsage.total_tokens) }}
            <span class="run-info-sub">
              {{
                t('workspace.timeline.runInfo.inOut', {
                  in: formatCompactTokens(timelineStore.runUsage.prompt_tokens),
                  out: formatCompactTokens(timelineStore.runUsage.completion_tokens),
                })
              }}
            </span>
          </span>
          <span v-else class="run-info-value is-muted">—</span>
        </div>

        <div class="run-info-row is-stacked">
          <div class="run-info-line">
            <span class="run-info-label">{{ t('workspace.timeline.runInfo.context') }}</span>
            <span v-if="contextPercentValue !== null" class="run-info-value">
              {{ contextPercentValue }}%
              <span class="run-info-sub-inline">
                {{
                  t('workspace.timeline.runInfo.ofWindow', {
                    window: formatCompactTokens(timelineStore.runUsage?.operator_context_window_tokens),
                  })
                }}
              </span>
            </span>
            <span v-else class="run-info-value is-muted">—</span>
          </div>
          <a-progress
            :percent="(contextPercentValue ?? 0) / 100"
            :show-text="false"
            size="small"
            :status="contextPercentValue !== null && contextPercentValue >= 90 ? 'danger' : 'normal'"
          />
        </div>

        <template v-if="isPro">
          <div class="run-info-row">
            <span class="run-info-label">{{ t('workspace.timeline.runInfo.resultCheck') }}</span>
            <span class="run-info-value">{{ tuningLabel('verify', tuning?.verification_level) }}</span>
          </div>
          <div class="run-info-row">
            <span class="run-info-label">{{ t('workspace.timeline.runInfo.screenReading') }}</span>
            <span class="run-info-value">{{ tuningLabel('explore', tuning?.explorer_mode) }}</span>
          </div>
        </template>
      </div>
    </template>
  </a-popover>
</template>

<style scoped>
/* 触发按钮内联核心指标；架构/模型的发射凭据在命令条左侧，不在此展示 */
.run-info-btn.is-pro {
  color: rgb(var(--purple-6));
}

.run-info-value {
  font-variant-numeric: tabular-nums;
}

.run-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 240px;
  font-size: 13px;
}

.run-info-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-2);
}

.run-info-title {
  font-weight: 700;
  font-size: 14px;
}

.run-info-title.is-pro {
  color: rgb(var(--purple-6));
}

.run-info-model {
  color: var(--color-text-3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.run-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.run-info-row.is-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.run-info-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.run-info-label {
  color: var(--color-text-3);
}

.run-info-value {
  color: var(--color-text-1);
}

.run-info-value.is-muted {
  color: var(--color-text-4);
}

.run-info-sub,
.run-info-sub-inline {
  color: var(--color-text-3);
  font-size: 11px;
  margin-left: 4px;
}
</style>
