<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

import AppNav from '@/components/AppNav.vue';
import CommandDock from '@/components/CommandDock.vue';
import AgentTimeline from '@/components/timeline/AgentTimeline.vue';
import TaskQueuePanel from '@/components/TaskQueuePanel.vue';

/**
 * 工作台（对应 Angular WorkspaceComponent）：
 * a-layout 布局 + 可拖拽分栏（左：M2 会话时间线 AgentTimeline / 右：任务队列面板）
 * + 浮动命令条。拖拽逻辑平移自 Angular 版：mousemove 监听仅在拖拽期间挂载，
 * 宽度更新经 requestAnimationFrame 合帧。
 *
 * 点击右侧历史条目 → session store 选中会话（pin 语义）→ timeline store
 * 按选中会话拉取 steps/notes/checks/usage 并渲染时间线。
 */
// 右栏默认宽度：屏幕的 1/3（与 Angular 版一致）
const rightPanelWidth = ref<number>(
  typeof window !== 'undefined' ? Math.round(window.innerWidth / 3) : 450,
);
const isDragging = ref(false);
let dragWidthRafId: number | null = null;
let pendingDragWidth = 0;

function onDragStart(event: MouseEvent): void {
  isDragging.value = true;
  event.preventDefault();
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

const onMouseMove = (event: MouseEvent): void => {
  if (!isDragging.value) {
    return;
  }
  const newWidth = window.innerWidth - event.clientX;
  const minWidth = 250;
  const maxWidth = window.innerWidth - 300;
  // 边界限制，防止面板缩得过小
  if (newWidth >= minWidth && newWidth <= maxWidth) {
    pendingDragWidth = newWidth;
    if (dragWidthRafId === null) {
      dragWidthRafId = requestAnimationFrame(() => {
        dragWidthRafId = null;
        rightPanelWidth.value = pendingDragWidth;
      });
    }
  }
};

const onMouseUp = (): void => {
  isDragging.value = false;
  detachDragListeners();
};

function detachDragListeners(): void {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  if (dragWidthRafId !== null) {
    cancelAnimationFrame(dragWidthRafId);
    dragWidthRafId = null;
  }
}

onBeforeUnmount(detachDragListeners);
</script>

<template>
  <a-layout class="workspace">
    <a-layout-header class="workspace-header">
      <AppNav />
    </a-layout-header>
    <a-layout class="workspace-body">
      <div class="workspace-main">
        <AgentTimeline />
      </div>
      <div class="workspace-divider" :class="{ dragging: isDragging }" @mousedown="onDragStart" />
      <aside class="workspace-side" :style="{ width: `${rightPanelWidth}px` }">
        <TaskQueuePanel />
      </aside>
    </a-layout>
    <CommandDock />
  </a-layout>
</template>

<style scoped>
.workspace {
  height: 100vh;
}

.workspace-header {
  height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  background-color: var(--color-bg-1);
  border-bottom: 1px solid var(--color-border-2);
  line-height: normal;
}

.workspace-body {
  display: flex;
  overflow: hidden;
}

.workspace-main {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-divider {
  width: 5px;
  cursor: col-resize;
  background-color: var(--color-border-1);
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.workspace-divider:hover,
.workspace-divider.dragging {
  background-color: rgb(var(--arcoblue-6));
}

.workspace-side {
  min-width: 250px;
  max-width: calc(100vw - 300px);
  overflow: hidden;
  padding: 12px;
  background-color: var(--color-bg-1);
}
</style>
