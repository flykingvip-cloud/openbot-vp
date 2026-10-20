import { describe, expect, it } from "vitest";
import { LedgerInvariantError, LedgerWriteError } from "./errors.js";
import {
  ALLOWED_EVIDENCE_TYPES,
  FORBIDDEN_EVIDENCE_TYPES,
  recordEvidence,
  requirePayloadEvidence,
} from "./evidence.js";

describe("evidence whitelist", () => {
  it("accepts each allowed type", () => {
    for (const type of ALLOWED_EVIDENCE_TYPES) {
      expect(
        recordEvidence({
          type,
          atMs: 10,
          source: "crm",
          receiptId: "id-1",
        }).type,
      ).toBe(type);
    }
  });

  it("rejects LLM self-report and other forbidden types", () => {
    for (const type of FORBIDDEN_EVIDENCE_TYPES) {
      expect(() => recordEvidence({ type, atMs: 10 })).toThrow(LedgerInvariantError);
    }
  });

  it("rejects assistant prose disguised as evidence", () => {
    expect(() =>
      recordEvidence({
        type: "llm_self_report",
        atMs: 10,
        note: "我已经成功发送邮件。",
      }),
    ).toThrow(/forbidden evidence type/);
  });

  it("rejects unknown types", () => {
    expect(() => recordEvidence({ type: "vibes", atMs: 1 })).toThrow(LedgerWriteError);
  });

  it("rejects missing atMs", () => {
    expect(() => recordEvidence({ type: "tool_result" })).toThrow(/atMs/);
  });

  it("requires the event payload itself to carry allowed evidence", () => {
    expect(() => requirePayloadEvidence("VALIDATION_PASSED", undefined)).toThrow(/I3/);
    expect(() => requirePayloadEvidence("STEP_COMPLETED", [])).toThrow(/I3/);
    expect(
      requirePayloadEvidence("ACCEPTANCE_MET", {
        type: "external_receipt",
        atMs: 10,
        receiptId: "msg_1",
      }),
    ).toHaveLength(1);
  });
});
