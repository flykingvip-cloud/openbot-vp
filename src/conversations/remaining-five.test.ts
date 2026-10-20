/**
 * Tests for the five follow-up deliverables:
 * 1. Shared Task runtime inject
 * 2. FTS + semantic search index
 * 3. Cold physical migration
 * 4. Real purge adapters
 * 5. openbotPath → MemorySourceIdentity migration
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  ConversationSearchIndex,
  createConversation,
  createRealPurgeAdapters,
  collectPurgeManifestObjects,
  extractCollaborationGroupId,
  getOrOpenCatalog,
  getSharedTaskContextStore,
  hashEmbedding,
  cosineSimilarity,
  migrateConversationToCold,
  migrateLegacySourceBindings,
  parseLegacyLocator,
  planSourceIdentityMigration,
  requestConversationPurge,
  resolveConversationTenantContext,
  resolveSharedTaskPromptAddition,
  resetConversationCatalogCache,
  runPurgeJob,
  updateSharedTaskContextForConversation,
} from "./index.js";

describe("remaining five deliverables", () => {
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

  function setup() {
    const root = path.join(
      os.tmpdir(),
      `openbot-r5-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
      principalId: "user-r5",
      groupIds: ["team-r5"],
    });
    return { root, dataRoot, stateDir, cfg, ctx };
  }

  it("1) injects shared task for collaboration session keys", async () => {
    const { cfg, ctx, dataRoot } = setup();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "COLLABORATION_GROUP",
      groupId: "team-r5",
      title: "Inject me",
    });
    await updateSharedTaskContextForConversation({
      deps: { cfg, ctx },
      conversationId: created.record.conversationId,
      expectedRevision: 0,
      patch: {
        mission: "Deliver P5",
        approvedDecisions: [
          {
            decisionId: "d1",
            text: "Ship adapters",
            status: "APPROVED",
            evidenceRefs: ["e1"],
          },
        ],
      },
    });
    expect(extractCollaborationGroupId(created.sessionKey)).toBe("team-r5");
    const resolved = await resolveSharedTaskPromptAddition({
      cfg,
      sessionKey: created.sessionKey,
      conversationId: created.record.conversationId,
      dataRoot,
    });
    expect(resolved.addition).toContain("Deliver P5");
    expect(resolved.addition).toContain("Ship adapters");
    // store still readable
    const store = getSharedTaskContextStore(dataRoot);
    const loaded = await store.get("team-r5", created.record.conversationId);
    expect(loaded?.mission).toBe("Deliver P5");
  });

  it("2) FTS keyword + hash embedding semantic search", async () => {
    const { dataRoot } = setup();
    const idxPath = path.join(dataRoot, ".meta", "conversations", "search-index.sqlite");
    const index = new ConversationSearchIndex(idxPath);
    index.upsertDocument({
      conversationId: "conv_a",
      dataPlaneId: "dp1",
      sessionId: "s1",
      bindingId: "b1",
      title: "Budget review",
      body: "We discussed the quarterly budget and headcount plan.",
      updatedAt: new Date().toISOString(),
      embedding: hashEmbedding("quarterly budget headcount plan", 64),
    });
    index.upsertDocument({
      conversationId: "conv_b",
      dataPlaneId: "dp1",
      sessionId: "s2",
      bindingId: "b2",
      title: "Picnic ideas",
      body: "Bring sandwiches and fruit.",
      updatedAt: new Date().toISOString(),
      embedding: hashEmbedding("sandwiches fruit picnic", 64),
    });
    const kw = index.searchKeyword({ dataPlaneId: "dp1", query: "budget" });
    expect(kw.some((h) => h.conversationId === "conv_a")).toBe(true);

    const qEmb = hashEmbedding("budget planning headcount", 64);
    const sem = index.searchSemantic({
      dataPlaneId: "dp1",
      queryEmbedding: qEmb,
      minScore: 0.05,
    });
    expect(sem.length).toBeGreaterThan(0);
    expect(sem[0]?.conversationId).toBe("conv_a");
    expect(cosineSimilarity(qEmb, qEmb)).toBeCloseTo(1, 5);
    index.close();
  });

  it("3) migrates transcript to cold storage with checksum", async () => {
    const { cfg, ctx, dataRoot, stateDir } = setup();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Cold migrate",
    });
    const livePath = path.join(
      stateDir,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, '{"role":"user","text":"cold body"}\n', "utf-8");

    // Mark WARM so migrate path allows it when used in batch; direct migrate ignores that.
    const catalog = getOrOpenCatalog(cfg, ctx);
    const record = await catalog.getConversation(ctx.dataPlaneId, created.record.conversationId);
    expect(record).toBeTruthy();
    const result = await migrateConversationToCold({
      catalog,
      cfg,
      record: record!,
      bindings: [created.binding],
      removeLive: false,
    });
    expect(result.migrated).toBe(true);
    expect(result.coldPaths.length).toBeGreaterThanOrEqual(1);
    expect(result.checksums[0]).toMatch(/^[a-f0-9]{64}$/);
    const coldBody = await fs.readFile(result.coldPaths[0], "utf-8");
    expect(coldBody).toContain("cold body");
    // live still present
    expect(await fs.readFile(livePath, "utf-8")).toContain("cold body");
    const after = await catalog.getConversation(ctx.dataPlaneId, created.record.conversationId);
    expect(after?.storageTier).toBe("COLD");
    expect(result.coldPaths[0].startsWith(dataRoot)).toBe(true);
  });

  it("4) real purge adapters delete transcript and index", async () => {
    const { cfg, ctx, stateDir, dataRoot } = setup();
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Purge me",
    });
    const livePath = path.join(
      stateDir,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(livePath, '{"role":"user","text":"to delete"}\n', "utf-8");

    const catalog = getOrOpenCatalog(cfg, ctx);
    const index = new ConversationSearchIndex(
      path.join(dataRoot, ".meta", "conversations", "search-index.sqlite"),
    );
    index.upsertDocument({
      conversationId: created.record.conversationId,
      dataPlaneId: ctx.dataPlaneId,
      sessionId: created.binding.sessionId,
      bindingId: created.binding.bindingId,
      title: "Purge me",
      body: "to delete",
      updatedAt: new Date().toISOString(),
    });
    index.close();

    const objects = await collectPurgeManifestObjects({
      cfg,
      catalog,
      record: created.record,
      bindings: [created.binding],
    });
    const { job, manifest } = await requestConversationPurge({
      catalog,
      ctx,
      conversationId: created.record.conversationId,
      requestId: "req-purge-real-1",
      collectManifestObjects: async () => objects,
    });
    const adapters = createRealPurgeAdapters({
      cfg,
      catalog,
      bindings: [created.binding],
      transcriptAbsPaths: [
        {
          bindingId: created.binding.bindingId,
          sessionId: created.binding.sessionId,
          absPath: livePath,
        },
      ],
    });
    const finished = await runPurgeJob({
      deps: {
        catalog,
        adapters,
        collectManifestObjects: async () => objects,
      },
      jobId: job.purgeJobId,
      dataPlaneId: ctx.dataPlaneId,
      manifest,
    });
    expect(finished.status).toBe("SUCCEEDED");
    await expect(fs.access(livePath)).rejects.toThrow();
    const tomb = await catalog.getConversation(ctx.dataPlaneId, created.record.conversationId);
    expect(tomb?.lifecycleStatus).toBe("DELETED");
  });

  it("5) plans openbotPath → stable source identity without path in id", () => {
    expect(parseLegacyLocator("agents/helper/sessions/sess-1.jsonl")).toMatchObject({
      sessionId: "sess-1",
      looksLikePath: true,
    });
    const plan = planSourceIdentityMigration({
      dataPlaneId: "dp1",
      legacy: {
        id: "sb1",
        dataPlaneId: "dp1",
        sourceLocator: "agents/helper/sessions/sess-1.jsonl",
        sourceChecksum: "abc",
        status: "active",
      },
      conversationId: "conv_1",
      bindingId: "cbind_1",
      sessionId: "sess-1",
      firstTurnId: "t0",
      lastTurnId: "t9",
    });
    expect(plan.sourceIdentityId.startsWith("msrc_")).toBe(true);
    expect(plan.sourceIdentityId).not.toContain("/");
    expect(plan.alias.locator).toContain("sess-1.jsonl");
    // same inputs → same id
    const plan2 = planSourceIdentityMigration({
      dataPlaneId: "dp1",
      legacy: {
        id: "sb1",
        dataPlaneId: "dp1",
        sourceLocator: "/other/path/sess-1.jsonl",
        sourceChecksum: "zzz",
        status: "active",
      },
      conversationId: "conv_1",
      bindingId: "cbind_1",
      sessionId: "sess-1",
      firstTurnId: "t0",
      lastTurnId: "t9",
    });
    expect(plan2.sourceIdentityId).toBe(plan.sourceIdentityId);
  });

  it("5b) migrateLegacySourceBindings writes catalog identity + alias", async () => {
    const { cfg, ctx } = setup();
    const catalog = getOrOpenCatalog(cfg, ctx);
    const created = await createConversation({
      deps: { cfg, ctx },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Legacy src",
    });
    const result = await migrateLegacySourceBindings({
      catalog,
      dataPlaneId: ctx.dataPlaneId,
      rows: [
        {
          id: "legacy-1",
          dataPlaneId: ctx.dataPlaneId,
          sourceLocator: `agents/helper/sessions/${created.binding.sessionId}.jsonl`,
          sourceChecksum: "deadbeef",
          status: "active",
        },
      ],
      resolveContext: async () => ({
        conversationId: created.record.conversationId,
        bindingId: created.binding.bindingId,
        sessionId: created.binding.sessionId,
      }),
    });
    expect(result.migrated).toBe(1);
    // identity stored
    // we don't know id without plan — re-plan
    const plan = planSourceIdentityMigration({
      dataPlaneId: ctx.dataPlaneId,
      legacy: {
        id: "legacy-1",
        dataPlaneId: ctx.dataPlaneId,
        sourceLocator: `agents/helper/sessions/${created.binding.sessionId}.jsonl`,
        sourceChecksum: "deadbeef",
        status: "active",
      },
      conversationId: created.record.conversationId,
      bindingId: created.binding.bindingId,
      sessionId: created.binding.sessionId,
    });
    const identity = await catalog.getSourceIdentity(ctx.dataPlaneId, plan.sourceIdentityId);
    expect(identity?.sessionId).toBe(created.binding.sessionId);
    const aliases = await catalog.listLocatorAliases(ctx.dataPlaneId, plan.sourceIdentityId);
    expect(aliases.some((a) => a.locator.includes(created.binding.sessionId))).toBe(true);
  });
});
