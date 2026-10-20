import { describe, expect, it } from "vitest";
import { classifyA9M1Event, isE52CutoverReceipt, type A9M1Event } from "./a9-m1-observation.js";

const forgedReceipt: A9M1Event = {
  kind: "a9-m1",
  proposalId: "evo:a9",
  experimentId: "exp:a9",
  applicationId: "app:a9",
  recordedAt: "2026-09-22T04:00:00.000Z",
  cutoverReady: true,
  e52SwitchAllowed: true,
  executedConsumer: true,
  directMutatorsRetired: true,
  killSwitchDrillPassed: true,
  rollbackDrillPassed: true,
  idempotentReplayPassed: true,
  audited: true,
  observationWindowRevalidated: true,
};

describe("A9 M1 classification", () => {
  it("keeps an M1 event from becoming an E5.2 cutover receipt", () => {
    const classified = classifyA9M1Event(forgedReceipt);
    expect(classified.accepted).toBe(true);
    expect(classified.isE52CutoverReceipt).toBe(false);
    expect(classified.executedConsumer).toBe(false);
    expect(classified.directMutatorsRetired).toBe(false);
    expect(classified.proposalId).toBe("evo:a9");
    expect(classified.experimentId).toBe("exp:a9");
    expect(classified.applicationId).toBe("app:a9");
    expect(isE52CutoverReceipt(forgedReceipt)).toBe(false);
  });

  it("does not honor a client-declared E5.2 receipt kind", () => {
    const declared = classifyA9M1Event({
      kind: "e5.2-cutover-receipt",
      cutoverReady: true,
      e52SwitchAllowed: true,
      executedConsumer: true,
      directMutatorsRetired: true,
    });
    expect(declared.accepted).toBe(false);
    expect(declared.isE52CutoverReceipt).toBe(false);
    expect(declared.executedConsumer).toBe(false);
    expect(declared.directMutatorsRetired).toBe(false);
    expect(isE52CutoverReceipt({ kind: "e5.2-cutover-receipt" })).toBe(false);
  });
});
