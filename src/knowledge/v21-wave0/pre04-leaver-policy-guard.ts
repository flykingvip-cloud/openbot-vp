/**
 * PRE-04 leaver policy guard (W5B-2). Default-off pure function.
 *
 * Implements the five official Gate 5 / PRE-04 mandatory assertions:
 *   1) immediate leave intercept / real-time freeze ≤60s
 *   2) 90-day read-only isolation retention
 *   3) dual-approval handover of work products, with receipt
 *   4) private body must not be automatically inherited
 *   5) controlled shares expire immediately
 *
 * Default is disabled. Do not turn on product default flags.
 * Do not hook this into production routes or default Gateway paths.
 * No database, network, or disk writes.
 */
export const PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT = false;
export const PRE04_MAX_FREEZE_DELAY_MS = 60_000;
export const PRE04_ISOLATION_RETENTION_DAYS = 90;

export const PRE04_LEAVER_POLICY_GUARD_IO = {
  database: false,
  network: false,
  diskWrites: false,
} as const;

export type Pre04Approval = {
  approver_id: string;
  approved_at: string;
};

export type Pre04ControlledShare = {
  share_id: string;
  expired: boolean;
  expires_at?: string;
};

export type Pre04LeaverEvent = {
  event?: string;
  occurred_at?: string;
  freeze_applied_at?: string;
  isolation_retention_days?: number;
  isolation_mode?: string;
  handover?: {
    approvals?: Pre04Approval[];
    receipt_id?: string;
  };
  private_body_inheritance?: string;
  controlled_shares?: Pre04ControlledShare[];
};

export type Pre04ViolationCode =
  | "LEAVE_NOT_INTERCEPTED"
  | "FREEZE_DEADLINE_EXCEEDED"
  | "ISOLATION_RETENTION_INVALID"
  | "HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING"
  | "PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN"
  | "CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED";

export type Pre04LeaverDecision = {
  enabled: boolean;
  ok: boolean;
  code: "GUARD_DISABLED" | "PRE04_POLICY_OK" | "PRE04_POLICY_VIOLATION";
  violations: Pre04ViolationCode[];
};

export type Pre04EvaluateOptions = {
  /** Must be passed true to enforce the five rules. Default is off. */
  enabled?: boolean;
};

function parseInstant(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function evaluatePre04LeaverPolicy(
  event: Pre04LeaverEvent,
  options: Pre04EvaluateOptions = {},
): Pre04LeaverDecision {
  const enabled = options.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      ok: false,
      code: "GUARD_DISABLED",
      violations: [],
    };
  }

  const violations: Pre04ViolationCode[] = [];
  const occurredAt = parseInstant(event.occurred_at);
  const freezeAt = parseInstant(event.freeze_applied_at);

  if (event.event !== "leave" || occurredAt === undefined || freezeAt === undefined) {
    violations.push("LEAVE_NOT_INTERCEPTED");
  } else if (freezeAt < occurredAt || freezeAt - occurredAt > PRE04_MAX_FREEZE_DELAY_MS) {
    violations.push("FREEZE_DEADLINE_EXCEEDED");
  }

  if (
    event.isolation_retention_days !== PRE04_ISOLATION_RETENTION_DAYS ||
    event.isolation_mode !== "read-only"
  ) {
    violations.push("ISOLATION_RETENTION_INVALID");
  }

  const approvals = event.handover?.approvals ?? [];
  const distinctApprovers = new Set(
    approvals
      .map((approval) => approval.approver_id)
      .filter((id) => typeof id === "string" && id.length > 0),
  );
  const receipt = event.handover?.receipt_id;
  if (distinctApprovers.size < 2 || typeof receipt !== "string" || receipt.length === 0) {
    violations.push("HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING");
  }

  if (event.private_body_inheritance !== "none") {
    violations.push("PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN");
  }

  const shares = event.controlled_shares ?? [];
  const sharesOk =
    Array.isArray(shares) &&
    shares.every((share) => {
      if (!share.expired) {
        return false;
      }
      const expiresAt = parseInstant(share.expires_at);
      if (occurredAt === undefined || expiresAt === undefined) {
        return false;
      }
      return expiresAt <= occurredAt;
    });
  if (!sharesOk) {
    violations.push("CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED");
  }

  if (violations.length > 0) {
    return {
      enabled: true,
      ok: false,
      code: "PRE04_POLICY_VIOLATION",
      violations,
    };
  }
  return {
    enabled: true,
    ok: true,
    code: "PRE04_POLICY_OK",
    violations: [],
  };
}
