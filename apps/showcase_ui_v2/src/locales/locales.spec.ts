import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from './index';
import enUS from './en-US';
import zhCN from './zh-CN';

/** 递归收集文案对象的叶子 key 集合。 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe('locales', () => {
  it('defaults to zh-CN (decision D3: 中文界面)', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN');
  });

  it('contains the M0 skeleton keys', () => {
    expect(zhCN.nav.launcher).toBe('启动器');
    expect(zhCN.nav.workspace).toBe('工作台');
    expect(enUS.nav.launcher).toBe('Launcher');
    expect(enUS.nav.workspace).toBe('Workspace');
  });

  it('zh-CN and en-US share the exact same key set', () => {
    expect(flattenKeys(zhCN).sort()).toEqual(flattenKeys(enUS).sort());
  });
});
