import { describe, expect, it } from "vitest";
import {
  resolveCapabilitiesByActionRef,
  resolveCapabilityActionMapper,
  resolveCapabilityGovernanceView,
  resolveCapabilityOverview,
  resolveCapabilitySourceMapper,
} from "./capability-governance-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { archiveDataCapability, upsertDataCapability } from "./data-capability-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("M3 capability governance", () => {
  it("maps capability sources via Capability Source Mapper", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const mappings = resolveCapabilitySourceMapper({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.source.sourceKey).toBe("crm-salesforce");
  });

  it("maps capability actions via Capability Action Mapper", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const mappings = resolveCapabilityActionMapper({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
    });
    expect(mappings[0]?.ref.actionKey).toBe("crm.customer.read_summary");
    expect(mappings[0]?.action?.version).toBe("v1");
    expect(mappings[0]?.handlerRegistered).toBe(true);
  });

  it("resolves governance view with projections and access scope", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const view = resolveCapabilityGovernanceView({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
    });
    expect(view.projectionSpecs.length).toBeGreaterThan(0);
    expect(view.accessScope.activeGrants.length).toBeGreaterThan(0);
    expect(view.supplyHealth.projectionCount).toBeGreaterThan(0);
  });

  it("reverse-resolves capabilities by action ref", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capabilities = resolveCapabilitiesByActionRef({
      store,
      tenantId,
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
    });
    expect(capabilities.some((item) => item.capabilityKey === "customer.profile")).toBe(true);
    expect(capabilities.some((item) => item.capabilityKey === "sales.churn-risk")).toBe(false);
  });

  it("keeps v2 action refs off the v1 capability governance view", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "sales.churn-risk",
    )!;
    const view = resolveCapabilityGovernanceView({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
    });
    expect(view.sourceMappings.map((entry) => entry.source.sourceKey)).toEqual(["crm-salesforce"]);
    expect(view.actionMappings.map((entry) => entry.ref)).toEqual([
      {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v2",
      },
    ]);
    expect(view.projectionSpecs.map((spec) => spec.projectionKey)).toEqual(["sales.churn-risk"]);
    expect(view.accessScope.policies).toEqual([]);
    expect(
      view.accessScope.activeGrants.every(
        (grant) => grant.actionKey === "crm.customer.read_summary" && grant.version === "v2",
      ),
    ).toBe(true);
    expect(view.accessScope.activeGrants.length).toBeGreaterThan(0);
    expect(view.supplyHealth.projectionCount).toBe(1);
    expect(view.supplyHealth.enabledPolicyCount).toBe(0);
  });

  it("rejects capability when action connectorId does not align with linked sources", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    expect(() =>
      upsertDataCapability({
        store,
        tenantId,
        nowIso,
        capability: {
          capabilityKey: "misaligned.capability",
          displayName: "Misaligned",
          description: "bad mapping",
          sourceIds: [crmSource.sourceId],
          actionRefs: [
            {
              connectorId: "erp-sap",
              actionKey: "erp.order.read_status",
              version: "v1",
            },
          ],
          enabled: true,
        },
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("archives capability by disabling it", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const archived = archiveDataCapability({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
      nowIso: "2026-06-05T13:00:00.000Z",
    });
    expect(archived.enabled).toBe(false);
    const overview = resolveCapabilityOverview({ store, tenantId });
    expect(overview.enabledCapabilityCount).toBeLessThan(overview.capabilityCount);
  });
});
