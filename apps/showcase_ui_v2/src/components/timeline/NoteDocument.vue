<script setup lang="ts">
import { IconCheckCircle, IconMinusCircle } from '@arco-design/web-vue/es/icon';

import type { MarkdownLine, ParsedNote } from '@/types/markdown.model';

/**
 * 结构化笔记渲染（对应 Angular notes 下拉 / Task Report 卡片的 parsedNote 渲染）：
 * 标题、milestone（勾选状态图标 + 子步骤 + verify/assert/finding 校验卡）与其余行。
 * 语义平移自 agent-stream.component.html 的 notes 分支，视觉按 Arco token 重做。
 */

const props = defineProps<{ parsed: ParsedNote }>();

/** milestone / 勾选行的状态图标语义（与 Angular 的 checkbox 图标一一对应）。 */
function lineIcon(type: MarkdownLine['type']): 'checked' | 'progress' | 'unchecked' | null {
  if (type === 'checked' || type === 'progress' || type === 'unchecked') return type;
  return null;
}

function indentPx(indent: number): string {
  return `${Math.max(0, indent - 2) * 12}px`;
}



</script>

<template>
  <div class="note-document">
    <h3 v-if="parsed.title" class="note-title">{{ parsed.title }}</h3>

    <div v-if="parsed.milestones.length > 0" class="milestones">
      <div
        v-for="milestone in parsed.milestones"
        :key="milestone.index"
        class="milestone-block"
        :class="milestone.type"
      >
        <div class="milestone-title-row">
          <span class="milestone-icon" :class="milestone.type">
            <icon-check-circle v-if="milestone.type === 'checked'" />
            <icon-minus-circle v-else-if="milestone.type === 'progress'" />
            <span v-else class="hollow-circle" />
          </span>
          <span class="milestone-text">
            <template v-for="(seg, i) in milestone.segments" :key="i">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <code v-else-if="seg.code">{{ seg.text }}</code>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
        </div>

        <div v-if="milestone.subSteps.length > 0" class="milestone-substeps">
          <div
            v-for="(step, i) in milestone.subSteps"
            :key="i"
            class="substep-row"
            :class="step.type"
            :style="{ paddingLeft: indentPx(step.indent) }"
          >
            <span v-if="lineIcon(step.type)" class="line-icon" :class="step.type">
              <icon-check-circle v-if="step.type === 'checked'" />
              <icon-minus-circle v-else-if="step.type === 'progress'" />
              <span v-else class="hollow-circle" />
            </span>
            <span v-else-if="step.type === 'list-item'" class="bullet">•</span>
            <span v-if="step.type !== 'empty'" class="line-text">
              <template v-for="(seg, j) in step.segments" :key="j">
                <strong v-if="seg.bold">{{ seg.text }}</strong>
                <code v-else-if="seg.code">{{ seg.text }}</code>
                <span v-else>{{ seg.text }}</span>
              </template>
            </span>
          </div>
        </div>

        <div v-if="milestone.checks.length > 0" class="milestone-checks">
          <div
            v-for="(check, i) in milestone.checks"
            :key="i"
            class="verification-card"
            :class="check.type"
            :style="{ marginLeft: indentPx(check.indent) }"
          >
            <span class="card-tag" :class="{ assert: check.checkKind === 'assert' }">
              {{ check.checkKind || 'verify' }}{{ check.atEnd ? ' @end' : '' }}
            </span>
            <span class="card-body">
              <template v-for="(seg, j) in check.segments" :key="j">
                <strong v-if="seg.bold">{{ seg.text }}</strong>
                <code v-else-if="seg.code">{{ seg.text }}</code>
                <span v-else>{{ seg.text }}</span>
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="parsed.otherLines.length > 0" class="other-lines">
      <template v-for="(line, i) in parsed.otherLines" :key="i">
        <div
          v-if="line.type === 'verify' || line.type === 'finding'"
          class="verification-card standalone"
          :class="line.type"
          :style="{ marginLeft: `${line.indent * 12}px` }"
        >
          <span class="card-tag" :class="{ assert: line.checkKind === 'assert' }">
            {{ line.checkKind || 'verify' }}{{ line.atEnd ? ' @end' : '' }}
          </span>
          <span class="card-body">
            <template v-for="(seg, j) in line.segments" :key="j">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <code v-else-if="seg.code">{{ seg.text }}</code>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
        </div>
        <div
          v-else
          class="md-line"
          :class="line.type"
          :style="{ marginLeft: `${line.indent * 12}px` }"
        >
          <span v-if="lineIcon(line.type)" class="line-icon" :class="line.type">
            <icon-check-circle v-if="line.type === 'checked'" />
            <icon-minus-circle v-else-if="line.type === 'progress'" />
            <span v-else class="hollow-circle" />
          </span>
          <span v-else-if="line.type === 'list-item'" class="bullet">•</span>
          <span v-if="line.type !== 'empty'" class="line-text">
            <template v-for="(seg, j) in line.segments" :key="j">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <code v-else-if="seg.code">{{ seg.text }}</code>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.note-document {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-1);
}

.note-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.milestones,
.milestone-substeps,
.milestone-checks,
.other-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.milestone-block {
  padding: 8px 10px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-fill-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.milestone-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.milestone-icon {
  flex-shrink: 0;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  margin-top: 2px;
}

.milestone-icon.checked {
  color: rgb(var(--green-6));
}

.milestone-icon.progress {
  color: rgb(var(--orange-6));
}

.milestone-icon.unchecked {
  color: var(--color-text-4);
}

.hollow-circle {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}

.milestone-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.substep-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-text-2);
}

.line-icon {
  flex-shrink: 0;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  margin-top: 2px;
}

.line-icon.checked {
  color: rgb(var(--green-6));
}

.line-icon.progress {
  color: rgb(var(--orange-6));
}

.line-icon.unchecked {
  color: var(--color-text-4);
}

.bullet {
  color: var(--color-text-4);
}

.line-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.verification-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgb(var(--arcoblue-6) / 35%);
  border-left-width: 3px;
  border-radius: var(--border-radius-small);
  background-color: rgb(var(--arcoblue-1) / 40%);
}

.verification-card .card-tag {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  font-size: 11px;
  font-family: monospace;
  color: rgb(var(--arcoblue-6));
  background-color: rgb(var(--arcoblue-6) / 12%);
}

.verification-card .card-tag.assert {
  color: rgb(var(--purple-6));
  background-color: rgb(var(--purple-6) / 12%);
}

.verification-card .card-body {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--color-text-2);
}

code {
  padding: 0 4px;
  border-radius: 4px;
  background-color: var(--color-fill-3);
  font-size: 12px;
}
</style>
