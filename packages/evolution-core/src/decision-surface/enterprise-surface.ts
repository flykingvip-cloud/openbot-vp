/**
 * Phase D3 enterprise Decision Surface projection.
 *
 * Serves the enterprise admin of the current tenant only. Built on the shared
 * D1 snapshot path (router and visibility) and on the D1 judge: the actions a
 * row offers are exactly the ones the judge would accept at the snapshot
 * time. It does not call Gateway, the control plane, or an Adapter, and it
 * stores nothing: the weekly comparison reads two read-only snapshots.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 * Not E5.2.
 */
import type { AuthorityGrantView } from "../contracts.js";
import { evolutionTargetKey, type EvolutionTarget } from "../types.js";
import { EVOLUTION_DECISION_ENDPOINT_ACTIONS } from "./command-map.js";
import {
  EVOLUTION_DECISION_SURFACE_WRITES,
  type EvolutionDecisionAction,
  type EvolutionDecisionAuthorityFacts,
  type EvolutionDecisionCommand,
  type EvolutionDecisionItem,
  type EvolutionDecisionParticipation,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionRequiredAuthority,
  type EvolutionDecisionStatus,
  type EvolutionDecisionType,
} from "./dto.js";
import type { EvolutionDecisionCommandRecord } from "./idempotency.js";
import { judgeEvolutionDecisionCommand, type EvolutionDecisionJudgement } from "./judge.js";
import type { EvolutionDecisionRouteInput } from "./router.js";
import {
  checkEvolutionDecisionWeeklyWindow,
  diffEvolutionDecisionStatusTransitions,
  projectEvolutionDecisionSnapshot,
  type EvolutionDecisionSnapshotEntry,
  type EvolutionDecisionStatusTransition,
} from "./snapshot.js";

/**
 * Runtime gate for the enterprise Decision Surface.
 *
 * D3 is code-present only, so the gate stays closed. It is a reviewed
 * constant in this contract package, not a setting: no URL, query string,
 * browser storage, form field, or client claim can open it. Opening it needs
 * a reviewed code change plus server-resolved enterprise principals and
 * read-only Timeline/Ledger snapshots.
 */
export const EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false as const;

/** Enterprise-facing statuses. A projection, not a second control-plane state. */
export const EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES = [
  "pending-enterprise-decision",
  "waiting-employee-authorization",
  "participate-platform-canary",
  "watching",
  "completed",
  "blocked",
  "expired",
] as const;
export type EvolutionEnterpriseDecisionUiStatus =
  (typeof EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES)[number];

/**
 * One decision as the server resolved it for this enterprise. Every field is
 * a server fact: the client never supplies tenant, grant, delegation, or
 * participation state.
 */
export type EvolutionEnterpriseDecisionFact = {
  item: EvolutionDecisionItem;
  routeInput: EvolutionDecisionRouteInput;
  /** Employee final authorization and enterprise canary acknowledgement. */
  authorityFacts: EvolutionDecisionAuthorityFacts;
  /** Grant for this decision. Read by the judge only; never shown. */
  grant: AuthorityGrantView | { status: "missing" };
  createdAt: string;
  updatedAt: string;
};

/**
 * One read-only, point-in-time projection of decision facts. The runtime
 * source must be the existing Timeline/Ledger read projection; D3 does not
 * keep a history store of its own.
 */
export type EvolutionEnterpriseDecisionSnapshot = {
  asOf: string;
  facts: readonly EvolutionEnterpriseDecisionFact[];
};

/** Current snapshot plus the one a week earlier; `prior: null` fails closed. */
export type EvolutionEnterpriseDecisionHistory = {
  current: EvolutionEnterpriseDecisionSnapshot;
  prior: EvolutionEnterpriseDecisionSnapshot | null;
};

/**
 * Evidence counts only, never refs or payloads. `withheld` is a participation
 * view: employee or platform evidence stays on the server item.
 */
export type EvolutionEnterpriseEvidenceSummary = {
  availability: "available" | "unavailable" | "withheld";
  citationCount: number;
  findingCount: number;
  hasCase: boolean;
};

export type EvolutionEnterpriseDecisionRow = {
  schemaVersion: 1;
  decisionId: string;
  decisionVersion: string;
  decisionType: EvolutionDecisionType;
  uiStatus: EvolutionEnterpriseDecisionUiStatus;
  status: EvolutionDecisionStatus;
  /**
   * `enterprise_participation`: a redacted D1 view, either an employee
   * personal-asset change or a platform canary that affects this tenant.
   */
  view: "item" | "enterprise_participation";
  participation: EvolutionDecisionParticipation;
  /** `key` is omitted on canary views; the platform target stays with the platform. */
  impactTarget: {
    domain: EvolutionTarget["domain"];
    surfaceId: string;
    key?: string;
  };
  createdAt: string;
  updatedAt: string;
  evidence: EvolutionEnterpriseEvidenceSummary;
  /** Who has to decide. An authority, never a list of actions. */
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  /** Actions the D1 judge would accept now. Actions, never permissions. */
  allowedActions: readonly EvolutionDecisionAction[];
  /** Enterprise-matrix actions the judge would not accept now, with its code. */
  actionReasons: Readonly<Partial<Record<EvolutionDecisionAction, string>>>;
  expiresAt?: string;
  /** Control-plane id correlation for enterprise-owned items only. */
  correlation: {
    proposalId?: string;
    applicationId?: string;
    verificationId?: string;
  };
};

export type EvolutionEnterpriseDecisionStatusCounts = { total: number } & Record<
  EvolutionEnterpriseDecisionUiStatus,
  number
>;

export type EvolutionEnterpriseDecisionTransition =
  EvolutionDecisionStatusTransition<EvolutionEnterpriseDecisionUiStatus>;

export const EVOLUTION_ENTERPRISE_DECISION_HISTORY_UNAVAILABLE_REASONS = [
  "prior_snapshot_missing",
  "snapshot_as_of_invalid",
  "prior_not_before_current",
  "prior_snapshot_not_weekly",
  "snapshot_load_failed",
  "access_denied",
] as const;
export type EvolutionEnterpriseDecisionHistoryUnavailableReason =
  (typeof EVOLUTION_ENTERPRISE_DECISION_HISTORY_UNAVAILABLE_REASONS)[number];

export type EvolutionEnterpriseWeekOverWeekSummary =
  | {
      schemaVersion: 1;
      availability: "available";
      currentAsOf: string;
      priorAsOf: string;
      current: EvolutionEnterpriseDecisionStatusCounts;
      prior: EvolutionEnterpriseDecisionStatusCounts;
      /** `current - prior`, per status. */
      delta: EvolutionEnterpriseDecisionStatusCounts;
      /** Decisions whose status differs between the two snapshots. */
      transitions: readonly EvolutionEnterpriseDecisionTransition[];
    }
  | {
      schemaVersion: 1;
      availability: "history-unavailable";
      reason: EvolutionEnterpriseDecisionHistoryUnavailableReason;
    };

export const EVOLUTION_ENTERPRISE_DECISION_DENIALS = [
  "trusted_tenant_required",
  "enterprise_admin_required",
] as const;
export type EvolutionEnterpriseDecisionDenial =
  (typeof EVOLUTION_ENTERPRISE_DECISION_DENIALS)[number];

export type EvolutionEnterpriseDecisionSurfaceView = {
  schemaVersion: 1;
  claimGrade: "code-present";
  runtimeEnabled: typeof EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED;
  productionProven: false;
  e52Open: false;
  phase: "loaded" | "empty" | "load-fail" | "evidence-unavailable" | "denied";
  /** Why this principal cannot use the surface. Present only when `denied`. */
  denial?: EvolutionEnterpriseDecisionDenial;
  /** `asOf` of the current snapshot; `null` when denied or loading failed. */
  asOf: string | null;
  weekOverWeek: EvolutionEnterpriseWeekOverWeekSummary;
  /**
   * Visible decisions only. Hidden ones (other tenants, employee-only or
   * platform-only items, unroutable or duplicate facts) leave no id or count
   * here; server logs read their codes from `projectEvolutionDecisionSnapshot`.
   */
  rows: EvolutionEnterpriseDecisionRow[];
};

export type EvolutionEnterpriseDecisionSubmitResult = {
  judgement: EvolutionDecisionJudgement;
  writes: typeof EVOLUTION_DECISION_SURFACE_WRITES;
  executed: false;
  effectProof: false;
};

const ENTERPRISE_ACTIONS = EVOLUTION_DECISION_ENDPOINT_ACTIONS.enterprise;

const WITHHELD_EVIDENCE: EvolutionEnterpriseEvidenceSummary = Object.freeze({
  availability: "withheld",
  citationCount: 0,
  findingCount: 0,
  hasCase: false,
});

type EnterpriseEntry = EvolutionDecisionSnapshotEntry<EvolutionEnterpriseDecisionFact>;

/** Why the principal cannot use the enterprise surface, or null. */
export function evolutionEnterpriseDecisionDenial(
  principal: EvolutionDecisionPrincipal,
): EvolutionEnterpriseDecisionDenial | null {
  if (!principal.trustedTenantId?.trim()) {
    return "trusted_tenant_required";
  }
  if (principal.enterpriseAdmin !== true) {
    return "enterprise_admin_required";
  }
  return null;
}

export function projectEvolutionEnterpriseDecisionUiStatus(input: {
  status: EvolutionDecisionStatus;
  participation: EvolutionDecisionParticipation;
  authorityFacts: EvolutionDecisionAuthorityFacts;
  /** Enterprise-matrix actions the decision offers to the enterprise. */
  listedActions: readonly EvolutionDecisionAction[];
  /** Listed actions the D1 judge would accept now. */
  executableActions: readonly EvolutionDecisionAction[];
}): EvolutionEnterpriseDecisionUiStatus {
  if (input.status === "resolved") {
    return "completed";
  }
  if (input.status === "expired") {
    return "expired";
  }
  if (input.status === "blocked") {
    return "blocked";
  }
  if (input.participation === "enterprise_canary") {
    if (input.authorityFacts.enterpriseCanaryAcknowledged) {
      return "watching";
    }
    if (input.executableActions.includes("participate_canary")) {
      return "participate-platform-canary";
    }
    return input.listedActions.includes("participate_canary") ? "blocked" : "watching";
  }
  if (
    input.participation === "employee_final_authorization" &&
    !input.authorityFacts.employeeFinalAuthorization
  ) {
    return "waiting-employee-authorization";
  }
  if (input.executableActions.length > 0) {
    return "pending-enterprise-decision";
  }
  return input.listedActions.length > 0 ? "blocked" : "watching";
}

function viewActions(entry: EnterpriseEntry): readonly EvolutionDecisionAction[] {
  return entry.view.kind === "item"
    ? entry.view.item.allowedActions
    : entry.view.view.allowedActions;
}

/**
 * Ask the D1 judge about every enterprise-matrix action the view offers. The
 * judge sees the full server item, but only its verdict reaches the row.
 * Actions the view does not offer are never probed.
 */
function judgeEnterpriseActions(input: {
  entry: EnterpriseEntry;
  principal: EvolutionDecisionPrincipal;
  asOf: string;
}): {
  listed: EvolutionDecisionAction[];
  executable: EvolutionDecisionAction[];
  reasons: Partial<Record<EvolutionDecisionAction, string>>;
} {
  const offered = viewActions(input.entry);
  const { item, grant, authorityFacts, routeInput } = input.entry.fact;
  const listed: EvolutionDecisionAction[] = [];
  const executable: EvolutionDecisionAction[] = [];
  const reasons: Partial<Record<EvolutionDecisionAction, string>> = {};
  for (const action of ENTERPRISE_ACTIONS) {
    if (!offered.includes(action)) {
      reasons[action] = "action_not_on_item";
      continue;
    }
    listed.push(action);
    const verdict = judgeEvolutionDecisionCommand({
      command: {
        commandId: `projection:${item.decisionId}:${action}`,
        decisionId: item.decisionId,
        action,
        expectedVersion: item.decisionVersion,
      },
      item,
      principal: input.principal,
      grant,
      facts: authorityFacts,
      routeInput,
      now: input.asOf,
      prior: [],
    });
    if (verdict.code === "admissible") {
      executable.push(action);
    } else {
      reasons[action] = verdict.code;
    }
  }
  return { listed, executable, reasons };
}

function evidenceOf(entry: EnterpriseEntry): EvolutionEnterpriseEvidenceSummary {
  if (entry.view.kind !== "item") {
    return WITHHELD_EVIDENCE;
  }
  const item = entry.view.item;
  const citationCount = item.sourceEvidenceRefs.length;
  const findingCount = item.sourceFindingIds.length;
  const hasCase = Boolean(item.sourceCaseId);
  if (citationCount === 0 && findingCount === 0 && !hasCase) {
    return { availability: "unavailable", citationCount: 0, findingCount: 0, hasCase: false };
  }
  return { availability: "available", citationCount, findingCount, hasCase };
}

function toEnterpriseRow(input: {
  entry: EnterpriseEntry;
  principal: EvolutionDecisionPrincipal;
  asOf: string;
}): EvolutionEnterpriseDecisionRow | null {
  const { entry } = input;
  if (entry.view.kind === "employee_participation") {
    // Employee views never reach an enterprise principal; fail closed anyway.
    return null;
  }
  const source = entry.view.kind === "item" ? entry.view.item : entry.view.view;
  const participation = entry.route.participation;
  const actions = judgeEnterpriseActions(input);
  const canary =
    entry.view.kind === "enterprise_participation" && participation === "enterprise_canary";
  const correlation: EvolutionEnterpriseDecisionRow["correlation"] = {};
  if (entry.view.kind === "item") {
    const item = entry.view.item;
    if (item.proposalId) {
      correlation.proposalId = item.proposalId;
    }
    if (item.applicationId) {
      correlation.applicationId = item.applicationId;
    }
    if (item.verificationId) {
      correlation.verificationId = item.verificationId;
    }
  }
  return {
    schemaVersion: 1,
    decisionId: source.decisionId,
    decisionVersion: source.decisionVersion,
    decisionType: source.decisionType,
    uiStatus: projectEvolutionEnterpriseDecisionUiStatus({
      status: source.status,
      participation,
      authorityFacts: entry.fact.authorityFacts,
      listedActions: actions.listed,
      executableActions: actions.executable,
    }),
    status: source.status,
    view: entry.view.kind,
    participation,
    impactTarget: {
      domain: source.target.domain,
      surfaceId: source.surfaceId,
      ...(canary ? {} : { key: evolutionTargetKey(source.target) }),
    },
    createdAt: entry.fact.createdAt,
    updatedAt: entry.fact.updatedAt,
    evidence: evidenceOf(entry),
    requiredAuthority: source.requiredAuthority,
    allowedActions: actions.executable,
    actionReasons: actions.reasons,
    ...(source.expiresAt ? { expiresAt: source.expiresAt } : {}),
    correlation,
  };
}

function projectEnterpriseSnapshot(input: {
  snapshot: EvolutionEnterpriseDecisionSnapshot;
  principal: EvolutionDecisionPrincipal;
}): EvolutionEnterpriseDecisionRow[] {
  // Omissions are dropped on purpose: their ids would tell this enterprise
  // which other-tenant, employee-only, or platform-only decisions exist.
  const projected = projectEvolutionDecisionSnapshot({
    facts: input.snapshot.facts,
    principal: input.principal,
  });
  const rows: EvolutionEnterpriseDecisionRow[] = [];
  for (const entry of projected.visible) {
    const row = toEnterpriseRow({ entry, principal: input.principal, asOf: input.snapshot.asOf });
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function emptyCounts(): EvolutionEnterpriseDecisionStatusCounts {
  return {
    total: 0,
    "pending-enterprise-decision": 0,
    "waiting-employee-authorization": 0,
    "participate-platform-canary": 0,
    watching: 0,
    completed: 0,
    blocked: 0,
    expired: 0,
  };
}

function countEnterpriseStatuses(
  rows: readonly EvolutionEnterpriseDecisionRow[],
): EvolutionEnterpriseDecisionStatusCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    counts.total += 1;
    counts[row.uiStatus] += 1;
  }
  return counts;
}

function subtractEnterpriseCounts(
  current: EvolutionEnterpriseDecisionStatusCounts,
  prior: EvolutionEnterpriseDecisionStatusCounts,
): EvolutionEnterpriseDecisionStatusCounts {
  const delta = emptyCounts();
  delta.total = current.total - prior.total;
  for (const status of EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES) {
    delta[status] = current[status] - prior[status];
  }
  return delta;
}

function enterpriseHistoryUnavailable(
  reason: EvolutionEnterpriseDecisionHistoryUnavailableReason,
): EvolutionEnterpriseWeekOverWeekSummary {
  return { schemaVersion: 1, availability: "history-unavailable", reason };
}

/**
 * Week-over-week comparison of two projected enterprise snapshots. Without a
 * usable prior snapshot the result is `history-unavailable`; it never falls
 * back to zero counts.
 */
export function buildEvolutionEnterpriseWeekOverWeekSummary(input: {
  current: { asOf: string; rows: readonly EvolutionEnterpriseDecisionRow[] };
  prior: { asOf: string; rows: readonly EvolutionEnterpriseDecisionRow[] } | null;
}): EvolutionEnterpriseWeekOverWeekSummary {
  const weekly = checkEvolutionDecisionWeeklyWindow({
    currentAsOf: input.current.asOf,
    priorAsOf: input.prior?.asOf ?? null,
  });
  if (!weekly.ok || !input.prior) {
    return enterpriseHistoryUnavailable(weekly.ok ? "prior_snapshot_missing" : weekly.reason);
  }
  const current = countEnterpriseStatuses(input.current.rows);
  const prior = countEnterpriseStatuses(input.prior.rows);
  return {
    schemaVersion: 1,
    availability: "available",
    currentAsOf: input.current.asOf,
    priorAsOf: input.prior.asOf,
    current,
    prior,
    delta: subtractEnterpriseCounts(current, prior),
    transitions: diffEvolutionDecisionStatusTransitions({
      prior: input.prior.rows,
      current: input.current.rows,
    }),
  };
}

function enterpriseSurfacePhase(
  rows: readonly EvolutionEnterpriseDecisionRow[],
): EvolutionEnterpriseDecisionSurfaceView["phase"] {
  if (rows.length === 0) {
    return "empty";
  }
  if (rows.every((row) => row.evidence.availability === "unavailable")) {
    return "evidence-unavailable";
  }
  return "loaded";
}

function enterpriseClosedView(input: {
  phase: "denied" | "load-fail";
  denial?: EvolutionEnterpriseDecisionDenial;
}): EvolutionEnterpriseDecisionSurfaceView {
  return {
    schemaVersion: 1,
    claimGrade: "code-present",
    runtimeEnabled: EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
    productionProven: false,
    e52Open: false,
    phase: input.phase,
    ...(input.denial ? { denial: input.denial } : {}),
    asOf: null,
    weekOverWeek: enterpriseHistoryUnavailable(
      input.phase === "denied" ? "access_denied" : "snapshot_load_failed",
    ),
    rows: [],
  };
}

/**
 * Enterprise Decision Surface list for the enterprise admin of the trusted
 * tenant. Anyone else gets `denied` with no rows and no ids. Both snapshots
 * go through the same D1 router and visibility for the same principal.
 */
export function projectEvolutionEnterpriseDecisionSurface(input: {
  history: EvolutionEnterpriseDecisionHistory;
  principal: EvolutionDecisionPrincipal;
}): EvolutionEnterpriseDecisionSurfaceView {
  const principal: EvolutionDecisionPrincipal = { ...input.principal, audience: "enterprise" };
  const denial = evolutionEnterpriseDecisionDenial(principal);
  if (denial) {
    return enterpriseClosedView({ phase: "denied", denial });
  }
  const current = projectEnterpriseSnapshot({ snapshot: input.history.current, principal });
  const priorSnapshot = input.history.prior;
  const prior = priorSnapshot
    ? projectEnterpriseSnapshot({ snapshot: priorSnapshot, principal })
    : null;
  return {
    schemaVersion: 1,
    claimGrade: "code-present",
    runtimeEnabled: EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
    productionProven: false,
    e52Open: false,
    phase: enterpriseSurfacePhase(current),
    asOf: input.history.current.asOf,
    weekOverWeek: buildEvolutionEnterpriseWeekOverWeekSummary({
      current: { asOf: input.history.current.asOf, rows: current },
      prior: priorSnapshot && prior ? { asOf: priorSnapshot.asOf, rows: prior } : null,
    }),
    rows: current,
  };
}

/** View for a snapshot source that failed to load. Unknown, not healthy. */
export function evolutionEnterpriseDecisionLoadFailView(): EvolutionEnterpriseDecisionSurfaceView {
  return enterpriseClosedView({ phase: "load-fail" });
}

/**
 * Code-present enterprise submit. Resolves through the D1 judge only, with
 * the audience forced to enterprise. `payload` is the raw client body, so
 * client-declared authority fields are refused by the judge.
 * Never writes, never calls the control plane or an Adapter, never opens E5.2.
 */
export function submitEvolutionEnterpriseDecisionCommand(input: {
  command?: EvolutionDecisionCommand;
  payload?: Record<string, unknown>;
  item: EvolutionDecisionItem;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  routeInput: EvolutionDecisionRouteInput;
  now: string;
  prior: readonly EvolutionDecisionCommandRecord[];
}): EvolutionEnterpriseDecisionSubmitResult {
  const judgement = judgeEvolutionDecisionCommand({
    ...(input.command ? { command: input.command } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    item: input.item,
    principal: { ...input.principal, audience: "enterprise" },
    grant: input.grant,
    facts: input.facts,
    routeInput: input.routeInput,
    now: input.now,
    prior: input.prior,
  });
  return {
    judgement,
    writes: EVOLUTION_DECISION_SURFACE_WRITES,
    executed: false,
    effectProof: false,
  };
}
