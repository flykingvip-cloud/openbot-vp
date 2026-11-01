import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateItem7W3MetRequest,
  findItem7W3Site,
  ITEM7_W3_CATALOG_MISS_DENY,
  ITEM7_W3_DELETE_CALL_SITES,
  ITEM7_W3_PRODUCTION_CATALOG_WRITE,
  ITEM7_W3_SITE_COUNT,
  ITEM7_W3_SITES,
  ITEM7_W3_WAVE,
  item7W3ReplacementWriteStillTombstoned,
  proveItem7W3CatalogRead,
  runItem7W3CatalogSynthesisShadow,
} from "./item7-w3-catalog-synthesis.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Item 7 W3 catalog synthesis shadow proof", () => {
  it("covers the 7 P4 synthesis sites without writing Catalog", () => {
    expect(ITEM7_W3_WAVE).toBe("W3");
    expect(ITEM7_W3_SITES).toHaveLength(ITEM7_W3_SITE_COUNT);
    expect(
      ITEM7_W3_SITES.filter((site) => site.symbol === "createEmptyWorkspaceCatalog"),
    ).toHaveLength(4);
    expect(
      ITEM7_W3_SITES.filter((site) => site.symbol === "buildUserOwnedWorkspaceCatalogEntry"),
    ).toHaveLength(3);
    expect(ITEM7_W3_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W3_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_W3_PRODUCTION_CATALOG_WRITE).toBe(false);
    expect(item7W3ReplacementWriteStillTombstoned()).toBe(true);
    expect(evaluateItem7W3MetRequest()).toMatchObject({
      allow: false,
      item7: "not-met",
      reason: "live-write-watch-index-nonzero",
    });
  });

  it("keeps every W3 synthesis symbol and the getResource replacement", () => {
    const catalog = fs.readFileSync(
      path.join(REPO, "src/gateway/workspace-resolver/catalog.ts"),
      "utf8",
    );
    const builders = fs.readFileSync(
      path.join(REPO, "src/gateway/workspace-resolver/builders.ts"),
      "utf8",
    );
    expect(catalog).toContain("getResource(resourceId: string)");
    expect(catalog).toContain("createEmptyWorkspaceCatalog");
    expect(builders).toContain("buildUserOwnedWorkspaceCatalogEntry");
    for (const site of ITEM7_W3_SITES) {
      // Call-sites may already be tombstoned; ledger still tracks replacement mapping.
      expect(findItem7W3Site(site.ledgerId)?.replacementSymbol).toBe(
        "WorkspaceResourceCatalog.getResource",
      );
      expect(findItem7W3Site(site.ledgerId)?.symbol).toBe(site.symbol);
    }
  });

  it("reads existing Catalog entries in shadow and does not synthesize", () => {
    const hit = proveItem7W3CatalogRead({
      ledgerId: "S08",
      existingResourceId: "ws:tenant-a:user:user-elle:asset:agent-1",
    });
    expect(hit?.replacementRead).toBe("hit");
    expect(hit?.quarantine).toBe(false);
    expect(hit?.synthesisSwitch.allow).toBe(false);
    expect(hit?.productionWrite).toBe("legacy-only");
    expect(hit?.catalogMissDeny).toBe(false);

    const miss = proveItem7W3CatalogRead({
      ledgerId: "S23",
      existingResourceId: null,
    });
    expect(miss?.replacementRead).toBe("miss");
    expect(miss?.quarantine).toBe(true);
    expect(miss?.synthesisSwitch.allow).toBe(false);
    expect(miss?.catalogMissDeny).toBe(false);
    expect(miss?.productionWrite).toBe("legacy-only");
  });

  it("no-ops schedule when dark dual-read env is off", () => {
    expect(
      runItem7W3CatalogSynthesisShadow({
        ledgerId: "S08",
        existingResourceId: "ws:tenant-a:user:user-elle:asset:agent-1",
        env: {},
      }),
    ).toBeNull();
  });
});
