/**
 * API 格式（运行时 provider 分派键）的文案映射。
 * 端点表单的下拉、端点库表格的列、模型选择器的选项标签共用这一份，
 * 避免同一词汇在三处各写一遍。后端 `_ALLOWED_API_FORMATS` 还接受
 * openrouter/xai/ollama/vllm/custom 等值，未在此登记的按原样显示、不做猜测。
 */
export const API_FORMAT_LABEL_KEYS: Record<string, string> = {
  openai: 'formatOpenai',
  openai_responses: 'formatOpenaiResponses',
  anthropic: 'formatAnthropic',
  google: 'formatGoogle',
};

/** 端点表单下拉的可选协议（顺序即展示顺序）。 */
export const API_FORMAT_OPTIONS = Object.keys(API_FORMAT_LABEL_KEYS);

/** 把协议 id 翻成界面文案；无对应文案时退回原 id。 */
export function apiFormatLabel(
  t: (key: string) => string,
  format: string | null | undefined,
): string {
  if (!format) return '';
  const key = API_FORMAT_LABEL_KEYS[format];
  return key ? t(`launcher.diagnostics.cred.${key}`) : format;
}
