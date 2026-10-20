import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnterpriseDataStoreError,
  findConnectorAction,
  listConnectorActions,
  upsertConnectorAction,
} from "./connector-action-store.js";
import { compileDataAccessPolicy, resolveCompiledActionRefs } from "./data-access-policy-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { findRuntimeRegistryEntry, resolveRuntimeHandler } from "./runtime-registry.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: path.join(os.tmpdir(), "openbot-enterprise-data-test"),
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";
const mockedConfigDir = path.join(os.tmpdir(), "openbot-enterprise-data-test");

function cleanStore() {
  fs.rmSync(mockedConfigDir, { recursive: true, force: true });
  fs.mkdirSync(mockedConfigDir, { recursive: true });
}

describe("enterprise-data governance & supply (M1 realignment)", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("keeps crm.customer.read_summary@v1 and @v2 active together", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const actions = listConnectorActions({ store, tenantId, connectorId: "crm-salesforce" });
    const summaries = actions.filter((action) => action.actionKey === "crm.customer.read_summary");
    expect(summaries.map((action) => action.version).toSorted()).toEqual(["v1", "v2"]);
    await saveEnterpriseDataStore(store);
    const reloaded = await loadEnterpriseDataStore();
    expect(
      listConnectorActions({ store: reloaded, tenantId, connectorId: "crm-salesforce" }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("models DataSource separately from Connector", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const crmSource = Object.values(store.dataSources).find(
      (source) => source.tenantId === tenantId && source.sourceKey === "crm-salesforce",
    );
    expect(crmSource?.connectorId).toBe("crm-salesforce");
    expect(crmSource?.sourceId).toBeTruthy();
    expect(crmSource?.sourceId).not.toBe(crmSource?.connectorId);
  });

  it("binds DataCapability actionRefs as real execution source", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    );
    expect(capability?.actionRefs[0]).toEqual({
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    });
    expect(capability?.sourceIds.length).toBe(1);
    const source = findDataSource(store, tenantId, capability!.sourceIds[0]);
    expect(source?.category).toBe("crm");
  });

  it("compiles DataAccessPolicy into SeatActionGrant", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const policy = Object.values(store.dataAccessPolicies).find(
      (item) => item.targetId === "seat-sales-mgr-east",
    );
    expect(policy?.compiledGrantIds.length).toBeGreaterThan(0);
    const grant = store.seatActionGrants[policy!.compiledGrantIds[0]];
    expect(grant?.dataAccessPolicyId).toBe(policy?.policyId);
    expect(grant?.actionKey).toBe("crm.customer.read_summary");
    expect(grant?.version).toBe("v1");
    const actionRefs = resolveCompiledActionRefs(store, tenantId, policy!.policyId);
    expect(actionRefs[0]?.version).toBe("v1");
  });

  it("rejects runtime resolution for unregistered actions", () => {
    const store = normalizeEnterpriseDataStore(null);
    upsertConnectorAction({
      store,
      tenantId,
      nowIso,
      action: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v9",
        displayName: "orphan",
        category: "crm",
        riskLevel: "LOW",
        requiresApproval: false,
        readOnly: true,
        outputSchema: {},
        lifecycle: "active",
      },
    });
    expect(() =>
      resolveRuntimeHandler(store, tenantId, {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v9",
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("links ProjectionSpec to DataCapability and validates sourceActions", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = findDataCapability(
      store,
      tenantId,
      Object.values(store.dataCapabilities).find(
        (item) => item.capabilityKey === "customer.profile",
      )!.capabilityId,
    );
    expect(() =>
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "invalid.ref",
          displayName: "invalid",
          category: "customer",
          capabilityId: capability!.capabilityId,
          sourceActions: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v9",
            },
          ],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "bad ref",
          outputSchema: {},
          lifecycle: "draft",
        },
      }),
    ).toThrowError(EnterpriseDataStoreError);
    const profileSpec = Object.values(store.enterpriseKnowledgeProjectionSpecs).find(
      (spec) => spec.projectionKey === "customer.profile",
    );
    expect(profileSpec?.capabilityId).toBe(capability?.capabilityId);
    expect(profileSpec?.sourceActions[0]?.version).toBe("v1");
  });

  it("rejects ProjectionSpec without explicit sourceActions", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = findDataCapability(
      store,
      tenantId,
      Object.values(store.dataCapabilities).find(
        (item) => item.capabilityKey === "customer.profile",
      )!.capabilityId,
    );
    expect(() =>
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "missing.actions",
          displayName: "missing",
          category: "customer",
          capabilityId: capability!.capabilityId,
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "no explicit sourceActions",
          outputSchema: {},
          lifecycle: "draft",
          sourceActions: [],
        },
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("stores EnterpriseKnowledgeProjectionBinding (governance view layer)", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = Object.values(store.enterpriseKnowledgeProjectionBindings)[0];
    expect(binding?.materializationMode).toBeTruthy();
    expect(binding?.generatorVersion).toBe("1.0.0");
    expect(binding?.freshnessSlaMinutes).toBeGreaterThan(0);
  });

  it("binds seat grants to exact versions independently", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const v2Grant = upsertSeatActionGrant({
      store,
      tenantId,
      seatId: "seat-sales-director",
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v2",
      nowIso,
    });
    expect(v2Grant.version).toBe("v2");
    expect(
      findConnectorAction(store, tenantId, {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      })?.version,
    ).toBe("v1");
    expect(
      findRuntimeRegistryEntry(store, tenantId, {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v2",
      })?.handlerRef,
    ).toContain("v2");
  });

  it("recompiles access policy and revokes stale grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const policy = Object.values(store.dataAccessPolicies)[0];
    const firstGrantId = policy.compiledGrantIds[0];
    const result = compileDataAccessPolicy({
      store,
      tenantId,
      policyId: policy.policyId,
      nowIso: "2026-06-05T13:00:00.000Z",
    });
    expect(result.grants.length).toBeGreaterThan(0);
    expect(store.seatActionGrants[firstGrantId]?.revokedAt).toBeTruthy();
  });
});
