import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetTenantCreditsForTest,
  consumeTenantCredits,
  ensureTenantCreditsAllocation,
  listTenantCreditsCycles,
} from "./tenant-credits-store.js";

const storePath = path.join(process.cwd(), ".test-tenant-credits-store.json");

afterEach(async () => {
  await __resetTenantCreditsForTest(storePath);
});

describe("tenant-credits-store", () => {
  it("lists cycles for enterprise sorted by cycleStart", async () => {
    await ensureTenantCreditsAllocation(
      { enterpriseId: "ent-1", cycleStart: "2026-05-01T00:00:00.000Z", monthlyCredits: 5000 },
      storePath,
    );
    await consumeTenantCredits(
      { enterpriseId: "ent-1", cycleStart: "2026-05-01T00:00:00.000Z", credits: 1200 },
      storePath,
    );
    await ensureTenantCreditsAllocation(
      { enterpriseId: "ent-1", cycleStart: "2026-06-01T00:00:00.000Z", monthlyCredits: 8000 },
      storePath,
    );
    await consumeTenantCredits(
      { enterpriseId: "ent-1", cycleStart: "2026-06-01T00:00:00.000Z", credits: 900 },
      storePath,
    );
    await ensureTenantCreditsAllocation(
      { enterpriseId: "ent-2", cycleStart: "2026-06-01T00:00:00.000Z", monthlyCredits: 1000 },
      storePath,
    );

    const cycles = await listTenantCreditsCycles("ent-1", { storePath });
    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.cycleStart).toBe("2026-05-01T00:00:00.000Z");
    expect(cycles[0]?.creditsConsumed).toBe(1200);
    expect(cycles[1]?.cycleStart).toBe("2026-06-01T00:00:00.000Z");
    expect(cycles[1]?.creditsConsumed).toBe(900);

    const limited = await listTenantCreditsCycles("ent-1", { storePath, limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.cycleStart).toBe("2026-06-01T00:00:00.000Z");
  });
});
