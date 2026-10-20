import { describe, expect, it } from "vitest";
import {
  listAccessGovernanceMatrix,
  resolveAccessGovernanceOverview,
  resolveAccessGovernanceTarget,
  resolveDataSourceGovernanceView,
} from "./access-governance-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  archiveDataAccessPolicy,
  compileDataAccessPolicy,
  upsertDataAccessPolicy,
} from "./data-access-policy-store.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { archiveDataSource, upsertDataSource } from "./data-source-store.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("M2 access governance", () => {
  it("resolves DataSource governance view with capability and projection reverse lookup", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    const view = resolveDataSourceGovernanceView({
      store,
      tenantId,
      sourceId: crmSource.sourceId,
    });
    expect(view.capabilities.length).toBeGreaterThanOrEqual(2);
    expect(view.projectionSpecs.length).toBeGreaterThanOrEqual(1);
    expect(view.accessPolicies.length).toBeGreaterThanOrEqual(1);
    expect(view.boundOperationalIdentities).toEqual([]);
    expect(view.supplyHealth.status).toBe("connected");
    expect(view.supplyHealth.activeCompiledGrantCount).toBeGreaterThan(0);
  });

  it("decompiles seat policies to ConnectorAction@version in access governance matrix", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const entries = listAccessGovernanceMatrix({
      store,
      tenantId,
      dimension: "seat",
      targetId: "seat-sales-mgr-east",
    });
    expect(entries).toHaveLength(1);
    const policy = entries[0]?.policies[0];
    expect(policy?.runtimeActionRefs[0]).toEqual({
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    });
    expect(policy?.compilationSupported).toBe(true);
  });

  it("groups access policies by source dimension", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    const entries = listAccessGovernanceMatrix({
      store,
      tenantId,
      dimension: "source",
      targetId: crmSource.sourceId,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.policies.length).toBeGreaterThan(0);
    expect(entries[0]?.source?.sourceKey).toBe("crm-salesforce");
  });

  it("resolves target seat into runtime action refs and compiled grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const resolved = resolveAccessGovernanceTarget({
      store,
      tenantId,
      targetKind: "seat",
      targetId: "seat-sales-mgr-east",
    });
    expect(resolved.runtimeActionRefs[0]?.actionKey).toBe("crm.customer.read_summary");
    expect(resolved.runtimeActionRefs[0]?.version).toBe("v1");
    expect(resolved.compiledGrants.length).toBeGreaterThan(0);
    expect(resolved.compiledGrants[0]?.dataAccessPolicyId).toBeTruthy();
  });

  it("compiles a seat DataAccessPolicy into a SeatActionGrant bound to Scope and Approval", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    const policy = Object.values(store.dataAccessPolicies).find(
      (item) => item.targetId === "seat-sales-mgr-east",
    )!;
    const grant = store.seatActionGrants[policy.compiledGrantIds[0] ?? ""];
    expect(crmSource.sourceId).not.toBe(crmSource.connectorId);
    expect(policy.scopePolicyId).toBe("scope-self-default");
    expect(policy.approvalPolicyId).toBe("policy-none-default");
    expect(grant?.seatId).toBe("seat-sales-mgr-east");
    expect(grant?.connectorId).toBe("crm-salesforce");
    expect(grant?.actionKey).toBe("crm.customer.read_summary");
    expect(grant?.version).toBe("v1");
    expect(grant?.scopePolicyId).toBe("scope-self-default");
    expect(grant?.approvalPolicyId).toBe("policy-none-default");
    expect(grant?.dataAccessPolicyId).toBe(policy.policyId);
  });

  it("archives DataAccessPolicy and revokes compiled grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const policy = Object.values(store.dataAccessPolicies).find(
      (item) => item.targetId === "seat-sales-mgr-east",
    )!;
    const grantId = policy.compiledGrantIds[0];
    const archived = archiveDataAccessPolicy({
      store,
      tenantId,
      policyId: policy.policyId,
      nowIso: "2026-06-05T13:00:00.000Z",
    });
    expect(archived.enabled).toBe(false);
    expect(archived.compiledGrantIds).toEqual([]);
    expect(store.seatActionGrants[grantId]?.revokedAt).toBe("2026-06-05T13:00:00.000Z");
  });

  it("rejects DataSource upsert when connector has no registered actions", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    expect(() =>
      upsertDataSource({
        store,
        tenantId,
        nowIso,
        source: {
          sourceKey: "orphan-source",
          displayName: "Orphan",
          category: "external",
          status: "connected",
          connectorId: "missing-connector",
        },
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("allows department and role policies to register without compiling", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const departmentPolicy = upsertDataAccessPolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        displayName: "Sales department read",
        targetKind: "department",
        targetId: "dept-sales-east",
        actionRefs: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v1",
          },
        ],
        enabled: true,
      },
    });
    expect(departmentPolicy.targetKind).toBe("department");
    expect(departmentPolicy.compiledGrantIds).toEqual([]);
    expect(() =>
      compileDataAccessPolicy({
        store,
        tenantId,
        policyId: departmentPolicy.policyId,
        nowIso: "2026-06-05T13:00:00.000Z",
      }),
    ).toThrowError(/registration-only/);
    const roleEntries = listAccessGovernanceMatrix({
      store,
      tenantId,
      dimension: "department",
      targetId: "dept-sales-east",
    });
    expect(roleEntries[0]?.policies[0]?.compilationSupported).toBe(false);
  });

  it("does not attribute projections to DataSource via connectorId alone", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const primarySource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    const siblingSource = upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceKey: "crm-salesforce-sandbox",
        displayName: "Salesforce Sandbox",
        category: "crm",
        status: "connected",
        connectorId: "crm-salesforce",
      },
    });
    const sandboxCapability = upsertDataCapability({
      store,
      tenantId,
      nowIso,
      capability: {
        capabilityKey: "sandbox.profile",
        displayName: "Sandbox Profile",
        description: "Sandbox-only capability",
        sourceIds: [siblingSource.sourceId],
        actionRefs: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v2",
          },
        ],
        enabled: true,
      },
    });
    upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "sandbox.profile",
        displayName: "Sandbox Profile Projection",
        category: "customer",
        capabilityId: sandboxCapability.capabilityId,
        sourceActions: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v2",
          },
        ],
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "Sandbox projection",
        outputSchema: {},
        lifecycle: "draft",
      },
    });
    const primaryView = resolveDataSourceGovernanceView({
      store,
      tenantId,
      sourceId: primarySource.sourceId,
    });
    const siblingView = resolveDataSourceGovernanceView({
      store,
      tenantId,
      sourceId: siblingSource.sourceId,
    });
    expect(
      primaryView.projectionSpecs.some((spec) => spec.projectionKey === "sandbox.profile"),
    ).toBe(false);
    expect(
      siblingView.projectionSpecs.some((spec) => spec.projectionKey === "sandbox.profile"),
    ).toBe(true);
  });

  it("archives DataSource by marking disconnected", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.sourceKey === "crm-salesforce",
    )!;
    const archived = archiveDataSource({
      store,
      tenantId,
      sourceId: crmSource.sourceId,
      nowIso: "2026-06-05T14:00:00.000Z",
    });
    expect(archived.status).toBe("disconnected");
    const overview = resolveAccessGovernanceOverview({ store, tenantId });
    expect(overview.connectedSourceCount).toBeLessThan(overview.dataSourceCount);
  });
});
