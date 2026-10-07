<script setup lang="ts">
/**
 * 端点库表格：一行一条记录，列名即上方端点信息表单的字段（提供商 / API 格式 /
 * API 端点地址 / 模型名称 / API Key），外加操作列；当前生效的那条带「当前」徽标。
 * 「编辑」向父组件回传该行记录（由端点信息表单回填重新编辑，掩码 Key 不回填，
 * 语义为留空沿用）；「删除」按行的来源分两种——库记录只移除记录本身，
 * 只存在于 artemis.jsonc default 块的那一行会清空当前配置。
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconDelete, IconEdit } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import type { CredentialEndpointRow } from './contract';
import { apiFormatLabel } from '@/utils/model-format';
import { errText } from './errors';

const emit = defineEmits<{ (e: 'edit', row: CredentialEndpointRow): void }>();

const { t } = useI18n();
const system = useSystemContract();

const rows = computed(() => system.credentialRows ?? []);
const isDeleting = ref(false);
const error = ref<string | null>(null);

const COLUMNS = [
  { key: 'provider', labelKey: 'endpointProviderLabel' },
  { key: 'api_format', labelKey: 'endpointFormatLabel' },
  { key: 'api_base', labelKey: 'endpointBaseUrlLabel' },
  { key: 'model', labelKey: 'endpointModelLabel' },
  { key: 'api_key', labelKey: 'endpointApiKeyLabel' },
] as const;

function columnLabel(labelKey: string): string {
  return t(`launcher.diagnostics.cred.${labelKey}`);
}

function displayValue(field: string, value: string | null): string {
  if (!value) return '—';
  if (field === 'api_format') return apiFormatLabel(t, value);
  return value;
}

function onEdit(row: CredentialEndpointRow): void {
  emit('edit', { ...row });
}

async function onDelete(row: CredentialEndpointRow): Promise<void> {
  if (isDeleting.value) return;
  isDeleting.value = true;
  error.value = null;
  try {
    await system.deleteEndpointRecord(row);
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.credsDeleteFail'));
  } finally {
    isDeleting.value = false;
  }
}

/** 删除确认按行的来源分措辞：库记录删了不动配置，default 行会真的清空配置。 */
function deleteConfirm(row: CredentialEndpointRow): string {
  return row.source === 'library' && row.provider
    ? t('launcher.diagnostics.cred.credsDeleteLibraryConfirm')
    : t('launcher.diagnostics.cred.credsDeleteDefaultConfirm');
}

onMounted(() => {
  void system.fetchCredentialEntries().catch(() => undefined);
});
</script>

<template>
  <div class="creds-card">
    <div class="creds-head">
      <span class="creds-title">{{ t('launcher.diagnostics.cred.credsTitle') }}</span>
      <span class="creds-sub">{{ t('launcher.diagnostics.cred.credsSubtitle') }}</span>
    </div>

    <!-- 端点库（一行一条记录，列名 = 表单字段，末列为操作；当前生效的那条带徽标） -->
    <table v-if="rows.length" class="creds-table">
      <colgroup>
        <col style="width: 17%" />
        <col style="width: 18%" />
        <col style="width: 25%" />
        <col style="width: 17%" />
        <col style="width: 10%" />
        <!-- 两个 mini 图标按钮各 36px + 4px 间距 + 左右内边距，窄一档就会被裁掉半个图标 -->
        <col style="width: 88px" />
      </colgroup>
      <thead>
        <tr>
          <th v-for="col in COLUMNS" :key="col.key">{{ columnLabel(col.labelKey) }}</th>
          <th>{{ t('launcher.diagnostics.cred.credsActionsLabel') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="`${row.source}:${row.provider ?? ''}:${i}`">
          <td
            v-for="col in COLUMNS"
            :key="col.key"
            :class="{ mono: col.key !== 'provider' }"
            :title="row[col.key] ?? undefined"
          >
            <span v-if="col.key === 'provider' && row.is_active" class="creds-active-tag">
              {{ t('launcher.diagnostics.cred.credsActive') }}
            </span>
            {{ displayValue(col.key, row[col.key]) }}
          </td>
          <td class="actions-cell">
            <!-- 按钮包在 span 里：td 一旦设成 flex 就退出表格单元格布局，行高会不齐 -->
            <span class="actions-inner">
              <a-button
                size="mini"
                type="text"
                class="creds-edit-btn"
                :title="t('launcher.diagnostics.cred.credsEditBtn')"
                @click="onEdit(row)"
              >
                <icon-edit />
              </a-button>
              <a-popconfirm :content="deleteConfirm(row)" type="warning" @ok="onDelete(row)">
                <a-button
                  size="mini"
                  type="text"
                  class="creds-delete-btn"
                  :loading="isDeleting"
                  :title="t('launcher.diagnostics.cred.credsDeleteBtn')"
                >
                  <icon-delete />
                </a-button>
              </a-popconfirm>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="creds-empty">{{ t('launcher.diagnostics.cred.credsEmpty') }}</p>

    <a-alert v-if="error" type="error" class="creds-alert">{{ error }}</a-alert>
  </div>
</template>

<style scoped>
.creds-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
}

.creds-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.creds-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.creds-sub {
  font-size: 12px;
  color: var(--color-text-3);
}

.creds-table {
  width: 100%;
  border-collapse: collapse;
  /* 固定列宽 + 单元格不换行：行高不再随内容长短变化，长地址截断并由 title 给出全文 */
  table-layout: fixed;
  font-size: 12px;
}

.creds-table th,
.creds-table td {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--color-border-2);
  height: 32px;
  box-sizing: border-box;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.creds-table th {
  font-weight: 500;
  color: var(--color-text-2);
  background-color: var(--color-fill-2);
}

.creds-table td {
  color: var(--color-text-2);
}

.creds-table td.mono {
  font-family: var(--font-mono, monospace);
}

.creds-active-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border: 1px solid rgb(var(--green-6) / 45%);
  border-radius: var(--border-radius-small);
  color: rgb(var(--green-6));
  font-size: 10px;
  line-height: 14px;
}

/* 必须与 .creds-table td 同级压过它：只写 .actions-cell 会被后者的 padding 覆盖，
   按钮就会顶出单元格边界被 overflow:hidden 裁掉半个图标 */
.creds-table td.actions-cell {
  padding: 0 6px;
}

.creds-table td.actions-cell .actions-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.creds-edit-btn,
.creds-delete-btn {
  color: var(--color-text-3);
}

.creds-edit-btn:hover {
  color: rgb(var(--arcoblue-6));
}

.creds-delete-btn:hover {
  color: rgb(var(--red-6));
}

.creds-alert {
  margin-top: 10px;
}

.creds-empty {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-3);
}
</style>
