/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Markdown 渲染封装（M2，调研报告 §3.2 Markdown 行）。
 *
 * - 结构化笔记解析（`parseMarkdownSegments` / `parseNoteLines` / `parseNote`）与
 *   Checker JSON 提取（`extractCheckerResult`）从 Angular
 *   `utils/markdown-parser.util.ts` 原样平移：**milestone / verify / assert /
 *   finding 等特殊语义保持一致**，NotesPanel 与 Task Report 卡片按结构化模型渲染。
 * - 流文本的 HTML 渲染（原 `renderMarkdownToHtml` 手写 parser）改用
 *   markdown-it + DOMPurify 安全渲染；迁移验收语义保留：
 *   1. agent 内部 XML 标签（`<thought>` 等）先剥离；
 *   2. `- verify:` / `- assert@end:` / `- finding:` 列表项渲染出徽标；
 *   3. 原始 HTML 一律转义/过滤（html:false + DOMPurify 双保险）。
 */

import MarkdownIt from 'markdown-it';
import type { StateCore } from 'markdown-it';
import DOMPurify from 'dompurify';

import type {
  MarkdownSegment,
  MarkdownLine,
  NoteMilestone,
  ParsedNote,
} from '@/types/markdown.model';
import type { CheckerResult } from '@/types/stream.model';

/**
 * Split text into bold, code, and plain segments
 */
export function parseMarkdownSegments(text: string): MarkdownSegment[] {
  if (!text) return [];
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts
    .filter(part => part !== '')
    .map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return {
          text: part.slice(2, -2),
          bold: true,
          code: false
        };
      } else if (part.startsWith('`') && part.endsWith('`')) {
        return {
          text: part.slice(1, -1),
          bold: false,
          code: true
        };
      } else {
        return {
          text: part,
          bold: false,
          code: false
        };
      }
    });
}

/**
 * Parse markdown note content into structured lines (checklists, headers, list items)
 */
export function parseNoteLines(content: string): MarkdownLine[] {
  if (!content) return [];
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    // Checkbox [x]
    if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
      const rawText = trimmed.substring(6);
      return { type: 'checked' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    // Active checkbox [/]
    if (trimmed.startsWith('- [/] ')) {
      const rawText = trimmed.substring(6);
      return { type: 'progress' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    // Unchecked checkbox [ ]
    if (trimmed.startsWith('- [ ] ')) {
      const rawText = trimmed.substring(6);
      return { type: 'unchecked' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    // Check lines (- verify: / - assert: / - verify@end: / - assert@end:)
    const checkMatch = trimmed.match(/^[-*]\s*(verify|assert)(@end)?\s*:\s*(.*)$/i);
    if (checkMatch) {
      const kind = checkMatch[1].toLowerCase() as 'verify' | 'assert';
      const atEnd = Boolean(checkMatch[2]);
      const rawText = checkMatch[3].trim();
      return {
        type: 'verify' as const,
        checkKind: kind,
        atEnd,
        segments: parseMarkdownSegments(rawText),
        indent
      };
    }
    // System findings (- finding:)
    const findingMatch = trimmed.match(/^[-*]\s*finding\s*:\s*(.*)$/i);
    if (findingMatch) {
      const rawText = findingMatch[1].trim();
      return {
        type: 'finding' as const,
        checkKind: 'finding',
        segments: parseMarkdownSegments(rawText),
        indent
      };
    }
    // Regular list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const rawText = trimmed.substring(2);
      return { type: 'list-item' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    // Headers
    if (trimmed.startsWith('# ')) {
      const rawText = trimmed.substring(2);
      return { type: 'h1' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    if (trimmed.startsWith('## ')) {
      const rawText = trimmed.substring(3);
      return { type: 'h2' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    if (trimmed.startsWith('### ')) {
      const rawText = trimmed.substring(4);
      return { type: 'h3' as const, segments: parseMarkdownSegments(rawText), indent };
    }
    // Default line
    return trimmed
      ? { type: 'text' as const, segments: parseMarkdownSegments(line), indent }
      : { type: 'empty' as const, segments: [], indent: 0 };
  });
}

/**
 * Group parsed markdown lines into title, milestones (checklists), and other lines
 */
export function parseNote(content: string): ParsedNote {
  const lines = parseNoteLines(content);
  const milestones: NoteMilestone[] = [];
  const otherLines: MarkdownLine[] = [];
  let title: string | null = null;
  let currentMilestone: (NoteMilestone & { _indent?: number }) | null = null;
  let milestoneCount = 0;

  for (const line of lines) {
    if (line.type === 'empty') {
      continue;
    }

    if ((line.type === 'h1' || line.type === 'h2') && !title) {
      title = line.segments.map(s => s.text).join('');
      continue;
    }

    const isChecklistItem = ['checked', 'progress', 'unchecked'].includes(line.type);

    if (isChecklistItem && (!currentMilestone || line.indent <= (currentMilestone._indent ?? 0))) {
      milestoneCount++;
      currentMilestone = {
        index: milestoneCount,
        type: line.type as 'checked' | 'progress' | 'unchecked',
        segments: line.segments,
        subSteps: [],
        checks: [],
        _indent: line.indent
      };
      milestones.push(currentMilestone);
    } else if (currentMilestone) {
      if (line.indent > (currentMilestone._indent ?? 0)) {
        if (line.type === 'verify' || line.type === 'assert' || line.type === 'finding') {
          currentMilestone.checks.push(line);
        } else {
          currentMilestone.subSteps.push(line);
        }
      } else {
        otherLines.push(line);
      }
    } else {
      otherLines.push(line);
    }
  }

  return {
    title,
    milestones,
    otherLines
  };
}

/**
 * Parse the Checker JSON response block
 */
export function extractCheckerResult(text: string): CheckerResult | null {
  if (!text) return null;
  let cleanText = text.trim();
  if (cleanText.includes('```json')) {
    const parts = cleanText.split('```json');
    if (parts.length > 1) {
      cleanText = parts[1].split('```')[0].trim();
    }
  } else if (cleanText.includes('```')) {
    const parts = cleanText.split('```');
    if (parts.length > 1) {
      cleanText = parts[1].split('```')[0].trim();
    }
  }

  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return {
        success: Boolean(parsed.success),
        reason: parsed.reason || 'No reason provided.'
      };
    }
  } catch {
    // Ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// markdown-it + DOMPurify 安全渲染（替代 Angular 手写 renderMarkdownToHtml）
// ---------------------------------------------------------------------------

/** agent 内部 XML 标签（不面向用户展示），渲染前剥离（语义平移自 Angular 版）。 */
const AGENT_TAG_RE =
  /<\/?(thought|short_term_memory|strong_term_memory|reasoning|plan|task_plan|call_tool)[^\n>]*>?/gi;

/** `- verify: xxx` / `- assert@end: xxx`（语义平移自 Angular 版的 li 检测）。 */
const CHECK_LINE_RE = /^(verify|assert)(@end)?\s*:\s*/i;
/** `- finding: xxx` */
const FINDING_LINE_RE = /^finding\s*:\s*/i;

const md = new MarkdownIt({
  // 原始 HTML 一律不透传：Angular 版先转义再处理，这里同样关闭 html，
  // 之后 DOMPurify 再做一次白名单过滤（双保险）。
  html: false,
  linkify: false,
  breaks: true,
});

interface CheckBadge {
  label: string;
  assert: boolean;
}

/** 识别检查行徽标；返回 null 表示普通文本。 */
function matchCheckBadge(content: string): CheckBadge | null {
  const check = content.match(CHECK_LINE_RE);
  if (check) {
    return { label: `${check[1].toLowerCase()}${check[2] ? '@end' : ''}`, assert: check[1].toLowerCase() === 'assert' };
  }
  const finding = content.match(FINDING_LINE_RE);
  if (finding) {
    return { label: 'finding', assert: false };
  }
  return null;
}

/**
 * core 规则：给 `verify:` / `assert@end:` / `finding:` 列表项注入徽标
 * （与 Angular 版 `md-verify-item` / `verify-badge` 语义一致）。
 */
function injectCheckBadges(state: StateCore): void {
  const Token = state.Token;
  for (let i = 0; i < state.tokens.length; i++) {
    if (state.tokens[i].type !== 'list_item_open') continue;
    // 列表项结构：list_item_open → paragraph_open → inline → paragraph_close → list_item_close
    const paragraphOpen = state.tokens[i + 1];
    const inline = state.tokens[i + 2];
    if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') continue;
    if (!inline || inline.type !== 'inline' || !inline.children) continue;

    const badge = matchCheckBadge(inline.content);
    if (!badge) continue;

    // 去掉首段文本里的前缀，并在最前面塞入 html_inline 徽标 token
    const firstText = inline.children.find((t) => t.type === 'text' && t.content);
    if (firstText) {
      firstText.content = firstText.content.replace(CHECK_LINE_RE, '').replace(FINDING_LINE_RE, '');
    }
    const badgeToken = new Token('html_inline', '', 0);
    badgeToken.content = `<span class="md-verify-badge${badge.assert ? ' assert' : ''}">${badge.label}</span>`;
    inline.children.unshift(badgeToken);
  }
}

md.core.ruler.push('artemis_check_badges', injectCheckBadges);

/**
 * Convert markdown text to safe HTML for agent logs/thinking（M2 起由
 * markdown-it + DOMPurify 承担；调用方必须以 `v-html` 之外的方式保证容器样式）。
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const cleaned = text.replace(AGENT_TAG_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) return '';
  const html = md.render(cleaned);
  // markdown-it(html:false) 已转义原始 HTML，这里再做白名单过滤：
  // 放行徽标/排版所需的结构与 class 属性，脚本等一律剔除。
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] });
}
