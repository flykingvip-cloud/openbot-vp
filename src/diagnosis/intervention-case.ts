import { randomBytes } from "node:crypto";
/**
 * Track I / M2 — InterventionCase model + status machine.
 * Separate from DiagnosticCase (Finding aggregation). Does not write Diagnosis Graph
 * or trigger evolution Apply / A confirm / B submit.
 */
export type InterventionCaseId = `ic:${string}`;

export type InterventionActionKind = "bootstrap" | "identity" | "memory" | "practice" | "review";

export type InterventionCaseStatus =
  | "suggested"
  | "expanding"
  | "queued"
  | "dispatching"
  | "dispatched"
  | "receipted"
  | "blocked"
  | "failed"
  | "verified" // reserved: rediagnose closed; M2 does not migrate into verified
  | "closed"
  | "cancelled";

export type InterventionTargetKind = "agent_1to1" | "group_parent" | "member_1to1";

export type InterventionCase = {
  schemaVersion: 1;
  caseId: InterventionCaseId;
  tenantId: string | null;
  status: InterventionCaseStatus;
  actionKind: InterventionActionKind;
  title: string;
  actor: "diagnosed_agent" | "steward" | "owner";
  source: {
    actionId: string;
    growthAgentId: string | null;
    growthGroupId: string | null;
    reportRef?: string;
    /** Track D dataPlaneCases.caseKind when materialized from data plane. */
    dataPlaneCaseKind?: string;
    findingCode?: string;
  };
  target: {
    kind: InterventionTargetKind;
    agentId: string | null;
    /** Only 1:1; group parent must be null. */
    sessionKey: string | null;
    parentCaseId?: InterventionCaseId;
  };
  children?: InterventionCaseId[];
  blockReason?: string;
  dispatch?: {
    runId?: string;
    channel?: "diagnosed_agent_session" | "steward";
    at?: string;
  };
  /** Reserved for rediagnose closure — receipted ≠ verified. */
  rediagnoseRef?: string;
  daibaiReceipt?: {
    deliveryId?: string;
    status?: "accepted" | "queued" | "retried" | "expired" | "rejected" | "skipped";
    sessionKey?: string;
    skipReason?: string;
  };
  stewardReceiptText?: string;
  createdAt: string;
  updatedAt: string;
};

/** PRODUCT_LOOP authorized ≈ queued; acknowledged ≈ receipted. */
export const INTERVENTION_STATUS_ALIASES = {
  authorized: "queued",
  acknowledged: "receipted",
} as const;

const TERMINAL: ReadonlySet<InterventionCaseStatus> = new Set(["closed", "cancelled", "verified"]);

const ALLOWED: ReadonlyMap<InterventionCaseStatus, ReadonlySet<InterventionCaseStatus>> = new Map([
  ["suggested", new Set(["queued", "expanding", "blocked", "cancelled"])],
  ["expanding", new Set(["queued", "blocked", "cancelled"])],
  ["queued", new Set(["dispatching", "cancelled", "blocked"])],
  ["dispatching", new Set(["dispatched", "failed", "blocked", "cancelled"])],
  ["dispatched", new Set(["receipted", "failed", "closed", "cancelled"])],
  ["receipted", new Set(["closed", "cancelled"])],
  ["blocked", new Set(["queued", "expanding", "cancelled", "closed"])],
  ["failed", new Set(["queued", "cancelled", "closed"])],
  // verified reserved — no M2 inbound transitions
  ["verified", new Set()],
  ["closed", new Set()],
  ["cancelled", new Set()],
]);

export type TransitionInterventionCaseResult =
  | { ok: true; case: InterventionCase }
  | { ok: false; reason: "illegal_transition" | "terminal" | "parent_dispatch_forbidden" };

export function canTransitionInterventionCase(
  from: InterventionCaseStatus,
  to: InterventionCaseStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED.get(from)?.has(to) === true;
}

export function transitionInterventionCase(
  row: InterventionCase,
  to: InterventionCaseStatus,
  patch?: Partial<
    Pick<
      InterventionCase,
      | "blockReason"
      | "dispatch"
      | "daibaiReceipt"
      | "stewardReceiptText"
      | "children"
      | "rediagnoseRef"
    >
  > & { updatedAt?: string },
): TransitionInterventionCaseResult {
  if (TERMINAL.has(row.status) && row.status !== to) {
    return { ok: false, reason: "terminal" };
  }
  if (!canTransitionInterventionCase(row.status, to)) {
    return { ok: false, reason: "illegal_transition" };
  }
  // Parent never enters dispatching / dispatched — only children / agent_1to1.
  if (row.target.kind === "group_parent" && (to === "dispatching" || to === "dispatched")) {
    return { ok: false, reason: "parent_dispatch_forbidden" };
  }
  return {
    ok: true,
    case: {
      ...row,
      status: to,
      ...(patch?.blockReason !== undefined ? { blockReason: patch.blockReason } : {}),
      ...(patch?.dispatch !== undefined ? { dispatch: patch.dispatch } : {}),
      ...(patch?.daibaiReceipt !== undefined ? { daibaiReceipt: patch.daibaiReceipt } : {}),
      ...(patch?.stewardReceiptText !== undefined
        ? { stewardReceiptText: patch.stewardReceiptText }
        : {}),
      ...(patch?.children !== undefined ? { children: patch.children } : {}),
      ...(patch?.rediagnoseRef !== undefined ? { rediagnoseRef: patch.rediagnoseRef } : {}),
      updatedAt: patch?.updatedAt ?? new Date().toISOString(),
    },
  };
}

export function newInterventionCaseId(seed?: string): InterventionCaseId {
  const raw = (seed ?? `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`)
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 48);
  return `ic:${raw || "case"}`;
}

export function isDispatchableInterventionTarget(kind: InterventionTargetKind): boolean {
  return kind === "agent_1to1" || kind === "member_1to1";
}
