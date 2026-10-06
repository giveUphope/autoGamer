/**
 * Vitest 环境垫片：jsdom 缺少 Arco 部分组件依赖的浏览器 API。
 */

// ResizeObserver（a-space / a-tag 等弹层与布局组件使用）
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

// matchMedia
if (!('matchMedia' in globalThis)) {
  (globalThis as Record<string, unknown>).matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: (): void => {},
      removeListener: (): void => {},
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      dispatchEvent: (): boolean => false,
    }) as unknown as MediaQueryList;
}
