import { describe, expect, it } from "vitest";
import { matchesGlob } from "../architecture/glob-match.js";

describe("architecture manifest glob matcher", () => {
  it("matches ** segments", () => {
    expect(matchesGlob("src/plugins/loader/foo.ts", "src/plugins/loader/**")).toBe(true);
    expect(matchesGlob("src/plugins/hooks.ts", "src/plugins/loader/**")).toBe(false);
  });

  it("supports !(a|b) negation for file stems", () => {
    expect(
      matchesGlob(
        "src/plugins/loader/runtime-resolve.ts",
        "src/plugins/loader/!(runtime-resolve).ts",
      ),
    ).toBe(false);
    expect(
      matchesGlob(
        "src/plugins/loader/load-orchestration.ts",
        "src/plugins/loader/!(runtime-resolve).ts",
      ),
    ).toBe(true);
  });

  it("supports negated directory groups in deny paths", () => {
    expect(
      matchesGlob(
        "src/gateway/platform-auth/store.ts",
        "src/gateway/platform-auth/!(store|store-types).ts",
      ),
    ).toBe(false);
    expect(
      matchesGlob(
        "src/gateway/platform-auth/rate-limit.ts",
        "src/gateway/platform-auth/!(rate-limit).ts",
      ),
    ).toBe(false);
  });
});
