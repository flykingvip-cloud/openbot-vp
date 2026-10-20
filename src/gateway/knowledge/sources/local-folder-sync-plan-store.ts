/**
 * Durable managed_push sync leases. One current generation is retained per binding so
 * stale/replayed commits fail closed across gateway restarts.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import type {
  LocalFolderSyncPlanResponse,
  ManagedLocalFolderSyncPlanResponse,
} from "./local-folder-types.js";

export type LocalFolderSyncExpectedUpload = {
  relativePath: string;
  rawHash?: string;
};

export type LocalFolderSyncPlanRecord = ManagedLocalFolderSyncPlanResponse & {
  bindingRevision: number;
  state: "active" | "consumed";
  savedAtMs: number;
  expectedUploads: LocalFolderSyncExpectedUpload[];
  uploadedRelativePaths: string[];
  consumedAtMs?: number;
  invalidatedAtMs?: number;
};

type PlanStoreFile = {
  plans: Record<string, unknown>;
};

export const DEFAULT_LOCAL_FOLDER_SYNC_PLAN_TTL_MS = 15 * 60 * 1000;

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "local-folder-sync-plans.json");

function readStore(storePath: string): PlanStoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { plans: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const plans =
      typeof record.plans === "object" && record.plans !== null && !Array.isArray(record.plans)
        ? (record.plans as Record<string, unknown>)
        : {};
    return { plans };
  } catch {
    return { plans: {} };
  }
}

function writeStore(store: PlanStoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, storePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function parsePlanRecord(value: unknown): LocalFolderSyncPlanRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<LocalFolderSyncPlanRecord>;
  if (
    typeof record.bindingId !== "string" ||
    typeof record.sourceDescriptorId !== "string" ||
    typeof record.planId !== "string" ||
    !Number.isSafeInteger(record.generation) ||
    typeof record.bindingRevision !== "number" ||
    !Number.isSafeInteger(record.bindingRevision) ||
    record.bindingRevision < 1 ||
    typeof record.deviceId !== "string" ||
    typeof record.savedAtMs !== "number" ||
    typeof record.expiresAtMs !== "number" ||
    (record.state !== "active" && record.state !== "consumed") ||
    !Array.isArray(record.needUpload) ||
    !Array.isArray(record.unchanged) ||
    !Array.isArray(record.missingOnDevice) ||
    !Array.isArray(record.expectedUploads) ||
    !Array.isArray(record.uploadedRelativePaths) ||
    (record.invalidatedAtMs !== undefined && typeof record.invalidatedAtMs !== "number")
  ) {
    return null;
  }
  return record as LocalFolderSyncPlanRecord;
}

export function createLocalFolderSyncPlanLease(
  params: {
    plan: LocalFolderSyncPlanResponse;
    deviceId: string;
    bindingRevision: number;
    expectedUploads: LocalFolderSyncExpectedUpload[];
    nowMs?: number;
    ttlMs?: number;
  },
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderSyncPlanRecord {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_LOCAL_FOLDER_SYNC_PLAN_TTL_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("managed sync plan requires a positive finite lifetime");
  }
  if (!Number.isSafeInteger(params.bindingRevision) || params.bindingRevision < 1) {
    throw new Error("managed sync plan requires a positive binding revision");
  }
  const store = readStore(storePath);
  const previous = parsePlanRecord(store.plans[params.plan.bindingId]);
  const generation = (previous?.generation ?? 0) + 1;
  const record: LocalFolderSyncPlanRecord = {
    ...params.plan,
    planId: `lfp:${randomUUID()}`,
    generation,
    bindingRevision: params.bindingRevision,
    deviceId: params.deviceId,
    expiresAtMs: nowMs + ttlMs,
    state: "active",
    savedAtMs: nowMs,
    expectedUploads: params.expectedUploads,
    uploadedRelativePaths: [],
  };
  store.plans[params.plan.bindingId] = record;
  writeStore(store, storePath);
  return record;
}

export function loadLocalFolderSyncPlan(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderSyncPlanRecord | null {
  const store = readStore(storePath);
  return parsePlanRecord(store.plans[bindingId.trim()]);
}

function requireActivePlan(params: {
  store: PlanStoreFile;
  bindingId: string;
  planId: string;
  generation: number;
  deviceId: string;
  nowMs: number;
}): LocalFolderSyncPlanRecord {
  const current = parsePlanRecord(params.store.plans[params.bindingId]);
  if (!current) {
    throw new Error("managed sync plan not found; create a new plan");
  }
  if (current.planId !== params.planId || current.generation !== params.generation) {
    throw new Error("managed sync plan is stale or superseded");
  }
  if (current.deviceId !== params.deviceId) {
    throw new Error("managed sync plan deviceId mismatch");
  }
  if (current.invalidatedAtMs !== undefined) {
    throw new Error("managed sync plan was invalidated by a binding lifecycle change");
  }
  if (current.state === "consumed") {
    throw new Error("managed sync plan was already consumed");
  }
  if (params.nowMs >= current.expiresAtMs) {
    throw new Error("managed sync plan expired");
  }
  return current;
}

export function recordLocalFolderSyncPlanUploads(
  params: {
    bindingId: string;
    planId: string;
    generation: number;
    deviceId: string;
    relativePaths: string[];
    nowMs?: number;
  },
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderSyncPlanRecord {
  const store = readStore(storePath);
  const current = requireActivePlan({
    store,
    bindingId: params.bindingId,
    planId: params.planId,
    generation: params.generation,
    deviceId: params.deviceId,
    nowMs: params.nowMs ?? Date.now(),
  });
  const uploaded = new Set(current.uploadedRelativePaths);
  for (const relativePath of params.relativePaths) {
    uploaded.add(relativePath);
  }
  const next: LocalFolderSyncPlanRecord = {
    ...current,
    uploadedRelativePaths: [...uploaded],
  };
  store.plans[params.bindingId] = next;
  writeStore(store, storePath);
  return next;
}

export function consumeLocalFolderSyncPlan(
  params: {
    bindingId: string;
    planId: string;
    generation: number;
    deviceId: string;
    nowMs?: number;
  },
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderSyncPlanRecord {
  const nowMs = params.nowMs ?? Date.now();
  const store = readStore(storePath);
  const current = requireActivePlan({
    store,
    bindingId: params.bindingId,
    planId: params.planId,
    generation: params.generation,
    deviceId: params.deviceId,
    nowMs,
  });
  const next: LocalFolderSyncPlanRecord = {
    ...current,
    state: "consumed",
    consumedAtMs: nowMs,
  };
  store.plans[params.bindingId] = next;
  writeStore(store, storePath);
  return next;
}

export function invalidateLocalFolderSyncPlan(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
  nowMs: number = Date.now(),
): void {
  const store = readStore(storePath);
  const current = parsePlanRecord(store.plans[bindingId.trim()]);
  if (!current || current.state !== "active") {
    return;
  }
  store.plans[bindingId.trim()] = {
    ...current,
    state: "consumed",
    consumedAtMs: nowMs,
    invalidatedAtMs: nowMs,
  } satisfies LocalFolderSyncPlanRecord;
  writeStore(store, storePath);
}
