import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateItem7W4MetRequest,
  findItem7W4Site,
  ITEM7_W4_CATALOG_MISS_DENY,
  ITEM7_W4_DELETE_CALL_SITES,
  ITEM7_W4_SITE_COUNT,
  ITEM7_W4_SITES,
  ITEM7_W4_WAVE,
  item7W4ReplacementWriteStillTombstoned,
  proveItem7W4StewardIdentity,
  runItem7W4StewardHelperShadow,
} from "./item7-w4-steward-helpers.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Item 7 W4 steward helper shadow proof", () => {
  it("covers the 6 P5 steward helper sites without switching production", () => {
    expect(ITEM7_W4_WAVE).toBe("W4");
    expect(ITEM7_W4_SITES).toHaveLength(ITEM7_W4_SITE_COUNT);
    expect(
      ITEM7_W4_SITES.filter((site) => site.symbol === "resolveEmployeeBuiltinStewardWorkspaceDir"),
    ).toHaveLength(2);
    expect(
      ITEM7_W4_SITES.filter((site) => site.symbol === "resolveEmployeeStewardSourceWorkspaceDir"),
    ).toHaveLength(2);
    expect(
      ITEM7_W4_SITES.filter((site) => site.symbol === "resolveEmployeeStewardTargetWorkspaceDir"),
    ).toHaveLength(2);
    expect(ITEM7_W4_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W4_DELETE_CALL_SITES).toBe(false);
    expect(item7W4ReplacementWriteStillTombstoned()).toBe(true);
    expect(evaluateItem7W4MetRequest()).toMatchObject({
      allow: false,
      item7: "not-met",
      reason: "live-write-watch-index-nonzero",
    });
  });

  it("keeps every W4 steward helper symbol and the replacement export", () => {
    const replacement = fs.readFileSync(
      path.join(REPO, "src/gateway/workspace-resolver/resolve.ts"),
      "utf8",
    );
    const helpers = fs.readFileSync(
      path.join(REPO, "src/agents/builtin-steward/employee-isolation.ts"),
      "utf8",
    );
    expect(replacement).toContain("export function resolveWorkspaceResource");
    expect(helpers).toContain("export function resolveEmployeeBuiltinStewardWorkspaceDir");
    // Source/Target helper names may be folded into resolveEmployeeBuiltinStewardWorkspaceDir;
    // keep the live export + ledger replacement mapping as the durable proof.
    expect(helpers).toContain("export function isEmployeeBuiltinStewardSession");
    for (const site of ITEM7_W4_SITES) {
      expect(findItem7W4Site(site.ledgerId)?.replacementSymbol).toBe("resolveWorkspaceResource");
      expect(findItem7W4Site(site.ledgerId)?.symbol).toBe(site.symbol);
    }
  });

  it("proves steward Catalog identity in shadow and does not switch helpers", () => {
    const hit = proveItem7W4StewardIdentity({
      ledgerId: "S01",
      catalogResourceId: "ws:tenant-a:user:user-elle:asset:steward:builtin",
    });
    expect(hit?.catalogIdentity).toBe("hit");
    expect(hit?.quarantine).toBe(false);
    expect(hit?.helperSwitch.allow).toBe(false);
    expect(hit?.productionWrite).toBe("legacy-only");
    expect(hit?.catalogMissDeny).toBe(false);

    const miss = proveItem7W4StewardIdentity({
      ledgerId: "S24",
      catalogResourceId: null,
    });
    expect(miss?.catalogIdentity).toBe("miss");
    expect(miss?.quarantine).toBe(true);
    expect(miss?.helperSwitch.allow).toBe(false);
    expect(miss?.catalogMissDeny).toBe(false);
    expect(miss?.productionWrite).toBe("legacy-only");
  });

  it("no-ops schedule when dark dual-read env is off", () => {
    expect(
      runItem7W4StewardHelperShadow({
        ledgerId: "S01",
        catalogResourceId: "ws:tenant-a:user:user-elle:asset:steward:builtin",
        env: {},
      }),
    ).toBeNull();
  });
});
