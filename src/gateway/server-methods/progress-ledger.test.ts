import { describe, expect, it, vi } from "vitest";
import { progressLedgerHandlers } from "./progress-ledger.js";

describe("progress-ledger.admin.list", () => {
  it("returns an empty canonical snapshot when the feature is off", async () => {
    const respond = vi.fn();
    await progressLedgerHandlers["progress-ledger.admin.list"]?.({
      req: { id: "1", method: "progress-ledger.admin.list" } as never,
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: { cronStorePath: "/tmp/missing-cron.json" } as never,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        projectionKind: "canonical",
        items: [],
        metrics: expect.objectContaining({
          writesAccepted: expect.any(Number),
          writesRejected: expect.any(Number),
          violationsById: expect.objectContaining({ I1: expect.any(Number) }),
        }),
      }),
    );
  });
});
