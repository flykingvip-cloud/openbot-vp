import { describe, expect, it } from "vitest";
import {
  assertGardenerRpc,
  assertIngestableExtract,
  buildDocumentCiteUri,
  isReceiptUsable,
  lintClaimEvidence,
} from "./index.js";

describe("ke public surface", () => {
  it("re-exports the four lint modules", () => {
    expect(isReceiptUsable({ status: "partial" })).toBe(true);
    expect(buildDocumentCiteUri({ kbId: "k", docId: "d", versionId: "v" })).toContain("ku://kb/");
    expect(lintClaimEvidence({ confidence: 0.5, evidence_span: "x" }).ok).toBe(true);
    expect(assertGardenerRpc("knowledge.governance.tasks.update")).toBe("allow");
    expect(() =>
      assertIngestableExtract({ format: "text", cleanedText: "ok", rawHash: "h1" }),
    ).not.toThrow();
  });
});
