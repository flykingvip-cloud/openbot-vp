import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzePluginAllowIntegrity,
  parsePluginIntegrity,
  verifyPluginEntryIntegrity,
} from "./integrity.js";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-plugin-integrity-"));

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("parsePluginIntegrity", () => {
  it("parses a valid sha256 pin (case-insensitive hex)", () => {
    const hex = sha256Hex("hello");
    expect(parsePluginIntegrity(`sha256:${hex}`)).toEqual({
      ok: true,
      algorithm: "sha256",
      hex,
    });
    expect(parsePluginIntegrity(`SHA256:${hex.toUpperCase()}`)).toEqual({
      ok: true,
      algorithm: "sha256",
      hex,
    });
  });

  it("rejects missing separator, unknown algorithms, and bad digests", () => {
    expect(parsePluginIntegrity("deadbeef").ok).toBe(false);
    expect(parsePluginIntegrity(`md5:${"a".repeat(32)}`).ok).toBe(false);
    expect(parsePluginIntegrity("sha256:not-hex").ok).toBe(false);
    expect(parsePluginIntegrity(`sha256:${"a".repeat(63)}`).ok).toBe(false);
  });
});

describe("verifyPluginEntryIntegrity", () => {
  function openFixture(content: string): number {
    const file = path.join(fixtureRoot, `entry-${Math.random().toString(36).slice(2)}.cjs`);
    fs.writeFileSync(file, content, "utf-8");
    return fs.openSync(file, "r");
  }

  it("accepts a matching digest", () => {
    const content = `module.exports = { id: "pinned", register() {} };`;
    const fd = openFixture(content);
    try {
      expect(verifyPluginEntryIntegrity({ fd, expected: `sha256:${sha256Hex(content)}` })).toEqual({
        ok: true,
      });
    } finally {
      fs.closeSync(fd);
    }
  });

  it("rejects a digest mismatch with expected/actual detail", () => {
    const fd = openFixture("actual content");
    try {
      const result = verifyPluginEntryIntegrity({
        fd,
        expected: `sha256:${sha256Hex("other content")}`,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("sha256 mismatch");
      }
    } finally {
      fs.closeSync(fd);
    }
  });

  it("rejects malformed pins without reading the file", () => {
    const fd = openFixture("anything");
    try {
      const result = verifyPluginEntryIntegrity({ fd, expected: "sha1:abc" });
      expect(result.ok).toBe(false);
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe("analyzePluginAllowIntegrity", () => {
  it("classifies string entries and unpinned objects as unpinned", () => {
    const analysis = analyzePluginAllowIntegrity([
      "plain-id",
      { id: "no-pin" },
      { id: "pinned", integrity: `sha256:${"a".repeat(64)}` },
    ]);
    expect(analysis.unpinned).toEqual(["plain-id", "no-pin"]);
    expect(analysis.invalid).toEqual([]);
  });

  it("flags malformed integrity values", () => {
    const analysis = analyzePluginAllowIntegrity([{ id: "broken", integrity: "sha512:xyz" }]);
    expect(analysis.unpinned).toEqual([]);
    expect(analysis.invalid).toHaveLength(1);
    expect(analysis.invalid[0]).toContain("broken");
  });

  it("handles undefined and empty entries", () => {
    expect(analyzePluginAllowIntegrity(undefined)).toEqual({ invalid: [], unpinned: [] });
    expect(analyzePluginAllowIntegrity(["  ", { id: "" }])).toEqual({
      invalid: [],
      unpinned: [],
    });
  });
});
