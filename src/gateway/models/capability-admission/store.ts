/**
 * File-backed platform model capability admission store.
 * Source of truth for formal verification tasks and routing eligibility.
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../../utils.js";
import type {
  AutoRoutingAdmission,
  CapabilityEvidenceItem,
  CapabilityVerificationTask,
  ModelAdmissionRecord,
} from "./types.js";

const STORE_VERSION = 1;

type StoreShape = {
  version: number;
  admissions: Record<string, ModelAdmissionRecord>;
  tasks: Record<string, CapabilityVerificationTask>;
  executionGenerationByModel: Record<string, number>;
};

function createEmptyStore(): StoreShape {
  return {
    version: STORE_VERSION,
    admissions: {},
    tasks: {},
    executionGenerationByModel: {},
  };
}

export function resolveDefaultCapabilityAdmissionStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-model-capability-admission.json");
}

const withLock = createAsyncLock();

let overridePath: string | undefined;

/** Test helper: redirect store path (and clear in-process lock usage via path). */
export function __setCapabilityAdmissionStorePathForTest(storePath?: string) {
  overridePath = storePath;
}

function resolvedPath(storePath?: string): string {
  return resolveUserPath(
    storePath?.trim() || overridePath || resolveDefaultCapabilityAdmissionStorePath(),
  );
}

async function loadStore(storePath?: string): Promise<StoreShape> {
  const parsed = await readJsonFile<Partial<StoreShape>>(resolvedPath(storePath));
  if (!parsed || typeof parsed !== "object") {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    admissions: parsed.admissions && typeof parsed.admissions === "object" ? parsed.admissions : {},
    tasks: parsed.tasks && typeof parsed.tasks === "object" ? parsed.tasks : {},
    executionGenerationByModel:
      parsed.executionGenerationByModel && typeof parsed.executionGenerationByModel === "object"
        ? parsed.executionGenerationByModel
        : {},
  };
}

async function saveStore(store: StoreShape, storePath?: string): Promise<void> {
  await writeJsonAtomic(resolvedPath(storePath), store);
}

function defaultRecord(modelRef: string): ModelAdmissionRecord {
  return {
    modelRef,
    tenantSelectable: false,
    autoRouting: "disabled",
    autoRoutingTaskCategories: [],
    capabilityEvidence: [],
    updatedAt: Date.now(),
    platformEffective: true,
  };
}

export async function getModelAdmission(
  modelRef: string,
  storePath?: string,
): Promise<ModelAdmissionRecord> {
  const key = modelRef.trim();
  const store = await loadStore(storePath);
  return store.admissions[key] ?? defaultRecord(key);
}

export async function listModelAdmissions(storePath?: string): Promise<ModelAdmissionRecord[]> {
  const store = await loadStore(storePath);
  return Object.values(store.admissions).toSorted((a, b) => a.modelRef.localeCompare(b.modelRef));
}

/**
 * Stored admission rows only. Missing keys are omitted — callers must not
 * treat a synthesized default as a verified record.
 */
export async function readStoredModelAdmissions(
  storePath?: string,
): Promise<Record<string, ModelAdmissionRecord>> {
  const store = await loadStore(storePath);
  return { ...store.admissions };
}

export async function upsertModelAdmission(
  modelRef: string,
  patch: Partial<Omit<ModelAdmissionRecord, "modelRef">>,
  storePath?: string,
): Promise<ModelAdmissionRecord> {
  const key = modelRef.trim();
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const prev = store.admissions[key] ?? defaultRecord(key);
    const next: ModelAdmissionRecord = {
      ...prev,
      ...patch,
      modelRef: key,
      platformEffective: true,
      updatedAt: Date.now(),
    };
    store.admissions[key] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function setAutoRoutingAdmission(
  modelRef: string,
  autoRouting: AutoRoutingAdmission,
  opts?: { reason?: string; taskCategories?: string[]; tenantSelectable?: boolean },
  storePath?: string,
): Promise<ModelAdmissionRecord> {
  return upsertModelAdmission(
    modelRef,
    {
      autoRouting,
      ...(opts?.reason !== undefined ? { autoRoutingReason: opts.reason } : {}),
      ...(opts?.taskCategories ? { autoRoutingTaskCategories: opts.taskCategories } : {}),
      ...(opts?.tenantSelectable !== undefined ? { tenantSelectable: opts.tenantSelectable } : {}),
    },
    storePath,
  );
}

export async function mergeFormalCapabilityEvidence(
  modelRef: string,
  evidence: CapabilityEvidenceItem[],
  opts?: { configFingerprint?: string },
  storePath?: string,
): Promise<ModelAdmissionRecord> {
  const key = modelRef.trim();
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const prev = store.admissions[key] ?? defaultRecord(key);
    const byId = new Map(prev.capabilityEvidence.map((item) => [item.id, item]));
    for (const item of evidence) {
      // Never write suggested/demo-like statuses as formal passed replacements blindly;
      // callers only pass formal outcomes.
      if (item.status === "checker_unavailable" || item.status === "untested") {
        // Keep existing formal evidence; do not overwrite with non-results.
        if (!byId.has(item.id)) {
          byId.set(item.id, item);
        }
        continue;
      }
      const existing = byId.get(item.id);
      if (item.status === "pending" && existing?.status === "passed") {
        continue;
      }
      byId.set(item.id, item);
    }
    const next: ModelAdmissionRecord = {
      ...prev,
      modelRef: key,
      capabilityEvidence: Array.from(byId.values()),
      ...(opts?.configFingerprint
        ? {
            connectionFingerprint: opts.configFingerprint,
            connectionVerifiedAt: Date.now(),
          }
        : {}),
      platformEffective: true,
      updatedAt: Date.now(),
    };
    store.admissions[key] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function nextExecutionGeneration(
  modelRef: string,
  storePath?: string,
): Promise<number> {
  const key = modelRef.trim();
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const next = (store.executionGenerationByModel[key] ?? 0) + 1;
    store.executionGenerationByModel[key] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function getCurrentExecutionGeneration(
  modelRef: string,
  storePath?: string,
): Promise<number> {
  const key = modelRef.trim();
  const store = await loadStore(storePath);
  return store.executionGenerationByModel[key] ?? 0;
}

export async function getVerificationTask(
  taskId: string,
  storePath?: string,
): Promise<CapabilityVerificationTask | null> {
  const store = await loadStore(storePath);
  return store.tasks[taskId] ?? null;
}

export async function listVerificationTasks(
  modelRef?: string,
  storePath?: string,
): Promise<CapabilityVerificationTask[]> {
  const store = await loadStore(storePath);
  const all = Object.values(store.tasks);
  const filtered = modelRef?.trim() ? all.filter((task) => task.modelRef === modelRef.trim()) : all;
  return filtered.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveVerificationTask(
  task: CapabilityVerificationTask,
  storePath?: string,
): Promise<CapabilityVerificationTask> {
  return await withLock(async () => {
    const store = await loadStore(storePath);
    store.tasks[task.taskId] = task;
    await saveStore(store, storePath);
    return task;
  });
}

/**
 * Atomically finalize a task only while it is still queued/running.
 * Returns null when cancel/interrupt/prior terminal already won the race.
 */
export async function finalizeVerificationTaskIfInFlight(
  taskId: string,
  build: (current: CapabilityVerificationTask) => CapabilityVerificationTask,
  storePath?: string,
): Promise<CapabilityVerificationTask | null> {
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const current = store.tasks[taskId];
    if (!current || (current.status !== "queued" && current.status !== "running")) {
      return null;
    }
    const next = build(current);
    store.tasks[taskId] = next;
    await saveStore(store, storePath);
    return next;
  });
}

const FINGERPRINT_STALE_ERROR = "配置指纹已变更，结果仅保留在历史中，未更新正式证据";
const GENERATION_STALE_ERROR = "已被更新的验证任务取代，结果仅保留在历史中，未更新正式证据";

export type CompleteVerificationOutcomeParams = {
  taskId: string;
  modelRef: string;
  /** Build the terminal task fields (status/results/timestamps/fingerprint/generation). */
  buildTerminal: (current: CapabilityVerificationTask) => CapabilityVerificationTask;
  executionGeneration: number;
  /** Current config fingerprint observed just before completion (may be undefined). */
  currentFingerprint?: string;
  /** Formal evidence candidates; merged only when fingerprint+generation are still current. */
  mergeableEvidence: CapabilityEvidenceItem[];
  configFingerprint?: string;
};

/**
 * Atomically publish a terminal verification outcome while still in-flight.
 * Clients that observe a terminal task status are guaranteed to also see either:
 * - formal evidence already merged into the admission record, or
 * - a history-only rejection reason on the task (`error`).
 * Cancel / interrupt / prior terminal still wins and skips both writes.
 */
export async function completeVerificationOutcomeIfInFlight(
  params: CompleteVerificationOutcomeParams,
  storePath?: string,
): Promise<CapabilityVerificationTask | null> {
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const current = store.tasks[params.taskId];
    if (!current || (current.status !== "queued" && current.status !== "running")) {
      return null;
    }

    const modelKey = params.modelRef.trim();
    const currentGen = store.executionGenerationByModel[modelKey] ?? 0;
    const generationStale = params.executionGeneration < currentGen;

    const terminalBase = params.buildTerminal(current);
    const taskFp = params.configFingerprint ?? terminalBase.configFingerprint;
    const fingerprintStale = Boolean(
      taskFp && params.currentFingerprint && taskFp !== params.currentFingerprint,
    );
    const stale = fingerprintStale || generationStale;

    const next: CapabilityVerificationTask = stale
      ? {
          ...terminalBase,
          error:
            terminalBase.error ??
            (fingerprintStale ? FINGERPRINT_STALE_ERROR : GENERATION_STALE_ERROR),
        }
      : terminalBase;

    store.tasks[params.taskId] = next;

    if (!stale && params.mergeableEvidence.length > 0) {
      const prev = store.admissions[modelKey] ?? defaultRecord(modelKey);
      const byId = new Map(prev.capabilityEvidence.map((item) => [item.id, item]));
      for (const item of params.mergeableEvidence) {
        if (item.status === "checker_unavailable" || item.status === "untested") {
          if (!byId.has(item.id)) {
            byId.set(item.id, item);
          }
          continue;
        }
        const existing = byId.get(item.id);
        if (item.status === "pending" && existing?.status === "passed") {
          continue;
        }
        byId.set(item.id, item);
      }
      store.admissions[modelKey] = {
        ...prev,
        modelRef: modelKey,
        capabilityEvidence: Array.from(byId.values()),
        ...(params.configFingerprint
          ? {
              connectionFingerprint: params.configFingerprint,
              connectionVerifiedAt: Date.now(),
            }
          : {}),
        platformEffective: true,
        updatedAt: Date.now(),
      };
    }

    await saveStore(store, storePath);
    return next;
  });
}

export async function interruptInFlightVerificationTasks(
  reason: string,
  storePath?: string,
): Promise<CapabilityVerificationTask[]> {
  return await withLock(async () => {
    const store = await loadStore(storePath);
    const interrupted: CapabilityVerificationTask[] = [];
    const now = Date.now();
    for (const task of Object.values(store.tasks)) {
      if (task.status !== "queued" && task.status !== "running") {
        continue;
      }
      const next: CapabilityVerificationTask = {
        ...task,
        status: "interrupted",
        error: reason,
        updatedAt: now,
      };
      store.tasks[task.taskId] = next;
      interrupted.push(next);
    }
    if (interrupted.length > 0) {
      await saveStore(store, storePath);
    }
    return interrupted;
  });
}

export async function __resetCapabilityAdmissionStoreForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
