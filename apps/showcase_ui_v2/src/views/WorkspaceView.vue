<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

import AppNav from '@/components/AppNav.vue';
import CommandDock from '@/components/CommandDock.vue';
import FloatingPlayer from '@/components/FloatingPlayer.vue';
import AgentTimeline from '@/components/timeline/AgentTimeline.vue';
import TaskQueuePanel from '@/components/TaskQueuePanel.vue';

/**
 * 工作台（对应 Angular WorkspaceComponent）：
 * a-layout 布局 + 可拖拽左右分栏（左：任务队列面板 / 右：M2 会话时间线
 * AgentTimeline + 底部输入区 CommandDock）。拖拽逻辑平移自 Angular 版：
 * mousemove 监听仅在拖拽期间挂载，宽度更新经 requestAnimationFrame 合帧。
 *
 * 点击左侧历史条目 → session store 选中会话（pin 语义）→ timeline store
 * 按选中会话拉取 steps/notes/checks/usage 并渲染时间线。
 */
// 左栏（队列/历史面板）默认宽度：屏幕的 1/3（与 Angular 版一致）
const sidePanelWidth = ref<number>(
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
  // 面板在左侧：宽度即鼠标到视口左缘的距离
  const newWidth = event.clientX;
  const minWidth = 250;
  const maxWidth = window.innerWidth - 300;
  // 边界限制：面板不小于 250px，右侧时间线区至少留 300px
  if (newWidth >= minWidth && newWidth <= maxWidth) {
    pendingDragWidth = newWidth;
    if (dragWidthRafId === null) {
      dragWidthRafId = requestAnimationFrame(() => {
        dragWidthRafId = null;
        sidePanelWidth.value = pendingDragWidth;
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
      <aside class="workspace-side" :style="{ width: `${sidePanelWidth}px` }">
        <TaskQueuePanel />
      </aside>
      <div class="workspace-divider" :class="{ dragging: isDragging }" @mousedown="onDragStart" />
      <div class="workspace-main">
        <AgentTimeline />
        <!-- 输入区并入会话栏：不再是全页面 fixed 浮条，聊天式「会话流 + 底部输入」 -->
        <CommandDock />
      </div>
    </a-layout>
    <!-- M4 浮动播放器：开合由 player store 的 isVideoWindowOpen 驱动（组件内部 v-if 控制） -->
    <FloatingPlayer />
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
  /* a-layout 基类（.arco-layout）默认 flex-direction: column，不显式声明 row
     会变成上下堆叠——队列面板被压成底部横条，内容一多就挤占时间线。 */
  flex-direction: row;
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
