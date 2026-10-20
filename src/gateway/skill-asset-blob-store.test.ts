import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateDir = path.join(os.tmpdir(), `openbot-skill-blob-${Date.now()}`);

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: path.join(stateDir, "config"),
  };
});

const {
  persistProfileOutputContent,
  readSkillContentBlob,
  hydrateProfileOutputContent,
  migrateInlineOutputToBlob,
} = await import("./skill-asset-blob-store.js");

describe("skill-asset-blob-store", () => {
  beforeEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("writes and reads markdown blobs by contentRef", () => {
    const markdown = "# Title\n\nBody";
    const persisted = persistProfileOutputContent(markdown);
    expect(persisted.contentRef.startsWith("blob:")).toBe(true);
    expect(persisted.outputDescription).toBe("");
    expect(readSkillContentBlob(persisted.contentRef)).toBe(markdown);
    expect(
      hydrateProfileOutputContent({
        outputDescription: "",
        contentRef: persisted.contentRef,
      }),
    ).toBe(markdown);
  });

  it("lazy-migrates inline outputDescription to blob refs", () => {
    const migrated = migrateInlineOutputToBlob({
      outputDescription: "# Inline\n\nContent",
    });
    expect(migrated.migrated).toBe(true);
    expect(migrated.contentRef.startsWith("blob:")).toBe(true);
    expect(migrated.outputDescription).toBe("");
  });
});
