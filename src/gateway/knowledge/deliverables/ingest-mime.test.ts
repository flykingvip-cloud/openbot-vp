import { describe, expect, it } from "vitest";
import { inferDeliverableIngestMimeType } from "./ingest-mime.js";

describe("inferDeliverableIngestMimeType", () => {
  it("maps reserved-folder filenames without defaulting images to text/plain", () => {
    expect(inferDeliverableIngestMimeType("deliverables/brief.pdf")).toBe("application/pdf");
    expect(inferDeliverableIngestMimeType("cover.png")).toBe("image/png");
    expect(inferDeliverableIngestMimeType("notes.md")).toBe("text/markdown");
    expect(inferDeliverableIngestMimeType("unknown.bin")).toBe("application/octet-stream");
  });
});
