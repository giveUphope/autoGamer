<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Input } from '@arco-design/web-vue';

import ModelSelect from '@/components/ModelSelect.vue';
import { ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';

/**
 * 常驻命令条（对应 Angular WorkspaceComponent 的 command dock，UI 按 Arco 重做）：
 * 输入框不再靠悬停/聚焦展开，始终常驻在页面底部；Ctrl+K / ⌘K 仍然聚焦它。
 * 回车提交任务（`/api/run`），架构 profile（flash/pro）持久化到 localStorage；
 * 模型选择器与启动器、诊断向导共用 ModelSelect，状态在 system store 里只有一份。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();

const taskInput = ref('');
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const selectedProfile = ref<'flash' | 'pro'>('flash');
const inputRef = ref<InstanceType<typeof Input> | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

// 与 Angular 版一致：记住上一次选择的架构 profile
if (typeof localStorage !== 'undefined') {
  const saved = localStorage.getItem('artemis_selected_profile');
  if (saved === 'flash' || saved === 'pro') {
    selectedProfile.value = saved;
  }
}

function focusInput(): void {
  inputRef.value?.focus();
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusInput();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown);
  if (errorTimer) {
    clearTimeout(errorTimer);
  }
});

function onProfileChange(value: string | number | boolean | (string | number | boolean)[] | undefined): void {
  if (value === 'flash' || value === 'pro') {
    selectedProfile.value = value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('artemis_selected_profile', value);
    }
  }
}

async function submitTask(): Promise<void> {
  const goal = taskInput.value.trim();
  if (!goal || isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  errorMessage.value = null;
  try {
    await sessionStore.runTask(goal, selectedProfile.value);
    taskInput.value = '';
    // 与 Angular 版一致：提交成功后立即刷新状态，让队列/运行状态尽快上屏
    void sessionStore.fetchStatus();
  } catch (err) {
    console.error('Failed to submit task:', err);
    const reason = err instanceof ApiError ? (err.detail || `HTTP ${err.status}`) : String(err);
    errorMessage.value = t('workspace.dock.submitFail', { reason });
    if (errorTimer) clearTimeout(errorTimer);
    // 5 秒后自动消失（与 Angular 版一致）
    errorTimer = setTimeout(() => {
      errorMessage.value = null;
    }, 5000);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="command-dock">
    <div class="dock-card">
      <a-alert v-if="errorMessage" type="error" class="dock-error">{{ errorMessage }}</a-alert>
      <div class="dock-row">
        <a-radio-group
          :model-value="selectedProfile"
          type="button"
          size="small"
          class="dock-profile-group"
          @change="onProfileChange"
        >
          <a-radio value="flash">Flash</a-radio>
          <a-radio value="pro">Pro</a-radio>
        </a-radio-group>
        <ModelSelect class="dock-model-select" />
        <a-input
          ref="inputRef"
          v-model="taskInput"
          class="dock-input"
          :placeholder="t('workspace.dock.placeholder')"
          allow-clear
          @press-enter="submitTask"
        />
        <a-button type="primary" :loading="isSubmitting" @click="submitTask">
          {{ t('workspace.dock.submit') }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.command-dock {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 1000;
  max-width: min(980px, calc(100vw - 48px));
  width: min(980px, calc(100vw - 48px));
}

.dock-card {
  padding: 10px 12px;
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  box-shadow: var(--shadow2-center);
}

.dock-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dock-profile-group {
  flex-shrink: 0;
}

.dock-model-select {
  width: 260px;
  flex-shrink: 0;
  min-width: 0;
}

.dock-input {
  flex: 1;
  min-width: 120px;
}

.dock-error {
  margin-bottom: 8px;
}
</style>
