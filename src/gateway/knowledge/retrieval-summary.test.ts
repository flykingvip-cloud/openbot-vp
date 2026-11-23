import { describe, expect, it } from "vitest";
import {
  canApplyGeneratedSummary,
  retrievalSummaryForSource,
  retrievalSummaryText,
  type RetrievalSummary,
} from "./retrieval-summary.js";
const source = { versionId: "v2", contentHash: "hash2" };
const ready: RetrievalSummary = {
  schemaVersion: 1,
  state: "ready",
  documentType: "sop",
  sourceVersionId: "v2",
  sourceContentHash: "hash2",
  templateVersion: "1",
  method: "model",
  fields: {
    purpose: "采购验收",
    keyPoints: ["未经审批不得付款"],
    coverage: ["中国区"],
    entities: ["ERP"],
    boundaries: ["仅适用正式合同"],
  },
};
describe("version bound retrieval summaries", () => {
  it("preserves negations and boundaries in recall", () => {
    expect(retrievalSummaryText(ready, source)).toContain("未经审批不得付款");
    expect(retrievalSummaryText(ready, source)).toContain("仅适用正式合同");
  });
  it("never serves missing, failed or stale summaries as evidence", () => {
    expect(retrievalSummaryText(undefined, source)).toBe("");
    expect(retrievalSummaryText({ ...ready, state: "failed" }, source)).toBe("");
    expect(retrievalSummaryText(ready, { ...source, contentHash: "new" })).toBe("");
    expect(retrievalSummaryForSource(ready, { ...source, versionId: "v3" })?.state).toBe("stale");
  });
  it("rejects late generation results and preserves human edits", () => {
    expect(canApplyGeneratedSummary(undefined, ready, source)).toBe(true);
    expect(canApplyGeneratedSummary({ ...ready, method: "human" }, ready, source)).toBe(false);
    expect(canApplyGeneratedSummary(undefined, ready, { ...source, versionId: "v3" })).toBe(false);
  });
});
it("quality length hints never prevent readable short summaries", async () => {
  const { retrievalSummaryQuality } = await import("./retrieval-summary.js");
  expect(retrievalSummaryQuality(ready)).toContain("short_summary");
  expect(retrievalSummaryText(ready, source)).toContain("采购验收");
});
