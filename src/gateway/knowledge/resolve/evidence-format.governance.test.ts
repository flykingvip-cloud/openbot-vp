// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import { formatKnowledgeEvidencePromptLines } from "./evidence-format.js";

describe("evidence-format governance hints", () => {
  it("adds governance labels for verified and conflict evidence", () => {
    const evidence: KnowledgeEvidence[] = [
      {
        sourceKind: "knowledge",
        docId: "doc-1",
        docTitle: "Refund Policy",
        kbId: "kb-1",
        versionId: "v1",
        score: 0.9,
        chunkText: "Refund within 30 days.",
        sourceUri: "ku://kb/kb-1/doc/doc-1@v1",
        governanceStatus: "confirmed",
      },
      {
        sourceKind: "knowledge",
        docId: "doc-2",
        docTitle: "Sales Policy",
        kbId: "kb-1",
        versionId: "v1",
        score: 0.8,
        chunkText: "Revenue is declining.",
        sourceUri: "ku://kb/kb-1/doc/doc-2@v1",
        governanceConflict: true,
      },
    ];
    const lines = formatKnowledgeEvidencePromptLines(evidence);
    expect(lines.some((line) => line.includes("Governance: verified"))).toBe(true);
    expect(lines.some((line) => line.includes("unresolved conflict"))).toBe(true);
  });
});
