/**
 * v1.2 gap closure tests: B5/B6/T1/T2 + M1 archive restore target.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Source path import avoids depending on package dist build for unit tests.
import { resolveSourceLifecycleSelector } from "../../packages/cogniweave-sdk/src/models.js";
import {
  archiveConversationTranscript,
  cancelPurgeJob,
  commitTranscriptRangeRevoked,
  createNoopPurgeAdapters,
  ensureConversationForSession,
  isMessageRecallDenied,
  isSourceIdentityRecallDenied,
  requestConversationPurge,
  resolveConversationCatalogPath,
  resolveConversationTenantContext,
  resolveRecallDenyStoreDir,
  restoreConversationTranscript,
  runPurgeJob,
  sealTranscriptRanges,
  SqliteConversationCatalog,
  type ConversationTenantContext,
  type SealableMessage,
} from "./index.js";

describe("conversation lifecycle v1.2 gaps", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function tmpDir(label: string): string {
    const dir = path.join(
      os.tmpdir(),
      `openbot-conv-v12-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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

  describe("M1 lifecycleStatusBeforeArchive", () => {
    it("restores to pre-archive ACTIVE and clears snapshot", async () => {
      const dataRoot = tmpDir("archive");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "sess-arch",
      });
      expect(mapped.record.lifecycleStatus).toBe("ACTIVE");
      expect(mapped.record.lifecycleStatusBeforeArchive).toBeNull();

      const livePath = path.join(dataRoot, "live.jsonl");
      await fs.writeFile(
        livePath,
        '{"type":"message","id":"m1","message":{"role":"user","content":"hi"}}\n',
      );
      const archiveDir = path.join(dataRoot, "archives");

      const archived = await archiveConversationTranscript({
        catalog,
        record: mapped.record,
        binding: mapped.binding,
        liveTranscriptPath: livePath,
        archiveDir,
      });
      expect(archived.record.lifecycleStatus).toBe("ARCHIVED");
      expect(archived.record.lifecycleStatusBeforeArchive).toBe("ACTIVE");

      const restored = await restoreConversationTranscript({
        catalog,
        record: archived.record,
        binding: archived.binding,
        liveTranscriptPath: livePath,
        archivePath: archived.archivePath,
        targetLifecycle: "CLOSED", // ignored when snapshot present
      });
      expect(restored.record.lifecycleStatus).toBe("ACTIVE");
      expect(restored.record.lifecycleStatusBeforeArchive).toBeNull();
      catalog.close();
    });
  });

  describe("B5/B4 purge irreversible barrier", () => {
    it("sets irreversibleStartedAt at MEMORY_REVOKE and blocks cancel after", async () => {
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

      let sawMemoryRevoke = false;
      const adapters = createNoopPurgeAdapters().map((a) => {
        if (a.name !== "MEMORY_REVOKE") {
          return a;
        }
        return {
          ...a,
          run: async (runCtx: Parameters<typeof a.run>[0]) => {
            sawMemoryRevoke = true;
            expect(runCtx.job.irreversibleStartedAt).toBeTruthy();
          },
        };
      });

      const { job, manifest } = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-barrier",
        collectManifestObjects: async () => [{ kind: "binding", id: mapped.binding.bindingId }],
      });
      expect(job.irreversibleStartedAt).toBeNull();

      // Cancel is allowed before irreversible barrier.
      const cancelled = await cancelPurgeJob({
        catalog,
        dataPlaneId: ctx.dataPlaneId,
        jobId: job.purgeJobId,
      });
      expect(cancelled.status).toBe("CANCELLED");

      const again = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-barrier-2",
        collectManifestObjects: async () => [{ kind: "binding", id: mapped.binding.bindingId }],
      });

      // Fail during MEMORY_REVOKE after barrier is set.
      const failAdapters = createNoopPurgeAdapters().map((a) => {
        if (a.name !== "MEMORY_REVOKE") {
          return a;
        }
        return {
          ...a,
          run: async () => {
            throw new Error("revoke failed");
          },
        };
      });
      const failed = await runPurgeJob({
        deps: {
          catalog,
          adapters: failAdapters,
          collectManifestObjects: async () => [],
        },
        jobId: again.job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest: again.manifest,
      });
      expect(failed.status).toBe("FAILED_RETRYABLE");
      expect(failed.irreversibleStartedAt).toBeTruthy();

      await expect(
        cancelPurgeJob({
          catalog,
          dataPlaneId: ctx.dataPlaneId,
          jobId: again.job.purgeJobId,
        }),
      ).rejects.toMatchObject({ code: "PURGE_IRREVERSIBLE" });

      // Resume with healthy adapters to terminal success.
      const finished = await runPurgeJob({
        deps: {
          catalog,
          adapters,
          collectManifestObjects: async () => [],
        },
        jobId: again.job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest,
      });
      expect(finished.status).toBe("SUCCEEDED");
      expect(sawMemoryRevoke).toBe(true);
      catalog.close();
    });
  });

  describe("B6 deny watermark", () => {
    it("denies recall immediately after commit even without forgetSource", async () => {
      const dataRoot = tmpDir("deny");
      const storeDir = resolveRecallDenyStoreDir(dataRoot);
      const sessionFile = path.join(dataRoot, "sessions", "s1.jsonl");
      const result = await commitTranscriptRangeRevoked({
        storeDir,
        sessionFile,
        boundaryTurnId: "msg-boundary",
        deniedSourceIdentityIds: ["msrc_tail_1"],
        deniedMessageIds: ["msg-2", "msg-3"],
        kind: "TRANSCRIPT_RANGE_REVOKED",
      });
      expect(result.deny.deniedSourceIdentityIds).toContain("msrc_tail_1");
      expect(result.outbox.status).toBe("PENDING");
      expect(result.update.kind).toBe("TRANSCRIPT_RANGE_REVOKED");

      expect(
        await isSourceIdentityRecallDenied({ storeDir, sourceIdentityId: "msrc_tail_1" }),
      ).toBe(true);
      expect(await isMessageRecallDenied({ storeDir, messageId: "msg-2" })).toBe(true);
      expect(await isSourceIdentityRecallDenied({ storeDir, sourceIdentityId: "msrc_keep" })).toBe(
        false,
      );
    });
  });

  describe("B2 seal watermark", () => {
    it("seals only after watermark and does not re-seal on append", () => {
      const msgs: SealableMessage[] = [];
      for (let i = 0; i < 6; i++) {
        msgs.push({
          id: `m${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          text: `turn ${i} content long enough`,
          turnIndex: i,
        });
      }
      const base = {
        dataPlaneId: "dp1",
        conversationId: "c1",
        bindingId: "b1",
        sessionId: "s1",
        maxTurns: 4,
      };
      const first = sealTranscriptRanges({ ...base, messages: msgs, watermark: null });
      expect(first.sealed.length).toBeGreaterThanOrEqual(1);
      const sealedCount = first.sealed.length;
      const ids = first.sealed.map((s) => s.identity.sourceIdentityId);

      // Append two more messages — prior sealed ranges must not reappear as new seals.
      msgs.push(
        { id: "m6", role: "user", text: "new user", turnIndex: 6 },
        { id: "m7", role: "assistant", text: "new assistant", turnIndex: 7 },
      );
      const second = sealTranscriptRanges({
        ...base,
        messages: msgs,
        watermark: first.nextWatermark,
        maxTurns: 4,
      });
      for (const s of second.sealed) {
        expect(ids).not.toContain(s.identity.sourceIdentityId);
      }
      // Re-run with same watermark + messages yields no new seals if tail incomplete / already sealed.
      const third = sealTranscriptRanges({
        ...base,
        messages: msgs.slice(0, first.nextWatermark.lastSealedTurnIndex! + 1),
        watermark: first.nextWatermark,
      });
      expect(third.sealed).toHaveLength(0);
      expect(sealedCount).toBeGreaterThan(0);
    });
  });

  describe("T2 SourceLifecycleSelector", () => {
    it("requires exactly one selector and fails closed on conflict", () => {
      expect(
        resolveSourceLifecycleSelector({
          operationId: "op1",
          selector: { mode: "identity", sourceIdentityId: "msrc_1" },
          reasonCode: "test",
        }),
      ).toEqual({ mode: "identity", sourceIdentityId: "msrc_1" });

      expect(
        resolveSourceLifecycleSelector({
          sourceLocator: "/path/to.jsonl",
          reasonCode: "mig",
        }),
      ).toEqual({ mode: "legacyLocator", sourceLocator: "/path/to.jsonl" });

      expect(() =>
        resolveSourceLifecycleSelector({
          sourceLocator: "a",
          sourceBindingId: "b",
        }),
      ).toThrow(/multiple selectors/i);

      expect(() => resolveSourceLifecycleSelector({})).toThrow(/exactly one/i);
    });
  });

  describe("purge freeze-before-irreversible + cancel retention", () => {
    it("executes only job.manifest (ignores swapped external manifest)", async () => {
      const dataRoot = tmpDir("manifest-only");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "manifest-only-sess",
      });
      const objects = [{ kind: "binding" as const, id: mapped.binding.bindingId }];
      const { job, manifest } = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-manifest-only",
        collectManifestObjects: async () => objects,
      });
      expect(job.manifest?.objects).toEqual(objects);
      // Swapped external manifest must not be used by executor.
      const swapped = {
        ...manifest,
        objects: [{ kind: "locator" as const, id: "evil", locator: "/tmp/should-not-delete" }],
      };
      const log: string[] = [];
      const finished = await runPurgeJob({
        deps: {
          catalog,
          adapters: createNoopPurgeAdapters(log),
          collectManifestObjects: async () => objects,
        },
        jobId: job.purgeJobId,
        dataPlaneId: ctx.dataPlaneId,
        manifest: swapped,
      });
      expect(finished.status).toBe("SUCCEEDED");
      // Job still holds original objects; digest matches job snapshot not swapped.
      expect(finished.manifest?.objects).toEqual(objects);
      catalog.close();
    });

    it("freezes to PURGE_PENDING before durable job and restores pre-purge EXPIRING on cancel", async () => {
      const dataRoot = tmpDir("freeze-cancel");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "freeze-sess",
      });
      const { createEtag } = await import("./ids.js");
      const rec0 = await catalog.getConversation(ctx.dataPlaneId, mapped.record.conversationId);
      expect(rec0).toBeTruthy();
      await catalog.updateConversation(
        {
          ...rec0!,
          retentionState: "EXPIRING",
          updatedAt: new Date().toISOString(),
          etag: createEtag(),
        },
        rec0!.etag,
      );

      const { job } = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-freeze-1",
        collectManifestObjects: async () => [{ kind: "binding", id: mapped.binding.bindingId }],
      });
      expect(job.prePurgeRetentionState).toBe("EXPIRING");
      expect(job.governanceFrozenAt).toBeTruthy();
      const frozen = await catalog.getConversation(ctx.dataPlaneId, mapped.record.conversationId);
      expect(frozen?.retentionState).toBe("PURGE_PENDING");

      const cancelled = await cancelPurgeJob({
        catalog,
        dataPlaneId: ctx.dataPlaneId,
        jobId: job.purgeJobId,
      });
      expect(cancelled.status).toBe("CANCELLED");
      const restored = await catalog.getConversation(ctx.dataPlaneId, mapped.record.conversationId);
      expect(restored?.retentionState).toBe("EXPIRING");
      catalog.close();
    });
  });

  describe("purge immutable manifest + resume", () => {
    it("persists full manifest snapshot and refuses resume without it", async () => {
      const dataRoot = tmpDir("manifest");
      const catalog = new SqliteConversationCatalog({
        path: resolveConversationCatalogPath({ dataRoot }),
      });
      const ctx = localCtx(dataRoot);
      const mapped = await ensureConversationForSession({
        catalog,
        ctx,
        sessionKey: "agent:helper:main",
        sessionId: "manifest-sess",
      });

      const objects = [
        {
          kind: "cogniweave_source" as const,
          id: "msrc_sealed_1",
          locator: "msrc://msrc_sealed_1",
        },
        { kind: "locator" as const, id: mapped.binding.sessionId, locator: "/tmp/x.jsonl" },
      ];
      const { job, manifest } = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-manifest-1",
        collectManifestObjects: async () => objects,
      });
      expect(job.manifest).toBeTruthy();
      expect(job.manifest?.objects).toEqual(objects);
      expect(manifest.objects).toEqual(objects);
      expect(job.manifestDigest).toMatch(/^[a-f0-9]{64}$/);

      // Replay uses immutable snapshot — collect must not be re-invoked for objects.
      let collectCalls = 0;
      const again = await requestConversationPurge({
        catalog,
        ctx,
        conversationId: mapped.record.conversationId,
        requestId: "req-manifest-1",
        collectManifestObjects: async () => {
          collectCalls += 1;
          return [{ kind: "binding", id: "should-not-appear" }];
        },
      });
      expect(collectCalls).toBe(0);
      expect(again.manifest.objects).toEqual(objects);
      expect(again.job.manifest?.objects).toEqual(objects);
      catalog.close();
    });
  });
});
