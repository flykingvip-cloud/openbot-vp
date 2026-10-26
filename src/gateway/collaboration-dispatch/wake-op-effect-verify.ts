/**
 * T36/T37 M2 — controlled external-effect verification for wake-op unknown recovery.
 *
 * Callers must NOT unlock release by self-filling externalEffectCheck fields.
 * A controlled verifier / registry-selected adapter reads locatable receipts /
 * external state (or records an authorized human attestation) and persists a
 * verification bound to tenant + group + task + op + **executionAttemptId**.
 *
 * T37: attemptId MUST come from the current wake-op operation record. Caller-
 * supplied free strings are not an authentication of "this attempt". Release
 * binds verification.attemptId to the op's current executionAttemptId.
 *
 * Human attestation stores basis/scope/responsible subject and MUST NOT claim
 * platformAutoProved.
 *
 * Production composition: select adapters by operation type via
 * {@link producePlatformNoneVerificationViaAdapter}. The probe-callback form
 * remains DI for tests; it is not the production trusted evidence chain.
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
  /** Bound to WakeOpRecord.executionAttemptId at produce time. */
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

/** Minimal op fields adapters need (loaded by composition root from ledger). */
export type WakeOpEffectVerifyOpSnapshot = Readonly<{
  opKey: string;
  groupId: string;
  taskId?: string;
  source: string;
  status: string;
  executionAttemptId?: string;
}>;

/** Context passed to a trusted verification adapter. */
export type WakeOpEffectVerifyContext = Readonly<{
  authority: RuntimeAuthority;
  record: WakeOpEffectVerifyOpSnapshot;
  groupId: string;
  taskId: string;
  opKey: string;
  attemptId: string;
  nowMs: number;
}>;

/**
 * Trusted adapter: reads and validates receipts / external state for a specific
 * operation type. Returning null means capability unavailable → keep unknown.
 */
export type WakeOpEffectVerifyAdapter = Readonly<{
  /** Operation `source` (or type key) this adapter is allowed to verify. */
  operationType: string;
  verifyNone: (
    ctx: WakeOpEffectVerifyContext,
  ) => Promise<{ source: string; outcome: "none" } | null>;
}>;

export type WakeOpEffectVerifyAdapterRegistry = ReadonlyArray<WakeOpEffectVerifyAdapter>;

export function selectWakeOpVerifyAdapter(
  registry: WakeOpEffectVerifyAdapterRegistry,
  operationType: string,
): WakeOpEffectVerifyAdapter | null {
  const key = compact(operationType);
  if (!key) {
    return null;
  }
  return registry.find((a) => compact(a.operationType) === key) ?? null;
}

/**
 * Test/stub adapter that actually reads a fixture receipt file and only proves
 * none when the file asserts outcome none for the matching opKey+attemptId.
 */
export function createFixtureReceiptNoneAdapter(params: {
  operationType: string;
  receiptFilePath: string;
}): WakeOpEffectVerifyAdapter {
  return {
    operationType: params.operationType,
    verifyNone: async (ctx) => {
      try {
        const raw = await fs.readFile(params.receiptFilePath, "utf8");
        const parsed = JSON.parse(raw) as {
          opKey?: string;
          attemptId?: string;
          outcome?: string;
          source?: string;
        };
        if (compact(parsed.opKey) !== ctx.opKey) {
          return null;
        }
        if (compact(parsed.attemptId) !== ctx.attemptId) {
          return null;
        }
        if (parsed.outcome !== "none") {
          return null;
        }
        const source = compact(parsed.source) || params.receiptFilePath;
        return { source, outcome: "none" };
      } catch {
        return null;
      }
    },
  };
}

export type ProducePlatformNoneVerificationParams = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  taskId: string;
  opKey: string;
  /**
   * MUST equal the current WakeOpRecord.executionAttemptId.
   * Prefer {@link producePlatformNoneVerificationViaAdapter} which loads it.
   */
  attemptId: string;
  nowMs?: number;
  /**
   * DI / test probe only — NOT the production trusted evidence chain.
   * Production must use registry-selected adapters that read receipts.
   */
  probe: () => Promise<{ source: string; outcome: "none" } | null>;
};

/**
 * DI helper: probe callback path. Prefer adapter registry for composition root.
 * attemptId is required (no Date.now fallback) and should come from the op record.
 */
export async function producePlatformNoneVerification(
  params: ProducePlatformNoneVerificationParams,
): Promise<{ ok: true; record: ExternalEffectVerificationRecord } | { ok: false; reason: string }> {
  const opKey = compact(params.opKey);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const attemptId = compact(params.attemptId);
  if (!opKey || !groupId || !taskId) {
    return { ok: false, reason: "missing_verification_scope" };
  }
  if (!attemptId) {
    return { ok: false, reason: "missing_execution_attempt" };
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
    attemptId,
    outcome: "none",
    kind: "platform_receipt",
    source: compact(probed.source),
    checkedAtMs: nowMs,
    platformAutoProved: true,
  };
  await persistVerification(params.authority, params.cfg, record);
  return { ok: true, record };
}

/**
 * Composition-root path: load current op record, select adapter by operation
 * type, adapter reads receipts. No adapter → keep unknown.
 * attemptId always comes from the operation record.
 */
export async function producePlatformNoneVerificationViaAdapter(params: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  /** Current wake-op snapshot from ledger (composition root loads it). */
  op: WakeOpEffectVerifyOpSnapshot;
  registry: WakeOpEffectVerifyAdapterRegistry;
  nowMs?: number;
}): Promise<
  { ok: true; record: ExternalEffectVerificationRecord } | { ok: false; reason: string }
> {
  const wake = params.op;
  const opKey = compact(wake.opKey);
  if (!opKey) {
    return { ok: false, reason: "missing_verification_scope" };
  }
  if (wake.status !== "unknown") {
    return { ok: false, reason: `op_status_${wake.status}` };
  }
  const attemptId = compact(wake.executionAttemptId);
  if (!attemptId) {
    return { ok: false, reason: "missing_execution_attempt" };
  }
  const groupId = compact(wake.groupId);
  const taskId = compact(wake.taskId);
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_verification_scope" };
  }
  const adapter = selectWakeOpVerifyAdapter(params.registry, wake.source);
  if (!adapter) {
    return { ok: false, reason: "verify_capability_unavailable" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const ctx: WakeOpEffectVerifyContext = {
    authority: params.authority,
    record: wake,
    groupId,
    taskId,
    opKey,
    attemptId,
    nowMs,
  };
  let probed: { source: string; outcome: "none" } | null;
  try {
    probed = await adapter.verifyNone(ctx);
  } catch (error) {
    return {
      ok: false,
      reason: `adapter_failed:${error instanceof Error ? error.message.slice(0, 80) : "error"}`,
    };
  }
  if (!probed) {
    return { ok: false, reason: "verify_capability_unavailable" };
  }
  if (probed.outcome !== "none" || !compact(probed.source)) {
    return { ok: false, reason: "effect_check_contradictory_outcome" };
  }
  const record: ExternalEffectVerificationRecord = {
    verificationId: randomUUID(),
    tenantId: params.authority.tenantId,
    groupId,
    taskId,
    opKey,
    attemptId,
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
  /** MUST equal current WakeOpRecord.executionAttemptId. */
  attemptId: string;
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
  const attemptId = compact(params.attemptId);
  if (!basis || !scope || !opKey || !groupId || !taskId) {
    return { ok: false, reason: "missing_human_attestation_fields" };
  }
  if (!attemptId) {
    return { ok: false, reason: "missing_execution_attempt" };
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
    attemptId,
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
  /** Current WakeOpRecord.executionAttemptId — must match verification.attemptId. */
  currentAttemptId: string;
  tenantId?: string | null;
  nowMs: number;
  maxAgeMs?: number;
};

/**
 * Load + bind a stored verification for release. Rejects missing / wrong op /
 * wrong attempt / stale / contradictory / scope mismatch.
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
  const currentAttemptId = compact(params.currentAttemptId);
  if (!currentAttemptId) {
    return { ok: false, reason: "missing_execution_attempt" };
  }
  if (compact(stored.attemptId) !== currentAttemptId) {
    return { ok: false, reason: "effect_check_attempt_mismatch" };
  }
  if (params.tenantId != null && stored.tenantId != null) {
    if (compact(String(stored.tenantId)) !== compact(String(params.tenantId))) {
      return { ok: false, reason: "verification_tenant_mismatch" };
    }
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
