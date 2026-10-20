import { describe, expect, it } from "vitest";
import { DEFAULT_SELECTIVE_SYNC } from "../types.js";
import { isAlwaysExcluded, isSelectivelyIncluded, shouldSyncPath } from "./excludes.js";

describe("vault-sync selective excludes", () => {
  it("always excludes runtime derivatives and editor junk", () => {
    expect(isAlwaysExcluded(".openbot/index.sqlite")).toBe(true);
    expect(isAlwaysExcluded("embeddings/foo.bin")).toBe(true);
    expect(isAlwaysExcluded("notes.md~")).toBe(true);
    expect(isAlwaysExcluded("notes.md")).toBe(false);
  });

  it("honors media category toggles", () => {
    const noMedia = {
      ...DEFAULT_SELECTIVE_SYNC,
      includeImages: false,
      includeAudio: false,
      includeVideo: false,
      includePdf: false,
      includeOtherAttachments: false,
    };
    expect(isSelectivelyIncluded("doc.md", noMedia)).toBe(true);
    expect(isSelectivelyIncluded("pic.png", noMedia)).toBe(false);
    expect(isSelectivelyIncluded("song.mp3", noMedia)).toBe(false);
    expect(isSelectivelyIncluded("clip.mp4", noMedia)).toBe(false);
    expect(isSelectivelyIncluded("paper.pdf", noMedia)).toBe(false);
    expect(isSelectivelyIncluded("blob.bin", noMedia)).toBe(false);
  });

  it("honors user excludeGlobs", () => {
    expect(
      shouldSyncPath("private/secret.md", {
        ...DEFAULT_SELECTIVE_SYNC,
        excludeGlobs: ["private/**"],
      }),
    ).toBe(false);
    expect(
      shouldSyncPath("public/ok.md", {
        ...DEFAULT_SELECTIVE_SYNC,
        excludeGlobs: ["private/**"],
      }),
    ).toBe(true);
  });
});
