/**
 * Persist a precipitation candidate as a lifecycle draft via saveSkillAsset.
 * Never auto-approves / publishes / installs (autoInstallEnabled=false).
 */

import { saveSkillAsset } from "../skill-lifecycle-store.js";
import { findExistingPrecipitationSkill, precipitationSignature } from "./dedupe.js";
import { detectPrecipitationCandidate } from "./detect.js";
import { extractSkillDraftFromCandidate } from "./extract.js";
import type {
  PrecipitationPersistResult,
  SkillPrecipitationCandidate,
  TaskTrajectorySummary,
} from "./types.js";

export type PersistPrecipitationParams = {
  trajectory: TaskTrajectorySummary;
  sourceAgentId?: string | null;
  ownerUserId?: string | null;
  contextId?: string | null;
  /** When true, skip writing and only return detect outcome (tests / dry-run). */
  dryRun?: boolean;
};

export function persistPrecipitationDraft(
  params: PersistPrecipitationParams,
): PrecipitationPersistResult {
  const detected = detectPrecipitationCandidate(params.trajectory);
  if (detected.kind === "skip") {
    return {
      kind: "skipped",
      reason: detected.reason,
      confidence: detected.confidence,
    };
  }
  return persistPrecipitationCandidate({
    candidate: detected.candidate,
    sourceAgentId: params.sourceAgentId,
    ownerUserId: params.ownerUserId,
    contextId: params.contextId,
    dryRun: params.dryRun,
  });
}

export function persistPrecipitationCandidate(params: {
  candidate: SkillPrecipitationCandidate;
  sourceAgentId?: string | null;
  ownerUserId?: string | null;
  contextId?: string | null;
  dryRun?: boolean;
}): PrecipitationPersistResult {
  const candidate = params.candidate;
  if (candidate.sourceEvidenceRefs.length === 0) {
    return { kind: "skipped", reason: "missing_source_evidence_refs", confidence: 0 };
  }
  if (candidate.completeness === "insufficient") {
    return {
      kind: "skipped",
      reason: candidate.completenessReason ?? "insufficient",
      confidence: candidate.confidence,
    };
  }

  const signature = precipitationSignature(candidate);
  const existingId = findExistingPrecipitationSkill({
    signature,
    sourceAgentId: params.sourceAgentId,
    ownerUserId: params.ownerUserId,
  });
  if (existingId) {
    return {
      kind: "reused",
      skillId: existingId,
      candidate,
      signature,
    };
  }

  if (params.dryRun) {
    return {
      kind: "created",
      skillId: "dry-run",
      candidate,
      signature,
    };
  }

  const extracted = extractSkillDraftFromCandidate(candidate);
  const agentId = params.sourceAgentId?.trim() || "agent";
  const ownerUserId = params.ownerUserId?.trim() || null;
  const { skillId } = saveSkillAsset({
    sourceAgentId: agentId,
    contextId: params.contextId ?? `precipitation:${signature}`,
    lifecycle: "draft",
    ...(ownerUserId ? { ownerUserId } : {}),
    profile: extracted.profile,
    runtimeDefinition: extracted.runtimeDefinition,
    autoInstallEnabled: false,
  });

  return {
    kind: "created",
    skillId,
    candidate,
    signature,
  };
}
