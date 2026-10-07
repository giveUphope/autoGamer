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
 * Run 信息气泡（对应 Angular 的 Flash/Pro chip + run-info 下拉，按映射表用 a-popover 重做）：
 * 耗时、token 用量、执行器上下文占比与本次运行的 Pro 调优。
 * usage 拉取语义平移自组件 effect：打开或会话变化时拉取；会话仍在运行时每 3s 刷新。
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

const elapsed = computed(() => {
  const session = sessionStore.currentSession;
  return formatElapsed(sessionElapsedSeconds(session, sessionStore.isCurrentSessionRunning, clock.value));
});

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

function loadUsage(): void {
  const sessionId = sessionStore.currentSessionId;
  if (popoverOpen.value && sessionId) {
    void timelineStore.loadRunUsage(sessionId);
  }
}

watch([popoverOpen, () => sessionStore.currentSessionId], () => {
  // 会话变化时清掉旧 usage（平移自 runUsage.set(null) 守卫）
  loadUsage();
});

watch(
  () => [popoverOpen.value, sessionStore.isCurrentSessionRunning] as const,
  ([open, running]) => {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (usageTimer) {
      clearInterval(usageTimer);
      usageTimer = null;
    }
    if (open && running) {
      clock.value = Date.now();
      clockTimer = setInterval(() => {
        clock.value = Date.now();
      }, 1000);
      usageTimer = setInterval(loadUsage, 3000);
    }
  },
);

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (usageTimer) clearInterval(usageTimer);
});
</script>

<template>
  <a-popover
    v-model:popup-visible="popoverOpen"
    position="br"
    trigger="click"
    content-class="run-info-popover-content"
  >
    <a-button
      size="small"
      class="run-info-btn"
      :class="{ 'is-pro': isPro }"
      :title="t('workspace.timeline.runInfo.button')"
    >
      <template #icon>
        <icon-star v-if="isPro" :class="{ 'is-pro': isPro }" />
        <icon-thunderbolt v-else />
      </template>
      {{ t('workspace.timeline.runInfo.button') }}
    </a-button>
    <template #content>
      <div class="run-info" role="dialog" :aria-label="t('workspace.timeline.architecture')">
        <div class="run-info-header">
          <span class="run-info-title" :class="{ 'is-pro': isPro }">{{ modelDisplayName }}</span>
          <span v-if="model?.id" class="run-info-model" :title="model.id">{{ model.id }}</span>
        </div>

        <div v-if="pinnedEndpoint" class="run-info-row">
          <span class="run-info-label">{{ t('workspace.timeline.runInfo.endpoint') }}</span>
          <span class="run-info-value" :title="pinnedEndpoint">{{ pinnedEndpoint }}</span>
        </div>

        <div class="run-info-row">
          <span class="run-info-label">{{ t('workspace.timeline.runInfo.elapsed') }}</span>
          <span class="run-info-value">{{ elapsed }}</span>
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
        <div v-else class="run-info-note">{{ t('workspace.timeline.runInfo.flashNote') }}</div>
      </div>
    </template>
  </a-popover>
</template>

<style scoped>
/* 触发按钮只承担「查看运行信息」入口；架构/模型的发射凭据在命令条，不在此展示 */
.run-info-btn.is-pro {
  color: rgb(var(--purple-6));
}

.run-info-btn :deep(.is-pro) {
  color: rgb(var(--purple-6));
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
  font-variant-numeric: tabular-nums;
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

.run-info-note {
  color: var(--color-text-3);
  font-size: 12px;
}
</style>
