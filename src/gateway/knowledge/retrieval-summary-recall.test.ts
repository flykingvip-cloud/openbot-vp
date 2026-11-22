import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { recallSummaryDocuments } from "./retrieval-summary-recall.js";
import { ensureRetrievalSummarySchema } from "./retrieval-summary-store.js";
it("finds current authorized summary after the 100th document and excludes another KB", () => {
  const db = new DatabaseSync(":memory:");
  ensureRetrievalSummarySchema(db);
  db.exec(
    "CREATE TABLE documents(doc_id TEXT,kb_id TEXT,current_version_id TEXT,title TEXT);CREATE TABLE document_versions(version_id TEXT,semantic_hash TEXT)",
  );
  for (let n = 0; n < 105; n++) {
    const id = `d${n}`;
    const kb = n === 104 ? "foreign" : "allowed";
    db.prepare("INSERT INTO documents VALUES(?,?,?,?)").run(id, kb, id, id);
    db.prepare("INSERT INTO document_versions VALUES(?,?)").run(id, id);
    const payload = {
      schemaVersion: 1,
      state: "ready",
      documentType: "report",
      sourceVersionId: id,
      sourceContentHash: id,
      templateVersion: "1",
      fields: {
        purpose: n >= 103 ? "needle" : "ordinary",
        keyPoints: [],
        coverage: [],
        entities: [],
        boundaries: [],
      },
    };
    db.prepare(
      "INSERT INTO retrieval_summaries(doc_id,kb_id,version_id,content_hash,state,method,payload,claim,updated_at) VALUES(?,?,?,?,?,NULL,?,NULL,?)",
    ).run(id, kb, id, id, "ready", JSON.stringify(payload), 0);
  }
  expect(recallSummaryDocuments(db, "allowed", "needle")).toMatchObject([
    { docId: "d103", score: 1, title: "d103" },
  ]);
  db.prepare("UPDATE documents SET current_version_id='changed' WHERE doc_id='d103'").run();
  expect(recallSummaryDocuments(db, "allowed", "needle")).toEqual([]);
  db.close();
});
