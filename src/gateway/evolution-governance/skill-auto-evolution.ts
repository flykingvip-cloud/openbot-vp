/**
 * Skill evolution install assist (opt-in, fail-closed).
 *
 * Safe defaults:
 * - OPENBOT_SKILL_AUTO_EVOLUTION unset / invalid / off → disabled
 * - Mutations require governance mode === "auto" AND skill-auto explicitly on
 * - Never auto-approves candidates (human RPC / operator.approvals only)
 * - Only advances jobs with explicit autoInstallIntent ownership
 * - Never scans historical published drafts that lack a skillAutoJobs record
 *
 * Env:
 * - OPENBOT_SKILL_AUTO_EVOLUTION=on|off  (default: off)
 * - OPENBOT_SKILL_AUTO_ALLOW_AGENTS=id1,id2  (optional allowlist)
 * - OPENBOT_SKILL_AUTO_MIN_* thresholds (re-checked on every retry)
 */

import {
  captureDefaultApprovalPolicySnapshot,
  clearPatternAutoInstallIntent,
  getPatternCandidate,
  listPatternCandidates,
  PATTERN_APPROVAL_POLICY_VERSION,
  publishPatternCandidateAsDraftSkill,
  setPatternAutoInstallIntent,
  type PatternCandidate,
} from "../pattern-detection/index.js";
import { ensureSkillExecutionBindingHooksRegistered } from "../skill-execution-binding/index.js";
import {
  finalizeDraftSkill,
  getPersonalSkillAssetDetail,
  installSkillToRobotAsset,
  listRobotSkillAssets,
  toggleRobotSkillAsset,
} from "../skill-lifecycle-store.js";
import { observeSkillAutoConsumption } from "./application-consumption-shadow.js";
import { recordSkillAutoApplicationShadow } from "./control-plane-application-shadow.js";
import {
  getEvolutionGovernanceMode,
  isEvolutionAutoRuntimeMutationEnabled,
  isEvolutionGovernancePipelineEnabled,
} from "./mode.js";
import {
  isGovernanceKillSwitchActive,
  readGovernancePersistedState,
  writeGovernancePersistedState,
  type SkillAutoInstallJob,
  type SkillAutoInstallStage,
} from "./persistent-store.js";

export type SkillAutoEvolutionResult = {
  enabled: boolean;
  mutationsAllowed: boolean;
  scanned: number;
  /** Always 0 — approve is human-only. */
  approved: number;
  published: number;
  installed: number;
  skipped: number;
  retried: number;
  cancelled: number;
  errors: Array<{ candidateId: string; error: string }>;
  skillIds: string[];
  jobs: SkillAutoInstallJob[];
};

const DEFAULT_MIN_INDEPENDENT = 3;
const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_MIN_SUCCESS_RATE = 0.7;

const TERMINAL_STAGES: ReadonlySet<SkillAutoInstallStage> = new Set(["installed", "cancelled"]);

let skillAutoOverride: boolean | null = null;

export function setSkillAutoEvolutionForTests(enabled: boolean | null): void {
  skillAutoOverride = enabled;
}

export function isSkillAutoEvolutionEnabled(): boolean {
  if (skillAutoOverride != null) {
    return skillAutoOverride;
  }
  const raw = (process.env.OPENBOT_SKILL_AUTO_EVOLUTION ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }
  return false;
}

export function isSkillAutoEvolutionMutationAllowed(): boolean {
  return (
    isSkillAutoEvolutionEnabled() &&
    isEvolutionAutoRuntimeMutationEnabled() &&
    isEvolutionGovernancePipelineEnabled() &&
    !isGovernanceKillSwitchActive()
  );
}

function minIndependent(): number {
  const n = Number(process.env.OPENBOT_SKILL_AUTO_MIN_INDEPENDENT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MIN_INDEPENDENT;
}

function minConfidence(): number {
  const n = Number(process.env.OPENBOT_SKILL_AUTO_MIN_CONFIDENCE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_MIN_CONFIDENCE;
}

function minSuccessRate(): number {
  const n = Number(process.env.OPENBOT_SKILL_AUTO_MIN_SUCCESS_RATE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_MIN_SUCCESS_RATE;
}

function agentAllowlist(): Set<string> | null {
  const raw = (process.env.OPENBOT_SKILL_AUTO_ALLOW_AGENTS ?? "").trim();
  if (!raw) {
    return null;
  }
  const ids = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function emptyResult(enabled: boolean, mutationsAllowed: boolean): SkillAutoEvolutionResult {
  return {
    enabled,
    mutationsAllowed,
    scanned: 0,
    approved: 0,
    published: 0,
    installed: 0,
    skipped: 0,
    retried: 0,
    cancelled: 0,
    errors: [],
    skillIds: [],
    jobs: [],
  };
}

function readJobs(): Record<string, SkillAutoInstallJob> {
  const jobs = readGovernancePersistedState().skillAutoJobs;
  return jobs && typeof jobs === "object" ? { ...jobs } : {};
}

function writeJobs(jobs: Record<string, SkillAutoInstallJob>): void {
  const state = readGovernancePersistedState();
  writeGovernancePersistedState({ ...state, skillAutoJobs: jobs });
}

function persistJob(jobs: Record<string, SkillAutoInstallJob>, job: SkillAutoInstallJob): void {
  jobs[job.candidateId] = { ...job, updatedAt: new Date().toISOString() };
  writeJobs(jobs);
}

function isAgentAllowed(agentId: string): boolean {
  const allow = agentAllowlist();
  if (!allow) {
    return true;
  }
  return allow.has(agentId);
}

function isInstalledOnAgent(agentId: string, skillId: string): boolean {
  try {
    return listRobotSkillAssets(agentId).some((r) => r.id === skillId && r.enabled);
  } catch {
    return false;
  }
}

function extractSkillIdFromSummary(summary: string): string | null {
  const m = summary.match(/\(skill:([^)]+)\)\s*$/);
  return m?.[1]?.trim() || null;
}

/** Current live thresholds (may be stricter than approval snapshot). */
function meetsCurrentQualityGates(
  candidate: PatternCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (candidate.independentTaskCount < minIndependent()) {
    return { ok: false, reason: `independentTaskCount < ${minIndependent()}` };
  }
  if (candidate.overallConfidence < minConfidence()) {
    return { ok: false, reason: `confidence < ${minConfidence()}` };
  }
  const sr = candidate.contract?.quality?.successRate;
  if (typeof sr === "number" && sr < minSuccessRate()) {
    return { ok: false, reason: `successRate < ${minSuccessRate()}` };
  }
  return { ok: true };
}

/**
 * Re-validate authorization before any stage advance / retry.
 * Ownership invariants (fail-closed → cancelled / ownership-mismatch):
 *   job.candidateId === candidate.candidateId
 *   job.agentId === candidate.agentId
 *   job.tenantId === candidate.tenantId  (immutable snapshot must match live record)
 */
function revalidateJobAuthorization(
  job: SkillAutoInstallJob,
  candidate: PatternCandidate | null,
): { ok: true } | { ok: false; reason: string } {
  if (!job.autoInstallIntent) {
    return { ok: false, reason: "job-missing-auto-install-intent" };
  }
  if (job.stage === "cancelled") {
    return { ok: false, reason: "job-cancelled" };
  }
  if (!candidate) {
    return { ok: false, reason: "candidate-not-found" };
  }
  // Immutable ownership snapshot must still match the live candidate.
  if (job.candidateId !== candidate.candidateId) {
    return { ok: false, reason: "ownership-mismatch" };
  }
  if (job.agentId !== candidate.agentId) {
    return { ok: false, reason: "ownership-mismatch" };
  }
  const jobTenant = job.tenantId ?? null;
  const candTenant = candidate.tenantId ?? null;
  if (jobTenant !== candTenant) {
    return { ok: false, reason: "ownership-mismatch" };
  }
  if (candidate.status === "rejected") {
    return { ok: false, reason: "candidate-rejected" };
  }
  if (candidate.status !== "approved" && candidate.status !== "published") {
    return { ok: false, reason: `candidate-status-${candidate.status}` };
  }
  // Intent cleared after enroll but before publish
  if (!candidate.autoInstallIntent && job.stage === "pending_publish") {
    return { ok: false, reason: "auto-install-intent-cleared" };
  }
  if (!isAgentAllowed(job.agentId) || !isAgentAllowed(candidate.agentId)) {
    return { ok: false, reason: "agent-not-allowlisted" };
  }
  // Require full approval audit: real approvedBy principal + approvedAt + policy snapshot.
  // Any missing field fails closed (client-forged params are never trusted at RPC layer).
  const approvedBy = typeof candidate.approvedBy === "string" ? candidate.approvedBy.trim() : "";
  if (
    (candidate.status === "approved" || candidate.status === "published") &&
    (!approvedBy || !candidate.approvedAt || !candidate.approvalPolicySnapshot)
  ) {
    return { ok: false, reason: "approval-audit-missing" };
  }
  const live = meetsCurrentQualityGates(candidate);
  if (!live.ok) {
    return live;
  }
  const snap = job.policySnapshot ?? candidate.approvalPolicySnapshot;
  if (snap && snap.policyVersion !== PATTERN_APPROVAL_POLICY_VERSION) {
    return { ok: false, reason: "approval-policy-version-mismatch" };
  }
  return { ok: true };
}

function observePendingSkillAutoInstalls(): SkillAutoEvolutionResult {
  const jobs = readJobs();
  const result = emptyResult(true, false);
  const observed = new Set<string>();
  const observe = (input: {
    candidateId: string;
    agentId: string;
    tenantId: string | null;
    skillId: string;
    approvalAuditRef: string;
  }) => {
    const commandId = `skill-auto-install:${input.candidateId}:${input.skillId}`;
    if (observed.has(commandId)) {
      return;
    }
    observed.add(commandId);
    try {
      recordSkillAutoApplicationShadow({
        commandId,
        agentId: input.agentId,
        skillId: input.skillId,
        liveExecuted: false,
      });
    } catch {
      // The authoritative consumption store below latches persistence failures.
    }
    observeSkillAutoConsumption({
      commandId,
      agentId: input.agentId,
      skillId: input.skillId,
      autoInstallIntent: true,
      approvalAuditRef: input.approvalAuditRef,
      liveExecuted: false,
      mode: getEvolutionGovernanceMode(),
      killSwitch: isGovernanceKillSwitchActive(),
      tenantScope: input.tenantId,
    });
    result.scanned += 1;
    result.skipped += 1;
    result.skillIds.push(input.skillId);
  };

  for (const job of Object.values(jobs)) {
    if (TERMINAL_STAGES.has(job.stage) || !job.autoInstallIntent) {
      continue;
    }
    const candidate = getPatternCandidate(job.candidateId);
    const authorization = revalidateJobAuthorization(job, candidate);
    if (!authorization.ok) {
      result.errors.push({ candidateId: job.candidateId, error: authorization.reason });
      continue;
    }
    const skillId =
      job.skillId ??
      candidate?.publishedSkillId ??
      (candidate ? extractSkillIdFromSummary(candidate.suggestedSummary) : null);
    if (!skillId) {
      continue;
    }
    observe({
      candidateId: job.candidateId,
      agentId: job.agentId,
      tenantId: job.tenantId,
      skillId,
      approvalAuditRef: job.enrolledBy ?? candidate?.approvedBy ?? "",
    });
  }

  for (const candidate of listPatternCandidates({ status: "approved" })) {
    if (!candidate.autoInstallIntent || !isAgentAllowed(candidate.agentId)) {
      continue;
    }
    const skillId =
      candidate.publishedSkillId ?? extractSkillIdFromSummary(candidate.suggestedSummary);
    if (!skillId) {
      continue;
    }
    observe({
      candidateId: candidate.candidateId,
      agentId: candidate.agentId,
      tenantId: candidate.tenantId ?? null,
      skillId,
      approvalAuditRef: candidate.approvedBy ?? "",
    });
  }

  result.jobs = Object.values(jobs);
  return result;
}

function advanceJob(
  jobs: Record<string, SkillAutoInstallJob>,
  job: SkillAutoInstallJob,
  result: SkillAutoEvolutionResult,
): SkillAutoInstallJob {
  if (TERMINAL_STAGES.has(job.stage)) {
    return job;
  }

  const candidate = getPatternCandidate(job.candidateId);
  const auth = revalidateJobAuthorization(job, candidate);
  if (!auth.ok) {
    const cancelled: SkillAutoInstallJob = {
      ...job,
      stage: "cancelled",
      lastError: auth.reason,
      cancelledAt: new Date().toISOString(),
      cancelReason: auth.reason,
    };
    persistJob(jobs, cancelled);
    result.cancelled += 1;
    result.errors.push({ candidateId: job.candidateId, error: auth.reason });
    return cancelled;
  }

  let current: SkillAutoInstallJob = { ...job };
  const agentId = current.agentId;

  try {
    if (current.stage === "pending_publish" || (current.stage === "failed" && !current.skillId)) {
      if (!current.skillId) {
        const published = publishPatternCandidateAsDraftSkill({
          candidateId: current.candidateId,
          sourceAgentId: agentId,
        });
        current = {
          ...current,
          skillId: published.skillId,
          stage: "draft_created",
          lastError: undefined,
        };
        result.published += 1;
        result.skillIds.push(published.skillId);
        persistJob(jobs, current);
      }
    } else if (current.stage === "failed" && current.skillId) {
      current = { ...current, stage: "draft_created", lastError: undefined };
      persistJob(jobs, current);
    }

    if (current.stage === "draft_created" && current.skillId) {
      try {
        const detail = getPersonalSkillAssetDetail(current.skillId);
        if (detail.lifecycle === "draft") {
          finalizeDraftSkill(current.skillId);
        }
        current = { ...current, stage: "finalized", lastError: undefined };
        persistJob(jobs, current);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        current = { ...current, stage: "failed", lastError: msg };
        persistJob(jobs, current);
        result.errors.push({ candidateId: current.candidateId, error: msg });
        return current;
      }
    }

    if (current.stage === "finalized" && current.skillId) {
      try {
        if (!isInstalledOnAgent(agentId, current.skillId)) {
          installSkillToRobotAsset({
            agentId,
            skillId: current.skillId,
          });
          recordSkillAutoApplicationShadow({
            commandId: `skill-auto-install:${current.candidateId}:${current.skillId}`,
            agentId,
            skillId: current.skillId,
            liveExecuted: true,
          });
          observeSkillAutoConsumption({
            commandId: `skill-auto-install:${current.candidateId}:${current.skillId}`,
            agentId,
            skillId: current.skillId,
            autoInstallIntent: current.autoInstallIntent,
            approvalAuditRef: current.enrolledBy ?? "",
            liveExecuted: true,
            mode: getEvolutionGovernanceMode(),
            killSwitch: isGovernanceKillSwitchActive(),
            tenantScope: current.tenantId,
          });
        }
        try {
          toggleRobotSkillAsset({
            agentId,
            skillId: current.skillId,
            enabled: true,
          });
        } catch {
          // install may already enable
        }
        current = { ...current, stage: "installed", lastError: undefined };
        persistJob(jobs, current);
        result.installed += 1;
        if (current.skillId && !result.skillIds.includes(current.skillId)) {
          result.skillIds.push(current.skillId);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        current = { ...current, stage: "failed", lastError: msg };
        persistJob(jobs, current);
        result.errors.push({ candidateId: current.candidateId, error: msg });
        return current;
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/already published/i.test(msg) && !current.skillId) {
      const skillId =
        candidate?.publishedSkillId ??
        (candidate ? extractSkillIdFromSummary(candidate.suggestedSummary) : null);
      if (skillId) {
        current = {
          ...current,
          skillId,
          stage: "draft_created",
          lastError: undefined,
        };
        persistJob(jobs, current);
        result.retried += 1;
        return advanceJob(jobs, current, result);
      }
    }
    current = { ...current, stage: "failed", lastError: msg };
    persistJob(jobs, current);
    result.errors.push({ candidateId: current.candidateId, error: msg });
  }

  return current;
}

/**
 * Explicit enrollment: create a skill-auto job for an approved (or already-published-with-intent) candidate.
 * Required before the auto pass will publish/install (unless a job already exists).
 */
export function enrollSkillAutoInstall(params: {
  candidateId: string;
  enrolledBy?: string | null;
}): { ok: true; job: SkillAutoInstallJob } | { ok: false; reason: string } {
  const candidateId = params.candidateId.trim();
  if (!candidateId) {
    return { ok: false, reason: "missing-candidate-id" };
  }
  if (isGovernanceKillSwitchActive()) {
    return { ok: false, reason: "kill-switch" };
  }
  const candidate = getPatternCandidate(candidateId);
  if (!candidate) {
    return { ok: false, reason: "candidate-not-found" };
  }
  if (candidate.status !== "approved" && candidate.status !== "published") {
    return { ok: false, reason: `candidate-not-approved (status=${candidate.status})` };
  }
  const gates = meetsCurrentQualityGates(candidate);
  if (!gates.ok) {
    return { ok: false, reason: gates.reason };
  }
  if (!isAgentAllowed(candidate.agentId)) {
    return { ok: false, reason: "agent-not-allowlisted" };
  }

  const jobs = readJobs();
  const existing = jobs[candidateId];
  if (existing && existing.stage === "installed") {
    return { ok: true, job: existing };
  }
  if (existing && existing.stage !== "cancelled" && !TERMINAL_STAGES.has(existing.stage)) {
    // Backfill immutable tenant snapshot on older jobs missing the field.
    if (existing.tenantId == null && candidate.tenantId) {
      const patched = { ...existing, tenantId: candidate.tenantId };
      persistJob(jobs, patched);
      return { ok: true, job: patched };
    }
    return { ok: true, job: existing };
  }

  const policy = candidate.approvalPolicySnapshot ?? captureDefaultApprovalPolicySnapshot();
  const skillId =
    candidate.publishedSkillId ??
    existing?.skillId ??
    extractSkillIdFromSummary(candidate.suggestedSummary) ??
    undefined;

  // For published candidates enrolling late: only allowed if they already had intent
  // or operator explicitly enrolls now (this call IS the intent).
  const stage: SkillAutoInstallStage = skillId ? "draft_created" : "pending_publish";

  const job: SkillAutoInstallJob = {
    candidateId,
    agentId: candidate.agentId,
    // Immutable tenant snapshot — required for cancel/ACL if candidate is later deleted.
    tenantId: candidate.tenantId ?? existing?.tenantId ?? null,
    skillId,
    stage,
    autoInstallIntent: true,
    enrolledBy: params.enrolledBy?.trim() || null,
    policySnapshot: {
      policyVersion: policy.policyVersion,
      minIndependent: policy.minIndependent,
      minConfidence: policy.minConfidence,
      minSuccessRate: policy.minSuccessRate,
      capturedAt: policy.capturedAt,
    },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  persistJob(jobs, job);
  try {
    setPatternAutoInstallIntent(candidateId, true);
  } catch {
    // best-effort
  }
  return { ok: true, job };
}

/**
 * Human cancel / abort of an auto-install job.
 * Does not uninstall already-installed skills; does not demote published candidates.
 */
export function cancelSkillAutoInstallJob(params: {
  candidateId: string;
  reason?: string;
  cancelledBy?: string | null;
}): { ok: true; job: SkillAutoInstallJob | null } | { ok: false; reason: string } {
  const candidateId = params.candidateId.trim();
  if (!candidateId) {
    return { ok: false, reason: "missing-candidate-id" };
  }
  const jobs = readJobs();
  const job = jobs[candidateId];
  try {
    clearPatternAutoInstallIntent(candidateId);
  } catch {
    // ignore
  }
  if (!job) {
    return { ok: true, job: null };
  }
  if (job.stage === "installed") {
    return { ok: false, reason: "already-installed-cannot-cancel" };
  }
  if (job.stage === "cancelled") {
    return { ok: true, job };
  }
  const next: SkillAutoInstallJob = {
    ...job,
    stage: "cancelled",
    cancelledAt: new Date().toISOString(),
    cancelReason:
      params.reason?.trim() ||
      (params.cancelledBy ? `cancelled-by:${params.cancelledBy}` : "human-cancel"),
    lastError: undefined,
  };
  persistJob(jobs, next);
  return { ok: true, job: next };
}

/**
 * Run one skill-auto pass.
 * - Does not approve candidates.
 * - Only processes owned skillAutoJobs + approved candidates with autoInstallIntent.
 * - Never invents jobs for historical published drafts without enroll.
 */
export function runSkillAutoEvolutionPass(): SkillAutoEvolutionResult {
  const envOn = isSkillAutoEvolutionEnabled();
  if (!envOn) {
    return emptyResult(false, false);
  }

  if (isGovernanceKillSwitchActive()) {
    return {
      ...emptyResult(true, false),
      errors: [{ candidateId: "*", error: "kill-switch" }],
    };
  }
  if (!isEvolutionGovernancePipelineEnabled()) {
    return {
      ...emptyResult(true, false),
      errors: [{ candidateId: "*", error: "governance-mode-off" }],
    };
  }
  if (!isEvolutionAutoRuntimeMutationEnabled()) {
    const observed = observePendingSkillAutoInstalls();
    observed.errors.unshift({
      candidateId: "*",
      error: `mutations-require-governance-auto (mode=${getEvolutionGovernanceMode()})`,
    });
    return observed;
  }

  ensureSkillExecutionBindingHooksRegistered();

  const jobs = readJobs();
  const result = emptyResult(true, true);

  // 1) Advance incomplete owned jobs (re-validate authorization first)
  for (const job of Object.values(jobs)) {
    if (TERMINAL_STAGES.has(job.stage)) {
      continue;
    }
    if (!job.autoInstallIntent) {
      persistJob(jobs, {
        ...job,
        autoInstallIntent: true,
        stage: "cancelled",
        cancelReason: "job-not-owned",
        cancelledAt: new Date().toISOString(),
      });
      result.cancelled += 1;
      continue;
    }
    if (!isAgentAllowed(job.agentId)) {
      result.skipped += 1;
      continue;
    }
    result.retried += 1;
    result.scanned += 1;
    advanceJob(jobs, job, result);
  }

  // 2) Enroll only approved candidates with explicit autoInstallIntent
  const approved = listPatternCandidates({ status: "approved" });
  for (const candidate of approved) {
    result.scanned += 1;
    if (!candidate.autoInstallIntent) {
      result.skipped += 1;
      continue;
    }
    if (!isAgentAllowed(candidate.agentId)) {
      result.skipped += 1;
      continue;
    }
    const existing = jobs[candidate.candidateId];
    if (existing?.stage === "installed" || existing?.stage === "cancelled") {
      result.skipped += 1;
      continue;
    }
    if (existing && !TERMINAL_STAGES.has(existing.stage)) {
      continue; // already advanced in step 1
    }
    const enrolled = enrollSkillAutoInstall({
      candidateId: candidate.candidateId,
      enrolledBy: candidate.approvedBy ?? "auto-pass-enroll",
    });
    if (!enrolled.ok) {
      result.skipped += 1;
      result.errors.push({ candidateId: candidate.candidateId, error: enrolled.reason });
      continue;
    }
    // refresh jobs map after enroll
    jobs[enrolled.job.candidateId] = enrolled.job;
    advanceJob(jobs, enrolled.job, result);
  }

  // Intentionally NO full published-candidate scan.

  result.jobs = Object.values(readJobs());
  return result;
}

export type { SkillAutoInstallJob, SkillAutoInstallStage };
