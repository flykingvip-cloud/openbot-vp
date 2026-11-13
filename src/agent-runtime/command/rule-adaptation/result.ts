import { SHADOW_AGENT_PROMPT_IDENTITY } from "../../context/rule-adaptation/prompt.js";
import {
  SHADOW_AGENT_PROTOCOL_VERSION,
  type ShadowBudgetLimits,
  type ShadowControlSnapshot,
  type ShadowDiffEntry,
  type ShadowOutcomeCode,
  type ShadowReason,
  type ShadowRunResult,
  type ShadowToolJournalEntry,
  type ShadowUsage,
} from "../../contracts/rule-adaptation-shadow.js";
import type { RuntimeRuleAdaptationValidationResult } from "../../contracts/rule-adaptation.js";
import { SHADOW_ALLOWED_TOOLS, SHADOW_READONLY_TOOLS } from "./tools.js";

const HARD_RULE_CODES = new Set([
  "hard_boundary_conflict",
  "below_hard_min",
  "above_hard_ceiling",
  "above_current_effective",
  "delete_or_relax_as_tighten",
]);

export function mapValidationToOutcome(
  validation: RuntimeRuleAdaptationValidationResult,
): ShadowOutcomeCode {
  const codes = [
    ...validation.reasons.map((reason) => reason.code),
    ...validation.items.flatMap((item) => item.reasons.map((reason) => reason.code)),
  ];
  if (codes.includes("structural_forbidden_field")) {
    return "malicious_material_rejected";
  }
  if (codes.includes("unknown_rule_id")) {
    return "fabricated_rule_id";
  }
  if (codes.includes("non_candidate_field") || codes.includes("structural_unknown_field")) {
    return "unknown_parameter";
  }
  if (codes.includes("unauthorized_action")) {
    return "insufficient_permission";
  }
  if (codes.some((code) => HARD_RULE_CODES.has(code))) {
    return "hard_rule_conflict";
  }
  if (validation.resultKind === "no_change") {
    return "no_change_needed";
  }
  if (validation.resultKind === "shadow_accepted") {
    return "shadow_recorded";
  }
  if (validation.resultKind === "candidate_validated") {
    return "candidate_validated_not_recorded";
  }
  if (validation.resultKind === "needs_information") {
    return "needs_information";
  }
  return "validator_blocked";
}

export function validationReasons(
  validation: RuntimeRuleAdaptationValidationResult,
): ShadowReason[] {
  const seen = new Set<string>();
  const reasons: ShadowReason[] = [];
  for (const entry of [
    ...validation.reasons,
    ...validation.items.flatMap((item) => item.reasons),
  ]) {
    const key = `${entry.code}:${entry.path ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    reasons.push({
      code: entry.code,
      message: entry.message,
      ...(entry.path ? { path: entry.path } : {}),
    });
  }
  return reasons;
}

export function buildShadowResult(input: {
  outcomeCode: ShadowOutcomeCode;
  reasons: ShadowReason[];
  usage: ShadowUsage;
  limits: ShadowBudgetLimits;
  exhausted: ShadowRunResult["limitProof"]["exhausted"];
  preEnforcedExhausted: ShadowRunResult["limitProof"]["preEnforcedExhausted"];
  postAccountedExhausted: ShadowRunResult["limitProof"]["postAccountedExhausted"];
  deadlineCleanupFailed: boolean;
  sessionDisposeFailed: boolean;
  usageKnown: boolean;
  underlyingRequestStopped: boolean;
  usageAccountingAttempted: boolean;
  usageAccountingStatus: ShadowRunResult["limitProof"]["usageAccountingStatus"];
  governanceOccupancyReady: boolean;
  controlBefore: ShadowControlSnapshot;
  controlAfter: ShadowControlSnapshot;
  controlUnchanged: boolean;
  toolsInvoked: readonly ShadowToolJournalEntry[];
  rejectedTools: readonly ShadowToolJournalEntry[];
  businessAttempts: readonly string[];
  candidateToolInvoked: boolean;
  diagnosedBeforeRetrieval: boolean;
  validation?: RuntimeRuleAdaptationValidationResult;
  proposal?: unknown;
  shadowDiff?: ShadowDiffEntry[];
}): ShadowRunResult {
  const protocolFailed = input.outcomeCode === "protocol_failure";
  return {
    outcomeCode: input.outcomeCode,
    activationAllowed: false,
    claimedEffective: false,
    commitment: "none",
    executionModeOpened: false,
    businessToolsInvoked: [...input.businessAttempts],
    businessToolsExecuted: [],
    reasons: input.reasons,
    ...(input.validation ? { validation: input.validation } : {}),
    ...(input.proposal !== undefined ? { proposal: input.proposal } : {}),
    shadowDiff: input.shadowDiff ?? [],
    usage: input.usage,
    cancelled: input.outcomeCode === "cancelled" || input.usage.cancelled,
    protocolVersion: SHADOW_AGENT_PROTOCOL_VERSION,
    prompt: SHADOW_AGENT_PROMPT_IDENTITY,
    controlUnchanged: input.controlUnchanged,
    controlSnapshotBefore: input.controlBefore,
    controlSnapshotAfter: input.controlAfter,
    candidateToolInvoked: input.candidateToolInvoked,
    candidatePersisted: false,
    candidateActivated: false,
    candidatePublished: false,
    toolsInvoked: input.toolsInvoked,
    diagnosedBeforeRetrieval: input.diagnosedBeforeRetrieval,
    readOnlyProof: {
      allowedTools: [...SHADOW_ALLOWED_TOOLS],
      invokedTools: input.toolsInvoked.map((entry) => entry.name),
      rejectedTools: input.rejectedTools.map((entry) => ({
        name: entry.name,
        code: entry.code ?? entry.status,
        ...(entry.path ? { path: entry.path } : {}),
      })),
      writeAttempted: input.candidateToolInvoked || input.businessAttempts.length > 0,
      configWritten: false,
      policyActivated: false,
      rulesPublished: false,
    },
    limitProof: {
      limits: input.limits,
      usage: input.usage,
      exhausted: input.exhausted,
      preEnforcedExhausted: input.preEnforcedExhausted,
      postAccountedExhausted: input.postAccountedExhausted,
      costAccounting: "estimated_post_hoc",
      cancelled: input.outcomeCode === "cancelled" || input.usage.cancelled,
      protocolFailed,
      threwToCaller: false,
      deadlineCleanupFailed: input.deadlineCleanupFailed,
      sessionDisposeFailed: input.sessionDisposeFailed,
      usageKnown: input.usageKnown,
      underlyingRequestStopped: input.underlyingRequestStopped,
      usageAccountingAttempted: input.usageAccountingAttempted,
      usageAccountingStatus: input.usageAccountingStatus,
      governanceOccupancyReady: input.governanceOccupancyReady,
    },
  };
}

export function reason(code: ShadowReason["code"], message: string, path?: string): ShadowReason {
  return path ? { code, message, path } : { code, message };
}

export function readonlyToolNames(): readonly string[] {
  return SHADOW_READONLY_TOOLS;
}
