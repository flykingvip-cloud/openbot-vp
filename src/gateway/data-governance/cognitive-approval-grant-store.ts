import fs from "node:fs";
import path from "node:path";
import { stringValue } from "../records.js";
import { resolveCognitiveApprovalGrantRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  GovernanceApprovalGrantKind,
  GovernanceApprovalGrantRecord,
  GovernanceApprovalGrantScope,
} from "./types.js";

const GRANT_KINDS = new Set<GovernanceApprovalGrantKind>([
  "cognitive_merge_apply",
  "conflict_precedence_resolve",
  "manifest_supersede",
  "anchor_activate",
  "anchor_supersede",
  "anchor_revoke",
  "cognitive_promotion_apply",
  "cognitive_projection_tombstone",
  "placement_export_restore",
]);

const ISSUERS = new Set(["enterprise_ops", "tenant_admin"]);

const GRANT_KEYS = new Set([
  "grantId",
  "kind",
  "grantKind",
  "tenantId",
  "scope",
  "approverUserId",
  "issuedBy",
  "issuedAt",
  "expiresAt",
  "revokedAt",
  "revokeReason",
  "state",
  "consumedAt",
  "consumedByReplayId",
]);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function tenantPartition(tenantId: string | null): string {
  const raw = tenantId && tenantId.trim() ? tenantId.trim() : "local";
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return /^[A-Za-z0-9]/.test(safe) ? safe : `t${safe}`;
}

function nonEmpty(value: unknown): string | null {
  return stringValue(value);
}

function parseScope(input: unknown): GovernanceApprovalGrantScope | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (raw.kind === "agentAsset") {
    const agentAssetId = nonEmpty(raw.agentAssetId);
    if (!agentAssetId || Object.keys(raw).length !== 2) {
      return null;
    }
    return { kind: "agentAsset", agentAssetId };
  }
  if (raw.kind === "resource") {
    const resourceId = nonEmpty(raw.resourceId);
    if (!resourceId || Object.keys(raw).length !== 2) {
      return null;
    }
    return { kind: "resource", resourceId };
  }
  if (raw.kind === "conflict_edge_pair") {
    const left = nonEmpty(raw.leftResourceId);
    const right = nonEmpty(raw.rightResourceId);
    const precedencePolicyId = nonEmpty(raw.precedencePolicyId);
    if (!left || !right || !precedencePolicyId || Object.keys(raw).length !== 4) {
      return null;
    }
    // Store canonically so the fingerprint is order-independent.
    const [leftResourceId, rightResourceId] = left <= right ? [left, right] : [right, left];
    return { kind: "conflict_edge_pair", leftResourceId, rightResourceId, precedencePolicyId };
  }
  return null;
}

/** Canonical scope fingerprint (§0.2). Grant match and auth mint use exactly this string. */
export function approvalScopeFingerprint(scope: GovernanceApprovalGrantScope): string {
  if (scope.kind === "agentAsset") {
    return `agentAsset:${scope.agentAssetId}`;
  }
  if (scope.kind === "resource") {
    return `resource:${scope.resourceId}`;
  }
  const [left, right] =
    scope.leftResourceId <= scope.rightResourceId
      ? [scope.leftResourceId, scope.rightResourceId]
      : [scope.rightResourceId, scope.leftResourceId];
  return `conflict_edge_pair:${left}|${right}|${scope.precedencePolicyId}`;
}

export function parseGovernanceApprovalGrantRecord(
  value: unknown,
): GovernanceApprovalGrantRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!GRANT_KEYS.has(key)) {
      return null;
    }
  }
  if (raw.kind !== "governance_approval_grant") {
    return null;
  }
  const grantId = nonEmpty(raw.grantId);
  const approverUserId = nonEmpty(raw.approverUserId);
  const issuedAt = nonEmpty(raw.issuedAt);
  const expiresAt = nonEmpty(raw.expiresAt);
  const scope = parseScope(raw.scope);
  if (
    !grantId ||
    !approverUserId ||
    !issuedAt ||
    !expiresAt ||
    !scope ||
    !ISO.test(issuedAt) ||
    !ISO.test(expiresAt) ||
    typeof raw.grantKind !== "string" ||
    !GRANT_KINDS.has(raw.grantKind as GovernanceApprovalGrantKind) ||
    typeof raw.issuedBy !== "string" ||
    !ISSUERS.has(raw.issuedBy) ||
    (raw.tenantId !== null && typeof raw.tenantId !== "string")
  ) {
    return null;
  }
  const revokedAt = raw.revokedAt === undefined ? undefined : nonEmpty(raw.revokedAt);
  if (raw.revokedAt !== undefined && (!revokedAt || !ISO.test(revokedAt))) {
    return null;
  }
  // conflict_precedence_resolve must be pair-scoped (§0.2); single-resource scope is rejected.
  if (raw.grantKind === "conflict_precedence_resolve" && scope.kind !== "conflict_edge_pair") {
    return null;
  }
  if (
    (raw.grantKind === "cognitive_promotion_apply" ||
      raw.grantKind === "cognitive_projection_tombstone" ||
      raw.grantKind === "placement_export_restore") &&
    scope.kind !== "resource"
  ) {
    return null;
  }
  const state = raw.state === undefined ? undefined : raw.state;
  if (state !== undefined && state !== "unused" && state !== "consumed") {
    return null;
  }
  const consumedAt = raw.consumedAt === undefined ? undefined : nonEmpty(raw.consumedAt);
  if (raw.consumedAt !== undefined && (!consumedAt || !ISO.test(consumedAt))) {
    return null;
  }
  if (state === "consumed" && !consumedAt) {
    return null;
  }
  const consumedByReplayId =
    raw.consumedByReplayId === undefined ? undefined : nonEmpty(raw.consumedByReplayId);
  if (raw.consumedByReplayId !== undefined && !consumedByReplayId) {
    return null;
  }
  return {
    grantId,
    kind: "governance_approval_grant",
    grantKind: raw.grantKind as GovernanceApprovalGrantKind,
    tenantId: raw.tenantId ?? null,
    scope,
    approverUserId,
    issuedBy: raw.issuedBy as "enterprise_ops" | "tenant_admin",
    issuedAt,
    expiresAt,
    ...(revokedAt ? { revokedAt } : {}),
    ...(nonEmpty(raw.revokeReason) ? { revokeReason: nonEmpty(raw.revokeReason)! } : {}),
    ...(state ? { state } : {}),
    ...(consumedAt ? { consumedAt } : {}),
    ...(consumedByReplayId ? { consumedByReplayId } : {}),
  };
}

function resolveGrantPath(params: {
  grantId: string;
  tenantId: string | null;
  stateDir: string;
}): string {
  const grantId = assertSafeRecoveryReceiptToken(params.grantId, "operationId");
  const partition = assertSafeRecoveryReceiptToken(tenantPartition(params.tenantId), "operationId");
  const root = path.resolve(resolveCognitiveApprovalGrantRoot(params.stateDir), partition);
  const dest = path.resolve(root, `${grantId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_approval_grant_path");
  }
  return dest;
}

/** Read-only registry access. Production commands never write here (§0.2). */
export function readGovernanceApprovalGrant(params: {
  grantId: string;
  tenantId: string | null;
  stateDir: string;
}): GovernanceApprovalGrantRecord | null {
  let dest: string;
  try {
    dest = resolveGrantPath(params);
  } catch {
    return null;
  }
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseGovernanceApprovalGrantRecord(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export type ApprovalGrantDenyReason =
  | "grant_not_found"
  | "grant_kind_mismatch"
  | "grant_scope_mismatch"
  | "grant_tenant_mismatch"
  | "grant_approver_mismatch"
  | "grant_revoked"
  | "grant_expired";

/**
 * Fail-closed grant verification. Revocation has no grace window and expiry is strict.
 */
export function verifyGovernanceApprovalGrant(params: {
  grant: GovernanceApprovalGrantRecord | null;
  requiredKind: GovernanceApprovalGrantKind;
  requiredScopeFingerprint: string;
  callerTenantId: string | null;
  approverUserId: string;
  now: Date;
}): { ok: true } | { ok: false; reason: ApprovalGrantDenyReason } {
  const grant = params.grant;
  if (!grant) {
    return { ok: false, reason: "grant_not_found" };
  }
  if (grant.grantKind !== params.requiredKind) {
    return { ok: false, reason: "grant_kind_mismatch" };
  }
  if ((grant.tenantId ?? null) !== (params.callerTenantId ?? null)) {
    return { ok: false, reason: "grant_tenant_mismatch" };
  }
  if (approvalScopeFingerprint(grant.scope) !== params.requiredScopeFingerprint) {
    return { ok: false, reason: "grant_scope_mismatch" };
  }
  if (grant.approverUserId !== params.approverUserId) {
    return { ok: false, reason: "grant_approver_mismatch" };
  }
  if (grant.revokedAt) {
    return { ok: false, reason: "grant_revoked" };
  }
  if (Date.parse(grant.expiresAt) <= params.now.getTime()) {
    return { ok: false, reason: "grant_expired" };
  }
  return { ok: true };
}

const GRANT_LOCK_STALE_MS = 30_000;
const GRANT_LOCK_RETRY_MS = 20;
const GRANT_LOCK_MAX_ATTEMPTS = 250;

function waitMs(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

function grantLockPath(dest: string): string {
  return `${dest}.lock`;
}

/**
 * Exclusive grant-file lock. Promotion prepare takes the promotion store lock first,
 * then this lock. Deploy writers take only this lock.
 */
export function withGovernanceApprovalGrantLockSync<T>(
  params: { grantId: string; tenantId: string | null; stateDir: string },
  fn: () => T,
): T {
  const dest = resolveGrantPath(params);
  const lockPath = grantLockPath(dest);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < GRANT_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        return fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > GRANT_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      waitMs(GRANT_LOCK_RETRY_MS);
    }
  }
  throw new Error("governance_approval_grant_lock_timeout");
}

function writeGrantRecordUnlocked(params: {
  record: GovernanceApprovalGrantRecord;
  stateDir: string;
}): void {
  const dest = resolveGrantPath({
    grantId: params.record.grantId,
    tenantId: params.record.tenantId,
    stateDir: params.stateDir,
  });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(params.record, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

/** Deploy/test boundary writer. Never called from a production cognitive command. */
export function writeGovernanceApprovalGrantAtDeployBoundary(params: {
  record: GovernanceApprovalGrantRecord;
  stateDir: string;
}): void {
  const parsed = parseGovernanceApprovalGrantRecord(params.record);
  if (!parsed) {
    throw new Error("invalid_approval_grant_record");
  }
  withGovernanceApprovalGrantLockSync(
    { grantId: parsed.grantId, tenantId: parsed.tenantId, stateDir: params.stateDir },
    () => {
      writeGrantRecordUnlocked({ record: parsed, stateDir: params.stateDir });
    },
  );
}

export type ConsumePromotionGrantResult =
  | { ok: true; alreadyConsumed: boolean; consumedByReplayId: string | null }
  | {
      ok: false;
      reason: "grant_not_found" | "grant_revoked" | "grant_expired" | "grant_not_unused";
    };

/**
 * CAS unused → consumed for `replayId`. Caller MUST hold
 * {@link withGovernanceApprovalGrantLockSync}. Re-reads the grant file so a
 * concurrent deploy/revoke writer cannot be overwritten. Grant consume CAS is
 * the prepare commit point (scheme A): only a live unused→consumed transition
 * commits. Recovery must not call this for an unused grant; it may complete a
 * prepared receipt only when the grant is already consumed for this replay.
 */
export function compareAndConsumeGovernanceApprovalGrantUnlocked(params: {
  grantId: string;
  tenantId: string | null;
  stateDir: string;
  consumedAt: string;
  replayId: string;
}): ConsumePromotionGrantResult {
  const current = readGovernanceApprovalGrant(params);
  if (!current) {
    return { ok: false, reason: "grant_not_found" };
  }
  if (current.revokedAt) {
    return { ok: false, reason: "grant_revoked" };
  }
  if (Date.parse(current.expiresAt) <= Date.now()) {
    return { ok: false, reason: "grant_expired" };
  }
  if (current.state === "consumed") {
    return {
      ok: true,
      alreadyConsumed: true,
      consumedByReplayId: current.consumedByReplayId ?? null,
    };
  }
  if (current.state !== undefined && current.state !== "unused") {
    return { ok: false, reason: "grant_not_unused" };
  }
  writeGrantRecordUnlocked({
    record: {
      ...current,
      state: "consumed",
      consumedAt: params.consumedAt,
      consumedByReplayId: params.replayId,
    },
    stateDir: params.stateDir,
  });
  return { ok: true, alreadyConsumed: false, consumedByReplayId: params.replayId };
}
