import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-tenant-canonicalization-${Date.now()}`);

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { canonicalizeTenantId, canonicalizeTenantIdList, findCanonicalTenantIdBySlug } =
  await import("./tenant-canonicalization.js");

describe("tenant canonicalization", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, "enterprise"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("maps legacy upbeyond runtime tenant id to canonical 001", () => {
    expect(canonicalizeTenantId("upbeyond-91aeea3c")).toBe("001");
    expect(canonicalizeTenantId("001")).toBe("001");
  });

  it("deduplicates canonicalized tenant ids", () => {
    expect(canonicalizeTenantIdList(["upbeyond-91aeea3c", "001", "001", "aegis"])).toEqual([
      "001",
      "aegis",
    ]);
  });

  it("resolves canonical tenant id by slug from enterprise tenants registry", () => {
    fs.writeFileSync(
      path.join(tmpDir, "enterprise", "tenants.json"),
      JSON.stringify(
        {
          version: 1,
          tenants: [{ tenantId: "001", slug: "upbeyond", displayName: "upbeyond" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(findCanonicalTenantIdBySlug({ slug: "upbeyond" })).toBe("001");
  });
});
