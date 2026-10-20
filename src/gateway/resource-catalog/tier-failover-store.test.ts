// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-tier-failover-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { upsertTierFailoverRule, listTierFailoverRules } = await import("./tier-failover-store.js");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("tier-failover-store", () => {
  it("requires fallback tier when mode is fallback_tier", async () => {
    await expect(
      upsertTierFailoverRule({
        tier: "tier_a",
        enabled: true,
        mode: "fallback_tier",
        fallbackTierId: null,
      }),
    ).rejects.toThrow(/fallbackTierId/);
  });

  it("lists upserted rules", async () => {
    await upsertTierFailoverRule({
      tier: "tier_a",
      enabled: true,
      mode: "next_in_pool",
      maxConsecutiveFailures: 4,
    });
    const rules = await listTierFailoverRules();
    expect(rules).toEqual([
      expect.objectContaining({ tier: "tier_a", enabled: true, maxConsecutiveFailures: 4 }),
    ]);
  });
});
