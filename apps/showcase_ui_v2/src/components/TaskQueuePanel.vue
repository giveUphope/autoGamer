<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconComputer } from '@arco-design/web-vue/es/icon';

import { useSessionStore } from '@/stores/session';
import { getTaskStatus, resolveDeviceSerial, sessionStatusColor, formatSessionTime } from '@/utils/session-merge';
import type { Session } from '@/types/session.model';

/**
 * 任务队列面板（对应 Angular ChatInterfaceComponent，逻辑平移、UI 按 Arco 重做）：
 * - 「队列」tab：运行 / 暂停 / 排队中的任务（运行优先、按提交顺序 FIFO）
 * - 「历史」tab：completed / failed / cancelled 会话
 * - 单条停止（运行中）、a-popconfirm 删除（历史）、清空历史、点击选中会话
 */
const { t } = useI18n();
const sessionStore = useSessionStore();

const activeTab = ref<'queue' | 'history'>('queue');
const busy = ref(false);

function statusOf(s: Session) {
  return getTaskStatus(s, sessionStore.runningSessionId, sessionStore.agentStatus);
}

/** 运行/暂停/排队中的任务；运行优先，其余按提交顺序 FIFO（平移自 activeQueue computed）。 */
const activeQueue = computed<Session[]>(() => {
  const list = sessionStore.sessions.filter((s) => {
    const status = statusOf(s);
    return status === 'running' || status === 'paused' || status === 'pending';
  });
  return list.sort((a, b) => {
    const statusA = statusOf(a);
    const statusB = statusOf(b);
    const isRunA = statusA === 'running' || statusA === 'paused';
    const isRunB = statusB === 'running' || statusB === 'paused';
    if (isRunA && !isRunB) return -1;
    if (!isRunA && isRunB) return 1;
    return (a.start_time || 0) - (b.start_time || 0);
  });
});

/** 历史/已完成任务（平移自 historyTasks computed）。 */
const historyTasks = computed<Session[]>(() =>
  sessionStore.sessions.filter((s) => {
    const status = statusOf(s);
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }),
);

function statusColor(s: Session): string {
  return sessionStatusColor(statusOf(s));
}

function statusText(s: Session): string {
  return t(`status.${statusOf(s)}`);
}

function formatTime(startTime?: number): string {
  return formatSessionTime(startTime);
}

/** 本次任务实际使用的模型（会话自报的 model_info.name；未下发则不展示）。 */
function modelName(s: Session): string {
  return s.model_info?.name || '';
}

async function withBusy(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  try {
    await action();
  } finally {
    // 与 Angular 版一致：给乐观更新 + 状态回查留一小段 loading 展示窗口
    setTimeout(() => {
      busy.value = false;
    }, 400);
  }
}

function stopTask(sessionId: string): Promise<void> {
  return withBusy(() => sessionStore.stopTask(sessionId, false));
}

function deleteTask(sessionId: string): Promise<void> {
  return withBusy(() => sessionStore.deleteSession(sessionId));
}

function clearHistory(): Promise<void> {
  return withBusy(() => sessionStore.clearAllHistory());
}

function selectTask(sessionId: string): void {
  sessionStore.selectSession(sessionId, true);
}
</script>

<template>
  <section class="task-queue-panel">
    <a-tabs v-model:active-key="activeTab" size="medium" class="queue-tabs">
      <!-- 清空历史收进页签行右侧（历史 tab 才显示），不再独占一行 -->
      <template #extra>
        <a-popconfirm
          v-if="activeTab === 'history'"
          :content="t('workspace.queue.clearAllConfirm')"
          type="warning"
          @ok="clearHistory"
        >
          <a-button size="mini" status="danger" :disabled="historyTasks.length === 0 || busy">
            {{ t('workspace.queue.clearAll') }}
          </a-button>
        </a-popconfirm>
      </template>

      <a-tab-pane key="queue">
        <template #title>
          <a-badge :count="activeQueue.length" :max-count="99" :offset="[8, -3]">
            {{ t('workspace.queue.tabQueue') }}
          </a-badge>
        </template>

        <a-empty v-if="activeQueue.length === 0" :description="t('workspace.queue.emptyQueue')" />
        <a-list v-else :bordered="false" :split="true" size="small">
          <a-list-item
            v-for="s in activeQueue"
            :key="s.session_id"
            class="task-item"
            :class="{ selected: s.session_id === sessionStore.currentSessionId }"
            @click="selectTask(s.session_id)"
          >
            <div class="task-row">
              <div class="task-head">
                <a-tag :color="statusColor(s)" size="small">{{ statusText(s) }}</a-tag>
                <span class="task-time">{{ formatTime(s.start_time) }}</span>
              </div>
              <div class="task-goal" :title="s.initial_goal">{{ s.initial_goal }}</div>
              <div class="task-meta">
                <span class="task-device" :title="resolveDeviceSerial(s) || ''">
                  <icon-computer />
                  {{ resolveDeviceSerial(s) || t('workspace.queue.noDevice') }}
                </span>
                <span v-if="modelName(s)" class="task-model" :title="modelName(s)">
                  {{ modelName(s) }}
                </span>
                <span class="task-actions" @click.stop>
                  <a-button
                    size="mini"
                    type="text"
                    status="danger"
                    :loading="busy"
                    @click="stopTask(s.session_id)"
                  >
                    {{ t('workspace.queue.stop') }}
                  </a-button>
                </span>
              </div>
            </div>
          </a-list-item>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="history">
        <template #title>
          <a-badge :count="historyTasks.length" :max-count="99" :offset="[8, -3]">
            {{ t('workspace.queue.tabHistory') }}
          </a-badge>
        </template>

        <a-empty v-if="historyTasks.length === 0" :description="t('workspace.queue.emptyHistory')" />
        <a-list v-else :bordered="false" :split="true" size="small">
          <a-list-item
            v-for="s in historyTasks"
            :key="s.session_id"
            class="task-item"
            :class="{ selected: s.session_id === sessionStore.currentSessionId }"
            @click="selectTask(s.session_id)"
          >
            <div class="task-row">
              <div class="task-head">
                <a-tag :color="statusColor(s)" size="small">{{ statusText(s) }}</a-tag>
                <span class="task-time">{{ formatTime(s.start_time) }}</span>
              </div>
              <div class="task-goal" :title="s.initial_goal">{{ s.initial_goal }}</div>
              <div class="task-meta">
                <span class="task-device" :title="resolveDeviceSerial(s) || ''">
                  <icon-computer />
                  {{ resolveDeviceSerial(s) || t('workspace.queue.noDevice') }}
                </span>
                <span v-if="modelName(s)" class="task-model" :title="modelName(s)">
                  {{ modelName(s) }}
                </span>
                <span class="task-actions" @click.stop>
                  <a-popconfirm
                    :content="t('workspace.queue.deleteConfirm')"
                    type="warning"
                    @ok="deleteTask(s.session_id)"
                  >
                    <a-button size="mini" type="text" status="danger" :disabled="busy">
                      {{ t('workspace.queue.delete') }}
                    </a-button>
                  </a-popconfirm>
                </span>
              </div>
            </div>
          </a-list-item>
        </a-list>
      </a-tab-pane>
    </a-tabs>
  </section>
</template>

<style scoped>
.task-queue-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-1);
}

.queue-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.queue-tabs :deep(.arco-tabs-content) {
  flex: 1;
  overflow-y: auto;
  padding-top: 4px;
}

.task-item {
  cursor: pointer;
  border-radius: var(--border-radius-small);
  transition: background-color 0.2s, box-shadow 0.2s;
}

.task-item:hover {
  background-color: var(--color-fill-1);
}

/* 选中态：背景 + 左侧 accent 条，与左栏会话头互相印证 */
.task-item.selected {
  background-color: var(--color-fill-2);
  box-shadow: inset 2px 0 0 rgb(var(--arcoblue-6));
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-goal {
  min-width: 0;
  font-size: 13px;
  color: var(--color-text-1);
  /* 目标是条目的主要信息，给两行空间而不是单行省略 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--color-text-3);
  min-width: 0;
}

.task-device {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-model {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}

/* 危险操作（停止/删除）hover 才出现：不干扰浏览，位置稳定不跳动 */
.task-actions {
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.task-item:hover .task-actions,
.task-item.selected .task-actions {
  opacity: 1;
}

.task-time {
  margin-left: auto;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
