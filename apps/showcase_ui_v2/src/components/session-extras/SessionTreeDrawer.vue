<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import TraceTreeBranch from './TraceTreeBranch.vue';
import type { TraceNodeView } from './TraceTreeBranch.vue';
import { ApiError, apiGet } from '@/services/api';

/**
 * 对话轨迹树抽屉（可视化树版）：
 * - 左栏：递归分支渲染的真实层级树——类型图标/状态色/时长徽标/连接缩进线，
 *   根层为线程全部轮次（时间正序），支持「隐藏运行日志」降噪。
 * - 右栏：选中节点的详情面板——元数据（类型/状态/时间/时长/Trace Id/父节点）
 *   + 请求内容全文（llm_call 懒加载 `GET /api/traces/{trace_id}`，其余类型内联）。
 * - 动作卡「轨迹」入口 → focusTraceId 全树展开定位到该节点。
 */
const props = defineProps<{
  visible: boolean;
  /** 当前线程的全部轮次（时间正序，来自 AgentTimeline 的 rounds）。 */
  rounds: Array<{ id: string; roundNumber: number; goal: string; time: string }>;
  /** 需要定位高亮的轨迹节点 id（时间线动作卡「轨迹」入口传入）。 */
  focusTraceId?: string | null;
}>();
const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>();
const { t } = useI18n();

const loading = ref(false);
const loadError = ref<string | null>(null);
const treeData = ref<TraceNodeView[]>([]);
const expandedKeys = ref(new Set<string>());
const selectedKey = ref<string | null>(null);
// 默认隐藏 log 节点：用户关注的是可读的 agent 调用与工具调用，
// 框架运行日志噪声大，需要时用工具条复选框展开
const hideLogs = ref(true);

function detailOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail || `HTTP ${err.status}`;
  return err instanceof Error && err.message ? err.message : String(err);
}

/** 时长类载荷数值统一四舍五入到两位小数（0.8063035… → 0.81），完整精度由 DB 留存。 */
const DURATION_PAYLOAD_KEYS = new Set(['duration', 'duration_ms']);

function roundDurationValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(roundDurationValues);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] =
      DURATION_PAYLOAD_KEYS.has(key.toLowerCase()) && typeof val === 'number' && Number.isFinite(val)
        ? Number(val.toFixed(2))
        : roundDurationValues(val);
  }
  return out;
}

function formatPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return t('workspace.tree.contentEmpty');
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(roundDurationValues(payload), null, 2);
  } catch {
    return String(payload);
  }
}

function formatClock(timestamp: number): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 后端节点 → 可视化节点。防御式读取；子节点按 timestamp 正序。 */
function normalizeNodes(raw: unknown, sessionId: string, depth = 0): TraceNodeView[] {
  if (!Array.isArray(raw) || depth > 64) return [];
  const items = raw
    .map((node, index) => {
      const n: Record<string, unknown> =
        node && typeof node === 'object' ? (node as Record<string, unknown>) : {};
      const name = typeof n.name === 'string' && n.name ? n.name : '—';
      const type = typeof n.type === 'string' ? n.type : '';
      const status = typeof n.status === 'string' ? n.status : '';
      const traceId = typeof n.trace_id === 'string' && n.trace_id ? n.trace_id : `${depth}-${index}-${name}`;
      const timestamp = typeof n.timestamp === 'number' && Number.isFinite(n.timestamp) ? n.timestamp : 0;
      const duration =
        typeof n.duration === 'number' && Number.isFinite(n.duration) ? n.duration : null;
      const parent = typeof n.parent_trace_id === 'string' ? n.parent_trace_id : null;

      const children = normalizeNodes(n.children, sessionId, depth + 1);
      const view: TraceNodeView = {
        key: traceId,
        parentId: parent,
        type: type || 'other',
        name,
        status: status || '—',
        timestamp,
        duration,
        children,
      };
      if (n.payload !== null && n.payload !== undefined) {
        // 小载荷（thinking/action/tool）内联；llm_call 保持懒加载
        view.payloadText = formatPayload(n.payload);
        view.payloadState = 'inline';
      } else if (type === 'llm_call') {
        view.payloadState = 'idle';
      } else {
        view.payloadState = 'none';
      }
      void sessionId;
      return { item: view, timestamp };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  return items.map((entry) => entry.item);
}

function findNode(items: TraceNodeView[], key: string): TraceNodeView | null {
  for (const item of items) {
    if (item.key === key) return item;
    const found = findNode(item.children, key);
    if (found) return found;
  }
  return null;
}

const selectedNode = computed(() =>
  selectedKey.value ? findNode(treeData.value, selectedKey.value) : null,
);

async function loadPayload(node: TraceNodeView): Promise<void> {
  if (node.payloadState !== 'idle') return;
  node.payloadState = 'loading';
  try {
    const res = await apiGet<{ payload?: unknown }>(
      `/api/traces/${encodeURIComponent(node.key)}`,
    );
    node.payloadState = 'loaded';
    node.payloadText = formatPayload(res?.payload ?? null);
  } catch (err) {
    node.payloadState = 'error';
    node.payloadText = `${t('workspace.tree.contentFail')}：${detailOf(err)}`;
  }
}

function onSelect(node: TraceNodeView): void {
  selectedKey.value = node.key;
  if (node.payloadState === 'idle') void loadPayload(node);
}

function onToggle(node: TraceNodeView): void {
  if (expandedKeys.value.has(node.key)) expandedKeys.value.delete(node.key);
  else expandedKeys.value.add(node.key);
}

async function fetchTrees(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  selectedKey.value = null;
  try {
    const results = await Promise.allSettled(
      props.rounds.map((round) =>
        apiGet<unknown>(`/api/sessions/${encodeURIComponent(round.id)}/tree`),
      ),
    );
    treeData.value = props.rounds.map((round, index) => {
      const goal = round.goal || '—';
      const head: TraceNodeView = {
        key: `round:${round.id}`,
        parentId: null,
        type: 'round',
        name: goal,
        status: '',
        timestamp: 0,
        duration: null,
        roundTitle: `${t('workspace.timeline.roundNumber', { n: round.roundNumber })} · ${goal} · ${round.time}`,
        children: [],
      };
      const result = results[index];
      if (result.status === 'fulfilled') {
        head.children = normalizeNodes(result.value, round.id, 1);
      }
      if (head.children.length === 0) {
        head.children = [
          {
            key: `round:${round.id}:empty`,
            parentId: head.key,
            type: 'placeholder',
            name:
              result.status === 'rejected'
                ? `${t('workspace.tree.roundLoadFail')}：${detailOf(result.reason)}`
                : t('workspace.tree.roundNoTrace'),
            status: '',
            timestamp: 0,
            duration: null,
            children: [],
          },
        ];
      }
      return head;
    });
    expandedKeys.value = new Set(
      treeData.value.length ? [treeData.value[0]!.key] : [],
    );
    await applyFocus();
  } catch (err) {
    loadError.value = detailOf(err);
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

/** 从根到目标节点的祖先链（用于展开定位），找不到返回 null。 */
function findPathToNode(items: TraceNodeView[], key: string, chain: TraceNodeView[] = []): TraceNodeView[] | null {
  for (const item of items) {
    const next = [...chain, item];
    if (item.key === key) return next;
    const found = findPathToNode(item.children, key, next);
    if (found) return found;
  }
  return null;
}

/** 全树展开定位：展开祖先链、选中并滚动到该节点；懒加载内容随之就绪。 */
async function applyFocus(): Promise<void> {
  const target = props.focusTraceId;
  if (!target) return;
  const path = findPathToNode(treeData.value, target);
  if (!path) return;
  for (const n of path) expandedKeys.value.add(n.key);
  selectedKey.value = target;
  await nextTick();
  document
    .querySelector(`.arco-drawer .tt-row[data-node-key="${CSS.escape(target)}"]`)
    ?.scrollIntoView?.({ block: 'center' });
  // 定位即查看：目标节点的懒加载内容随之拉取
  const node = path[path.length - 1]!;
  if (node.payloadState === 'idle') void loadPayload(node);
}

// 打开时拉取；打开状态下轮次集合变化（新轮提交/线程切换）重拉。
// watch 源必须是稳定基本量：getter 返回新数组时 Vue 按引用比较，
// AgentTimeline 每个轮询周期重渲染都会触发回调，把刚展开的内容重置掉。
const roundsKey = computed(() => props.rounds.map((round) => round.id).join(','));
watch(
  [() => props.visible, roundsKey],
  ([visible]) => {
    if (visible) void fetchTrees();
  },
  { immediate: true },
);

// 抽屉已开时定位目标变化（连续点击不同动作卡的「轨迹」）→ 重新定位
watch(
  () => props.focusTraceId,
  (target) => {
    if (props.visible && target && !loading.value) void applyFocus();
  },
);

function close(): void {
  emit('update:visible', false);
}
</script>

<template>
  <a-drawer
    :visible="visible"
    :width="780"
    :title="t('workspace.tree.title')"
    :footer="false"
    unmount-on-close
    @cancel="close"
  >
    <a-spin v-if="loading" :loading="true" class="tree-loading">
      <div class="loading-inner">{{ t('workspace.tree.loading') }}</div>
    </a-spin>
    <a-empty
      v-else-if="loadError"
      :description="`${t('workspace.tree.loadFail')}：${loadError}`"
    />
    <a-empty v-else-if="treeData.length === 0" :description="t('workspace.tree.empty')" />
    <div v-else class="tree-layout">
      <div class="tree-pane">
        <div class="pane-toolbar">
          <a-checkbox v-model:model-value="hideLogs" size="small">
            {{ t('workspace.tree.hideLogs') }}
          </a-checkbox>
        </div>
        <div class="pane-scroll">
          <TraceTreeBranch
            :nodes="treeData"
            :level="0"
            :selected-key="selectedKey"
            :expanded-keys="expandedKeys"
            :hide-logs="hideLogs"
            @select="onSelect"
            @toggle="onToggle"
          />
        </div>
      </div>
      <div class="detail-pane">
        <template v-if="selectedNode">
          <div class="detail-head">
            <span class="detail-name" :title="selectedNode.name">{{ selectedNode.name }}</span>
            <span class="detail-type">{{ selectedNode.type }}</span>
          </div>
          <div class="detail-grid">
            <span class="grid-label">{{ t('workspace.tree.metaStatus') }}</span>
            <span class="grid-value">{{ selectedNode.status || '—' }}</span>
            <span class="grid-label">{{ t('workspace.tree.metaTime') }}</span>
            <span class="grid-value">{{ formatClock(selectedNode.timestamp) }}</span>
            <span class="grid-label">{{ t('workspace.tree.metaDuration') }}</span>
            <span class="grid-value">
              {{ selectedNode.duration !== null ? `${Math.round(selectedNode.duration * 1000)}ms` : '—' }}
            </span>
            <span class="grid-label">{{ t('workspace.tree.metaChildren') }}</span>
            <span class="grid-value">{{ selectedNode.children.length }}</span>
            <span class="grid-label">{{ t('workspace.tree.metaTraceId') }}</span>
            <span class="grid-value code">{{ selectedNode.key }}</span>
            <template v-if="selectedNode.parentId">
              <span class="grid-label">{{ t('workspace.tree.metaParent') }}</span>
              <span class="grid-value code">{{ selectedNode.parentId }}</span>
            </template>
          </div>
          <div class="detail-payload">
            <div class="payload-title">{{ t('workspace.tree.content') }}</div>
            <a-spin v-if="selectedNode.payloadState === 'loading'" class="payload-loading" :loading="true" :size="16" />
            <pre v-else-if="selectedNode.payloadText" class="payload-pre">{{
              selectedNode.payloadText.length > 200000
                ? selectedNode.payloadText.slice(0, 200000) + '\n…'
                : selectedNode.payloadText
            }}</pre>
            <span
              v-else-if="selectedNode.payloadText && selectedNode.payloadText.length > 200000"
              class="payload-truncated"
            >{{ t('workspace.tree.contentTruncated') }}</span>
            <div v-else-if="selectedNode.payloadState === 'error'" class="payload-none">
              {{ selectedNode.payloadText }}
            </div>
            <div v-else class="payload-none">{{ t('workspace.tree.contentEmpty') }}</div>
          </div>
        </template>
        <a-empty v-else :description="t('workspace.tree.detailEmpty')" />
      </div>
    </div>
  </a-drawer>
</template>

<style scoped>
.tree-loading {
  display: block;
  width: 100%;
  padding: 40px 0;
}

.loading-inner {
  padding: 20px;
  color: var(--color-text-3);
  font-size: 13px;
}

.tree-layout {
  display: flex;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.tree-pane {
  flex: 1.05;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pane-toolbar {
  display: flex;
  align-items: center;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-1);
}

.pane-scroll {
  flex: 1;
  overflow: auto;
  padding-top: 4px;
}

.detail-pane {
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--color-border-1);
  padding-left: 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.detail-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 8px;
}

.detail-name {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-type {
  flex-shrink: 0;
  font-size: 11.5px;
  color: rgb(var(--arcoblue-6));
}

.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  font-size: 12px;
  padding-bottom: 10px;
}

.grid-label {
  color: var(--color-text-3);
}

.grid-value {
  color: var(--color-text-1);
  word-break: break-all;
}

.grid-value.code {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
}

.detail-payload {
  border-top: 1px solid var(--color-border-1);
  padding-top: 8px;
}

.payload-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-2);
  margin-bottom: 6px;
}

.payload-loading {
  display: block;
  padding: 12px 0;
}

.payload-pre {
  margin: 0;
  padding: 8px;
  max-height: 480px;
  overflow: auto;
  background-color: var(--color-fill-2);
  border-radius: var(--border-radius-small);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-2);
}

.payload-truncated {
  display: block;
  margin-top: 4px;
  color: var(--color-text-3);
  font-size: 11.5px;
}

.payload-none {
  color: var(--color-text-3);
  font-size: 12px;
  padding: 6px 0;
}
</style>
