<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError, apiGet } from '@/services/api';

/**
 * 对话轨迹树抽屉（重构版）：
 * - 覆盖当前会话线程的**全部轮次**：按传入的 rounds（时间正序）并行拉取各轮
 *   `GET /api/sessions/{id}/tree`，根层每轮一个分组节点（第 N 轮 · 目标 · 时间）。
 * - 轮内节点按时间戳正序（后端 SQL 已 ASC，归一时再防御性排序）。
 * - 内容可展开查看：thinking/raw_thinking 的内联 payload 直接生成「请求内容」
 *   子节点；llm_call（payload 可达数百 KB，树响应不携带）挂懒加载子节点，
 *   展开该节点时才请求 `GET /api/traces/{trace_id}` 取完整内容，成功后缓存。
 */
interface TreeItem {
  key: string;
  title: string;
  children: TreeItem[];
  /** 内容叶子：title 渲染为文本，contentText 渲染为可读块。 */
  isContent?: boolean;
  contentText?: string;
  /** 懒加载内容标记（挂在 llm_call 等宿主节点上）。 */
  lazyContent?: { sessionId: string; traceId: string; state: 'idle' | 'loading' | 'loaded' | 'error' };
}

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
const treeData = ref<TreeItem[]>([]);
const expandedKeys = ref<string[]>([]);
const selectedKeys = ref<string[]>([]);

function detailOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail || `HTTP ${err.status}`;
  return err instanceof Error && err.message ? err.message : String(err);
}

function formatPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return t('workspace.tree.contentEmpty');
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/** 后端节点 → a-tree 数据。防御式读取；子节点按 timestamp 正序。 */
function normalizeNodes(raw: unknown, sessionId: string, depth = 0): TreeItem[] {
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
      const parts = [name];
      if (type) parts.push(type);
      if (status) parts.push(status);
      if (typeof n.duration === 'number' && Number.isFinite(n.duration)) {
        parts.push(`${Math.round(n.duration * 1000)}ms`);
      }
      const children = normalizeNodes(n.children, sessionId, depth + 1);
      const item: TreeItem = { key: traceId, title: parts.join(' · '), children };
      if (type === 'llm_call') {
        // 懒加载标记挂在宿主节点上：展开该节点时才拉取完整请求内容
        item.lazyContent = { sessionId, traceId, state: 'idle' };
        children.push({
          key: `${traceId}::content`,
          title: t('workspace.tree.content'),
          children: [],
          isContent: true,
        });
      } else if (n.payload !== null && n.payload !== undefined) {
        children.push({
          key: `${traceId}::content`,
          title: t('workspace.tree.content'),
          children: [],
          isContent: true,
          contentText: formatPayload(n.payload),
        });
      }
      return { item, timestamp };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  return items.map((entry) => entry.item);
}

function findNode(items: TreeItem[], key: string): TreeItem | null {
  for (const item of items) {
    if (item.key === key) return item;
    const found = findNode(item.children, key);
    if (found) return found;
  }
  return null;
}

async function loadLazyContent(node: TreeItem): Promise<void> {
  const lazy = node.lazyContent;
  if (!lazy || lazy.state !== 'idle') return;
  lazy.state = 'loading';
  const child = node.children.find((c) => c.isContent);
  try {
    const res = await apiGet<{ payload?: unknown }>(
      `/api/traces/${encodeURIComponent(lazy.traceId)}`,
    );
    lazy.state = 'loaded';
    if (child) child.contentText = formatPayload(res?.payload ?? null);
  } catch (err) {
    lazy.state = 'error';
    if (child) child.contentText = `${t('workspace.tree.contentFail')}：${detailOf(err)}`;
  }
}

async function onExpandedKeys(keys: (string | number)[]): Promise<void> {
  expandedKeys.value = keys.map(String);
  for (const key of expandedKeys.value) {
    const node = findNode(treeData.value, key);
    if (node?.lazyContent?.state === 'idle') {
      await loadLazyContent(node);
    }
  }
}

async function fetchTrees(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const results = await Promise.allSettled(
      props.rounds.map((round) =>
        apiGet<unknown>(`/api/sessions/${encodeURIComponent(round.id)}/tree`),
      ),
    );
    treeData.value = props.rounds.map((round, index) => {
      const goal = round.goal || '—';
      const head: TreeItem = {
        key: `round:${round.id}`,
        title: `${t('workspace.timeline.roundNumber', { n: round.roundNumber })} · ${goal} · ${round.time}`,
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
            title:
              result.status === 'rejected'
                ? `${t('workspace.tree.roundLoadFail')}：${detailOf(result.reason)}`
                : t('workspace.tree.roundNoTrace'),
            children: [],
          },
        ];
      }
      return head;
    });
    // 默认展开最早的轮次，打开即有内容可见；带定位目标时改为定位该节点
    expandedKeys.value = treeData.value.length ? [treeData.value[0]!.key] : [];
    await applyFocus();
  } catch (err) {
    loadError.value = detailOf(err);
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

/** 从根到目标节点的祖先链（用于展开定位），找不到返回 null。 */
function findPathToNode(items: TreeItem[], key: string, chain: TreeItem[] = []): TreeItem[] | null {
  for (const item of items) {
    const next = [...chain, item];
    if (item.key === key) return next;
    const found = findPathToNode(item.children, key, next);
    if (found) return found;
  }
  return null;
}

/** 全树展开定位：展开目标节点及其祖先链、选中并滚动到该节点；懒加载内容随之就绪。 */
async function applyFocus(): Promise<void> {
  const target = props.focusTraceId;
  if (!target) return;
  const path = findPathToNode(treeData.value, target);
  if (!path) return;
  // 展开目标自身 + 全部祖先（目标展开会触发其懒加载内容）
  await onExpandedKeys(path.map((n) => n.key));
  selectedKeys.value = [target];
  await nextTick();
  document
    .querySelector(`.arco-drawer .arco-tree-node[data-key="${CSS.escape(target)}"]`)
    ?.scrollIntoView?.({ block: 'center' });
}

// 打开时拉取；打开状态下轮次集合变化（新轮提交/线程切换）重拉。
// 按轮次 id 集合比较而非数组引用：sessions 每 6s 重算产生新引用，
// 按引用比较会让打开着的抽屉每 6s 重拉全部轮次的树。
watch(
  () => [props.visible, props.rounds.map((round) => round.id).join(',')] as const,
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
    :width="560"
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
    <a-empty
      v-else-if="treeData.length === 0"
      :description="t('workspace.tree.empty')"
    />
    <a-tree
      v-else
      :data="treeData"
      :field-names="{ key: 'key', title: 'title', children: 'children' }"
      :expanded-keys="expandedKeys"
      :selected-keys="selectedKeys"
      block-node
      size="small"
      class="trace-tree"
      @expand="onExpandedKeys"
    >
      <template #title="scope">
        <template v-if="scope.isContent">
          <span class="content-label">{{ scope.title }}</span>
          <pre
            v-if="scope.contentText"
            class="payload-pre"
          >{{ scope.contentText.length > 200000 ? scope.contentText.slice(0, 200000) + '\n…' : scope.contentText }}</pre>
          <span
            v-if="scope.contentText && scope.contentText.length > 200000"
            class="payload-truncated"
          >{{ t('workspace.tree.contentTruncated') }}</span>
        </template>
        <span v-else>{{ scope.title }}</span>
      </template>
    </a-tree>
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

.trace-tree :deep(.arco-tree-node) {
  font-size: 12.5px;
}

.content-label {
  color: var(--color-text-3);
  font-size: 12px;
}

.payload-pre {
  margin: 4px 0 8px;
  padding: 8px;
  max-height: 320px;
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
  margin: -4px 0 8px;
  color: var(--color-text-3);
  font-size: 11.5px;
}
</style>
