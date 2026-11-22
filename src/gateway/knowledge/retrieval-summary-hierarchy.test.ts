import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  generateHierarchicalSummary,
  SummaryGenerationDeferred,
  splitSummarySections,
  summaryTypePrompt,
} from "./retrieval-summary-hierarchy.js";
it("covers the entire source and resumes persisted section work after budget deferral", async () => {
  const db = new DatabaseSync(":memory:");
  const body = "a".repeat(12000) + "TAIL_RESTRICTION";
  let budget = 1;
  const prompts: string[] = [];
  const fields = {
    purpose: "whole document",
    keyPoints: ["TAIL_RESTRICTION"],
    coverage: [],
    entities: [],
    boundaries: ["must not pay without invoice"],
  };
  const input = {
    db,
    docId: "d",
    versionId: "v",
    contentHash: "h",
    body,
    documentType: "report" as const,
    call: async (prompt: string) => {
      if (budget-- <= 0) {
        return undefined;
      }
      prompts.push(prompt);
      return JSON.stringify(fields);
    },
  };
  await expect(generateHierarchicalSummary(input)).rejects.toBeInstanceOf(
    SummaryGenerationDeferred,
  );
  budget = 2;
  expect(await generateHierarchicalSummary(input)).toEqual(fields);
  expect(prompts).toHaveLength(3);
  expect(prompts[1]).toContain("TAIL_RESTRICTION");
  expect(prompts[2]).toContain("Combine every section");
  expect(splitSummarySections(body).join("")).toBe(body);
  db.close();
});
it("uses document-type-specific guidance without inventing metadata", () => {
  expect(summaryTypePrompt("meeting")).toContain("never invent owners");
  expect(summaryTypePrompt("dataset")).toContain("units");
  expect(summaryTypePrompt("sop")).toContain("exceptions");
});
