import { describe, expect, it } from "vitest";
import {
  compareItem7W1DualRead,
  decideItem7W1Write,
  evaluateItem7MetRequest,
  isItem7W1DarkDualReadEnabled,
  ITEM7_FROZEN_WRITE_WATCH_INDEX,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
  ITEM7_W1_CATALOG_MISS_DENY,
  ITEM7_W1_DELETE_CALL_SITES,
  ITEM7_W1_PRODUCTION_CATALOG_WRITE,
  ITEM7_W1_SCHEMA_V2_WRITE,
  ITEM7_W1_WAVE,
} from "./item7-w1-dark-tombstone.js";

describe("Item 7 W1 dark dual-read and tombstone", () => {
  it("keeps Catalog miss=deny off and does not delete call-sites", () => {
    expect(ITEM7_W1_WAVE).toBe("W1");
    expect(isItem7W1DarkDualReadEnabled({})).toBe(false);
    expect(isItem7W1DarkDualReadEnabled({ OPENBOT_ITEM7_W1_DARK_DUAL_READ: "1" })).toBe(true);
    expect(ITEM7_W1_CATALOG_MISS_DENY).toBe(false);
    expect(ITEM7_W1_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_W1_PRODUCTION_CATALOG_WRITE).toBe(false);
    expect(ITEM7_W1_SCHEMA_V2_WRITE).toBe(false);
    expect(ITEM7_LIVE_WRITE_WATCH_INDEX).toBe(37);
    expect(ITEM7_FROZEN_WRITE_WATCH_INDEX).toBe(38);
  });

  it("dual-reads without switching production writes", () => {
    const match = compareItem7W1DualRead({
      legacyLocator: "ws-resource-1",
      replacementResourceId: "ws-resource-1",
    });
    expect(match.productionWrite).toBe("legacy-only");
    expect(match.comparison).toBe("match");
    expect(match.quarantine).toBe(false);
    expect(match.catalogMissDeny).toBe(false);

    const mismatch = compareItem7W1DualRead({
      legacyLocator: "dir-a",
      replacementResourceId: "ws-b",
    });
    expect(mismatch.productionWrite).toBe("legacy-only");
    expect(mismatch.comparison).toBe("mismatch");
    expect(mismatch.quarantine).toBe(true);

    const missing = compareItem7W1DualRead({
      legacyLocator: "dir-a",
      replacementResourceId: null,
    });
    expect(missing.comparison).toBe("replacement-missing");
    expect(missing.quarantine).toBe(true);
    expect(missing.catalogMissDeny).toBe(false);
  });

  it("tombstones replacement-path new writes and leaves legacy sites running", () => {
    const legacy = decideItem7W1Write({ kind: "legacy-production" });
    expect(legacy.allow).toBe(true);
    expect(legacy.action).toBe("keep-legacy-production");

    const replacement = decideItem7W1Write({ kind: "replacement-new" });
    expect(replacement.allow).toBe(false);
    expect(replacement.action).toBe("tombstone-quarantine");
    expect(replacement.reason).toBe("w1-dark-tombstone-replacement-new-write");
  });

  it("refuses Item 7 met while liveWriteWatchIndex is 37", () => {
    const denied = evaluateItem7MetRequest({
      liveWriteWatchIndex: ITEM7_LIVE_WRITE_WATCH_INDEX,
      independentRetirementReviewAccepted: true,
      rollbackProof: true,
      quarantineProof: true,
    });
    expect(denied.allow).toBe(false);
    expect(denied.item7).toBe("not-met");
    expect(denied.reason).toBe("live-write-watch-index-nonzero");
    expect(
      evaluateItem7MetRequest({
        liveWriteWatchIndex: 0,
        independentRetirementReviewAccepted: false,
        rollbackProof: true,
        quarantineProof: true,
        deleteCallSites: true,
      }).reason,
    ).toBe("delete-call-sites-forbidden");
  });
});
