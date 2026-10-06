import { createI18n } from 'vue-i18n';

import enUS from './en-US';
import zhCN from './zh-CN';

/** 界面默认中文（决策 D3：对等迁移 + 中文界面）。 */
export const DEFAULT_LOCALE = 'zh-CN' as const;

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export default i18n;
