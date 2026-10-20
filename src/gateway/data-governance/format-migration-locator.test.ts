import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSafeContentVersionToken,
  resolveFormatMigrationVersionsRoot,
  resolveImmutableContentLocator,
  validateFormatMigrationJournalLocators,
} from "./format-migration-locator.js";

describe("format-migration-locator", () => {
  const anchor = path.join("/tmp/state", "canonical", "res-1");

  it("rejects path traversal and separator tokens in contentVersion", () => {
    for (const bad of ["../../outside", "/tmp/outside", "..\\outside", "v/2", "v\\2", ""]) {
      expect(parseSafeContentVersionToken(bad).ok).toBe(false);
    }
    expect(parseSafeContentVersionToken("2").ok).toBe(true);
  });

  it("keeps immutable locator strictly under the resource versions root", () => {
    const checksum = "a".repeat(64);
    const resolved = resolveImmutableContentLocator({
      currentLocator: anchor,
      contentVersion: "2",
      checksum,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const versionsRoot = resolveFormatMigrationVersionsRoot(anchor);
    const rel = path.relative(versionsRoot, path.resolve(resolved.locator));
    expect(rel.startsWith("..")).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it("rejects forged journal nextLocator outside the versions root", () => {
    const checksum = "b".repeat(64);
    expect(
      validateFormatMigrationJournalLocators({
        previousLocator: anchor,
        nextLocator: path.join("/tmp/state", "outside-evil", "pwned"),
        contentVersion: "2",
        fromContentVersion: "1",
        resultChecksum: checksum,
      }),
    ).toBe(false);
  });
});
