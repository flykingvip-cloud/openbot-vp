import { describe, expect, it } from "vitest";
import {
  ackLedgerIntent,
  assertLedgerBridgeOutput,
  toolResultLedgerIntent,
} from "./ledger-bridge.js";

describe("ledger bridge (types only, no writer)", () => {
  it("accepts tool_result as allowed evidence", () => {
    expect(() => assertLedgerBridgeOutput(toolResultLedgerIntent("web_fetch"))).not.toThrow();
  });

  it("rejects assistant_text / model_claim (Ledger I1)", () => {
    expect(() =>
      assertLedgerBridgeOutput({ eventType: "EVIDENCE_RECORDED", evidenceType: "assistant_text" }),
    ).toThrowError(/ORCH7/);
    expect(() =>
      assertLedgerBridgeOutput({ eventType: "EVIDENCE_RECORDED", evidenceType: "model_claim" }),
    ).toThrowError(/ORCH7/);
  });

  it("treats ack as not delivery", () => {
    const ack = ackLedgerIntent();
    expect(ack.ackOnly).toBe(true);
    expect(ack.eventType).not.toBe("STEP_COMPLETED");
    expect(() =>
      assertLedgerBridgeOutput({ eventType: "STEP_COMPLETED", ackOnly: true }),
    ).toThrowError(/ack/i);
  });
});
