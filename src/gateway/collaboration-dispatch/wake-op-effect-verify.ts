/**
 * T36 M2 — controlled external-effect verification for wake-op unknown recovery.
 *
 * Callers must NOT unlock release by self-filling externalEffectCheck fields.
 * A controlled verifier reads locatable receipts / external state (or records an
 * authorized human attestation) and persists a verification bound to
 * tenant + task + op + attempt. Actions without reliable verify stay `unknown`
 * and forbid auto-retry.
 *
 * Human attestation stores basis/scope/responsible subject and MUST NOT claim
 * platformAutoProved.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { withRoundLock, writeJsonDurable } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import {
  EXTERNAL_EFFECT_CHECK_MAX_AGE_MS,
  type ExternalEffectCheckRecord,
  type WakeOpRecoverySubject,
  isWakeOpRecoverySubject,
} from "./wake-op-recovery-gate.js";

export type ExternalEffectVerificationKind = "platform_receipt" | "human_attestation";

export type ExternalEffectVerificationRecord = Readonly<{
  verificationId: string;
  tenantId: string | null;
  groupId: string;
  taskId: string;
  opKey: string;
  attemptId: string;
  outcome: "none";
  kind: ExternalEffectVerificationKind;
  /** Locatable receipt path / probe id, or "human_attestation". */
  source: string;
  checkedAtMs: number;
  /** True only when platform read a locatable receipt/external state. */
  platformAutoProved: boolean;
  /** Human attestation fields (required when kind=human_attestation). */
  basis?: string;
  scope?: string;
  responsibleSubjectId?: string;
}>;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function verificationsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "wake-op-verifications");
}

function verificationFile(dir: string, verificationId: string): string {
  const digest = createHash("sha256").update(verificationId).digest("hex");
  return path.join(dir, `${digest}.json`);
}

function lockStem(verificationId: string): string {
  return createHash("sha256").update(verificationId).digest("hex").slice(0, 32);
}

export async function readExternalEffectVerification(params: {
  authority: RuntimeAuthority;
  verificationId: string;
}): Promise<ExternalEffectVerificationRecord | null> {
  const id = compact(params.verificationId);
  if (!id) {
    return null;
  }
  const file = verificationFile(verificationsDir(params.authority), id);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ExternalEffectVerificationRecord;
    if (!parsed || typeof parsed !== "object" || compact(parsed.verificationId) !== id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function persistVerification(
  authority: RuntimeAuthority,
  cfg: OpenBotConfig | undefined,
  record: ExternalEffectVerificationRecord,
): Promise<ExternalEffectVerificationRecord> {
  const dir = verificationsDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  await fs.mkdir(dir, { recursive: true });
  const file = verificationFile(dir, record.verificationId);
  await withRoundLock(dir, lockStem(record.verificationId), async () => {
    await writeJsonDurable(file, record);
  });
  return record;
}

export type ProducePlatformNoneVerificationParams = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  taskId: string;
  opKey: string;
  attemptId?: string;
  nowMs?: number;
  /**
   * Controlled probe: return locatable source id when external effect is
   * confirmed absent. Return null when verify capability is unavailable
   * (caller must keep unknown — no auto-retry).
   */
  probe: () => Promise<{ source: string; outcome: "none" } | null>;
};

/**
 * Platform path: read locatable receipt / external state via probe.
 * Does not accept caller-supplied outcome as fact — probe result is the basis.
 */
export async function producePlatformNoneVerification(
  params: ProducePlatformNoneVerificationParams,
): Promise<{ ok: true; record: ExternalEffectVerificationRecord } | { ok: false; reason: string }> {
  const opKey = compact(params.opKey);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!opKey || !groupId || !taskId) {
    return { ok: false, reason: "missing_verification_scope" };
  }
  let probed: { source: string; outcome: "none" } | null;
  try {
    probed = await params.probe();
  } catch (error) {
    return {
      ok: false,
      reason: `probe_failed:${error instanceof Error ? error.message.slice(0, 80) : "error"}`,
    };
  }
  if (!probed) {
    return { ok: false, reason: "verify_capability_unavailable" };
  }
  if (probed.outcome !== "none" || !compact(probed.source)) {
    return { ok: false, reason: "effect_check_contradictory_outcome" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const record: ExternalEffectVerificationRecord = {
    verificationId: randomUUID(),
    tenantId: params.authority.tenantId,
    groupId,
    taskId,
    opKey,
    attemptId: compact(params.attemptId) || `attempt:${nowMs}`,
    outcome: "none",
    kind: "platform_receipt",
    source: compact(probed.source),
    checkedAtMs: nowMs,
    platformAutoProved: true,
  };
  await persistVerification(params.authority, params.cfg, record);
  return { ok: true, record };
}

export type ProduceHumanNoneAttestationParams = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  subject: WakeOpRecoverySubject;
  groupId: string;
  taskId: string;
  opKey: string;
  attemptId?: string;
  basis: string;
  scope: string;
  nowMs?: number;
};

/**
 * Authorized human-verify path. Stores basis/scope/responsible subject.
 * platformAutoProved is always false — must not claim platform auto-proved facts.
 */
export async function produceHumanNoneAttestation(
  params: ProduceHumanNoneAttestationParams,
): Promise<{ ok: true; record: ExternalEffectVerificationRecord } | { ok: false; reason: string }> {
  if (!isWakeOpRecoverySubject(params.subject)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  if (params.subject.action !== "release_for_retry") {
    return { ok: false, reason: "recovery_action_mismatch" };
  }
  const basis = compact(params.basis);
  const scope = compact(params.scope);
  const opKey = compact(params.opKey);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!basis || !scope || !opKey || !groupId || !taskId) {
    return { ok: false, reason: "missing_human_attestation_fields" };
  }
  if (params.subject.groupId !== groupId || params.subject.taskId !== taskId) {
    return { ok: false, reason: "subject_scope_mismatch" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const record: ExternalEffectVerificationRecord = {
    verificationId: randomUUID(),
    tenantId: params.authority.tenantId,
    groupId,
    taskId,
    opKey,
    attemptId: compact(params.attemptId) || `attempt:${nowMs}`,
    outcome: "none",
    kind: "human_attestation",
    source: "human_attestation",
    checkedAtMs: nowMs,
    platformAutoProved: false,
    basis,
    scope,
    responsibleSubjectId: params.subject.actorId,
  };
  await persistVerification(params.authority, params.cfg, record);
  return { ok: true, record };
}

export type BindVerificationForReleaseParams = {
  authority: RuntimeAuthority;
  verificationId: string;
  opKey: string;
  groupId: string;
  taskId: string;
  nowMs: number;
  maxAgeMs?: number;
};

/**
 * Load + bind a stored verification for release. Rejects missing / wrong op /
 * stale / contradictory / scope mismatch. Does not accept caller-built checks.
 */
export async function bindVerificationForRelease(
  params: BindVerificationForReleaseParams,
): Promise<
  | { ok: true; record: ExternalEffectVerificationRecord; auditCheck: ExternalEffectCheckRecord }
  | { ok: false; reason: string }
> {
  const stored = await readExternalEffectVerification({
    authority: params.authority,
    verificationId: params.verificationId,
  });
  if (!stored) {
    return { ok: false, reason: "missing_external_effect_verification" };
  }
  if (compact(stored.opKey) !== compact(params.opKey)) {
    return { ok: false, reason: "effect_check_op_mismatch" };
  }
  if (compact(stored.groupId) !== compact(params.groupId)) {
    return { ok: false, reason: "verification_group_mismatch" };
  }
  if (compact(stored.taskId) !== compact(params.taskId)) {
    return { ok: false, reason: "verification_task_mismatch" };
  }
  if (stored.outcome !== "none") {
    return { ok: false, reason: "effect_check_contradictory_outcome" };
  }
  if (!compact(stored.source)) {
    return { ok: false, reason: "missing_effect_check_source" };
  }
  if (!Number.isFinite(stored.checkedAtMs)) {
    return { ok: false, reason: "missing_effect_check_time" };
  }
  if (stored.checkedAtMs > params.nowMs + 60_000) {
    return { ok: false, reason: "effect_check_time_invalid" };
  }
  const maxAge = params.maxAgeMs ?? EXTERNAL_EFFECT_CHECK_MAX_AGE_MS;
  if (params.nowMs - stored.checkedAtMs > maxAge) {
    return { ok: false, reason: "effect_check_expired" };
  }
  if (stored.kind === "human_attestation") {
    if (!compact(stored.basis) || !compact(stored.scope) || !compact(stored.responsibleSubjectId)) {
      return { ok: false, reason: "human_attestation_incomplete" };
    }
    if (stored.platformAutoProved) {
      return { ok: false, reason: "human_attestation_must_not_claim_platform_proof" };
    }
  }
  return {
    ok: true,
    record: stored,
    auditCheck: {
      source: stored.source,
      opId: stored.opKey,
      checkedAtMs: stored.checkedAtMs,
      outcome: "none",
    },
  };
}
