import { describe, expect, it } from "vitest";
import {
  isNonImageAttachmentFileName,
  resolveAttachmentEffectiveMime,
  sanitizeModelImageInputs,
} from "./chat-attachment-kind.js";

describe("chat attachment kind", () => {
  it("treats Markdown and other document suffixes as non-image filenames", () => {
    expect(isNonImageAttachmentFileName("async-test-doc.md")).toBe(true);
    expect(isNonImageAttachmentFileName("notes.markdown")).toBe(true);
    expect(isNonImageAttachmentFileName("data.csv")).toBe(true);
    expect(isNonImageAttachmentFileName("shot.png")).toBe(false);
  });

  it("prefers the .md suffix over a declared image MIME when bytes are not a confirmed image", () => {
    expect(
      resolveAttachmentEffectiveMime({
        fileName: "async-test-doc.md",
        providedMime: "image/png",
        sniffedMime: undefined,
      }),
    ).toBe("text/markdown");
  });

  it("trusts confirmed image magic bytes even when the suffix is .md", () => {
    expect(
      resolveAttachmentEffectiveMime({
        fileName: "async-test-doc.md",
        providedMime: "image/png",
        sniffedMime: "image/png",
      }),
    ).toBe("image/png");
  });

  it("drops resume image parts whose suffix shows they are Markdown or other files", () => {
    const kept = sanitizeModelImageInputs([
      { mimeType: "image/png", fileName: "shot.png" },
      { mimeType: "image/png", fileName: "async-test-doc.md" },
      { mimeType: "text/markdown", fileName: "notes.md" },
    ]);
    expect(kept).toEqual([{ mimeType: "image/png", fileName: "shot.png" }]);
  });
});
