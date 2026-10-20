/**
 * In-process parent governance snapshot for a spawned child run
 * (plan v1.0 §4.7, PR-1b).
 *
 * Keyed by the child idempotency key, same shape as execution-identity handoff.
 * Absence stays absence: the child records `missing-parent-snapshot` and does
 * not treat that as allow. Enforced does not reject a missing snapshot.
 */

import { modelKey } from "../../agents/model-selection.js";
import type { ExecutionIdentityContext } from "../execution-identity-context.js";
import {
  ACCOUNT_SPAWN_HANDOFF_DEFAULT_TTL_MS,
  AccountSpawnHandoffStore,
  type AccountHandoffRecoverResult,
} from "./account-spawn-handoff.js";
import {
  isGovernanceDecisionId,
  newGovernanceDecisionId,
  resolveGovernanceDecisionIds,
} from "./decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceEffect,
  type GovernanceMode,
  type RunCreditReporting,
  type RunGovernanceSnapshot,
} from "./decision.js";
import { resolveGovernanceModeFromEnv } from "./mode.js";
import { recordShadowEvaluationFailure } from "./shadow-failure.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";

export const SUBAGENT_MODEL_GOVERNANCE_ENV = "OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE";

const stagedByIdempotencyKey = new Map<string, RunGovernanceSnapshot>();
/** Set only when the P2 handoff store is configured. Default stays in memory. */
let accountHandoffStore: AccountSpawnHandoffStore | undefined;

export function configureAccountSpawnHandoffStore(
  store: AccountSpawnHandoffStore | undefined,
): void {
  accountHandoffStore = store;
}

export function recoverAccountSpawnHandoffs(
  nowMs: number = Date.now(),
): AccountHandoffRecoverResult {
  if (!accountHandoffStore) {
    return { resumed: [], failed: [] };
  }
  return accountHandoffStore.recover(nowMs);
}
/** Parent run → model set. Read by spawn, steer, and image tools while the run is alive. */
const runModelSets = new Map<string, RunGovernanceSnapshot>();
/** Child run → the parent model set captured at spawn. Steer and follow-up read this. */
const childModelSets = new Map<string, RunGovernanceSnapshot>();

export function stageSpawnGovernanceSnapshot(
  idempotencyKey: string,
  snapshot: RunGovernanceSnapshot | null | undefined,
): void {
  const key = idempotencyKey.trim();
  if (!key || !snapshot?.runId) {
    return;
  }
  stagedByIdempotencyKey.set(key, snapshot);
  persistStagedAccountHandoff(key, snapshot);
}

export function takeStagedSpawnGovernanceSnapshot(
  idempotencyKey: string | null | undefined,
): RunGovernanceSnapshot | undefined {
  const key = idempotencyKey?.trim();
  if (!key) {
    return undefined;
  }
  const snapshot = stagedByIdempotencyKey.get(key);
  if (snapshot) {
    stagedByIdempotencyKey.delete(key);
    accountHandoffStore?.markRunning(key);
  }
  return snapshot;
}

export function discardStagedSpawnGovernanceSnapshot(
  idempotencyKey: string | null | undefined,
): void {
  const key = idempotencyKey?.trim();
  if (key) {
    stagedByIdempotencyKey.delete(key);
    accountHandoffStore?.cancel(key);
  }
}

export function resetSpawnGovernanceSnapshotHandoffForTest(): void {
  stagedByIdempotencyKey.clear();
  runModelSets.clear();
  childModelSets.clear();
  accountHandoffStore = undefined;
}

function persistStagedAccountHandoff(
  idempotencyKey: string,
  snapshot: RunGovernanceSnapshot,
): void {
  if (!accountHandoffStore || !isGovernanceDecisionId(snapshot.snapshotId)) {
    return;
  }
  const parentExecutionId = snapshot.parentRunId?.trim() || snapshot.runId;
  const expiresAt =
    snapshot.expiresAt && Number.isFinite(Date.parse(snapshot.expiresAt))
      ? snapshot.expiresAt
      : new Date(Date.now() + ACCOUNT_SPAWN_HANDOFF_DEFAULT_TTL_MS).toISOString();
  accountHandoffStore.putPending({
    handoffId: idempotencyKey,
    parentExecutionId,
    childExecutionId: snapshot.runId,
    decisionId: snapshot.snapshotId,
    snapshotVersion: 1,
    expiresAt,
  });
}

/**
 * Saves the parent run's already-resolved model set. Callers pass a snapshot built
 * from the gate result; this does not authorize a model.
 */
export function rememberRunModelSet(runId: string, snapshot: RunGovernanceSnapshot): void {
  const key = runId.trim();
  const allowlist = snapshot.effectiveModelSet?.allowlist;
  if (!key || !snapshot.runId || !Array.isArray(allowlist)) {
    return;
  }
  runModelSets.set(key, {
    ...snapshot,
    effectiveModelSet: {
      allowlist: [...allowlist],
      ...(snapshot.effectiveModelSet?.preferredModelOrder
        ? { preferredModelOrder: [...snapshot.effectiveModelSet.preferredModelOrder] }
        : {}),
    },
  });
}

/** Read-only. Does not remove the entry; the parent run clears it on release. */
export function lookupRunModelSet(
  runId: string | null | undefined,
): RunGovernanceSnapshot | undefined {
  const key = runId?.trim();
  if (!key) {
    return undefined;
  }
  return runModelSets.get(key);
}

/** Copy of the stored allowlist. Missing run or missing set stays undefined. */
export function lookupRunModelAllowlist(runId: string | null | undefined): string[] | undefined {
  const allowlist = lookupRunModelSet(runId)?.effectiveModelSet?.allowlist;
  return Array.isArray(allowlist) ? [...allowlist] : undefined;
}

export function forgetRunModelSet(runId: string | null | undefined): void {
  const key = runId?.trim();
  if (key) {
    runModelSets.delete(key);
  }
}

function copyModelSetSnapshot(snapshot: RunGovernanceSnapshot): RunGovernanceSnapshot | undefined {
  const allowlist = snapshot.effectiveModelSet?.allowlist;
  if (!Array.isArray(allowlist)) {
    return undefined;
  }
  return {
    ...snapshot,
    effectiveModelSet: {
      allowlist: [...allowlist],
      ...(snapshot.effectiveModelSet?.preferredModelOrder
        ? { preferredModelOrder: [...snapshot.effectiveModelSet.preferredModelOrder] }
        : {}),
    },
  };
}

/** Hang the parent snapshot on the child run id after spawn succeeds. */
export function rememberChildModelSet(childRunId: string, snapshot: RunGovernanceSnapshot): void {
  const key = childRunId.trim();
  const copy = copyModelSetSnapshot(snapshot);
  if (!key || !copy) {
    return;
  }
  childModelSets.set(key, copy);
}

export function lookupChildModelSet(
  childRunId: string | null | undefined,
): RunGovernanceSnapshot | undefined {
  const key = childRunId?.trim();
  if (!key) {
    return undefined;
  }
  return childModelSets.get(key);
}

export function forgetChildModelSet(childRunId: string | null | undefined): void {
  const key = childRunId?.trim();
  if (key) {
    childModelSets.delete(key);
  }
}

/** Move a child snapshot when steer replaces the run id. */
export function rebindChildModelSet(previousRunId: string, nextRunId: string): void {
  const previous = previousRunId.trim();
  const next = nextRunId.trim();
  if (!previous || !next || previous === next) {
    return;
  }
  const snapshot = childModelSets.get(previous);
  if (!snapshot) {
    return;
  }
  childModelSets.delete(previous);
  childModelSets.set(next, snapshot);
}

/**
 * Stage the child run's parent snapshot for the next idempotency key.
 * A miss stages nothing — `undefined` is not a snapshot.
 */
export function stageChildRunGovernanceSnapshot(
  idempotencyKey: string,
  childRunId: string | null | undefined,
): RunGovernanceSnapshot | undefined {
  const snapshot = lookupChildModelSet(childRunId);
  if (!snapshot) {
    return undefined;
  }
  stageSpawnGovernanceSnapshot(idempotencyKey, snapshot);
  return snapshot;
}

/**
 * Structural subset of an acquired commercial gate (agent command gate and
 * `tryAcquireEnterpriseAgentRun` share these field names).
 */
export type AcquiredGateBillingFacts = {
  modelGate?: { creditReporting?: { enterpriseId?: string; policyId?: string } };
  subscriptionId?: string;
  subscriptionSnapshotId?: string;
  planId?: string;
  planVersionId?: string;
};

/**
 * Parent billing context for the run snapshot (P4-1). Callers pass only an
 * acquired gate. Without `modelGate.creditReporting` this returns undefined and
 * no billing field is invented. Subscription / plan ids are copied only when the
 * gate carried them. Reads the gate result only, never RPC params.
 */
export function snapshotCreditReportingFromGate(
  gate: AcquiredGateBillingFacts | null | undefined,
): RunCreditReporting | undefined {
  const creditReporting = gate?.modelGate?.creditReporting;
  if (!gate || !creditReporting) {
    return undefined;
  }
  const enterpriseId = creditReporting.enterpriseId?.trim();
  const policyId = creditReporting.policyId?.trim();
  const subscriptionId = gate.subscriptionId?.trim();
  const planId = gate.planId?.trim();
  const planVersionId = gate.planVersionId?.trim();
  const subscriptionSnapshotId = gate.subscriptionSnapshotId?.trim();
  const out: RunCreditReporting = {
    ...(enterpriseId ? { enterpriseId } : {}),
    ...(policyId ? { policyId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(planId ? { planId } : {}),
    ...(planVersionId ? { planVersionId } : {}),
    ...(subscriptionSnapshotId ? { subscriptionSnapshotId } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parent-run snapshot from a gate allowlist that was already computed.
 * No allowlist (including "no enterprise scope") returns undefined — nothing is stored.
 * Paths that do not pass `governanceMode` record `shadow` when an allowlist exists.
 * `creditReporting` is set only by callers whose gate was acquired (P4-1).
 */
export function buildRunModelSetSnapshot(params: {
  runId: string;
  allowlist?: readonly string[];
  governanceMode?: GovernanceMode;
  commercialAuthorizationId?: string;
  tenantId?: string;
  actorId?: string;
  preferredModelOrder?: readonly string[];
  creditReporting?: RunCreditReporting;
  now?: string;
}): RunGovernanceSnapshot | undefined {
  const runId = params.runId.trim();
  if (!runId || !Array.isArray(params.allowlist)) {
    return undefined;
  }
  const tenantId = params.tenantId?.trim();
  const actorId = params.actorId?.trim();
  const commercialAuthorizationId = params.commercialAuthorizationId?.trim();
  return {
    snapshotId: newGovernanceDecisionId(),
    runId,
    governanceMode: params.governanceMode ?? "shadow",
    decisions: [],
    effectiveModelSet: {
      allowlist: [...params.allowlist],
      ...(params.preferredModelOrder
        ? { preferredModelOrder: [...params.preferredModelOrder] }
        : {}),
    },
    ...(commercialAuthorizationId ? { commercialAuthorizationId } : {}),
    ...(params.creditReporting ? { creditReporting: { ...params.creditReporting } } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    createdAt: params.now ?? new Date().toISOString(),
  };
}

/**
 * Child handoff of a looked-up parent set. Keeps the parent allowlist and points
 * `parentRunId` at the parent run. Returns undefined when the parent has no set,
 * so callers do not stage an empty snapshot.
 */
export function snapshotForChildModelHandoff(
  parent: RunGovernanceSnapshot | null | undefined,
): RunGovernanceSnapshot | undefined {
  const allowlist = parent?.effectiveModelSet?.allowlist;
  const parentRunId = parent?.runId?.trim();
  if (!parent || !parentRunId || !Array.isArray(allowlist)) {
    return undefined;
  }
  return {
    snapshotId: parent.snapshotId,
    runId: parentRunId,
    parentRunId,
    ...(parent.tenantId ? { tenantId: parent.tenantId } : {}),
    ...(parent.actorId ? { actorId: parent.actorId } : {}),
    governanceMode: parent.governanceMode,
    decisions: [],
    effectiveModelSet: {
      allowlist: [...allowlist],
      ...(parent.effectiveModelSet?.preferredModelOrder
        ? { preferredModelOrder: [...parent.effectiveModelSet.preferredModelOrder] }
        : {}),
    },
    ...(parent.commercialAuthorizationId
      ? { commercialAuthorizationId: parent.commercialAuthorizationId }
      : {}),
    ...(parent.creditReporting ? { creditReporting: { ...parent.creditReporting } } : {}),
    createdAt: parent.createdAt,
  };
}

/**
 * Canonical governance actor id: opaque ids only, in precedence order, and never
 * derived from an email. Exported so other governance writers (e.g. the E10
 * image/pdf fallback) stamp the same `actorId` shape as the agent-command path.
 */
export function actorIdFromIdentity(
  identity: ExecutionIdentityContext | undefined,
): string | undefined {
  const platformUserId = identity?.platformUserId?.trim();
  if (platformUserId) {
    return `platform-user:${platformUserId}`;
  }
  const membershipId = identity?.membershipId?.trim();
  if (membershipId) {
    return `membership:${membershipId}`;
  }
  const seatId = identity?.seatId?.trim();
  if (seatId) {
    return `seat:${seatId}`;
  }
  return undefined;
}

/** Builds a parent snapshot only when the tool context has a parent run id. */
export function buildSpawnGovernanceSnapshot(params: {
  parentRunId?: string;
  tenantId?: string;
  executionIdentity?: ExecutionIdentityContext;
  effectiveModelSet?: RunGovernanceSnapshot["effectiveModelSet"];
  now?: string;
  env?: NodeJS.ProcessEnv;
}): RunGovernanceSnapshot | undefined {
  const parentRunId = params.parentRunId?.trim();
  if (!parentRunId) {
    return undefined;
  }
  const actorId = actorIdFromIdentity(params.executionIdentity);
  const tenantId = params.tenantId?.trim();
  return {
    snapshotId: newGovernanceDecisionId(),
    runId: parentRunId,
    parentRunId,
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    governanceMode: resolveGovernanceModeFromEnv({
      envName: SUBAGENT_MODEL_GOVERNANCE_ENV,
      defaultMode: "shadow",
      env: params.env,
    }),
    decisions: [],
    ...(params.effectiveModelSet ? { effectiveModelSet: params.effectiveModelSet } : {}),
    createdAt: params.now ?? new Date().toISOString(),
  };
}

export class SubagentModelOutsideParentSetError extends Error {
  constructor(message = "Subagent model is outside the parent effective model set.") {
    super(message);
    this.name = "SubagentModelOutsideParentSetError";
  }
}

function writeSnapshotDecision(decision: GovernanceDecision, env?: NodeJS.ProcessEnv): void {
  void appendGovernanceShadowDecision(decision, { env }).catch(() => {});
}

/** Same trim rule as `applyEntitlementHardDeny`: exact `modelKey`, no case folding. */
function modelIsInsideAllowlist(
  allowlist: readonly string[],
  provider: string,
  model: string,
): boolean {
  const key = modelKey(provider, model);
  return allowlist.some((entry) => {
    const trimmed = entry.trim();
    return trimmed.length > 0 && trimmed === key;
  });
}

/**
 * Subagent lane only. A missing snapshot or a missing allowlist is `skipped`,
 * never `allow`, and never a reject — including when the configured mode is
 * `enforced`. An array allowlist that does not contain the child model (or an
 * empty array) is would-deny in shadow and a throw only in `enforced`.
 * `legacy` stays `skipped` because that mode cannot carry deny.
 * If building the envelope itself throws, a D6 envelope is recorded instead and
 * nothing is rejected, in any mode.
 */
export function recordSubagentModelShadow(
  params: SubagentModelShadowParams,
): GovernanceDecision | undefined {
  if (!params.isSubagentLane) {
    return undefined;
  }
  const mode = resolveGovernanceModeFromEnv({
    envName: SUBAGENT_MODEL_GOVERNANCE_ENV,
    defaultMode: "shadow",
    env: params.env,
  });
  let decision: GovernanceDecision;
  try {
    decision = buildSubagentModelDecision(params, mode);
  } catch (error) {
    console.warn(`[governance] subagent model shadow failed (D6): ${String(error)}`);
    // D6: the evaluation threw. Record it and let the child run continue, including
    // under `enforced`: an unevaluated model is never a reject (same as a missing snapshot).
    recordShadowEvaluationFailure({
      env: params.env,
      fields: () => ({
        source: "model-entitlement",
        // E6a / E6b / E6c share this writer and cannot be told apart here.
        entry: "E6",
        mode,
        existing: { effect: "allow", source: "model-entitlement", reason: "not-enforced" },
        runId: params.runId,
        parentRunId: params.snapshot?.parentRunId ?? params.snapshot?.runId,
        parentDecisionId: params.snapshot?.snapshotId,
        tenantId: params.snapshot?.tenantId,
        actorId: params.snapshot?.actorId,
      }),
    });
    return undefined;
  }
  writeSnapshotDecision(decision, params.env);
  if (decision.effect === "deny" && mode === "enforced") {
    throw new SubagentModelOutsideParentSetError();
  }
  return decision;
}

type SubagentModelShadowParams = {
  isSubagentLane: boolean;
  snapshot?: RunGovernanceSnapshot;
  provider: string;
  model: string;
  runId?: string;
  env?: NodeJS.ProcessEnv;
};

/** The subagent model envelope. Throws only on malformed input; the caller records D6. */
function buildSubagentModelDecision(
  params: SubagentModelShadowParams,
  mode: GovernanceMode,
): GovernanceDecision {
  const ids = resolveGovernanceDecisionIds({ source: "model-entitlement" });
  const parentRunId = params.snapshot?.parentRunId ?? params.snapshot?.runId;
  const base = {
    decisionId: ids.decisionId,
    source: "model-entitlement" as const,
    // E6a / E6b / E6c share this writer and cannot be told apart here.
    entry: "E6",
    runId: params.runId,
    ...(parentRunId ? { parentRunId } : {}),
    ...(params.snapshot?.snapshotId ? { parentDecisionId: params.snapshot.snapshotId } : {}),
    ...(params.snapshot?.tenantId ? { tenantId: params.snapshot.tenantId } : {}),
    ...(params.snapshot?.actorId ? { actorId: params.snapshot.actorId } : {}),
    subject: { kind: "model" as const, id: modelKey(params.provider, params.model) },
    ts: new Date().toISOString(),
  };

  const allowlist = params.snapshot?.effectiveModelSet?.allowlist;
  let effect: GovernanceEffect;
  let reason: string | undefined;
  if (!params.snapshot) {
    effect = "skipped";
    reason = "missing-parent-snapshot";
  } else if (!Array.isArray(allowlist)) {
    effect = "skipped";
    reason = "parent-model-set-absent";
  } else if (mode === "legacy") {
    effect = "skipped";
    reason = "legacy";
  } else if (!modelIsInsideAllowlist(allowlist, params.provider, params.model)) {
    effect = "deny";
    reason = "outside-parent-model-set";
  } else {
    effect = "allow";
  }

  const skipped = effect === "skipped";
  return createGovernanceDecision({
    ...base,
    effect,
    mode,
    ...(reason ? { reason } : {}),
    ...(mode === "shadow"
      ? {
          shadow: skipped
            ? {
                existing: {
                  effect: "skipped" as const,
                  source: "other" as const,
                  reason: "subagent-lane",
                },
                divergence: classifyDivergence({ existing: "skipped", shadow: "skipped" }),
              }
            : {
                existing: {
                  effect: "allow" as const,
                  source: "model-entitlement" as const,
                  reason: "not-enforced",
                },
                divergence: classifyDivergence({
                  existing: "allow",
                  shadow: effect,
                  stricterCause: "known-bypass",
                }),
              },
        }
      : {}),
  });
}
