import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveCognitiveMutationRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  ActorRef,
  CognitiveGovernanceMutationReceipt,
  CognitiveMutationReceiptStatus,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
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
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error("cognitive_mutation_lock_timeout");
}

function tenantPartition(tenantId: string | null): string {
  const raw = tenantId && tenantId.trim() ? tenantId.trim() : "local";
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return /^[A-Za-z0-9]/.test(safe) ? safe : `t${safe}`;
}

function resolveMutationPath(params: {
  mutationId: string;
  tenantId: string | null;
  stateDir?: string;
}): string {
  const mutationId = assertSafeRecoveryReceiptToken(params.mutationId, "operationId");
  const partition = assertSafeRecoveryReceiptToken(
    tenantPartition(params.tenantId).replace(/[^A-Za-z0-9._-]/g, "_"),
    "operationId",
  );
  const root = path.resolve(
    resolveCognitiveMutationRoot(params.stateDir ?? resolveStateDir()),
    partition,
  );
  const dest = path.resolve(root, `${mutationId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_cognitive_mutation_path");
  }
  return dest;
}

function writeDurable(dest: string, receipt: CognitiveGovernanceMutationReceipt): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function parseReceipt(raw: unknown): CognitiveGovernanceMutationReceipt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as CognitiveGovernanceMutationReceipt;
  if (
    typeof r.mutationId !== "string" ||
    typeof r.requestFingerprint !== "string" ||
    typeof r.resourceId !== "string" ||
    typeof r.status !== "string"
  ) {
    return null;
  }
  return r;
}

export function canonicalizeCognitiveJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeCognitiveJsonValue(entry));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted()) {
    out[key] = canonicalizeCognitiveJsonValue(record[key]);
  }
  return out;
}

export function canonicalizeCognitiveJson(value: unknown): string {
  return JSON.stringify(canonicalizeCognitiveJsonValue(value));
}

export function computeCognitiveMutationFingerprint(input: {
  resourceId: string;
  tenantId: string | null;
  command: CognitiveGovernanceMutationReceipt["command"];
  expectedGovernanceVersion: number;
  actor: ActorRef;
  canonicalPatchJson: string;
}): string {
  const patch = canonicalizeCognitiveJsonValue(JSON.parse(input.canonicalPatchJson) as unknown);
  const payload = canonicalizeCognitiveJsonValue({
    actor: input.actor,
    command: input.command,
    expectedGovernanceVersion: input.expectedGovernanceVersion,
    patch,
    resourceId: input.resourceId,
    tenantId: input.tenantId,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getCognitiveMutationReceipt(params: {
  mutationId: string;
  tenantId: string | null;
  stateDir?: string;
}): CognitiveGovernanceMutationReceipt | null {
  const dest = resolveMutationPath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export type CreateCognitiveMutationUniqueResult =
  | { ok: true; receipt: CognitiveGovernanceMutationReceipt; created: boolean }
  | { ok: false; conflict: "idempotent_mismatch" };

export async function createCognitiveMutationReceiptUnique(params: {
  mutationId: string;
  requestFingerprint: string;
  resourceId: string;
  tenantId: string | null;
  command: CognitiveGovernanceMutationReceipt["command"];
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  executedBy: ActorRef;
  patchedFields: CognitiveGovernanceMutationReceipt["patchedFields"];
  stateDir?: string;
}): Promise<CreateCognitiveMutationUniqueResult> {
  const dest = resolveMutationPath(params);
  const lockPath = `${dest}.lock`;
  let result: CreateCognitiveMutationUniqueResult | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (fs.existsSync(dest)) {
      const existing = parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
      if (!existing) {
        throw new Error("cognitive_mutation_receipt_corrupt");
      }
      if (existing.requestFingerprint !== params.requestFingerprint) {
        result = { ok: false, conflict: "idempotent_mismatch" };
        return;
      }
      result = { ok: true, receipt: existing, created: false };
      return;
    }
    const now = new Date().toISOString();
    const receipt: CognitiveGovernanceMutationReceipt = {
      mutationId: params.mutationId,
      status: "prepared",
      resourceId: params.resourceId,
      resourceType: "memory",
      tenantId: params.tenantId,
      command: params.command,
      requestFingerprint: params.requestFingerprint,
      expectedGovernanceVersion: params.expectedGovernanceVersion,
      requestedBy: params.requestedBy,
      executedBy: params.executedBy,
      patchedFields: params.patchedFields,
      createdAt: now,
      updatedAt: now,
    };
    writeDurable(dest, receipt);
    result = { ok: true, receipt, created: true };
  });
  if (!result) {
    throw new Error("cognitive_mutation_create_failed");
  }
  return result;
}

export async function finalizeCognitiveMutationReceipt(params: {
  mutationId: string;
  tenantId: string | null;
  status: CognitiveMutationReceiptStatus;
  resultingGovernanceVersion?: number;
  stateDir?: string;
}): Promise<CognitiveGovernanceMutationReceipt> {
  const dest = resolveMutationPath(params);
  const lockPath = `${dest}.lock`;
  let updated: CognitiveGovernanceMutationReceipt | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (!fs.existsSync(dest)) {
      throw new Error("cognitive_mutation_receipt_not_found");
    }
    const existing = parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
    if (!existing) {
      throw new Error("cognitive_mutation_receipt_corrupt");
    }
    if (
      existing.status === "applied" ||
      existing.status === "conflicted" ||
      existing.status === "failed"
    ) {
      updated = existing;
      return;
    }
    updated = {
      ...existing,
      status: params.status,
      ...(params.status === "applied" && params.resultingGovernanceVersion !== undefined
        ? { resultingGovernanceVersion: params.resultingGovernanceVersion }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    writeDurable(dest, updated);
  });
  if (!updated) {
    throw new Error("cognitive_mutation_finalize_failed");
  }
  return updated;
}
