<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useTimelineStore } from '@/stores/timeline';
import { parseNote } from '@/utils/markdown';
import type { ParsedNote } from '@/types/markdown.model';
import NoteDocument from './NoteDocument.vue';

/**
 * 笔记与计划面板（对应 Angular notes 下拉，按映射表用 a-tabs 重做）：
 * 一个 note 文件一个 tab（.md 键），内容走结构化 markdown 解析
 * （milestone / verify / finding 语义保留，见 utils/markdown.ts）。
 */
const { t } = useI18n();
const timelineStore = useTimelineStore();

/** 只展示 .md 笔记（平移自 noteKeys computed）。 */
const noteKeys = computed<string[]>(() =>
  Object.keys(timelineStore.currentNotes).filter((key) => key.toLowerCase().endsWith('.md')),
);

const parsedNote = computed<ParsedNote>(() => parseNote(timelineStore.currentNotes[timelineStore.selectedNoteKey] || ''));
</script>

<template>
  <section class="notes-panel">
    <a-empty
      v-if="noteKeys.length === 0"
      :description="t('workspace.timeline.noNotes')"
      class="notes-empty"
    />
    <a-tabs
      v-else
      :active-key="timelineStore.selectedNoteKey"
      size="small"
      class="notes-tabs"
      @change="timelineStore.selectNoteKey($event as string)"
    >
      <a-tab-pane v-for="key in noteKeys" :key="key" :title="key">
        <div class="notes-content">
          <NoteDocument :parsed="parsedNote" />
        </div>
      </a-tab-pane>
    </a-tabs>
  </section>
</template>

<style scoped>
.notes-panel {
  min-height: 120px;
}

.notes-empty {
  padding: 24px 0;
}

.notes-tabs :deep(.arco-tabs-content) {
  padding-top: 8px;
}

.notes-content {
  max-height: 420px;
  overflow-y: auto;
  padding: 2px;
}
</style>
