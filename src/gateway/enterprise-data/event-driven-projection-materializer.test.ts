// @vitest-environment node
/**
 * P1-F: event_driven bindings materialize on matching ingest events (not on
 * on_demand/scheduled dispatch). Minimal honest path — not a full KB claim.
 */
import { describe, expect, it } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { upsertEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import { runEventDrivenProjectionsForEvent } from "./event-driven-projection-materializer.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { ensureOnDemandProjectionsMaterialized } from "./on-demand-projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { runScheduledProjectionsForStore } from "./scheduled-projection-materializer.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-10-30T12:00:00.000Z";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const sarCapabilityId = "fixture.site.session.read";
const sarVersion = "2026.10.17";
const artifactDigest = "digest-verified-1";
const ownerA = "owner-a";

function readResult(overrides: Partial<SiteRunResult> = {}): SiteRunResult {
  return {
    runId: "run-event-1",
    capabilityId: sarCapabilityId,
    version: sarVersion,
    status: "succeeded",
    verification: "passed",
    completeness: "complete",
    data: { customer: { id: "cust-e", name: "event-42" } },
    evidenceRef: "evidence-event-1",
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

function providerFor(calls: Array<{ bindingId: string; userId: string }>): SarGovernanceProvider {
  return {
    async execute(input) {
      calls.push({ bindingId: input.bindingId, userId: input.userId });
      return { result: readResult(), scopeEnforcedBeforeRead: true };
    },
  };
}

function seedEventDrivenStore() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  installRead(store);
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId: "src-a",
      sourceKey: "src-a",
      displayName: "src-a",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId: "bind-a",
    },
  });
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId: ownerA },
    bindingId: "bind-a",
  });
  upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId: "src-a",
      actionRef,
      capabilityId: sarCapabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId: "bind-a",
      userId: ownerA,
      verification: "passed",
      validator: "reviewer-lin",
      effect: "read",
      supportedScopeTypes: ["TEAM"],
      enforcedFilterFields: ["customer.owner_team"],
    },
  });
  const capability = upsertDataCapability({
    store,
    tenantId,
    nowIso,
    capability: {
      capabilityKey: "site.session.query.event",
      displayName: "网站参数查询",
      description: "event path",
      sourceIds: ["src-a"],
      actionRefs: [actionRef],
      enabled: true,
    },
  });
  const spec = upsertEnterpriseKnowledgeProjectionSpec({
    store,
    tenantId,
    nowIso,
    spec: {
      projectionKey: "site.session.query.event",
      displayName: "事件物化",
      category: "customer",
      capabilityId: capability.capabilityId,
      sourceId: "src-a",
      sourceActions: [actionRef],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      description: "event-driven",
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
      generatorVersion: "p1f-event",
    },
  });
  return { store, spec, binding };
}

describe("P1-F event-driven projection materializer", () => {
  it("materializes matching event_driven bindings on event ingest (not on demand/scheduled)", async () => {
    const { store, spec, binding } = seedEventDrivenStore();
    const calls: Array<{ bindingId: string; userId: string }> = [];
    const sarProvider = providerFor(calls);

    await ensureOnDemandProjectionsMaterialized({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        hasEnterpriseScope: true,
        teamLabel: "华北销售",
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
    expect(calls).toHaveLength(0);

    const wrongSource = await runEventDrivenProjectionsForEvent({
      store,
      tenantId,
      event: { eventId: "evt-other", sourceId: "src-other", tenantId },
      nowIso,
      sarProvider,
    });
    expect(wrongSource.attempted).toBe(0);
    expect(calls).toHaveLength(0);

    const result = await runEventDrivenProjectionsForEvent({
      store,
      tenantId,
      event: { eventId: "evt-1", sourceId: "src-a", tenantId },
      nowIso,
      sarProvider,
    });
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.attempts[0]?.bindingId).toBe(binding.bindingId);
    expect(calls.length).toBeGreaterThan(0);
    expect(
      listKnowledgeFeedItems({ store, tenantId }).some(
        (item) => item.projectionId === spec.projectionId,
      ),
    ).toBe(true);
  });

  it("skips when tenant on event does not match store tenant", async () => {
    const { store } = seedEventDrivenStore();
    const result = await runEventDrivenProjectionsForEvent({
      store,
      tenantId,
      event: { eventId: "evt-x", sourceId: "src-a", tenantId: "other-tenant" },
      nowIso,
      sarProvider: providerFor([]),
    });
    expect(result.attempted).toBe(0);
  });
});
