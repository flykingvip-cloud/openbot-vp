/**
 * delivery-lane/types.ts — DeliveryLane contract (Tip A).
 *
 * Sidecar to Development Supervisor: tip → seal → merge_ready guards.
 * Does NOT replace SupervisedTaskState / TASK_TRANSITIONS.
 * Tip C adds guarded MergePort (lane.requestMerge); still ≠ production cutover.
 * Tip F adds tip/PR events → stage + template library (must-green); orch shadow-only.
 */

/** Delivery stage machine (parallel to supervisor planned→…→accepted). */
export type LaneStage =
  | "drafting"
  | "implementing"
  | "reviewing"
  | "accepting"
  | "merge_ready"
  | "merged"
  | "blocked"
  | "abandoned";

/** Tip B hard-enforces tool policy via mode-policy.ts when accept|review. */
export type LaneMode = "implement" | "review" | "accept" | "merge";

export type LaneSealKind = "implement" | "review" | "accept";

/**
 * Verdict vocabulary for seals. Tip A accepts these strings; UI/API may show raw.
 * REVIEW_* mirrors the independent review agent convention.
 */
export type LaneSealVerdict =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "REVIEW_PASS"
  | "REVIEW_CHANGES_REQUESTED";

/**
 * Evidence package — machine refs only. Do not treat assistant free-text as proof
 * (aligns with progress-ledger I3 / preflight delivery gates).
 */
export interface EvidencePackage {
  /** Evidence class, e.g. "validation-report" | "pr-head" | "command-log". */
  kind: string;
  refs?: Array<{ type: string; value: string }>;
  hashes?: Record<string, string>;
  notes?: string;
}

export type LaneHelperKind = "helper" | "personal_subagent" | "external";

export interface LaneSealIssuer {
  /** Owning / signing bot or agent id. */
  agentId: string;
  /** Optional distinct bot instance id (path-1 cross-bot). */
  botId?: string;
  /** Mode the issuer claims to be in when sealing. */
  mode?: LaneMode;
  /**
   * Tip E: issuer kind. `personal_subagent` MUST NOT issue acceptSeal
   * (分身不可自签验收).
   */
  kind?: LaneHelperKind | "agent";
}

/** Tip E: registered helper on a lane (cap via maxLaneHelpers). */
export interface LaneHelper {
  agentId: string;
  kind: LaneHelperKind;
  attachedAt: string;
  detachedAt?: string;
}

/**
 * A seal bound to a tipSha. Same-origin acceptSeal is `strength: "weak"`
 * unless path-1 cross-bot is configured (then same-origin accept is refused).
 */
export interface LaneSeal {
  kind: LaneSealKind;
  verdict: LaneSealVerdict;
  tipSha: string;
  issuer: LaneSealIssuer;
  /** "weak" = single-bot / same-origin accept; "strong" = cross-bot or Owner-backed. */
  strength: "weak" | "strong";
  /** Optional Owner co-sign for weak acceptSeal hardening (Tip A field only). */
  ownerCosign?: { userId: string; at: string };
  evidence?: EvidencePackage;
  issuedAt: string;
  invalidatedAt?: string;
  invalidateReason?: string;
}

export interface DeliveryLane {
  laneId: string;
  templateId: string;
  /** Optional link to a SupervisedTask (projection pointer target). */
  taskId?: string;
  stage: LaneStage;
  /** Tip commit SHA the lane is currently bound to. */
  tipSha?: string;
  /** Observed head SHA for match-head checks (may equal tipSha). */
  headSha?: string;
  prNumber?: number;
  mode: LaneMode;
  implementSeal?: LaneSeal;
  acceptSeal?: LaneSeal;
  reviewSeals?: LaneSeal[];
  /**
   * When true, acceptSeal.issuer must differ from lane.agentId (path-1).
   * Default false → single-bot weak acceptSeal allowed.
   */
  path1CrossBotEnabled: boolean;
  /** Owning bot/agent for same-origin checks. */
  agentId?: string;
  /** Tip C: last successful MergePort invocation (audit). */
  lastMerge?: {
    at: string;
    method: "squash" | "merge" | "rebase";
    prNumber: number;
    tipSha: string;
  };
  /** Tip E: concurrent helpers (active = no detachedAt); cap maxLaneHelpers. */
  helpers?: LaneHelper[];
  /** Tip F: last applied tip/PR board event (webhook/internal). */
  lastEvent?: {
    kind: string;
    at: string;
    source: "internal" | "webhook" | "test";
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight pointer embedded on SupervisedTask — never drives TASK_TRANSITIONS.
 * UI reads this for the 「交付看板」panel.
 */
export interface LaneProjection {
  laneId: string;
  stage: LaneStage;
  tipSha?: string;
  headSha?: string;
  prNumber?: number;
  /** e.g. ["implementSeal", "acceptSeal"] or ["match-head"]. */
  missingKeys: string[];
  /** One-line recall summary from lane.focus. */
  focusSummary?: string;
  acceptSealStrength?: "weak" | "strong";
  /** True when acceptSeal is same-origin weak gate. */
  acceptSealWeak?: boolean;
}

export type DeliveryLaneCiPolicy = {
  /** Hosted CI billing blocked → do not treat paid hosted checks as sole merge gate. */
  hostedCiBillingBlocked: boolean;
  /** Local must-green required before merge_ready / merge. */
  mustGreenLocally: boolean;
  /** Human-readable strategy (zh/en). */
  strategy: string;
};

export type DeliveryLaneTemplate = {
  id: string;
  label: string;
  description: string;
  /** Initial mode after attach. */
  initialMode: LaneMode;
  /** Tip F: CI / must-green policy from template library JSON. */
  ciPolicy?: DeliveryLaneCiPolicy;
  /** Tip F: optional gates declared by template (documentation + attach metadata). */
  gates?: string[];
  cutoverNote?: string;
};
