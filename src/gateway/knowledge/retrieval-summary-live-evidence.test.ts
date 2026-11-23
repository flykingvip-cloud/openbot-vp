import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { parseKnowledgeEvidenceUri } from "./kb-retrieve.js";
import { recallSummaryDocuments } from "./retrieval-summary-recall.js";
import {
  queueRetrievalSummary,
  editRetrievalSummary,
  readRetrievalSummary,
} from "./retrieval-summary-store.js";
import { parseRetrievalSummaryFields } from "./retrieval-summary-validation.js";
it.skipIf(!process.env.OPENBOT_SUMMARY_LIVE_EVIDENCE_FILE)(
  "routes recorded synthetic live model responses through project validation, storage and resolvable recall",
  async () => {
    const samples = JSON.parse(
      fs.readFileSync(process.env.OPENBOT_SUMMARY_LIVE_EVIDENCE_FILE!, "utf8"),
    ) as Array<{
      model: string;
      document: string;
      fields: unknown;
      http: number;
      latencyMs: number;
    }>;
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE documents(doc_id TEXT,kb_id TEXT,current_version_id TEXT,title TEXT);CREATE TABLE document_versions(version_id TEXT,semantic_hash TEXT)",
    );
    const report: Array<{
      model: string;
      document: string;
      accepted: boolean;
      reason: string;
      citationResolvable?: boolean;
    }> = [];
    for (const [i, sample] of samples.entries()) {
      const id = `live-${i}`;
      const source = { kbId: "synthetic", versionId: id, contentHash: id };
      db.prepare("INSERT INTO documents VALUES(?,?,?,?)").run(id, "synthetic", id, sample.document);
      db.prepare("INSERT INTO document_versions VALUES(?,?)").run(id, id);
      queueRetrievalSummary(db, { docId: id, ...source });
      const fields = parseRetrievalSummaryFields(sample.fields);
      if (!fields) {
        report.push({
          model: sample.model,
          document: sample.document,
          accepted: false,
          reason: "navigation_policy_or_schema_rejected",
        });
        continue;
      }
      expect(await editRetrievalSummary(db, id, fields, async () => source)).toBe(true);
      const query = fields.purpose.trim().slice(0, 5);
      const hits = recallSummaryDocuments(db, "synthetic", query, 20);
      const hit = hits.find((hit) => hit.docId === id);
      expect(hit).toBeDefined();
      expect(parseKnowledgeEvidenceUri(hit!.sourceUri)).toMatchObject({
        kbId: "synthetic",
        docId: id,
        versionId: id,
      });
      expect(readRetrievalSummary(db, id, new Set())).toBeUndefined();
      report.push({
        model: sample.model,
        document: sample.document,
        accepted: true,
        reason: "synthetic_navigation_only",
        citationResolvable: true,
      });
    }
    const output = process.env.OPENBOT_SUMMARY_LIVE_REPORT_FILE;
    if (output) {
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            scope:
              "synthetic recorded samples; field policy is not a substitute for human semantic review",
            report,
          },
          null,
          2,
        ),
      );
    }
    expect(
      report.some(
        (row) => row.model === "deepseek-v4-pro" && row.document === "meeting" && !row.accepted,
      ),
    ).toBe(true);
    db.close();
  },
);
