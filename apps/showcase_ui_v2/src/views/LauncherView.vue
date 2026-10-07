<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCheckCircleFill,
  IconExclamationCircleFill,
  IconLaunch,
  IconLock,
  IconRight,
  IconSettings,
} from '@arco-design/web-vue/es/icon';

import AppNav from '@/components/AppNav.vue';
import DiagnosticsWizard from '@/components/diagnostics/DiagnosticsWizard.vue';
import { useSystemContract } from '@/components/diagnostics/contract';
import ModelSelect from '@/components/ModelSelect.vue';
import TaskPresets from '@/components/session-extras/TaskPresets.vue';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/services/api';

/**
 * 启动器（对应 Angular HomeComponent）：
 * 顶部 diagnostics / launcher 双 tab 切换（isReady 时 diagnostics tab 打勾、
 * 未就绪时 launcher tab 加锁）。diagnostics 渲染三步诊断向导；launcher 保留
 * 任务提交卡 + 会话摘要卡，未就绪时显示前置条件警示条（点击跳转诊断）。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();
const system = useSystemContract();

const activeTab = ref<'diagnostics' | 'launcher'>('launcher');

const goal = ref('');
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);

const summary = computed(() => {
  const list = sessionStore.sessions;
  const running = list.filter((s) => s.status === 'running' || s.status === 'paused').length;
  const pending = list.filter((s) => s.status === 'pending').length;
  const done = list.filter((s) =>
    ['completed', 'failed', 'cancelled'].includes(s.status || ''),
  ).length;
  return { total: list.length, running, pending, done };
});

async function submitTask(): Promise<void> {
  const trimmed = goal.value.trim();
  if (!trimmed || isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  errorMessage.value = null;
  try {
    await sessionStore.runTask(trimmed);
    goal.value = '';
    // 与 Angular 版一致：提交成功后立即刷新状态
    void sessionStore.fetchStatus();
  } catch (err) {
    console.error('Failed to submit task:', err);
    const reason = err instanceof ApiError ? (err.detail || `HTTP ${err.status}`) : String(err);
    errorMessage.value = t('launcher.submitFail', { reason });
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="launcher-page">
    <a-layout-header class="launcher-header">
      <AppNav />
    </a-layout-header>

    <main class="launcher-content">
      <h1 class="page-title">{{ t('launcher.title') }}</h1>
      <p class="page-desc">{{ t('launcher.description') }}</p>

      <!-- diagnostics / launcher 双 tab（对齐 Angular 母本 L39-70） -->
      <div class="mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="mode-tab-btn"
          :class="{ active: activeTab === 'diagnostics' }"
          :aria-selected="activeTab === 'diagnostics'"
          @click="activeTab = 'diagnostics'"
        >
          <icon-check-circle-fill v-if="system.isReady" class="tab-icon ready" />
          <icon-settings v-else class="tab-icon" />
          <span>{{ t('launcher.tabs.diagnostics') }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="mode-tab-btn"
          :class="{ active: activeTab === 'launcher' }"
          :aria-selected="activeTab === 'launcher'"
          @click="activeTab = 'launcher'"
        >
          <icon-lock v-if="!system.isReady" class="tab-icon locked" />
          <icon-launch v-else class="tab-icon" />
          <span>{{ t('launcher.tabs.launcher') }}</span>
        </button>
      </div>

      <!-- 诊断向导 -->
      <DiagnosticsWizard v-if="activeTab === 'diagnostics'" @proceed="activeTab = 'launcher'" />

      <!-- 启动器 -->
      <template v-else>
        <!-- 前置条件未就绪警示条（对齐 Angular launcher-warning-bar） -->
        <button
          v-if="system.hasReadinessReport && !system.isReady"
          type="button"
          class="prereq-warning"
          @click="activeTab = 'diagnostics'"
        >
          <icon-exclamation-circle-fill />
          <span>
            {{
              system.adbProbe?.summary === 'Device Locked'
                ? t('launcher.deviceLockedWarning')
                : t('launcher.prerequisitesWarning')
            }}
          </span>
          <icon-right class="warning-arrow" />
        </button>

        <a-card class="launcher-card" :bordered="true">
          <template #title>{{ t('launcher.summaryTitle') }}</template>
          <div class="summary-row">
            <a-statistic :title="t('launcher.summary.total')" :value="summary.total" />
            <a-statistic
              :title="t('launcher.summary.running')"
              :value="summary.running"
              :value-style="{ color: summary.running > 0 ? 'rgb(var(--green-6))' : undefined }"
            />
            <a-statistic :title="t('launcher.summary.pending')" :value="summary.pending" />
            <a-statistic :title="t('launcher.summary.done')" :value="summary.done" />
            <div class="summary-action">
              <router-link to="/workspace">
                <a-button type="outline">{{ t('launcher.openWorkspace') }}</a-button>
              </router-link>
            </div>
          </div>
        </a-card>

        <a-card class="launcher-card" :bordered="true">
          <template #title>{{ t('launcher.taskTitle') }}</template>
          <div class="task-form">
            <label class="task-label">{{ t('launcher.goalLabel') }}</label>
            <a-textarea
              v-model="goal"
              :placeholder="t('launcher.goalPlaceholder')"
              :auto-size="{ minRows: 3, maxRows: 6 }"
              :max-length="2000"
            />
            <a-alert v-if="errorMessage" type="error" class="task-error">
              {{ errorMessage }}
            </a-alert>
            <div class="task-actions">
              <div class="task-model">
                <span class="task-model-label">{{ t('launcher.modelLabel') }}</span>
                <ModelSelect class="task-model-select" />
              </div>
              <a-button type="primary" :loading="isSubmitting" @click="submitTask">
                {{ isSubmitting ? t('launcher.submitting') : t('launcher.submit') }}
              </a-button>
            </div>
          </div>
        </a-card>

        <!-- B6 推荐任务 chips：点击填入输入框，不直接提交 -->
        <TaskPresets @select="goal = $event" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.launcher-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.launcher-header {
  height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  background-color: var(--color-bg-1);
  border-bottom: 1px solid var(--color-border-2);
  line-height: normal;
}

.launcher-content {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 24px 64px;
  box-sizing: border-box;
}

.mode-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  padding: 4px;
  width: fit-content;
}

.mode-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-2);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: var(--border-radius-small);
  cursor: pointer;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.mode-tab-btn:hover {
  color: var(--color-text-1);
  background-color: var(--color-fill-2);
}

.mode-tab-btn.active {
  color: var(--color-text-1);
  background-color: var(--color-fill-3);
  font-weight: 500;
}

.tab-icon.ready {
  color: rgb(var(--green-6));
}

.tab-icon.locked {
  color: rgb(var(--orange-6));
}

.prereq-warning {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 1px dashed rgb(var(--orange-6) / 60%);
  background-color: rgb(var(--orange-1) / 35%);
  color: var(--color-text-1);
  border-radius: var(--border-radius-medium);
  padding: 10px 14px;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 20px;
}

.warning-arrow {
  margin-left: auto;
  flex-shrink: 0;
}

.launcher-card {
  margin-bottom: 20px;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
}

.summary-action {
  margin-left: auto;
}

.task-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-label {
  font-size: 13px;
  color: var(--color-text-2);
}

.task-error {
  margin-top: 4px;
}

.task-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-model {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-model-label {
  font-size: 12px;
  color: var(--color-text-3);
  flex-shrink: 0;
}

/* Arco Select 根元素不带父组件 scoped data-v（attrs 手动透传时丢失），须 :deep() 下沉 */
.task-model :deep(.task-model-select) {
  width: 320px;
  min-width: 0;
}
</style>
