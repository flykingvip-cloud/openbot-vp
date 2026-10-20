/**
 * P1 service tests: create/list/rename/close/archive/restore + history cursor.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  archiveConversation,
  closeConversation,
  createConversation,
  decodeHistoryCursor,
  encodeHistoryCursor,
  enrichSessionRowsWithConversationProjection,
  fingerprintSessionId,
  getConversation,
  listConversations,
  pageHistoryMessages,
  projectConversationOntoSession,
  renameConversation,
  getOrOpenCatalog,
  requestArchiveJob,
  resetConversationCatalogCache,
  resolveConversationCatalogPath,
  resolveConversationTenantContext,
  restoreConversation,
  SqliteConversationCatalog,
  type ConversationTenantContext,
} from "./index.js";

describe("conversation lifecycle P1 service", () => {
  const tmpRoots: string[] = [];
  const prevState = process.env.OPENCLAW_STATE_DIR;
  const prevHome = process.env.OPENBOT_HOME;

  afterEach(async () => {
    resetConversationCatalogCache();
    if (prevState === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevState;
    }
    if (prevHome === undefined) {
      delete process.env.OPENBOT_HOME;
    } else {
      process.env.OPENBOT_HOME = prevHome;
    }
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function setupEnv(): {
    dataRoot: string;
    stateDir: string;
    cfg: OpenBotConfig;
    ctx: ConversationTenantContext;
  } {
    const root = path.join(
      os.tmpdir(),
      `openbot-conv-p1-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(root);
    const dataRoot = path.join(root, "data");
    const stateDir = path.join(root, "state");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENBOT_HOME = root;
    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const ctx = resolveConversationTenantContext({
      cfg,
      principalId: "user-p1",
    });
    return { dataRoot, stateDir, cfg, ctx };
  }

  it("persists archive job by requestId and returns opaque artifact id", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Job archive",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(
      livePath,
      `${JSON.stringify({ type: "message", role: "user", content: "job" })}\n`,
    );
    const first = await requestArchiveJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-arch-idem-1",
      etag: created.record.etag,
    });
    expect(first.job.status).toBe("SUCCEEDED");
    expect(first.job.jobId).toMatch(/^lcjob_/);
    expect(first.artifactId).toMatch(/^arch_/);
    expect(first.artifactId).not.toContain("/");
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.job.bindingSteps.length).toBeGreaterThanOrEqual(1);
    expect(first.job.bindingSteps[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);

    const second = await requestArchiveJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-arch-idem-1",
      etag: created.record.etag, // stale etag — must not matter on SUCCEEDED resume
    });
    expect(second.job.jobId).toBe(first.job.jobId);
    expect(second.job.status).toBe("SUCCEEDED");
    expect(second.checksum).toBe(first.checksum);
  });

  it("retries real multi-binding partial failure then recovers with same requestId", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    // Collaboration: GROUP_PUBLIC + AGENT_EXECUTION (two bindings).
    const created = await createConversation({
      deps: { cfg, ctx: { ...ctx, groupIds: ["team-partial"] }, dataRoot },
      surfaceType: "COLLABORATION_GROUP",
      groupId: "team-partial",
      agentId: "coordinator",
      title: "Partial multi-bind",
    });
    const { attachExecutionBinding } = await import("./index.js");
    const exec = await attachExecutionBinding({
      deps: { cfg, ctx: { ...ctx, groupIds: ["team-partial"] }, dataRoot },
      conversationId: created.record.conversationId,
      agentId: "helper",
      etag: created.record.etag,
    });

    const writeLive = async (sessionId: string, agentId: string, body: string) => {
      const p = path.join(
        process.env.OPENCLAW_STATE_DIR!,
        "agents",
        agentId,
        "sessions",
        `${sessionId}.jsonl`,
      );
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, `${JSON.stringify({ type: "message", content: body })}\n`);
      return p;
    };

    await writeLive(created.binding.sessionId, created.binding.agentId ?? "main", "public-1");
    // Runtime attach may have created an empty exec session file — remove it so the
    // second binding fails after the public binding can be archived (real partial path).
    const execLive = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${exec.binding.sessionId}.jsonl`,
    );
    await fs.rm(execLive, { force: true });

    const startEtag = (
      await getOrOpenCatalog(cfg, ctx, { dataRoot }).getConversation(
        ctx.dataPlaneId,
        created.record.conversationId,
      )
    )?.etag;

    await expect(
      requestArchiveJob({
        deps: { cfg, ctx: { ...ctx, groupIds: ["team-partial"] }, dataRoot },
        conversationId: created.record.conversationId,
        requestId: "req-partial-1",
        etag: startEtag,
      }),
    ).rejects.toThrow(/ARCHIVE_PARTIAL_FAILURE|live_missing/);

    const catalog = getOrOpenCatalog(cfg, ctx, { dataRoot });
    const failedJob = await catalog.findLifecycleJobByRequestId(
      ctx.dataPlaneId,
      created.record.conversationId,
      "req-partial-1",
    );
    expect(failedJob?.status).toBe("FAILED_RETRYABLE");

    // Repair: create missing exec live, resume same requestId with stale etag.
    await writeLive(exec.binding.sessionId, "helper", "exec-1");
    // Also ensure public live still present (may already be archived).
    const pubLive = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      created.binding.agentId ?? "main",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    try {
      await fs.access(pubLive);
    } catch {
      await writeLive(created.binding.sessionId, created.binding.agentId ?? "main", "public-1");
    }

    const resumed = await requestArchiveJob({
      deps: { cfg, ctx: { ...ctx, groupIds: ["team-partial"] }, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-partial-1",
      etag: startEtag, // stale after partial Catalog updates
    });
    expect(resumed.job.status).toBe("SUCCEEDED");
    expect(resumed.job.jobId).toBe(failedJob?.jobId);
    expect(resumed.job.bindingSteps.length).toBeGreaterThanOrEqual(2);
    const checksums = resumed.job.bindingSteps.map((s) => s.checksum);
    expect(checksums.every((c) => c && /^[a-f0-9]{64}$/.test(c))).toBe(true);
    // Independent receipts: public and exec content differ → checksums differ.
    expect(new Set(checksums).size).toBeGreaterThanOrEqual(2);
  });

  it("concurrent same requestId: only one claim executes", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Concurrent claim",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(
      livePath,
      `${JSON.stringify({ type: "message", content: "concurrent" })}\n`,
    );

    const deps = { cfg, ctx, dataRoot };
    const requestId = "req-concurrent-1";
    const jobsMod = await import("./lifecycle-jobs.js");
    // Hold the first claimer briefly so the other two observe active lease.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered = 0;
    jobsMod.__testHooks.afterClaim = async () => {
      entered += 1;
      if (entered === 1) {
        // Let siblings start while we still hold the lease.
        await new Promise((r) => setTimeout(r, 80));
        release();
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    try {
      const starter = requestArchiveJob({
        deps,
        conversationId: created.record.conversationId,
        requestId,
        etag: created.record.etag,
      });
      await gate;
      const results = await Promise.all([
        starter,
        requestArchiveJob({
          deps,
          conversationId: created.record.conversationId,
          requestId,
          etag: created.record.etag,
        }),
        requestArchiveJob({
          deps,
          conversationId: created.record.conversationId,
          requestId,
          etag: created.record.etag,
        }),
      ]);

      const jobIds = new Set(results.map((r) => r.job.jobId));
      expect(jobIds.size).toBe(1);
      expect(results.filter((r) => r.claimed).length).toBe(1);
      const final = await requestArchiveJob({
        deps,
        conversationId: created.record.conversationId,
        requestId,
      });
      expect(final.job.status).toBe("SUCCEEDED");
      expect(final.claimed).toBe(false);
    } finally {
      jobsMod.__testHooks.afterClaim = null;
    }
  });

  it("lease fence: expired old worker cannot overwrite new worker terminal state", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Fence",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, `${JSON.stringify({ type: "message", content: "fence" })}\n`);

    const catalog = getOrOpenCatalog(cfg, ctx, { dataRoot });
    // Seed a RUNNING job held by "old-worker" with expired lease.
    const { createLifecycleJobId } = await import("./ids.js");
    const jobId = createLifecycleJobId();
    const expired = new Date(Date.now() - 5_000).toISOString();
    const oldJob = {
      schemaVersion: 1 as const,
      jobId,
      kind: "archive" as const,
      dataPlaneId: ctx.dataPlaneId,
      conversationId: created.record.conversationId,
      requestId: "req-fence-1",
      requestedBy: ctx.principalId,
      status: "RUNNING" as const,
      etagAtStart: created.record.etag,
      targetLifecycle: null,
      bindingSteps: [],
      resultChecksum: null,
      resultArtifactId: null,
      resultBytes: null,
      lastErrorCode: null,
      leaseOwner: "old-worker",
      leaseExpiresAt: expired,
      claimGeneration: 1,
      createdAt: expired,
      updatedAt: expired,
      completedAt: null,
    };
    await catalog.saveLifecycleJob(oldJob);

    // New worker claims (lease expired) and finishes successfully.
    const fresh = await requestArchiveJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-fence-1",
    });
    expect(fresh.claimed).toBe(true);
    expect(fresh.job.status).toBe("SUCCEEDED");
    expect(fresh.job.claimGeneration).toBeGreaterThanOrEqual(2);

    // Old worker attempts fenced complete with stale generation → must fail.
    const staleTerminal = {
      ...oldJob,
      status: "SUCCEEDED" as const,
      resultChecksum: "deadbeef",
      resultArtifactId: "arch_stale",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
      claimGeneration: 1,
    };
    const fenced = await catalog.completeLifecycleJobFenced({
      dataPlaneId: ctx.dataPlaneId,
      jobId,
      expectedLeaseOwner: "old-worker",
      expectedClaimGeneration: 1,
      nextJob: staleTerminal,
    });
    expect(fenced).toBeNull();

    const final = await catalog.getLifecycleJob(ctx.dataPlaneId, jobId);
    expect(final?.status).toBe("SUCCEEDED");
    expect(final?.resultChecksum).not.toBe("deadbeef");
    expect(final?.resultChecksum).toBe(fresh.job.resultChecksum);
  });

  it("restore freezes targetLifecycle for same requestId", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Target freeze",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, "{}\n");
    await requestArchiveJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-arch-for-restore",
    });
    const { requestRestoreJob, LifecycleIdempotencyConflictError } =
      await import("./lifecycle-jobs.js");
    await requestRestoreJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-restore-freeze",
      targetLifecycle: "CLOSED",
    });
    await expect(
      requestRestoreJob({
        deps: { cfg, ctx, dataRoot },
        conversationId: created.record.conversationId,
        requestId: "req-restore-freeze",
        targetLifecycle: "ACTIVE",
      }),
    ).rejects.toBeInstanceOf(LifecycleIdempotencyConflictError);
  });

  it("primaryFromJob prefers GROUP_PUBLIC over earlier AGENT_EXECUTION step", async () => {
    const { resolvePrimaryBindingForJobReceipt } = await import("./lifecycle-jobs.js");
    const publicB = {
      schemaVersion: 1 as const,
      bindingId: "cbind_public",
      dataPlaneId: "dp1",
      conversationId: "conv_1",
      sessionKey: "agent:coord:space:g:conversation:conv_1",
      sessionId: "sess-public",
      agentId: "coord",
      role: "GROUP_PUBLIC" as const,
      aliasTargetBindingId: null,
      transcriptState: "LIVE" as const,
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
    const execB = {
      ...publicB,
      bindingId: "cbind_exec",
      sessionKey: "agent:helper:space:g:execution:conv_1",
      sessionId: "sess-exec",
      agentId: "helper",
      role: "AGENT_EXECUTION" as const,
    };
    // Unordered: execution first (as SQLite might return).
    const bindings = [execB, publicB];
    const job = {
      schemaVersion: 1 as const,
      jobId: "lcjob_x",
      kind: "restore" as const,
      dataPlaneId: "dp1",
      conversationId: "conv_1",
      requestId: "r1",
      requestedBy: "u1",
      status: "SUCCEEDED" as const,
      etagAtStart: null,
      targetLifecycle: "ACTIVE" as const,
      bindingSteps: [
        {
          bindingId: "cbind_exec",
          sessionId: "sess-exec",
          status: "SUCCEEDED" as const,
          checksum: "aaa",
          updatedAt: new Date().toISOString(),
        },
        {
          bindingId: "cbind_public",
          sessionId: "sess-public",
          status: "SUCCEEDED" as const,
          checksum: "bbb",
          updatedAt: new Date().toISOString(),
        },
      ],
      resultChecksum: "bbb",
      resultArtifactId: "arch_x",
      resultBytes: 1,
      lastErrorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      claimGeneration: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const picked = resolvePrimaryBindingForJobReceipt(job, bindings, "cbind_public");
    expect(picked?.bindingId).toBe("cbind_public");
    expect(picked?.role).toBe("GROUP_PUBLIC");
    expect(picked?.sessionKey).not.toContain(":execution:");
    // Without primary id, still prefers GROUP_PUBLIC over AGENT_EXECUTION.
    const picked2 = resolvePrimaryBindingForJobReceipt(job, bindings, null);
    expect(picked2?.role).toBe("GROUP_PUBLIC");
  });

  it("denies lifecycle job get without conversation read ACL", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "ACL job",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, "{}\n");
    const archived = await requestArchiveJob({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      requestId: "req-acl-job",
    });
    const { getLifecycleJobService, resolveConversationTenantContext } = await import("./index.js");
    const stranger = resolveConversationTenantContext({
      cfg,
      principalId: "other-user",
    });
    const denied = await getLifecycleJobService({
      deps: { cfg, ctx: stranger, dataRoot },
      jobId: archived.job.jobId,
    });
    expect(denied).toBeNull();
    const allowed = await getLifecycleJobService({
      deps: { cfg, ctx, dataRoot },
      jobId: archived.job.jobId,
    });
    expect(allowed?.jobId).toBe(archived.job.jobId);
  });

  it("creates two independent conversations for the same agent", async () => {
    const { cfg, ctx } = setupEnv();
    const a = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "First",
    });
    const b = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Second",
    });
    expect(a.record.conversationId).not.toBe(b.record.conversationId);
    expect(a.sessionKey).not.toBe(b.sessionKey);
    expect(a.binding.sessionId).not.toBe(b.binding.sessionId);

    const listed = await listConversations({
      deps: { cfg, ctx },
      agentId: "helper",
    });
    expect(listed.rows.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(listed.rows.map((r) => r.conversationId));
    expect(ids.has(a.record.conversationId)).toBe(true);
    expect(ids.has(b.record.conversationId)).toBe(true);

    // Transcript headers exist
    const liveA = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${a.binding.sessionId}.jsonl`,
    );
    const text = await fs.readFile(liveA, "utf-8");
    expect(text).toContain('"type":"session"');
  });

  it("renames with USER titleSource and closes", async () => {
    const { cfg, ctx } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
    });
    const renamed = await renameConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      title: "My title",
      etag: created.record.etag,
    });
    expect(renamed.title).toBe("My title");
    expect(renamed.titleSource).toBe("USER");
    const closed = await closeConversation({
      deps: { cfg, ctx },
      conversationId: renamed.conversationId,
      etag: renamed.etag,
    });
    expect(closed.lifecycleStatus).toBe("CLOSED");
    expect(closed.closedAt).toBeTruthy();
  });

  it("fails multi-binding archive when archive copy missing for ARCHIVED binding", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx, dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Partial archive",
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, `${JSON.stringify({ type: "message", content: "x" })}\n`);

    // First archive succeeds.
    const archived = await archiveConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
    });
    expect(archived.record.lifecycleStatus).toBe("ARCHIVED");

    // Simulate missing archive copy while Catalog still says ARCHIVED.
    await fs.rm(archived.archivePath, { force: true });
    // Delete live too so path hits ARCHIVED+live_missing branch.
    await fs.rm(livePath, { force: true });

    await expect(
      archiveConversation({
        deps: { cfg, ctx, dataRoot },
        conversationId: created.record.conversationId,
      }),
    ).rejects.toThrow(/ARCHIVE_PARTIAL_FAILURE|archive_missing/);
  });

  it("archives with checksum then restores same binding without new conversation", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Archive me",
    });
    // Append a user line so archive has content beyond header
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(
      livePath,
      `${JSON.stringify({ type: "message", role: "user", content: "hello archive" })}\n`,
      "utf-8",
    );

    const archived = await archiveConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      etag: created.record.etag,
    });
    expect(archived.record.lifecycleStatus).toBe("ARCHIVED");
    expect(archived.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(archived.archivePath.startsWith(dataRoot)).toBe(true);
    const archiveBody = await fs.readFile(archived.archivePath, "utf-8");
    expect(archiveBody).toContain("hello archive");

    // Live still present (copy archive, not delete)
    expect(await fs.readFile(livePath, "utf-8")).toContain("hello archive");

    const restored = await restoreConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      etag: archived.record.etag,
      targetLifecycle: "ACTIVE",
    });
    expect(restored.record.lifecycleStatus).toBe("ACTIVE");
    expect(restored.binding.bindingId).toBe(created.binding.bindingId);
    expect(restored.binding.sessionId).toBe(created.binding.sessionId);
    expect(restored.record.conversationId).toBe(created.record.conversationId);

    const got = await getConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
    });
    expect(got.record.lifecycleStatus).toBe("ACTIVE");
    expect(got.bindings[0]?.transcriptState).toBe("LIVE");
  });

  it("pages history with opaque cursor without path leakage", () => {
    const sessionId = "sess-hist-1";
    const messages = Array.from({ length: 25 }, (_, i) => ({ id: i, text: `m${i}` }));
    const page1 = pageHistoryMessages({
      messages,
      limit: 10,
      sessionId,
    });
    expect(page1.messages).toHaveLength(10);
    expect(page1.messages[0]?.id).toBe(15);
    expect(page1.messages[9]?.id).toBe(24);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextBefore).toBeTruthy();
    expect(page1.nextBefore).not.toContain("/");
    expect(page1.nextBefore).not.toContain("jsonl");

    const decoded = decodeHistoryCursor(page1.nextBefore!);
    expect(decoded?.sid).toBe(fingerprintSessionId(sessionId));

    const page2 = pageHistoryMessages({
      messages,
      limit: 10,
      sessionId,
      before: page1.nextBefore,
    });
    expect(page2.messages[0]?.id).toBe(5);
    expect(page2.messages[9]?.id).toBe(14);

    // Continuous load: 10 pages without overlap or loss
    let cursor: string | null = null;
    const seen = new Set<number>();
    for (let pageNum = 0; pageNum < 10; pageNum++) {
      const pageResult: {
        messages: Array<{ id: number; text: string }>;
        nextBefore: string | null;
        hasMore: boolean;
      } = pageHistoryMessages({
        messages,
        limit: 3,
        sessionId,
        before: cursor,
      });
      for (const m of pageResult.messages) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      }
      if (!pageResult.hasMore) {
        break;
      }
      cursor = pageResult.nextBefore;
    }
    expect(seen.size).toBe(25);

    // Wrong session fingerprint rejected
    const bad = encodeHistoryCursor({
      v: 1,
      beforeIndex: 10,
      sid: "deadbeefdead",
    });
    expect(() => pageHistoryMessages({ messages, limit: 5, sessionId, before: bad })).toThrow(
      /cursor/i,
    );
  });

  it("restores lifecycleStatusBeforeArchive after archive", async () => {
    const { cfg, ctx } = setupEnv();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Before archive active",
    });
    expect(created.record.lifecycleStatus).toBe("ACTIVE");
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(
      livePath,
      `${JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "x" } })}\n`,
    );
    const archived = await archiveConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      etag: created.record.etag,
    });
    expect(archived.record.lifecycleStatusBeforeArchive).toBe("ACTIVE");
    const restored = await restoreConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      etag: archived.record.etag,
    });
    expect(restored.record.lifecycleStatus).toBe("ACTIVE");
  });

  it("catalog path stays under data root", () => {
    const { dataRoot, cfg, ctx } = setupEnv();
    const p = resolveConversationCatalogPath({ cfg, ctx });
    expect(p.startsWith(dataRoot)).toBe(true);
    // Ensure we can open catalog explicitly
    const catalog = new SqliteConversationCatalog({ path: p });
    catalog.close();
  });

  it("projects conversation fields onto session rows with lazy backfill", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const deps = { cfg, ctx, dataRoot };
    const rows = [
      {
        key: "agent:helper:main",
        sessionId: "sess-proj-1",
        derivedTitle: "Proj title",
      },
      { key: "agent:helper:other", sessionId: undefined as string | undefined },
    ];

    // Without createIfMissing: unknown session stays unprojected.
    const empty = await projectConversationOntoSession({
      deps,
      sessionKey: "agent:helper:main",
      sessionId: "sess-proj-1",
      createIfMissing: false,
    });
    expect(empty.conversationId).toBeUndefined();

    const enriched = await enrichSessionRowsWithConversationProjection({
      deps,
      sessions: rows,
      createIfMissing: true,
    });
    expect(enriched[0]?.conversationId).toMatch(/^conv_/);
    expect(enriched[0]?.conversationLifecycleStatus).toBe("ACTIVE");
    expect(enriched[0]?.conversationTitle).toBeTruthy();
    expect(enriched[1]?.conversationId).toBeUndefined();

    // Second pass with createIfMissing false still finds the catalog row.
    const again = await projectConversationOntoSession({
      deps,
      sessionKey: "agent:helper:main",
      sessionId: "sess-proj-1",
      createIfMissing: false,
    });
    expect(again.conversationId).toBe(enriched[0]?.conversationId);
  });
});
