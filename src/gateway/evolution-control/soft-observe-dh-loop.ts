/**
 * Soft/observe self-running closed loop for digital-employee surfaces.
 *
 * Advances eligible proposals past Experiment:
 *   soft canary Apply → Evaluate → Rollback drill → Re-apply → Verify → Promote
 *
 * Soft means:
 * - Scope is always canary (never active production cutover)
 * - Does not enable LIVE_INVOKE, Fabric default-on, or Phase-D-enforce gates
 * - System / platform domain proposals are never processed
 * - `learned` / 「学会了」 still requires verified_effective via perception contract
 *
 * Env: OPENBOT_EVOLUTION_SOFT_OBSERVE_DH=on|off (default: on)
 * Kill switch and missing plane fail closed / no-op.
 */
import type {
  EvolutionApplication,
  EvolutionProposal,
  EvolutionProposalStatus,
} from "@openbot/evolution-core";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { isDiagnosisSourced } from "./diagnosis-apply-gate.js";
import { logEvolutionLoop } from "./evolution-loop-log.js";
import {
  diagnosisOriginEvaluationApplies,
  skillInstallationEvaluationApplies,
  workingDnaEvaluationApplies,
} from "./working-dna-evaluation.js";

/** Phase-1 digital-employee surfaces that own Apply adapters in this loop. */
export const SOFT_OBSERVE_DH_SURFACES = new Set([
  "agent.working-dna",
  "capability.skill-installation",
]);

const TERMINAL_STATUSES = new Set<EvolutionProposalStatus>([
  "PROMOTED",
  "REJECTED",
  "EXPIRED",
  "ROLLED_BACK",
]);

export const SOFT_OBSERVE_DH_PRINCIPAL = "soft-observe-dh-loop";

export type SoftObserveDhStep =
  | "skip"
  | "apply_canary"
  | "evaluate"
  | "rollback_drill"
  | "reapply_canary"
  | "verify"
  | "promote"
  | "observe_hold";

export type SoftObserveDhAdvanceResult = {
  proposalId: string;
  step: SoftObserveDhStep;
  reason: string;
  statusAfter?: EvolutionProposalStatus;
  applicationId?: string;
  verificationId?: string;
  evaluationAction?: string;
};

export type SoftObserveDhTickResult = {
  enabled: boolean;
  scanned: number;
  advanced: number;
  results: SoftObserveDhAdvanceResult[];
};

let enabledOverride: boolean | null = null;

export function setSoftObserveDhEnabledForTests(enabled: boolean | null): void {
  enabledOverride = enabled;
}

export function isSoftObserveDhEnabled(): boolean {
  if (enabledOverride != null) {
    return enabledOverride;
  }
  const raw = (process.env.OPENBOT_EVOLUTION_SOFT_OBSERVE_DH ?? "on").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") {
    return false;
  }
  if (raw === "on" || raw === "1" || raw === "true" || raw === "") {
    return true;
  }
  // Invalid values fail closed (disabled).
  return false;
}

function isDigitalEmployeeProposal(proposal: EvolutionProposal): boolean {
  if (proposal.target.domain === "system") {
    return false;
  }
  return SOFT_OBSERVE_DH_SURFACES.has(proposal.surfaceId);
}

function latestApplied(apps: readonly EvolutionApplication[]): EvolutionApplication | undefined {
  const applied = apps.filter((row) => row.status === "applied");
  if (applied.length === 0) {
    return undefined;
  }
  return [...applied].toSorted((a, b) => {
    const ta = Date.parse(a.appliedAt ?? "") || 0;
    const tb = Date.parse(b.appliedAt ?? "") || 0;
    return tb - ta;
  })[0];
}

function commandId(proposalId: string, step: string, salt: string): string {
  const safe = proposalId.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 96);
  return `soft-obs:${safe}:${step}:${salt}`;
}

async function applyForSurface(
  plane: EvolutionControlPlane,
  proposal: EvolutionProposal,
  input: {
    commandId: string;
    experimentId: string;
    trustedTenantId: string;
  },
): Promise<EvolutionApplication> {
  const base = {
    commandId: input.commandId,
    proposalId: proposal.proposalId,
    experimentId: input.experimentId,
    principalRef: SOFT_OBSERVE_DH_PRINCIPAL,
    trustedTenantId: input.trustedTenantId,
    scope: "canary" as const,
  };
  if (proposal.surfaceId === "capability.skill-installation") {
    return plane.applySkill(base);
  }
  return plane.applyWorkingDna(base);
}

/**
 * Classify the next soft/observe step without mutating state.
 */
export function classifySoftObserveDhStep(
  plane: EvolutionControlPlane,
  proposal: EvolutionProposal,
): SoftObserveDhAdvanceResult {
  if (!isDigitalEmployeeProposal(proposal)) {
    return {
      proposalId: proposal.proposalId,
      step: "skip",
      reason: proposal.target.domain === "system" ? "system_domain" : "not_dh_soft_surface",
    };
  }
  if (!proposal.tenantScope) {
    return { proposalId: proposal.proposalId, step: "skip", reason: "null_tenant" };
  }
  if (TERMINAL_STATUSES.has(proposal.status)) {
    return { proposalId: proposal.proposalId, step: "skip", reason: "terminal" };
  }
  const experimentId = proposal.experimentId;
  if (!experimentId) {
    return { proposalId: proposal.proposalId, step: "skip", reason: "need_experiment" };
  }
  const experiment = plane.getExperiment(experimentId);
  if (!experiment) {
    return { proposalId: proposal.proposalId, step: "skip", reason: "experiment_missing" };
  }

  const apps = plane.listApplications({ proposalId: proposal.proposalId });
  const applied = latestApplied(apps);
  const drills = plane.listRollbackDrills({ proposalId: proposal.proposalId });
  const passedDrill = drills.find((row) => row.result === "passed");
  const appliedAfterDrill =
    applied &&
    passedDrill &&
    (Date.parse(applied.appliedAt ?? "") || 0) >= (Date.parse(passedDrill.completedAt) || 0)
      ? applied
      : undefined;

  if (experiment.result === "regressed") {
    return { proposalId: proposal.proposalId, step: "skip", reason: "experiment_regressed" };
  }

  // After a passed drill the proposal returns to EXPERIMENTING; re-apply canary.
  // evaluateExperiment often stays "inconclusive" until drill runs (rollback_drill_not_run).
  if (
    proposal.status === "EXPERIMENTING" &&
    passedDrill &&
    !appliedAfterDrill &&
    experiment.result !== "regressed"
  ) {
    return {
      proposalId: proposal.proposalId,
      step: "reapply_canary",
      reason: "post_drill_reapply",
    };
  }

  // First soft canary while still experimenting / approved and no live apply.
  if (
    (proposal.status === "EXPERIMENTING" ||
      proposal.status === "APPROVED_FOR_EXPERIMENT" ||
      proposal.status === "APPROVED_FOR_APPLICATION") &&
    !applied &&
    !passedDrill
  ) {
    return { proposalId: proposal.proposalId, step: "apply_canary", reason: "soft_canary" };
  }

  // Evaluate after first canary while result is still pending.
  if (
    applied &&
    (proposal.status === "CANARY" || proposal.status === "EXPERIMENTING") &&
    experiment.result === "pending"
  ) {
    return {
      proposalId: proposal.proposalId,
      step: "evaluate",
      reason: "pending_result",
      applicationId: applied.applicationId,
    };
  }

  // Drill after an improved canary. Pre-drill "inconclusive" that is only
  // rollback_drill_not_run is chained inside advanceSoftObserveDhProposal.
  if (proposal.status === "CANARY" && applied && !passedDrill && experiment.result === "improved") {
    return {
      proposalId: proposal.proposalId,
      step: "rollback_drill",
      reason: "improved_needs_drill",
      applicationId: applied.applicationId,
    };
  }

  // Verify post-drill canary application.
  if (
    proposal.status === "CANARY" &&
    appliedAfterDrill &&
    !proposal.verificationId &&
    experiment.result !== "regressed"
  ) {
    return {
      proposalId: proposal.proposalId,
      step: "verify",
      reason: "ready_to_verify",
      applicationId: appliedAfterDrill.applicationId,
    };
  }

  // Promote when verified (diagnosis-origin needs closure decide promote).
  if (proposal.status === "VERIFIED") {
    return { proposalId: proposal.proposalId, step: "promote", reason: "verified" };
  }

  // Soft canary applied but still waiting on treatment metrics.
  if (applied && experiment.result === "pending") {
    return {
      proposalId: proposal.proposalId,
      step: "observe_hold",
      reason: "awaiting_treatment_metrics",
      applicationId: applied.applicationId,
      statusAfter: proposal.status,
    };
  }

  // Genuine observe hold: inconclusive/neutral with no further Apply/Verify step.
  if (experiment.result === "inconclusive" || experiment.result === "neutral") {
    return {
      proposalId: proposal.proposalId,
      step: "observe_hold",
      reason: `experiment_${experiment.result}`,
      statusAfter: proposal.status,
      ...(applied ? { applicationId: applied.applicationId } : {}),
    };
  }

  return {
    proposalId: proposal.proposalId,
    step: "skip",
    reason: `no_step_for_${proposal.status}_${experiment.result}`,
    statusAfter: proposal.status,
  };
}

/**
 * Execute one soft/observe step for a single proposal.
 */
export async function advanceSoftObserveDhProposal(
  plane: EvolutionControlPlane,
  proposalId: string,
  options?: { nowSalt?: string },
): Promise<SoftObserveDhAdvanceResult> {
  const proposal = plane.getProposal(proposalId);
  if (!proposal) {
    return { proposalId, step: "skip", reason: "proposal_missing" };
  }
  const classified = classifySoftObserveDhStep(plane, proposal);
  if (classified.step === "skip" || classified.step === "observe_hold") {
    return classified;
  }

  const tenant = proposal.tenantScope;
  if (!tenant) {
    return { proposalId, step: "skip", reason: "null_tenant" };
  }
  const experimentId = proposal.experimentId;
  if (!experimentId) {
    return { proposalId, step: "skip", reason: "need_experiment" };
  }

  const salt = options?.nowSalt ?? String(Date.now());

  try {
    if (classified.step === "apply_canary" || classified.step === "reapply_canary") {
      const application = await applyForSurface(plane, proposal, {
        commandId: commandId(proposalId, classified.step, salt),
        experimentId,
        trustedTenantId: tenant,
      });
      const after = plane.getProposal(proposalId);
      return {
        proposalId,
        step: classified.step,
        reason: classified.reason,
        statusAfter: after?.status,
        applicationId: application.applicationId,
      };
    }

    if (classified.step === "evaluate") {
      const evaluated = await plane.evaluateExperiment(experimentId);
      const after = plane.getProposal(proposalId);
      const reasons = evaluated.decision.reasons ?? [];
      const blocking = new Set([
        "sample_size_insufficient",
        "confidence_insufficient",
        "treatment_premature",
        "baseline_contaminated",
        "cohort_contaminated",
        "window_overlap",
        "config_drift",
        "model_version_changed",
      ]);
      const drillPendingOnly =
        evaluated.experiment.result === "inconclusive" &&
        reasons.includes("rollback_drill_not_run") &&
        !reasons.some((r) => blocking.has(r));
      if (drillPendingOnly && classified.applicationId) {
        const drill = await plane.runRollbackDrill({
          commandId: commandId(proposalId, "drill", salt),
          applicationId: classified.applicationId,
          principalRef: SOFT_OBSERVE_DH_PRINCIPAL,
          trustedTenantId: tenant,
          verifiedBy: SOFT_OBSERVE_DH_PRINCIPAL,
          evidenceRefs: ["soft-observe-dh-drill"],
        });
        const afterDrill = plane.getProposal(proposalId);
        return {
          proposalId,
          step: "rollback_drill",
          reason: `chained_after_evaluate:${drill.result}`,
          statusAfter: afterDrill?.status,
          applicationId: classified.applicationId,
        };
      }
      if (
        evaluated.experiment.result === "inconclusive" ||
        evaluated.experiment.result === "neutral"
      ) {
        return {
          proposalId,
          step: "observe_hold",
          reason: `experiment_${evaluated.experiment.result}`,
          statusAfter: after?.status,
          applicationId: classified.applicationId,
        };
      }
      return {
        proposalId,
        step: "evaluate",
        reason: evaluated.experiment.result,
        statusAfter: after?.status,
        applicationId: classified.applicationId,
      };
    }

    if (classified.step === "rollback_drill") {
      const applicationId = classified.applicationId;
      if (!applicationId) {
        return { proposalId, step: "skip", reason: "application_missing" };
      }
      const drill = await plane.runRollbackDrill({
        commandId: commandId(proposalId, "drill", salt),
        applicationId,
        principalRef: SOFT_OBSERVE_DH_PRINCIPAL,
        trustedTenantId: tenant,
        verifiedBy: SOFT_OBSERVE_DH_PRINCIPAL,
        evidenceRefs: ["soft-observe-dh-drill"],
      });
      const after = plane.getProposal(proposalId);
      return {
        proposalId,
        step: "rollback_drill",
        reason: drill.result,
        statusAfter: after?.status,
        applicationId,
      };
    }

    if (classified.step === "verify") {
      const applicationId = classified.applicationId;
      if (!applicationId) {
        return { proposalId, step: "skip", reason: "application_missing" };
      }
      const verification = await plane.verifyApplication({
        commandId: commandId(proposalId, "verify", salt),
        applicationId,
        principalRef: SOFT_OBSERVE_DH_PRINCIPAL,
        trustedTenantId: tenant,
      });
      const after = plane.getProposal(proposalId);
      return {
        proposalId,
        step: "verify",
        reason: verification.outcome,
        statusAfter: after?.status,
        applicationId,
        verificationId: verification.verificationId,
      };
    }

    if (classified.step === "promote") {
      if (diagnosisOriginEvaluationApplies(proposal)) {
        const decision = workingDnaEvaluationApplies(proposal)
          ? await plane.evaluateWorkingDnaClosure(proposalId)
          : skillInstallationEvaluationApplies(proposal)
            ? await plane.evaluateSkillInstallationClosure(proposalId)
            : { action: "block" as const, reasonCode: "unknown_surface" };
        if (decision.action !== "promote") {
          return {
            proposalId,
            step: "observe_hold",
            reason: decision.reasonCode,
            statusAfter: proposal.status,
            evaluationAction: decision.action,
          };
        }
      }
      const promoted = plane.promoteProposal({
        commandId: commandId(proposalId, "promote", salt),
        proposalId,
        principalRef: SOFT_OBSERVE_DH_PRINCIPAL,
        trustedTenantId: tenant,
      });
      return {
        proposalId,
        step: "promote",
        reason: "promoted",
        statusAfter: promoted.status,
        applicationId: promoted.applicationId ?? undefined,
        verificationId: promoted.verificationId ?? undefined,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      proposalId,
      step: "skip",
      reason: `error:${message.slice(0, 180)}`,
    };
  }

  return classified;
}

/**
 * Drive one proposal until terminal, observe_hold, skip, or maxSteps.
 * Used by tests and by a single-proposal operator call.
 */
export async function runSoftObserveDhClosedLoop(
  plane: EvolutionControlPlane,
  proposalId: string,
  options?: { maxSteps?: number; betweenSteps?: () => Promise<void> | void },
): Promise<{
  steps: SoftObserveDhAdvanceResult[];
  finalStatus?: EvolutionProposalStatus;
  reachedPromote: boolean;
}> {
  const maxSteps = options?.maxSteps ?? 12;
  const steps: SoftObserveDhAdvanceResult[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    if (options?.betweenSteps) {
      await options.betweenSteps();
    }
    const result = await advanceSoftObserveDhProposal(plane, proposalId, {
      nowSalt: `${Date.now()}-${i}`,
    });
    steps.push(result);
    if (result.step === "promote") {
      return {
        steps,
        finalStatus: plane.getProposal(proposalId)?.status,
        reachedPromote: true,
      };
    }
    if (result.step === "skip" || result.step === "observe_hold") {
      break;
    }
  }
  return {
    steps,
    finalStatus: plane.getProposal(proposalId)?.status,
    reachedPromote: plane.getProposal(proposalId)?.status === "PROMOTED",
  };
}

/**
 * One scheduler tick: advance up to maxPerTick eligible DH proposals by one step.
 */
export async function runSoftObserveDhLoopTick(
  plane: EvolutionControlPlane,
  options?: { maxPerTick?: number },
): Promise<SoftObserveDhTickResult> {
  if (!isSoftObserveDhEnabled()) {
    return { enabled: false, scanned: 0, advanced: 0, results: [] };
  }
  const maxPerTick = options?.maxPerTick ?? 10;
  const proposals = plane
    .listProposals()
    .filter((row) => isDigitalEmployeeProposal(row) && Boolean(row.tenantScope))
    .filter((row) => !TERMINAL_STATUSES.has(row.status));
  const results: SoftObserveDhAdvanceResult[] = [];
  let advanced = 0;
  for (const proposal of proposals) {
    if (results.length >= maxPerTick) {
      break;
    }
    const before = classifySoftObserveDhStep(plane, proposal);
    if (before.step === "skip" || before.step === "observe_hold") {
      continue;
    }
    const result = await advanceSoftObserveDhProposal(plane, proposal.proposalId);
    results.push(result);
    if (result.step !== "skip" && result.step !== "observe_hold") {
      advanced += 1;
    }
  }
  return {
    enabled: true,
    scanned: proposals.length,
    advanced,
    results,
  };
}

/** Fail-soft tick entry for the governance scheduler. */
export async function runSoftObserveDhLoopTickSafely(): Promise<SoftObserveDhTickResult> {
  if (!isSoftObserveDhEnabled()) {
    return { enabled: false, scanned: 0, advanced: 0, results: [] };
  }
  try {
    const plane = ensureEvolutionControlPlaneStarted();
    const result = await runSoftObserveDhLoopTick(plane);
    if (result.advanced > 0) {
      logEvolutionLoop({
        event: "evolution.promotion.accepted",
        reason: `soft_observe_dh_advanced:${result.advanced}`,
      });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvolutionLoop({
      event: "evolution.promotion.rejected",
      reason: `soft_observe_dh_tick_error:${message.slice(0, 120)}`,
    });
    return { enabled: true, scanned: 0, advanced: 0, results: [] };
  }
}

/** Test helper: diagnosis-sourced proposals still go through observe_hold on inconclusive. */
export function softObserveIgnoresDiagnosisWithoutImproved(
  proposal: Pick<EvolutionProposal, "sourceMechanismRef">,
  experimentResult: string,
): boolean {
  return isDiagnosisSourced(proposal) && experimentResult !== "improved";
}
