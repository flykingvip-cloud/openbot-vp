/**
 * P4 Gate contract tests: search ACL/archive policy, memory admission/revoke,
 * retention legal hold, export digest hygiene.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  archiveConversation,
  authorizeConversationAction,
  buildDefaultRetentionPolicy,
  createConversation,
  detectAdmissionSignals,
  evaluateConversationRetention,
  evaluateMemoryAdmission,
  evaluateSourceRevocation,
  exportConversationService,
  isAtomVisibleInScope,
  requestConversationPurge,
  resetConversationCatalogCache,
  resolveConversationTenantContext,
  searchConversations,
  searchConversationsService,
  SqliteConversationCatalog,
  resolveConversationCatalogPath,
  transitionMemoryLifecycle,
  type ConversationTenantContext,
} from "./index.js";

describe("conversation lifecycle P4 gate", () => {
  const tmpRoots: string[] = [];
  const prevState = process.env.OPENCLAW_STATE_DIR;

  afterEach(async () => {
    resetConversationCatalogCache();
    if (prevState === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevState;
    }
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function setup(): {
    dataRoot: string;
    cfg: OpenBotConfig;
    ctx: ConversationTenantContext;
  } {
    const root = path.join(
      os.tmpdir(),
      `openbot-p4g-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(root);
    const dataRoot = path.join(root, "data");
    process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const ctx = resolveConversationTenantContext({
      cfg,
      principalId: "user-p4",
    });
    return { dataRoot, cfg, ctx };
  }

  describe("CL-P4-01 search", () => {
    it("filters by ACL before ranking and hides archived when policy disables archive search", async () => {
      const { cfg, ctx, dataRoot } = setup();
      const a = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Budget review active",
      });
      const b = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Budget review archived",
      });
      // Append so archive has content
      const liveB = path.join(
        process.env.OPENCLAW_STATE_DIR!,
        "agents",
        "helper",
        "sessions",
        `${b.binding.sessionId}.jsonl`,
      );
      await fs.appendFile(
        liveB,
        `${JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "budget" } })}\n`,
      );
      await archiveConversation({
        deps: { cfg, ctx },
        conversationId: b.record.conversationId,
        etag: b.record.etag,
      });

      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });

      // Cross-tenant principal cannot see anything
      const other: ConversationTenantContext = {
        ...ctx,
        dataPlaneId: "dp_other_plane",
        principalId: "other",
      };
      const denied = await searchConversations({
        catalog,
        ctx: other,
        query: { query: "budget", agentId: "helper", archiveSearchEnabled: true },
      });
      expect(denied.hits).toHaveLength(0);

      // Default policy archiveSearchEnabled=false → archived excluded
      const defaultHits = await searchConversationsService({
        deps: { cfg, ctx },
        query: {
          query: "budget",
          agentId: "helper",
          includeArchived: true,
          lifecycleStatus: ["ACTIVE", "CLOSED", "ARCHIVED"],
        },
      });
      expect(defaultHits.hits.every((h) => h.lifecycleStatus !== "ARCHIVED")).toBe(true);
      expect(defaultHits.hits.some((h) => h.conversationId === a.record.conversationId)).toBe(true);

      // Policy opt-in includes archived
      const withArchive = await searchConversations({
        catalog,
        ctx,
        query: {
          query: "budget",
          agentId: "helper",
          lifecycleStatus: ["ACTIVE", "CLOSED", "ARCHIVED"],
          archiveSearchEnabled: true,
        },
      });
      expect(withArchive.hits.some((h) => h.conversationId === b.record.conversationId)).toBe(true);
      expect(withArchive.hits[0]?.deepLink?.conversationId).toBeTruthy();
      catalog.close();
    });

    it("does not double-count projection+transcript as full additive score", async () => {
      const { searchConversations: search } = await import("./search.js");
      // Unit: score helper path via full search with synthetic transcript hits
      const { cfg, ctx, dataRoot } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Alpha topic",
      });
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const base = await search({
        catalog,
        ctx,
        query: { query: "alpha", agentId: "helper" },
      });
      const withTranscript = await search({
        catalog,
        ctx,
        query: {
          query: "alpha",
          agentId: "helper",
          transcriptHits: [
            {
              conversationId: created.record.conversationId,
              sessionId: created.binding.sessionId,
              snippet: "alpha detail",
              score: 5,
            },
          ],
        },
      });
      const hit = withTranscript.hits.find(
        (h) => h.conversationId === created.record.conversationId,
      );
      expect(hit).toBeTruthy();
      // With content dedup, transcript 5 should dominate, not title+5 unbounded explode.
      expect(hit!.score).toBeLessThan(20);
      expect(hit!.score).toBeGreaterThanOrEqual(base.hits[0]?.score ?? 0);
      catalog.close();
    });
  });

  describe("CL-P4-02 memory admission / revocation", () => {
    it("blocks private-only signals from shared scope", () => {
      const signals = detectAdmissionSignals({
        text: "Please remember my home address",
        sourceIdentityIds: ["msrc_1"],
      });
      const decision = evaluateMemoryAdmission({
        text: "Please remember my home address",
        sourceIdentityIds: ["msrc_1"],
        signals,
        scopeVisibility: "shared",
      });
      expect(decision.admitted).toBe(false);
      expect(decision.reasonCode).toBe("SHARED_SCOPE_REQUIRES_GROUP_OR_ADMIN");
    });

    it("unique source revoke forgets atom; multi-source keeps atom", () => {
      const unique = evaluateSourceRevocation({
        remainingLiveSourceIds: ["msrc_only"],
        revokedSourceId: "msrc_only",
      });
      expect(unique.atomRetrievable).toBe(false);
      expect(unique.lifecycleState).toBe("forgotten");

      const multi = evaluateSourceRevocation({
        remainingLiveSourceIds: ["msrc_a", "msrc_b"],
        revokedSourceId: "msrc_a",
      });
      expect(multi.atomRetrievable).toBe(true);
      expect(multi.lifecycleState).toBe("active");
    });

    it("private atoms never visible in shared query scope", () => {
      expect(
        isAtomVisibleInScope({
          atomScopeVisibility: "private",
          queryScopeVisibility: "shared",
        }),
      ).toBe(false);
      expect(
        isAtomVisibleInScope({
          atomScopeVisibility: "shared",
          queryScopeVisibility: "shared",
        }),
      ).toBe(true);
    });

    it("lifecycle transitions admit → active → forget", () => {
      expect(transitionMemoryLifecycle({ current: "candidate", event: "admit" })).toBe("admitted");
      expect(transitionMemoryLifecycle({ current: "admitted", event: "activate" })).toBe("active");
      expect(transitionMemoryLifecycle({ current: "active", event: "forget" })).toBe("forgotten");
      expect(transitionMemoryLifecycle({ current: "active", event: "supersede" })).toBe(
        "superseded",
      );
    });
  });

  describe("CL-P4-03 / P4-04 retention + purge + export", () => {
    it("legal hold skips purge suggestions and blocks purge request", async () => {
      const { cfg, ctx } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Held",
      });
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({
          dataRoot: (cfg.data as { root: string }).root,
        }),
      });
      const record = await catalog.getConversation(ctx.dataPlaneId, created.record.conversationId);
      expect(record).toBeTruthy();
      const held = {
        ...record!,
        retentionState: "LEGAL_HOLD" as const,
        etag: record!.etag,
      };
      await catalog.updateConversation(held, record!.etag);

      const policy = buildDefaultRetentionPolicy(ctx, { purgeAfter: "P1D" });
      const evaluation = evaluateConversationRetention({
        record: held,
        policy,
        nowMs: Date.now(),
      });
      expect(evaluation.actions.some((a) => a.type === "SKIP_LEGAL_HOLD")).toBe(true);
      expect(evaluation.actions.some((a) => a.type === "SUGGEST_PURGE")).toBe(false);

      await catalog.saveLegalHold({
        schemaVersion: 1,
        holdId: "hold_p4",
        dataPlaneId: ctx.dataPlaneId,
        conversationId: created.record.conversationId,
        status: "ACTIVE",
        reasonCode: "LITIGATION",
        createdBy: "admin",
        createdAt: new Date().toISOString(),
        releasedBy: null,
        releasedAt: null,
      });

      await expect(
        requestConversationPurge({
          catalog,
          ctx,
          conversationId: created.record.conversationId,
          requestId: "purge-held",
          collectManifestObjects: async () => [],
        }),
      ).rejects.toMatchObject({ code: "LEGAL_HOLD_BLOCKS_PURGE" });

      expect(
        authorizeConversationAction({
          ctx,
          record: held,
          action: "purge",
        }).allowed,
      ).toBe(false);

      catalog.close();
    });

    it("export writes digest under data root without dual message store", async () => {
      const { cfg, ctx, dataRoot } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Export gate",
      });
      const result = await exportConversationService({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      expect(result.exportDir.startsWith(dataRoot)).toBe(true);
      expect(result.manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
      const listing = await fs.readdir(result.exportDir);
      // No conversation_message dual-write table artifacts
      expect(listing.every((f) => !f.includes("conversation_message"))).toBe(true);
    });
  });
});
