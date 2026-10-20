/**
 * P5-f tenant longevity SLO policy (deploy boundary).
 * Production report paths read only; never self-issue.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveTenantLongevityPolicyPath } from "./paths.js";
import type { TenantLongevityPolicy } from "./types.js";

export const MIN_MAX_BACKUP_AGE_DAYS = 1;
export const MAX_MAX_BACKUP_AGE_DAYS = 365;
export const MIN_STORAGE_GROWTH_CHECKPOINT_MIN_DAYS = 1;
export const MAX_STORAGE_GROWTH_CHECKPOINT_MIN_DAYS = 90;
export const DEFAULT_STORAGE_GROWTH_CHECKPOINT_MIN_DAYS = 1;

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  fs.writeFileSync(storePath, payload, "utf8");
}

function parsePositiveBoundedDays(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const whole = Math.trunc(value);
  if (whole !== value || whole < min || whole > max) {
    return null;
  }
  return whole;
}

export function validateTenantLongevityPolicyRecord(
  record: TenantLongevityPolicy,
): record is TenantLongevityPolicy {
  if (
    record.schemaVersion !== 1 ||
    typeof record.tenantId !== "string" ||
    !record.tenantId.trim()
  ) {
    return false;
  }
  if (!Number.isFinite(Date.parse(record.updatedAt))) {
    return false;
  }
  const maxBackupAgeDays = parsePositiveBoundedDays(
    record.maxBackupAgeDays,
    MIN_MAX_BACKUP_AGE_DAYS,
    MAX_MAX_BACKUP_AGE_DAYS,
  );
  const storageGrowthCheckpointMinDays = parsePositiveBoundedDays(
    record.storageGrowthCheckpointMinDays,
    MIN_STORAGE_GROWTH_CHECKPOINT_MIN_DAYS,
    MAX_STORAGE_GROWTH_CHECKPOINT_MIN_DAYS,
  );
  return maxBackupAgeDays != null && storageGrowthCheckpointMinDays != null;
}

export function writeTenantLongevityPolicyAtDeployBoundary(params: {
  stateDir: string;
  record: TenantLongevityPolicy;
}): void {
  if (!validateTenantLongevityPolicyRecord(params.record)) {
    throw new Error("longevity_policy_invalid");
  }
  writeFileDurable(
    resolveTenantLongevityPolicyPath(params.stateDir, params.record.tenantId),
    params.record,
  );
}

export function readTenantLongevityPolicy(params: {
  stateDir: string;
  tenantId: string;
}): TenantLongevityPolicy | null {
  const storePath = resolveTenantLongevityPolicyPath(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantLongevityPolicy;
    if (!validateTenantLongevityPolicyRecord(parsed) || parsed.tenantId !== params.tenantId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Fail-closed when on-disk policy exists but fails schema validation. */
export function readTenantLongevityPolicyOrCorrupt(params: {
  stateDir: string;
  tenantId: string;
}): { ok: true; policy: TenantLongevityPolicy | null } | { ok: false; corrupt: true } {
  const storePath = resolveTenantLongevityPolicyPath(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return { ok: true, policy: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantLongevityPolicy;
    if (!validateTenantLongevityPolicyRecord(parsed) || parsed.tenantId !== params.tenantId) {
      return { ok: false, corrupt: true };
    }
    return { ok: true, policy: parsed };
  } catch {
    return { ok: false, corrupt: true };
  }
}
