import { describe, expect, it } from "vitest";
import {
  assertManifestTargetsTenant,
  buildTenantImportManifest,
  TENANT_IMPORT_EXCLUDED_CATEGORIES,
  type TenantImportManifest,
  validateTenantImportManifest,
} from "./manifest.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

describe("buildTenantImportManifest", () => {
  it("builds a well-formed manifest with sensible defaults", () => {
    const m = buildTenantImportManifest({
      environment: "local-dev",
      sourceTenantId: "tenant-acme-local",
      targetTenantId: "acme",
      userDataSpaces: ["u-local-001", "u-local-002"],
      tenantShared: true,
      now: fixedNow,
    });
    expect(m.schemaVersion).toBe(1);
    expect(m.packageKind).toBe("tenant-import");
    expect(m.target.idRemapPolicy).toBe("deterministic-v1");
    expect(m.exportedAt).toBe("2026-07-11T06:10:35.756Z");
    expect(m.contents.includedPaths).toEqual(["control-plane/", "users/", "tenant-shared/"]);
    expect(m.contents.excludedCategories).toEqual([...TENANT_IMPORT_EXCLUDED_CATEGORIES]);
    expect(m.stats.userCount).toBe(2);
  });

  it("omits tenant-shared/ from includedPaths when tenantShared is false", () => {
    const m = buildTenantImportManifest({
      environment: "local-dev",
      sourceTenantId: "src",
      targetTenantId: "acme",
      userDataSpaces: ["u1"],
      now: fixedNow,
    });
    expect(m.contents.includedPaths).toEqual(["control-plane/", "users/"]);
  });
});

describe("validateTenantImportManifest", () => {
  it("accepts a valid manifest", () => {
    const m = buildTenantImportManifest({
      environment: "local-dev",
      sourceTenantId: "src",
      targetTenantId: "acme",
      userDataSpaces: ["u1"],
      now: fixedNow,
    });
    const result = validateTenantImportManifest(m);
    expect(result.ok).toBe(true);
  });

  it("rejects a single-user export manifest (wrong packageKind)", () => {
    const result = validateTenantImportManifest({
      schemaVersion: 1,
      exportedAt: "x",
      dataRoot: "/x",
      paths: [],
      excluded: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("packageKind"))).toBe(true);
    }
  });

  it("collects all missing required fields", () => {
    const result = validateTenantImportManifest({
      schemaVersion: 2,
      packageKind: "tenant-import",
      source: {},
      target: {},
      contents: { userDataSpaces: "nope" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("schemaVersion"),
          expect.stringContaining("source.sourceTenantId"),
          expect.stringContaining("target.targetTenantId"),
          expect.stringContaining("contents.userDataSpaces"),
        ]),
      );
    }
  });
});

describe("assertManifestTargetsTenant", () => {
  const manifest = {
    target: { targetTenantId: "acme" },
  } as TenantImportManifest;

  it("passes when the manifest target matches the job tenant", () => {
    expect(assertManifestTargetsTenant(manifest, "acme")).toEqual({ ok: true });
  });

  it("fails on cross-tenant mismatch (§4.1)", () => {
    const result = assertManifestTargetsTenant(manifest, "globex");
    expect(result.ok).toBe(false);
  });
});
