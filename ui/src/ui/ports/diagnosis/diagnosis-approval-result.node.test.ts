import { describe, expect, it } from "vitest";
import { readDiagnosisApprovalOutcome } from "./diagnosis-approval-result.ts";

describe("diagnosis approval outcome", () => {
  it("accepts a matching grant effect and rejects a mismatched status", () => {
    expect(
      readDiagnosisApprovalOutcome({
        purpose: "grant",
        decision: "approve",
        grantId: "grant-a",
        body: {
          status: "recorded",
          effect: { type: "grant", grantId: "grant-a", grantStatus: "APPROVED" },
        },
      }),
    ).toEqual({ ok: true, text: "已批准该授权。" });
    expect(
      readDiagnosisApprovalOutcome({
        purpose: "grant",
        decision: "approve",
        grantId: "grant-a",
        body: {
          status: "recorded",
          effect: { type: "grant", grantId: "grant-a", grantStatus: "DENIED" },
        },
      }).ok,
    ).toBe(false);
  });

  it("accepts an opened session and shows a refusal without calling it success", () => {
    expect(
      readDiagnosisApprovalOutcome({
        purpose: "conversation",
        decision: "approve",
        body: {
          status: "recorded",
          effect: { type: "conversation", opened: true, sessionKey: "agent:daibai:main" },
        },
      }),
    ).toEqual({ ok: true, text: "已打开大白会话。", sessionKey: "agent:daibai:main" });
    expect(
      readDiagnosisApprovalOutcome({
        purpose: "conversation",
        decision: "approve",
        body: { status: "refused", reason: "session_key_unavailable" },
      }),
    ).toEqual({ ok: false, text: "会话打不开，未打开大白。" });
  });
});
