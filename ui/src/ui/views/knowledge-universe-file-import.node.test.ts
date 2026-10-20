// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  countReadyFileImportItems,
  formatImportFileSize,
} from "./knowledge-universe-file-import.ts";

describe("knowledge-universe-file-import", () => {
  it("formats file sizes for the queue list", () => {
    expect(formatImportFileSize(2400)).toBe("2.3 KB");
    expect(formatImportFileSize(2_400_000)).toBe("2.3 MB");
  });

  it("counts only ready files for submit gating", () => {
    expect(
      countReadyFileImportItems([
        {
          id: "a",
          status: "ready",
          attachment: { fileName: "a.pdf", mimeType: "application/pdf", size: 1, kind: "binary" },
        },
        {
          id: "b",
          status: "done",
          attachment: { fileName: "b.pdf", mimeType: "application/pdf", size: 1, kind: "binary" },
        },
      ]),
    ).toBe(1);
  });
});
