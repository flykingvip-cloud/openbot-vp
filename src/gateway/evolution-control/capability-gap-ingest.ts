/**
 * Capability-gap → existing evolution control plane (closed loop).
 *
 * Signal path:
 *   recordCapabilityGapEvent
 *     → logEvolutionLoop("evolution.capability.gap_recorded")
 *     → register DISCOVERED proposal (markers / actionable gaps)
 *        OR metric-only counter (plain empty-reply without detail)
 *
 * Consumer (capability-gap-consumer, off reply path):
 *   aggregate by tenant+agent+category+reason → past threshold
 *     skill → saveSkillAsset(draft) → link → suggestProposal
 *     tool  → capability-governance submitProposal → suggest
 *     perception → triage tag + suggest
 *
 * Closure (legal transitions + ledger; NEVER write REJECTED for resolve):
 *   linked draft/install reaches verified-equivalent AND later run uses it
 *     → suggest if still DISCOVERED → candidate.lifecycle=resolved + ledger
 */
import { createHash, randomUUID } from "node:crypto";
import { skillMetricSet, type EvolutionProposal } from "@openbot/evolution-core";
import {
  getRegistryEntry,
  listProposals as listGovernanceProposals,
} from "../capability-governance-store.js";
import { getPersonalSkillAssetDetail } from "../skill-lifecycle-store.js";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import { persistCapabilityGapEvidence } from "./capability-gap-evidence.js";
import {
  ensureCapabilityGapSystemGrant,
  expandCapabilityGapGrantEvidence,
} from "./capability-gap-grant.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { getSharedDiagnosisDelegationMachine } from "./delegation-service.js";
import { logEvolutionLoop } from "./evolution-loop-log.js";

export type CapabilityGapCategory = "skill" | "tool" | "perception";

export type CapabilityGapLifecycle = "open" | "in_progress" | "resolved" | "wont_fix";

export type CapabilityGapSourceKind = "marker" | "empty_reply" | "run_error" | "other";

export type CapabilityGapEventInput = {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  sessionKey?: string | null;
  chatType?: string | null;
  category: CapabilityGapCategory;
  reason: string;
  detail?: string | null;
  /** Short user-language summary of what was missing / next step. */
  userLanguageSummary?: string | null;
  /** Optional plane override for tests. */
  plane?: EvolutionControlPlane;
  /** Dedup window ms (default 6h). */
  dedupWindowMs?: number;
  nowMs?: number;
  /** How this gap was signaled. Markers always persist; empty_reply is metric-only. */
  sourceKind?: CapabilityGapSourceKind;
  /** True when emitted from an assistant [[capability_gap:…]] marker. */
  explicitMarker?: boolean;
  /** Session / tenant owner — stamped onto draft skills for personal UI. */
  ownerUserId?: string | null;
  /** Evolution-control persist root (tests / custom plane). */
  persistDir?: string;
};

export type CapabilityGapIngestResult = {
  recorded: boolean;
  deduped: boolean;
  metricOnly: boolean;
  proposalId: string | null;
  proposal: EvolutionProposal | null;
};

const DEDUP_WINDOW_MS_DEFAULT = 6 * 60 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 2000;
const recentKeys = new Map<string, number>();

/** In-memory metric counters for plain empty-reply gaps (no proposal per session). */
const emptyReplyCounters = new Map<string, { count: number; lastAt: number }>();

const OPEN_STATUSES = new Set(["DISCOVERED"]);
const IN_PROGRESS_STATUSES = new Set([
  "SUGGESTED",
  "PENDING_AUTHORITY",
  "APPROVED_FOR_EXPERIMENT",
  "EXPERIMENTING",
  "HELD",
  "APPROVED_FOR_APPLICATION",
  "CANARY",
  "ACTIVE",
]);
const RESOLVED_STATUSES = new Set(["PROMOTED", "VERIFIED"]);
const WONT_FIX_STATUSES = new Set(["REJECTED", "EXPIRED", "REVOKED", "ROLLED_BACK"]);

/** Skill review/approval terminal states (draft→…→approved|published). Not private/draft. */
const VERIFIED_EQUIVALENT_SKILL_LIFECYCLES = new Set(["approved", "published"]);

export function normalizeCapabilityGapReason(reason: string): string {
  return reason
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9:_./\-\u4e00-\u9fff ]+/gi, "")
    .slice(0, 160);
}

export function capabilityGapLifecycle(status: string): CapabilityGapLifecycle {
  if (OPEN_STATUSES.has(status)) {
    return "open";
  }
  if (IN_PROGRESS_STATUSES.has(status)) {
    return "in_progress";
  }
  if (RESOLVED_STATUSES.has(status)) {
    return "resolved";
  }
  if (WONT_FIX_STATUSES.has(status)) {
    return "wont_fix";
  }
  return "open";
}

function pruneDedupMap(now: number, windowMs: number): void {
  if (recentKeys.size <= DEDUP_MAX_ENTRIES) {
    for (const [key, ts] of recentKeys) {
      if (now - ts >= windowMs) {
        recentKeys.delete(key);
      }
    }
    return;
  }
  const entries = [...recentKeys.entries()].toSorted((a, b) => a[1] - b[1]);
  const drop = entries.length - Math.floor(DEDUP_MAX_ENTRIES * 0.75);
  for (let i = 0; i < drop; i += 1) {
    recentKeys.delete(entries[i][0]);
  }
}

function dedupKey(input: {
  tenantId?: string | null;
  sessionKey?: string | null;
  category: CapabilityGapCategory;
  reason: string;
}): string {
  const tenant = (input.tenantId ?? "").trim() || "tenant:none";
  const session = (input.sessionKey ?? "").trim() || "session:none";
  return `${tenant}|${session}|${input.category}|${normalizeCapabilityGapReason(input.reason)}`;
}

function stableGapId(input: {
  tenantId?: string | null;
  sessionKey?: string | null;
  category: CapabilityGapCategory;
  reason: string;
  agentId?: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tenantId: (input.tenantId ?? "").trim() || null,
        sessionKey: (input.sessionKey ?? "").trim() || null,
        category: input.category,
        reason: normalizeCapabilityGapReason(input.reason),
        agentId: (input.agentId ?? "").trim() || null,
      }),
    )
    .digest("hex")
    .slice(0, 24);
}

function surfaceForCategory(category: CapabilityGapCategory): string {
  if (category === "skill") {
    return "capability.skill-spec";
  }
  if (category === "tool") {
    return "capability.skill-installation";
  }
  return "capability.skill-spec";
}

function skillIdForGap(input: CapabilityGapEventInput, id: string): string {
  const agent = (input.agentId ?? "").trim() || "agent";
  return `gap:${input.category}:${agent}:${id.slice(0, 12)}`;
}

function emptyReplyCounterKey(input: {
  tenantId?: string | null;
  agentId?: string | null;
  category: CapabilityGapCategory;
  reason: string;
}): string {
  return [
    (input.tenantId ?? "").trim() || "tenant:none",
    (input.agentId ?? "").trim() || "agent:none",
    input.category,
    normalizeCapabilityGapReason(input.reason),
  ].join("|");
}

/** Infra/auth/billing errors must not become tool capability gaps. */
export function isInfraCapabilityGapReason(reason: string, detail?: string | null): boolean {
  const blob = `${reason} ${detail ?? ""}`.toLowerCase();
  return (
    /rate.?limit|too many requests|429\b/.test(blob) ||
    /\b(401|403)\b|unauthorized|forbidden|auth(entication|orization)?_?(failed|error|denied)/.test(
      blob,
    ) ||
    /billing|payment.?required|quota.?exceeded|credit|insufficient.?fund/.test(blob) ||
    /infra_startup_failure|workspace_authorization_failed|eexist|not supported/.test(blob)
  );
}

/** Test helper: clear in-process dedup window + empty-reply counters. */
export function resetCapabilityGapDedupForTests(): void {
  recentKeys.clear();
  emptyReplyCounters.clear();
}

export function getEmptyReplyGapCounterForTests(key?: string): number {
  if (key) {
    return emptyReplyCounters.get(key)?.count ?? 0;
  }
  let total = 0;
  for (const row of emptyReplyCounters.values()) {
    total += row.count;
  }
  return total;
}

/**
 * Persist a capability gap into the evolution control plane as a DISCOVERED
 * proposal (backlog item). Plain empty-reply gaps without an explicit marker
 * are metric-only (no proposal per session).
 */
export function recordCapabilityGapEvent(
  input: CapabilityGapEventInput,
): CapabilityGapIngestResult {
  const reason = input.reason.trim() || "unspecified";
  const normalized = normalizeCapabilityGapReason(reason);
  const sourceKind: CapabilityGapSourceKind =
    input.sourceKind ??
    (input.explicitMarker
      ? "marker"
      : reason === "direct_chat_silent_or_empty_reply"
        ? "empty_reply"
        : "other");
  const explicitMarker = Boolean(input.explicitMarker) || sourceKind === "marker";

  // Plain empty-reply → metric/counter only (consumer may later open a proposal).
  if (sourceKind === "empty_reply" && !explicitMarker) {
    const key = emptyReplyCounterKey({
      tenantId: input.tenantId,
      agentId: input.agentId,
      category: input.category,
      reason: normalized,
    });
    const prev = emptyReplyCounters.get(key);
    const count = (prev?.count ?? 0) + 1;
    emptyReplyCounters.set(key, { count, lastAt: input.nowMs ?? Date.now() });
    logEvolutionLoop("evolution.capability.gap_recorded", {
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      tenantId: input.tenantId ?? null,
      surfaceId: surfaceForCategory(input.category),
      reason: normalized,
    });
    return {
      recorded: true,
      deduped: false,
      metricOnly: true,
      proposalId: null,
      proposal: null,
    };
  }

  if (input.category === "tool" && isInfraCapabilityGapReason(reason, input.detail)) {
    logEvolutionLoop("evolution.capability.gap_recorded", {
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      tenantId: input.tenantId ?? null,
      surfaceId: surfaceForCategory(input.category),
      reason: `skipped_infra:${normalized}`,
    });
    return {
      recorded: false,
      deduped: false,
      metricOnly: true,
      proposalId: null,
      proposal: null,
    };
  }

  const key = dedupKey({
    tenantId: input.tenantId,
    sessionKey: input.sessionKey,
    category: input.category,
    reason: normalized,
  });
  const now = input.nowMs ?? Date.now();
  const windowMs = input.dedupWindowMs ?? DEDUP_WINDOW_MS_DEFAULT;
  pruneDedupMap(now, windowMs);
  const prev = recentKeys.get(key);
  if (prev !== undefined && now - prev < windowMs) {
    logEvolutionLoop("evolution.capability.gap_recorded", {
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      tenantId: input.tenantId ?? null,
      surfaceId: surfaceForCategory(input.category),
      reason: `deduped:${normalized}`,
    });
    return { recorded: false, deduped: true, metricOnly: false, proposalId: null, proposal: null };
  }
  recentKeys.set(key, now);

  const id = stableGapId({
    tenantId: input.tenantId,
    sessionKey: input.sessionKey,
    category: input.category,
    reason: normalized,
    agentId: input.agentId,
  });
  const proposalId = `evo:capability-gap:${id}`;
  const candidateRef = `cand:capability-gap:${id}`;
  const plane = input.plane ?? ensureEvolutionControlPlaneStarted();
  const persistDir = input.persistDir;
  const tenantScope = input.tenantId?.trim() || null;
  const machine = getSharedDiagnosisDelegationMachine(persistDir);

  const evidence = persistCapabilityGapEvidence(
    {
      category: input.category,
      reason: normalized,
      detail: input.detail,
      tenantId: tenantScope,
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      runId: input.runId,
      sourceKind,
      explicitMarker,
      nowMs: now,
    },
    persistDir,
  );
  const { grantId } = ensureCapabilityGapSystemGrant({
    machine,
    tenantId: tenantScope,
    nowMs: now,
    evidenceRefs: [evidence.evidenceId],
  });
  expandCapabilityGapGrantEvidence({
    machine,
    grantId,
    evidenceIds: [evidence.evidenceId],
    tenantId: tenantScope,
  });

  const existing = plane.getProposal(proposalId);
  if (existing && capabilityGapLifecycle(existing.status) !== "wont_fix") {
    // Bind proposal to the live system grant + append real evidence (never fixture ev-a).
    const nextRefs = existing.sourceEvidenceRefs.includes(evidence.evidenceId)
      ? existing.sourceEvidenceRefs
      : [...existing.sourceEvidenceRefs.filter((ref) => ref !== "ev-a"), evidence.evidenceId].slice(
          -8,
        );
    expandCapabilityGapGrantEvidence({
      machine,
      grantId: existing.grantId.startsWith("grant:capability-gap:system:")
        ? existing.grantId
        : grantId,
      evidenceIds: nextRefs,
      tenantId: existing.tenantScope,
    });
    const refreshed = plane.stageDiagnosisProposal({
      ...existing,
      grantId: existing.grantId.startsWith("grant:capability-gap:system:")
        ? existing.grantId
        : grantId,
      sourceEvidenceRefs: nextRefs,
    });
    const prevPayload = plane.getCandidate(existing.candidateRef)?.payload as
      | Record<string, unknown>
      | undefined;
    plane.registerCandidate(existing.candidateRef, {
      ...prevPayload,
      occurrenceCount: Number(prevPayload?.occurrenceCount ?? 1) + 1,
      explicitMarker: Boolean(prevPayload?.explicitMarker) || explicitMarker,
      lastSeenAt: new Date(now).toISOString(),
      ...(input.ownerUserId?.trim() ? { ownerUserId: input.ownerUserId.trim() } : {}),
    });
    logEvolutionLoop("evolution.capability.gap_recorded", {
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      tenantId: input.tenantId ?? null,
      surfaceId: refreshed.surfaceId,
      taskId: refreshed.proposalId,
      reason: normalized,
    });
    return {
      recorded: true,
      deduped: false,
      metricOnly: false,
      proposalId: refreshed.proposalId,
      proposal: refreshed,
    };
  }

  const metrics = skillMetricSet();
  const createdAt = new Date(now).toISOString();
  const proposal = plane.registerProposal(
    {
      schemaVersion: 2,
      proposalId,
      sourceEvidenceRefs: [evidence.evidenceId],
      sourceMechanismRef: `capability-gap:${input.category}`,
      target: { domain: "capability", skillId: skillIdForGap(input, id) },
      candidateRef,
      surfaceId: surfaceForCategory(input.category),
      expectedEffects: [metrics.primary, ...metrics.guardrails],
      riskLevel: "low",
      // enterprise ceiling matches createDelegationEvolutionInspector ceilingFromGrant
      confidentialityScope: "enterprise",
      tenantScope,
      grantId,
      status: "DISCOVERED",
      createdAt,
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      kind: "capability-gap",
      category: input.category,
      reason: normalized,
      detail: input.detail?.trim() || null,
      sessionKey: input.sessionKey?.trim() || null,
      chatType: input.chatType?.trim() || null,
      userLanguageSummary: input.userLanguageSummary?.trim() || null,
      agentId: input.agentId?.trim() || null,
      tenantId: tenantScope,
      ownerUserId: input.ownerUserId?.trim() || null,
      lifecycle: "open",
      explicitMarker,
      sourceKind,
      occurrenceCount: 1,
      draftSkillId: null,
      governanceProposalId: null,
      triageTag: null,
    },
  );

  logEvolutionLoop("evolution.capability.gap_recorded", {
    runId: input.runId ?? null,
    agentId: input.agentId ?? null,
    tenantId: input.tenantId ?? null,
    surfaceId: proposal.surfaceId,
    taskId: proposal.proposalId,
    reason: normalized,
  });

  return {
    recorded: true,
    deduped: false,
    metricOnly: false,
    proposalId: proposal.proposalId,
    proposal,
  };
}

export type CapabilityGapCandidatePayload = {
  kind?: string;
  category?: string;
  reason?: string;
  detail?: string | null;
  sessionKey?: string | null;
  chatType?: string | null;
  userLanguageSummary?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  ownerUserId?: string | null;
  lifecycle?: string;
  explicitMarker?: boolean;
  sourceKind?: CapabilityGapSourceKind;
  occurrenceCount?: number;
  draftSkillId?: string | null;
  governanceProposalId?: string | null;
  /** Operator triage tag; perception gaps use "perception-triage" (see listCapabilityGapBacklog / evolution.proposals.list). */
  triageTag?: string | null;
  resolvedAt?: string;
  resolvedBy?: string;
  usageRunId?: string | null;
  linkedVerifiedAt?: string | null;
  /** Real verification event id (skill review publish / gov approve). */
  verificationEventId?: string | null;
  /**
   * Optional rich trajectory for skill-precipitation (multi-step recipe drafts).
   * When absent, actSkill still writes a partial draft stub.
   */
  trajectory?: {
    whenToUse?: string | null;
    nameHint?: string | null;
    steps?: Array<string | { instruction: string; tools?: string[] }> | null;
    redLines?: string[] | null;
    acceptance?: string[] | null;
    failureModes?: string[] | null;
    toolsUsed?: string[] | null;
    userCorrections?: string[] | null;
    succeeded?: boolean | null;
    sourceEvidenceRefs?: string[] | null;
    detail?: string | null;
    knownEphemeralParams?: string[] | null;
  } | null;
  steps?: Array<string | { instruction: string; tools?: string[] }> | null;
  redLines?: string[] | null;
  acceptance?: string[] | null;
  failureModes?: string[] | null;
  toolsUsed?: string[] | null;
  userCorrections?: string[] | null;
  succeeded?: boolean | null;
  sourceEvidenceRefs?: string[] | null;
};

/** True when linked draft skill passed review (approved|published). */
export function isLinkedSkillReviewVerified(draftSkillId: string | null | undefined): boolean {
  const id = draftSkillId?.trim();
  if (!id) {
    return false;
  }
  try {
    const detail = getPersonalSkillAssetDetail(id);
    return isSkillLifecycleVerifiedEquivalent(detail.lifecycle);
  } catch {
    return false;
  }
}

/** True when governance proposal is approved/installed (registry active). */
export function isLinkedToolGovernanceVerified(
  governanceProposalId: string | null | undefined,
): boolean {
  const id = governanceProposalId?.trim();
  if (!id) {
    return false;
  }
  try {
    const proposal = listGovernanceProposals().find((row) => row.proposalId === id);
    if (!proposal) {
      return false;
    }
    if (proposal.status === "approved") {
      return true;
    }
    if (proposal.resolvedManifestId) {
      const entry = getRegistryEntry(proposal.resolvedManifestId);
      return Boolean(entry && entry.lifecycleState === "active");
    }
    return false;
  } catch {
    return false;
  }
}

function resolveLinkedVerification(candidate: CapabilityGapCandidatePayload | undefined): {
  verified: boolean;
  verificationEventId: string | null;
} {
  const category = candidate?.category ?? "skill";
  if (category === "tool") {
    const govId = candidate?.governanceProposalId ?? null;
    if (isLinkedToolGovernanceVerified(govId)) {
      return {
        verified: true,
        verificationEventId: govId ? `gov-approved:${govId}` : null,
      };
    }
    return { verified: false, verificationEventId: null };
  }
  if (category === "skill") {
    const draftId = candidate?.draftSkillId ?? null;
    if (isLinkedSkillReviewVerified(draftId)) {
      return {
        verified: true,
        verificationEventId: draftId ? `skill-review:${draftId}:published` : null,
      };
    }
    return { verified: false, verificationEventId: null };
  }
  // perception: no installable artifact — never auto-verify via draft shortcut
  return { verified: false, verificationEventId: null };
}

/**
 * Close a capability-gap only when its linked skill/install is verified-equivalent
 * AND a later successful run actually used that skill/tool. Uses legal transitions
 * (suggest if still DISCOVERED) + ledger. Never writes REJECTED.
 */
export function resolveCapabilityGapAfterVerifiedUsage(input: {
  proposalId: string;
  plane?: EvolutionControlPlane;
  principalRef?: string;
  trustedTenantId?: string | null;
  usedToolOrSkillIds?: readonly string[];
  runId?: string | null;
  nowMs?: number;
  /** Test/helper: treat linked artifact as already verified. */
  linkedVerified?: boolean;
}): { closed: boolean; reason: string } {
  const plane = input.plane ?? ensureEvolutionControlPlaneStarted();
  const proposal = plane.getProposal(input.proposalId);
  if (!proposal || !proposal.sourceMechanismRef.startsWith("capability-gap:")) {
    return { closed: false, reason: "not_a_capability_gap" };
  }
  if (capabilityGapLifecycle(proposal.status) === "wont_fix") {
    return { closed: false, reason: "already_terminal" };
  }
  if (input.trustedTenantId != null) {
    if (!proposal.tenantScope || proposal.tenantScope !== input.trustedTenantId) {
      return { closed: false, reason: "tenant_mismatch" };
    }
  }
  const candidate = plane.getCandidate(proposal.candidateRef)?.payload as
    | CapabilityGapCandidatePayload
    | undefined;
  if (candidate?.lifecycle === "resolved") {
    return { closed: false, reason: "already_resolved" };
  }

  const draftId = candidate?.draftSkillId?.trim() || null;
  const govId = candidate?.governanceProposalId?.trim() || null;
  const used = (input.usedToolOrSkillIds ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const live = resolveLinkedVerification(candidate);
  // Explicit test override only — production never treats draft id as verified.
  const linkedVerified =
    input.linkedVerified === true || Boolean(candidate?.linkedVerifiedAt) || live.verified;

  const usageHit =
    used.length > 0 &&
    Boolean(
      (draftId &&
        used.some((u) => u === draftId.toLowerCase() || u.includes(draftId.toLowerCase()))) ||
      (govId && used.some((u) => u === govId.toLowerCase() || u.includes(govId.toLowerCase()))) ||
      (candidate?.detail && used.some((u) => u.includes(String(candidate.detail).toLowerCase()))),
    );

  if (!linkedVerified) {
    return { closed: false, reason: "linked_not_verified" };
  }
  if (!usageHit) {
    return { closed: false, reason: "usage_not_observed" };
  }

  const verificationEventId =
    live.verificationEventId ??
    candidate?.verificationEventId ??
    (draftId ? `skill-review:${draftId}` : govId ? `gov-approved:${govId}` : null);

  let current = proposal;
  if (current.status === "DISCOVERED") {
    try {
      current = plane.suggestProposal({
        commandId: `gap-resolve-suggest:${current.proposalId}:${input.runId ?? randomUUID()}`,
        proposalId: current.proposalId,
        principalRef: input.principalRef ?? "system:capability-gap-consumer",
        trustedTenantId: input.trustedTenantId ?? current.tenantScope,
      });
    } catch (err) {
      return { closed: false, reason: `suggest_failed:${String(err)}` };
    }
  }

  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  // Proposal stays at legal status (typically SUGGESTED); full VERIFIED requires
  // experiment/apply grants we intentionally do not hold. Closure = lifecycle
  // resolved + ledger verification.completed with the real verification event id.
  plane.registerCandidate(current.candidateRef, {
    ...candidate,
    lifecycle: "resolved",
    resolvedAt: nowIso,
    resolvedBy: "verified_usage",
    usageRunId: input.runId?.trim() || null,
    linkedVerifiedAt: candidate?.linkedVerifiedAt ?? nowIso,
    verificationEventId,
  });

  try {
    plane.ledger.append({
      eventId: `led:gap-resolve:${current.proposalId}:${verificationEventId ?? input.runId ?? nowIso}`,
      type: "verification.completed",
      timestamp: nowIso,
      proposalId: current.proposalId,
      target: current.target,
      surfaceId: current.surfaceId,
      tenantScope: current.tenantScope,
      principalRef: input.principalRef ?? "system:capability-gap-consumer",
      grantId: current.grantId,
      evidenceRefs: [
        ...current.sourceEvidenceRefs,
        ...(verificationEventId ? [verificationEventId] : []),
        ...(input.runId?.trim() ? [`usage-run:${input.runId.trim()}`] : []),
        ...(draftId ? [`draft-skill:${draftId}`] : []),
        ...(govId ? [`gov-proposal:${govId}`] : []),
      ],
    });
  } catch {
    // ledger append best-effort for tests with partial mocks
  }

  logEvolutionLoop("evolution.capability.gap_recorded", {
    runId: input.runId ?? null,
    agentId: candidate?.agentId ?? null,
    tenantId: current.tenantScope,
    surfaceId: current.surfaceId,
    taskId: current.proposalId,
    reason: "resolved_verified_usage",
  });

  return { closed: true, reason: "resolved_verified_usage" };
}

/**
 * @deprecated Reply-path blanket close. Kept as a no-op that never writes REJECTED.
 * Real closure is resolveCapabilityGapAfterVerifiedUsage.
 */
export function resolveCapabilityGapsForSuccessfulRun(_input: {
  sessionKey?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  reason?: string | null;
  plane?: EvolutionControlPlane;
  nowMs?: number;
  usedToolOrSkillIds?: readonly string[];
}): { closed: string[] } {
  // Intentionally a no-op: unrelated successful replies must not close gaps.
  return { closed: [] };
}

/** Try to close SUGGESTED gaps for this tenant/agent when usage matches linked drafts. */
export function tryResolveCapabilityGapsFromUsage(input: {
  tenantId?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  runId?: string | null;
  usedToolOrSkillIds?: readonly string[];
  plane?: EvolutionControlPlane;
  nowMs?: number;
}): { closed: string[] } {
  const plane = input.plane ?? ensureEvolutionControlPlaneStarted();
  const tenant = input.tenantId?.trim() || null;
  const agent = input.agentId?.trim() || null;
  const used = input.usedToolOrSkillIds ?? [];
  if (used.length === 0) {
    return { closed: [] };
  }
  // Require tenant scoping — never match globally without tenant.
  if (!tenant) {
    return { closed: [] };
  }
  const closed: string[] = [];
  for (const proposal of plane.listProposals()) {
    if (!proposal.sourceMechanismRef.startsWith("capability-gap:")) {
      continue;
    }
    if (proposal.tenantScope !== tenant) {
      continue;
    }
    const candidate = plane.getCandidate(proposal.candidateRef)?.payload as
      | CapabilityGapCandidatePayload
      | undefined;
    if (candidate?.lifecycle === "resolved") {
      continue;
    }
    if (agent && candidate?.agentId && candidate.agentId !== agent) {
      continue;
    }
    const draftId = candidate?.draftSkillId?.trim();
    const govId = candidate?.governanceProposalId?.trim();
    const detail = candidate?.detail?.trim()?.toLowerCase();
    const hit = used.some((u) => {
      const n = u.trim().toLowerCase();
      if (!n) {
        return false;
      }
      if (draftId && (n === draftId.toLowerCase() || n.includes(draftId.toLowerCase()))) {
        return true;
      }
      if (govId && (n === govId.toLowerCase() || n.includes(govId.toLowerCase()))) {
        return true;
      }
      if (detail && n.includes(detail)) {
        return true;
      }
      return false;
    });
    if (!hit) {
      continue;
    }
    // linkedVerified is derived inside resolve from real skill review / gov approval — never Boolean(draftId).
    const result = resolveCapabilityGapAfterVerifiedUsage({
      proposalId: proposal.proposalId,
      plane,
      trustedTenantId: tenant,
      usedToolOrSkillIds: used,
      runId: input.runId,
      nowMs: input.nowMs,
    });
    if (result.closed) {
      closed.push(proposal.proposalId);
    }
  }
  return { closed };
}

export function isSkillLifecycleVerifiedEquivalent(lifecycle: string | null | undefined): boolean {
  return Boolean(lifecycle && VERIFIED_EQUIVALENT_SKILL_LIFECYCLES.has(lifecycle));
}

/** List capability-gap backlog items currently visible on the plane. */
/**
 * Operator/diagnosis listing for capability-gap backlog (including perception triage).
 * Perception gaps carry triageTag "perception-triage" and also appear on
 * evolution.proposals.list (sourceMechanismRef capability-gap:perception).
 */
export function listCapabilityGapBacklog(plane?: EvolutionControlPlane): Array<{
  proposalId: string;
  status: string;
  lifecycle: CapabilityGapLifecycle;
  category: string;
  reason: string | null;
  sessionKey: string | null;
  agentId: string | null;
  tenantId: string | null;
  draftSkillId: string | null;
  governanceProposalId: string | null;
  triageTag: string | null;
  ownerUserId: string | null;
}> {
  const p = plane ?? ensureEvolutionControlPlaneStarted();
  return p
    .listProposals()
    .filter((row) => row.sourceMechanismRef.startsWith("capability-gap:"))
    .map((row) => {
      const payload = p.getCandidate(row.candidateRef)?.payload as
        | CapabilityGapCandidatePayload
        | undefined;
      return {
        proposalId: row.proposalId,
        status: row.status,
        lifecycle:
          payload?.lifecycle === "resolved"
            ? ("resolved" as const)
            : capabilityGapLifecycle(row.status),
        category: payload?.category ?? "skill",
        reason: payload?.reason ?? null,
        sessionKey: payload?.sessionKey ?? null,
        agentId: payload?.agentId ?? null,
        tenantId: payload?.tenantId ?? row.tenantScope ?? null,
        draftSkillId: payload?.draftSkillId ?? null,
        governanceProposalId: payload?.governanceProposalId ?? null,
        triageTag: payload?.triageTag ?? null,
        ownerUserId: payload?.ownerUserId ?? null,
      };
    });
}

export function listEmptyReplyGapCountersForConsumer(): Array<{
  key: string;
  tenantId: string;
  agentId: string;
  category: CapabilityGapCategory;
  reason: string;
  count: number;
  lastAt: number;
}> {
  const out: Array<{
    key: string;
    tenantId: string;
    agentId: string;
    category: CapabilityGapCategory;
    reason: string;
    count: number;
    lastAt: number;
  }> = [];
  for (const [key, row] of emptyReplyCounters) {
    const [tenantId, agentId, category, ...reasonParts] = key.split("|");
    if (!tenantId || !agentId || !category) {
      continue;
    }
    out.push({
      key,
      tenantId,
      agentId,
      category: category as CapabilityGapCategory,
      reason: reasonParts.join("|"),
      count: row.count,
      lastAt: row.lastAt,
    });
  }
  return out;
}

export function clearEmptyReplyGapCounter(key: string): void {
  emptyReplyCounters.delete(key);
}
