// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAppHistoryHref,
  pushAppHistoryState,
  replaceAppHistoryState,
  requestOpenBotAppRerender,
} from "./request-app-rerender.ts";

describe("request-app-rerender", () => {
  beforeEach(() => {
    document.body.innerHTML = "<openbot-app></openbot-app>";
    window.history.replaceState({}, "", "/platform/pricing");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("requestOpenBotAppRerender calls requestUpdate on openbot-app", () => {
    const app = document.querySelector("openbot-app") as HTMLElement & {
      requestUpdate?: ReturnType<typeof vi.fn>;
    };
    const spy = vi.fn();
    app.requestUpdate = spy;
    requestOpenBotAppRerender();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("pushAppHistoryState updates location and dispatches popstate", () => {
    const pop = vi.fn();
    window.addEventListener("popstate", pop);
    const app = document.querySelector("openbot-app") as HTMLElement & {
      requestUpdate?: ReturnType<typeof vi.fn>;
    };
    const update = vi.fn();
    app.requestUpdate = update;
    pushAppHistoryState("/platform/pricing?tab=economics");
    expect(window.location.pathname).toBe("/platform/pricing");
    expect(window.location.search).toBe("?tab=economics");
    expect(update).toHaveBeenCalledOnce();
    expect(pop).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", pop);
  });

  it("replaceAppHistoryState updates location and dispatches popstate", () => {
    const pop = vi.fn();
    window.addEventListener("popstate", pop);
    replaceAppHistoryState("/platform/models#platform-models:taskPlans");
    expect(window.location.hash).toBe("#platform-models:taskPlans");
    expect(pop).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", pop);
  });

  it("normalizes protocol-relative app urls back to same-origin paths", () => {
    expect(normalizeAppHistoryHref("//usage/overview")).toBe("/usage/overview");
    expect(normalizeAppHistoryHref("//platform/pricing")).toBe("/platform/pricing");
  });

  it("normalizes bare relative app urls to root-relative paths", () => {
    expect(normalizeAppHistoryHref("usage/overview")).toBe("/usage/overview");
  });
});
