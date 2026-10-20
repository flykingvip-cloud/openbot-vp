import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateItem7W5MetRequest,
  findItem7W5Site,
  ITEM7_W5_CATALOG_MISS_DENY,
  ITEM7_W5_DELETE_CALL_SITES,
  ITEM7_W5_SITE_COUNT,
  ITEM7_W5_SITES,
  ITEM7_W5_WAVE,
  item7W5ReplacementWriteStillTombstoned,
  proveItem7W5IndexIdentity,
  runItem7W5IndexShadow,
} from "./item7-w5-index-last.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Item 7 W5 memory index shadow proof", () => {
  it("covers the 8 index/dir sites without switching production", () => {
    expect(ITEM7_W5_WAVE).toBe("W5");
    expect(ITEM7_W5_SITES).toHaveLength(ITEM7_W5_SITE_COUNT);
    expect(ITEM7_W5_SITES.filter((site) => site.pathId === "P1")).toHaveLength(5);
    expect(ITEM7_W5_SITES.filter((site) => site.pathId === "P8")).toHaveLength(3);
    expect(ITEM7_W5_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W5_DELETE_CALL_SITES).toBe(false);
    expect(item7W5ReplacementWriteStillTombstoned()).toBe(true);
    expect(evaluateItem7W5MetRequest()).toMatchObject({
      allow: false,
      item7: "not-met",
      reason: "live-write-watch-index-nonzero",
    });
  });

  it("keeps every W5 legacy symbol and the Handle replacement export", () => {
    const replacement = fs.readFileSync(
      path.join(REPO, "src/gateway/workspace-resolver/memory-workspace-resolve.ts"),
      "utf8",
    );
    expect(replacement).toContain("export async function resolveMemoryWorkspaceHandle");
    for (const site of ITEM7_W5_SITES) {
      const source = fs.readFileSync(path.join(REPO, site.file), "utf8");
      expect(source, site.ledgerId).toContain(site.symbol);
      expect(findItem7W5Site(site.ledgerId)?.replacementSymbol).toBe(
        "resolveMemoryWorkspaceHandle",
      );
    }
  });

  it("proves Handle identity in shadow and does not switch the index", () => {
    const hit = proveItem7W5IndexIdentity({
      ledgerId: "S36",
      handleResourceId: "ws:tenant-a:user:user-elle:asset:agent-1",
    });
    expect(hit?.handleIdentity).toBe("hit");
    expect(hit?.quarantine).toBe(false);
    expect(hit?.indexSwitch.allow).toBe(false);
    expect(hit?.productionWrite).toBe("legacy-only");
    expect(hit?.catalogMissDeny).toBe(false);

    const miss = proveItem7W5IndexIdentity({
      ledgerId: "S33",
      handleResourceId: null,
    });
    expect(miss?.handleIdentity).toBe("miss");
    expect(miss?.quarantine).toBe(true);
    expect(miss?.indexSwitch.allow).toBe(false);
    expect(miss?.catalogMissDeny).toBe(false);
    expect(miss?.productionWrite).toBe("legacy-only");
  });

  it("no-ops schedule when dark dual-read env is off", () => {
    expect(
      runItem7W5IndexShadow({
        ledgerId: "S36",
        handleResourceId: "ws:tenant-a:user:user-elle:asset:agent-1",
        env: {},
      }),
    ).toBeNull();
  });
});
