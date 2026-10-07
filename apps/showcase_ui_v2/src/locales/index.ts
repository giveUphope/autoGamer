import { createI18n } from 'vue-i18n';

import enUS from './en-US';
import zhCN from './zh-CN';

/** 界面默认中文（决策 D3：对等迁移 + 中文界面）。 */
export const DEFAULT_LOCALE = 'zh-CN' as const;

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'artemis.locale';

function initialLocale(): SupportedLocale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
  return stored === 'en-US' || stored === 'zh-CN' ? stored : DEFAULT_LOCALE;
}

const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export default i18n;
