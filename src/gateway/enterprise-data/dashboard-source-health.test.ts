// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-backend.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveDataSourceHealthRows } from "./dashboard-source-health-store.js";
import { listDataSources } from "./data-source-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-08T12:00:00.000Z";

function emptySeatStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 1);
}

describe("dashboard source health (5-state)", () => {
  it("maps connected sources to normal without treating updatedAt as a sync", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const rows = resolveDataSourceHealthRows({
      store,
      seatStore: emptySeatStore(),
      tenantId,
      nowIso,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => ["normal", "sync_delayed"].includes(row.status))).toBe(true);
  });

  it("does not treat a stale updatedAt as sync_delayed", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const source = listDataSources({ store, tenantId })[0];
    store.dataSources[source.sourceId].updatedAt = "2026-06-06T12:00:00.000Z";
    const rows = resolveDataSourceHealthRows({
      store,
      seatStore: emptySeatStore(),
      tenantId,
      nowIso,
    });
    expect(rows.find((row) => row.sourceId === source.sourceId)?.status).toBe("normal");
  });

  it("flags sync_delayed only when lastMaterializedAt is past the SLA", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const source = listDataSources({ store, tenantId })[0];
    store.dataSources[source.sourceId].lastMaterializedAt = "2026-06-06T12:00:00.000Z";
    const rows = resolveDataSourceHealthRows({
      store,
      seatStore: emptySeatStore(),
      tenantId,
      nowIso,
    });
    expect(rows.find((row) => row.sourceId === source.sourceId)?.status).toBe("sync_delayed");
  });

  it("maps disconnected and error statuses directly", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const sources = listDataSources({ store, tenantId });
    store.dataSources[sources[0].sourceId].status = "disconnected";
    store.dataSources[sources[1].sourceId].status = "error";
    const rows = resolveDataSourceHealthRows({
      store,
      seatStore: emptySeatStore(),
      tenantId,
      nowIso,
    });
    expect(rows.find((row) => row.sourceId === sources[0].sourceId)?.status).toBe("disconnected");
    expect(rows.find((row) => row.sourceId === sources[1].sourceId)?.status).toBe("error");
  });
});
