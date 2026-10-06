<script setup lang="ts">
/**
 * 已保存端点信息的只读表格：一行一条端点记录，列名即上方端点信息表单的
 * 字段（提供商 / API 格式 / API 端点地址 / 模型名称 / API Key），外加操作列。
 * 「编辑」向父组件回传该行记录（由端点信息表单回填重新编辑，掩码 Key 不回填，
 * 语义为留空沿用）；「删除」经确认后从 artemis.jsonc 移除对应端点信息。
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconDelete, IconEdit } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import type { CredentialEndpointRow } from './contract';
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

const FORMAT_LABEL_KEYS: Record<string, string> = {
  openai: 'formatOpenai',
  openai_responses: 'formatOpenaiResponses',
  anthropic: 'formatAnthropic',
  google: 'formatGoogle',
};

function columnLabel(labelKey: string): string {
  return t(`launcher.diagnostics.cred.${labelKey}`);
}

function displayValue(field: string, value: string | null): string {
  if (!value) return '—';
  if (field === 'api_format') {
    const key = FORMAT_LABEL_KEYS[value];
    if (key) return t(`launcher.diagnostics.cred.${key}`);
  }
  return value;
}

function onEdit(row: CredentialEndpointRow): void {
  emit('edit', { ...row });
}

async function onDelete(): Promise<void> {
  if (isDeleting.value) return;
  isDeleting.value = true;
  error.value = null;
  try {
    await system.deleteEndpointRecord();
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.credsDeleteFail'));
  } finally {
    isDeleting.value = false;
  }
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

    <!-- 已保存端点记录（一行一条，列名 = 表单字段，末列为操作） -->
    <table v-if="rows.length" class="creds-table">
      <thead>
        <tr>
          <th v-for="col in COLUMNS" :key="col.key">{{ columnLabel(col.labelKey) }}</th>
          <th class="actions-col">{{ t('launcher.diagnostics.cred.credsActionsLabel') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="i">
          <td v-for="col in COLUMNS" :key="col.key" :class="{ mono: col.key !== 'provider' }">
            {{ displayValue(col.key, row[col.key]) }}
          </td>
          <td class="actions-cell">
            <a-button
              size="mini"
              type="text"
              class="creds-edit-btn"
              :title="t('launcher.diagnostics.cred.credsEditBtn')"
              @click="onEdit(row)"
            >
              <icon-edit />
            </a-button>
            <a-popconfirm
              :content="t('launcher.diagnostics.cred.credsDeleteConfirm')"
              type="warning"
              @ok="onDelete"
            >
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
  font-size: 12px;
}

.creds-table th,
.creds-table td {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--color-border-2);
}

.creds-table th {
  font-weight: 500;
  color: var(--color-text-2);
  background-color: var(--color-fill-2);
  white-space: nowrap;
}

.creds-table td {
  color: var(--color-text-2);
}

.creds-table td.mono {
  font-family: var(--font-mono, monospace);
}

.actions-col {
  width: 84px;
}

.actions-cell {
  display: flex;
  align-items: center;
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
