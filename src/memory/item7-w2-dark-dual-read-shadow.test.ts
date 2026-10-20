import { describe, expect, it } from "vitest";
import {
  ITEM7_W1_DARK_DUAL_READ_ENV,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
} from "./item7-w1-dark-tombstone.js";
import {
  ITEM7_W2_SITES,
  runItem7W2DarkDualReadShadow,
  scheduleItem7W2DarkDualReadShadow,
} from "./item7-w2-dark-dual-read-shadow.js";

describe("Item 7 W2 batch-1 dark dual-read shadow", () => {
  it("is a no-op when dark dual-read env is off", () => {
    expect(
      runItem7W2DarkDualReadShadow({
        siteId: "S02-get-reply",
        legacyLocator: "/legacy/ws",
        replacementLocator: "/catalog/ws",
        env: {},
      }),
    ).toBeNull();
  });

  it("dual-reads without switching production writes for S02", () => {
    const enabledEnv = { [ITEM7_W1_DARK_DUAL_READ_ENV]: "1" };
    const match = runItem7W2DarkDualReadShadow({
      siteId: ITEM7_W2_SITES[0],
      legacyLocator: "/legacy/ws",
      replacementLocator: "/legacy/ws",
      env: enabledEnv,
    });
    expect(match?.enabled).toBe(true);
    expect(match?.productionWrite).toBe("legacy-only");
    expect(match?.comparison).toBe("match");
    expect(match?.catalogMissDeny).toBe(false);

    const mismatch = runItem7W2DarkDualReadShadow({
      siteId: ITEM7_W2_SITES[0],
      legacyLocator: "/legacy/ws",
      replacementLocator: "/catalog/ws",
      env: enabledEnv,
    });
    expect(mismatch?.comparison).toBe("mismatch");
    expect(mismatch?.quarantine).toBe(true);
    expect(ITEM7_LIVE_WRITE_WATCH_INDEX).toBe(37);
  });

  it("schedule helper is a no-op when env is off", () => {
    expect(
      scheduleItem7W2DarkDualReadShadow({
        siteId: ITEM7_W2_SITES[1],
        legacyLocator: "/legacy",
        replacementLocator: null,
        env: {},
      }),
    ).toBeUndefined();
  });
});
