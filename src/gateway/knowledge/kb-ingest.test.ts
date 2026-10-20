// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { computeSemanticContentHash } from "./document-fingerprint.js";
import {
  getKnowledgeDocument,
  listKnowledgeChunkMetaForVersion,
  listKnowledgeChunksForVersion,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import { getKnowledgeVectorizeQueueRow } from "./vectorize-queue-store.js";

let indexRoot: string;

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-ingest-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("kb-ingest", () => {
  it("applies chunk-level delta on semantic rewrite (keep unchanged slots)", async () => {
    const docId = "doc-chunk-delta";
    const v1 = Buffer.from(
      ["# Title", "", "Stable paragraph one.", "", "## Other", "", "Will change later."].join("\n"),
      "utf8",
    );
    const first = await ingestKnowledgeDocument({
      kbId: "kb-delta",
      docId,
      title: "Delta Doc",
      fileName: "delta.md",
      mimeType: "text/markdown",
      buffer: v1,
      ownerId: "user-delta",
      tenantId: null,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(first.skipped).toBe(false);
    expect(first.chunkCount).toBeGreaterThan(0);

    const v2 = Buffer.from(
      [
        "# Title",
        "",
        "Stable paragraph one.",
        "",
        "## Other",
        "",
        "Changed paragraph two with more detail.",
      ].join("\n"),
      "utf8",
    );
    const second = await ingestKnowledgeDocument({
      kbId: "kb-delta",
      docId,
      title: "Delta Doc",
      fileName: "delta.md",
      mimeType: "text/markdown",
      buffer: v2,
      ownerId: "user-delta",
      tenantId: null,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(second.skipped).toBe(false);
    expect(second.delta).toBe("new_semantic_version");
    expect(second.chunkDelta).toBeDefined();
    expect(second.chunkDelta!.kept).toBeGreaterThanOrEqual(1);
    expect(second.chunkDelta!.updated + second.chunkDelta!.added).toBeGreaterThanOrEqual(1);
    expect(second.chunkDelta!.embedCount).toBeLessThan(second.chunkCount);
  });

  it("ingests markdown with heading-aware chunks and split-table writes", async () => {
    const docId = "doc-ingest-1";
    const buffer = Buffer.from(
      [
        "# Sales Policy",
        "",
        "Enterprise onboarding baseline.",
        "",
        "## Refunds",
        "",
        "Refund requests must include order id.",
      ].join("\n"),
      "utf8",
    );

    const result = await ingestKnowledgeDocument({
      kbId: "kb-ingest",
      docId,
      title: "Sales Policy",
      fileName: "policy.md",
      mimeType: "text/markdown",
      buffer,
      ownerId: "user-ingest",
      tenantId: null,
      indexRoot,
      embeddingProvider: mockProvider,
    });

    expect(result.skipped).toBe(false);
    expect(result.delta).toBe("new_semantic_version");
    expect(result.versionLabel).toBe("V1");
    expect(result.chunkCount).toBeGreaterThan(0);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-ingest",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const doc = getKnowledgeDocument(index.db, docId);
      expect(doc?.currentVersionId).toBe(result.versionId);
      const meta = listKnowledgeChunkMetaForVersion({
        db: index.db,
        docId,
        versionId: result.versionId!,
      });
      expect(meta.some((entry) => entry.section === "Refunds")).toBe(true);
      expect(meta.some((entry) => entry.heading === "Sales Policy")).toBe(true);
    } finally {
      index.close();
    }
  });

  it("preserves document version history and points chunks at current version (P4)", async () => {
    const docId = "doc-versioned";
    const base = {
      kbId: "kb-versioned",
      docId,
      title: "Versioned Doc",
      fileName: "note.txt",
      mimeType: "text/plain",
      ownerId: "user-versioned",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    };

    const v1 = await ingestKnowledgeDocument({
      ...base,
      buffer: Buffer.from("Version one body", "utf8"),
    });
    expect(v1.versionLabel).toBe("V1");

    const v2 = await ingestKnowledgeDocument({
      ...base,
      buffer: Buffer.from("Version two body", "utf8"),
    });
    expect(v2.versionLabel).toBe("V2");
    expect(v2.delta).toBe("new_semantic_version");

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-versioned",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      // Document-level version rows remain for lineage / delta classification.
      const versions = listKnowledgeDocumentVersions(index.db, docId);
      expect(versions.map((entry) => entry.versionLabel)).toEqual(["V1", "V2"]);
      expect(getKnowledgeDocument(index.db, docId)?.currentVersionId).toBe(v2.versionId);

      // P4: chunk rows are rewritten in place and retargeted to the current version_id.
      // Historical chunk bodies are not retained as separate versioned rows (stable anchors).
      const v1Meta = listKnowledgeChunkMetaForVersion({
        db: index.db,
        docId,
        versionId: v1.versionId!,
      });
      const v2Meta = listKnowledgeChunkMetaForVersion({
        db: index.db,
        docId,
        versionId: v2.versionId!,
      });
      expect(v1Meta.length).toBe(0);
      expect(v2Meta.length).toBeGreaterThan(0);
      expect((v2.chunkDelta?.updated ?? 0) + (v2.chunkDelta?.added ?? 0)).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });

  it("skips chunk rebuild on unchanged ingest", async () => {
    const buffer = Buffer.from("Stable semantic body", "utf8");
    const params = {
      kbId: "kb-stable",
      docId: "doc-stable",
      title: "Stable",
      fileName: "stable.txt",
      mimeType: "text/plain",
      buffer,
      ownerId: "user-stable",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    };
    const first = await ingestKnowledgeDocument(params);
    expect(first.chunkCount).toBeGreaterThan(0);

    const second = await ingestKnowledgeDocument(params);
    expect(second.delta).toBe("unchanged");
    expect(second.skipped).toBe(true);
    expect(second.chunkCount).toBe(0);
  });

  it("updates raw hash only when semantic hash is unchanged", async () => {
    const body = "Same semantic body";
    const semantic = computeSemanticContentHash(body);
    const first = await ingestKnowledgeDocument({
      kbId: "kb-raw",
      docId: "doc-raw",
      title: "Raw delta",
      fileName: "a.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(body, "utf8"),
      ownerId: "user-raw",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const second = await ingestKnowledgeDocument({
      kbId: "kb-raw",
      docId: "doc-raw",
      title: "Raw delta",
      fileName: "b.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`${body} `, "utf8"),
      ownerId: "user-raw",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    expect(second.delta).toBe("raw_only");
    expect(second.skipped).toBe(true);
    expect(second.versionId).toBe(first.versionId);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-raw",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const versions = listKnowledgeDocumentVersions(index.db, "doc-raw");
      expect(versions).toHaveLength(1);
      expect(versions[0]?.semanticHash).toBe(semantic);
      expect(versions[0]?.rawHash).toBe(second.extracted.rawHash);
    } finally {
      index.close();
    }
  });

  it("degrades to FTS-only when embedding provider returns 429", async () => {
    const rateLimited: EmbeddingProvider = {
      id: "gemini",
      model: "text-embedding-004",
      embedQuery: async () => {
        throw Object.assign(new Error("gemini embeddings failed: 429"), { status: 429 });
      },
      embedBatch: async () => {
        throw Object.assign(new Error("gemini embeddings failed: 429"), { status: 429 });
      },
    };

    const result = await ingestKnowledgeDocument({
      kbId: "kb-rate",
      docId: "doc-rate",
      title: "Rate Limited",
      fileName: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nBody under rate limit.\n", "utf8"),
      ownerId: "user-rate",
      tenantId: null,
      indexRoot,
      embeddingProvider: rateLimited,
    });

    expect(result.skipped).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-rate",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const chunks = listKnowledgeChunksForVersion({
        db: index.db,
        docId: "doc-rate",
        versionId: result.versionId!,
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.map((entry) => entry.model)).toEqual(chunks.map(() => "fts-only"));
    } finally {
      index.close();
    }
  });

  it("defers embedding and queues background vectorize", async () => {
    const result = await ingestKnowledgeDocument({
      kbId: "kb-defer",
      docId: "doc-defer",
      title: "Deferred",
      fileName: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nSave returns before sqlite-vec.\n", "utf8"),
      ownerId: "user-defer",
      tenantId: null,
      indexRoot,
      embeddingProvider: mockProvider,
      deferEmbedding: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.vectorizeQueued).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-defer",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const queued = getKnowledgeVectorizeQueueRow(index.db, "kb-defer", "doc-defer");
      expect(queued?.status).toBe("pending");
      expect(queued?.attempts).toBe(0);
      const chunks = listKnowledgeChunksForVersion({
        db: index.db,
        docId: "doc-defer",
        versionId: result.versionId!,
      });
      expect(chunks.map((entry) => entry.model)).toEqual(chunks.map(() => "fts-only"));
    } finally {
      index.close();
    }
  });
});
