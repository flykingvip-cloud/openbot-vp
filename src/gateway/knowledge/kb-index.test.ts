// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import {
  ensureKnowledgeIndexSchema,
  KB_CHUNKS_TABLE,
  KB_CHUNK_META_TABLE,
} from "./kb-index-schema.js";
import {
  getKnowledgeChunkText,
  getKnowledgeDocument,
  insertKnowledgeChunks,
  insertKnowledgeDocumentVersion,
  listKnowledgeChunkMetaForVersion,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
  updateKnowledgeDocumentCurrentVersion,
  upsertKnowledgeDocument,
} from "./kb-index.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-index-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("kb-index", () => {
  it("resolves personal and tenant sqlite paths", () => {
    expect(resolveKnowledgeIndexDbPath({ ownerId: "user-1", tenantId: null, indexRoot })).toContain(
      path.join("personal", "user-1.db"),
    );
    expect(
      resolveKnowledgeIndexDbPath({ ownerId: "user-1", tenantId: "tenant/acme", indexRoot }),
    ).toContain(path.join("tenant", "tenant_acme.db"));
  });

  it("creates split tables and writes chunks into chunks + chunk_meta", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-1",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const docId = "doc-1";
      const versionId = randomUUID();
      const now = Date.now();
      upsertKnowledgeDocument({
        db: index.db,
        docId,
        kbId: "kb-1",
        title: "Playbook",
        contentType: "markdown",
        now,
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId,
        docId,
        versionLabel: "V1",
        rawHash: "raw-a",
        semanticHash: "sem-a",
        now,
      });
      updateKnowledgeDocumentCurrentVersion({ db: index.db, docId, versionId, now });

      insertKnowledgeChunks({
        index,
        chunks: [
          {
            id: "chunk-1",
            text: "Refund policy details",
            model: "fts-only",
            kbId: "kb-1",
            docId,
            versionId,
            heading: "Policy",
            section: "Refunds",
            startLine: 10,
            endLine: 12,
            visibility: "private",
            source: "policy.md",
          },
        ],
      });

      const doc = getKnowledgeDocument(index.db, docId);
      expect(doc?.currentVersionId).toBe(versionId);

      const meta = listKnowledgeChunkMetaForVersion({ db: index.db, docId, versionId });
      expect(meta).toHaveLength(1);
      expect(meta[0]?.heading).toBe("Policy");
      expect(meta[0]?.section).toBe("Refunds");
      expect(getKnowledgeChunkText(index.db, "chunk-1")).toContain("Refund policy");

      const chunkTable = index.db
        .prepare(`SELECT COUNT(*) AS count FROM ${KB_CHUNKS_TABLE}`)
        .get() as {
        count: number;
      };
      const metaTable = index.db
        .prepare(`SELECT COUNT(*) AS count FROM ${KB_CHUNK_META_TABLE}`)
        .get() as { count: number };
      expect(chunkTable.count).toBe(1);
      expect(metaTable.count).toBe(1);
    } finally {
      index.close();
    }
  });

  it("rolls back insertKnowledgeChunks when a chunk insert fails", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-txn",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const docId = "doc-txn";
      const versionId = randomUUID();
      upsertKnowledgeDocument({
        db: index.db,
        docId,
        kbId: "kb-txn",
        title: "Txn",
        contentType: "text",
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId,
        docId,
        versionLabel: "V1",
        rawHash: "raw",
        semanticHash: "sem",
      });
      updateKnowledgeDocumentCurrentVersion({ db: index.db, docId, versionId });

      const chunk = {
        id: "chunk-dup",
        text: "first",
        model: "fts-only",
        kbId: "kb-txn",
        docId,
        versionId,
        heading: null,
        section: null,
        startLine: 1,
        endLine: 1,
        visibility: null,
        source: null,
      };

      expect(() =>
        insertKnowledgeChunks({
          index,
          chunks: [chunk, { ...chunk, text: "second" }],
        }),
      ).toThrow();

      const chunkCount = index.db
        .prepare(`SELECT COUNT(*) AS count FROM ${KB_CHUNKS_TABLE}`)
        .get() as { count: number };
      expect(chunkCount.count).toBe(0);
    } finally {
      index.close();
    }
  });

  it("initializes schema tables via ensureKnowledgeIndexSchema", () => {
    const { DatabaseSync } = requireNodeSqlite();
    const dbPath = path.join(indexRoot, "schema.db");
    fs.mkdirSync(indexRoot, { recursive: true });
    const db = new DatabaseSync(dbPath);
    ensureKnowledgeIndexSchema({ db });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(["documents", "document_versions", "chunks", "chunk_meta", "meta"]),
    );
    db.close();
  });
});

describe("document version history", () => {
  it("keeps V1 and V2 rows in document_versions", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-2",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const docId = "doc-history";
      const v1 = randomUUID();
      const v2 = randomUUID();
      upsertKnowledgeDocument({
        db: index.db,
        docId,
        kbId: "kb-2",
        title: "History",
        contentType: "text",
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId: v1,
        docId,
        versionLabel: "V1",
        rawHash: "raw-v1",
        semanticHash: "sem-v1",
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId: v2,
        docId,
        versionLabel: "V2",
        rawHash: "raw-v2",
        semanticHash: "sem-v2",
      });
      updateKnowledgeDocumentCurrentVersion({ db: index.db, docId, versionId: v2 });

      const versions = listKnowledgeDocumentVersions(index.db, docId);
      expect(versions.map((entry) => entry.versionLabel)).toEqual(["V1", "V2"]);
      expect(getKnowledgeDocument(index.db, docId)?.currentVersionId).toBe(v2);
    } finally {
      index.close();
    }
  });
});
it("deletes manual summary and FTS rows without deleting another KB in the tenant index", async () => {
  const { deleteKnowledgeDocumentFromIndex, deleteKnowledgeBaseRetrievalSummaries } =
    await import("./kb-index.js");
  const { queueRetrievalSummary } = await import("./retrieval-summary-store.js");
  const index = await openKnowledgeIndex({
    dbPath: resolveKnowledgeIndexDbPath({ ownerId: "owner", tenantId: "tenant", indexRoot }),
    vectorEnabled: false,
  });
  try {
    for (const [docId, kbId] of [
      ["doc-a", "kb-a"],
      ["doc-b", "kb-b"],
    ]) {
      upsertKnowledgeDocument({
        db: index.db,
        docId,
        kbId,
        title: docId,
        contentType: "markdown",
        now: 0,
      });
      queueRetrievalSummary(index.db, { docId, kbId, versionId: "v", contentHash: "h" });
    }
    deleteKnowledgeDocumentFromIndex({ db: index.db, index, docId: "doc-a" });
    expect(
      index.db.prepare("SELECT count(*) AS n FROM retrieval_summaries WHERE doc_id='doc-a'").get()
        ?.n,
    ).toBe(0);
    expect(
      index.db.prepare("SELECT count(*) AS n FROM retrieval_summaries WHERE doc_id='doc-b'").get()
        ?.n,
    ).toBe(1);
    deleteKnowledgeBaseRetrievalSummaries(index.db, "kb-b");
    expect(index.db.prepare("SELECT count(*) AS n FROM retrieval_summaries").get()?.n).toBe(0);
    if (index.db.prepare("SELECT 1 FROM sqlite_master WHERE name='retrieval_summary_fts'").get()) {
      expect(index.db.prepare("SELECT count(*) AS n FROM retrieval_summary_fts").get()?.n).toBe(0);
    }
  } finally {
    index.close();
  }
});
