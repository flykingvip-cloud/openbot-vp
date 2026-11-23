// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { KB_CHUNKS_TABLE, KB_CHUNK_META_TABLE } from "./kb-index-schema.js";
import {
  deleteKnowledgeDocumentFromIndex,
  getKnowledgeDocument,
  listKnowledgeChunksMissingVectors,
  upsertKnowledgeChunks,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import { getKnowledgeVectorizeQueueRow } from "./vectorize-queue-store.js";
import { tickKnowledgeVectorizeJobs } from "./vectorize-runtime.js";

let indexRoot: string;

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-vec-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("tickKnowledgeVectorizeJobs", () => {
  it("does not burn retries when no embedding provider is available", async () => {
    const ingested = await ingestKnowledgeDocument({
      kbId: "kb-vec",
      docId: "doc-vec",
      title: "Queued",
      fileName: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nBackground vectorize later.\n", "utf8"),
      ownerId: "user-vec",
      tenantId: null,
      indexRoot,
      deferEmbedding: true,
    });
    expect(ingested.vectorizeQueued).toBe(true);

    const skipped = await tickKnowledgeVectorizeJobs({
      indexRoot,
      embeddingProvider: null,
    });
    expect(skipped.processed).toBe(0);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-vec",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const row = getKnowledgeVectorizeQueueRow(index.db, "kb-vec", "doc-vec");
      expect(row?.status).toBe("pending");
      expect(row?.attempts).toBe(0);
    } finally {
      index.close();
    }

    const processed = await tickKnowledgeVectorizeJobs({
      indexRoot,
      embeddingProvider: mockProvider,
    });
    const after = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const row = getKnowledgeVectorizeQueueRow(after.db, "kb-vec", "doc-vec");
      if (processed.vectorized > 0) {
        expect(row?.status).toBe("done");
      } else {
        expect(row?.status).toBe("pending");
        expect(row?.attempts).toBe(0);
      }
    } finally {
      after.close();
    }
  });
  it("never reinserts deleted or replaced chunk identity in an existing-only commit", async () => {
    const first = await ingestKnowledgeDocument({
      kbId: "kb-conditional",
      docId: "doc-conditional",
      title: "Queued",
      fileName: "queued.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Original pending background embedding content."),
      ownerId: "user-vec",
      tenantId: null,
      indexRoot,
      deferEmbedding: true,
    });
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-vec", tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const versionId = first.versionId!;
      const chunks = listKnowledgeChunksMissingVectors({
        db: index.db,
        docId: "doc-conditional",
        versionId,
      });
      expect(chunks.length).toBeGreaterThan(0);
      const rows = chunks.map((chunk) => ({
        ...chunk,
        id: chunk.chunkId,
        docId: "doc-conditional",
        versionId,
        model: "mock",
      }));
      expect(upsertKnowledgeChunks({ index, chunks: rows, existingOnly: true })).toBe(
        chunks.length,
      );
      expect(
        upsertKnowledgeChunks({
          index,
          chunks: rows.map((row) => ({ ...row, kbId: "another-kb" })),
          existingOnly: true,
        }),
      ).toBe(0);
      index.db
        .prepare("UPDATE documents SET current_version_id = ? WHERE doc_id = ?")
        .run("replacement", "doc-conditional");
      expect(upsertKnowledgeChunks({ index, chunks: rows, existingOnly: true })).toBe(0);
      deleteKnowledgeDocumentFromIndex({ db: index.db, index, docId: "doc-conditional" });
      expect(upsertKnowledgeChunks({ index, chunks: rows, existingOnly: true })).toBe(0);
      expect(getKnowledgeDocument(index.db, "doc-conditional")).toBeNull();
      expect(index.db.prepare(`SELECT count(*) AS n FROM ${KB_CHUNKS_TABLE}`).get()).toMatchObject({
        n: 0,
      });
      expect(
        index.db.prepare(`SELECT count(*) AS n FROM ${KB_CHUNK_META_TABLE}`).get(),
      ).toMatchObject({ n: 0 });
    } finally {
      index.close();
    }
  });

  it("does not revive chunks when deletion runs during awaited background embedding", async (context) => {
    const ingested = await ingestKnowledgeDocument({
      kbId: "kb-race",
      docId: "doc-race",
      title: "Race",
      fileName: "race.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "An in-flight background embedding must never recreate these deleted source chunks.",
      ),
      ownerId: "user-vec",
      tenantId: null,
      indexRoot,
      deferEmbedding: true,
    });
    expect(ingested.vectorizeQueued).toBe(true);
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-vec", tenantId: null, indexRoot });
    const probe = await openKnowledgeIndex({ dbPath, vectorEnabled: true });
    const available = probe.vectorAvailable;
    probe.close();
    if (!available) {
      context.skip();
      return;
    }
    let embedded = false;
    const result = await tickKnowledgeVectorizeJobs({
      indexRoot,
      embeddingProvider: {
        ...mockProvider,
        embedBatch: async (texts) => {
          embedded = true;
          const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
          try {
            deleteKnowledgeDocumentFromIndex({ db: index.db, index, docId: "doc-race" });
          } finally {
            index.close();
          }
          return mockProvider.embedBatch(texts);
        },
      },
    });
    expect(embedded).toBe(true);
    expect(result.vectorized).toBe(0);
    const after = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(getKnowledgeDocument(after.db, "doc-race")).toBeNull();
      expect(
        after.db.prepare(`SELECT count(*) AS n FROM ${KB_CHUNK_META_TABLE}`).get(),
      ).toMatchObject({ n: 0 });
    } finally {
      after.close();
    }
  });
});
