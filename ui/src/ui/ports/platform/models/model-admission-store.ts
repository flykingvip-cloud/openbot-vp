/**
 * Frontend admission / draft store.
 *
 * Formal platform admission (tenant selectable, auto-routing eligibility) must come
 * from backend facts (`platformEffective: true` after models.admission.* RPC sync).
 * Local tenant/autoRouting drafts stay non-effective until synced from gateway.
 * `platformEffective` / status `applied` means the admission *store* record is real —
 * it feeds admin UX + dry-run preview only; live agent/chat model selection does not
 * read this eligibility yet.
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
  /**
   * True when values were synced from gateway admission RPC (platform store effective).
   * Local drafts stay false / undefined and must not be shown as live policy.
   * Does NOT mean live chat/agent routing already consumes this eligibility.
   */
  platformEffective?: boolean;
};

export type CapabilityVerificationTask = {
  taskId: string;
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "partial"
    /** In-flight execution lost (refresh / service restart); safe to retry. */
    | "interrupted";
  createdAt: number;
  updatedAt: number;
  /** Per-capability outcomes once finished (or historical stale outcomes). */
  results?: CapabilityEvidenceItem[];
  error?: string;
  /** Estimated call budget hint shown near the button. */
  estimatedCalls?: number;
  /** Config fingerprint captured at create time; finish must still match. */
  configFingerprint?: string;
  /**
   * Monotonic per-model execution version at create time.
   * A later task for the same modelRef bumps this; older finishes must not
   * overwrite newer formal evidence.
   */
  executionGeneration?: number;
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

/** Per-model execution generation (memory). */
const executionGenerationByModel: Record<string, number> = {};

/** Task ids started in the current page/service process (not orphans from a prior refresh). */
const liveVerificationTaskIds = new Set<string>();

export function markVerificationTaskLive(taskId: string) {
  liveVerificationTaskIds.add(taskId);
}

export function clearVerificationTaskLive(taskId: string) {
  liveVerificationTaskIds.delete(taskId);
}

export function isVerificationTaskLive(taskId: string): boolean {
  return liveVerificationTaskIds.has(taskId);
}

export function __clearLiveVerificationTasksForTest() {
  liveVerificationTaskIds.clear();
}

export function __resetModelAdmissionStoreForTest() {
  memoryStore = {};
  memoryTasks = {};
  liveVerificationTaskIds.clear();
  for (const key of Object.keys(executionGenerationByModel)) {
    delete executionGenerationByModel[key];
  }
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
    platformEffective: false,
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

export function __resetExecutionGenerationsForTest() {
  for (const key of Object.keys(executionGenerationByModel)) {
    delete executionGenerationByModel[key];
  }
}

/** Allocate next execution generation for a modelRef (create-time). */
export function nextExecutionGeneration(modelRef: string): number {
  const key = modelRef.trim();
  const next = (executionGenerationByModel[key] ?? 0) + 1;
  executionGenerationByModel[key] = next;
  return next;
}

export function currentExecutionGeneration(modelRef: string): number {
  return executionGenerationByModel[modelRef.trim()] ?? 0;
}

/**
 * Mark queued/running tasks as interrupted after refresh or service restart.
 * Memory timers/Promises are gone; leaving them "running" would hang forever.
 * Prefer interruptOrphanedInFlightVerificationTasks so live page tasks survive.
 */
export function interruptInFlightVerificationTasks(
  reason = "已中断，可重试（页面刷新或执行上下文丢失）",
): CapabilityVerificationTask[] {
  return interruptMatchingInFlightVerificationTasks(() => true, reason);
}

/**
 * Interrupt only persisted in-flight tasks that are NOT live in this process.
 * Use on page/service init after refresh: prior-page orphans end; current-page
 * running tasks (registered via markVerificationTaskLive) keep going.
 * Do not call the full interrupt when merely opening a model detail drawer.
 */
export function interruptOrphanedInFlightVerificationTasks(
  reason = "已中断，可重试（页面刷新或执行上下文丢失）",
): CapabilityVerificationTask[] {
  return interruptMatchingInFlightVerificationTasks(
    (taskId) => !liveVerificationTaskIds.has(taskId),
    reason,
  );
}

function interruptMatchingInFlightVerificationTasks(
  shouldInterrupt: (taskId: string) => boolean,
  reason: string,
): CapabilityVerificationTask[] {
  const store = { ...memoryTasks, ...readTasks() };
  memoryTasks = store;
  const out: CapabilityVerificationTask[] = [];
  for (const task of Object.values(store)) {
    if ((task.status === "queued" || task.status === "running") && shouldInterrupt(task.taskId)) {
      const next: CapabilityVerificationTask = {
        ...task,
        status: "interrupted",
        error: reason,
        updatedAt: Date.now(),
      };
      store[task.taskId] = next;
      liveVerificationTaskIds.delete(task.taskId);
      out.push({ ...next });
    }
  }
  if (out.length > 0) {
    writeTasks(store);
  }
  return out;
}

/**
 * Merge formal evidence carefully:
 * - untested / checker_unavailable / pending never overwrite existing valid evidence
 * - reuseExistingEvidence keeps prior passed identity (verifiedAt / testVersion)
 * - actual passed/failed replace by capability id
 */
export function mergeFormalCapabilityEvidence(
  modelRef: string,
  results: CapabilityEvidenceItem[],
  opts?: {
    reuseHints?: Partial<
      Record<string, { verifiedAt?: number; testVersion?: string; sourceNote?: string }>
    >;
  },
): ModelAdmissionRecord {
  const admission = getModelAdmission(modelRef);
  const byId = new Map(admission.capabilityEvidence.map((item) => [item.id, item]));
  for (const item of results) {
    if (
      item.status === "untested" ||
      item.status === "checker_unavailable" ||
      item.status === "pending"
    ) {
      // Do not clobber existing passed/failed/expired evidence.
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
      continue;
    }
    const hint = opts?.reuseHints?.[item.id];
    const prev = byId.get(item.id);
    if (hint && prev?.status === "passed" && item.status === "passed") {
      byId.set(item.id, {
        ...prev,
        ...item,
        verifiedAt: hint.verifiedAt ?? prev.verifiedAt,
        testVersion: hint.testVersion ?? prev.testVersion,
        sourceNote: hint.sourceNote ?? item.sourceNote ?? prev.sourceNote,
      });
      continue;
    }
    byId.set(item.id, item);
  }
  return upsertModelAdmission(modelRef, {
    capabilityEvidence: Array.from(byId.values()),
  });
}

export function autoRoutingLabel(value: AutoRoutingAdmission): string {
  switch (value) {
    case "disabled":
      return "未启用";
    case "eligible":
      return "可参与（预览）";
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
