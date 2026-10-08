<script setup lang="ts">
import { computed } from 'vue';
import {
  IconCaretDown,
  IconCode,
  IconFile,
  IconMindMapping,
  IconRobot,
  IconThunderbolt,
} from '@arco-design/web-vue/es/icon';

/**
 * 轨迹树递归分支（可视化层级渲染）：
 * 连接缩进线 + 类型图标（按 trace type）/状态色 + 时长徽标；节点可选中、
 * 分支可折叠（expandedKeys 由抽屉统一持有，本组件只发 toggle/select 事件）。
 * hideLogs 时过滤 type==='log' 的节点（运行日志噪声大，默认可一键隐藏）。
 */
export interface TraceNodeView {
  key: string;
  parentId: string | null;
  type: string;
  name: string;
  status: string;
  timestamp: number;
  duration: number | null;
  /** 轮次分组节点的展示标题（type === 'round' 时有效）。 */
  roundTitle?: string;
  /** 载荷状态：inline=树响应已带；idle/loading/loaded/error=选中时懒加载；none=无。 */
  payloadState?: 'inline' | 'idle' | 'loading' | 'loaded' | 'error' | 'none';
  /** 格式化后的载荷全文（详情面板展示）。 */
  payloadText?: string;
  children: TraceNodeView[];
}

const props = defineProps<{
  nodes: TraceNodeView[];
  level: number;
  selectedKey: string | null;
  expandedKeys: Set<string>;
  hideLogs: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', node: TraceNodeView): void;
  (e: 'toggle', node: TraceNodeView): void;
}>();

const TYPE_ICONS: Record<string, unknown> = {
  llm_call: IconMindMapping,
  tool: IconCode,
  action: IconThunderbolt,
  agent: IconRobot,
  log: IconFile,
};

function iconOf(type: string) {
  return TYPE_ICONS[type] || IconFile;
}

function typeClass(type: string): string {
  return `tt-icon-${type.replace(/[^a-z_]/g, '') || 'other'}`;
}

function statusClass(status: string): string {
  if (status === 'failed' || status === 'error') return 'is-failed';
  if (status === 'retrying') return 'is-retrying';
  return '';
}

const visibleNodes = computed(() =>
  props.hideLogs ? props.nodes.filter((n) => n.type !== 'log') : props.nodes,
);

function hasChildren(node: TraceNodeView): boolean {
  const visibleChildren = props.hideLogs
    ? node.children.filter((c) => c.type !== 'log')
    : node.children;
  return visibleChildren.length > 0;
}

function durationText(node: TraceNodeView): string {
  return node.duration !== null && Number.isFinite(node.duration)
    ? `${Math.round(node.duration * 1000)}ms`
    : '';
}
</script>

<template>
  <ul class="tt-branch" :class="{ 'tt-root': level === 0 }">
    <li
      v-for="node in visibleNodes"
      :key="node.key"
      class="tt-node"
      :class="{ 'tt-leaf': !hasChildren(node) }"
    >
      <div
        class="tt-row"
        :data-node-key="node.key"
        :class="{ 'is-selected': selectedKey === node.key }"
        role="button"
        @click="emit('select', node)"
      >
        <span class="tt-rail" aria-hidden="true"></span>
        <span
          v-if="hasChildren(node)"
          class="tt-toggle"
          :class="{ 'is-open': expandedKeys.has(node.key) }"
          :aria-expanded="expandedKeys.has(node.key)"
          @click.stop="emit('toggle', node)"
        >
          <icon-caret-down />
        </span>
        <span v-else class="tt-toggle tt-toggle-leaf"></span>
        <span class="tt-icon" :class="[typeClass(node.type), statusClass(node.status)]">
          <component :is="iconOf(node.type)" v-if="node.type !== 'round'" />
          <span v-else class="tt-round-dot" aria-hidden="true"></span>
        </span>
        <span class="tt-name" :title="node.name">
          <template v-if="node.type === 'round'">{{ node.roundTitle }}</template>
          <template v-else>{{ node.name }}</template>
        </span>
        <span v-if="node.type !== 'round'" class="tt-type">{{ node.type }}</span>
        <span class="tt-status" :class="statusClass(node.status)">{{ node.status }}</span>
        <span v-if="durationText(node)" class="tt-duration">{{ durationText(node) }}</span>
      </div>
      <div v-if="hasChildren(node) && expandedKeys.has(node.key)" class="tt-children">
        <TraceTreeBranch
          :nodes="node.children"
          :level="level + 1"
          :selected-key="selectedKey"
          :expanded-keys="expandedKeys"
          :hide-logs="hideLogs"
          @select="(n) => emit('select', n)"
          @toggle="(n) => emit('toggle', n)"
        />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.tt-branch {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tt-node {
  position: relative;
}

/* 层级连接线：子分支左侧画竖线 */
.tt-children {
  margin-left: 13px;
  padding-left: 8px;
  border-left: 1px dashed var(--color-border-2);
}

.tt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: var(--border-radius-small);
  cursor: pointer;
  min-width: 0;
}

.tt-row:hover {
  background-color: var(--color-fill-1);
}

.tt-row.is-selected {
  background-color: var(--color-fill-2);
  box-shadow: inset 2px 0 0 rgb(var(--arcoblue-6));
}

.tt-rail {
  flex-shrink: 0;
  width: 2px;
  height: 16px;
}

.tt-toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--color-text-3);
  font-size: 12px;
}

/* 语义一致：收起 = 朝右 ▶，展开 = 朝下 ▼ */
.tt-toggle svg {
  transition: transform 0.15s;
}

.tt-toggle:not(.is-open) svg {
  transform: rotate(-90deg);
}

.tt-toggle :deep(svg),
.tt-toggle svg {
  width: 12px;
  height: 12px;
}

.tt-toggle-leaf {
  visibility: hidden;
}

.tt-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  color: var(--color-text-3);
}

.tt-icon svg {
  width: 13px;
  height: 13px;
}

.tt-icon-llm_call {
  color: rgb(var(--arcoblue-6));
}

.tt-icon-tool {
  color: rgb(var(--green-6));
}

.tt-icon-action {
  color: rgb(var(--orange-6));
}

.tt-icon-agent {
  color: rgb(var(--purple-6));
}

.tt-icon.is-failed {
  color: rgb(var(--red-6));
}

.tt-round-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--arcoblue-6));
}

.tt-name {
  flex-shrink: 1;
  min-width: 0;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--color-text-1);
}

.tt-type {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-3);
  opacity: 0.85;
}

.tt-status {
  flex-shrink: 0;
  font-size: 11px;
  color: rgb(var(--green-6));
}

.tt-status.is-failed {
  color: rgb(var(--red-6));
}

.tt-status.is-retrying {
  color: rgb(var(--orange-6));
}

.tt-duration {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
}
</style>
