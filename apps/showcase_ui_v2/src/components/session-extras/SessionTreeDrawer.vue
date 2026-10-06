<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError, apiGet } from '@/services/api';

/**
 * 会话轨迹树抽屉（B6）：
 * 打开时按当前会话拉取 `GET /api/sessions/{id}/tree`（后端 trace_repo.get_trace_tree
 * 返回节点数组：{trace_id, parent_trace_id, type, name, status, timestamp,
 * duration, payload, children[]}），经归一函数映射为 a-tree 的 key/title/children。
 * 仅在抽屉打开时拉取；会话切换后若抽屉仍打开则重拉。失败/空态用 a-empty。
 */
interface TreeItem {
  key: string;
  title: string;
  children: TreeItem[];
}

const props = defineProps<{ visible: boolean; sessionId: string | null }>();
const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>();
const { t } = useI18n();

const loading = ref(false);
const loadError = ref<string | null>(null);
const treeData = ref<TreeItem[]>([]);

function detailOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail || `HTTP ${err.status}`;
  return err instanceof Error && err.message ? err.message : String(err);
}

/** 后端节点 → a-tree 数据。字段全部防御式读取；title 用 name/type/status/duration 拼摘要。 */
function normalizeNodes(raw: unknown, depth = 0): TreeItem[] {
  if (!Array.isArray(raw) || depth > 64) return [];
  return raw.map((node, index) => {
    const n: Record<string, unknown> =
      node && typeof node === 'object' ? (node as Record<string, unknown>) : {};
    const name = typeof n.name === 'string' && n.name ? n.name : '—';
    const type = typeof n.type === 'string' ? n.type : '';
    const status = typeof n.status === 'string' ? n.status : '';
    const traceId = typeof n.trace_id === 'string' && n.trace_id ? n.trace_id : `${depth}-${index}-${name}`;
    const parts = [name];
    if (type) parts.push(type);
    if (status) parts.push(status);
    if (typeof n.duration === 'number' && Number.isFinite(n.duration)) {
      parts.push(`${Math.round(n.duration * 1000)}ms`);
    }
    return {
      key: traceId,
      title: parts.join(' · '),
      children: normalizeNodes(n.children, depth + 1),
    };
  });
}

async function fetchTree(): Promise<void> {
  const sid = props.sessionId;
  if (!sid) return;
  loading.value = true;
  loadError.value = null;
  try {
    const res = await apiGet<unknown>(`/api/sessions/${encodeURIComponent(sid)}/tree`);
    treeData.value = normalizeNodes(res);
  } catch (err) {
    loadError.value = detailOf(err);
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

// 打开时拉取；打开状态下会话切换重拉（不可见时不触发任何请求）。
watch(
  () => [props.visible, props.sessionId] as const,
  ([visible]) => {
    if (visible) void fetchTree();
  },
  { immediate: true },
);

function close(): void {
  emit('update:visible', false);
}
</script>

<template>
  <a-drawer
    :visible="visible"
    :width="420"
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
    <a-tree
      v-else
      :data="treeData"
      :field-names="{ key: 'key', title: 'title', children: 'children' }"
      block-node
      size="small"
      class="trace-tree"
    />
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
</style>
