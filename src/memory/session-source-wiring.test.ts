/**
 * Seal index, deny filter, and revoke outbox drain wiring tests.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMemorySourceIdentity } from "../conversations/ids.js";
import {
  commitTranscriptRangeRevoked,
  resolveRecallDenyStoreDir,
} from "../conversations/memory-recall-deny.js";
import {
  extractMemorySearchDenyMeta,
  filterSearchHitsByDeny,
  loadRecallDenySets,
} from "./recall-deny-filter.js";
import { wrapMemorySearchManagerWithRecallDeny } from "./recall-deny-search-wrapper.js";
import { drainRevokeOutbox } from "./revoke-outbox-drain.js";
import {
  appendSealedRanges,
  emptySessionSourceIndex,
  loadSessionSourceIndex,
  resolveSessionSourceIndexDir,
  saveSessionSourceIndex,
  selectRevokedSourceIdentityIds,
} from "./session-source-index.js";
import type { MemorySearchManager, MemorySearchResult } from "./types.js";

describe("session source wiring", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function tmpDir(label: string): string {
    const dir = path.join(
      os.tmpdir(),
      `openbot-ssw-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(dir);
    return dir;
  }

  it("persists sealed ranges and selects revoked identities after boundary", async () => {
    const dataRoot = tmpDir("index");
    const indexDir = resolveSessionSourceIndexDir(dataRoot);
    const sessionFile = path.join(dataRoot, "sessions", "abc.jsonl");
    let index = emptySessionSourceIndex({
      sessionFile,
      sessionId: "abc",
      dataPlaneId: "dp1",
      conversationId: "c1",
      bindingId: "b1",
    });
    const r0 = buildMemorySourceIdentity({
      dataPlaneId: "dp1",
      conversationId: "c1",
      bindingId: "b1",
      sessionId: "abc",
      firstTurnId: "m0",
      lastTurnId: "m3",
      turnIndexRange: [0, 3],
      contentChecksum: "aa",
    });
    const r1 = buildMemorySourceIdentity({
      dataPlaneId: "dp1",
      conversationId: "c1",
      bindingId: "b1",
      sessionId: "abc",
      firstTurnId: "m4",
      lastTurnId: "m7",
      turnIndexRange: [4, 7],
      contentChecksum: "bb",
    });
    index = appendSealedRanges(
      index,
      [
        { identity: r0, pathAlias: "sessions/a/abc.jsonl" },
        { identity: r1, pathAlias: "sessions/a/abc.jsonl" },
      ],
      {
        schemaVersion: 1,
        dataPlaneId: "dp1",
        bindingId: "b1",
        sessionId: "abc",
        lastSealedTurnId: "m7",
        lastSealedTurnIndex: 7,
        lastContentChecksum: "bb",
        updatedAt: new Date().toISOString(),
      },
    );
    await saveSessionSourceIndex({ indexDir, index });
    const loaded = await loadSessionSourceIndex({ indexDir, sessionFile });
    expect(loaded?.ranges).toHaveLength(2);

    const revoked = selectRevokedSourceIdentityIds({
      ranges: loaded!.ranges,
      boundaryTurnId: "m3",
      revokedMessageIds: ["m4", "m5", "m6", "m7"],
    });
    expect(revoked).toContain(r1.sourceIdentityId);
    expect(revoked).not.toContain(r0.sourceIdentityId);
  });

  it("filters search hits by deny watermark", async () => {
    const dataRoot = tmpDir("deny");
    const storeDir = resolveRecallDenyStoreDir(dataRoot);
    await commitTranscriptRangeRevoked({
      storeDir,
      sessionFile: path.join(dataRoot, "s.jsonl"),
      boundaryTurnId: "b1",
      deniedSourceIdentityIds: ["msrc_bad"],
      deniedMessageIds: ["m-bad"],
    });
    const sets = await loadRecallDenySets(dataRoot);
    const hits = [
      { path: "msrc://msrc_bad", snippet: "secret", score: 1 },
      { path: "sessions/ok.jsonl", snippet: "ok", score: 0.9 },
      { path: "atom://x", snippet: "also", score: 0.8 },
    ];
    const filtered = filterSearchHitsByDeny(hits, sets);
    expect(filtered.map((h) => h.path)).toEqual(["sessions/ok.jsonl", "atom://x"]);
  });

  it("production search wrapper drops hits after deny commit", async () => {
    const dataRoot = tmpDir("wrap");
    const storeDir = resolveRecallDenyStoreDir(dataRoot);
    await commitTranscriptRangeRevoked({
      storeDir,
      sessionFile: path.join(dataRoot, "s.jsonl"),
      boundaryTurnId: "b1",
      deniedMessageIds: ["msg-revoked"],
      deniedSourceIdentityIds: ["msrc_gone"],
    });

    const inner: MemorySearchManager = {
      async search() {
        return [
          {
            path: "msrc://msrc_gone",
            startLine: 1,
            endLine: 2,
            score: 1,
            snippet: "should not appear",
            source: "sessions",
          },
          {
            path: "sessions/ok.jsonl",
            startLine: 1,
            endLine: 1,
            score: 0.9,
            snippet: "safe memory",
            source: "memory",
            evidence: [
              { id: "msg-revoked", uri: "turn://msg-revoked", snippet: "x", trustScore: 1 },
            ],
          },
          {
            path: "memory/ok.md",
            startLine: 1,
            endLine: 3,
            score: 0.8,
            snippet: "keep me",
            source: "memory",
          },
        ] satisfies MemorySearchResult[];
      },
      async readFile() {
        return { text: "", path: "" };
      },
      status() {
        return { backend: "builtin", provider: "test" };
      },
      async probeEmbeddingAvailability() {
        return { ok: true };
      },
      async probeVectorAvailability() {
        return true;
      },
    };

    const wrapped = wrapMemorySearchManagerWithRecallDeny(inner, dataRoot);
    expect(wrapped).not.toBeNull();
    const hits = await wrapped!.search("secret");
    expect(hits.map((h) => h.path)).toEqual(["memory/ok.md"]);

    // Meta extractor surfaces evidence + msrc for the filter path.
    const meta = extractMemorySearchDenyMeta({
      path: "x",
      evidence: [{ id: "m1", uri: "msrc://msrc_a" }],
      explainability: { evidenceRefs: ["msrc://msrc_b", "m2"], supportingAtoms: [] },
    });
    expect(meta.sourceIdentityIds).toEqual(["msrc_a", "msrc_b"]);
    expect(meta.messageIds).toEqual(["m1", "m2"]);
  });

  it("drains revoke outbox via forgetSource", async () => {
    const dataRoot = tmpDir("outbox");
    const storeDir = resolveRecallDenyStoreDir(dataRoot);
    await commitTranscriptRangeRevoked({
      storeDir,
      sessionFile: path.join(dataRoot, "s.jsonl"),
      boundaryTurnId: "b1",
      deniedSourceIdentityIds: ["msrc_1", "msrc_2"],
    });
    const called: string[] = [];
    const result = await drainRevokeOutbox({
      storeDir,
      forgetSource: async (input) => {
        called.push(input.sourceIdentityId ?? "");
        return { ok: true };
      },
    });
    expect(result.succeeded).toBe(1);
    expect(called.toSorted()).toEqual(["msrc_1", "msrc_2"]);

    // Second drain should find nothing pending.
    const again = await drainRevokeOutbox({
      storeDir,
      forgetSource: async () => ({ ok: true }),
    });
    expect(again.processed).toBe(0);
  });
});
