/**
 * Frontend admission store (stub until backend persistence lands).
 * Separates: connection success, pool membership, tenant selectable, auto-routing.
 * Persists to localStorage so refresh can restore routing eligibility + verification tasks.
 */

import type { CapabilityEvidenceItem } from "./capability-evidence.ts";
import type { CanonicalCapabilityId } from "./capability-ids.ts";

export type AutoRoutingAdmission = "disabled" | "eligible" | "restricted" | "paused";

export type ModelAdmissionRecord = {
  modelRef: string;
  /** Fingerprint of endpoint/protocol/modelId at last successful connection. */
  connectionFingerprint?: string;
  connectionVerifiedAt?: number;
  /** Explicit tenant-selectable flag — independent of allowlist/recommendation pool. */
  tenantSelectable: boolean;
  autoRouting: AutoRoutingAdmission;
  /** Task categories this model may auto-route into when eligible. */
  autoRoutingTaskCategories: string[];
  /** Why auto-routing is restricted / paused. */
  autoRoutingReason?: string;
  capabilityEvidence: CapabilityEvidenceItem[];
  updatedAt: number;
};

export type CapabilityVerificationTask = {
  taskId: string;
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial";
  createdAt: number;
  updatedAt: number;
  /** Per-capability outcomes once finished. */
  results?: CapabilityEvidenceItem[];
  error?: string;
  /** Estimated call budget hint shown near the button. */
  estimatedCalls?: number;
};

const STORAGE_KEY = "openbot.platform.modelAdmission.v1";
const TASK_STORAGE_KEY = "openbot.platform.modelVerificationTasks.v1";

type StoreShape = Record<string, ModelAdmissionRecord>;
type TaskStoreShape = Record<string, CapabilityVerificationTask>;

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function readStore(): StoreShape {
  if (!canUseStorage()) {
    return memoryStore;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape) {
  memoryStore = store;
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private mode
  }
}

function readTasks(): TaskStoreShape {
  if (!canUseStorage()) {
    return memoryTasks;
  }
  try {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as TaskStoreShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTasks(store: TaskStoreShape) {
  memoryTasks = store;
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

let memoryStore: StoreShape = {};
let memoryTasks: TaskStoreShape = {};

export function __resetModelAdmissionStoreForTest() {
  memoryStore = {};
  memoryTasks = {};
  if (canUseStorage()) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TASK_STORAGE_KEY);
  }
}

function defaultRecord(modelRef: string): ModelAdmissionRecord {
  return {
    modelRef,
    tenantSelectable: false,
    autoRouting: "disabled",
    autoRoutingTaskCategories: [],
    capabilityEvidence: [],
    updatedAt: Date.now(),
  };
}

export function getModelAdmission(modelRef: string): ModelAdmissionRecord {
  const key = modelRef.trim();
  const store = { ...memoryStore, ...readStore() };
  memoryStore = store;
  return store[key] ? { ...store[key] } : defaultRecord(key);
}

export function upsertModelAdmission(
  modelRef: string,
  patch: Partial<Omit<ModelAdmissionRecord, "modelRef">>,
): ModelAdmissionRecord {
  const key = modelRef.trim();
  const store = { ...memoryStore, ...readStore() };
  const prev = store[key] ?? defaultRecord(key);
  const next: ModelAdmissionRecord = {
    ...prev,
    ...patch,
    modelRef: key,
    updatedAt: Date.now(),
  };
  store[key] = next;
  writeStore(store);
  return { ...next };
}

export function setTenantSelectable(modelRef: string, nextValue: boolean) {
  return upsertModelAdmission(modelRef, { tenantSelectable: nextValue });
}

export function setAutoRoutingAdmission(
  modelRef: string,
  autoRouting: AutoRoutingAdmission,
  opts?: { reason?: string; taskCategories?: string[] },
) {
  return upsertModelAdmission(modelRef, {
    autoRouting,
    ...(opts?.reason !== undefined ? { autoRoutingReason: opts.reason } : {}),
    ...(opts?.taskCategories ? { autoRoutingTaskCategories: opts.taskCategories } : {}),
  });
}

export function listVerificationTasks(modelRef?: string): CapabilityVerificationTask[] {
  const store = { ...memoryTasks, ...readTasks() };
  memoryTasks = store;
  const all = Object.values(store);
  if (!modelRef) {
    return all.toSorted((a, b) => b.updatedAt - a.updatedAt);
  }
  const key = modelRef.trim();
  return all.filter((task) => task.modelRef === key).toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export function getVerificationTask(taskId: string): CapabilityVerificationTask | null {
  const store = { ...memoryTasks, ...readTasks() };
  memoryTasks = store;
  return store[taskId] ? { ...store[taskId] } : null;
}

export function saveVerificationTask(task: CapabilityVerificationTask) {
  const store = { ...memoryTasks, ...readTasks() };
  store[task.taskId] = task;
  writeTasks(store);
  return { ...task };
}

export function autoRoutingLabel(value: AutoRoutingAdmission): string {
  switch (value) {
    case "disabled":
      return "未启用";
    case "eligible":
      return "可参与";
    case "restricted":
      return "受限";
    case "paused":
      return "暂停";
  }
}
