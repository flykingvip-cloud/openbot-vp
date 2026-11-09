import { expect, it } from "vitest";
import { confirmedDeliveryMessageIds } from "./delivery-receipt.js";
it("requires every transport acknowledgement to have a real id", () => {
  for (const value of [
    undefined,
    [],
    [{}],
    [{ messageId: "unknown" }],
    [{ messageId: " " }],
    [{ messageId: "ok" }, { messageId: "unknown" }],
  ]) {
    expect(confirmedDeliveryMessageIds(value)).toBeUndefined();
  }
  expect(confirmedDeliveryMessageIds([{ messageId: "ok-1" }, { messageId: "ok-2" }])).toEqual([
    "ok-1",
    "ok-2",
  ]);
});
