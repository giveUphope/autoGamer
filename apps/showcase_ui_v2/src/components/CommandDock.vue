<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Textarea } from '@arco-design/web-vue';

import ModelSelect from '@/components/ModelSelect.vue';
import RunInfoPopover from '@/components/timeline/RunInfoPopover.vue';
import { ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';

/**
 * 会话输入区（对应 Angular WorkspaceComponent 的 command dock，UI 按 Arco 重做）：
 * 并在左栏会话时间线底部（聊天式「会话流 + 底部输入」）；Ctrl+K / ⌘K 仍然聚焦它。
 * 多行输入框独占主体，下方控件行从左到右：架构 profile（flash/pro）→ 模型选择器
 * → 运行信息（选中任务的耗时/tokens 内联指标，点击看详情）→ 提交按钮。
 * 提交按钮多态：当前会话线程有运行/暂停中的任务时变为「停止」（点击停掉该轮，
 * 吸收自左栏停止按钮），否则为「提交」。Enter 提交任务（`/api/run`）、
 * Shift+Enter 换行、输入法组词中的 Enter 不触发。
 * profile 持久化到 localStorage；模型选择器与启动器、诊断向导共用 ModelSelect，
 * 状态在 system store 里只有一份。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();

const taskInput = ref('');
const isSubmitting = ref(false);
const isStopping = ref(false);
const errorMessage = ref<string | null>(null);
const selectedProfile = ref<'flash' | 'pro'>('flash');
const inputRef = ref<InstanceType<typeof Textarea> | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const isThreadRunning = computed(() => !!sessionStore.currentConversationRunningTaskId);

// ---- 队列状态条（主流 agent 模式：排队消息可见、可单独移除；暂停/继续） ----
const threadPending = computed(() => sessionStore.threadPendingRounds);
const queuePaused = computed(() => sessionStore.queueManuallyPaused);
const queueHolds = computed(() => sessionStore.queueHolds);
/** 挂起原因汇总（悬浮提示）。 */
const holdReasons = computed(() =>
  sessionStore.queueHolds.map((h) => h.reason).filter(Boolean).join('；'),
);
/** 有任务在跑或排队时提供「暂停队列」入口（暂停只停新派发，不影响运行中）。 */
const showPauseAction = computed(
  () => (isThreadRunning.value || threadPending.value.length > 0)
    && !queuePaused.value
    && queueHolds.value.length === 0,
);

function removeQueued(sessionId: string): void {
  void sessionStore.removeQueuedRound(sessionId);
}

function pauseQueue(): void {
  void sessionStore.pauseQueue();
}

function resumeQueue(): void {
  void sessionStore.resumeQueue();
}

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

function onTextareaKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submitTask();
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
    // 续上当前查看的对话线程（仅真实 conversation_id；后端也会在未带线程 id
    // 时为本次提交新建线程并回传）。首条消息之后，后续提交自动成为同一线程的新轮。
    await sessionStore.runTask(goal, selectedProfile.value, {
      conversationId: sessionStore.submitConversationId ?? undefined,
    });
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

async function stopCurrentConversation(): Promise<void> {
  const target = sessionStore.currentConversationRunningTaskId;
  if (!target || isStopping.value) {
    return;
  }
  isStopping.value = true;
  try {
    await sessionStore.stopTask(target, false);
  } finally {
    // 与左栏停止按钮一致：留出后端状态收敛时间，防止按钮抖回
    setTimeout(() => {
      isStopping.value = false;
    }, 400);
  }
}
</script>

<template>
  <div class="command-dock">
    <div class="dock-card">
      <a-alert v-if="errorMessage" type="error" class="dock-error">{{ errorMessage }}</a-alert>
      <!-- 排队消息 chips + 队列状态（暂停 / 环境熔断挂起）+ 暂停/继续 -->
      <div
        v-if="threadPending.length || queuePaused || queueHolds.length || showPauseAction"
        class="dock-queue-strip"
      >
        <span
          v-for="round in threadPending"
          :key="round.session_id"
          class="queue-chip"
          :title="round.initial_goal"
        >
          <span class="queue-chip-goal">{{ round.initial_goal }}</span>
          <button
            class="queue-chip-remove"
            :title="t('workspace.queue.remove')"
            @click="removeQueued(round.session_id)"
          >×</button>
        </span>
        <template v-if="queuePaused">
          <span class="queue-state is-paused">{{ t('workspace.queue.paused') }}</span>
          <a-button size="mini" type="outline" class="queue-action" @click="resumeQueue">
            {{ t('workspace.queue.resume') }}
          </a-button>
        </template>
        <template v-else-if="queueHolds.length">
          <span class="queue-state is-held" :title="holdReasons">
            {{ t('workspace.queue.held') }}
          </span>
          <a-button size="mini" type="outline" class="queue-action" @click="resumeQueue">
            {{ t('workspace.queue.resume') }}
          </a-button>
        </template>
        <template v-else-if="showPauseAction">
          <a-button size="mini" type="text" class="queue-action" @click="pauseQueue">
            {{ t('workspace.queue.pause') }}
          </a-button>
        </template>
      </div>
      <div class="dock-main-row">
        <a-textarea
          ref="inputRef"
          v-model="taskInput"
          class="dock-input"
          :placeholder="t('workspace.dock.placeholder')"
          :auto-size="{ minRows: 2, maxRows: 5 }"
          allow-clear
          @keydown="onTextareaKeydown"
        />
      </div>
      <div class="dock-bottom-row">
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
        <!-- 运行信息：选中任务的耗时/tokens 内联指标，点击弹详情——发射前凭据 → 发射后账单 -->
        <RunInfoPopover class="dock-run-info" />
        <a-button
          type="primary"
          :status="isThreadRunning ? 'danger' : undefined"
          :loading="isThreadRunning ? isStopping : isSubmitting"
          @click="isThreadRunning ? stopCurrentConversation() : submitTask()"
        >
          {{ isThreadRunning ? t('workspace.dock.stop') : t('workspace.dock.submit') }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 输入区并入左栏会话底部（不再是页面级 fixed 浮条）：宽度跟随左栏，
   上方与时间线留出间距。 */
.command-dock {
  flex-shrink: 0;
  margin-top: 10px;
}

.dock-card {
  padding: 10px 12px;
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  box-shadow: var(--shadow2-center);
}

.dock-main-row {
  display: flex;
  align-items: flex-start;
}

/* 队列状态条：排队 chips（可移除）+ 暂停/挂起状态 + 暂停/继续动作 */
.dock-queue-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.queue-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 220px;
  padding: 1px 4px 1px 8px;
  border: 1px solid var(--color-border-2);
  border-radius: 999px;
  background-color: var(--color-fill-1);
  font-size: 12px;
  color: var(--color-text-2);
}

.queue-chip-goal {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-chip-remove {
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--color-text-3);
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 999px;
}

.queue-chip-remove:hover {
  color: rgb(var(--red-6));
  background-color: var(--color-fill-2);
}

.queue-state {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-state.is-paused {
  color: rgb(var(--orange-6));
}

.queue-state.is-held {
  color: rgb(var(--red-6));
}

.queue-action {
  flex-shrink: 0;
}

.dock-input {
  flex: 1;
  min-width: 120px;
}

/* 底部控件行：profile + 模型选择器靠左成组，提交按钮推到最右。
   Arco Select 的根元素不带父组件的 scoped data-v 属性（attrs 手动透传时丢失），
   普通类选择器永远匹配不上——必须经 :deep() 下沉。 */
.dock-bottom-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.dock-bottom-row :deep(.dock-model-select) {
  width: 220px;
  flex-shrink: 0;
  min-width: 0;
  margin-right: auto;
}

.dock-run-info {
  flex-shrink: 0;
}

.dock-profile-group {
  flex-shrink: 0;
}
</style>
