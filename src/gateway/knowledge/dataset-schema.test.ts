// @vitest-environment node
import { describe, expect, it } from "vitest";
import { detectDatasetFormat, extractDatasetSchema } from "./dataset-schema.js";

describe("dataset-schema", () => {
  it("detects format from filename, mime, and content sniffing", () => {
    expect(detectDatasetFormat({ fileName: "sales.csv" })).toBe("csv");
    expect(detectDatasetFormat({ fileName: "data.tsv" })).toBe("tsv");
    expect(detectDatasetFormat({ mimeType: "application/json" })).toBe("json");
    expect(detectDatasetFormat({ sampleText: '[{"a":1}]' })).toBe("json");
    expect(detectDatasetFormat({ fileName: "notes.md", sampleText: "# Title" })).toBeNull();
  });

  it("parses a CSV header + infers per-column types with quoting", () => {
    const csv = [
      "region,revenue,active,signup_date",
      '"EMEA, West",120,true,2024-01-02',
      "APAC,90,false,2024-03-15",
      "AMER,75,true,2024-04-01",
    ].join("\n");
    const schema = extractDatasetSchema({ text: csv, fileName: "sales.csv" });
    expect(schema).toBeTruthy();
    expect(schema?.format).toBe("csv");
    expect(schema?.columnCount).toBe(4);
    expect(schema?.rowCount).toBe(3);
    const byName = Object.fromEntries((schema?.columns ?? []).map((c) => [c.name, c.type]));
    expect(byName.region).toBe("string");
    expect(byName.revenue).toBe("number");
    expect(byName.active).toBe("boolean");
    expect(byName.signup_date).toBe("date");
  });

  it("handles quoted newlines and duplicate headers", () => {
    const csv = ["name,name,note", '"A","B","line1\nline2"'].join("\n");
    const schema = extractDatasetSchema({ text: csv, fileName: "x.csv" });
    expect(schema?.rowCount).toBe(1);
    expect(schema?.columns.map((c) => c.name)).toEqual(["name", "name_2", "note"]);
  });

  it("parses a JSON array of objects into a union schema", () => {
    const json = JSON.stringify([
      { name: "A", score: 10 },
      { name: "B", score: 20, extra: "x" },
    ]);
    const schema = extractDatasetSchema({ text: json, fileName: "data.json" });
    expect(schema?.format).toBe("json");
    expect(schema?.rowCount).toBe(2);
    const byName = Object.fromEntries((schema?.columns ?? []).map((c) => [c.name, c.type]));
    expect(byName.name).toBe("string");
    expect(byName.score).toBe("number");
    expect(byName.extra).toBe("string");
  });

  it("parses NDJSON line objects", () => {
    const ndjson = '{"a":1}\n{"a":2}\n{"a":3}';
    const schema = extractDatasetSchema({ text: ndjson, mimeType: "application/x-ndjson" });
    expect(schema?.rowCount).toBe(3);
    expect(schema?.columns).toEqual([{ name: "a", type: "number" }]);
  });

  it("returns null for non-tabular content", () => {
    expect(extractDatasetSchema({ text: "# Heading\n\nProse.", fileName: "doc.md" })).toBeNull();
  });
});
