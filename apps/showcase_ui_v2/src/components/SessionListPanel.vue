<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconComputer, IconPlus } from '@arco-design/web-vue/es/icon';

import { useSessionStore } from '@/stores/session';
import { formatSessionTime, getTaskStatus } from '@/utils/session-merge';
import type { Session } from '@/types/session.model';

/**
 * 会话列表（左栏，重构自队列/历史双页签面板）：
 * 任务按对话线程（conversation_id）聚合为会话，一行一个会话——名字是线程里
 * 第一条消息，状态徽标取线程内最高优先级状态（运行/暂停置顶）。顶部「新建会话」
 * 生成新线程并选中；点击行选中该会话（右栏时间线随之切换）；行内 hover 提供删除
 * （级联删除线程内全部任务）与停止（线程内有运行中任务时）。
 */
const { t } = useI18n();
const sessionStore = useSessionStore();
const busy = ref(false);

interface ConversationRow {
  id: string;
  name: string;
  /** 线程内有运行中/暂停的轮（进行时信号；结果性状态属于右栏的轮次）。 */
  isRunning: boolean;
  time: number;
  timeText: string;
  taskCount: number;
  deviceSerial: string;
  isSelected: boolean;
  runningTaskId: string | null;
}

const rows = computed<ConversationRow[]>(() =>
  sessionStore.conversationGroups.map((group) => {
    const runningTask = group.rounds.find((round) => {
      const s = getTaskStatus(round, sessionStore.runningSessionId, sessionStore.agentStatus);
      return s === 'running' || s === 'paused';
    });
    return {
      id: group.id,
      name: group.name || t('workspace.conversations.untitled'),
      isRunning: Boolean(runningTask),
      time: group.time,
      timeText: formatSessionTime(group.time),
      taskCount: group.rounds.length,
      deviceSerial: latestDevice(group.rounds),
      isSelected: group.rounds.some(
        (task) => task.session_id === sessionStore.currentSessionId,
      ),
      runningTaskId: runningTask?.session_id ?? null,
    };
  }),
);

function latestDevice(rounds: Session[]): string {
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const serial = rounds[i]?.device_serial;
    if (serial) return serial;
  }
  return '';
}

function createConversation(): void {
  const id = crypto.randomUUID();
  sessionStore.selectConversation(id);
}

function selectConversationRow(row: ConversationRow): void {
  sessionStore.selectConversation(row.id);
  // 选中线程内最新任务，右栏时间线随之定位
  const group = sessionStore.conversationGroups.find((g) => g.id === row.id);
  const latest = group?.rounds[group.rounds.length - 1];
  if (latest) {
    sessionStore.selectSession(latest.session_id, true);
  }
}

function stopRunning(row: ConversationRow): Promise<void> {
  if (!row.runningTaskId) return Promise.resolve();
  busy.value = true;
  return sessionStore
    .stopTask(row.runningTaskId, false)
    .finally(() => setTimeout(() => (busy.value = false), 400));
}

async function deleteConversationRow(row: ConversationRow): Promise<void> {
  const group = sessionStore.conversationGroups.find((g) => g.id === row.id);
  if (!group) return;
  busy.value = true;
  try {
    await sessionStore.deleteConversation(group);
  } finally {
    setTimeout(() => (busy.value = false), 400);
  }
}
</script>

<template>
  <section class="session-list-panel">
    <div class="panel-head">
      <span class="panel-title">{{ t('workspace.conversations.title') }}</span>
      <a-button size="mini" type="outline" class="new-btn" @click="createConversation">
        <template #icon><icon-plus /></template>
        {{ t('workspace.conversations.new') }}
      </a-button>
    </div>

    <a-empty
      v-if="rows.length === 0"
      :description="t('workspace.conversations.empty')"
      class="panel-empty"
    />

    <div v-else class="conversation-list">
      <div
        v-for="row in rows"
        :key="row.id"
        class="conversation-item"
        :class="{ selected: row.isSelected }"
        role="button"
        @click="selectConversationRow(row)"
      >
        <div class="conversation-head">
          <span v-if="row.isRunning" class="live-dot" :title="t('workspace.conversations.running')" />
          <span class="conversation-time">{{ row.timeText }}</span>
        </div>
        <div class="conversation-name" :title="row.name">{{ row.name }}</div>
        <div class="conversation-meta">
          <span v-if="row.deviceSerial" class="conversation-device" :title="row.deviceSerial">
            <icon-computer />
            {{ row.deviceSerial }}
          </span>
          <span class="conversation-count">
            {{ t('workspace.conversations.roundsCount', { n: row.taskCount }) }}
          </span>
          <span class="conversation-actions" @click.stop>
            <a-button
              v-if="row.runningTaskId"
              size="mini"
              type="text"
              status="warning"
              :loading="busy"
              @click="stopRunning(row)"
            >
              {{ t('workspace.conversations.stop') }}
            </a-button>
            <a-popconfirm
              :content="t('workspace.conversations.deleteConfirm')"
              type="warning"
              @ok="deleteConversationRow(row)"
            >
              <a-button size="mini" type="text" status="danger" :disabled="busy">
                {{ t('workspace.conversations.delete') }}
              </a-button>
            </a-popconfirm>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.session-list-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-1);
  padding: 10px 12px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-2);
  flex-shrink: 0;
}

.panel-title {
  font-weight: 600;
  font-size: 13px;
}

.panel-empty {
  margin-top: 40px;
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
}

.conversation-item {
  padding: 8px 10px;
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: background-color 0.15s, box-shadow 0.15s;
}

.conversation-item:hover {
  background-color: var(--color-fill-1);
}

.conversation-item.selected {
  background-color: var(--color-fill-2);
  box-shadow: inset 2px 0 0 rgb(var(--arcoblue-6));
}

.conversation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 进行时指示：线程内有运行中的轮（结果性状态不在此展示） */
.live-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgb(var(--green-6));
  animation: live-pulse 1.2s ease-in-out infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.conversation-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
}

.conversation-name {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.conversation-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--color-text-3);
  min-width: 0;
}

.conversation-device {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-count {
  flex-shrink: 0;
}

.conversation-actions {
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.conversation-item:hover .conversation-actions,
.conversation-item.selected .conversation-actions {
  opacity: 1;
}
</style>
