<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AppNav from '@/components/AppNav.vue';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/services/api';

/**
 * 启动器（对应 Angular HomeComponent 的 M1 最小可用版）：
 * 任务输入 a-textarea + 提交按钮（复用 session store 的 runTask，与命令条同一提交
 * 路径）+ 会话数摘要。诊断向导不做（M5 交付）。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();

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
            <a-button type="primary" :loading="isSubmitting" @click="submitTask">
              {{ isSubmitting ? t('launcher.submitting') : t('launcher.submit') }}
            </a-button>
          </div>
        </div>
      </a-card>
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
  justify-content: flex-end;
}
</style>
