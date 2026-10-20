// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import {
  formatKnowledgeEvidenceCitation,
  formatKnowledgeEvidencePromptLines,
  formatKnowledgeEvidencePublishedAt,
} from "./evidence-format.js";

const sampleEvidence: KnowledgeEvidence = {
  sourceKind: "knowledge",
  docId: "doc-1",
  docTitle: "Sales Policy",
  kbId: "kb-1",
  kbTitle: "Sales KB",
  versionId: "ver-1",
  versionLabel: "V3",
  publishedAt: Date.parse("2026-05-01T00:00:00.000Z"),
  score: 0.91,
  chunkText: "Refund requests must include order id.",
  heading: "Refunds",
  section: "3.2",
  sourceUri: "ku://kb/kb-1/doc/doc-1@ver-1#3.2",
};

describe("evidence-format", () => {
  it("formats publishedAt as YYYY-MM-DD", () => {
    expect(formatKnowledgeEvidencePublishedAt(sampleEvidence.publishedAt)).toBe("2026-05-01");
  });

  it("formats citation with version, date, and section", () => {
    expect(formatKnowledgeEvidenceCitation(sampleEvidence)).toBe(
      "《Sales Policy V3(2026-05-01)》第 3.2 节",
    );
  });

  it("renders prompt lines with citation and sourceUri", () => {
    const lines = formatKnowledgeEvidencePromptLines([sampleEvidence]);
    expect(lines.join("\n")).toContain("Retrieved knowledge evidence");
    expect(lines.join("\n")).toContain("《Sales Policy V3(2026-05-01)》第 3.2 节");
    expect(lines.join("\n")).toContain(sampleEvidence.sourceUri);
    expect(lines.join("\n")).toContain("untrusted content");
    expect(lines.join("\n")).toContain("Refund requests must include order id.");
  });
});
