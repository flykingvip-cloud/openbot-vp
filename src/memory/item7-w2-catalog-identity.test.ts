import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateItem7W2MetRequest,
  findItem7W2Site,
  ITEM7_W2_CATALOG_MISS_DENY,
  ITEM7_W2_DELETE_CALL_SITES,
  ITEM7_W2_SITE_COUNT,
  ITEM7_W2_SITES,
  ITEM7_W2_WAVE,
  ITEM7_W2_WIRED_TO_PRODUCTION_RESOLVER,
  item7W2ReplacementWriteStillTombstoned,
  proveItem7W2CatalogIdentity,
} from "./item7-w2-catalog-identity.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Item 7 W2 Catalog identity shadow proof", () => {
  it("covers the 16 P1/P3 write callers without wiring production", () => {
    expect(ITEM7_W2_WAVE).toBe("W2");
    expect(ITEM7_W2_SITES).toHaveLength(ITEM7_W2_SITE_COUNT);
    expect(ITEM7_W2_SITES.filter((site) => site.pathId === "P1")).toHaveLength(9);
    expect(ITEM7_W2_SITES.filter((site) => site.pathId === "P3")).toHaveLength(7);
    expect(ITEM7_W2_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W2_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_W2_WIRED_TO_PRODUCTION_RESOLVER).toBe(false);
    expect(item7W2ReplacementWriteStillTombstoned()).toBe(true);
    expect(evaluateItem7W2MetRequest()).toMatchObject({
      allow: false,
      item7: "not-met",
      reason: "live-write-watch-index-nonzero",
    });
  });

  it("keeps every W2 legacy symbol and the replacement export", () => {
    const replacement = fs.readFileSync(
      path.join(REPO, "src/gateway/workspace-resolver/resolve.ts"),
      "utf8",
    );
    expect(replacement).toContain("export function resolveWorkspaceResource");
    for (const site of ITEM7_W2_SITES) {
      const source = fs.readFileSync(path.join(REPO, site.file), "utf8");
      const hasLegacyPin =
        source.includes(site.symbol) || source.includes("resolveAgentWorkspaceDir");
      const hasLiveResolver =
        source.includes("resolveWorkspaceLocator") ||
        source.includes("resolveLiveRobotWriteRoot") ||
        source.includes("resolveRobotWriteRoot") ||
        source.includes("resolveAgentsHandlerWorkspaceLocator");
      expect(hasLegacyPin || hasLiveResolver, site.ledgerId).toBe(true);
      expect(findItem7W2Site(site.ledgerId)?.replacementSymbol).toBe("resolveWorkspaceResource");
    }
  });

  it("dual-reads Catalog identity without switching production writes", () => {
    const hit = proveItem7W2CatalogIdentity({
      ledgerId: "S02",
      catalogResourceId: "ws:tenant-a:user:user-elle:asset:agent-1",
      legacyLocator: "ws:tenant-a:user:user-elle:asset:agent-1",
    });
    expect(hit?.catalogIdentity).toBe("hit");
    expect(hit?.dualRead.comparison).toBe("match");
    expect(hit?.dualRead.productionWrite).toBe("legacy-only");
    expect(hit?.callerSwitch.allow).toBe(false);
    expect(hit?.catalogMissDeny).toBe(false);

    const miss = proveItem7W2CatalogIdentity({
      ledgerId: "S03",
      catalogResourceId: null,
      legacyLocator: "/tmp/legacy-agent-workspace",
    });
    expect(miss?.catalogIdentity).toBe("miss");
    expect(miss?.dualRead.comparison).toBe("replacement-missing");
    expect(miss?.dualRead.quarantine).toBe(true);
    expect(miss?.catalogMissDeny).toBe(false);
    expect(miss?.productionWrite).toBe("legacy-only");
  });
});
