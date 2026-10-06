import { describe, expect, it } from 'vitest';

import {
  contextPercent,
  formatCompactTokens,
  formatElapsed,
  parseRunTuning,
  sessionElapsedSeconds,
  tuningLabel,
} from './run-info';

/** 平移自 Angular `run-info.util.spec.ts` 的关键断言。 */
describe('run-info util（平移自 run-info.util.spec）', () => {
  it('formatElapsed formats seconds, minutes and hours with zero padding', () => {
    expect(formatElapsed(42)).toBe('42s');
    expect(formatElapsed(725)).toBe('12m 05s');
    expect(formatElapsed(3725)).toBe('1h 02m 05s');
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(null)).toBe('0s');
  });

  it('formatCompactTokens uses plain, k and M units', () => {
    expect(formatCompactTokens(842)).toBe('842');
    expect(formatCompactTokens(76400)).toBe('76.4k');
    expect(formatCompactTokens(1_200_000)).toBe('1.2M');
  });

  it('contextPercent reports one-decimal share and falls back to the 1M window', () => {
    expect(contextPercent(700_000, 1_000_000)).toBe(70);
    expect(contextPercent(1, 3)).toBe(33.3);
    expect(contextPercent(2_000_000, 1_000_000)).toBe(100);
    expect(contextPercent(null, 1_000_000)).toBeNull();
  });

  it('sessionElapsedSeconds counts to now while running and to end_time once finished', () => {
    const session = { start_time: 1000, end_time: 2000 };
    // running: start 1000s → now 5000s = 4000s
    expect(sessionElapsedSeconds(session, true, 5_000_000)).toBe(4000);
    // finished: start 1000s → end 2000s = 1000s
    expect(sessionElapsedSeconds(session, false, 0)).toBe(1000);
  });

  it('is zero without a start time or session', () => {
    expect(sessionElapsedSeconds(null, false, 0)).toBe(0);
    expect(sessionElapsedSeconds({ end_time: 5 }, false, 0)).toBe(0);
  });

  it('tuningLabel maps ids to the launcher labels and defaults unknown ids', () => {
    expect(tuningLabel('verify', 'checkpoints')).toBe('Every step');
    expect(tuningLabel('explore', 'ultra')).toBe('Close-up');
    expect(tuningLabel('verify', 'nonsense')).toBe('At the end');
    expect(tuningLabel('explore', undefined)).toBe('Quick glance');
  });

  it('parseRunTuning reads run_tuning from a JSON string or an object', () => {
    expect(parseRunTuning('{"run_tuning":{"verification_level":"strict"}}')).toEqual({
      verification_level: 'strict',
      explorer_mode: null,
    });
    expect(parseRunTuning({ run_tuning: { explorer_mode: 'pro' } })).toEqual({
      verification_level: null,
      explorer_mode: 'pro',
    });
  });

  it('is null for flash sessions, malformed JSON and empty tuning', () => {
    expect(parseRunTuning('{}')).toBeNull();
    expect(parseRunTuning('not json')).toBeNull();
    expect(parseRunTuning({ run_tuning: {} })).toBeNull();
  });
});
