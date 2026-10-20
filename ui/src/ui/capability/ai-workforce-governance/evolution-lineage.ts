/**
 * Evolution control-plane lineage projection for the governance UI.
 * Receipts and linked v1 verification are never treated as effect proof.
 */
// The module itself, not the package root: the root barrel re-exports
// Node-only modules and has no browser build. capsule-eligibility.ts has no
// imports of its own.
import {
  CAPSULE_OBSERVATION_UNAVAILABLE_REASONS,
  projectCapsuleObservationView,
  type CapsuleObservationEligibility,
  type CapsuleObservationUnavailableReason,
  type CapsuleObservationView,
} from "../../../../../packages/evolution-core/src/capsule-eligibility.ts";

export type EvolutionLineageProposal = {
  proposalId: string;
  surfaceId: string;
  status: string;
  tenantScope: string | null;
  applicationId?: string;
  verificationId?: string;
  legacy?: { linkedVerificationOnly?: boolean };
};

export type EvolutionLineageEvent = {
  eventId: string;
  type: string;
  proposalId: string;
  exclusionReason?: string | null;
};

export type EvolutionEffectProof = "none" | "linked-only" | "verified";

export type EvolutionHoldAction = {
  command: "hold" | "resume";
  label: string;
};

export type EvolutionLineageView = {
  proposalId: string;
  surfaceId: string;
  status: string;
  statusLabel: string;
  effectProof: EvolutionEffectProof;
  effectProofLabel: string;
  holdAction: EvolutionHoldAction | null;
  observation: CapsuleObservationView | null;
  steps: Array<{ type: string; receiptOnly: boolean; label: string }>;
};

const RECEIPT_ONLY = new Set([
  "application.applied",
  "legacy.imported",
  "observation.excluded",
  "external_effect.recorded",
]);

const STEP_LABELS: Record<string, string> = {
  "legacy.imported": "历史导入（回执）",
  "proposal.created": "提案创建",
  "experiment.started": "实验开始",
  "experiment.held": "实验暂停",
  "experiment.completed": "实验完成",
  "application.applied": "已应用回执",
  "verification.completed": "指标验证",
  "promotion.completed": "已晋升",
  "rollback.started": "回滚开始",
  "rollback.completed": "回滚完成",
  "proposal.rejected": "已拒绝",
  "observation.excluded": "观察不可用（非 0% 复发）",
  "external_effect.recorded": "外部状态核验",
};

const STATUS_LABELS: Record<string, string> = {
  EXPERIMENTING: "实验中",
  HELD: "已暂停",
  CANARY: "金丝雀",
  VERIFIED: "已验证",
  PROMOTED: "已晋升",
  REJECTED: "已拒绝",
};

export function projectCapsuleObservationAvailability(
  eligibility: CapsuleObservationEligibility,
  nativeRecurrenceRate?: number | null,
): CapsuleObservationView {
  return projectCapsuleObservationView({ eligibility, nativeRecurrenceRate });
}

function isUnavailableReason(value: unknown): value is CapsuleObservationUnavailableReason {
  return (
    typeof value === "string" &&
    (CAPSULE_OBSERVATION_UNAVAILABLE_REASONS as readonly string[]).includes(value)
  );
}

/** Ledger exclusion is observation unavailable — never 0% or failed. */
export function projectExcludedObservation(
  events: readonly EvolutionLineageEvent[],
  proposalId: string,
): CapsuleObservationView | null {
  const excluded = events.find(
    (event) => event.proposalId === proposalId && event.type === "observation.excluded",
  );
  if (!excluded) {
    return null;
  }
  const reason = isUnavailableReason(excluded.exclusionReason)
    ? excluded.exclusionReason
    : "legacy_missing_failure_cluster";
  return projectCapsuleObservationView({
    eligibility: { eligible: false, reason },
  });
}

export function resolveEvolutionHoldAction(status: string): EvolutionHoldAction | null {
  if (status === "EXPERIMENTING") {
    return { command: "hold", label: "暂停实验" };
  }
  if (status === "HELD") {
    return { command: "resume", label: "恢复实验" };
  }
  return null;
}

export function classifyEvolutionEffectProof(
  proposal: Pick<EvolutionLineageProposal, "status" | "legacy">,
): EvolutionEffectProof {
  if (proposal.status === "VERIFIED" || proposal.status === "PROMOTED") {
    return "verified";
  }
  if (proposal.legacy?.linkedVerificationOnly) {
    return "linked-only";
  }
  return "none";
}

export function projectEvolutionLineageView(
  proposal: EvolutionLineageProposal,
  events: readonly EvolutionLineageEvent[],
): EvolutionLineageView {
  const effectProof = classifyEvolutionEffectProof(proposal);
  return {
    proposalId: proposal.proposalId,
    surfaceId: proposal.surfaceId,
    status: proposal.status,
    statusLabel: STATUS_LABELS[proposal.status] ?? proposal.status,
    holdAction: resolveEvolutionHoldAction(proposal.status),
    observation: projectExcludedObservation(events, proposal.proposalId),
    effectProof,
    effectProofLabel:
      effectProof === "verified"
        ? "已用指标验证"
        : effectProof === "linked-only"
          ? "仅关联回执，不是效果证明"
          : "尚未验证效果",
    steps: events
      .filter((event) => event.proposalId === proposal.proposalId)
      .map((event) => ({
        type: event.type,
        receiptOnly: RECEIPT_ONLY.has(event.type),
        label: STEP_LABELS[event.type] ?? event.type,
      })),
  };
}
