import { describe, expect, it, vi } from "vitest";
import {
  PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
  approvalFailureText,
  callPlatformDiagnosisApproval,
  canCallPlatformDiagnosisApproval,
  conversationEffectMatches,
  exportEffectMatches,
  grantEffectMatches,
} from "./diagnosis-approval-client.ts";

const ready = {
  connected: true,
  scopes: ["operator.approvals"],
  sessionKind: "platform-admin",
  methods: [PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD],
};

describe("platform diagnosis approval client", () => {
  it("enables the call only when connected, scoped, and the method is advertised", () => {
    expect(canCallPlatformDiagnosisApproval(ready)).toBe(true);
    expect(
      canCallPlatformDiagnosisApproval({ ...ready, sessionKind: "platform-super-admin" }),
    ).toBe(true);
    expect(canCallPlatformDiagnosisApproval({ ...ready, connected: false })).toBe(false);
    expect(canCallPlatformDiagnosisApproval({ ...ready, scopes: ["operator.admin"] })).toBe(false);
    expect(canCallPlatformDiagnosisApproval({ ...ready, scopes: ["operator.read"] })).toBe(false);
    expect(canCallPlatformDiagnosisApproval({ ...ready, sessionKind: "enterprise-admin" })).toBe(
      false,
    );
    expect(canCallPlatformDiagnosisApproval({ ...ready, sessionKind: "member" })).toBe(false);
    expect(
      canCallPlatformDiagnosisApproval({ ...ready, methods: ["diagnosis.issues.advance"] }),
    ).toBe(false);
    expect(canCallPlatformDiagnosisApproval({ ...ready, methods: null })).toBe(false);
  });

  it("accepts a grant only when status is recorded and the effect matches", () => {
    expect(
      grantEffectMatches(
        {
          status: "recorded",
          effect: { type: "grant", grantId: "grant-1", grantStatus: "APPROVED" },
        },
        "grant-1",
        "approve",
      ),
    ).toBe(true);
    expect(
      grantEffectMatches(
        {
          status: "recorded",
          effect: { type: "grant", grantId: "grant-1", grantStatus: "APPROVED" },
        },
        "grant-1",
        "deny",
      ),
    ).toBe(false);
    expect(
      grantEffectMatches(
        {
          status: "refused",
          reason: "grant_not_pending",
          effect: { type: "none", reason: "grant_not_pending" },
        },
        "grant-1",
        "approve",
      ),
    ).toBe(false);
  });

  it("accepts a conversation session key only on a recorded open", () => {
    expect(
      conversationEffectMatches(
        {
          status: "recorded",
          effect: { type: "conversation", opened: true, sessionKey: "agent:daibai:diagnosis:1" },
        },
        "approve",
      ),
    ).toBe(true);
    expect(
      conversationEffectMatches(
        {
          status: "refused",
          reason: "session_key_unavailable",
          effect: { type: "none", reason: "session_key_unavailable" },
        },
        "approve",
      ),
    ).toBe(false);
    expect(approvalFailureText({ status: "refused", reason: "subject_incomplete" })).toContain(
      "信号或案例",
    );
  });

  it("accepts an export body only when the recorded effect includes one", () => {
    expect(
      exportEffectMatches(
        {
          status: "recorded",
          effect: {
            type: "export",
            filename: "cdr.json",
            mediaType: "application/json",
            body: "{}",
          },
        },
        "approve",
      ),
    ).toBe(true);
    expect(
      exportEffectMatches(
        {
          status: "refused",
          reason: "export_unavailable",
          effect: { type: "none", reason: "export_unavailable" },
        },
        "approve",
      ),
    ).toBe(false);
    expect(approvalFailureText({ status: "refused", reason: "report_not_found" })).toContain(
      "找不到",
    );
  });

  it("sends the decide method and not a stand-in", async () => {
    const request = vi.fn(async () => ({ status: "recorded" }));
    await callPlatformDiagnosisApproval({ request } as never, {
      decision: "approve",
      subject: { kind: "authorization", grantId: "grant-1" },
    });
    expect(request).toHaveBeenCalledWith(
      PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
      expect.objectContaining({
        schemaVersion: 1,
        decision: "approve",
        subject: { kind: "authorization", grantId: "grant-1" },
      }),
    );
    const body = request.mock.calls[0]?.[1] as { idempotencyKey?: string };
    expect(body.idempotencyKey?.length).toBeGreaterThan(0);
  });
});
