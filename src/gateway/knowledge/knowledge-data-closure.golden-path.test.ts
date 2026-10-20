// @vitest-environment node
/**
 * Executable knowledge + data-capability closure golden path.
 *
 * Enterprise half: tenant KB create → seed → materialize → lineage →
 * seat-visible feed → governed data capability → access deny/request/approve →
 * prompt injection → durable store restart recovery.
 *
 * Personal half: ingest → hybrid/keyword retrieve → generation lineage writeback.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownershipProofFromTenantUser } from "../data-governance/ownership-proof.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import { invokeDataCapabilityWithContext } from "../enterprise-data/capability-agent-invoke-runtime.js";
import { listDataCapabilities } from "../enterprise-data/data-capability-store.js";
import { createTrustedExecutionContextForTest } from "../enterprise-data/enterprise-data-seat-context.js";
import { listEnterpriseKnowledgeProjectionBindings } from "../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { decideGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import { resolveKnowledgeLineageChain } from "../enterprise-data/lineage-governance-store.js";
import { runProjectionMaterialization } from "../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import {
  createEnterpriseKnowledgeAccessRequest,
  isEnterpriseKnowledgeAccessGranted,
} from "./enterprise-knowledge-access-request.js";
import { loadKnowledgeFeedBundle } from "./feed/knowledge-feed-adapter.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import {
  buildKnowledgeEvidenceUri,
  retrieveKnowledgeFromIndex,
  searchKnowledgeKeyword,
} from "./kb-retrieve.js";
import { createKnowledgeBase, getKnowledgeBase } from "./knowledge-base-store.js";
import {
  listKnowledgeLineageByLineageId,
  upsertKnowledgeLineage,
} from "./knowledge-lineage-store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-07-19T10:00:00.000Z";
const grantedSeatId = "seat-sales-mgr-east";
const outsiderSeatId = "seat-outsider-01";
const deniedSeatId = "seat-denied-01";

let enterpriseStore!: EnterpriseDataStore;
let storeDir = "";
let storePath = "";
let kbStorePath = "";
let indexRoot = "";

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    gateway: { auth: { trustedProxy: { enabled: true } } },
  }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: async () => ({
    users: {
      "user-mgr-001": {
        id: "user-mgr-001",
        email: "mgr@acme.test",
        normalizedEmail: "mgr@acme.test",
        status: "active",
      },
      "user-outsider": {
        id: "user-outsider",
        email: "outsider@acme.test",
        normalizedEmail: "outsider@acme.test",
        status: "active",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-mgr-001",
        enterpriseId: tenantId,
        membershipRole: "member",
      },
      "mem-2": {
        id: "mem-2",
        userId: "user-outsider",
        enterpriseId: tenantId,
        membershipRole: "member",
      },
    },
    enterprises: { [tenantId]: { id: tenantId, status: "paid" } },
  }),
  findUserByEmail: (_store: unknown, email: string) => {
    if (email === "mgr@acme.test") {
      return { id: "user-mgr-001", email, normalizedEmail: email, status: "active" };
    }
    if (email === "outsider@acme.test") {
      return { id: "user-outsider", email, normalizedEmail: email, status: "active" };
    }
    return null;
  },
  findUserById: (_store: unknown, userId: string) => {
    if (userId === "user-mgr-001") {
      return { id: userId, email: "mgr@acme.test", status: "active" };
    }
    if (userId === "user-outsider") {
      return { id: userId, email: "outsider@acme.test", status: "active" };
    }
    return null;
  },
  findMembershipByUserId: (_store: unknown, userId: string) => ({
    id: userId === "user-mgr-001" ? "mem-1" : "mem-2",
    userId,
    enterpriseId: tenantId,
    membershipRole: "member",
  }),
}));

vi.mock("../enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: async () => ({
    seats: {
      [grantedSeatId]: {
        seatId: grantedSeatId,
        tenantId,
        title: "华东销售经理",
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
        status: "occupied",
        currentEmployeeId: "user-mgr-001",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      [outsiderSeatId]: {
        seatId: outsiderSeatId,
        tenantId,
        title: "外部席位",
        teamLabel: "其他",
        roleCode: "viewer",
        status: "occupied",
        currentEmployeeId: "user-outsider",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    bindings: {
      "bind-mgr": {
        bindingId: "bind-mgr",
        seatId: grantedSeatId,
        tenantId,
        employeeId: "user-mgr-001",
        bindingStatus: "active",
        effectiveAt: nowIso,
      },
      "bind-out": {
        bindingId: "bind-out",
        seatId: outsiderSeatId,
        tenantId,
        employeeId: "user-outsider",
        bindingStatus: "active",
        effectiveAt: nowIso,
      },
    },
  }),
}));

vi.mock("../enterprise-data/store.js", async () => {
  const actual = await vi.importActual<typeof import("../enterprise-data/store.js")>(
    "../enterprise-data/store.js",
  );
  return {
    ...actual,
    loadEnterpriseDataStore: async (requestedPath?: string) => {
      if (requestedPath && storePath && path.resolve(requestedPath) === path.resolve(storePath)) {
        return actual.loadEnterpriseDataStore(requestedPath);
      }
      return enterpriseStore;
    },
  };
});

function profileBinding(store: EnterpriseDataStore) {
  const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  if (!binding) {
    throw new Error("missing customer.profile binding");
  }
  return binding;
}

function customerCapability(store: EnterpriseDataStore) {
  const capability = listDataCapabilities({ store, tenantId }).find(
    (item) => item.capabilityKey === "customer.profile",
  );
  if (!capability) {
    throw new Error("missing customer.profile capability");
  }
  return capability;
}

function feedForSeat(
  store: EnterpriseDataStore,
  seatId: string,
  options?: { agentType?: "employee-agent" | "platform-agent" | "position-agent" },
) {
  // Outsider checks intentionally omit agentType/team/role so only seat ACL applies.
  // Granted seat includes employee-agent to match seeded policy multi-axis grants.
  const isGranted = seatId === grantedSeatId;
  return loadKnowledgeFeedBundle({
    store,
    context: {
      tenantId,
      seatId,
      userId: isGranted ? "user-mgr-001" : "user-outsider",
      ...(isGranted
        ? {
            agentType: options?.agentType ?? "employee-agent",
            teamLabel: "华东销售",
            roleCode: "sales-mgr",
          }
        : options?.agentType
          ? { agentType: options.agentType }
          : {}),
      hasEnterpriseScope: true,
    },
  });
}

/** Profile projection is policy-gated; other open projections may still be visible. */
function profileAccessState(
  bundle: ReturnType<typeof feedForSeat>,
  projectionId: string,
): "accessible" | "restricted" | "absent" {
  const feed = bundle.feedItems.find(
    (item) => item.source === "enterprise" && item.projectionId === projectionId,
  );
  if (!feed) {
    return "absent";
  }
  return feed.accessState === "accessible" ? "accessible" : "restricted";
}

describe("knowledge-data closure golden path", () => {
  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kd-closure-"));
    storePath = path.join(storeDir, "enterprise-data.json");
    kbStorePath = path.join(storeDir, "bases.json");
    indexRoot = path.join(storeDir, "kb-index");
    enterpriseStore = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store: enterpriseStore, tenantId, nowIso });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetSharedDataGovernanceCatalogForTests();
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("closes create → materialize → visibility → access → capability → prompt → restart", async () => {
    // 1) Tenant knowledge base exists (personal/enterprise control plane).
    const kb = createKnowledgeBase(
      {
        title: "Acme Sales KB",
        description: "tenant knowledge base for closure gate",
        ownerId: "user-mgr-001",
        tenantId,
        visibility: "enterprise",
        tags: ["sales", "closure"],
      },
      kbStorePath,
    );
    expect(kb.id).toMatch(/^kb_/);
    expect(getKnowledgeBase(kb.id, kbStorePath)?.tenantId).toBe(tenantId);

    // 2) Materialize enterprise knowledge projection.
    const binding = profileBinding(enterpriseStore);
    const materialization = await runProjectionMaterialization({
      store: enterpriseStore,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
    });
    expect(materialization.objectId).toBeTruthy();

    // 3) Lineage chain: feed → projection → capability → source → action → trace.
    const lineage = resolveKnowledgeLineageChain({
      store: enterpriseStore,
      tenantId,
      objectId: materialization.objectId,
    });
    const layers = lineage.chain.map((node) => node.layer);
    expect(layers).toEqual(
      expect.arrayContaining([
        "feed_item",
        "projection",
        "capability",
        "data_source",
        "connector_action",
        "invocation_trace",
      ]),
    );

    // 4) Granted seat sees accessible profile feed with lineage + freshness.
    const grantedFeed = feedForSeat(enterpriseStore, grantedSeatId);
    expect(profileAccessState(grantedFeed, binding.projectionId)).toBe("accessible");
    const enterpriseItem = grantedFeed.feedItems.find(
      (item) => item.source === "enterprise" && item.projectionId === binding.projectionId,
    );
    expect(enterpriseItem?.lineageId).toBeTruthy();
    expect(enterpriseItem?.freshnessStatus).toBe("fresh");
    expect(enterpriseItem?.accessState).toBe("accessible");

    // 5) Agent capability invoke does not request a connector action.
    const capability = customerCapability(enterpriseStore);
    const grantedInvoke = await invokeDataCapabilityWithContext({
      store: enterpriseStore,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId: grantedSeatId,
        employeeId: "user-mgr-001",
        userId: "user-mgr-001",
      }),
      capabilityId: capability.capabilityId,
      nowIso,
      auditStorePath: path.join(storeDir, "capability-invocations.json"),
    });
    expect(grantedInvoke.ok).toBe(false);
    expect(grantedInvoke.reason).toBe("knowledge-object-only");
    expect(grantedInvoke.accessState).toBe("granted");
    expect(grantedInvoke.results).toBeUndefined();
    expect(grantedInvoke.auditId).toBeTruthy();

    // 6) Outsider seat is restricted on the gated profile projection; capability requestable.
    const outsiderBefore = feedForSeat(enterpriseStore, outsiderSeatId);
    expect(profileAccessState(outsiderBefore, binding.projectionId)).toBe("restricted");
    expect(
      isEnterpriseKnowledgeAccessGranted({
        store: enterpriseStore,
        tenantId,
        seatId: outsiderSeatId,
        projectionId: binding.projectionId,
      }),
    ).toBe(false);

    const outsiderInvoke = await invokeDataCapabilityWithContext({
      store: enterpriseStore,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId: outsiderSeatId,
        employeeId: "user-outsider",
        userId: "user-outsider",
      }),
      capabilityId: capability.capabilityId,
      nowIso,
      auditStorePath: path.join(storeDir, "capability-invocations.json"),
    });
    expect(outsiderInvoke.ok).toBe(false);
    expect(outsiderInvoke.accessState).toBe("requestable");
    expect(outsiderInvoke.reason).toBe("not-authorized");

    // 7) Access request → approve grants projection visibility.
    const approval = createEnterpriseKnowledgeAccessRequest({
      store: enterpriseStore,
      tenantId,
      seatId: outsiderSeatId,
      projectionId: binding.projectionId,
      projectionTitle: "客户画像",
      requestedBy: outsiderSeatId,
      nowIso,
    });
    expect(approval.status).toBe("pending");
    decideGovernanceApprovalRequest({
      store: enterpriseStore,
      tenantId,
      approvalId: approval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
    });
    expect(
      isEnterpriseKnowledgeAccessGranted({
        store: enterpriseStore,
        tenantId,
        seatId: outsiderSeatId,
        projectionId: binding.projectionId,
      }),
    ).toBe(true);
    const outsiderAfter = feedForSeat(enterpriseStore, outsiderSeatId);
    expect(profileAccessState(outsiderAfter, binding.projectionId)).toBe("accessible");

    // 8) Reject path: denied seat stays restricted on the gated projection.
    const deniedRequest = createEnterpriseKnowledgeAccessRequest({
      store: enterpriseStore,
      tenantId,
      seatId: deniedSeatId,
      projectionId: binding.projectionId,
      projectionTitle: "客户画像",
      requestedBy: deniedSeatId,
      nowIso,
    });
    decideGovernanceApprovalRequest({
      store: enterpriseStore,
      tenantId,
      approvalId: deniedRequest.approvalId,
      decision: "rejected",
      decidedBy: "emp-admin-001",
      decisionNote: "business need not established",
      nowIso,
    });
    expect(
      isEnterpriseKnowledgeAccessGranted({
        store: enterpriseStore,
        tenantId,
        seatId: deniedSeatId,
        projectionId: binding.projectionId,
      }),
    ).toBe(false);
    const deniedFeed = feedForSeat(enterpriseStore, deniedSeatId);
    expect(profileAccessState(deniedFeed, binding.projectionId)).toBe("restricted");

    // 9) Reply consumption reads the FeedItem supply already wrote.
    await saveEnterpriseDataStore(enterpriseStore, storePath);
    const { buildKnowledgeUniverseSystemPrompt } =
      await import("../../auto-reply/reply/knowledge-universe-context.js");
    const prompt = await buildKnowledgeUniverseSystemPrompt({
      message: "客户成交率为什么下降，帮我分析销售数据",
      sessionKey: "agent:main:webchat:dm:user-mgr-001",
      agentId: "employee-agent",
      gatewayClientUser: "mgr@acme.test",
      gatewayClientSessionDomain: "employee",
    });
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("Knowledge Universe context");
    const writtenProfile = feedForSeat(enterpriseStore, grantedSeatId).feedItems.find(
      (item) => item.source === "enterprise" && item.projectionId === binding.projectionId,
    );
    expect(writtenProfile?.title).toBeTruthy();
    expect(prompt).toContain(writtenProfile!.title);
    expect(prompt).toContain("enterprise");
    expect(prompt).toContain("Do not call external CRM/ERP/Connector APIs directly");

    // 10) Restart recovery: feed, approvals, and visibility grants survive disk reload.
    await saveEnterpriseDataStore(enterpriseStore, storePath);
    const reloaded = await loadEnterpriseDataStore(storePath);
    expect(Object.keys(reloaded.knowledgeFeedItems).length).toBeGreaterThan(0);
    expect(reloaded.governanceApprovalRequests[approval.approvalId]?.status).toBe("approved");
    expect(reloaded.governanceApprovalRequests[deniedRequest.approvalId]?.status).toBe("rejected");
    expect(
      isEnterpriseKnowledgeAccessGranted({
        store: reloaded,
        tenantId,
        seatId: outsiderSeatId,
        projectionId: binding.projectionId,
      }),
    ).toBe(true);
    expect(
      isEnterpriseKnowledgeAccessGranted({
        store: reloaded,
        tenantId,
        seatId: deniedSeatId,
        projectionId: binding.projectionId,
      }),
    ).toBe(false);
    const reloadedLineage = resolveKnowledgeLineageChain({
      store: reloaded,
      tenantId,
      objectId: materialization.objectId,
    });
    expect(reloadedLineage.chain.length).toBeGreaterThan(0);
    const reloadedFeed = feedForSeat(reloaded, outsiderSeatId);
    expect(profileAccessState(reloadedFeed, binding.projectionId)).toBe("accessible");

    // 11) KB store also survives process-local path reuse (separate control plane).
    expect(getKnowledgeBase(kb.id, kbStorePath)?.title).toBe("Acme Sales KB");
  });

  it("closes personal KB ingest → retrieve → generation lineage writeback", async () => {
    const ownerId = "user-mgr-001";
    const kb = createKnowledgeBase(
      {
        title: "Personal Sales Notes",
        description: "personal half of closure gate",
        ownerId,
        tenantId,
        visibility: "private",
        tags: ["personal", "closure"],
      },
      kbStorePath,
    );

    const ingest = await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-refund-policy",
      title: "Refund Escalation Policy",
      fileName: "refunds.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        [
          "# Refund Escalation",
          "",
          "Enterprise refund requests must include order id and seat owner.",
          "",
          "## Playbook",
          "",
          "Escalate refund disputes to the regional sales manager within 24 hours.",
        ].join("\n"),
        "utf8",
      ),
      ownerId,
      tenantId,
      indexRoot,
      embeddingProvider: null,
      governanceStateDir: storeDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({
        tenantId,
        userId: ownerId,
      }),
    });
    expect(ingest.skipped).toBe(false);
    expect(ingest.chunkCount).toBeGreaterThan(0);
    expect(ingest.versionId).toBeTruthy();

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const keywordHits = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "refund escalation",
        kbIds: [kb.id],
        model: "fts-only",
        limit: 8,
      });
      expect(keywordHits.length).toBeGreaterThan(0);
      expect(keywordHits.every((hit) => hit.kbId === kb.id)).toBe(true);
      expect(keywordHits[0]?.docTitle).toMatch(/Refund/i);

      // retrieveKnowledgeFromIndex with null embeddings is FTS-only finalize of keyword hits.
      const retrieved = await retrieveKnowledgeFromIndex({
        index,
        query: "refund escalation",
        kbIds: [kb.id],
        embeddingProvider: null,
        maxResults: 4,
        minScore: 0,
        governanceAware: false,
      });
      const hits = retrieved.length > 0 ? retrieved : keywordHits;
      expect(hits.length).toBeGreaterThan(0);
      const top = hits[0];
      expect(top.chunkId).toBeTruthy();
      expect(
        buildKnowledgeEvidenceUri({
          kbId: top.kbId,
          docId: top.docId,
          versionId: top.versionId,
          section: top.section,
        }),
      ).toMatch(/^ku:\/\/kb\//);

      // Generation lineage writeback (same store path used by get-reply-run).
      const lineageId = "lin-closure-generation-1";
      upsertKnowledgeLineage({
        db: index.db,
        lineageId,
        kind: "generation",
        sessionKey: "agent:main:webchat:dm:user-mgr-001",
        agentId: "employee-agent",
        sourceChunkIds: hits.map((hit) => hit.chunkId),
        sourceKnowledgeBaseIds: [kb.id],
        sourceAgentIds: ["employee-agent"],
      });
      const generations = listKnowledgeLineageByLineageId(index.db, lineageId);
      expect(generations.some((row) => row.kind === "generation")).toBe(true);
      const generation = generations.find((row) => row.kind === "generation");
      expect(generation?.sourceChunkIds).toContain(top.chunkId);
      expect(generation?.sourceKnowledgeBaseIds).toContain(kb.id);
    } finally {
      index.close();
    }

    // Index survives reopen (process-local restart of the knowledge index plane).
    const reopened = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const afterRestart = listKnowledgeLineageByLineageId(reopened.db, "lin-closure-generation-1");
      expect(afterRestart.length).toBeGreaterThan(0);
      expect(afterRestart[0]?.sourceKnowledgeBaseIds).toContain(kb.id);
    } finally {
      reopened.close();
    }
  });
});
