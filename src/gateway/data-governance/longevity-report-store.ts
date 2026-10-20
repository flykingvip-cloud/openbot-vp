/**
 * Durable P5-f storage growth baseline snapshots (resource-count proxy).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStorageGrowthBaselinePath } from "./paths.js";
import type { GovernedResourceType, TenantStorageGrowthBaseline } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function sleep(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

function withExclusiveLockSync(lockPath: string, fn: () => void): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        const startedAt = Date.now();
        fs.writeFileSync(fd, `${process.pid}\n${startedAt}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // raced unlock
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const startedAt = Number(raw.trim().split("\n")[1] ?? "");
        if (Number.isFinite(startedAt) && Date.now() - startedAt > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("longevity_report_baseline_lock_timeout");
}

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, storePath);
}

function parseBaseline(value: unknown, tenantId: string): TenantStorageGrowthBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as TenantStorageGrowthBaseline;
  if (raw.schemaVersion !== 1 || raw.tenantId !== tenantId || !raw.capturedAt) {
    return null;
  }
  if (!Number.isFinite(Date.parse(raw.capturedAt))) {
    return null;
  }
  if (!raw.countsByClass || typeof raw.countsByClass !== "object") {
    return null;
  }
  for (const [_key, row] of Object.entries(raw.countsByClass)) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.activeResourceCount !== "number" ||
      typeof row.governedResourceCount !== "number"
    ) {
      return null;
    }
  }
  return raw;
}

export function readStorageGrowthBaseline(params: {
  stateDir: string;
  tenantId: string;
}): TenantStorageGrowthBaseline | null {
  const storePath = resolveStorageGrowthBaselinePath(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    return parseBaseline(parsed, params.tenantId);
  } catch {
    return null;
  }
}

/** Returns false when the on-disk baseline exists but fails schema validation. */
export function readStorageGrowthBaselineOrCorrupt(params: {
  stateDir: string;
  tenantId: string;
}): { ok: true; baseline: TenantStorageGrowthBaseline | null } | { ok: false; corrupt: true } {
  const storePath = resolveStorageGrowthBaselinePath(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return { ok: true, baseline: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    const baseline = parseBaseline(parsed, params.tenantId);
    if (!baseline) {
      return { ok: false, corrupt: true };
    }
    return { ok: true, baseline };
  } catch {
    return { ok: false, corrupt: true };
  }
}

export function writeStorageGrowthBaseline(params: {
  stateDir: string;
  baseline: TenantStorageGrowthBaseline;
}): void {
  const storePath = resolveStorageGrowthBaselinePath(params.stateDir, params.baseline.tenantId);
  withExclusiveLockSync(`${storePath}.lock`, () => {
    writeFileDurable(storePath, params.baseline);
  });
}

export type StorageGrowthBaselineCasResult =
  | { ok: true }
  | { ok: false; error: "baseline_checkpoint_stale" };

/** CAS write: rejects when an existing baseline has capturedAt >= the candidate. */
export function writeStorageGrowthBaselineCas(params: {
  stateDir: string;
  baseline: TenantStorageGrowthBaseline;
}): StorageGrowthBaselineCasResult {
  const storePath = resolveStorageGrowthBaselinePath(params.stateDir, params.baseline.tenantId);
  let result: StorageGrowthBaselineCasResult = { ok: true };
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const candidateMs = Date.parse(params.baseline.capturedAt);
    if (!Number.isFinite(candidateMs)) {
      result = { ok: false, error: "baseline_checkpoint_stale" };
      return;
    }
    if (fs.existsSync(storePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
        const current = parseBaseline(parsed, params.baseline.tenantId);
        if (!current) {
          result = { ok: false, error: "baseline_checkpoint_stale" };
          return;
        }
        const currentMs = Date.parse(current.capturedAt);
        if (!Number.isFinite(currentMs) || candidateMs <= currentMs) {
          result = { ok: false, error: "baseline_checkpoint_stale" };
          return;
        }
      } catch {
        result = { ok: false, error: "baseline_checkpoint_stale" };
        return;
      }
    }
    writeFileDurable(storePath, params.baseline);
  });
  return result;
}

export function emptyStorageGrowthCounts(
  classes: readonly GovernedResourceType[],
): TenantStorageGrowthBaseline["countsByClass"] {
  return Object.fromEntries(
    classes.map((resourceClass) => [
      resourceClass,
      { activeResourceCount: 0, governedResourceCount: 0 },
    ]),
  ) as TenantStorageGrowthBaseline["countsByClass"];
}
