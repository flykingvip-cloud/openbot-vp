import { describe, expect, it } from "vitest";
import { isVerifiedTextPath, textHasSourceAbsolutePath } from "./path-scan.js";

describe("isVerifiedTextPath", () => {
  it("matches config/content text extensions (case-insensitive)", () => {
    expect(isVerifiedTextPath("control-plane/seat-assets.json")).toBe(true);
    expect(isVerifiedTextPath("a/b.JSONL")).toBe(true);
    expect(isVerifiedTextPath("cfg.json5")).toBe(true);
    expect(isVerifiedTextPath("x.yaml")).toBe(true);
    expect(isVerifiedTextPath("x.yml")).toBe(true);
  });

  it("does not match binary/other files", () => {
    expect(isVerifiedTextPath("note.md")).toBe(false);
    expect(isVerifiedTextPath("logo.png")).toBe(false);
    expect(isVerifiedTextPath("archive.zip")).toBe(false);
  });
});

describe("textHasSourceAbsolutePath", () => {
  it("detects posix and windows source-machine absolute paths", () => {
    expect(textHasSourceAbsolutePath('{"workspace":"/Users/daniel/ws-bot-2"}')).toBe(true);
    expect(textHasSourceAbsolutePath("workspace: /home/alice/ws\n")).toBe(true);
    expect(textHasSourceAbsolutePath('"C:\\Users\\bob\\ws"')).toBe(true);
  });

  it("does not flag managed or relative paths", () => {
    expect(textHasSourceAbsolutePath('{"root":"/data/tenants/acme/users/u1/OpenBot"}')).toBe(false);
    expect(textHasSourceAbsolutePath('{"path":"agents/main/workspace"}')).toBe(false);
    expect(textHasSourceAbsolutePath("just some text, no paths")).toBe(false);
  });
});
