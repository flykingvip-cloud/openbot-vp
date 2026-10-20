// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chunkHierarchicalDocument } from "./hierarchical.js";

describe("chunkHierarchicalDocument", () => {
  it("splits a long markdown document by headings with heading and section metadata", () => {
    const body = [
      "# Sales Policy",
      "",
      "Enterprise onboarding baseline.",
      "",
      "## Refunds",
      "",
      "Refund requests must include order id.",
      "",
      "## Escalation",
      "",
      "Escalate blocked deals to regional leads.",
    ].join("\n");

    const chunks = chunkHierarchicalDocument(body, { tokens: 20, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const refunds = chunks.find((chunk) => chunk.section === "Refunds");
    expect(refunds).toBeDefined();
    expect(refunds?.heading).toBe("Sales Policy");
    expect(refunds?.text.toLowerCase()).toContain("refund");
    expect(refunds?.startLine).toBeGreaterThan(0);
    expect(refunds?.endLine).toBeGreaterThanOrEqual(refunds!.startLine);

    const escalation = chunks.find((chunk) => chunk.section === "Escalation");
    expect(escalation?.heading).toBe("Sales Policy");
    expect(escalation?.text.toLowerCase()).toContain("escalate");
  });

  it("falls back to line chunking for plain text without headings", () => {
    const body = Array.from(
      { length: 40 },
      (_, index) => `Line ${index + 1}: onboarding detail`,
    ).join("\n");
    const chunks = chunkHierarchicalDocument(body, { tokens: 30, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.heading === null && chunk.section === null)).toBe(true);
  });
});
