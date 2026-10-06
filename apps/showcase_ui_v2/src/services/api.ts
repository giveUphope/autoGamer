/**
 * 原生 fetch 封装，对应 Angular 版对 HttpClient 的实际用法：
 * 只需 GET/POST + JSON 解析 + 错误透传（后端 FastAPI 的错误体形如 `{detail: ...}`）。
 *
 * Angular HttpClient 的语义对照：
 * - `http.get<T>(url, { params })` → `apiGet<T>(url, { params })`
 * - `http.post<T>(url, body)`      → `apiPost<T>(url, body)`
 * - 错误回调里的 `err.error`（响应体）与 `err.status` → `ApiError.body` / `ApiError.status`
 */

export class ApiError extends Error {
  readonly status: number;
  /** 解析后的响应体（JSON 对象或原始文本），对应 Angular `err.error`。 */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** FastAPI 的 `detail` 字段（若有），对应 Angular 侧 `err.error?.detail` 的取法。 */
  get detail(): string | undefined {
    if (this.body && typeof this.body === 'object' && 'detail' in this.body) {
      const d = (this.body as { detail: unknown }).detail;
      return typeof d === 'string' ? d : JSON.stringify(d);
    }
    return typeof this.body === 'string' ? this.body : undefined;
  }
}

export type ApiQueryParams = Record<string, string | number | boolean | null | undefined>;

function buildUrl(url: string, params?: ApiQueryParams): string {
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  if (!qs) return url;
  return url + (url.includes('?') ? '&' : '?') + qs;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
  params?: ApiQueryParams,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(url, params), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // 网络层失败（后端未启动 / 断网）：包装成 status=0 的 ApiError，错误处理路径单一。
    throw new ApiError(0, `Network error: ${String(err)}`, undefined);
  }
  const parsed = await parseBody(res);
  if (!res.ok) {
    throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`.trim(), parsed);
  }
  return parsed as T;
}

/** GET JSON；非 2xx 抛 ApiError（body 已解析，`detail` 可直接取后端错误信息）。 */
export function apiGet<T>(
  url: string,
  options?: { params?: ApiQueryParams },
): Promise<T> {
  return request<T>('GET', url, undefined, options?.params);
}

/** POST JSON（body 缺省发 `{}`，与 Angular `http.post(url, {})` 对齐）。 */
export function apiPost<T>(url: string, body: unknown = {}): Promise<T> {
  return request<T>('POST', url, body);
}

/** DELETE 请求；非 2xx 抛 ApiError（同 apiGet 语义）。 */
export function apiDelete<T>(url: string): Promise<T> {
  return request<T>('DELETE', url);
}
