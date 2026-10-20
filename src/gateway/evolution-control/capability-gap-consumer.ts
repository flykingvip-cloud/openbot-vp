/**
 * Background consumer: DISCOVERED capability-gap proposals → real evolution actions.
 *
 * Runs off the reply path (gateway evolution-governance scheduler tick).
 * Aggregates by tenant+agent+category+normalized reason; acts past threshold:
 *   ≥1 explicit marker  OR  ≥2 occurrences (configurable).
 *
 * Category actions (existing sinks — no parallel backlog):
 *   skill      → skill-precipitation draft (or partial stub) via saveSkillAsset then suggestProposal
 *   tool       → capability-governance submitProposal then suggest
 *   perception → triage tag + suggest (operator surface:
 *     evolution.proposals.list projects triageTag/capabilityGap;
 *     filter via params.triageTag / sourceMechanismPrefix)
 */
import { createHash, randomUUID } from "node:crypto";
import { submitProposal } from "../capability-governance-store.js";
import { saveSkillAsset } from "../skill-lifecycle-store.js";
import {
  persistPrecipitationDraft,
  trajectoryFromCapabilityGapPayload,
} from "../skill-precipitation/index.js";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import {
  clearEmptyReplyGapCounter,
  listEmptyReplyGapCountersForConsumer,
  recordCapabilityGapEvent,
  type CapabilityGapCandidatePayload,
  type CapabilityGapCategory,
} from "./capability-gap-ingest.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { logEvolutionLoop } from "./evolution-loop-log.js";

export type CapabilityGapConsumerConfig = {
  /** Minimum occurrences (sourceEvidenceRefs / occurrenceCount) to act. Default 2. */
  occurrenceThreshold: number;
  /** Explicit markers act at this count (default 1). */
  explicitMarkerThreshold: number;
  /** Empty-reply metric counters promote to a proposal at this count. Default 2. */
  emptyReplyPromoteThreshold: number;
  /** Max DISCOVERED gaps to process per tick. */
  maxPerTick: number;
};

const DEFAULT_CONFIG: CapabilityGapConsumerConfig = {
  occurrenceThreshold: 2,
  explicitMarkerThreshold: 1,
  emptyReplyPromoteThreshold: 2,
  maxPerTick: 20,
};

let config: CapabilityGapConsumerConfig = { ...DEFAULT_CONFIG };

export function configureCapabilityGapConsumer(
  patch: Partial<CapabilityGapConsumerConfig>,
): CapabilityGapConsumerConfig {
  config = { ...config, ...patch };
  return { ...config };
}

export function getCapabilityGapConsumerConfig(): CapabilityGapConsumerConfig {
  return { ...config };
}

export function resetCapabilityGapConsumerConfigForTests(): void {
  config = { ...DEFAULT_CONFIG };
}

function aggregateKey(parts: {
  tenantId: string | null;
  agentId: string | null;
  category: string;
  reason: string;
}): string {
  return [parts.tenantId ?? "none", parts.agentId ?? "none", parts.category, parts.reason].join(
    "|",
  );
}

function pastThreshold(payload: CapabilityGapCandidatePayload | undefined): boolean {
  const occurrences = Math.max(Number(payload?.occurrenceCount ?? 1), 1);
  if (payload?.explicitMarker) {
    return occurrences >= config.explicitMarkerThreshold;
  }
  return occurrences >= config.occurrenceThreshold;
}

function draftProfileForGap(payload: CapabilityGapCandidatePayload): {
  name: string;
  summary: string;
  visibility: "private";
  assetType: "skill";
  tags: string[];
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
} {
  const detail = (payload.detail ?? payload.reason ?? "capability-gap").trim();
  const summary =
    (payload.userLanguageSummary ?? detail).trim() ||
    "Capability gap draft from evolution consumer";
  return {
    name: `能力缺口草稿：${detail}`.slice(0, 120),
    summary: summary.slice(0, 500),
    visibility: "private",
    assetType: "skill",
    tags: ["capability-gap", String(payload.category ?? "skill")].slice(0, 10),
    usageExamples: [summary].slice(0, 3),
    inputDescription: "Triggered when the same capability gap recurs",
    outputDescription: "Draft skill pending human review",
  };
}

function actSkill(input: {
  plane: EvolutionControlPlane;
  proposalId: string;
  payload: CapabilityGapCandidatePayload;
}): { draftSkillId: string | null } {
  if (input.payload.draftSkillId) {
    return { draftSkillId: input.payload.draftSkillId };
  }
  const agentId = input.payload.agentId?.trim() || "agent";
  const ownerUserId = input.payload.ownerUserId?.trim() || null;
  const proposal = input.plane.getProposal(input.proposalId);
  const evidenceRefs = proposal?.sourceEvidenceRefs ?? [];
  const trajectory = trajectoryFromCapabilityGapPayload(input.payload, {
    proposalId: input.proposalId,
    fallbackEvidenceId: evidenceRefs[0] ?? `capability-gap:${input.proposalId}`,
  });
  const precipitated = persistPrecipitationDraft({
    trajectory,
    sourceAgentId: agentId,
    ownerUserId,
    contextId: `capability-gap:${input.proposalId}`,
  });
  if (precipitated.kind === "created" || precipitated.kind === "reused") {
    return { draftSkillId: precipitated.skillId };
  }
  // Insufficient trajectory: keep legacy draft stub, marked partial via routingHints.
  const { skillId } = saveSkillAsset({
    sourceAgentId: agentId,
    contextId: `capability-gap:${input.proposalId}`,
    lifecycle: "draft",
    ...(ownerUserId ? { ownerUserId } : {}),
    profile: draftProfileForGap(input.payload),
    runtimeDefinition: {
      prompts: [input.payload.userLanguageSummary ?? input.payload.reason ?? "capability gap"],
      tools: input.payload.detail ? [input.payload.detail] : [],
      routingHints: {
        precipitation: {
          completeness: "partial",
          completenessReason: precipitated.reason,
          confidence: precipitated.confidence,
          sourceEvidenceRefs: evidenceRefs,
        },
      },
    },
    autoInstallEnabled: false,
  });
  return { draftSkillId: skillId };
}

function actTool(input: { proposalId: string; payload: CapabilityGapCandidatePayload }): {
  governanceProposalId: string | null;
} {
  if (input.payload.governanceProposalId) {
    return { governanceProposalId: input.payload.governanceProposalId };
  }
  const detail = (input.payload.detail ?? input.payload.reason ?? "tool-gap").trim();
  const skillKey = `gap-tool-${createHash("sha256").update(detail).digest("hex").slice(0, 12)}`;
  const proposalId = `gov:capability-gap:${createHash("sha256")
    .update(input.proposalId)
    .digest("hex")
    .slice(0, 16)}`;
  submitProposal({
    proposalId,
    submittedAt: new Date().toISOString(),
    submittedBy: input.payload.agentId ?? "capability-gap-consumer",
    enterpriseId: input.payload.tenantId ?? undefined,
    status: "proposed",
    manifest: {
      id: skillKey,
      kind: "skill",
      version: "0.0.1-draft",
      skillKey,
      name: `Tool gap: ${detail}`.slice(0, 120),
      description: (input.payload.userLanguageSummary ?? detail).slice(0, 500),
      source: {
        kind: "capability-gap",
        origin: input.proposalId,
        trustTier: "draft",
      },
      risk: {
        level: "low",
        network: false,
        filesystem: false,
        subprocess: false,
        secrets: false,
      },
    },
    findings: [],
  });
  return { governanceProposalId: proposalId };
}

function suggestSafe(input: {
  plane: EvolutionControlPlane;
  proposalId: string;
  tenantScope: string | null;
}): boolean {
  try {
    input.plane.suggestProposal({
      commandId: `gap-consumer-suggest:${input.proposalId}:${randomUUID()}`,
      proposalId: input.proposalId,
      principalRef: "system:capability-gap-consumer",
      trustedTenantId: input.tenantScope,
    });
    return true;
  } catch (err) {
    logEvolutionLoop("evolution.capability.gap_recorded", {
      taskId: input.proposalId,
      tenantId: input.tenantScope,
      reason: `suggest_failed:${String(err)}`,
    });
    return false;
  }
}

function processDiscoveredProposal(input: { plane: EvolutionControlPlane; proposalId: string }): {
  acted: boolean;
  suggested: boolean;
} {
  const proposal = input.plane.getProposal(input.proposalId);
  if (!proposal || proposal.status !== "DISCOVERED") {
    return { acted: false, suggested: false };
  }
  if (!proposal.sourceMechanismRef.startsWith("capability-gap:")) {
    return { acted: false, suggested: false };
  }
  const payload = (input.plane.getCandidate(proposal.candidateRef)?.payload ??
    {}) as CapabilityGapCandidatePayload;
  if (!pastThreshold(payload)) {
    return { acted: false, suggested: false };
  }

  const category = (payload.category ?? "perception") as CapabilityGapCategory;
  let draftSkillId = payload.draftSkillId ?? null;
  let governanceProposalId = payload.governanceProposalId ?? null;
  let triageTag = payload.triageTag ?? null;

  try {
    if (category === "skill") {
      draftSkillId = actSkill({
        plane: input.plane,
        proposalId: proposal.proposalId,
        payload,
      }).draftSkillId;
    } else if (category === "tool") {
      governanceProposalId = actTool({
        proposalId: proposal.proposalId,
        payload,
      }).governanceProposalId;
    } else {
      triageTag = triageTag ?? "perception-triage";
    }
  } catch (err) {
    logEvolutionLoop("evolution.capability.gap_recorded", {
      taskId: proposal.proposalId,
      tenantId: proposal.tenantScope,
      reason: `consumer_act_failed:${String(err)}`,
    });
    return { acted: false, suggested: false };
  }

  input.plane.registerCandidate(proposal.candidateRef, {
    ...payload,
    draftSkillId,
    governanceProposalId,
    triageTag,
    lifecycle: "in_progress",
    consumerActedAt: new Date().toISOString(),
  });

  const suggested = suggestSafe({
    plane: input.plane,
    proposalId: proposal.proposalId,
    tenantScope: proposal.tenantScope,
  });
  return { acted: true, suggested };
}

function promoteEmptyReplyCounters(plane: EvolutionControlPlane): number {
  let promoted = 0;
  for (const row of listEmptyReplyGapCountersForConsumer()) {
    if (row.count < config.emptyReplyPromoteThreshold) {
      continue;
    }
    if (row.tenantId === "tenant:none") {
      // No tenant → do not open a globally matched proposal.
      continue;
    }
    const result = recordCapabilityGapEvent({
      plane,
      tenantId: row.tenantId === "tenant:none" ? null : row.tenantId,
      agentId: row.agentId === "agent:none" ? null : row.agentId,
      category: row.category,
      reason: row.reason,
      sourceKind: "other",
      explicitMarker: false,
      detail: `aggregated_empty_reply:${row.count}`,
      userLanguageSummary: `Recurring empty private replies (${row.count})`,
      dedupWindowMs: 0,
    });
    if (result.proposalId) {
      // Force occurrence count past threshold and act immediately.
      const proposal = plane.getProposal(result.proposalId);
      if (proposal) {
        const payload = (plane.getCandidate(proposal.candidateRef)?.payload ??
          {}) as CapabilityGapCandidatePayload;
        plane.registerCandidate(proposal.candidateRef, {
          ...payload,
          occurrenceCount: Math.max(row.count, config.occurrenceThreshold),
          explicitMarker: false,
        });
        processDiscoveredProposal({ plane, proposalId: result.proposalId });
      }
      promoted += 1;
    }
    clearEmptyReplyGapCounter(row.key);
  }
  return promoted;
}

function expireStaleDiscovered(plane: EvolutionControlPlane, nowMs: number): number {
  let expired = 0;
  for (const proposal of plane.listProposals()) {
    if (proposal.status !== "DISCOVERED") {
      continue;
    }
    if (!proposal.sourceMechanismRef.startsWith("capability-gap:")) {
      continue;
    }
    const expiresAt = Date.parse(proposal.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) {
      continue;
    }
    try {
      plane.expireProposal({
        commandId: `gap-expire:${proposal.proposalId}:${nowMs}`,
        proposalId: proposal.proposalId,
        principalRef: "system:capability-gap-consumer",
        trustedTenantId: proposal.tenantScope,
      });
      expired += 1;
    } catch {
      // best-effort
    }
  }
  return expired;
}

export type CapabilityGapConsumerTickResult = {
  examined: number;
  acted: number;
  suggested: number;
  promotedEmptyReplies: number;
  expired: number;
};

/**
 * One consumer tick. Safe to call from the governance scheduler or tests.
 */
export function runCapabilityGapConsumerTick(options?: {
  plane?: EvolutionControlPlane;
  nowMs?: number;
  persistDir?: string;
}): CapabilityGapConsumerTickResult {
  const plane = options?.plane ?? ensureEvolutionControlPlaneStarted();
  const nowMs = options?.nowMs ?? Date.now();
  let examined = 0;
  let acted = 0;
  let suggested = 0;

  const promotedEmptyReplies = promoteEmptyReplyCounters(plane);
  const expired = expireStaleDiscovered(plane, nowMs);

  // Aggregate DISCOVERED gaps — process each proposal that passes threshold.
  const discovered = plane
    .listProposals()
    .filter((p) => p.status === "DISCOVERED" && p.sourceMechanismRef.startsWith("capability-gap:"))
    .slice(0, config.maxPerTick);

  // Dedupe by aggregate key so we don't double-act identical gaps.
  const seen = new Set<string>();
  for (const proposal of discovered) {
    examined += 1;
    const payload = plane.getCandidate(proposal.candidateRef)?.payload as
      | CapabilityGapCandidatePayload
      | undefined;
    const key = aggregateKey({
      tenantId: proposal.tenantScope,
      agentId: payload?.agentId ?? null,
      category: String(payload?.category ?? "perception"),
      reason: String(payload?.reason ?? ""),
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const result = processDiscoveredProposal({ plane, proposalId: proposal.proposalId });
    if (result.acted) {
      acted += 1;
    }
    if (result.suggested) {
      suggested += 1;
    }
  }

  return { examined, acted, suggested, promotedEmptyReplies, expired };
}

/** Never-throw wrapper for scheduler. */
export function runCapabilityGapConsumerTickSafely(options?: {
  plane?: EvolutionControlPlane;
  nowMs?: number;
  persistDir?: string;
}): CapabilityGapConsumerTickResult | null {
  try {
    return runCapabilityGapConsumerTick(options);
  } catch (err) {
    logEvolutionLoop("evolution.capability.gap_recorded", {
      reason: `consumer_tick_failed:${String(err)}`,
    });
    return null;
  }
}
