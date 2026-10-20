// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordDatasetSchemaForDocument } from "./dataset-schema-store.js";
import { ensureChunkGovernanceRows } from "./governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import {
  listGovernanceEvictedChunksInIndex,
  listKnowledgeBaseDocumentsFromIndex,
  listKnowledgeBaseSnippetsFromIndex,
} from "./knowledge-base-library-content.js";
import { createKnowledgeBase, attachDocumentToKnowledgeBase } from "./knowledge-base-store.js";
import { upsertWebSourceRefreshPolicyInIndex } from "./web-source-refresh-store.js";
import { recordWebSourceSnapshotInIndex } from "./web-source-snapshot-store.js";

let indexRoot: string;
let storePath: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-library-content-${randomUUID()}`);
  storePath = path.join(os.tmpdir(), `kb-library-store-${randomUUID()}`, "bases.json");
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

describe("knowledge-base-library-content", () => {
  it("lists documents and snippets scoped to a knowledge base", async () => {
    const ownerId = "user-library";
    const kb = createKnowledgeBase(
      {
        title: "Sales KB",
        ownerId,
        tenantId: null,
      },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-sales", storePath);

    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-sales",
      title: "Sales Playbook",
      fileName: "sales.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Pricing\n\nEnterprise pricing guidance for Q2.", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const loadedKb = { ...kb, documentIds: ["doc-sales"] };
    const documents = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.title).toBe("Sales Playbook");
    expect(documents[0]?.indexed).toBe(true);

    const snippets = await listKnowledgeBaseSnippetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
      limit: 10,
    });
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0]?.docTitle).toBe("Sales Playbook");
    expect(snippets[0]?.excerpt).toContain("Enterprise pricing");
  });

  it("lists web pages and datasets from indexed content types", async () => {
    const ownerId = "user-library-types";
    const kb = createKnowledgeBase(
      {
        title: "Mixed KB",
        ownerId,
        tenantId: null,
      },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-web", storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-csv", storePath);

    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-web",
      title: "https://docs.example.com/playbook",
      fileName: "playbook.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body>Web capture</body></html>", "utf8"),
      ownerId,
      tenantId: null,
      source: "https://docs.example.com/playbook",
      indexRoot,
      embeddingProvider: null,
    });

    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-csv",
      title: "Sales export",
      fileName: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("region,revenue\nEMEA,120\n", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const loadedKb = { ...kb, documentIds: ["doc-web", "doc-csv"] };
    const { listKnowledgeBaseWebPagesFromIndex, listKnowledgeBaseDatasetsFromIndex } =
      await import("./knowledge-base-library-content.js");

    const webPages = await listKnowledgeBaseWebPagesFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(webPages).toHaveLength(1);
    expect(webPages[0]?.url).toContain("https://docs.example.com/playbook");

    const datasets = await listKnowledgeBaseDatasetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(datasets).toHaveLength(1);
    expect(datasets[0]?.format).toBe("CSV");
  });

  it("returns membership-only documents when index db is missing", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Empty KB",
        ownerId: "user-empty",
        tenantId: null,
      },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-pending", storePath);
    const loadedKb = { ...kb, documentIds: ["doc-pending"] };
    const documents = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(documents).toEqual([
      {
        docId: "doc-pending",
        title: "doc-pending",
        contentType: null,
        updatedAtMs: 0,
        indexed: false,
      },
    ]);
    const snippets = await listKnowledgeBaseSnippetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(snippets).toEqual([]);
  });

  it("computes chunk count and average trust score per document", async () => {
    const ownerId = "user-runtime-cols";
    const kb = createKnowledgeBase({ title: "Runtime KB", ownerId, tenantId: null }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-runtime", storePath);
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-runtime",
      title: "Runtime Doc",
      fileName: "runtime.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Section A\n\nAlpha content.\n\n# Section B\n\nBeta content.", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const loadedKb = { ...kb, documentIds: ["doc-runtime"] };

    // Before governance scoring: chunk count is real telemetry; trust is omitted.
    const before = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(before[0]?.chunkCount ?? 0).toBeGreaterThan(0);
    expect(before[0]?.trustScore).toBeUndefined();

    // Inject governance trust scores for the doc's chunks, then re-list.
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    let chunkIdCount = 0;
    try {
      const chunkIds = (
        index.db
          .prepare(`SELECT chunk_id FROM chunk_meta WHERE doc_id = ? AND kb_id = ?`)
          .all("doc-runtime", kb.id) as Array<{ chunk_id: string }>
      ).map((row) => row.chunk_id);
      chunkIdCount = chunkIds.length;
      expect(chunkIdCount).toBeGreaterThan(0);
      ensureChunkGovernanceRows({ db: index.db, kbId: kb.id, chunkIds });
      const update = index.db.prepare(
        `UPDATE chunk_governance SET trust_score = ? WHERE chunk_id = ?`,
      );
      chunkIds.forEach((id, i) => update.run(i === 0 ? 0.9 : 0.7, id));
    } finally {
      index.close();
    }

    const after = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(after[0]?.chunkCount).toBe(chunkIdCount);
    expect(after[0]?.trustScore).toBeGreaterThan(0);
    expect(after[0]?.trustScore).toBeLessThanOrEqual(1);
  });

  it("enriches snippets with chunk runtime governance + relation counts", async () => {
    const ownerId = "user-chunk-runtime";
    const kb = createKnowledgeBase(
      { title: "Chunk Runtime KB", ownerId, tenantId: null },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-cr", storePath);
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-cr",
      title: "Chunk Runtime Doc",
      fileName: "cr.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# A\n\nAlpha content for the chunk runtime object.", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    const loadedKb = { ...kb, documentIds: ["doc-cr"] };

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    let firstChunk = "";
    try {
      const chunkIds = (
        index.db
          .prepare(`SELECT chunk_id FROM chunk_meta WHERE doc_id = ? AND kb_id = ?`)
          .all("doc-cr", kb.id) as Array<{ chunk_id: string }>
      ).map((row) => row.chunk_id);
      expect(chunkIds.length).toBeGreaterThan(0);
      firstChunk = chunkIds[0]!;
      ensureChunkGovernanceRows({ db: index.db, kbId: kb.id, chunkIds });
      index.db
        .prepare(
          `UPDATE chunk_governance SET trust_score = ?, governance_status = ?, reference_count = ? WHERE chunk_id = ?`,
        )
        .run(0.9, "confirmed", 4, firstChunk);
      index.db
        .prepare(
          `INSERT INTO chunk_relations (id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "rel-cr",
          kb.id,
          firstChunk,
          chunkIds[chunkIds.length - 1] ?? firstChunk,
          "reference",
          1,
          Date.now(),
        );
    } finally {
      index.close();
    }

    const snippets = await listKnowledgeBaseSnippetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
      limit: 50,
    });
    const enriched = snippets.find((snippet) => snippet.chunkId === firstChunk);
    expect(enriched).toBeTruthy();
    expect(enriched?.governanceStatus).toBe("confirmed");
    expect(enriched?.trustScore).toBeCloseTo(0.9, 5);
    expect(enriched?.referenceCount).toBe(4);
    expect(enriched?.relationCount).toBeGreaterThanOrEqual(1);
  });

  it("enriches web pages with version count and freshness", async () => {
    const ownerId = "user-web-runtime";
    const kb = createKnowledgeBase({ title: "Web Runtime KB", ownerId, tenantId: null }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-web-rt", storePath);
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-web-rt",
      title: "https://example.com/page",
      fileName: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body>Web content for the runtime view.</body></html>", "utf8"),
      ownerId,
      tenantId: null,
      source: "https://example.com/page",
      indexRoot,
      embeddingProvider: null,
    });
    const loadedKb = { ...kb, documentIds: ["doc-web-rt"] };
    const { listKnowledgeBaseWebPagesFromIndex } =
      await import("./knowledge-base-library-content.js");

    const before = await listKnowledgeBaseWebPagesFromIndex({ knowledgeBase: loadedKb, indexRoot });
    const page = before.find((entry) => entry.docId === "doc-web-rt");
    expect(page).toBeTruthy();
    expect(page?.versionCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(page?.freshnessScore).toBeUndefined();

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const chunkIds = (
        index.db
          .prepare(`SELECT chunk_id FROM chunk_meta WHERE doc_id = ? AND kb_id = ?`)
          .all("doc-web-rt", kb.id) as Array<{ chunk_id: string }>
      ).map((row) => row.chunk_id);
      ensureChunkGovernanceRows({ db: index.db, kbId: kb.id, chunkIds });
      const update = index.db.prepare(
        `UPDATE chunk_governance SET freshness_score = ? WHERE chunk_id = ?`,
      );
      for (const chunkId of chunkIds) {
        update.run(0.8, chunkId);
      }
    } finally {
      index.close();
    }

    const after = await listKnowledgeBaseWebPagesFromIndex({ knowledgeBase: loadedKb, indexRoot });
    const enrichedPage = after.find((entry) => entry.docId === "doc-web-rt");
    expect(enrichedPage?.freshnessScore).toBeCloseTo(0.8, 5);
  });

  it("surfaces web snapshot change rate in the web listing", async () => {
    const ownerId = "user-web-snap";
    const kb = createKnowledgeBase({ title: "Web Snap KB", ownerId, tenantId: null }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-snap", storePath);
    const url = "https://example.com/changing";
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-snap",
      title: url,
      fileName: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body>Initial content for the page.</body></html>", "utf8"),
      ownerId,
      tenantId: null,
      source: url,
      indexRoot,
      embeddingProvider: null,
    });
    const loadedKb = { ...kb, documentIds: ["doc-snap"] };

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      recordWebSourceSnapshotInIndex(index.db, {
        kbId: kb.id,
        docId: "doc-snap",
        url,
        text: "Initial content for the page about pricing tiers.",
        fetchedAtMs: 1000,
      });
      recordWebSourceSnapshotInIndex(index.db, {
        kbId: kb.id,
        docId: "doc-snap",
        url,
        text: "Brand new content covering audit logs, SCIM provisioning, and SLA terms.",
        fetchedAtMs: 2000,
      });
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId: kb.id,
        url,
        docId: "doc-snap",
        enabled: true,
        intervalMs: 3_600_000,
        nowMs: 2000,
      });
    } finally {
      index.close();
    }

    const { listKnowledgeBaseWebPagesFromIndex } =
      await import("./knowledge-base-library-content.js");
    const pages = await listKnowledgeBaseWebPagesFromIndex({ knowledgeBase: loadedKb, indexRoot });
    const page = pages.find((entry) => entry.url === url);
    expect(page).toBeTruthy();
    expect(page?.snapshotCount).toBe(2);
    expect(page?.changeRatio).toBeGreaterThan(0);
    expect(page?.lastChangedAtMs).toBe(2000);
    expect(page?.refreshEnabled).toBe(true);
    expect(page?.refreshIntervalMs).toBe(3_600_000);
  });

  it("surfaces dataset column-level schema in the dataset listing", async () => {
    const ownerId = "user-dataset-schema";
    const kb = createKnowledgeBase({ title: "Schema KB", ownerId, tenantId: null }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-csv-schema", storePath);
    const csv = ["region,revenue,active", "EMEA,120,true", "APAC,90,false", "AMER,75,true"].join(
      "\n",
    );
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-csv-schema",
      title: "Sales export",
      fileName: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    const loadedKb = { ...kb, documentIds: ["doc-csv-schema"] };

    // Simulate the ingest-time schema hook (recordDatasetSchemaForDocument runs in the
    // shared ingest path for tabular uploads).
    const schema = await recordDatasetSchemaForDocument({
      knowledgeBase: loadedKb,
      docId: "doc-csv-schema",
      text: csv,
      fileName: "sales.csv",
      mimeType: "text/csv",
      indexRoot,
    });
    expect(schema?.columnCount).toBe(3);
    expect(schema?.rowCount).toBe(3);

    const { listKnowledgeBaseDatasetsFromIndex } =
      await import("./knowledge-base-library-content.js");
    const datasets = await listKnowledgeBaseDatasetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    const dataset = datasets.find((entry) => entry.docId === "doc-csv-schema");
    expect(dataset?.columnCount).toBe(3);
    expect(dataset?.rowCount).toBe(3);
    expect(dataset?.columns?.map((column) => column.name)).toEqual(["region", "revenue", "active"]);
  });

  it("lists governance-evicted (suppressed) chunks with reasons", async () => {
    const ownerId = "user-evicted";
    const kb = createKnowledgeBase({ title: "Evicted KB", ownerId, tenantId: null }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-ev", storePath);
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-ev",
      title: "Evicted Doc",
      fileName: "ev.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# A\n\nDuplicate content that the governance system suppressed.",
        "utf8",
      ),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    let suppressedChunk = "";
    try {
      const chunkIds = (
        index.db
          .prepare(`SELECT chunk_id FROM chunk_meta WHERE doc_id = ? AND kb_id = ?`)
          .all("doc-ev", kb.id) as Array<{ chunk_id: string }>
      ).map((row) => row.chunk_id);
      expect(chunkIds.length).toBeGreaterThan(0);
      suppressedChunk = chunkIds[0]!;
      ensureChunkGovernanceRows({ db: index.db, kbId: kb.id, chunkIds });
      index.db
        .prepare(
          `UPDATE chunk_governance SET governance_status = 'suppressed', duplicate_group_id = ? WHERE chunk_id = ?`,
        )
        .run("dup-1", suppressedChunk);

      const evicted = listGovernanceEvictedChunksInIndex(index.db, kb.id, 50);
      expect(evicted.length).toBe(1);
      expect(evicted[0]?.chunkId).toBe(suppressedChunk);
      expect(evicted[0]?.reason).toBe("duplicate");
      expect(evicted[0]?.docTitle).toBe("Evicted Doc");
      expect(evicted[0]?.excerpt.length).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });

  it("groups imported dataset records into one dataset with runtime stats", async () => {
    const ownerId = "user-dataset-runtime";
    const kb = createKnowledgeBase({ title: "Dataset KB", ownerId, tenantId: null }, storePath);
    const datasetId = "dataset:0123456789abcdef0123";
    const recordIds = [`${datasetId}:0`, `${datasetId}:1`];
    for (let i = 0; i < recordIds.length; i += 1) {
      attachDocumentToKnowledgeBase(kb.id, recordIds[i], storePath);
      await ingestKnowledgeDocument({
        kbId: kb.id,
        docId: recordIds[i],
        title: `Sales rows #${i + 1}`,
        fileName: `${recordIds[i]}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`# Sales rows #${i + 1}\n\nRegion ${i} revenue ${i * 100}.`, "utf8"),
        ownerId,
        tenantId: null,
        indexRoot,
        embeddingProvider: null,
      });
    }
    const loadedKb = { ...kb, documentIds: recordIds };
    const { listKnowledgeBaseDatasetsFromIndex } =
      await import("./knowledge-base-library-content.js");

    // Two records collapse into one logical dataset carrying a real record count.
    const grouped = await listKnowledgeBaseDatasetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.recordCount).toBe(2);
    expect(grouped[0]?.title).toBe("Sales rows");
    expect(grouped[0]?.format).toBe("Dataset");
    expect(grouped[0]?.chunkCount ?? 0).toBeGreaterThan(0);
    expect(grouped[0]?.trustScore).toBeUndefined();

    // Inject governance trust + references across both records' chunks.
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    let totalChunks = 0;
    try {
      const chunkIds = (
        index.db.prepare(`SELECT chunk_id FROM chunk_meta WHERE kb_id = ?`).all(kb.id) as Array<{
          chunk_id: string;
        }>
      ).map((row) => row.chunk_id);
      totalChunks = chunkIds.length;
      expect(totalChunks).toBeGreaterThan(0);
      ensureChunkGovernanceRows({ db: index.db, kbId: kb.id, chunkIds });
      const update = index.db.prepare(
        `UPDATE chunk_governance SET trust_score = ?, reference_count = ? WHERE chunk_id = ?`,
      );
      for (const id of chunkIds) {
        update.run(0.8, 3, id);
      }
    } finally {
      index.close();
    }

    const enriched = await listKnowledgeBaseDatasetsFromIndex({
      knowledgeBase: loadedKb,
      indexRoot,
    });
    expect(enriched).toHaveLength(1);
    expect(enriched[0]?.trustScore).toBeCloseTo(0.8, 5);
    expect(enriched[0]?.referenceCount).toBe(3 * totalChunks);
  });
});
