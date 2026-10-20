import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importWithStaleChunkReload, isStaleDynamicImportError } from "./lazy-module.ts";

describe("lazy-module stale chunk recovery", () => {
  const store = new Map<string, string>();
  const sessionStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", sessionStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
  });

  it("detects vite dynamic import fetch failures", () => {
    expect(
      isStaleDynamicImportError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://www.openbot.love/assets/growth-task-gate-DEB6lnBz.js",
        ),
      ),
    ).toBe(true);
    expect(isStaleDynamicImportError(new Error("boom"))).toBe(false);
  });

  it("reloads once when a stale chunk cannot be fetched", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("location", { reload });
    const pending = importWithStaleChunkReload(async () => {
      throw new TypeError(
        "Failed to fetch dynamically imported module: https://www.openbot.love/assets/growth-task-gate-DEB6lnBz.js",
      );
    });
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("openbot:stale-chunk-reload")).toBe("1");
    void pending;
  });

  it("clears the reload marker after a successful import", async () => {
    sessionStorage.setItem("openbot:stale-chunk-reload", "1");
    const mod = await importWithStaleChunkReload(async () => ({ ok: true }));
    expect(mod).toEqual({ ok: true });
    expect(sessionStorage.getItem("openbot:stale-chunk-reload")).toBeNull();
  });
});
