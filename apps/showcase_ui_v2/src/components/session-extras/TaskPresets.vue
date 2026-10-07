<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiGet } from '@/services/api';

/**
 * 启动器推荐任务 chips（B6）：
 * 挂载时拉取 `GET /api/tasks/presets?category=recommended&limit=8`（后端
 * task_recommendation_engine.recommend_tasks 返回 TaskPreset.model_dump 数组），
 * 渲染为可点击 chips；点击仅 emit `select`（goal 文本）由父组件填入输入框，
 * 不直接提交。加载失败或空列表时整区静默隐藏。
 * 文案按 preset id 走 i18n 覆盖（zh-CN 有 items 子树），没有覆盖时退回后端字段，
 * 因此目录里新增条目只会显示英文、不会显示空白。
 */
interface PresetItem {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  goal?: unknown;
  tag?: unknown;
}

const emit = defineEmits<{ (e: 'select', goal: string): void }>();
const { t, te, locale } = useI18n();

const presets = ref<PresetItem[]>([]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 当前语言下该条目的覆盖文案；`te` 必须限定在 locale 本身，否则 en-US 会经
 * fallbackLocale 拿到中文，把英文界面变成中英混杂。
 */
function presetOverride(preset: PresetItem, field: 'title' | 'goal'): string {
  const id = asText(preset.id);
  if (!id) return '';
  const key = `launcher.presets.items.${id}.${field}`;
  return te(key, locale.value) ? t(key) : '';
}

function presetLabel(preset: PresetItem): string {
  return (
    presetOverride(preset, 'title') ||
    asText(preset.title) ||
    asText(preset.description) ||
    asText(preset.goal) ||
    asText(preset.id)
  );
}

function onPick(preset: PresetItem): void {
  const goal =
    presetOverride(preset, 'goal') ||
    asText(preset.goal) ||
    asText(preset.description) ||
    asText(preset.title);
  if (goal) {
    emit('select', goal);
  }
}

onMounted(async () => {
  try {
    const res = await apiGet<unknown>('/api/tasks/presets', {
      params: { category: 'recommended', packages: '', limit: 8 },
    });
    if (Array.isArray(res)) {
      presets.value = res.filter(
        (item): item is PresetItem => Boolean(item) && typeof item === 'object',
      );
    }
  } catch {
    // 静默失败：推荐区整体隐藏
  }
});
</script>

<template>
  <a-card v-if="presets.length > 0" class="presets-card" :bordered="true">
    <template #title>{{ t('launcher.presets.title') }}</template>
    <p class="presets-hint">{{ t('launcher.presets.hint') }}</p>
    <div class="presets-chips">
      <a-tag
        v-for="(preset, index) in presets"
        :key="asText(preset.id) || index"
        checkable
        class="preset-chip"
        :title="presetLabel(preset)"
        @check="onPick(preset)"
      >
        {{ presetLabel(preset) }}
      </a-tag>
    </div>
  </a-card>
</template>

<style scoped>
.presets-card {
  margin-bottom: 20px;
}

.presets-hint {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: var(--color-text-3);
}

.presets-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  max-width: 100%;
  cursor: pointer;
}
</style>
