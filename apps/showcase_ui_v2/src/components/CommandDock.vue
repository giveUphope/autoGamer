<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Input } from '@arco-design/web-vue';

import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/services/api';

/**
 * 浮动命令条（对应 Angular WorkspaceComponent 的 command dock，交互逻辑平移、
 * UI 按 Arco 重做）：Ctrl+K / ⌘K 唤起并聚焦；悬停 / 聚焦 / 有草稿时展开；
 * 回车提交任务（`/api/run`），架构 profile（flash/pro）持久化到 localStorage。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();

const taskInput = ref('');
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const isHoveringCard = ref(false);
const isInputFocused = ref(false);
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

const isBarExpanded = computed(
  () => isHoveringCard.value || isInputFocused.value || taskInput.value.trim().length > 0,
);

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

function focusInput(): void {
  // 折叠态下输入框尚未渲染（v-if），必须先展开再等下一个 tick 聚焦，
  // 否则 Ctrl+K 与胶囊点击都是对 null 的空操作。
  isHoveringCard.value = true;
  void nextTick(() => inputRef.value?.focus());
}

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
  <div
    class="command-dock"
    :class="{ expanded: isBarExpanded }"
    @mouseenter="isHoveringCard = true"
    @mouseleave="isHoveringCard = false"
  >
    <div v-if="!isBarExpanded" class="dock-capsule" @click="focusInput">
      <span class="dock-capsule-text">{{ t('workspace.dock.capsuleHint') }}</span>
      <span class="dock-kbd">Ctrl + K</span>
    </div>

    <div v-else class="dock-card">
      <a-alert v-if="errorMessage" type="error" class="dock-error">{{ errorMessage }}</a-alert>
      <div class="dock-row" @click="focusInput">
        <a-radio-group
          :model-value="selectedProfile"
          type="button"
          size="small"
          @change="onProfileChange"
        >
          <a-radio value="flash">Flash</a-radio>
          <a-radio value="pro">Pro</a-radio>
        </a-radio-group>
        <a-input
          ref="inputRef"
          v-model="taskInput"
          class="dock-input"
          :placeholder="t('workspace.dock.placeholder')"
          allow-clear
          @press-enter="submitTask"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
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
  max-width: min(720px, calc(100vw - 48px));
}

.dock-capsule {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  box-shadow: var(--shadow2-center);
  cursor: pointer;
  color: var(--color-text-3);
  font-size: 13px;
  transition: box-shadow 0.2s;
}

.dock-capsule:hover {
  box-shadow: var(--shadow2-center);
  color: var(--color-text-2);
}

.dock-kbd {
  padding: 1px 6px;
  border: 1px solid var(--color-border-3);
  border-radius: 4px;
  font-size: 11px;
  color: var(--color-text-3);
  background-color: var(--color-fill-2);
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

.dock-input {
  flex: 1;
}

.dock-error {
  margin-bottom: 8px;
}
</style>
