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

/** 推荐任务的 id 键覆盖文案只登记在 zh-CN（英文以后端目录为准）。 */
const PRESET_ITEM_PREFIX = 'launcher.presets.items.';

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

  it('zh-CN and en-US share the same key set, bar the id-keyed preset overrides', () => {
    const strip = (keys: string[]) => keys.filter((k) => !k.startsWith(PRESET_ITEM_PREFIX));
    expect(strip(flattenKeys(zhCN)).sort()).toEqual(strip(flattenKeys(enUS)).sort());
  });

  it('keeps preset wording in zh-CN only, and complete there', () => {
    const zhItems = flattenKeys(zhCN).filter((k) => k.startsWith(PRESET_ITEM_PREFIX));
    expect(zhItems.length).toBeGreaterThan(0);
    // 英文不复制后端文案：谁想"补齐对称"就是把一份会漂移的副本请进仓库
    expect(flattenKeys(enUS).filter((k) => k.startsWith(PRESET_ITEM_PREFIX))).toEqual([]);

    const items = zhCN.launcher.presets.items as Record<string, { title: string; goal: string }>;
    for (const [id, entry] of Object.entries(items)) {
      // 每个 id 都要同时有 title 与 goal，缺一即半中半英
      expect(zhItems).toContain(`${PRESET_ITEM_PREFIX}${id}.title`);
      expect(zhItems).toContain(`${PRESET_ITEM_PREFIX}${id}.goal`);
      expect(entry.title.trim(), id).not.toBe('');
      expect(entry.goal.trim(), id).not.toBe('');
    }
  });
});
