import { afterEach, describe, expect, it, vi } from "vitest";
import { installIdempotentCustomElementDefine } from "./safe-custom-element-define.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installIdempotentCustomElementDefine", () => {
  it("no-ops when customElements is missing", () => {
    vi.stubGlobal("customElements", undefined);
    expect(() => installIdempotentCustomElementDefine()).not.toThrow();
  });

  it("skips a second define of the same tag instead of throwing", () => {
    const defined = new Map<string, unknown>();
    const originalDefine = vi.fn(function (this: unknown, name: string, ctor: unknown) {
      if (defined.has(name)) {
        throw new Error(`already defined: ${name}`);
      }
      defined.set(name, ctor);
    });
    const originalGet = vi.fn((name: string) => defined.get(name));
    class FakeRegistry {
      define(name: string, ctor: unknown) {
        return originalDefine.call(this, name, ctor);
      }
      get(name: string) {
        return originalGet(name);
      }
    }
    vi.stubGlobal("CustomElementRegistry", FakeRegistry);
    vi.stubGlobal("customElements", new FakeRegistry());

    installIdempotentCustomElementDefine();
    const registry = new FakeRegistry();
    const first = function FirstEl() {};
    const second = function SecondEl() {};
    registry.define("cli-credential-self-panel", first);
    expect(() => registry.define("cli-credential-self-panel", second)).not.toThrow();
    expect(originalDefine).toHaveBeenCalledTimes(1);
    expect(defined.get("cli-credential-self-panel")).toBe(first);
  });
});
