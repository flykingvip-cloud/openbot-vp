// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { renderPlatformModelsSurface } from "./page.ts";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/platform/models");
});

describe("platform models hash tabs", () => {
  it("switches tabs without a synthetic popstate", () => {
    window.history.replaceState({}, "", "/platform/models");
    const host = document.createElement("div");
    document.body.append(host);
    const onRefresh = vi.fn(async () => {});
    const props = {
      tab: "platformModels",
      basePath: "",
      readModel: {
        modelsManagementError: "fixture",
        modelsManagementSnapshot: { providers: [], models: [] },
      },
      actions: { models: { onRefresh } },
      pageViewModels: { models: null },
    } as unknown as PlatformSurfaceProps;

    render(renderPlatformModelsSurface(props), host);
    const openAssets = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((node) =>
      node.textContent?.includes("查看模型资产"),
    );
    expect(openAssets).toBeTruthy();

    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    openAssets?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    window.removeEventListener("popstate", popSpy);

    expect(popSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#platform-models:modelAssets");
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
