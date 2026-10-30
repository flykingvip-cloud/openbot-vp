// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { loadEnterpriseKnowledgeFeed } from "../knowledge/feed/enterprise-feed-adapter.js";
import { invokeDataCapabilityWithContext } from "./capability-agent-invoke-runtime.js";
import { EnterpriseDataStoreError, upsertConnectorAction } from "./connector-action-store.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { upsertDataSource } from "./data-source-store.js";
import {
  createTrustedExecutionContextForTest,
  MATERIALIZER_SEAT_ID,
} from "./enterprise-data-seat-context.js";
import { upsertEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import {
  assertWritableMaterializationMode,
  decideKnowledgePublication,
  eventDrivenMaterializationUnsupportedMessage,
  isImplementedMaterializationMode,
  lineageRecordsVerifiedSar,
  materializationModeHasScheduler,
  materializationModeSupportStatus,
} from "./knowledge-publication.js";
import { upsertKnowledgeVisibilityPolicy } from "./knowledge-visibility-policy-store.js";
import { ensureOnDemandProjectionsMaterialized } from "./on-demand-projection-materializer.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { runScheduledProjectionsForStore } from "./scheduled-projection-materializer.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore, KnowledgeLineageRecord } from "./types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-10-17T12:00:00.000Z";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const sarCapabilityId = "fixture.site.session.read";
const sarVersion = "2026.10.17";
const artifactDigest = "digest-verified-1";
const ownerA = "owner-a";
const ownerB = "owner-b";

function readResult(overrides: Partial<SiteRunResult> = {}): SiteRunResult {
  return {
    runId: "run-query-1",
    capabilityId: sarCapabilityId,
    version: sarVersion,
    status: "succeeded",
    verification: "passed",
    completeness: "complete",
    data: { customer: { id: "cust-q", name: "north-42" } },
    evidenceRef: "evidence-query-1",
    durationMs: 3,
    repair: "none",
    ...overrides,
  };
}

function installRead(store: EnterpriseDataStore) {
  upsertConnectorAction({
    store,
    tenantId,
    nowIso,
    action: {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      displayName: "网站会话读取",
      category: "external",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: { type: "object" },
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store,
    tenantId,
    nowIso,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    handlerRef: "enterprise-data/sar-bridge/read",
    readOnly: true,
  });
  upsertSeatActionGrant({
    store,
    tenantId,
    seatId: MATERIALIZER_SEAT_ID,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    scopePolicyId: "scope-team-default",
    approvalPolicyId: "policy-none-default",
    nowIso,
  });
}

function addWebsiteSource(store: EnterpriseDataStore, sourceId: string, bindingId: string) {
  return upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: sourceId,
      displayName: sourceId,
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId,
    },
  });
}

function addBridge(
  store: EnterpriseDataStore,
  sourceId: string,
  bindingId: string,
  userId: string,
  validator?: string,
) {
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId },
    bindingId,
  });
  return upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId,
      actionRef,
      capabilityId: sarCapabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId,
      userId,
      verification: "passed",
      validator,
      effect: "read",
      supportedScopeTypes: ["TEAM"],
      enforcedFilterFields: ["customer.owner_team"],
    },
  });
}

type SeenCall = { bindingId: string; userId: string; input?: Record<string, unknown> };

function providerFor(
  calls: SeenCall[],
  result: SiteRunResult | ((input?: Record<string, unknown>) => SiteRunResult),
): SarGovernanceProvider {
  return {
    async execute(input) {
      calls.push({ bindingId: input.bindingId, userId: input.userId, input: input.input });
      const resolved = typeof result === "function" ? result(input.input) : result;
      return { result: resolved, scopeEnforcedBeforeRead: true };
    },
  };
}

function websiteStore() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  installRead(store);
  addWebsiteSource(store, "src-a", "bind-a");
  addWebsiteSource(store, "src-b", "bind-b");
  addBridge(store, "src-a", "bind-a", ownerA, "reviewer-lin");
  addBridge(store, "src-b", "bind-b", ownerB, "reviewer-other");
  const capability = upsertDataCapability({
    store,
    tenantId,
    nowIso,
    capability: {
      capabilityKey: "site.session.query",
      displayName: "网站参数查询",
      description: "按参数读取已授权网站数据",
      sourceIds: ["src-a"],
      actionRefs: [actionRef],
      enabled: true,
    },
  });
  return { store, capability };
}

function projectionFor(
  store: EnterpriseDataStore,
  capabilityId: string,
  partialPublication?: "withhold" | "publish_marked",
  projectionKey = "site.session.query",
) {
  const spec = upsertEnterpriseKnowledgeProjectionSpec({
    store,
    tenantId,
    nowIso,
    spec: {
      projectionKey,
      displayName: "网站参数查询",
      category: "customer",
      capabilityId,
      sourceId: "src-a",
      partialPublication,
      sourceActions: [actionRef],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      description: "governed parameter query",
      outputSchema: { type: "object" },
      lifecycle: "active",
    },
  });
  const binding = upsertEnterpriseKnowledgeProjectionBinding({
    store,
    tenantId,
    nowIso,
    binding: {
      projectionId: spec.projectionId,
      capabilityId,
      materializationMode: "on_demand",
      materializationTeamLabel: "华北销售",
      enabled: true,
      generatorVersion: "e4-test",
    },
  });
  return { spec, binding };
}

describe("E4 knowledge publication", () => {
  it("treats event_driven as implemented (writable) but not a clock scheduler", () => {
    expect(isImplementedMaterializationMode("on_demand")).toBe(true);
    expect(isImplementedMaterializationMode("scheduled")).toBe(true);
    expect(isImplementedMaterializationMode("event_driven")).toBe(true);
    expect(materializationModeSupportStatus("event_driven")).toBe("implemented");
    expect(materializationModeHasScheduler("scheduled")).toBe(true);
    expect(materializationModeHasScheduler("event_driven")).toBe(false);
    expect(materializationModeHasScheduler("on_demand")).toBe(false);
    expect(() => assertWritableMaterializationMode("event_driven")).not.toThrow();
    // Migration helper copy remains available for operators who prefer scheduled/on_demand.
    expect(eventDrivenMaterializationUnsupportedMessage()).toContain("projection-bindings.upsert");

    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "customer.event-only",
        displayName: "事件枚举",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceActions: capability.actionRefs.slice(0, 1),
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "event-driven writable",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    const binding = upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso,
      binding: {
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "event_driven",
        materializationTeamLabel: "华北销售",
        enabled: true,
        generatorVersion: "e4-test",
      },
    });
    expect(binding.materializationMode).toBe("event_driven");
    // Creating the binding alone must not invent feed items (no fake availability).
    expect(
      listKnowledgeFeedItems({ store, tenantId }).some(
        (item) => item.projectionId === spec.projectionId,
      ),
    ).toBe(false);
  });

  it("migrates legacy event_driven rows to scheduled or on_demand", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "customer.event-migrate",
        displayName: "事件迁移",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceActions: capability.actionRefs.slice(0, 1),
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "legacy row",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    const legacyId = "binding-event-driven-legacy";
    store.enterpriseKnowledgeProjectionBindings[legacyId] = {
      bindingId: legacyId,
      tenantId,
      projectionId: spec.projectionId,
      capabilityId: capability.capabilityId,
      materializationMode: "event_driven",
      materializationTeamLabel: "华北销售",
      enabled: true,
      generatorVersion: "e4-test",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    expect(materializationModeSupportStatus("event_driven")).toBe("implemented");

    const migrated = upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso: "2026-10-30T09:00:00.000Z",
      binding: {
        bindingId: legacyId,
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "scheduled",
        materializationTeamLabel: "华北销售",
        enabled: true,
        generatorVersion: "e4-test",
      },
    });
    expect(migrated.materializationMode).toBe("scheduled");
    expect(migrated.bindingId).toBe(legacyId);
    expect(isImplementedMaterializationMode(migrated.materializationMode)).toBe(true);

    const toOnDemand = upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso: "2026-10-30T09:01:00.000Z",
      binding: {
        bindingId: legacyId,
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "on_demand",
        materializationTeamLabel: "华北销售",
        enabled: true,
        generatorVersion: "e4-test",
      },
    });
    expect(toOnDemand.materializationMode).toBe("on_demand");
  });

  it("does not materialize an event_driven binding from on-demand or scheduled dispatch", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    )!;
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "customer.event-skip",
        displayName: "事件不调度",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceActions: capability.actionRefs.slice(0, 1),
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "no scheduler",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    // Binding may also be created via upsert now that event_driven is implemented.
    store.enterpriseKnowledgeProjectionBindings["binding-event-skip"] = {
      bindingId: "binding-event-skip",
      tenantId,
      projectionId: spec.projectionId,
      materializationMode: "event_driven",
      materializationTeamLabel: "华东销售",
      enabled: true,
      generatorVersion: "e4-test",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await ensureOnDemandProjectionsMaterialized({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        hasEnterpriseScope: true,
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
        agentType: "employee-agent",
      },
      nowIso,
    });
    await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: {
        lastRunByBindingId: {},
        lastFailureByBindingId: {},
        failureCountByBindingId: {},
      },
    });
    expect(
      listKnowledgeFeedItems({ store, tenantId }).some(
        (item) => item.projectionId === spec.projectionId,
      ),
    ).toBe(false);
  });

  it("publishes a parameter query through the governance path and lets an agent read only the knowledge object", async () => {
    const { store, capability } = websiteStore();
    const { binding } = projectionFor(store, capability.capabilityId);
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: "seat-reader",
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      nowIso,
    });
    const policy = upsertKnowledgeVisibilityPolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        projectionId: binding.projectionId,
        visibleSeats: ["seat-reader"],
        visibleTeams: [],
        visibleDepartments: [],
        visibleRoles: [],
        visibleAgentTypes: [],
      },
    });
    store.enterpriseKnowledgeProjectionBindings[binding.bindingId].visibilityPolicyId =
      policy.policyId;

    const calls: SeenCall[] = [];
    const provider = providerFor(calls, (input) =>
      readResult({
        data: {
          customer: {
            id: "cust-q",
            name: typeof input?.account === "string" ? input.account : "missing",
            rawSecret: "raw-row-secret",
          },
        },
      }),
    );
    const result = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      input: { account: "north-42" },
      sarProvider: provider,
      nowIso,
    });

    expect(calls).toEqual([
      { bindingId: "bind-a", userId: ownerA, input: { account: "north-42" } },
    ]);
    expect(calls[0]?.userId).not.toBe("system:projection-materializer");
    expect(result.feedItem.publication).toBe("complete");
    expect(result.feedItem.payload.query).toEqual({ account: "north-42" });
    expect(result.feedItem.title).toContain("画像");
    const customer = result.feedItem.payload.customer as { name?: string; rawSecret?: string };
    expect(customer.name).not.toBe("north-42");
    expect(customer.rawSecret).not.toBe("raw-row-secret");
    expect(result.lineage.sourceId).toBe("src-a");
    expect(result.lineage.sourceActions).toEqual(["site.session.read@v1"]);
    expect(result.lineage.sarCapabilityId).toBe(sarCapabilityId);
    expect(result.lineage.sarVersion).toBe(sarVersion);
    expect(result.lineage.sarRunId).toBe("run-query-1");
    expect(result.lineage.sarEvidenceRef).toBe("evidence-query-1");
    expect(result.lineage.validator).toBe("reviewer-lin");
    expect(result.lineage.sarVerification).toBe("passed");
    expect(result.lineage.sarCompleteness).toBe("complete");
    expect(lineageRecordsVerifiedSar(result.lineage)).toBe(true);
    expect(store.dataSources["src-a"]?.lastMaterializedAt).toBe(nowIso);
    expect(store.dataSources["src-b"]?.lastMaterializedAt).toBeUndefined();
    expect(store.dataSources["src-b"]?.materializationCount ?? 0).toBe(0);

    const granted = loadEnterpriseKnowledgeFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-reader",
        userId: "reader-user",
        hasEnterpriseScope: true,
        agentType: "employee-agent",
      },
    });
    const visible = granted.accessible.find((item) => item.projectionId === binding.projectionId);
    expect(visible?.publication).toBe("complete");
    expect(visible?.title).toContain("画像");
    expect(JSON.stringify(visible)).not.toContain("raw-row-secret");
    expect(JSON.stringify(visible)).not.toContain("north-42");
    const hidden = loadEnterpriseKnowledgeFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-other",
        userId: "other-user",
        hasEnterpriseScope: true,
        agentType: "employee-agent",
      },
    });
    expect(hidden.accessible.some((item) => item.projectionId === binding.projectionId)).toBe(
      false,
    );
    expect(hidden.restricted.some((item) => item.projectionId === binding.projectionId)).toBe(true);

    const auditPath = path.join(os.tmpdir(), `e4-capability-audit-${process.pid}.json`);
    const invoke = await invokeDataCapabilityWithContext({
      store,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId: "seat-reader",
        employeeId: "reader-user",
        userId: "reader-user",
      }),
      capabilityId: capability.capabilityId,
      input: { account: "bypass" },
      nowIso,
      auditStorePath: auditPath,
    });
    expect(invoke.ok).toBe(false);
    expect(invoke.reason).toBe("knowledge-object-only");
    expect(invoke.results).toBeUndefined();
    expect(calls).toHaveLength(1);
    fs.rmSync(auditPath, { force: true });
  });

  it("does not let an admin identity read the other private account", async () => {
    const { store, capability } = websiteStore();
    const { binding } = projectionFor(store, capability.capabilityId);
    const calls: SeenCall[] = [];
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      input: { account: "north-42" },
      sarProvider: providerFor(calls, readResult()),
      nowIso,
    });
    expect(calls.map((call) => call.bindingId)).toEqual(["bind-a"]);
    expect(calls[0]?.userId).toBe(ownerA);
    expect(calls[0]?.userId).not.toBe(ownerB);
  });

  it("rejects write actions, unverified output, and failed output from complete knowledge objects", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    store.connectorActions["act-write-note"] = {
      actionId: "act-write-note",
      tenantId,
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.write_note",
      version: "v1",
      displayName: "写备注",
      category: "crm",
      riskLevel: "HIGH",
      requiresApproval: true,
      readOnly: false,
      outputSchema: { type: "object" },
      lifecycle: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    expect(() =>
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "crm.write.bad",
          displayName: "写入投影",
          category: "customer",
          sourceActions: [
            { connectorId: "crm-salesforce", actionKey: "crm.customer.write_note", version: "v1" },
          ],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "writes stay out",
          outputSchema: { type: "object" },
          lifecycle: "active",
        },
      }),
    ).toThrow(EnterpriseDataStoreError);
    try {
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "crm.write.bad",
          displayName: "写入投影",
          category: "customer",
          sourceActions: [
            { connectorId: "crm-salesforce", actionKey: "crm.customer.write_note", version: "v1" },
          ],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "writes stay out",
          outputSchema: { type: "object" },
          lifecycle: "active",
        },
      });
    } catch (error) {
      expect((error as EnterpriseDataStoreError).code).toBe("PROJECTION_WRITE_ACTION_FORBIDDEN");
    }
    expect(Object.values(store.knowledgeFeedItems)).toHaveLength(0);

    const { store: siteStore, capability } = websiteStore();
    const { binding } = projectionFor(siteStore, capability.capabilityId);
    const secret = "unverified-row-secret";
    await expect(
      runProjectionMaterialization({
        store: siteStore,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: providerFor(
          [],
          readResult({
            verification: "not_performed",
            data: { customer: { name: secret } },
          }),
        ),
        nowIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_PUBLICATION_WITHHELD" });
    await expect(
      runProjectionMaterialization({
        store: siteStore,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: providerFor(
          [],
          readResult({
            status: "failed",
            verification: "failed",
            error: {
              code: "validation-failed",
              message: "validation failed",
              retry: "none",
              ordinaryFailure: true,
            },
            data: { customer: { name: secret } },
          }),
        ),
        nowIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_PUBLICATION_WITHHELD" });
    expect(
      listKnowledgeFeedItems({ store: siteStore, tenantId }).some(
        (item) => item.projectionId === binding.projectionId,
      ),
    ).toBe(false);
    expect(JSON.stringify(siteStore.knowledgeFeedItems)).not.toContain(secret);
  });

  it("publishes partial output only when the product policy is explicit and the marker is visible", async () => {
    const secret = "partial-row-secret";
    const { store, capability } = websiteStore();
    const withheld = projectionFor(store, capability.capabilityId);
    await expect(
      runProjectionMaterialization({
        store,
        tenantId,
        bindingId: withheld.binding.bindingId,
        sarProvider: providerFor(
          [],
          readResult({
            completeness: "partial",
            data: { customer: { id: "p1", name: "部分客户", rawSecret: secret } },
          }),
        ),
        nowIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_PUBLICATION_WITHHELD" });
    expect(
      listKnowledgeFeedItems({ store, tenantId, projectionId: withheld.spec.projectionId }),
    ).toHaveLength(0);

    const marked = projectionFor(
      store,
      capability.capabilityId,
      "publish_marked",
      "site.session.query.partial",
    );
    const published = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: marked.binding.bindingId,
      sarProvider: providerFor(
        [],
        readResult({
          completeness: "partial",
          runId: "run-partial-1",
          data: { customer: { id: "p1", name: "部分客户", rawSecret: secret } },
        }),
      ),
      nowIso,
    });
    expect(published.feedItem.publication).toBe("partial");
    expect(published.feedItem.publication).not.toBe("complete");
    expect(published.feedItem.title).toContain("不完整");
    expect(published.feedItem.payload.publicationNotice).toBe("不完整输出，不是完整知识对象");
    expect(lineageRecordsVerifiedSar(published.lineage)).toBe(false);
    const feed = loadEnterpriseKnowledgeFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-reader",
        userId: "reader-user",
        hasEnterpriseScope: true,
      },
    });
    const object = feed.accessible.find((item) => item.projectionId === marked.spec.projectionId);
    expect(object?.publication).toBe("partial");
    expect(object?.summary).toContain("不完整输出，不是完整知识对象");
    expect(object?.maskingSummary).toContain("不完整输出");
  });

  it("does not return partial rows on an employee denial", async () => {
    const { store } = websiteStore();
    const result = await invokeEnterpriseDataAction({
      store,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId: MATERIALIZER_SEAT_ID,
        employeeId: ownerA,
        userId: ownerA,
        teamLabel: "华北销售",
      }),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(
        [],
        readResult({
          completeness: "partial",
          data: [{ id: "partial-row-secret" }],
        }),
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SAR_OUTCOME_PRESERVED");
      expect(result.preservedPartial).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("partial-row-secret");
    }
  });

  it("does not treat an old lineage record as a verified website capability", () => {
    const legacy: KnowledgeLineageRecord = {
      lineageId: "old-1",
      tenantId,
      objectId: "obj-1",
      projectionId: "proj-1",
      sourceActions: ["crm.customer.read_summary@v1"],
      sourceTraceIds: ["trace-1"],
      generatedAt: nowIso,
      generatorVersion: "m4",
    };
    const reloaded = normalizeEnterpriseDataStore({
      knowledgeLineageRecords: { "old-1": legacy },
    }).knowledgeLineageRecords["old-1"];
    expect(reloaded?.sarVersion).toBeUndefined();
    expect(reloaded?.validator).toBeUndefined();
    expect(lineageRecordsVerifiedSar(reloaded)).toBe(false);
    expect(
      lineageRecordsVerifiedSar({
        ...legacy,
        sourceId: "src-a",
        sarCapabilityId,
        sarVersion,
        sarRunId: "run-1",
        sarVerification: "passed",
        sarCompleteness: "complete",
      }),
    ).toBe(false);
  });

  it("withholds a forged complete gateway success that is still partial", () => {
    const decision = decideKnowledgePublication({
      partialPublication: "publish_marked",
      response: {
        ok: true,
        traceId: "trace-1",
        source: "site-session",
        actionKey: actionRef.actionKey,
        version: actionRef.version,
        generatedAt: nowIso,
        data: { customer: { name: "forged" } },
        recordCount: 1,
        scopeApplied: "团队数据",
        masked: false,
        maskedFields: [],
        blockedFields: [],
        durationMs: 1,
        sar: {
          status: "succeeded",
          verification: "not_performed",
          completeness: "complete",
          runId: "run-1",
          evidenceRef: "evidence-1",
          capabilityId: sarCapabilityId,
          version: sarVersion,
          artifactDigest,
          retry: "none",
          ordinaryFailure: false,
        },
      },
    });
    expect(decision.kind).toBe("withhold");
  });

  it("requires an explicit website source and refuses a source outside the capability", () => {
    const { store, capability } = websiteStore();
    expect(() =>
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "site.missing.source",
          displayName: "缺源",
          category: "customer",
          capabilityId: capability.capabilityId,
          sourceActions: [actionRef],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "missing source",
          outputSchema: { type: "object" },
          lifecycle: "draft",
        },
      }),
    ).toThrow(expect.objectContaining({ code: "PROJECTION_SOURCE_REQUIRED" }));
    expect(() =>
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "site.other.source",
          displayName: "串源",
          category: "customer",
          capabilityId: capability.capabilityId,
          sourceId: "src-b",
          sourceActions: [actionRef],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "other private source",
          outputSchema: { type: "object" },
          lifecycle: "draft",
        },
      }),
    ).toThrow(expect.objectContaining({ code: "PROJECTION_SOURCE_NOT_IN_CAPABILITY" }));
  });
});
