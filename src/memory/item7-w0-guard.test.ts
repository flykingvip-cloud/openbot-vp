import { describe, expect, it } from "vitest";
import {
  compareItem7W0DualRead,
  evaluateItem7W0CatalogMissDeny,
  evaluateItem7W0DeleteGate,
  evaluateItem7W0LiveCutover,
  evaluateItem7W0Met,
  evaluateItem7W0Retirement,
  isItem7W0DarkDualReadEnabled,
  ITEM7_W0_CATALOG_MISS_DENY,
  ITEM7_W0_DELETE_CALL_SITES,
  ITEM7_W0_FROZEN_WRITE_WATCH_INDEX,
  ITEM7_W0_LIVE_WRITE_WATCH_INDEX,
  ITEM7_W0_RETIRED_THIS_CHANGE,
  ITEM7_W0_WAVE,
  recordItem7W0Tombstone,
  revokeItem7W0Tombstone,
  rollbackItem7W0Tombstone,
} from "./item7-w0-guard.js";

describe("Item 7 W0 dual-read, tombstone, and delete gate", () => {
  it("keeps watch index at 37 and does not delete call-sites", () => {
    expect(ITEM7_W0_WAVE).toBe("W0");
    expect(isItem7W0DarkDualReadEnabled({})).toBe(false);
    expect(isItem7W0DarkDualReadEnabled({ OPENBOT_ITEM7_W0_DARK_DUAL_READ: "1" })).toBe(true);
    expect(ITEM7_W0_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W0_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_W0_LIVE_WRITE_WATCH_INDEX).toBe(37);
    expect(ITEM7_W0_FROZEN_WRITE_WATCH_INDEX).toBe(38);
    expect(ITEM7_W0_RETIRED_THIS_CHANGE).toBe(0);
  });

  it("dual-reads without switching production writes", () => {
    const match = compareItem7W0DualRead({
      legacyLocator: "ws-resource-1",
      replacementResourceId: "ws-resource-1",
    });
    expect(match.productionWrite).toBe("legacy-only");
    expect(match.comparison).toBe("match");
    expect(match.quarantine).toBe(false);
    expect(match.deleteCallSites).toBe(false);

    const mismatch = compareItem7W0DualRead({
      legacyLocator: "dir-a",
      replacementResourceId: "ws-b",
    });
    expect(mismatch.quarantine).toBe(true);
    expect(mismatch.catalogMissDeny).toBe(false);
  });

  it("tombstones without blocking legacy restore, then rollback/revoke", () => {
    const tombstone = recordItem7W0Tombstone({
      id: "t1",
      tenantId: "tenant-a",
      resourceId: "resource-1",
    });
    expect(tombstone.lifted).toBe(false);
    expect(tombstone.restoresLegacy).toBe(true);
    expect(tombstone.productionWrite).toBe(false);
    const rolled = rollbackItem7W0Tombstone(tombstone);
    expect(rolled.lifted).toBe(true);
    expect(rolled.restoresLegacy).toBe(true);
    const revoked = revokeItem7W0Tombstone(tombstone);
    expect(revoked.lifted).toBe(true);
  });

  it("denies delete, retirement without unlock, live cutover, miss=deny, and met", () => {
    expect(evaluateItem7W0DeleteGate({ deleteCallSites: true }).reason).toBe(
      "delete-call-sites-forbidden",
    );
    expect(
      evaluateItem7W0Retirement({ executeRetirement: true, retirementUnlockIssued: false }).reason,
    ).toBe("retirement-unlock-required");
    expect(evaluateItem7W0Retirement({}).reason).toBe("retirement-forbidden");
    expect(evaluateItem7W0LiveCutover().reason).toBe("live-cutover-forbidden");
    expect(evaluateItem7W0CatalogMissDeny(true).allow).toBe(false);
    expect(evaluateItem7W0Met().reason).toBe("item7-met-forbidden");
    expect(evaluateItem7W0DeleteGate({ liveWriteWatchIndex: 0 }).reason).toBe(
      "rewrite-watch-index-forbidden",
    );
  });
});
