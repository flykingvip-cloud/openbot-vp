import { describe, expect, it } from "vitest";
import { ensureEnterpriseDataCatalogSeeded, seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

describe("ensureEnterpriseDataCatalogSeeded multitenant", () => {
  it("does not auto-seed demo catalog when OPENBOT_MULTITENANT=1", () => {
    const prev = process.env.OPENBOT_MULTITENANT;
    process.env.OPENBOT_MULTITENANT = "1";
    try {
      const store = normalizeEnterpriseDataStore(null);
      const next = ensureEnterpriseDataCatalogSeeded({
        store,
        tenantId: "new-tenant",
        nowIso: new Date().toISOString(),
      });
      expect(Object.keys(next.connectorActions)).toHaveLength(0);
      expect(Object.keys(next.dataSources)).toHaveLength(0);
      expect(Object.keys(next.dataCapabilities)).toHaveLength(0);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_MULTITENANT;
      } else {
        process.env.OPENBOT_MULTITENANT = prev;
      }
    }
  });

  it("still seeds when multitenant is off (local/dev)", () => {
    const prev = process.env.OPENBOT_MULTITENANT;
    delete process.env.OPENBOT_MULTITENANT;
    try {
      const store = normalizeEnterpriseDataStore(null);
      const next = ensureEnterpriseDataCatalogSeeded({
        store,
        tenantId: "local-dev",
        nowIso: new Date().toISOString(),
      });
      expect(Object.keys(next.connectorActions).length).toBeGreaterThan(0);
      expect(Object.keys(next.dataSources).length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_MULTITENANT;
      } else {
        process.env.OPENBOT_MULTITENANT = prev;
      }
    }
  });

  it("explicit seedEnterpriseDataCatalog still works under multitenant", () => {
    const prev = process.env.OPENBOT_MULTITENANT;
    process.env.OPENBOT_MULTITENANT = "1";
    try {
      const store = normalizeEnterpriseDataStore(null);
      seedEnterpriseDataCatalog({
        store,
        tenantId: "new-tenant",
        nowIso: new Date().toISOString(),
      });
      expect(Object.keys(store.connectorActions).length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_MULTITENANT;
      } else {
        process.env.OPENBOT_MULTITENANT = prev;
      }
    }
  });
});
