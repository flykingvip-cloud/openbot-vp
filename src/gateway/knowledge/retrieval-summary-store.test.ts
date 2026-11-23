import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  queueRetrievalSummary,
  readRetrievalSummary,
  editRetrievalSummary,
} from "./retrieval-summary-store.js";
it("queues idempotently and does not expose metadata across KB grants", () => {
  const db = new DatabaseSync(":memory:");
  const input = { docId: "d", kbId: "private", versionId: "v1", contentHash: "h1" };
  queueRetrievalSummary(db, input);
  queueRetrievalSummary(db, input);
  expect(readRetrievalSummary(db, "d", new Set())).toBeUndefined();
  expect(readRetrievalSummary(db, "d", new Set(["private"]))?.state).toBe("pending");
  db.close();
});
it("preserves a human v1 draft and accepts a human edit for current v2", async () => {
  const db = new DatabaseSync(":memory:");
  const allowed = new Set(["k"]);
  const fields = { purpose: "v1", keyPoints: [], coverage: [], entities: [], boundaries: [] };
  expect(
    await editRetrievalSummary(db, "d", fields, async () => ({
      kbId: "k",
      versionId: "v1",
      contentHash: "h1",
    })),
  ).toBe(true);
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v2", contentHash: "h2" });
  expect(readRetrievalSummary(db, "d", allowed)).toMatchObject({
    state: "stale",
    sourceVersionId: "v1",
    currentSourceVersionId: "v2",
  });
  expect(
    await editRetrievalSummary(db, "d", { ...fields, purpose: "v2" }, async () => ({
      kbId: "k",
      versionId: "v2",
      contentHash: "h2",
    })),
  ).toBe(true);
  expect(readRetrievalSummary(db, "d", allowed)).toMatchObject({
    state: "ready",
    sourceVersionId: "v2",
    method: "human",
  });
  db.close();
});

it("does not recreate a summary when authorization awaited across document deletion", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE documents(doc_id TEXT,kb_id TEXT,current_version_id TEXT);CREATE TABLE document_versions(version_id TEXT,semantic_hash TEXT)",
  );
  db.exec(
    "INSERT INTO documents VALUES('d','kb','v');INSERT INTO document_versions VALUES('v','h')",
  );
  let resume!: () => void;
  const barrier = new Promise<void>((r) => {
    resume = r;
  });
  const fields = { purpose: "manual", keyPoints: [], coverage: [], entities: [], boundaries: [] };
  const pending = editRetrievalSummary(db, "d", fields, async () => {
    await barrier;
    return { kbId: "kb", versionId: "v", contentHash: "h" };
  });
  db.exec("DELETE FROM documents WHERE doc_id='d'");
  resume();
  expect(await pending).toBe(false);
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name='retrieval_summaries'").get(),
  ).toBeUndefined();
  db.close();
});
it("does not overwrite a newer source revision after a delayed manual authorization", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE documents(doc_id TEXT,kb_id TEXT,current_version_id TEXT);CREATE TABLE document_versions(version_id TEXT,semantic_hash TEXT)",
  );
  db.exec(
    "INSERT INTO documents VALUES('d','kb','v2');INSERT INTO document_versions VALUES('v2','h2')",
  );
  expect(
    await editRetrievalSummary(
      db,
      "d",
      { purpose: "old", keyPoints: [], coverage: [], entities: [], boundaries: [] },
      async () => ({ kbId: "kb", versionId: "v1", contentHash: "h1" }),
    ),
  ).toBe(false);
  db.close();
});
it("does not resurrect manual metadata when a KB is deleted during delayed authorization", async () => {
  const { deleteKnowledgeBaseRetrievalSummaries } = await import("./kb-index.js");
  const db = new DatabaseSync(":memory:");
  let resume!: () => void;
  const barrier = new Promise<void>((r) => {
    resume = r;
  });
  const pending = editRetrievalSummary(
    db,
    "d",
    { purpose: "manual", keyPoints: [], coverage: [], entities: [], boundaries: [] },
    async () => {
      await barrier;
      return { kbId: "kb", versionId: "v", contentHash: "h" };
    },
  );
  deleteKnowledgeBaseRetrievalSummaries(db, "kb");
  resume();
  expect(await pending).toBe(false);
  expect(db.prepare("SELECT count(*) AS n FROM retrieval_summaries").get()?.n).toBe(0);
  db.close();
});
it("rejects a delayed edit after same-id same-version reconstruction but permits the new edit", async () => {
  const {
    openKnowledgeIndex,
    resolveKnowledgeIndexDbPath,
    upsertKnowledgeDocument,
    deleteKnowledgeDocumentFromIndex,
    insertKnowledgeDocumentVersion,
    updateKnowledgeDocumentCurrentVersion,
  } = await import("./kb-index.js");
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manual-generation-"));
  const index = await openKnowledgeIndex({
    dbPath: resolveKnowledgeIndexDbPath({ ownerId: "o", tenantId: null, indexRoot: dir }),
    vectorEnabled: false,
  });
  try {
    const seed = () => {
      upsertKnowledgeDocument({
        db: index.db,
        docId: "d",
        kbId: "kb",
        title: "d",
        contentType: "markdown",
        now: 0,
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        docId: "d",
        versionId: "v",
        versionLabel: "v",
        rawHash: "raw",
        semanticHash: "h",
        now: 0,
      });
      updateKnowledgeDocumentCurrentVersion({ db: index.db, docId: "d", versionId: "v", now: 0 });
    };
    seed();
    let resume!: () => void;
    const barrier = new Promise<void>((r) => {
      resume = r;
    });
    const fields = { purpose: "old", keyPoints: [], coverage: [], entities: [], boundaries: [] };
    const pending = editRetrievalSummary(index.db, "d", fields, async () => {
      await barrier;
      return { kbId: "kb", versionId: "v", contentHash: "h" };
    });
    deleteKnowledgeDocumentFromIndex({ db: index.db, index, docId: "d" });
    seed();
    resume();
    expect(await pending).toBe(false);
    expect(
      await editRetrievalSummary(index.db, "d", { ...fields, purpose: "new" }, async () => ({
        kbId: "kb",
        versionId: "v",
        contentHash: "h",
      })),
    ).toBe(true);
    expect(readRetrievalSummary(index.db, "d", new Set(["kb"]))?.fields?.purpose).toBe("new");
  } finally {
    index.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
