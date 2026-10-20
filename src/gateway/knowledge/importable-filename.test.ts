import { describe, expect, it } from "vitest";
import {
  flattenKnowledgeImportBasename,
  isImportableKnowledgeFilename,
  uniquifyKnowledgeImportBasename,
} from "./importable-filename.js";
import { flattenManagedPushInventory } from "./sources/local-folder-import-flatten.js";

describe("importable knowledge filenames", () => {
  it("rejects extensionless folder shells", () => {
    expect(isImportableKnowledgeFilename("图书室")).toBe(false);
    expect(isImportableKnowledgeFilename("UPBEYOND")).toBe(false);
    expect(isImportableKnowledgeFilename("brief.pdf")).toBe(true);
    expect(isImportableKnowledgeFilename("notes.md")).toBe(true);
  });

  it("flattens nested folder imports to the file basename", () => {
    expect(flattenKnowledgeImportBasename("图书室/手册.md")).toBe("手册.md");
    expect(flattenKnowledgeImportBasename("UPBEYOND\\docs\\brief.pdf")).toBe("brief.pdf");
  });

  it("uniquifies colliding basenames and drops folder shells", () => {
    const flattened = flattenManagedPushInventory([
      { relativePath: "readme.md" },
      { relativePath: "docs/readme.md" },
      { relativePath: "图书室" },
      { relativePath: "UPBEYOND/notes.txt", fileName: "notes.txt" },
    ]);
    expect(flattened.map((item) => item.relativePath)).toEqual([
      "readme.md",
      "readme-2.md",
      "notes.txt",
    ]);
  });

  it("allocates the next free basename suffix", () => {
    const used = new Set(["brief.pdf", "brief-2.pdf"]);
    expect(uniquifyKnowledgeImportBasename("brief.pdf", used)).toBe("brief-3.pdf");
  });
});
