import { describe, expect, it } from "vitest";
import {
  PRE04_ISOLATION_RETENTION_DAYS,
  PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT,
  PRE04_LEAVER_POLICY_GUARD_IO,
  PRE04_MAX_FREEZE_DELAY_MS,
  evaluatePre04LeaverPolicy,
  type Pre04LeaverEvent,
} from "./pre04-leaver-policy-guard.js";

const OCCURRED = "2026-11-28T18:00:00.000+08:00";
const FREEZE_OK = "2026-11-28T18:00:30.000+08:00";
const FREEZE_LATE = "2026-11-28T18:02:00.000+08:00";

const validLeave: Pre04LeaverEvent = {
  event: "leave",
  occurred_at: OCCURRED,
  freeze_applied_at: FREEZE_OK,
  isolation_retention_days: 90,
  isolation_mode: "read-only",
  handover: {
    approvals: [
      { approver_id: "syn_approver_aaa", approved_at: "2026-11-28T18:05:00.000+08:00" },
      { approver_id: "syn_approver_bbb", approved_at: "2026-11-28T18:06:00.000+08:00" },
    ],
    receipt_id: "syn_handover_receipt_001",
  },
  private_body_inheritance: "none",
  controlled_shares: [
    {
      share_id: "syn_share_001",
      expired: true,
      expires_at: OCCURRED,
    },
  ],
};

describe("PRE-04 leaver policy guard", () => {
  it("stays default-off and performs no I/O", () => {
    expect(PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT).toBe(false);
    expect(PRE04_LEAVER_POLICY_GUARD_IO).toEqual({
      database: false,
      network: false,
      diskWrites: false,
    });
    expect(PRE04_MAX_FREEZE_DELAY_MS).toBe(60_000);
    expect(PRE04_ISOLATION_RETENTION_DAYS).toBe(90);
    expect(evaluatePre04LeaverPolicy(validLeave)).toEqual({
      enabled: false,
      ok: false,
      code: "GUARD_DISABLED",
      violations: [],
    });
    // Explicit false is also off; a valid event is not silently treated as passed.
    expect(evaluatePre04LeaverPolicy(validLeave, { enabled: false }).code).toBe("GUARD_DISABLED");
  });

  it("when enabled, accepts a synthetic event that satisfies all five rules", () => {
    expect(evaluatePre04LeaverPolicy(validLeave, { enabled: true })).toEqual({
      enabled: true,
      ok: true,
      code: "PRE04_POLICY_OK",
      violations: [],
    });
  });

  it("rule 1: intercepts a leave that is not frozen in real time (≤60s)", () => {
    expect(
      evaluatePre04LeaverPolicy({ ...validLeave, event: "ignored" }, { enabled: true }).violations,
    ).toContain("LEAVE_NOT_INTERCEPTED");
    expect(
      evaluatePre04LeaverPolicy({ ...validLeave, freeze_applied_at: undefined }, { enabled: true })
        .violations,
    ).toContain("LEAVE_NOT_INTERCEPTED");
    expect(
      evaluatePre04LeaverPolicy(
        { ...validLeave, freeze_applied_at: FREEZE_LATE },
        { enabled: true },
      ).violations,
    ).toContain("FREEZE_DEADLINE_EXCEEDED");
  });

  it("rule 2: requires 90-day read-only isolation retention", () => {
    expect(
      evaluatePre04LeaverPolicy({ ...validLeave, isolation_retention_days: 30 }, { enabled: true })
        .violations,
    ).toContain("ISOLATION_RETENTION_INVALID");
    expect(
      evaluatePre04LeaverPolicy({ ...validLeave, isolation_mode: "read-write" }, { enabled: true })
        .violations,
    ).toContain("ISOLATION_RETENTION_INVALID");
  });

  it("rule 3: requires dual-approval handover of work products with a receipt", () => {
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...validLeave,
          handover: {
            approvals: [validLeave.handover!.approvals![0]],
            receipt_id: "syn_handover_receipt_001",
          },
        },
        { enabled: true },
      ).violations,
    ).toContain("HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING");
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...validLeave,
          handover: {
            approvals: validLeave.handover!.approvals,
            receipt_id: "",
          },
        },
        { enabled: true },
      ).violations,
    ).toContain("HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING");
    // Two stamps by the same approver are not dual approval.
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...validLeave,
          handover: {
            approvals: [
              { approver_id: "syn_approver_aaa", approved_at: "2026-11-28T18:05:00.000+08:00" },
              { approver_id: "syn_approver_aaa", approved_at: "2026-11-28T18:06:00.000+08:00" },
            ],
            receipt_id: "syn_handover_receipt_001",
          },
        },
        { enabled: true },
      ).violations,
    ).toContain("HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING");
  });

  it("rule 4: forbids automatic inheritance of private body", () => {
    expect(
      evaluatePre04LeaverPolicy(
        { ...validLeave, private_body_inheritance: "automatic" },
        { enabled: true },
      ).violations,
    ).toContain("PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN");
    expect(
      evaluatePre04LeaverPolicy(
        { ...validLeave, private_body_inheritance: undefined },
        { enabled: true },
      ).violations,
    ).toContain("PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN");
  });

  it("rule 5: requires controlled shares to expire immediately at leave time", () => {
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...validLeave,
          controlled_shares: [
            {
              share_id: "syn_share_still_open",
              expired: false,
              expires_at: OCCURRED,
            },
          ],
        },
        { enabled: true },
      ).violations,
    ).toContain("CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED");
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...validLeave,
          controlled_shares: [
            {
              share_id: "syn_share_late",
              expired: true,
              expires_at: "2026-11-28T19:00:00.000+08:00",
            },
          ],
        },
        { enabled: true },
      ).violations,
    ).toContain("CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED");
  });
});
