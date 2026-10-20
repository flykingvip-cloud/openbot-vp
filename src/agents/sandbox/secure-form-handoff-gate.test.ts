import { describe, expect, it } from "vitest";
import { isHandoffGateClearedFromDom, pollHandoffGateCleared } from "./secure-form-handoff-gate.js";

describe("isHandoffGateClearedFromDom", () => {
  it("clears on data-signed-in", () => {
    expect(isHandoffGateClearedFromDom({ signedInAttr: "true" })).toBe(true);
    expect(isHandoffGateClearedFromDom({ signedInAttr: "1" })).toBe(true);
    expect(isHandoffGateClearedFromDom({ signedInAttr: "false" })).toBe(false);
  });

  it("clears on fixture-ok status text", () => {
    expect(
      isHandoffGateClearedFromDom({
        statusText: "fixture-ok: wechat-qr confirmed (no real WeChat)",
      }),
    ).toBe(true);
    expect(isHandoffGateClearedFromDom({ statusText: "等待扫码…" })).toBe(false);
  });

  it("clears on conservative success URL", () => {
    expect(isHandoffGateClearedFromDom({ href: "https://example.com/loginSuccess?x=1" })).toBe(
      true,
    );
    expect(isHandoffGateClearedFromDom({ href: "https://example.com/login" })).toBe(false);
    expect(isHandoffGateClearedFromDom({ href: "https://example.com/passport/qrcode" })).toBe(
      false,
    );
  });
});

it("clears Zhihu homepage via signedInHeuristic (not URL alone)", () => {
  expect(
    isHandoffGateClearedFromDom({
      href: "https://www.zhihu.com/",
      leftAuthPath: true,
      signedInHeuristic: true,
    }),
  ).toBe(true);
  // Logged-out site root must not clear.
  expect(
    isHandoffGateClearedFromDom({
      href: "https://www.zhihu.com/",
      leftAuthPath: true,
      signedInHeuristic: false,
    }),
  ).toBe(false);
  expect(
    isHandoffGateClearedFromDom({
      href: "https://www.zhihu.com/signin",
      leftAuthPath: false,
      signedInHeuristic: false,
    }),
  ).toBe(false);
});

it("clears when signedInHeuristic alone is true", () => {
  expect(isHandoffGateClearedFromDom({ signedInHeuristic: true })).toBe(true);
});

describe("pollHandoffGateCleared", () => {
  it("resolves true when probe eventually clears", async () => {
    let n = 0;
    const cleared = await pollHandoffGateCleared({
      intervalMs: 20,
      probe: async () => {
        n += 1;
        return n >= 2 ? { signedInAttr: "true" } : { signedInAttr: null };
      },
    });
    expect(cleared).toBe(true);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("stops on abort", async () => {
    const abort = new AbortController();
    const pending = pollHandoffGateCleared({
      intervalMs: 50,
      signal: abort.signal,
      probe: async () => ({ signedInAttr: null }),
    });
    await new Promise((r) => setTimeout(r, 30));
    abort.abort();
    await expect(pending).resolves.toBe(false);
  });
});
