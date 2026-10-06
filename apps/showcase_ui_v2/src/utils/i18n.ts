/**
 * util 层 i18n 薄封装：供 formatter 等纯函数模块生成用户可见文案
 * （原 Angular 平移文件中的硬编码英文，M7 收尾迁移至 tools.* / actions.* 键集）。
 * vue-i18n `global.t` 读取响应式 locale，在 computed/渲染期调用可随语言切换重算。
 */
import i18n from '@/locales';

export function tUtil(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}
