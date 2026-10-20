/**
 * Durable persistence for AI workforce governance domain objects.
 * Wraps the in-memory prototype without creating a parallel algorithm (V2).
 * JSON documents under CONFIG_DIR/evolution-governance/ (class=D, restart-safe).
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

const ROOT = path.join(CONFIG_DIR, "evolution-governance");

export type GovernanceEffectBaselineMetrics = {
  skillSuccessRate: number | null;
  skillUsageTotal: number;
  invocationCount7d: number;
  tokenConsumption7d: number;
};

export type GovernanceEffectBeforeSnapshot = {
  action: string;
  originalStates?: Record<string, string>;
  originalPriorities?: Record<string, number>;
  changedBindingIds?: string[];
  redirectTargetAgentId?: string;
};

/** Post-pause effect verification window (detect → action → verify → resume/hold). */
export type GovernanceEffectVerification = {
  id: string;
  assetId: string;
  runtimeAgentId: string;
  reason: string;
  pausedAt: string;
  /** ISO time after which the next tick remeasures and may resume. */
  verifyAfterAt: string;
  baseline: GovernanceEffectBaselineMetrics;
  status: "open" | "resumed" | "held" | "escalated";
  closedAt?: string;
  outcomeNote?: string;
  /** Trusted Evolution Control binding. Absent on legacy tick windows. */
  proposalId?: string;
  experimentId?: string;
  applicationId?: string;
  tenantId?: string;
  action?: string;
  commandId?: string;
  domainReceiptRef?: string;
  openedAt?: string;
  beforeSnapshot?: GovernanceEffectBeforeSnapshot;
  treatment?: GovernanceEffectBaselineMetrics;
  baselineWindow?: { startedAt: string; endedAt: string };
  treatmentWindow?: { startedAt: string; endedAt: string };
  /** Trusted close decision id. Absent on legacy/untrusted status writes. */
  decisionId?: string;
  /** Frozen last instant an event may join this window. */
  observationUntil?: string;
  observationStartedAt?: string;
  nextEvaluateAt?: string;
  evaluationIntervalMs?: number;
  evaluationCount?: number;
  lastEvaluationAt?: string;
  lastEvaluationReceiptRef?: string;
  minimumSampleSize?: number;
  modelRevision?: string;
  configRevision?: string;
  /** Invocation IDs already consumed as evaluation evidence. */
  consumedInvocationIds?: string[];
  lastTelemetryFingerprint?: string;
  lastCostFingerprint?: string;
  lastHealth?: string;
  lastSeenActionId?: string;
};

export type GovernanceRuntimeVerifierRecord = {
  verifierId: string;
  tenantId: string;
  applicationId?: string;
  /** Credential reference only. Never a caller-chosen long-lived plaintext token. */
  credentialRef?: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedDecisionKinds?: Array<"resume" | "hold" | "escalate">;
};

export type GovernanceEffectObservationKind =
  | "runtime_probe"
  | "skill_invocation"
  | "auto_resume_decision"
  | "human_hold_decision"
  | "escalation_decision";

export type GovernanceEffectCohortRef = "baseline" | "control" | "treatment";

/**
 * One independent statistical sample inside an Effect Window.
 * Window status is a governance conclusion, not a sample.
 */
export type GovernanceEffectObservationEvent = {
  eventId: string;
  effectVerificationId: string;
  runtimeAgentId: string;
  proposalId?: string;
  experimentId?: string;
  applicationId?: string;
  tenantId?: string;
  occurredAt: string;
  kind: GovernanceEffectObservationKind;
  intervention?: boolean;
  skillSuccess?: boolean;
  latencyMs?: number;
  tokenCost?: number;
  deliveryFailed?: boolean;
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
  sourceReceiptRef: string;
  cohortRef?: GovernanceEffectCohortRef;
  modelRevision?: string;
  configRevision?: string;
  evaluationCycleId?: string;
  metricsSnapshotRef?: string;
};

export type GovernanceEffectDecision = {
  decisionId: string;
  effectVerificationId: string;
  decidedBy: "governance_tick" | "authorized_operator" | "runtime_verifier";
  decision: "resume" | "hold" | "escalate";
  evidenceRefs: string[];
  sourceReceiptRef: string;
  decidedAt: string;
  principalRef?: string;
  grantId?: string;
};

/** Durable stages for skill auto install (retry stuck publish/finalize/install). */
export type SkillAutoInstallStage =
  | "pending_publish"
  | "draft_created"
  | "finalized"
  | "installed"
  | "failed"
  | "cancelled";

export type SkillAutoInstallJob = {
  candidateId: string;
  agentId: string;
  /**
   * Immutable authority tenant snapshot at job creation (membership enterprise id).
   * Used for ACL when the candidate record is missing (cancel / retry / snapshot).
   */
  tenantId: string | null;
  skillId?: string;
  stage: SkillAutoInstallStage;
  lastError?: string;
  /** Explicit ownership: only jobs with this flag are advanced by skill-auto. */
  autoInstallIntent: true;
  /** Who requested enrollment (operator). */
  enrolledBy?: string | null;
  /** Policy snapshot at job creation (re-checked on retry). */
  policySnapshot?: {
    policyVersion: string;
    minIndependent: number;
    minConfidence: number;
    minSuccessRate: number;
    capturedAt: number;
  } | null;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type GovernancePersistedState = {
  assets: unknown[];
  anomalies: unknown[];
  actions: unknown[];
  metrics: unknown[];
  /** Open/closed pause effect windows for resume/hold decisions. */
  effectVerifications?: GovernanceEffectVerification[];
  /** Independent observation samples. Not a parallel store. */
  effectObservationEvents?: GovernanceEffectObservationEvent[];
  /** Trusted close decisions for effect windows. */
  effectDecisions?: GovernanceEffectDecision[];
  /** Registered runtime verifiers. Capability token is the permission boundary. */
  runtimeVerifiers?: GovernanceRuntimeVerifierRecord[];
  /** Soft throttle snapshots keyed by runtimeAgentId. */
  limits?: Record<string, unknown>;
  /** Traffic redirect intents keyed by source runtimeAgentId. */
  redirects?: Record<string, unknown>;
  /** Pause snapshots keyed by runtimeAgentId (compare-and-restore). */
  pauses?: Record<string, unknown>;
  /** Skill auto install jobs keyed by candidateId (compensating / retry). */
  skillAutoJobs?: Record<string, SkillAutoInstallJob>;
  jobCursor: {
    lastAggregationAt: string | null;
    lastAutoGovAt: string | null;
    lastRunId: string | null;
  };
  killSwitch: boolean;
  updatedAt: string;
};

const DEFAULT_STATE: GovernancePersistedState = {
  assets: [],
  anomalies: [],
  actions: [],
  metrics: [],
  effectVerifications: [],
  effectObservationEvents: [],
  effectDecisions: [],
  runtimeVerifiers: [],
  limits: {},
  redirects: {},
  pauses: {},
  skillAutoJobs: {},
  jobCursor: {
    lastAggregationAt: null,
    lastAutoGovAt: null,
    lastRunId: null,
  },
  killSwitch: false,
  updatedAt: new Date(0).toISOString(),
};

function statePath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "evolution-governance", "state.json");
}

export function readGovernancePersistedState(
  configDir: string = CONFIG_DIR,
): GovernancePersistedState {
  try {
    const filePath = statePath(configDir);
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_STATE, jobCursor: { ...DEFAULT_STATE.jobCursor } };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as GovernancePersistedState;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      effectVerifications: Array.isArray(parsed.effectVerifications)
        ? parsed.effectVerifications
        : [],
      effectObservationEvents: Array.isArray(parsed.effectObservationEvents)
        ? parsed.effectObservationEvents
        : [],
      effectDecisions: Array.isArray(parsed.effectDecisions) ? parsed.effectDecisions : [],
      runtimeVerifiers: Array.isArray(parsed.runtimeVerifiers) ? parsed.runtimeVerifiers : [],
      limits: parsed.limits && typeof parsed.limits === "object" ? parsed.limits : {},
      redirects: parsed.redirects && typeof parsed.redirects === "object" ? parsed.redirects : {},
      pauses: parsed.pauses && typeof parsed.pauses === "object" ? parsed.pauses : {},
      skillAutoJobs:
        parsed.skillAutoJobs && typeof parsed.skillAutoJobs === "object"
          ? parsed.skillAutoJobs
          : {},
      jobCursor: { ...DEFAULT_STATE.jobCursor, ...parsed.jobCursor },
    };
  } catch {
    return { ...DEFAULT_STATE, jobCursor: { ...DEFAULT_STATE.jobCursor } };
  }
}

export function writeGovernancePersistedState(
  state: GovernancePersistedState,
  configDir: string = CONFIG_DIR,
): void {
  const filePath = statePath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next: GovernancePersistedState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  // Hot-path redirect cache must refresh after any state write.
  try {
    const { invalidateGovernanceRedirectCache } =
      require("./redirect-cache.js") as typeof import("./redirect-cache.js");
    invalidateGovernanceRedirectCache();
  } catch {
    // optional
  }
}

export function updateGovernanceJobCursor(
  patch: Partial<GovernancePersistedState["jobCursor"]>,
  configDir: string = CONFIG_DIR,
): GovernancePersistedState {
  const current = readGovernancePersistedState(configDir);
  const next: GovernancePersistedState = {
    ...current,
    jobCursor: { ...current.jobCursor, ...patch },
  };
  writeGovernancePersistedState(next, configDir);
  return next;
}

export function setGovernanceKillSwitch(
  enabled: boolean,
  configDir: string = CONFIG_DIR,
): GovernancePersistedState {
  const current = readGovernancePersistedState(configDir);
  const next = { ...current, killSwitch: enabled };
  writeGovernancePersistedState(next, configDir);
  return next;
}

export function isGovernanceKillSwitchActive(configDir: string = CONFIG_DIR): boolean {
  return readGovernancePersistedState(configDir).killSwitch;
}

export function resolveEvolutionGovernanceRoot(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "evolution-governance");
}

export { ROOT as EVOLUTION_GOVERNANCE_ROOT_DEFAULT };
