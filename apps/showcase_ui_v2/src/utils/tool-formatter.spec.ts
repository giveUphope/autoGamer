import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '@/locales';
import {
  cleanErrorMessage,
  getCompressionLabel,
  getCompressionPhaseLabel,
  getToolAgentName,
  getToolDisplayLabel,
  getToolErrorMessage,
  getToolInputLabel,
  getToolInputText,
  getToolTitle,
  getVideoAnalysisView,
} from './tool-formatter';

/**
 * util 层语义文案 i18n（M7 收尾）。en-US 断言逐字节锁定迁移前的硬编码英文输出
 *（验收线：en-US 输出与迁移前一致）；zh-CN 抽样核对 tools.* 中文键值。
 */
function tool(name: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { name, payload: { args }, ...extra };
}

describe('tool-formatter display copy (en-US)', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en-US';
  });

  it('keeps the legacy English tool display labels', () => {
    expect(getToolDisplayLabel(tool('launch_app', { app_name: 'settings', action: 'launch' }))).toBe('Launching "Settings"');
    expect(getToolDisplayLabel(tool('manage_app', { app: 'camera', action: 'stop' }))).toBe('Stopping "Camera"');
    expect(getToolDisplayLabel(tool('manage_app', { app_name: 'notes' }))).toBe('Managing "Notes"');
    expect(getToolDisplayLabel(tool('launch_app', { action: 'launch' }))).toBe('Launching "Application"');

    expect(getToolDisplayLabel(tool('wait_for_delay', { delay_seconds: 1 }))).toBe('Waiting for 1 second...');
    expect(getToolDisplayLabel(tool('wait', { delay: 2 }))).toBe('Waiting for 2 seconds...');
    expect(getToolDisplayLabel(tool('wait_for_delay'))).toBe('Waiting for delay...');
    expect(getToolDisplayLabel(tool('wait_for_text', { text: 'OK' }))).toBe('Waiting for text "OK" to appear on screen');
    expect(getToolDisplayLabel(tool('wait_for_text'))).toBe('Waiting for text on screen');

    expect(getToolDisplayLabel(tool('input_text', { text: 'hi' }))).toBe('Entering text "hi" into field');
    expect(getToolDisplayLabel(tool('input'))).toBe('Entering text into input field');
    expect(getToolDisplayLabel(tool('focus_and_input_text', { text: 'hi' }))).toBe('Focusing field and typing "hi"');
    expect(getToolDisplayLabel(tool('focus_and_input_text'))).toBe('Focusing field and entering text');
    expect(getToolDisplayLabel(tool('focus_and_clear_text'))).toBe('Focusing and clearing field text');

    expect(getToolDisplayLabel(tool('click', { target_text: 'Settings' }))).toBe('Tapping on "Settings"');
    expect(getToolDisplayLabel(tool('tap'))).toBe('Tapping on screen element');
    expect(getToolDisplayLabel(tool('click_sequence'))).toBe('Executing click sequence');
    expect(getToolDisplayLabel(tool('long_press', { text: 'OK' }))).toBe('Long pressing on "OK"');
    expect(getToolDisplayLabel(tool('long_press'))).toBe('Long pressing screen element');
    expect(getToolDisplayLabel(tool('swipe', { direction: 'up' }))).toBe('Swiping UP on screen');
    expect(getToolDisplayLabel(tool('swipe'))).toBe('Swiping screen');
    expect(getToolDisplayLabel(tool('press_key', { key: 'enter' }))).toBe('Pressing key ENTER');
    expect(getToolDisplayLabel(tool('press_key'))).toBe('Pressing hardware key');

    expect(getToolDisplayLabel(tool('save_note'), true)).toBe('Creating note');
    expect(getToolDisplayLabel(tool('save_note'), false)).toBe('Saving note');
    expect(getToolDisplayLabel(tool('read_note'))).toBe('Reading note');
    expect(getToolDisplayLabel(tool('list_notes'))).toBe('Browsing all saved notes');
    expect(getToolDisplayLabel(tool('update_note'))).toBe('Updating note');
    expect(getToolDisplayLabel(tool('append_note'))).toBe('Updating note');

    expect(getToolDisplayLabel(tool('object_detection', { queries: ['a', 'b'] }))).toBe('Locating on screen: "a, b"');
    expect(getToolDisplayLabel(tool('object_detection'))).toBe('Locating elements on screen');
    expect(getToolDisplayLabel(tool('ask_explorer', { query: 'battery' }))).toBe('Searching on screen: "battery"');
    expect(getToolDisplayLabel(tool('ask_explorer'))).toBe('Searching on screen');
    expect(getToolDisplayLabel(tool('report_failure_analysis', { reason: 'timeout' }))).toBe('Investigating issue: timeout');
    expect(getToolDisplayLabel(tool('report_failure_analysis'))).toBe('Investigating execution issue');
    expect(getToolDisplayLabel(tool('run_adb_command', { command: 'ls -la' }))).toBe('Running command: ls -la');
    expect(getToolDisplayLabel(tool('run_short_adb_command'))).toBe('Running system command');
    expect(getToolDisplayLabel(tool('search_logs', { query: 'err' }))).toBe('Searching logs for "err"');
    expect(getToolDisplayLabel(tool('read_logs'))).toBe('Analyzing system logs');
    expect(getToolDisplayLabel(tool('log_analyzer'))).toBe('Analyzing logs');
    expect(getToolDisplayLabel(tool('diagnoser'))).toBe('Diagnosing issue');
    expect(getToolDisplayLabel(tool('video_analyzer'))).toBe('Analyzing screen recording');
    expect(getToolDisplayLabel(tool('extract_segment_metadata', { start_time: 12, end_time: 30 }))).toBe('Cropping screen recording segment (12s - 30s)');
    expect(getToolDisplayLabel(tool('extract_segment_metadata', { start_time: 12 }))).toBe('Cropping screen recording segment (from 12s)');
    expect(getToolDisplayLabel(tool('extract_segment_metadata'))).toBe('Cropping screen recording segment');
    expect(getToolDisplayLabel(tool('spawn_sub_agent', { query: 'find x' }))).toBe('Analyzing recording with sub-agent: "find x"');
    expect(getToolDisplayLabel(tool('spawn_sub_agent'))).toBe('Analyzing recording with sub-agent');
    expect(getToolDisplayLabel(tool('analyze_audio_only', { query: 'speech' }))).toBe('Analyzing audio track: "speech"');
    expect(getToolDisplayLabel(tool('analyze_audio_only'))).toBe('Analyzing recording audio track');
    expect(getToolDisplayLabel(tool('search_history', { query: 'clock', step_range: [2, 5] }))).toBe('Searching execution history for "clock" in steps 2–5');
    expect(getToolDisplayLabel(tool('search_history', { step_range: [2, 5] }))).toBe('Searching execution history in steps 2–5');
    expect(getToolDisplayLabel(tool('search_history', { query: 'clock' }))).toBe('Searching execution history for "clock"');
    expect(getToolDisplayLabel(tool('replay_steps', { start_step: 2, end_step: 5 }))).toBe('Reviewing steps 2–5');
    expect(getToolDisplayLabel(tool('replay_steps', { start_step: 3 }))).toBe('Reviewing step 3');
    expect(getToolDisplayLabel(tool('replay_steps'))).toBe('Reviewing step details');
    expect(getToolDisplayLabel(tool('get_step_screenshot', { step_number: 4, which: 'overlay' }))).toBe("Looking at where step 4's action landed");
    expect(getToolDisplayLabel(tool('get_step_screenshot', { which: 'overlay' }))).toBe('Looking at where an action landed');
    expect(getToolDisplayLabel(tool('get_step_screenshot', { step_number: 4, which: 'post' }))).toBe('Looking at the screen after step 4');
    expect(getToolDisplayLabel(tool('get_step_screenshot', { step_number: 4, which: 'pre' }))).toBe('Looking at the screen before step 4');
    expect(getToolDisplayLabel(tool('get_step_screenshot'))).toBe('Looking at a step screenshot');
    expect(getToolDisplayLabel(tool('probe_device', { kind: 'battery_level' }))).toBe('Reading battery level from the device');
    expect(getToolDisplayLabel(tool('probe_device'))).toBe('Reading device state');
    expect(getToolDisplayLabel(tool('outputter'))).toBe('Synthesizing output report');
    expect(getToolDisplayLabel(tool('web_search', { query: 'weather' }))).toBe('Searching web for "weather"');
    expect(getToolDisplayLabel(tool('web_search'))).toBe('Searching the web');
    expect(getToolDisplayLabel(tool('read_url'))).toBe('Fetching web page');
    expect(getToolDisplayLabel(tool('foo_bar'))).toBe('Executing Foo Bar');
  });

  it('keeps the legacy English tool titles', () => {
    expect(getToolTitle(null)).toBe('Tool Call');
    expect(getToolTitle(tool('click'))).toBe('Tapping Element');
    expect(getToolTitle(tool('click_sequence'))).toBe('Executing Click Sequence');
    expect(getToolTitle(tool('long_press'))).toBe('Long Pressing Element');
    expect(getToolTitle(tool('input_text'))).toBe('Entering Text');
    expect(getToolTitle(tool('swipe', { direction: 'up' }))).toBe('Swiping Screen (UP)');
    expect(getToolTitle(tool('scroll'))).toBe('Swiping Screen');
    expect(getToolTitle(tool('drag'))).toBe('Dragging Screen');
    expect(getToolTitle(tool('press_key'))).toBe('Pressing Hardware Key');
    expect(getToolTitle(tool('launch_app', { action: 'launch' }))).toBe('Launching Application');
    expect(getToolTitle(tool('launch_app', { action: 'stop' }))).toBe('Stopping Application');
    expect(getToolTitle(tool('manage_app', { action: 'whatever' }))).toBe('Managing Application');
    expect(getToolTitle(tool('wait_for_delay'))).toBe('Waiting for Delay');
    expect(getToolTitle(tool('wait_for_text'))).toBe('Waiting for Text');
    expect(getToolTitle(tool('object_detection'))).toBe('Locating Elements');
    expect(getToolTitle(tool('ask_explorer'))).toBe('Searching on Screen');
    expect(getToolTitle(tool('report_failure_analysis'))).toBe('Investigating Issue');
    expect(getToolTitle(tool('run_adb_command'))).toBe('Running System Command');
    expect(getToolTitle(tool('web_search'))).toBe('Web Search');
    expect(getToolTitle(tool('read_url'))).toBe('Fetching Web Page');
    expect(getToolTitle(tool('search_logs'))).toBe('Searching Logs');
    expect(getToolTitle(tool('log_analyzer'))).toBe('Analyzing Logs');
    expect(getToolTitle(tool('diagnose'))).toBe('Diagnosing Issue');
    expect(getToolTitle(tool('video_analyzer'))).toBe('Analyzing Screen Recording');
    expect(getToolTitle(tool('extract_segment_metadata'))).toBe('Cropping Screen Recording');
    expect(getToolTitle(tool('spawn_sub_agent'))).toBe('Delegating Video Analysis');
    expect(getToolTitle(tool('analyze_audio_only'))).toBe('Analyzing Audio Track');
    expect(getToolTitle(tool('foo_bar'))).toBe('Foo Bar');
  });

  it('keeps the legacy English video analysis titles and waiting summary', () => {
    expect(getVideoAnalysisView({ name: 'video_analysis', status: 'running' })?.title).toBe('Analyzing screen recording');
    expect(getVideoAnalysisView({ name: 'video_analyzer', status: 'running', payload: { result: { outcome: 'running', fallback_used: true } } })?.title)
      .toBe('Analyzing unfinished recording segment');

    const waiting = getVideoAnalysisView({ name: 'video_analysis', status: 'running', payload: { result: 'Analysis is already in progress in another video agent' } });
    expect(waiting?.title).toBe('Waiting for existing video analysis');
    expect(waiting?.summary).toBe('Another video agent is already analyzing this evidence.');

    expect(getVideoAnalysisView({ name: 'video_analysis', status: 'failed', payload: { result: 'All sub-agent chunks failed' } })?.title)
      .toBe('Video analysis returned no result');
    expect(getVideoAnalysisView({ name: 'video_analysis', status: 'success', payload: { result: 'PARTIAL VIDEO ANALYSIS chunk 2' } })?.title)
      .toBe('Video analysis partially completed');
    const reused = getVideoAnalysisView({ name: 'video_analysis', status: 'success', payload: { result: 'CACHED VIDEO ANALYSIS: good summary' } });
    expect(reused?.title).toBe('Reused video analysis');
    expect(reused?.summary).toBe('good summary');
    expect(getVideoAnalysisView({ name: 'video_analysis', status: 'success', payload: { result: 'looks fine' } })?.title)
      .toBe('Analyzed screen recording');
  });

  it('keeps the legacy English agent role labels', () => {
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'outputter_agent' })).toBe('Outputter');
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'validator' })).toBe('Validator');
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'diagnoser' })).toBe('Diagnoser');
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'explorer' })).toBe('Explorer');
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'failure_analyzer' })).toBeNull();
  });

  it('keeps the legacy English compression labels', () => {
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5 }, { status: 'failed' })))
      .toBe("Couldn't condense steps 2–5 yet; keeping the full record and retrying later");
    expect(getCompressionLabel(tool('compress_history', { start_step: 3, end_step: 3 }, { status: 'failed' })))
      .toBe("Couldn't condense step 3 yet; keeping the full record and retrying later");
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5, note: 'retrying' }, { status: 'running' })))
      .toBe('Retrying the memory summary for steps 2–5…');
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5, note: 'held', swap_at_tokens: 1000, context_tokens: 500 }, { status: 'running' })))
      .toBe('Short memory for steps 2–5 is ready; keeping the full record until working memory fills up · ≈ 500 of 1k tokens');
    expect(getCompressionLabel(tool('compress_history', {}, { status: 'running' })))
      .toBe('Condensing earlier steps into a short memory to free up room…');
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5, forced: true }, { status: 'success' })))
      .toBe('Steps 2–5 condensed into a recap to free up memory');
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5, source_tokens: 4000, summary_tokens: 1000, context_tokens: 500000, context_budget: 1000000 }, { status: 'success' })))
      .toBe('Steps 2–5 condensed into a short memory · 4k → 1k tokens (4× smaller) · working memory ≈ 500k of 1000k tokens');
    expect(getCompressionLabel(tool('compress_history', { context_tokens: 500000 }, { status: 'success' })))
      .toBe('Earlier steps condensed into a short memory · working memory ≈ 500k tokens');

    expect(getCompressionPhaseLabel(tool('compress_history', { phase: 'ready' }))).toBe('Summary ready; kept in reserve until the context fills up');
    expect(getCompressionPhaseLabel(tool('compress_history', { phase: 'applied' }))).toBe('Replaced this stretch with its summary');
    expect(getCompressionPhaseLabel(tool('compress_history', { phase: 'failed' }))).toBe('Summary failed; full record kept');
    expect(getCompressionPhaseLabel(tool('compress_history'))).toBe('Summarizing this stretch');
  });

  it('keeps the legacy English input labels, values and error fallbacks', () => {
    expect(getToolInputLabel(null)).toBe('Input');
    expect(getToolInputLabel(tool('wait_for_delay'))).toBe('Duration');
    expect(getToolInputLabel(tool('swipe', { direction: 'up' }))).toBe('Direction');
    expect(getToolInputLabel(tool('swipe', { action: 'pinch zoom' }))).toBe('Input');
    expect(getToolInputLabel(tool('press_key'))).toBe('Key');
    expect(getToolInputLabel(tool('input_text'))).toBe('Input Text');
    expect(getToolInputLabel(tool('foo_bar'))).toBe('Input');

    expect(getToolInputText(tool('long_press', { duration: 500 }))).toBe('Duration: 500ms');

    expect(getToolErrorMessage(null)).toBe('Tool Failed');
    expect(getToolErrorMessage(tool('click', { status: 'cannot_fix' }))).toBe('Status: cannot_fix');
    expect(getToolErrorMessage(tool('click'))).toBe('Action Failed');

    expect(cleanErrorMessage('')).toBe('Unknown error');
    expect(cleanErrorMessage('   ')).toBe('Unknown error');
  });
});

describe('tool-formatter display copy (zh-CN spot checks)', () => {
  it('renders the Chinese tools.* copy', () => {
    i18n.global.locale.value = 'zh-CN';
    expect(getToolTitle({ name: 'click' })).toBe('轻点元素');
    expect(getToolDisplayLabel(tool('click', { target_text: '设置' }))).toBe('轻点“设置”');
    expect(getToolDisplayLabel(tool('wait_for_delay', { delay_seconds: 2 }))).toBe('等待 2 秒…');
    expect(getToolAgentName({ name: 'search_logs', agent_name: 'validator' })).toBe('校验器');
    expect(getCompressionLabel(tool('compress_history', { start_step: 2, end_step: 5 }, { status: 'success' }))).toBe('第 2–5 步已压缩为短摘要');
    expect(getToolErrorMessage(null)).toBe('工具执行失败');
    i18n.global.locale.value = 'en-US';
  });
});
