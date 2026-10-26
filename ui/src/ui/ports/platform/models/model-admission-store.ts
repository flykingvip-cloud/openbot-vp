/**
 * Frontend admission / draft store.
 *
 * Formal platform admission (tenant selectable, auto-routing eligibility) must come
 * from backend facts. Until those RPCs land, local tenant/autoRouting values are
 * DRAFT ONLY and must not be rendered as platform-effective status.
 *
 * Formal capabilityEvidence is for real verification results only.
 * demoCapabilityEvidence is isolated UI-demo output and never feeds verified sets.
 * On read, legacy stub-v1 / stub-sourced rows left in capabilityEvidence are
 * migrated into demoCapabilityEvidence and persisted (no admin clear required).
 */

import type { CapabilityEvidenceItem } from "./capability-evidence.ts";
import type { CanonicalCapabilityId } from "./capability-ids.ts";
import type { PlatformModelCallType } from "./platform-model-definition.ts";

export type AutoRoutingAdmission = "disabled" | "eligible" | "restricted" | "paused";

export type ModelAdmissionRecord = {
  modelRef: string;
  /** Fingerprint of endpoint/protocol/modelId at last successful connection. */
  connectionFingerprint?: string;
  connectionVerifiedAt?: number;
  /**
   * Local draft only — not platform-effective until backend admission RPC lands.
   * UI must not display this as "允许" / live tenant policy.
   */
  tenantSelectable: boolean;
  /**
   * Local draft only — not platform-effective until backend admission RPC lands.
   * UI must not display draft "eligible" as live auto-routing admission.
   */
  autoRouting: AutoRoutingAdmission;
  /** Task categories this model may auto-route into when eligible. */
  autoRoutingTaskCategories: string[];
  /** Why auto-routing is restricted / paused. */
  autoRoutingReason?: string;
  /** Platform capability archive: executor call type (not ModelDefinitionSchema). */
  executorCallType?: PlatformModelCallType;
  /** Formal verification evidence only (never stub/demo results). */
  capabilityEvidence: CapabilityEvidenceItem[];
  /**
   * Isolated UI-demo verification results. Must not enter verifiedCapabilityIds
   * or formal admission judgments.
   */
  demoCapabilityEvidence?: CapabilityEvidenceItem[];
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

/** Identify legacy stub / UI-demo evidence that must not stay in formal archive. */
export function isStubOrDemoEvidence(item: CapabilityEvidenceItem): boolean {
  const version = (item.testVersion ?? "").trim().toLowerCase();
  if (version.startsWith("stub") || version.includes("stub-")) {
    return true;
  }
  const note = `${item.sourceNote ?? ""} ${item.failureReason ?? ""}`.toLowerCase();
  if (/\bstub\b|模拟|演示/.test(note)) {
    return true;
  }
  return false;
}

/**
 * Move stub/demo rows out of capabilityEvidence into demoCapabilityEvidence.
 * Preserves genuine formal evidence. Idempotent.
 */
export function migrateStubEvidenceOutOfFormal(record: ModelAdmissionRecord): {
  record: ModelAdmissionRecord;
  changed: boolean;
} {
  const formal: CapabilityEvidenceItem[] = [];
  const demoted: CapabilityEvidenceItem[] = [];
  for (const item of record.capabilityEvidence ?? []) {
    if (isStubOrDemoEvidence(item)) {
      demoted.push(item);
    } else {
      formal.push(item);
    }
  }
  if (demoted.length === 0) {
    return { record, changed: false };
  }
  const demoById = new Map((record.demoCapabilityEvidence ?? []).map((item) => [item.id, item]));
  for (const item of demoted) {
    // Existing demo entries (new write path) win over demoted legacy duplicates.
    if (!demoById.has(item.id)) {
      demoById.set(item.id, item);
    }
  }
  return {
    record: {
      ...record,
      capabilityEvidence: formal,
      demoCapabilityEvidence: Array.from(demoById.values()),
    },
    changed: true,
  };
}

function migrateLoadedStore(store: StoreShape): StoreShape {
  let changed = false;
  const next: StoreShape = {};
  for (const [key, raw] of Object.entries(store)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const base = {
      ...defaultRecord(key),
      ...raw,
      modelRef: typeof raw.modelRef === "string" ? raw.modelRef : key,
      capabilityEvidence: Array.isArray(raw.capabilityEvidence) ? raw.capabilityEvidence : [],
      ...(Array.isArray(raw.demoCapabilityEvidence)
        ? { demoCapabilityEvidence: raw.demoCapabilityEvidence }
        : {}),
    } satisfies ModelAdmissionRecord;
    const migrated = migrateStubEvidenceOutOfFormal(base);
    next[key] = migrated.record;
    if (migrated.changed) {
      changed = true;
    }
  }
  if (changed) {
    writeStore(next);
  }
  return next;
}

export function getModelAdmission(modelRef: string): ModelAdmissionRecord {
  const key = modelRef.trim();
  const store = migrateLoadedStore({ ...memoryStore, ...readStore() });
  memoryStore = store;
  return store[key] ? { ...store[key] } : defaultRecord(key);
}

export function upsertModelAdmission(
  modelRef: string,
  patch: Partial<Omit<ModelAdmissionRecord, "modelRef">>,
): ModelAdmissionRecord {
  const key = modelRef.trim();
  const store = migrateLoadedStore({ ...memoryStore, ...readStore() });
  const prev = store[key] ?? defaultRecord(key);
  const drafted: ModelAdmissionRecord = {
    ...prev,
    ...patch,
    modelRef: key,
    updatedAt: Date.now(),
  };
  const { record: next } = migrateStubEvidenceOutOfFormal(drafted);
  store[key] = next;
  writeStore(store);
  return { ...next };
}

export function setTenantSelectable(modelRef: string, nextValue: boolean) {
  return upsertModelAdmission(modelRef, { tenantSelectable: nextValue });
}

/** Persist executor call type into the platform capability archive (not model config). */
export function setExecutorCallTypeArchive(
  modelRef: string,
  callType: PlatformModelCallType | undefined,
) {
  return upsertModelAdmission(modelRef, callType ? { executorCallType: callType } : {});
}

/**
 * Expire formal capability evidence and restrict draft auto-routing when config changes.
 * Does not touch demoCapabilityEvidence.
 */
export function expireFormalCapabilityEvidence(modelRef: string, reason: string) {
  const admission = getModelAdmission(modelRef);
  const next = admission.capabilityEvidence.map((item) =>
    item.status === "passed"
      ? {
          ...item,
          status: "expired" as const,
          failureReason: reason,
        }
      : item,
  );
  return upsertModelAdmission(modelRef, {
    capabilityEvidence: next,
    autoRouting: admission.autoRouting === "eligible" ? "restricted" : admission.autoRouting,
    autoRoutingReason: admission.autoRouting === "eligible" ? reason : admission.autoRoutingReason,
  });
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

/** Formal UI label when backend admission RPC is not wired. */
export function backendAdmissionUnavailableLabel(): string {
  return "尚未接入";
}
