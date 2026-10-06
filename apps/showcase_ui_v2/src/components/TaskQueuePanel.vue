<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSessionStore } from '@/stores/session';
import { getTaskStatus, resolveDeviceSerial } from '@/utils/session-merge';
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

const STATUS_COLOR: Record<string, string> = {
  running: 'arcoblue',
  paused: 'orange',
  pending: 'gray',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

function statusColor(s: Session): string {
  return STATUS_COLOR[statusOf(s)] || 'gray';
}

function statusText(s: Session): string {
  return t(`status.${statusOf(s)}`);
}

function formatTime(startTime?: number): string {
  if (!startTime) return '--:--';
  return new Date(startTime * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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
                <span class="task-goal" :title="s.initial_goal">{{ s.initial_goal }}</span>
              </div>
              <div class="task-meta">
                <span class="task-device" :title="resolveDeviceSerial(s) || ''">
                  {{ t('workspace.queue.device') }}:
                  {{ resolveDeviceSerial(s) || t('workspace.queue.noDevice') }}
                </span>
                <span class="task-time">{{ formatTime(s.start_time) }}</span>
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

        <div class="history-toolbar">
          <a-popconfirm
            :content="t('workspace.queue.clearAllConfirm')"
            type="warning"
            @ok="clearHistory"
          >
            <a-button size="mini" status="danger" :disabled="historyTasks.length === 0 || busy">
              {{ t('workspace.queue.clearAll') }}
            </a-button>
          </a-popconfirm>
        </div>

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
                <span class="task-goal" :title="s.initial_goal">{{ s.initial_goal }}</span>
              </div>
              <div class="task-meta">
                <span class="task-device" :title="resolveDeviceSerial(s) || ''">
                  {{ t('workspace.queue.device') }}:
                  {{ resolveDeviceSerial(s) || t('workspace.queue.noDevice') }}
                </span>
                <span class="task-time">{{ formatTime(s.start_time) }}</span>
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

.history-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 4px 8px;
}

.task-item {
  cursor: pointer;
  border-radius: var(--border-radius-small);
  transition: background-color 0.2s;
}

.task-item:hover {
  background-color: var(--color-fill-1);
}

.task-item.selected {
  background-color: var(--color-fill-2);
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-goal {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-text-1);
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-3);
}

.task-device {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-time {
  margin-left: auto;
  flex-shrink: 0;
}

.task-actions {
  flex-shrink: 0;
}
</style>
