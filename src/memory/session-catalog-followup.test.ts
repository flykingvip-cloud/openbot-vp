/**
 * Catalog identity alignment + Memory Center deny + provenance synthesis tests.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMemorySourceIdentity } from "../conversations/ids.js";
import {
  ensureConversationForSession,
  resolveConversationCatalogPath,
  resolveConversationTenantContext,
  SqliteConversationCatalog,
  synthesizeLegacyRowsFromProvenanceLocators,
  syncSealedSessionRangesToCatalog,
} from "../conversations/index.js";
import {
  commitTranscriptRangeRevoked,
  resolveRecallDenyStoreDir,
} from "../conversations/memory-recall-deny.js";
import { filterMemoryCenterItemsByDeny, loadRecallDenySets } from "./recall-deny-filter.js";
import { resolveSessionCatalogIdentity } from "./session-catalog-identity.js";
import {
  appendSealedRanges,
  emptySessionSourceIndex,
  listDeniedAtomIdsFromSessionIndexes,
  resolveSessionSourceIndexDir,
  saveSessionSourceIndex,
} from "./session-source-index.js";

describe("session catalog follow-up", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function tmpDir(label: string): string {
    const dir = path.join(
      os.tmpdir(),
      `openbot-scf-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(dir);
    return dir;
  }

  it("resolves seal identity from Catalog binding", async () => {
    const dataRoot = tmpDir("catalog");
    const catalog = new SqliteConversationCatalog({
      path: resolveConversationCatalogPath({ dataRoot }),
    });
    const cfg = { data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 } };
    const ctx = resolveConversationTenantContext({ cfg, principalId: "u1" });
    const mapped = await ensureConversationForSession({
      catalog,
      ctx,
      sessionKey: "agent:helper:main",
      sessionId: "sess-catalog-1",
    });
    catalog.close();

    const ids = await resolveSessionCatalogIdentity({
      cfg,
      dataRoot,
      sessionId: "sess-catalog-1",
      sessionKey: "agent:helper:main",
    });
    expect(ids.source).toBe("catalog");
    expect(ids.conversationId).toBe(mapped.record.conversationId);
    expect(ids.bindingId).toBe(mapped.binding.bindingId);
  });

  it("filters Memory Center items by denied sealed atom ids", async () => {
    const dataRoot = tmpDir("mc");
    const indexDir = resolveSessionSourceIndexDir(dataRoot);
    const sessionFile = path.join(dataRoot, "s.jsonl");
    let index = emptySessionSourceIndex({
      sessionFile,
      sessionId: "s",
      dataPlaneId: "dp1",
      conversationId: "c1",
      bindingId: "b1",
    });
    const identity = buildMemorySourceIdentity({
      dataPlaneId: "dp1",
      conversationId: "c1",
      bindingId: "b1",
      sessionId: "s",
      firstTurnId: "m0",
      lastTurnId: "m1",
      turnIndexRange: [0, 1],
      contentChecksum: "x",
    });
    index = appendSealedRanges(
      index,
      [
        {
          identity,
          pathAlias: "sessions/s.jsonl",
          atomIds: ["atom_denied", "atom_keep_other"],
          evidenceIds: ["ev1"],
        },
      ],
      {
        schemaVersion: 1,
        dataPlaneId: "dp1",
        bindingId: "b1",
        sessionId: "s",
        lastSealedTurnId: "m1",
        lastSealedTurnIndex: 1,
        lastContentChecksum: "x",
        updatedAt: new Date().toISOString(),
      },
    );
    // Only mark identity as denied for atom_denied path — both atoms share identity in this fixture,
    // so both should drop when identity is denied.
    await saveSessionSourceIndex({ indexDir, index });

    await commitTranscriptRangeRevoked({
      storeDir: resolveRecallDenyStoreDir(dataRoot),
      sessionFile,
      boundaryTurnId: "m0",
      deniedSourceIdentityIds: [identity.sourceIdentityId],
    });
    const sets = await loadRecallDenySets(dataRoot);
    const deniedAtoms = await listDeniedAtomIdsFromSessionIndexes({
      indexDir,
      deniedSourceIdentityIds: sets.sourceIdentityIds,
    });
    expect(deniedAtoms.has("atom_denied")).toBe(true);

    const items = [
      { id: "atom_denied", summary: "secret from tail" },
      { id: "atom_ok", summary: "still valid" },
    ];
    const filtered = filterMemoryCenterItemsByDeny(items, { deniedAtomIds: deniedAtoms, sets });
    expect(filtered.map((i) => i.id)).toEqual(["atom_ok"]);
  });

  it("synthesizes legacy rows from provenance locators and skips msrc", () => {
    const rows = synthesizeLegacyRowsFromProvenanceLocators({
      dataPlaneId: "dp1",
      locators: [
        { locator: "sessions/agent/a.jsonl" },
        { locator: "msrc://already" },
        { locator: "sessions/agent/a.jsonl" },
        { locator: "document://memory/notes.md", checksum: "abc" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.sourceLocator.startsWith("msrc"))).toBe(true);
  });

  it("syncs sealed ranges into Catalog source identities", async () => {
    const dataRoot = tmpDir("sync");
    const catalog = new SqliteConversationCatalog({
      path: resolveConversationCatalogPath({ dataRoot }),
    });
    const ctx = resolveConversationTenantContext({
      cfg: { data: { root: dataRoot, mode: "local", schemaVersion: 1 } },
      principalId: "u1",
    });
    const mapped = await ensureConversationForSession({
      catalog,
      ctx,
      sessionKey: "agent:helper:main",
      sessionId: "sync-sess",
    });
    const indexDir = resolveSessionSourceIndexDir(dataRoot);
    const sessionFile = path.join(dataRoot, "sync-sess.jsonl");
    const identity = buildMemorySourceIdentity({
      dataPlaneId: ctx.dataPlaneId,
      conversationId: mapped.record.conversationId,
      bindingId: mapped.binding.bindingId,
      sessionId: "sync-sess",
      firstTurnId: "t0",
      lastTurnId: "t1",
      turnIndexRange: [0, 1],
      contentChecksum: "cc",
    });
    let index = emptySessionSourceIndex({
      sessionFile,
      sessionId: "sync-sess",
      dataPlaneId: ctx.dataPlaneId,
      conversationId: mapped.record.conversationId,
      bindingId: mapped.binding.bindingId,
    });
    index = appendSealedRanges(
      index,
      [{ identity, pathAlias: "sessions/sync-sess.jsonl", atomIds: ["a1"] }],
      {
        schemaVersion: 1,
        dataPlaneId: ctx.dataPlaneId,
        bindingId: mapped.binding.bindingId,
        sessionId: "sync-sess",
        lastSealedTurnId: "t1",
        lastSealedTurnIndex: 1,
        lastContentChecksum: "cc",
        updatedAt: new Date().toISOString(),
      },
    );
    await saveSessionSourceIndex({ indexDir, index });

    const result = await syncSealedSessionRangesToCatalog({ catalog, indexDir });
    expect(result.synced).toBe(1);
    const stored = await catalog.getSourceIdentity(ctx.dataPlaneId, identity.sourceIdentityId);
    expect(stored?.firstTurnId).toBe("t0");
    const aliases = await catalog.listLocatorAliases(ctx.dataPlaneId, identity.sourceIdentityId);
    expect(aliases.some((a) => a.locator.includes("sync-sess"))).toBe(true);
    catalog.close();
  });
});
