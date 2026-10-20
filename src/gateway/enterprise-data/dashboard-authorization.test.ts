// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-backend.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveDataAuthorizationCards } from "./dashboard-authorization-store.js";
import { listDataSources } from "./data-source-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

function seatStoreWith(seats: EnterpriseSeatAssetsStore["seats"]): EnterpriseSeatAssetsStore {
  const store = normalizeEnterpriseSeatAssetsStore(null, 1);
  store.seats = seats;
  return store;
}

function makeSeat(
  seatId: string,
  title: string,
  roleCode: string,
  teamLabel: string,
): EnterpriseSeatAssetsStore["seats"][string] {
  return {
    seatId,
    tenantId,
    title,
    teamLabel,
    roleCode,
    status: "occupied",
    defaultSpaceIds: [],
    defaultAgentAssetIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

describe("dashboard authorization cards", () => {
  it("resolves seat and department targets authoritatively and groups roles non-precisely", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    // 权威席位：policy seat target `seat-sales-mgr-east` + 两个 sales-mgr 角色席位。
    const seatStore = seatStoreWith({
      "seat-sales-mgr-east": makeSeat(
        "seat-sales-mgr-east",
        "华东销售经理",
        "sales-mgr",
        "华东销售",
      ),
      "seat-sales-mgr-west": makeSeat(
        "seat-sales-mgr-west",
        "华北销售经理",
        "sales-mgr",
        "华北销售",
      ),
    });

    const cards = resolveDataAuthorizationCards({ store, seatStore, tenantId });

    const crmSource = listDataSources({ store, tenantId }).find((s) => s.category === "crm");
    expect(crmSource).toBeTruthy();
    const crmCard = cards.find((c) => c.sourceId === crmSource!.sourceId);
    expect(crmCard).toBeTruthy();

    const seatTarget = crmCard!.targets.find((tgt) => tgt.kind === "seat");
    expect(seatTarget?.label).toBe("华东销售经理"); // authoritative title, not raw id
    expect(seatTarget?.precise).toBe(true);
    expect(seatTarget?.count).toBe(1);

    const roleTarget = crmCard!.targets.find((tgt) => tgt.kind === "role");
    expect(roleTarget?.label).toBe("sales-mgr");
    expect(roleTarget?.precise).toBe(false); // grouped by roleCode, non-precise
    expect(roleTarget?.count).toBe(2); // two seats carry sales-mgr

    const departmentTarget = crmCard!.targets.find((tgt) => tgt.kind === "department");
    expect(departmentTarget?.label).toBe("华东销售");
    expect(departmentTarget?.count).toBe(1);
    expect(departmentTarget?.precise).toBe(true);
  });

  it("falls back to raw seatId when the seat is not found in the seat store", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const seatStore = seatStoreWith({}); // no seats

    const cards = resolveDataAuthorizationCards({ store, seatStore, tenantId });
    const seatTarget = cards.flatMap((card) => card.targets).find((tgt) => tgt.kind === "seat");
    expect(seatTarget?.label).toBe("seat-sales-mgr-east");
    expect(seatTarget?.precise).toBe(false); // not resolvable → non-precise
  });

  it("keeps department targets non-precise when no matching seat entity exists", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const seatStore = seatStoreWith({
      "seat-sales-mgr-west": makeSeat(
        "seat-sales-mgr-west",
        "华北销售经理",
        "sales-mgr",
        "华北销售",
      ),
    });

    const cards = resolveDataAuthorizationCards({ store, seatStore, tenantId });
    const departmentTarget = cards
      .flatMap((card) => card.targets)
      .find((tgt) => tgt.kind === "department");
    expect(departmentTarget?.label).toBe("华东销售");
    expect(departmentTarget?.count).toBe(0);
    expect(departmentTarget?.precise).toBe(false);
  });
});
