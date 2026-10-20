// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildDatasetImportPreview,
  datasetRecordsFromTable,
  parseDatasetManualTable,
  validateDatasetImportFile,
} from "./knowledge-universe-dataset-import.ts";

describe("knowledge-universe-dataset-import", () => {
  it("parses manual line-by-line input as single-column preview", () => {
    const table = parseDatasetManualTable("alpha\nbeta\n");
    const preview = buildDatasetImportPreview(table);
    expect(preview?.headers).toEqual(["content"]);
    expect(preview?.totalRowCount).toBe(2);
    expect(datasetRecordsFromTable(table)).toEqual([{ text: "alpha" }, { text: "beta" }]);
  });

  it("parses manual CSV with header row into structured records", () => {
    const table = parseDatasetManualTable("title,content\nA,first\nB,second");
    const preview = buildDatasetImportPreview(table);
    expect(preview?.headers).toEqual(["title", "content"]);
    expect(preview?.totalRowCount).toBe(2);
    expect(datasetRecordsFromTable(table)).toEqual([
      { title: "A", text: "first" },
      { title: "B", text: "second" },
    ]);
  });

  it("rejects unsupported dataset files", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(validateDatasetImportFile(file)).toContain("Only .xlsx and .csv");
  });
});
