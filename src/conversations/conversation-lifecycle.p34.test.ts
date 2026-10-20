/**
 * P3 / P4 contract tests: collaboration bindings, shared task, search,
 * memory admission, retention, export, purge service path.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  archiveConversation,
  attachExecutionBinding,
  createConversation,
  evaluateMemoryAdmission,
  detectAdmissionSignals,
  evaluateConversationRetention,
  exportConversationService,
  getConversation,
  getConversationLineage,
  getSharedTaskContextForConversation,
  parseDurationToDays,
  resetConversationCatalogCache,
  resolveConversationTenantContext,
  restoreConversation,
  searchConversationsService,
  updateSharedTaskContextForConversation,
  buildSharedTaskSystemPromptAddition,
  runRetentionScan,
  buildDefaultRetentionPolicy,
  type ConversationTenantContext,
} from "./index.js";

describe("conversation lifecycle P3/P4", () => {
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
      `openbot-p34-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(root);
    const dataRoot = path.join(root, "data");
    const stateDir = path.join(root, "state");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const ctx = resolveConversationTenantContext({
      cfg,
      principalId: "user-p34",
      groupIds: ["team-alpha"],
    });
    return { dataRoot, cfg, ctx };
  }

  describe("P3 collaboration", () => {
    it("archives and restores every active binding under a collaboration conversation", async () => {
      const { cfg, ctx, dataRoot } = setup();
      process.env.OPENCLAW_STATE_DIR = path.join(dataRoot, "..", "state");
      await fs.mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });

      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "COLLABORATION_GROUP",
        groupId: "team-alpha",
        agentId: "coordinator",
        title: "Multi-bind archive",
      });
      const exec = await attachExecutionBinding({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        agentId: "helper",
        etag: created.record.etag,
      });

      // Ensure live transcripts exist for both bindings.
      for (const b of [created.binding, exec.binding]) {
        const agentId = b.agentId ?? "main";
        const livePath = path.join(
          process.env.OPENCLAW_STATE_DIR,
          "agents",
          agentId,
          "sessions",
          `${b.sessionId}.jsonl`,
        );
        await fs.mkdir(path.dirname(livePath), { recursive: true });
        await fs.appendFile(
          livePath,
          `${JSON.stringify({ type: "message", role: "user", content: `hi-${b.role}` })}\n`,
          "utf-8",
        );
      }

      const archived = await archiveConversation({
        deps: { cfg, ctx, dataRoot },
        conversationId: created.record.conversationId,
      });
      expect(archived.record.lifecycleStatus).toBe("ARCHIVED");
      expect(archived.archivedBindings.length).toBeGreaterThanOrEqual(2);
      expect(archived.archivedBindings.every((b) => b.transcriptState === "ARCHIVED")).toBe(true);

      const restored = await restoreConversation({
        deps: { cfg, ctx, dataRoot },
        conversationId: created.record.conversationId,
        etag: archived.record.etag,
        targetLifecycle: "ACTIVE",
      });
      expect(restored.record.lifecycleStatus).toBe("ACTIVE");
      expect(restored.restoredBindings.length).toBeGreaterThanOrEqual(2);
      expect(restored.restoredBindings.every((b) => b.transcriptState === "LIVE")).toBe(true);

      const got = await getConversation({
        deps: { cfg, ctx, dataRoot },
        conversationId: created.record.conversationId,
      });
      const liveBindings = got.bindings.filter((b) => !b.endedAt && b.role !== "LEGACY_ALIAS");
      expect(liveBindings.every((b) => b.transcriptState === "LIVE")).toBe(true);
    });

    it("creates group conversation, attaches execution binding, keeps public default", async () => {
      const { cfg, ctx } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "COLLABORATION_GROUP",
        groupId: "team-alpha",
        agentId: "coordinator",
        title: "Sprint planning",
      });
      expect(created.binding.role).toBe("GROUP_PUBLIC");
      expect(created.record.groupId).toBe("team-alpha");

      const exec = await attachExecutionBinding({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        agentId: "helper",
        etag: created.record.etag,
      });
      expect(exec.binding.role).toBe("AGENT_EXECUTION");
      expect(exec.binding.agentId).toBe("helper");
      expect(exec.sessionKey).toContain(":execution:");
      expect(exec.sessionKey).not.toBe(created.sessionKey);

      const lineage = await getConversationLineage({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      expect(lineage.lineage.publicSessionKey).toBe(created.sessionKey);
      expect(lineage.lineage.executionSessionKeys).toContain(exec.sessionKey);
      // Default history binding is public, not execution
      const publicBindings = lineage.bindings.filter((b) => b.role === "GROUP_PUBLIC");
      expect(publicBindings).toHaveLength(1);

      // End execution when bot leaves
      const { endExecutionBinding } = await import("./index.js");
      const ended = await endExecutionBinding({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        agentId: "helper",
        etag: lineage.record.etag,
      });
      expect(ended.binding?.endedAt).toBeTruthy();
      const lineage2 = await getConversationLineage({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      expect(lineage2.lineage.executionSessionKeys).not.toContain(exec.sessionKey);
    });

    it("updates shared task context with evidence-backed decisions and builds injection", async () => {
      const { cfg, ctx } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "COLLABORATION_GROUP",
        groupId: "team-alpha",
        title: "Mission",
      });
      const empty = await getSharedTaskContextForConversation({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      expect(empty.revision).toBe(0);

      const updated = await updateSharedTaskContextForConversation({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        expectedRevision: 0,
        patch: {
          mission: "Ship release",
          currentPhase: "build",
          approvedDecisions: [
            {
              decisionId: "d1",
              text: "Use freeze window",
              status: "APPROVED",
              evidenceRefs: ["msrc_1"],
            },
          ],
          hardConstraints: [{ text: "No PII in shared notes", evidenceRefs: ["msrc_2"] }],
        },
      });
      expect(updated.revision).toBe(1);
      expect(updated.approvedDecisions).toHaveLength(1);

      const addition = buildSharedTaskSystemPromptAddition({ context: updated, maxTokens: 400 });
      expect(addition).toContain("Shared Task Context");
      expect(addition).toContain("Ship release");
      expect(addition).toContain("Use freeze window");
    });

    it("denies shared task after member removed from group (same request cycle)", async () => {
      const { cfg, ctx } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "COLLABORATION_GROUP",
        groupId: "team-alpha",
        title: "ACL",
      });
      // Member still in groupIds — ok
      await expect(
        getSharedTaskContextForConversation({
          deps: { cfg, ctx },
          conversationId: created.record.conversationId,
        }),
      ).resolves.toBeTruthy();

      // Simulate member removal: principal no longer has groupId
      const removedCtx = { ...ctx, groupIds: [] as string[] };
      await expect(
        getSharedTaskContextForConversation({
          deps: { cfg, ctx: removedCtx },
          conversationId: created.record.conversationId,
        }),
      ).rejects.toThrow(/NOT_OWNER_OR_MEMBER|not/i);
    });

    it("proposed decisions do not inject; execution stream not default history", async () => {
      const { cfg, ctx } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "COLLABORATION_GROUP",
        groupId: "team-alpha",
        title: "Propose",
      });
      const updated = await updateSharedTaskContextForConversation({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        expectedRevision: 0,
        patch: {
          approvedDecisions: [
            {
              decisionId: "p1",
              text: "Unapproved secret plan",
              status: "PROPOSED",
              evidenceRefs: [],
            },
          ],
        },
      });
      const addition = buildSharedTaskSystemPromptAddition({ context: updated });
      expect(addition ?? "").not.toContain("Unapproved secret plan");

      await attachExecutionBinding({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
        agentId: "worker",
        etag: created.record.etag,
      });
      const { selectDefaultHistoryBinding } = await import("./collaboration-bindings.js");
      const lineage = await getConversationLineage({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      const def = selectDefaultHistoryBinding(lineage.bindings);
      expect(def?.role).toBe("GROUP_PUBLIC");
    });
  });

  describe("P4 search / admission / retention / export", () => {
    it("searches by title after ACL", async () => {
      const { cfg, ctx } = setup();
      await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Quarterly budget review",
      });
      await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Unrelated notes",
      });
      const result = await searchConversationsService({
        deps: { cfg, ctx },
        query: { query: "budget", agentId: "helper" },
      });
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      expect(result.hits[0]?.title.toLowerCase()).toContain("budget");
      expect(result.hits[0]?.matchReasons).toContain("title");
    });

    it("admits explicit remember and rejects tool-only candidates", () => {
      const explicit = detectAdmissionSignals({
        text: "Please remember that I prefer dark mode",
        sourceIdentityIds: ["msrc_1"],
      });
      expect(
        evaluateMemoryAdmission({
          text: "Please remember that I prefer dark mode",
          sourceIdentityIds: ["msrc_1"],
          signals: explicit,
          scopeVisibility: "private",
        }).admitted,
      ).toBe(true);

      const toolOnly = detectAdmissionSignals({
        text: "stack trace ...",
        sourceIdentityIds: ["msrc_2"],
        isToolOutput: true,
      });
      expect(
        evaluateMemoryAdmission({
          text: "stack trace ...",
          sourceIdentityIds: ["msrc_2"],
          signals: toolOnly,
          scopeVisibility: "private",
        }).admitted,
      ).toBe(false);
    });

    it("evaluates retention tiers from idle time", () => {
      expect(parseDurationToDays("P30D")).toBe(30);
      const policy = buildDefaultRetentionPolicy({
        dataPlaneId: "dp_test",
        tenantId: null,
      });
      const now = Date.parse("2026-07-17T00:00:00.000Z");
      const record = {
        schemaVersion: 1 as const,
        conversationId: "conv_x",
        dataPlaneId: "dp_test",
        tenantId: null,
        ownershipScopeType: "USER" as const,
        ownershipScopeId: "u1",
        createdByUserId: "u1",
        surfaceType: "AGENT" as const,
        agentId: "helper",
        groupId: null,
        title: "Old",
        titleSource: "AUTO" as const,
        lifecycleStatus: "ACTIVE" as const,
        lifecycleStatusBeforeArchive: null,
        storageTier: "HOT" as const,
        retentionState: "RETAIN" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        closedAt: null,
        archivedAt: null,
        deletedAt: null,
        lastMessageAt: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        participantIds: ["u1"],
        primaryBindingId: "b1",
        etag: "e1",
      };
      const evaluation = evaluateConversationRetention({
        record,
        policy,
        nowMs: now,
      });
      expect(evaluation.idleDays).toBeGreaterThan(100);
      expect(evaluation.actions.some((a) => a.type === "SET_STORAGE_TIER")).toBe(true);
    });

    it("exports conversation metadata under data root", async () => {
      const { cfg, ctx, dataRoot } = setup();
      const created = await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Export me",
      });
      const result = await exportConversationService({
        deps: { cfg, ctx },
        conversationId: created.record.conversationId,
      });
      expect(result.exportDir.startsWith(dataRoot)).toBe(true);
      expect(result.manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
      const manifestPath = path.join(result.exportDir, "manifest.json");
      const body = await fs.readFile(manifestPath, "utf-8");
      expect(body).toContain(created.record.conversationId);
    });

    it("retention scan runs without enforce by default", async () => {
      const { cfg, ctx } = setup();
      await createConversation({
        deps: { cfg, ctx },
        surfaceType: "AGENT",
        agentId: "helper",
        title: "Scan me",
      });
      const scan = await runRetentionScan({
        deps: { cfg, ctx },
        enforce: false,
      });
      expect(scan.evaluated.length).toBeGreaterThanOrEqual(1);
      expect(scan.mutated).toBe(0);
    });
  });
});
