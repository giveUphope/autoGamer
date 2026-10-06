import { describe, expect, it } from 'vitest';

import {
  extractCheckerResult,
  parseMarkdownSegments,
  parseNote,
  parseNoteLines,
  renderMarkdown,
} from './markdown';

/**
 * 平移自 Angular `markdown-parser.util.spec.ts` 的关键断言（milestone 语义），
 * 并补 markdown-it + DOMPurify 封装的安全渲染用例。
 */
describe('markdown util verification & check lines（平移自 markdown-parser.util.spec）', () => {
  it('should parse - verify: line as type verify with checkKind verify', () => {
    const markdown = `- [x] Parent task
  - [x] Subtask 1
  - verify: Commute duration is recorded in note \`eta_details\``;

    const lines = parseNoteLines(markdown);
    expect(lines.length).toBe(3);
    expect(lines[0].type).toBe('checked');
    expect(lines[1].type).toBe('checked');

    const verifyLine = lines[2];
    expect(verifyLine.type).toBe('verify');
    expect(verifyLine.checkKind).toBe('verify');
    expect(verifyLine.atEnd).toBe(false);
    expect(verifyLine.segments.map((s) => s.text).join('')).toBe(
      'Commute duration is recorded in note eta_details',
    );
    expect(verifyLine.segments.find((s) => s.code)?.text).toBe('eta_details');
  });

  it('should parse - assert: and - assert@end: lines', () => {
    const markdown = `- [ ] Open app
  - assert: the welcome screen shows up
- assert@end: final status is completed`;

    const lines = parseNoteLines(markdown);
    expect(lines.length).toBe(3);

    expect(lines[1].type).toBe('verify');
    expect(lines[1].checkKind).toBe('assert');
    expect(lines[1].atEnd).toBe(false);

    expect(lines[2].type).toBe('verify');
    expect(lines[2].checkKind).toBe('assert');
    expect(lines[2].atEnd).toBe(true);
  });

  it('should parse - finding: lines', () => {
    const markdown = `- [x] Step 1
  - finding: Unresolved verify failure`;

    const lines = parseNoteLines(markdown);
    expect(lines[1].type).toBe('finding');
    expect(lines[1].checkKind).toBe('finding');
    expect(lines[1].segments[0].text).toBe('Unresolved verify failure');
  });

  it('should group verify lines under parent milestone checks in parseNote', () => {
    const note = `- [x] Open Maps
  - [x] Search destination
  - verify: Arrival time is visible in note \`eta\``;

    const parsed = parseNote(note);
    expect(parsed.milestones.length).toBe(1);
    expect(parsed.milestones[0].subSteps.length).toBe(1);
    expect(parsed.milestones[0].subSteps[0].type).toBe('checked');
    expect(parsed.milestones[0].checks.length).toBe(1);
    expect(parsed.milestones[0].checks[0].type).toBe('verify');
    expect(parsed.milestones[0].checks[0].checkKind).toBe('verify');
  });

  it('parseMarkdownSegments splits bold and code', () => {
    expect(parseMarkdownSegments('plain **bold** and `code`')).toEqual([
      { text: 'plain ', bold: false, code: false },
      { text: 'bold', bold: true, code: false },
      { text: ' and ', bold: false, code: false },
      { text: 'code', bold: false, code: true },
    ]);
  });

  it('extractCheckerResult parses the json fence block', () => {
    expect(extractCheckerResult('```json\n{"success": true, "reason": "all good"}\n```')).toEqual({
      success: true,
      reason: 'all good',
    });
    expect(extractCheckerResult('{"success": false}')).toEqual({
      success: false,
      reason: 'No reason provided.',
    });
    expect(extractCheckerResult('not json')).toBeNull();
  });
});

describe('renderMarkdown（markdown-it + DOMPurify 封装）', () => {
  it('renders verify badges（语义平移：Angular 版 renderMarkdownToHtml 徽标）', () => {
    const html = renderMarkdown('- verify: status is ok');
    expect(html).toContain('md-verify-badge');
    expect(html).toContain('>verify<');
    expect(html).toContain('status is ok');
  });

  it('renders assert@end and finding badges', () => {
    const html = renderMarkdown(['- assert@end: final status is completed', '- finding: unresolved'].join('\n'));
    expect(html).toContain('>assert@end<');
    expect(html).toContain('>finding<');
  });

  it('strips agent internal XML tags', () => {
    const html = renderMarkdown('<thought>hidden reasoning</thought>visible text');
    expect(html).not.toContain('<thought');
    expect(html).toContain('visible text');
  });

  it('renders bold, code and code blocks', () => {
    const html = renderMarkdown('**bold** and `inline` plus:\n\n```json\n{"a":1}\n```');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<pre');
    expect(html).toContain('{"a":1}');
  });

  it('never lets raw HTML through（XSS 防护，等价 Angular 版先转义语义）', () => {
    const html = renderMarkdown('<script>window.alert(1)</script> and <img src=x onerror=alert(1)>tail');
    // html:false 下原始 HTML 被转义为可见文本（与 Angular 版转义语义一致），
    // DOMPurify 再做白名单兜底：不存在任何未转义的标签或事件属性。
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('tail');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('<thought></thought>')).toBe('');
  });
});
