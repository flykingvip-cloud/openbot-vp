/**
 * Durable P5-e continuity restore and human-anchor review receipts.
 * Isolated manifest namespace — not production P3-f/P3-g stores.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  resolveContinuityLongevityRoot,
  resolveContinuityRestoreManifestPath,
  resolveContinuityRestorePointerPath,
  resolveTenantPolicyBaselinePath,
} from "./paths.js";
import type {
  AgentAssetContinuityManifest,
  AgentAssetManifestPointer,
  ContinuityRestoreReceipt,
  HumanAnchorReviewReceipt,
  TenantPolicyBaselineRecord,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type TenantContinuityLongevityState = {
  schemaVersion: 1;
  revision: number;
  tenantId: string;
  lastReviewAt: string | null;
  restoreReceipts: Record<string, ContinuityRestoreReceipt>;
  reviewReceipts: Record<string, HumanAnchorReviewReceipt>;
};

export type ContinuityStoreMutateResult<T> =
  | { ok: true; value: T; state: TenantContinuityLongevityState }
  | { ok: false; error: string };

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
  throw new Error("continuity_longevity_lock_timeout");
}

function storePathFor(stateDir: string, tenantId: string): string {
  return path.join(resolveContinuityLongevityRoot(stateDir), tenantId, "longevity.json");
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

export function emptyContinuityLongevityState(tenantId: string): TenantContinuityLongevityState {
  return {
    schemaVersion: 1,
    revision: 0,
    tenantId,
    lastReviewAt: null,
    restoreReceipts: {},
    reviewReceipts: {},
  };
}

export function readContinuityLongevityState(params: {
  stateDir: string;
  tenantId: string;
}): TenantContinuityLongevityState | null {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantContinuityLongevityState;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.tenantId !== params.tenantId ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("continuity_longevity_corrupt");
  }
  return parsed;
}

export function mutateContinuityLongevityState<T>(params: {
  stateDir: string;
  tenantId: string;
  fn: (
    state: TenantContinuityLongevityState,
  ) => { ok: true; value: T; state: TenantContinuityLongevityState } | { ok: false; error: string };
}): ContinuityStoreMutateResult<T> {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  let outcome: ContinuityStoreMutateResult<T> | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const current =
      readContinuityLongevityState(params) ?? emptyContinuityLongevityState(params.tenantId);
    const next = params.fn(current);
    if (!next.ok) {
      outcome = next;
      return;
    }
    const written: TenantContinuityLongevityState = {
      ...next.state,
      schemaVersion: 1,
      tenantId: params.tenantId,
      revision: current.revision + 1,
    };
    writeFileDurable(storePath, written);
    outcome = { ok: true, value: next.value, state: written };
  });
  return outcome ?? { ok: false, error: "continuity_longevity_corrupt" };
}

export function writeContinuityRestoreSnapshot(params: {
  stateDir: string;
  tenantId: string;
  agentAssetId: string;
  manifest: AgentAssetContinuityManifest;
  pointer: AgentAssetManifestPointer;
  now: string;
}): void {
  writeFileDurable(
    resolveContinuityRestoreManifestPath(
      params.stateDir,
      params.tenantId,
      params.agentAssetId,
      params.manifest.manifestId,
    ),
    params.manifest,
  );
  writeFileDurable(
    resolveContinuityRestorePointerPath(params.stateDir, params.tenantId, params.agentAssetId),
    params.pointer,
  );
}

export function readContinuityRestorePointer(params: {
  stateDir: string;
  tenantId: string;
  agentAssetId: string;
}): AgentAssetManifestPointer | null {
  const dest = resolveContinuityRestorePointerPath(
    params.stateDir,
    params.tenantId,
    params.agentAssetId,
  );
  if (!fs.existsSync(dest)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(dest, "utf8")) as AgentAssetManifestPointer;
}

export function readContinuityRestoreManifest(params: {
  stateDir: string;
  tenantId: string;
  agentAssetId: string;
  manifestId: string;
}): AgentAssetContinuityManifest | null {
  const dest = resolveContinuityRestoreManifestPath(
    params.stateDir,
    params.tenantId,
    params.agentAssetId,
    params.manifestId,
  );
  if (!fs.existsSync(dest)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(dest, "utf8")) as AgentAssetContinuityManifest;
}

export function writeTenantPolicyBaselineAtDeployBoundary(params: {
  stateDir: string;
  record: TenantPolicyBaselineRecord;
}): void {
  writeFileDurable(
    resolveTenantPolicyBaselinePath(params.stateDir, params.record.tenantId),
    params.record,
  );
}

export function readTenantPolicyBaseline(params: {
  stateDir: string;
  tenantId: string;
}): TenantPolicyBaselineRecord | null {
  const dest = resolveTenantPolicyBaselinePath(params.stateDir, params.tenantId);
  if (!fs.existsSync(dest)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(dest, "utf8")) as TenantPolicyBaselineRecord;
  if (parsed?.schemaVersion !== 1 || parsed.tenantId !== params.tenantId) {
    throw new Error("policy_baseline_corrupt");
  }
  return parsed;
}
