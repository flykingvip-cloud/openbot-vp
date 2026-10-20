// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
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
});
