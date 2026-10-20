/**
 * P0 Gate contract tests for conversation lifecycle.
 * CL-P0-01 … CL-P0-05
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeConversationAction,
  buildMemorySourceIdentity,
  buildDefaultRetentionPolicy,
  computeLocalDataPlaneId,
  computeManagedDataPlaneId,
  createNoopPurgeAdapters,
  deriveConversationIdFromMigration,
  ensureConversationForSession,
  resolveConversationCatalogPath,
  resolveConversationFlags,
  resolveConversationTenantContext,
  requestConversationPurge,
  runPurgeJob,
  SqliteConversationCatalog,
  TenantContextResolutionError,
  validateBindingCardinality,
  validateConversationRecord,
  validateMemorySourceIdentity,
  type ConversationRecord,
  type ConversationSessionBinding,
  type ConversationTenantContext,
} from "./index.js";

describe("conversation lifecycle P0", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function tmpDir(label: string): string {
    const dir = path.join(
      os.tmpdir(),
      `openbot-conv-p0-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(dir);
    return dir;
  }

  function localCtx(dataRoot: string, principalId = "user-1"): ConversationTenantContext {
    return resolveConversationTenantContext({
      cfg: { data: { root: dataRoot, mode: "local", schemaVersion: 1 } },
      principalId,
    });
  }

  describe("CL-P0-01 ids and lazy mapping", () => {
    it("maps the same session to the same conversationId twice", async () => {
      const dataRoot = tmpDir("map");
      const catalogPath = resolveConversationCatalogPath({ dataRoot });
      const catalog = new SqliteConversationCatalog({ path: catalogPath });
      const ctx = localCtx(dataRoot);

      const a = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "sess-abc",
        title: "First",
      });
      const b = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "sess-abc",
        title: "Ignored",
      });

      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(a.record.conversationId).toBe(b.record.conversationId);
      expect(a.binding.bindingId).toBe(b.binding.bindingId);
      expect(a.record.conversationId).toBe(
        deriveConversationIdFromMigration({
          dataPlaneId: ctx.dataPlaneId,
          sessionId: "sess-abc",
          bindingRole: "PRIMARY",
        }),
      );
      catalog.close();
    });

    it("keeps different sessionIds independent for the same agent", async () => {
      const dataRoot = tmpDir("two");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const one = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "s1",
      });
      const two = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "s2",
      });
      expect(one.record.conversationId).not.toBe(two.record.conversationId);
      catalog.close();
    });

    it("infers GROUP_PUBLIC for space session keys", async () => {
      const dataRoot = tmpDir("space");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main:space:team-1",
        sessionId: "group-sess-1",
      });
      expect(mapped.record.surfaceType).toBe("COLLABORATION_GROUP");
      expect(mapped.record.groupId).toBe("team-1");
      expect(mapped.binding.role).toBe("GROUP_PUBLIC");
      expect(mapped.record.ownershipScopeType).toBe("GROUP");
      catalog.close();
    });

    it("validates binding cardinality for agent surface", () => {
      const binding = (role: ConversationSessionBinding["role"]): ConversationSessionBinding => ({
        schemaVersion: 1,
        bindingId: `b-${role}`,
        dataPlaneId: "dp",
        conversationId: "c1",
        sessionKey: "agent:a:main",
        sessionId: "s1",
        agentId: "a",
        role,
        aliasTargetBindingId: null,
        transcriptState: "LIVE",
        createdAt: new Date().toISOString(),
        endedAt: null,
      });
      expect(validateBindingCardinality([binding("PRIMARY")], "AGENT").ok).toBe(true);
      expect(validateBindingCardinality([binding("PRIMARY"), binding("PRIMARY")], "AGENT").ok).toBe(
        false,
      );
      expect(
        validateBindingCardinality(
          [binding("GROUP_PUBLIC"), binding("AGENT_EXECUTION")],
          "COLLABORATION_GROUP",
        ).ok,
      ).toBe(true);
    });
  });

  describe("CL-P0-02 catalog repository", () => {
    it("stores catalog under data root .meta/conversations, not only state dir", () => {
      const dataRoot = "/tmp/openbot-data-root-example";
      const p = resolveConversationCatalogPath({ dataRoot });
      expect(p).toContain(path.join(".meta", "conversations", "catalog.sqlite"));
      expect(p.startsWith(dataRoot)).toBe(true);
    });

    it("supports etag concurrency and cursor pagination without message bodies", async () => {
      const dataRoot = tmpDir("catalog");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);

      for (let i = 0; i < 3; i++) {
        await ensureConversationForSession({
          catalog,
          ctx,
          sessionKey: `agent:helper:main`,
          sessionId: `sess-${i}`,
          title: `T${i}`,
          now: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
        });
      }

      const page1 = await catalog.listConversations({
        dataPlaneId: ctx.dataPlaneId,
        limit: 2,
      });
      expect(page1.rows).toHaveLength(2);
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await catalog.listConversations({
        dataPlaneId: ctx.dataPlaneId,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.rows).toHaveLength(1);
      const ids = new Set([...page1.rows, ...page2.rows].map((r) => r.conversationId));
      expect(ids.size).toBe(3);

      const rec = page1.rows[0];
      const payload = JSON.stringify(rec);
      expect(payload).not.toMatch(/"role":"user"/);
      expect(validateConversationRecord(rec).ok).toBe(true);

      const next = { ...rec, title: "Renamed", titleSource: "USER" as const, etag: "etag_new" };
      await catalog.updateConversation(next, rec.etag);
      await expect(catalog.updateConversation(next, rec.etag)).rejects.toThrow(/etag/i);
      catalog.close();
    });
  });

  describe("CL-P0-03 ACL and tenant context", () => {
    it("fail-closed without principal", () => {
      expect(() =>
        resolveConversationTenantContext({
          cfg: { data: { root: "/tmp/x", mode: "local", schemaVersion: 1 } },
        }),
      ).toThrow(TenantContextResolutionError);
    });

    it("requires tenantId in managed mode", () => {
      expect(() =>
        resolveConversationTenantContext({
          cfg: { data: { root: "/tmp/x", mode: "managed", schemaVersion: 1 } },
          principalId: "u1",
        }),
      ).toThrow(/TENANT_REQUIRED|tenantId/i);
    });

    it("derives distinct data planes for tenants", () => {
      expect(computeManagedDataPlaneId("t-a")).not.toBe(computeManagedDataPlaneId("t-b"));
      expect(computeLocalDataPlaneId("/a")).not.toBe(computeLocalDataPlaneId("/b"));
    });

    it("denies cross-tenant and non-member access; legal hold blocks purge", () => {
      const record: ConversationRecord = {
        schemaVersion: 1,
        conversationId: "conv_1",
        dataPlaneId: "dp_tenant_aaa",
        tenantId: "tenant-a",
        ownershipScopeType: "USER",
        ownershipScopeId: "user-a",
        createdByUserId: "user-a",
        surfaceType: "AGENT",
        agentId: "helper",
        groupId: null,
        title: "Hi",
        titleSource: "AUTO",
        lifecycleStatus: "ACTIVE",
        lifecycleStatusBeforeArchive: null,
        storageTier: "HOT",
        retentionState: "LEGAL_HOLD",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null,
        archivedAt: null,
        deletedAt: null,
        lastMessageAt: null,
        messageCount: 1,
        participantIds: ["user-a"],
        primaryBindingId: "b1",
        etag: "e1",
      };

      const otherTenant: ConversationTenantContext = {
        dataPlaneId: "dp_tenant_bbb",
        tenantId: "tenant-b",
        principalId: "user-b",
        seatId: null,
        groupIds: [],
        roles: [],
        mode: "managed",
      };
      expect(
        authorizeConversationAction({ ctx: otherTenant, record, action: "read" }).allowed,
      ).toBe(false);

      const owner: ConversationTenantContext = {
        dataPlaneId: "dp_tenant_aaa",
        tenantId: "tenant-a",
        principalId: "user-a",
        seatId: null,
        groupIds: [],
        roles: [],
        mode: "managed",
      };
      expect(authorizeConversationAction({ ctx: owner, record, action: "read" }).allowed).toBe(
        true,
      );
      expect(authorizeConversationAction({ ctx: owner, record, action: "purge" }).reasonCode).toBe(
        "LEGAL_HOLD_BLOCKS_PURGE",
      );
      expect(authorizeConversationAction({ ctx: owner, record, action: "export" }).allowed).toBe(
        true,
      );

      const policy = buildDefaultRetentionPolicy(owner);
      expect(policy.userDeleteMode).toBe("ARCHIVE_ONLY");
      expect(policy.legalHoldEnabled).toBe(true);
    });
  });

  describe("CL-P0-04 source identity", () => {
    it("computes stable source identity independent of file path", () => {
      const a = buildMemorySourceIdentity({
        dataPlaneId: "dp1",
        conversationId: "c1",
        bindingId: "b1",
        sessionId: "s1",
        firstTurnId: "t1",
        lastTurnId: "t9",
      });
      const b = buildMemorySourceIdentity({
        dataPlaneId: "dp1",
        conversationId: "c1",
        bindingId: "b1",
        sessionId: "s1",
        firstTurnId: "t1",
        lastTurnId: "t9",
      });
      expect(a.sourceIdentityId).toBe(b.sourceIdentityId);
      expect(a.sourceIdentityId).not.toContain("/");
      expect(validateMemorySourceIdentity(a).ok).toBe(true);

      const otherRange = buildMemorySourceIdentity({
        dataPlaneId: "dp1",
        conversationId: "c1",
        bindingId: "b1",
        sessionId: "s1",
        firstTurnId: "t1",
        lastTurnId: "t10",
      });
      expect(otherRange.sourceIdentityId).not.toBe(a.sourceIdentityId);
    });

    it("rejects path-like turn ids", () => {
      const bad = buildMemorySourceIdentity({
        dataPlaneId: "dp1",
        conversationId: "c1",
        bindingId: "b1",
        sessionId: "s1",
        firstTurnId: "/Users/me/sessions/x.jsonl",
        lastTurnId: "t2",
      });
      expect(validateMemorySourceIdentity(bad).ok).toBe(false);
    });
  });

  describe("CL-P0-05 purge FSM", () => {
    it("blocks purge under legal hold and is idempotent by requestId", async () => {
      const dataRoot = tmpDir("purge");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "purge-sess",
      });

      await catalog.saveLegalHold({
        schemaVersion: 1,
        holdId: "hold_1",
        dataPlaneId: ctx.dataPlaneId,
        conversationId: mapped.record.conversationId,
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
          conversationId: mapped.record.conversationId,
          requestId: "req-1",
          collectManifestObjects: async () => [],
        }),
      ).rejects.toMatchObject({ code: "LEGAL_HOLD_BLOCKS_PURGE" });

      // Release hold and purge.
      await catalog.saveLegalHold({
        schemaVersion: 1,
        holdId: "hold_1",
        dataPlaneId: ctx.dataPlaneId,
        conversationId: mapped.record.conversationId,
        status: "RELEASED",
        reasonCode: "LITIGATION",
        createdBy: "admin",
        createdAt: new Date().toISOString(),
        releasedBy: "admin",
        releasedAt: new Date().toISOString(),
      });

      // Clear LEGAL_HOLD retention if projected (record may still be RETAIN)
      const live = await catalog.getConversation(ctx.dataPlaneId, mapped.record.conversationId);
      expect(live).toBeTruthy();

      const stepLog: string[] = [];
      const collect = async () => [
        { kind: "binding" as const, id: mapped.binding.bindingId },
        { kind: "locator" as const, id: "loc1", locator: "sessions/x.jsonl", checksum: "abc" },
      ];

      const first = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-2",
        collectManifestObjects: collect,
      });
      const second = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-2",
        collectManifestObjects: collect,
      });
      expect(first.job.purgeJobId).toBe(second.job.purgeJobId);
      expect(first.job.manifestDigest).toBeTruthy();

      const finished = await runPurgeJob({
        deps: {
          catalog,
          adapters: createNoopPurgeAdapters(stepLog),
          collectManifestObjects: collect,
        },
        jobId: first.job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest: first.manifest,
      });
      expect(finished.status).toBe("SUCCEEDED");
      expect(stepLog).toEqual([
        "FREEZE",
        "MEMORY_REVOKE",
        "DERIVED_DELETE",
        "CONTENT_DELETE",
        "VERIFY",
      ]);

      // Crash resume: re-run already succeeded job is a no-op success
      const again = await runPurgeJob({
        deps: {
          catalog,
          adapters: createNoopPurgeAdapters(stepLog),
          collectManifestObjects: collect,
        },
        jobId: first.job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest: first.manifest,
      });
      expect(again.status).toBe("SUCCEEDED");
      expect(stepLog).toHaveLength(5);

      const tomb = await catalog.getConversation(ctx.dataPlaneId, mapped.record.conversationId);
      expect(tomb?.lifecycleStatus).toBe("DELETED");
      catalog.close();
    });

    it("resumes after mid-step failure without re-running succeeded steps", async () => {
      const dataRoot = tmpDir("purge-resume");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "resume-sess",
      });

      let failOnce = true;
      const log: string[] = [];
      const adapters = createNoopPurgeAdapters().map((a) =>
        a.name === "DERIVED_DELETE"
          ? {
              ...a,
              run: async () => {
                log.push(a.name);
                if (failOnce) {
                  failOnce = false;
                  throw new Error("INJECTED_FAIL");
                }
              },
            }
          : {
              ...a,
              run: async () => {
                log.push(a.name);
              },
            },
      );

      const { job, manifest } = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-resume",
        collectManifestObjects: async () => [{ kind: "binding", id: mapped.binding.bindingId }],
      });

      const failed = await runPurgeJob({
        deps: {
          catalog,
          adapters,
          collectManifestObjects: async () => [],
        },
        jobId: job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest,
      });
      expect(failed.status).toBe("FAILED_RETRYABLE");
      expect(log).toEqual(["FREEZE", "MEMORY_REVOKE", "DERIVED_DELETE"]);

      const ok = await runPurgeJob({
        deps: {
          catalog,
          adapters,
          collectManifestObjects: async () => [],
        },
        jobId: job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest,
      });
      expect(ok.status).toBe("SUCCEEDED");
      // FREEZE + MEMORY_REVOKE not re-run
      expect(log).toEqual([
        "FREEZE",
        "MEMORY_REVOKE",
        "DERIVED_DELETE",
        "DERIVED_DELETE",
        "CONTENT_DELETE",
        "VERIFY",
      ]);
      catalog.close();
    });
  });

  describe("feature flags", () => {
    it("defaults keep UI and retention enforce off; planner + projection on", () => {
      const prevPlanner = process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
      const prevProj = process.env.OPENBOT_CONVERSATION_PROJECTION;
      delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
      delete process.env.OPENBOT_CONVERSATION_PROJECTION;
      try {
        const flags = resolveConversationFlags(undefined);
        expect(flags.catalogEnabled).toBe(true);
        expect(flags.uiEnabled).toBe(false);
        expect(flags.retentionEnforceEnabled).toBe(false);
        expect(flags.sourceLifecycleEnabled).toBe(true);
        expect(flags.contextPlannerEnabled).toBe(true);
        expect(flags.projectionEnabled).toBe(true);
      } finally {
        if (prevPlanner === undefined) {
          delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
        } else {
          process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER = prevPlanner;
        }
        if (prevProj === undefined) {
          delete process.env.OPENBOT_CONVERSATION_PROJECTION;
        } else {
          process.env.OPENBOT_CONVERSATION_PROJECTION = prevProj;
        }
      }
    });
  });
});
