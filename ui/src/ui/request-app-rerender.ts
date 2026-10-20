/**
 * SPA 子路由导航与 Lit 重绘协调。
 *
 * 背景：平台/企业各模块大量使用模块级 state + history API 做页内 Tab/子路由。
 * `openbot-app` 的 `@state tab` 在同一顶层 Tab 内不变时，popstate  alone 不会触发
 * requestUpdate，表现为「按钮点了但界面不切换」。
 *
 * 约定：任何 programmatic history 变更（push/replace + 合成 popstate）后必须
 * requestOpenBotAppRerender()；onPopState/onHashChange 亦统一兜底刷新。
 */
export function requestOpenBotAppRerender(): void {
  if (typeof document === "undefined") {
    return;
  }
  const appHost = document.querySelector("openbot-app") as {
    requestUpdate?: () => unknown;
  } | null;
  appHost?.requestUpdate?.();
}

export function normalizeAppHistoryHref(href: string): string {
  if (typeof window === "undefined") {
    return href;
  }
  const trimmed = href.trim();
  if (!trimmed) {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  if (trimmed.startsWith("//")) {
    return `/${trimmed.replace(/^\/+/, "")}`;
  }
  if (trimmed.startsWith("#")) {
    return `${window.location.pathname}${window.location.search}${trimmed}`;
  }
  if (trimmed.startsWith("?")) {
    return `${window.location.pathname}${trimmed}`;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (!trimmed.startsWith("/")) {
    return `/${trimmed.replace(/^\/+/, "")}`;
  }
  return trimmed;
}

export function pushAppHistoryState(href: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.history.pushState({}, "", normalizeAppHistoryHref(href));
  requestOpenBotAppRerender();
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function replaceAppHistoryState(href: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState({}, "", normalizeAppHistoryHref(href));
  requestOpenBotAppRerender();
  window.dispatchEvent(new PopStateEvent("popstate"));
}
