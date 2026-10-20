// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import {
  buildKnowledgeEvidenceUri,
  parseKnowledgeEvidenceUri,
  retrieveKnowledgeFromIndex,
  searchKnowledgeKeyword,
} from "./kb-retrieve.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-retrieve-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("kb-retrieve", () => {
  it("round-trips ku:// evidence URIs including encoded sections", () => {
    const uri = buildKnowledgeEvidenceUri({
      kbId: "kb-personal",
      docId: "doc-resume",
      versionId: "ver-1",
      section: "基本信息",
    });
    expect(parseKnowledgeEvidenceUri(uri)).toEqual({
      kbId: "kb-personal",
      docId: "doc-resume",
      versionId: "ver-1",
      section: "基本信息",
    });
    expect(parseKnowledgeEvidenceUri("file:///tmp/resume.docx")).toBeNull();
    expect(parseKnowledgeEvidenceUri("ku://kb/only-half")).toBeNull();
  });

  it("searches indexed chunks with kb_id IN filter and current version only", async () => {
    const ownerId = "user-retrieve";
    const kbAllowed = "kb_allowed";
    const kbBlocked = "kb_blocked";

    await ingestKnowledgeDocument({
      kbId: kbAllowed,
      docId: "doc-allowed",
      title: "Allowed Policy",
      fileName: "allowed.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Refunds\n\nRefund escalation playbook for enterprise.", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    await ingestKnowledgeDocument({
      kbId: kbBlocked,
      docId: "doc-blocked",
      title: "Blocked Policy",
      fileName: "blocked.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Secrets\n\nBlocked escalation playbook hidden content.", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const hits = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "refund escalation",
        kbIds: [kbAllowed],
        model: "fts-only",
        limit: 8,
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((hit) => hit.kbId === kbAllowed)).toBe(true);
      expect(hits[0]?.docTitle).toBe("Allowed Policy");
      expect(hits[0]?.section).toBe("Refunds");

      const merged = await retrieveKnowledgeFromIndex({
        index,
        query: "refund escalation",
        kbIds: [kbAllowed],
        embeddingProvider: null,
        maxResults: 4,
      });
      expect(merged.length).toBeGreaterThan(0);
      expect(
        buildKnowledgeEvidenceUri({
          kbId: merged[0].kbId,
          docId: merged[0].docId,
          versionId: merged[0].versionId,
          section: merged[0]?.section,
        }),
      ).toMatch(/^ku:\/\/kb\//);
    } finally {
      index.close();
    }
  });

  it("searches a historical version when versionId is provided", async () => {
    const ownerId = "user-version-search";
    const kbId = "kb-version-search";
    const docId = "doc-version-search";
    const base = {
      kbId,
      docId,
      title: "Policy",
      fileName: "policy.txt",
      mimeType: "text/plain",
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    };

    const v1 = await ingestKnowledgeDocument({
      ...base,
      buffer: Buffer.from("Legacy refund escalation policy from last year.", "utf8"),
    });
    const v2 = await ingestKnowledgeDocument({
      ...base,
      buffer: Buffer.from("Current refund escalation policy for this year.", "utf8"),
    });
    expect(v1.versionId).toBeTruthy();
    expect(v2.versionId).toBeTruthy();

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const currentOnly = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "legacy refund escalation",
        kbIds: [kbId],
        model: "fts-only",
        limit: 8,
      });
      expect(currentOnly.some((hit) => hit.versionId === v1.versionId)).toBe(false);

      const pinnedCurrent = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "current refund escalation",
        kbIds: [kbId],
        model: "fts-only",
        limit: 8,
        versionId: v2.versionId ?? undefined,
      });
      expect(pinnedCurrent.length).toBeGreaterThan(0);
      expect(pinnedCurrent.every((hit) => hit.versionId === v2.versionId)).toBe(true);

      const unknownVersion = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "current refund escalation",
        kbIds: [kbId],
        model: "fts-only",
        limit: 8,
        versionId: "version-does-not-exist",
      });
      expect(unknownVersion).toEqual([]);

      const merged = await retrieveKnowledgeFromIndex({
        index,
        query: "current refund escalation",
        kbIds: [kbId],
        embeddingProvider: null,
        maxResults: 4,
        versionId: v2.versionId ?? undefined,
      });
      expect(merged.length).toBeGreaterThan(0);
      expect(merged[0]?.versionId).toBe(v2.versionId);
    } finally {
      index.close();
    }
  });

  it("relaxes AND-only FTS so extra question words still hit indexed chunks", async () => {
    const ownerId = "user-or-search";
    const kbId = "kb-or-search";
    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-or-search",
      title: "市场助手内部产品备忘",
      fileName: "memo.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("内部产品代号 MK-FrostKoi-2026 OBKB BOT2 CANARY", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const hits = searchKnowledgeKeyword({
        db: index.db,
        ftsAvailable: index.ftsAvailable,
        query: "请查询知识库 OBKB CANARY 只根据知识库作答",
        kbIds: [kbId],
        model: null,
        limit: 8,
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.kbId).toBe(kbId);

      const throwingEmbed = {
        id: "fake-embed",
        model: "fake-embed",
        embedQuery: async () => {
          throw new Error("embed down");
        },
        embedBatch: async () => {
          throw new Error("embed down");
        },
      };
      const recovered = await retrieveKnowledgeFromIndex({
        index,
        query: "市场助手内部产品备忘 内部产品代号",
        kbIds: [kbId],
        embeddingProvider: throwingEmbed,
        maxResults: 4,
      });
      expect(recovered.length).toBeGreaterThan(0);

      const fallback = await retrieveKnowledgeFromIndex({
        index,
        query: "最佳实践",
        kbIds: [kbId],
        embeddingProvider: null,
        maxResults: 4,
        fallbackToCurrentChunks: true,
      });
      expect(fallback.length).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });
});
