import { describe, expect, it } from "vitest";
import { ITEM7_W1_DARK_DUAL_READ_ENV } from "../memory/item7-w1-dark-tombstone.js";
import {
  scheduleCheckpointStoreS05S06Shadow,
  scheduleCheckpointStoreS07Shadow,
} from "./checkpoint-store-w2-shadow.js";

describe("checkpoint-store W2 batch-3 shadow", () => {
  it("schedules S07 without throwing when env is off", () => {
    expect(() =>
      scheduleCheckpointStoreS07Shadow({
        legacyLocator: "/host/ws",
        replacementLocator: "/tenant/ws",
      }),
    ).not.toThrow();
  });

  it("schedules S05/S06 from resolved dirs when env is on", () => {
    const prev = process.env[ITEM7_W1_DARK_DUAL_READ_ENV];
    process.env[ITEM7_W1_DARK_DUAL_READ_ENV] = "1";
    try {
      expect(() =>
        scheduleCheckpointStoreS05S06Shadow({
          workspaceDirs: ["/host/ws", "/users/alice/steward/ws"],
          employeeOwner: "alice",
        }),
      ).not.toThrow();
    } finally {
      if (prev === undefined) {
        delete process.env[ITEM7_W1_DARK_DUAL_READ_ENV];
      } else {
        process.env[ITEM7_W1_DARK_DUAL_READ_ENV] = prev;
      }
    }
  });
});
