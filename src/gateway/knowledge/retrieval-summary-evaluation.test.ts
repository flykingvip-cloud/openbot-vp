import { expect, it } from "vitest";
import { retrievalSummaryText, type RetrievalSummary } from "./retrieval-summary.js";
const questions = [
  {
    query: "发票",
    purpose: "采购付款",
    keyPoints: ["无合规发票不得付款"],
    boundaries: ["仅适用正式采购合同"],
  },
  {
    query: "2026",
    purpose: "经营复盘",
    keyPoints: ["利润增长来自收入与成本率共同变化"],
    boundaries: ["仅覆盖2026年第三季度"],
  },
  {
    query: "仓库",
    purpose: "库存数据字典",
    keyPoints: ["按仓库与存货编码聚合"],
    boundaries: ["数量单位以源数据为准"],
  },
];
it("fixed question set measures new navigational terms without fabricated evidence claims", () => {
  const metrics = { baseline: 0, structured: 0, total: questions.length };
  for (const [n, item] of questions.entries()) {
    const source = { versionId: String(n), contentHash: String(n) };
    const summary: RetrievalSummary = {
      schemaVersion: 1,
      state: "ready",
      documentType: "other",
      sourceVersionId: source.versionId,
      sourceContentHash: source.contentHash,
      templateVersion: "1",
      fields: {
        purpose: item.purpose,
        keyPoints: item.keyPoints,
        coverage: [],
        entities: [],
        boundaries: item.boundaries,
      },
    };
    metrics.baseline += Number(item.purpose.includes(item.query));
    metrics.structured += Number(retrievalSummaryText(summary, source).includes(item.query));
    expect(retrievalSummaryText({ ...summary, state: "stale" }, source)).toBe("");
  }
  expect(metrics).toEqual({ baseline: 0, structured: 3, total: 3 });
  // Synthetic navigational coverage only, not corpus recall or factual quality.
});

it("local fixture index compares summary navigation, resolvable citations, KB isolation and revision invalidation", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { recallSummaryDocuments } = await import("./retrieval-summary-recall.js");
  const { ensureRetrievalSummarySchema } = await import("./retrieval-summary-store.js");
  const { parseKnowledgeEvidenceUri } = await import("./kb-retrieve.js");
  const db = new DatabaseSync(":memory:");
  ensureRetrievalSummarySchema(db);
  db.exec(
    "CREATE TABLE documents(doc_id TEXT,kb_id TEXT,current_version_id TEXT,title TEXT);CREATE TABLE document_versions(version_id TEXT,semantic_hash TEXT)",
  );
  const fixtures = [
    {
      id: "invoice-rule",
      title: "采购付款",
      query: "invoice",
      point: "No payment without invoice approval",
      boundary: "Only approved purchase contracts",
    },
    {
      id: "quarter-report",
      title: "经营复盘",
      query: "2026",
      point: "Revenue and cost rates explain profit",
      boundary: "2026 third quarter only",
    },
    {
      id: "warehouse-map",
      title: "库存数据字典",
      query: "warehouse",
      point: "Aggregate by warehouse and item code",
      boundary: "Units remain as supplied",
    },
  ];
  const metrics = {
    titleOnlyHits: 0,
    summaryNavigationHits: 0,
    resolvableSourceUris: 0,
    inaccessibleHits: 0,
    obsoleteHits: 0,
  };
  for (const fixture of fixtures) {
    db.prepare("INSERT INTO documents VALUES(?,?,?,?)").run(
      fixture.id,
      "authorized",
      fixture.id,
      fixture.title,
    );
    db.prepare("INSERT INTO document_versions VALUES(?,?)").run(fixture.id, fixture.id);
    expect(recallSummaryDocuments(db, "authorized", fixture.query)).toEqual([]);
    metrics.titleOnlyHits += Number(fixture.title.toLowerCase().includes(fixture.query));
    const summary: RetrievalSummary = {
      schemaVersion: 1,
      state: "ready",
      documentType: "report",
      sourceVersionId: fixture.id,
      sourceContentHash: fixture.id,
      templateVersion: "fixture-1",
      fields: {
        purpose: fixture.title,
        keyPoints: [fixture.point],
        coverage: [],
        entities: [],
        boundaries: [fixture.boundary],
      },
    };
    db.prepare(
      "INSERT INTO retrieval_summaries(doc_id,kb_id,version_id,content_hash,state,method,payload,claim,updated_at) VALUES(?,?,?,?,?,'human',?,NULL,0)",
    ).run(fixture.id, "authorized", fixture.id, fixture.id, "ready", JSON.stringify(summary));
    const hits = recallSummaryDocuments(db, "authorized", fixture.query);
    metrics.summaryNavigationHits += Number(hits.some((hit) => hit.docId === fixture.id));
    const parsed = parseKnowledgeEvidenceUri(hits[0]?.sourceUri ?? "");
    metrics.resolvableSourceUris += Number(
      parsed?.docId === fixture.id &&
        parsed.kbId === "authorized" &&
        parsed.versionId === fixture.id,
    );
    metrics.inaccessibleHits += recallSummaryDocuments(db, "foreign", fixture.query).length;
    db.prepare("UPDATE documents SET current_version_id='replaced' WHERE doc_id=?").run(fixture.id);
    metrics.obsoleteHits += recallSummaryDocuments(db, "authorized", fixture.query).length;
  }
  expect(metrics).toEqual({
    titleOnlyHits: 0,
    summaryNavigationHits: 3,
    resolvableSourceUris: 3,
    inaccessibleHits: 0,
    obsoleteHits: 0,
  });
  db.close();
  // Fixture navigation only: not full-text recall, real-corpus quality, latency or billing claims.
});
