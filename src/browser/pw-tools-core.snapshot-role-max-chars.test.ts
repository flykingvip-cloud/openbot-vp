import { describe, expect, it, vi } from "vitest";
import {
  installPwToolsCoreTestHooks,
  setPwToolsCoreCurrentPage,
} from "./pw-tools-core.test-harness.js";

installPwToolsCoreTestHooks();
const mod = await import("./pw-tools-core.snapshot.js");

describe("snapshotRoleViaPlaywright maxChars", () => {
  it("truncates an interactive aria snapshot to the requested maxChars", async () => {
    const line = '- button "加入购物车" [ref=e1]\n';
    const full = line.repeat(800);
    expect(full.length).toBeGreaterThan(5000);
    setPwToolsCoreCurrentPage({
      _snapshotForAI: vi.fn(async () => ({ full })),
    });

    const result = await mod.snapshotRoleViaPlaywright({
      cdpUrl: "http://127.0.0.1:9222",
      refsMode: "aria",
      maxChars: 5000,
      options: { interactive: true },
    });

    expect(result.truncated).toBe(true);
    expect(result.snapshot.length).toBeLessThanOrEqual(
      5000 + "\n\n[...TRUNCATED - page too large]".length,
    );
    expect(result.snapshot.endsWith("[...TRUNCATED - page too large]")).toBe(true);
    expect(result.snapshot.slice(0, 5000).length).toBe(5000);
  });
});
