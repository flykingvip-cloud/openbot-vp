import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { loadConfig } from "../config/config.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import { listTenantIdsFromVolume } from "../conversations/managed-planes.js";
import { loadEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";
import { resetSeatTenantIndexForTest, resolveTenantForSeatId } from "./seat-tenant-index.js";

vi.mock("../config/config.js");
vi.mock("../config/data-space.js");
vi.mock("../conversations/managed-planes.js");
vi.mock("./enterprise-seat-assets-store.js");
vi.mock("./platform-auth/seat-store-loader.js");
vi.mock("./tenant-canonicalization.js", () => ({
  canonicalizeTenantId: (value?: string | null) => value?.trim() || null,
}));

function seatStore(seats: Record<string, { seatId?: string; tenantId?: string }>) {
  return { seats } as never;
}

describe("resolveTenantForSeatId", () => {
  const mockLoadConfig = loadConfig as Mock;
  const mockShared = isSharedTenantAddressingEnabled as Mock;
  const mockListTenants = listTenantIdsFromVolume as Mock;
  const mockLoadGlobal = loadEnterpriseSeatAssetsStore as Mock;
  const mockLoadForTenant = loadSeatAssetsStoreForTenantId as Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    resetSeatTenantIndexForTest();
    mockLoadConfig.mockReturnValue({});
    mockShared.mockReturnValue(false);
    mockListTenants.mockReturnValue([]);
    mockLoadGlobal.mockResolvedValue(seatStore({}));
    mockLoadForTenant.mockResolvedValue(seatStore({}));
  });

  it("resolves a seat from the process-global store", async () => {
    mockLoadGlobal.mockResolvedValue(
      seatStore({ "seat-ceo-main": { seatId: "seat-ceo-main", tenantId: "001" } }),
    );
    await expect(resolveTenantForSeatId("seat-ceo-main")).resolves.toBe("001");
  });

  it("falls back to the record key when seatId is absent", async () => {
    mockLoadGlobal.mockResolvedValue(seatStore({ "seat-key-only": { tenantId: "001" } }));
    await expect(resolveTenantForSeatId("seat-key-only")).resolves.toBe("001");
  });

  it("resolves a seat from a per-tenant store when shared addressing is on", async () => {
    mockShared.mockReturnValue(true);
    mockListTenants.mockReturnValue(["acme"]);
    mockLoadForTenant.mockImplementation(async (tenantId: string) =>
      tenantId === "acme"
        ? seatStore({ "seat-acme-1": { seatId: "seat-acme-1", tenantId: "acme" } })
        : seatStore({}),
    );
    await expect(resolveTenantForSeatId("seat-acme-1")).resolves.toBe("acme");
  });

  it("does not read per-tenant stores when shared addressing is off", async () => {
    mockListTenants.mockReturnValue(["acme"]);
    await expect(resolveTenantForSeatId("seat-unknown")).resolves.toBeNull();
    expect(mockLoadForTenant).not.toHaveBeenCalled();
  });

  it("returns null for an unknown seat and for a blank id", async () => {
    await expect(resolveTenantForSeatId("nope")).resolves.toBeNull();
    await expect(resolveTenantForSeatId("  ")).resolves.toBeNull();
    await expect(resolveTenantForSeatId(undefined)).resolves.toBeNull();
  });

  it("skips seats with no tenant instead of guessing", async () => {
    mockLoadGlobal.mockResolvedValue(seatStore({ "seat-no-tenant": { seatId: "seat-no-tenant" } }));
    await expect(resolveTenantForSeatId("seat-no-tenant")).resolves.toBeNull();
  });

  it("fails closed when the global store is unreadable", async () => {
    mockLoadGlobal.mockRejectedValue(new Error("boom"));
    await expect(resolveTenantForSeatId("seat-ceo-main")).resolves.toBeNull();
  });

  it("tolerates a tenant whose seat store is missing", async () => {
    mockShared.mockReturnValue(true);
    mockListTenants.mockReturnValue(["acme", "broken"]);
    mockLoadForTenant.mockImplementation(async (tenantId: string) => {
      if (tenantId === "broken") {
        throw new Error("no store");
      }
      return seatStore({ "seat-acme-1": { seatId: "seat-acme-1", tenantId: "acme" } });
    });
    await expect(resolveTenantForSeatId("seat-acme-1")).resolves.toBe("acme");
  });

  it("serves repeat hits from the cache without rebuilding", async () => {
    mockLoadGlobal.mockResolvedValue(
      seatStore({ "seat-ceo-main": { seatId: "seat-ceo-main", tenantId: "001" } }),
    );
    await expect(resolveTenantForSeatId("seat-ceo-main")).resolves.toBe("001");
    await expect(resolveTenantForSeatId("seat-ceo-main")).resolves.toBe("001");
    expect(mockLoadGlobal).toHaveBeenCalledTimes(1);
  });

  // A seat created moments ago must not have to wait out the TTL.
  it("rebuilds once on a miss so a new seat becomes resolvable", async () => {
    mockLoadGlobal.mockResolvedValueOnce(seatStore({}));
    mockLoadGlobal.mockResolvedValueOnce(
      seatStore({ "seat-new": { seatId: "seat-new", tenantId: "001" } }),
    );
    await expect(resolveTenantForSeatId("seat-new")).resolves.toBe("001");
    expect(mockLoadGlobal).toHaveBeenCalledTimes(2);
  });

  it("keeps the first tenant when a seat id appears under two tenants", async () => {
    mockShared.mockReturnValue(true);
    mockListTenants.mockReturnValue(["acme"]);
    mockLoadGlobal.mockResolvedValue(
      seatStore({ "seat-dup": { seatId: "seat-dup", tenantId: "001" } }),
    );
    mockLoadForTenant.mockResolvedValue(
      seatStore({ "seat-dup": { seatId: "seat-dup", tenantId: "acme" } }),
    );
    await expect(resolveTenantForSeatId("seat-dup")).resolves.toBe("001");
  });
});
