/**
 * FINAL v3 P0 — gray allowlist matching (managed requires tenantId/groupId).
 */
import { describe, expect, test } from "vitest";
import {
  formatManagedGrayAllowlistKey,
  isBareGrayGroupAllowlistEntry,
  listBareGrayGroupAllowlistEntries,
  matchGrayGroupAllowlist,
  parseGrayGroupAllowlistEntry,
} from "./gray-group-allowlist.js";

const GRAY = "grp-daniel-hhd-gmail-com-upbeyond";

describe("gray-group-allowlist (FINAL v3 P0)", () => {
  test("parses bare and scoped entries; rejects malformed scoped", () => {
    expect(parseGrayGroupAllowlistEntry(GRAY)).toEqual({ kind: "bare", groupId: GRAY });
    expect(parseGrayGroupAllowlistEntry("001/grp-x")).toEqual({
      kind: "scoped",
      tenantId: "001",
      groupId: "grp-x",
    });
    expect(parseGrayGroupAllowlistEntry("/grp-x")).toBeNull();
    expect(parseGrayGroupAllowlistEntry("001/")).toBeNull();
    expect(parseGrayGroupAllowlistEntry("")).toBeNull();
  });

  test("managed caller (tenantId set): bare entry never matches", () => {
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: "001",
        entries: [GRAY],
      }),
    ).toBe(false);
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: "001",
        entries: [`001/${GRAY}`],
      }),
    ).toBe(true);
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: "001",
        entries: [`002/${GRAY}`],
      }),
    ).toBe(false);
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: "001",
        entries: [`*/${GRAY}`],
      }),
    ).toBe(true);
  });

  test("personal_local (no tenantId): bare entry matches; 001/ scoped does NOT auto-match", () => {
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: null,
        entries: [GRAY],
      }),
    ).toBe(true);
    // Removed pre-P0 hazard: empty tenant must not match managed tenant "001" keys.
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: null,
        entries: [`001/${GRAY}`],
      }),
    ).toBe(false);
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: null,
        entries: [`_local/${GRAY}`],
      }),
    ).toBe(true);
    expect(
      matchGrayGroupAllowlist({
        groupId: GRAY,
        tenantId: null,
        entries: [`personal_local/${GRAY}`],
      }),
    ).toBe(true);
  });

  test("cross-tenant collision: same groupId different tenants stay isolated on allowlist", () => {
    const entries = [`001/${GRAY}`];
    expect(matchGrayGroupAllowlist({ groupId: GRAY, tenantId: "001", entries })).toBe(true);
    expect(matchGrayGroupAllowlist({ groupId: GRAY, tenantId: "002", entries })).toBe(false);
  });

  test("listBare + format helper", () => {
    expect(isBareGrayGroupAllowlistEntry(GRAY)).toBe(true);
    expect(isBareGrayGroupAllowlistEntry(`001/${GRAY}`)).toBe(false);
    expect(listBareGrayGroupAllowlistEntries([GRAY, `001/${GRAY}`, "  "])).toEqual([GRAY]);
    expect(formatManagedGrayAllowlistKey("001", GRAY)).toBe(`001/${GRAY}`);
  });
});
