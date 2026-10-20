/**
 * Phase D2 employee Decision Surface projection.
 *
 * Wraps the D1 router, visibility, command map, and judge. It does not call
 * Gateway, an Adapter, or Perception, and it stores nothing: the weekly
 * comparison reads two read-only snapshots handed in by the caller.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 * Not E5.2.
 */
import type { AuthorityGrantView } from "../contracts.js";
import { evolutionTargetKey, type EvolutionTarget } from "../types.js";
import {
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  evolutionDecisionEndpointAllows,
} from "./command-map.js";
import {
  EVOLUTION_DECISION_SURFACE_WRITES,
  type EvolutionDecisionAction,
  type EvolutionDecisionAuthorityFacts,
  type EvolutionDecisionCommand,
  type EvolutionDecisionItem,
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
  EVOLUTION_DECISION_WEEK_MS,
  EVOLUTION_DECISION_WEEK_TOLERANCE_MS,
  projectEvolutionDecisionSnapshot,
  type EvolutionDecisionStatusTransition,
} from "./snapshot.js";
import type { EvolutionDecisionAudienceView } from "./visibility.js";

/**
 * Runtime gate for the employee Decision Surface.
 *
 * D2 is code-present only, so the gate stays closed. It is a reviewed
 * constant in this contract package, not a setting: no URL, query string,
 * browser storage, form field, or client claim can open it. Opening it needs
 * a reviewed code change plus server-resolved principals and read-only
 * Timeline/Ledger snapshots.
 */
export const EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED = false as const;

/** Employee-facing participation statuses (not a second control-plane state). */
export const EVOLUTION_EMPLOYEE_DECISION_UI_STATUSES = [
  "system-done",
  "watching",
  "pending-my-confirm",
  "needs-admin",
] as const;
export type EvolutionEmployeeDecisionUiStatus =
  (typeof EVOLUTION_EMPLOYEE_DECISION_UI_STATUSES)[number];

export type EvolutionEmployeeDecisionFact = {
  item: EvolutionDecisionItem;
  routeInput: EvolutionDecisionRouteInput;
  /**
   * Participation state as the server recorded it. Once the owner's final
   * authorization is recorded the row stops offering it, like the D1 judge.
   */
  authorityFacts: EvolutionDecisionAuthorityFacts;
  createdAt: string;
  updatedAt: string;
};

/**
 * One read-only, point-in-time projection of decision facts. The runtime
 * source must be the existing Timeline/Ledger read projection; D2 does not
 * keep a history store of its own.
 */
export type EvolutionEmployeeDecisionSnapshot = {
  asOf: string;
  facts: readonly EvolutionEmployeeDecisionFact[];
};

/**
 * Current snapshot plus the snapshot one week earlier. `prior: null` means
 * the history projection has nothing for that point in time, which fails
 * closed to `history-unavailable` instead of reading as "no change".
 */
export type EvolutionEmployeeDecisionHistory = {
  current: EvolutionEmployeeDecisionSnapshot;
  prior: EvolutionEmployeeDecisionSnapshot | null;
};

export const EVOLUTION_EMPLOYEE_EVIDENCE_AVAILABILITY = [
  "available",
  "unavailable",
  "withheld",
] as const;
export type EvolutionEmployeeEvidenceAvailability =
  (typeof EVOLUTION_EMPLOYEE_EVIDENCE_AVAILABILITY)[number];

/**
 * Evidence counts only. Never carries Evidence refs or payloads. `withheld`
 * is the employee participation view: the enterprise item keeps its
 * evidence, and the employee row does not derive counts from it.
 */
export type EvolutionEmployeeEvidenceSummary = {
  availability: EvolutionEmployeeEvidenceAvailability;
  citationCount: number;
  findingCount: number;
  hasCase: boolean;
};

/** Why an employee-matrix action cannot be submitted on a row. */
export const EVOLUTION_EMPLOYEE_ACTION_UNAVAILABLE_CODES = [
  "handled",
  "expired",
  "blocked",
  "action_not_on_item",
  "wrong_endpoint",
  "participation_required",
  "participation_already_satisfied",
] as const;

/** The D1 views an employee row can come from. */
export type EvolutionEmployeeDecisionRowView = Exclude<
  EvolutionDecisionAudienceView["kind"],
  "enterprise_participation"
>;
export type EvolutionEmployeeActionUnavailableCode =
  (typeof EVOLUTION_EMPLOYEE_ACTION_UNAVAILABLE_CODES)[number];

export type EvolutionEmployeeDecisionRow = {
  schemaVersion: 1;
  decisionId: string;
  decisionVersion: string;
  decisionType: EvolutionDecisionType;
  uiStatus: EvolutionEmployeeDecisionUiStatus;
  status: EvolutionDecisionStatus;
  /**
   * `employee_participation`: the enterprise decides and this employee only
   * gives final authorization on a personal asset.
   */
  view: EvolutionEmployeeDecisionRowView;
  impactTarget: {
    key: string;
    domain: EvolutionTarget["domain"];
    surfaceId: string;
  };
  createdAt: string;
  updatedAt: string;
  evidence: EvolutionEmployeeEvidenceSummary;
  /** Who has to decide. An authority, never a list of actions. */
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  /** Actions this employee can submit now. Actions, never permissions. */
  allowedActions: readonly EvolutionDecisionAction[];
  /** Employee-matrix actions that cannot be submitted, with the reason code. */
  actionReasons: Readonly<
    Partial<Record<EvolutionDecisionAction, EvolutionEmployeeActionUnavailableCode>>
  >;
  expiresAt?: string;
  /** Control-plane id correlation only. Not a copy of Perception facts. */
  correlation: {
    proposalId?: string;
    applicationId?: string;
    verificationId?: string;
    perceptionFactIds: readonly string[];
  };
};

export type EvolutionEmployeeDecisionStatusCounts = {
  total: number;
  pendingMyConfirm: number;
  watching: number;
  systemDone: number;
  needsAdmin: number;
};

/** Status of one decision in the prior and current snapshots. */
export type EvolutionEmployeeDecisionTransition =
  EvolutionDecisionStatusTransition<EvolutionEmployeeDecisionUiStatus>;

export const EVOLUTION_EMPLOYEE_DECISION_HISTORY_UNAVAILABLE_REASONS = [
  "prior_snapshot_missing",
  "snapshot_as_of_invalid",
  "prior_not_before_current",
  "prior_snapshot_not_weekly",
  "snapshot_load_failed",
] as const;
export type EvolutionEmployeeDecisionHistoryUnavailableReason =
  (typeof EVOLUTION_EMPLOYEE_DECISION_HISTORY_UNAVAILABLE_REASONS)[number];

export type EvolutionEmployeeWeekOverWeekSummary =
  | {
      schemaVersion: 1;
      availability: "available";
      currentAsOf: string;
      priorAsOf: string;
      current: EvolutionEmployeeDecisionStatusCounts;
      prior: EvolutionEmployeeDecisionStatusCounts;
      /** `current - prior`, per status. */
      delta: EvolutionEmployeeDecisionStatusCounts;
      /** Decisions whose status differs between the two snapshots. */
      transitions: readonly EvolutionEmployeeDecisionTransition[];
    }
  | {
      schemaVersion: 1;
      availability: "history-unavailable";
      reason: EvolutionEmployeeDecisionHistoryUnavailableReason;
    };

/** The prior snapshot is taken one week before the current one. */
export const EVOLUTION_EMPLOYEE_DECISION_WEEK_MS = EVOLUTION_DECISION_WEEK_MS;
/** Scheduling slack accepted around the one-week gap. */
export const EVOLUTION_EMPLOYEE_DECISION_WEEK_TOLERANCE_MS = EVOLUTION_DECISION_WEEK_TOLERANCE_MS;

export type EvolutionEmployeeDecisionSurfaceView = {
  schemaVersion: 1;
  claimGrade: "code-present";
  runtimeEnabled: typeof EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED;
  productionProven: false;
  e52Open: false;
  phase: "loaded" | "empty" | "load-fail" | "evidence-unavailable";
  /** `asOf` of the current snapshot; `null` when loading failed. */
  asOf: string | null;
  weekOverWeek: EvolutionEmployeeWeekOverWeekSummary;
  rows: EvolutionEmployeeDecisionRow[];
  /** Current-snapshot omissions: ids and codes only, never Evidence. */
  omitted: { decisionId: string; code: string }[];
};

export type EvolutionEmployeeDecisionSubmitResult = {
  judgement: EvolutionDecisionJudgement;
  writes: typeof EVOLUTION_DECISION_SURFACE_WRITES;
  executed: false;
  effectProof: false;
};

const EMPLOYEE_ACTIONS = EVOLUTION_DECISION_ENDPOINT_ACTIONS.employee;

const NO_PERCEPTION_CORRELATION: ReadonlyMap<string, readonly string[]> = new Map();

const WITHHELD_EVIDENCE: EvolutionEmployeeEvidenceSummary = Object.freeze({
  availability: "withheld",
  citationCount: 0,
  findingCount: 0,
  hasCase: false,
});

type EvolutionDecisionControlPlaneRefs = Pick<
  EvolutionDecisionItem,
  "decisionId" | "proposalId" | "applicationId" | "verificationId"
>;

/** What a row may be built from, after D1 visibility. */
type EmployeeRowSource = {
  view: EvolutionEmployeeDecisionRowView;
  decisionId: string;
  decisionVersion: string;
  decisionType: EvolutionDecisionType;
  status: EvolutionDecisionStatus;
  target: EvolutionTarget;
  surfaceId: string;
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  allowedActions: readonly EvolutionDecisionAction[];
  expiresAt?: string;
  evidence: EvolutionEmployeeEvidenceSummary;
  refs: EvolutionDecisionControlPlaneRefs;
};

export function projectEvolutionEmployeeDecisionUiStatus(input: {
  status: EvolutionDecisionStatus;
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  /** Actions this employee can submit now (see the row `allowedActions`). */
  executableActions: readonly EvolutionDecisionAction[];
}): EvolutionEmployeeDecisionUiStatus {
  if (input.status === "resolved") {
    return "system-done";
  }
  if (input.status === "blocked" || input.status === "expired") {
    return "needs-admin";
  }
  if (
    input.requiredAuthority === "enterprise" ||
    input.requiredAuthority === "platform" ||
    input.requiredAuthority === "platform_and_enterprise"
  ) {
    return "needs-admin";
  }
  return input.executableActions.length > 0 ? "pending-my-confirm" : "watching";
}

export function summarizeEvolutionEmployeeEvidence(
  item: Pick<EvolutionDecisionItem, "sourceEvidenceRefs" | "sourceFindingIds" | "sourceCaseId">,
): EvolutionEmployeeEvidenceSummary {
  const citationCount = item.sourceEvidenceRefs.length;
  const findingCount = item.sourceFindingIds.length;
  const hasCase = Boolean(item.sourceCaseId);
  if (citationCount === 0 && findingCount === 0 && !hasCase) {
    return { availability: "unavailable", citationCount: 0, findingCount: 0, hasCase: false };
  }
  return { availability: "available", citationCount, findingCount, hasCase };
}

/**
 * Correlate Decision rows to Perception timeline fact ids by shared
 * control-plane refs only. Never copies Perception fact payloads.
 */
export function correlateEvolutionPerceptionDecision(input: {
  item: EvolutionDecisionControlPlaneRefs;
  perceptionFactIdsByControlPlaneRef: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const keys = [
    input.item.proposalId,
    input.item.applicationId,
    input.item.verificationId,
    input.item.decisionId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const out = new Set<string>();
  for (const key of keys) {
    for (const factId of input.perceptionFactIdsByControlPlaneRef.get(key) ?? []) {
      out.add(factId);
    }
  }
  return [...out];
}

function rowSourceOf(view: EvolutionDecisionAudienceView): EmployeeRowSource | null {
  if (view.kind === "enterprise_participation") {
    // Enterprise views never reach an employee principal; fail closed anyway.
    return null;
  }
  if (view.kind === "item") {
    const item = view.item;
    return {
      view: "item",
      decisionId: item.decisionId,
      decisionVersion: item.decisionVersion,
      decisionType: item.decisionType,
      status: item.status,
      target: item.target,
      surfaceId: item.surfaceId,
      requiredAuthority: item.requiredAuthority,
      allowedActions: item.allowedActions,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      evidence: summarizeEvolutionEmployeeEvidence(item),
      refs: {
        decisionId: item.decisionId,
        proposalId: item.proposalId,
        applicationId: item.applicationId,
        verificationId: item.verificationId,
      },
    };
  }
  // The D1 participation view has no evidence refs, case, or control-plane
  // ids. Nothing is read back from the enterprise item.
  const participation = view.view;
  return {
    view: "employee_participation",
    decisionId: participation.decisionId,
    decisionVersion: participation.decisionVersion,
    decisionType: participation.decisionType,
    status: participation.status,
    target: participation.target,
    surfaceId: participation.surfaceId,
    requiredAuthority: participation.requiredAuthority,
    allowedActions: participation.allowedActions,
    ...(participation.expiresAt ? { expiresAt: participation.expiresAt } : {}),
    evidence: WITHHELD_EVIDENCE,
    refs: { decisionId: participation.decisionId },
  };
}

/**
 * Actions the employee can submit now, mirroring the D1 judge: fresh commands
 * need a pending decision; on a participation view the enterprise stays the
 * decision endpoint, so only `employee_final_authorization` is open, and only
 * until it is recorded; and that confirmation only exists on its
 * participation route.
 */
function employeeExecutableActions(
  source: EmployeeRowSource,
  facts: EvolutionDecisionAuthorityFacts,
): EvolutionDecisionAction[] {
  if (source.status !== "pending") {
    return [];
  }
  return source.allowedActions.filter((action) => {
    if (!evolutionDecisionEndpointAllows("employee", action)) {
      return false;
    }
    return source.view === "employee_participation"
      ? action === "employee_final_authorization" && !facts.employeeFinalAuthorization
      : action !== "employee_final_authorization";
  });
}

function unavailableActionReasons(
  source: EmployeeRowSource,
  executable: readonly EvolutionDecisionAction[],
  facts: EvolutionDecisionAuthorityFacts,
): Partial<Record<EvolutionDecisionAction, EvolutionEmployeeActionUnavailableCode>> {
  const reasons: Partial<Record<EvolutionDecisionAction, EvolutionEmployeeActionUnavailableCode>> =
    {};
  for (const action of EMPLOYEE_ACTIONS) {
    if (executable.includes(action)) {
      continue;
    }
    if (source.status === "resolved") {
      reasons[action] = "handled";
    } else if (source.status === "expired") {
      reasons[action] = "expired";
    } else if (source.status === "blocked") {
      reasons[action] = "blocked";
    } else if (!source.allowedActions.includes(action)) {
      reasons[action] = "action_not_on_item";
    } else if (source.view === "item" && action === "employee_final_authorization") {
      reasons[action] = "participation_required";
    } else if (action === "employee_final_authorization" && facts.employeeFinalAuthorization) {
      reasons[action] = "participation_already_satisfied";
    } else {
      reasons[action] = "wrong_endpoint";
    }
  }
  return reasons;
}

function toRow(input: {
  source: EmployeeRowSource;
  fact: EvolutionEmployeeDecisionFact;
  perceptionFactIdsByControlPlaneRef: ReadonlyMap<string, readonly string[]>;
}): EvolutionEmployeeDecisionRow {
  const { source } = input;
  const allowedActions = employeeExecutableActions(source, input.fact.authorityFacts);
  return {
    schemaVersion: 1,
    decisionId: source.decisionId,
    decisionVersion: source.decisionVersion,
    decisionType: source.decisionType,
    uiStatus: projectEvolutionEmployeeDecisionUiStatus({
      status: source.status,
      requiredAuthority: source.requiredAuthority,
      executableActions: allowedActions,
    }),
    status: source.status,
    view: source.view,
    impactTarget: {
      key: evolutionTargetKey(source.target),
      domain: source.target.domain,
      surfaceId: source.surfaceId,
    },
    createdAt: input.fact.createdAt,
    updatedAt: input.fact.updatedAt,
    evidence: source.evidence,
    requiredAuthority: source.requiredAuthority,
    allowedActions,
    actionReasons: unavailableActionReasons(source, allowedActions, input.fact.authorityFacts),
    ...(source.expiresAt ? { expiresAt: source.expiresAt } : {}),
    correlation: {
      ...(source.refs.proposalId ? { proposalId: source.refs.proposalId } : {}),
      ...(source.refs.applicationId ? { applicationId: source.refs.applicationId } : {}),
      ...(source.refs.verificationId ? { verificationId: source.refs.verificationId } : {}),
      perceptionFactIds: correlateEvolutionPerceptionDecision({
        item: source.refs,
        perceptionFactIdsByControlPlaneRef: input.perceptionFactIdsByControlPlaneRef,
      }),
    },
  };
}

/**
 * One snapshot through the shared D1 router and visibility path. Current and
 * prior snapshots both come through here, so tenant, ownership, and
 * confidentiality are re-checked for each, and duplicate decision ids are
 * omitted.
 */
function projectEmployeeSnapshot(input: {
  snapshot: EvolutionEmployeeDecisionSnapshot;
  principal: EvolutionDecisionPrincipal;
  perceptionFactIdsByControlPlaneRef: ReadonlyMap<string, readonly string[]>;
}): {
  rows: EvolutionEmployeeDecisionRow[];
  omitted: { decisionId: string; code: string }[];
} {
  const projected = projectEvolutionDecisionSnapshot({
    facts: input.snapshot.facts,
    principal: input.principal,
  });
  const rows: EvolutionEmployeeDecisionRow[] = [];
  for (const entry of projected.visible) {
    const source = rowSourceOf(entry.view);
    if (!source) {
      continue;
    }
    rows.push(
      toRow({
        source,
        fact: entry.fact,
        perceptionFactIdsByControlPlaneRef: input.perceptionFactIdsByControlPlaneRef,
      }),
    );
  }
  return { rows, omitted: projected.omitted };
}

function countByStatus(
  rows: readonly EvolutionEmployeeDecisionRow[],
): EvolutionEmployeeDecisionStatusCounts {
  const counts: EvolutionEmployeeDecisionStatusCounts = {
    total: 0,
    pendingMyConfirm: 0,
    watching: 0,
    systemDone: 0,
    needsAdmin: 0,
  };
  for (const row of rows) {
    counts.total += 1;
    if (row.uiStatus === "pending-my-confirm") {
      counts.pendingMyConfirm += 1;
    } else if (row.uiStatus === "watching") {
      counts.watching += 1;
    } else if (row.uiStatus === "system-done") {
      counts.systemDone += 1;
    } else {
      counts.needsAdmin += 1;
    }
  }
  return counts;
}

function subtractCounts(
  current: EvolutionEmployeeDecisionStatusCounts,
  prior: EvolutionEmployeeDecisionStatusCounts,
): EvolutionEmployeeDecisionStatusCounts {
  return {
    total: current.total - prior.total,
    pendingMyConfirm: current.pendingMyConfirm - prior.pendingMyConfirm,
    watching: current.watching - prior.watching,
    systemDone: current.systemDone - prior.systemDone,
    needsAdmin: current.needsAdmin - prior.needsAdmin,
  };
}

function historyUnavailable(
  reason: EvolutionEmployeeDecisionHistoryUnavailableReason,
): EvolutionEmployeeWeekOverWeekSummary {
  return { schemaVersion: 1, availability: "history-unavailable", reason };
}

/**
 * Week-over-week comparison of two projected snapshots. Counts come from the
 * status of each decision in each snapshot, so one decision that moved from
 * pending to done lowers the pending count, raises the done count, and leaves
 * the total unchanged. Without a usable prior snapshot the result is
 * `history-unavailable`; it never falls back to zero counts.
 */
export function buildEvolutionEmployeeWeekOverWeekSummary(input: {
  current: { asOf: string; rows: readonly EvolutionEmployeeDecisionRow[] };
  prior: { asOf: string; rows: readonly EvolutionEmployeeDecisionRow[] } | null;
}): EvolutionEmployeeWeekOverWeekSummary {
  const weekly = checkEvolutionDecisionWeeklyWindow({
    currentAsOf: input.current.asOf,
    priorAsOf: input.prior?.asOf ?? null,
  });
  if (!weekly.ok || !input.prior) {
    return historyUnavailable(weekly.ok ? "prior_snapshot_missing" : weekly.reason);
  }
  const current = countByStatus(input.current.rows);
  const prior = countByStatus(input.prior.rows);
  return {
    schemaVersion: 1,
    availability: "available",
    currentAsOf: input.current.asOf,
    priorAsOf: input.prior.asOf,
    current,
    prior,
    delta: subtractCounts(current, prior),
    transitions: diffEvolutionDecisionStatusTransitions({
      prior: input.prior.rows,
      current: input.current.rows,
    }),
  };
}

function surfacePhase(
  rows: readonly EvolutionEmployeeDecisionRow[],
): EvolutionEmployeeDecisionSurfaceView["phase"] {
  if (rows.length === 0) {
    return "empty";
  }
  if (rows.every((row) => row.evidence.availability === "unavailable")) {
    return "evidence-unavailable";
  }
  return "loaded";
}

/**
 * Employee Decision Surface list. Own items only (tenant + owner via D1
 * visibility). Omitted rows expose id + code only — never Evidence. The
 * weekly summary compares the current and prior snapshots, each projected
 * the same way for the same principal.
 */
export function projectEvolutionEmployeeDecisionSurface(input: {
  history: EvolutionEmployeeDecisionHistory;
  principal: EvolutionDecisionPrincipal;
  perceptionFactIdsByControlPlaneRef?: ReadonlyMap<string, readonly string[]>;
}): EvolutionEmployeeDecisionSurfaceView {
  const principal: EvolutionDecisionPrincipal = { ...input.principal, audience: "employee" };
  const current = projectEmployeeSnapshot({
    snapshot: input.history.current,
    principal,
    perceptionFactIdsByControlPlaneRef:
      input.perceptionFactIdsByControlPlaneRef ?? NO_PERCEPTION_CORRELATION,
  });
  const priorSnapshot = input.history.prior;
  const prior = priorSnapshot
    ? projectEmployeeSnapshot({
        snapshot: priorSnapshot,
        principal,
        perceptionFactIdsByControlPlaneRef: NO_PERCEPTION_CORRELATION,
      })
    : null;
  return {
    schemaVersion: 1,
    claimGrade: "code-present",
    runtimeEnabled: EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED,
    productionProven: false,
    e52Open: false,
    phase: surfacePhase(current.rows),
    asOf: input.history.current.asOf,
    weekOverWeek: buildEvolutionEmployeeWeekOverWeekSummary({
      current: { asOf: input.history.current.asOf, rows: current.rows },
      prior: priorSnapshot && prior ? { asOf: priorSnapshot.asOf, rows: prior.rows } : null,
    }),
    rows: current.rows,
    omitted: current.omitted,
  };
}

/** View for a snapshot source that failed to load. Unknown, not healthy. */
export function evolutionEmployeeDecisionLoadFailView(): EvolutionEmployeeDecisionSurfaceView {
  return {
    schemaVersion: 1,
    claimGrade: "code-present",
    runtimeEnabled: EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED,
    productionProven: false,
    e52Open: false,
    phase: "load-fail",
    asOf: null,
    weekOverWeek: historyUnavailable("snapshot_load_failed"),
    rows: [],
    omitted: [],
  };
}

/**
 * Code-present employee submit. Resolves through D1 judge only.
 * Never writes, never calls Adapter, never opens E5.2.
 */
export function submitEvolutionEmployeeDecisionCommand(input: {
  command: EvolutionDecisionCommand;
  item: EvolutionDecisionItem;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  routeInput: EvolutionDecisionRouteInput;
  now: string;
  prior: readonly EvolutionDecisionCommandRecord[];
}): EvolutionEmployeeDecisionSubmitResult {
  const judgement = judgeEvolutionDecisionCommand({
    command: input.command,
    item: input.item,
    principal: { ...input.principal, audience: "employee" },
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
