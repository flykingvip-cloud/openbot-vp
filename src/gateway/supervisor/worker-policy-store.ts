/**
 * supervisor/worker-policy-store.ts — tenant-scoped worker execution policy (M0.5).
 *
 * Overrides default credentialPolicy + executionPlacement per tenant/worker.
 * Persisted at CONFIG_DIR/openbot-worker-execution-policies.json.
 */

import path from "node:path";
import type { CredentialPolicy, ExecutionPlacement } from "../../fabric/worker/types.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { defaultWorkerExecutionProfile, type WorkerExecutionProfile } from "./worker-profiles.js";

const STORE_VERSION = 1;

export type WorkerExecutionPolicyRecord = {
  tenantId: string;
  workerId: string;
  credentialPolicy: CredentialPolicy;
  executionPlacement: ExecutionPlacement;
  updatedAt: string;
};

interface Store {
  version: number;
  /** key = `${tenantId}:${workerId}` */
  policies: Record<string, WorkerExecutionPolicyRecord>;
}

function policyKey(tenantId: string, workerId: string): string {
  return `${tenantId.trim()}:${workerId.trim().toLowerCase()}`;
}

function createEmptyStore(): Store {
  return { version: STORE_VERSION, policies: {} };
}

export function resolveDefaultWorkerPolicyStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-worker-execution-policies.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultWorkerPolicyStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.policies !== "object" || parsed.policies === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    policies: parsed.policies,
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultWorkerPolicyStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export type WorkerPolicyWriteActor = "enterprise-admin" | "employee" | "session" | "anonymous";

export function resolveWorkerPolicyWriteActor(
  client:
    | {
        sessionKind?: string | null;
        sessionDomain?: string | null;
      }
    | null
    | undefined,
): WorkerPolicyWriteActor {
  if (client?.sessionKind === "enterprise-admin") {
    return "enterprise-admin";
  }
  if (client?.sessionKind === "member" || client?.sessionDomain === "employee") {
    return "employee";
  }
  if (client) {
    return "session";
  }
  return "anonymous";
}

export function assertEnterpriseAdminWorkerPolicyWrite(actor: WorkerPolicyWriteActor): void {
  if (actor !== "enterprise-admin") {
    throw new Error("credential policy and execution placement writes are enterprise-admin only");
  }
}

const VALID_POLICIES = new Set<CredentialPolicy>([
  "enterprise_shared",
  "local_ide_login",
  "seat_personal",
]);
const VALID_PLACEMENTS = new Set<ExecutionPlacement>(["gateway", "node_agent"]);

function readPolicyField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateWorkerExecutionPolicy(input: {
  credentialPolicy: unknown;
  executionPlacement: unknown;
}): WorkerExecutionProfile {
  const credentialPolicy = readPolicyField(input.credentialPolicy) as CredentialPolicy;
  const executionPlacement = readPolicyField(input.executionPlacement) as ExecutionPlacement;
  if (!VALID_POLICIES.has(credentialPolicy)) {
    throw new Error(`invalid credentialPolicy: ${String(input.credentialPolicy)}`);
  }
  if (!VALID_PLACEMENTS.has(executionPlacement)) {
    throw new Error(`invalid executionPlacement: ${String(input.executionPlacement)}`);
  }
  if (credentialPolicy === "seat_personal") {
    throw new Error("seat_personal policy is deferred to P3 billing phase");
  }
  return { credentialPolicy, executionPlacement };
}

export async function listWorkerExecutionPolicies(
  tenantId: string,
  storePath?: string,
): Promise<WorkerExecutionPolicyRecord[]> {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant) {
    return [];
  }
  const store = await loadStore(storePath);
  return Object.values(store.policies)
    .filter((entry) => entry.tenantId === normalizedTenant)
    .toSorted((a, b) => a.workerId.localeCompare(b.workerId));
}

export async function upsertWorkerExecutionPolicy(
  input: {
    tenantId: string;
    workerId: string;
    credentialPolicy: CredentialPolicy;
    executionPlacement: ExecutionPlacement;
    actor: WorkerPolicyWriteActor;
  },
  storePath?: string,
): Promise<WorkerExecutionPolicyRecord> {
  assertEnterpriseAdminWorkerPolicyWrite(input.actor);
  const tenantId = input.tenantId.trim();
  const workerId = input.workerId.trim().toLowerCase();
  if (!tenantId || !workerId) {
    throw new Error("tenantId and workerId are required");
  }
  const profile = validateWorkerExecutionPolicy(input);
  const record: WorkerExecutionPolicyRecord = {
    tenantId,
    workerId,
    credentialPolicy: profile.credentialPolicy,
    executionPlacement: profile.executionPlacement,
    updatedAt: new Date().toISOString(),
  };
  return withLock(async () => {
    const store = await loadStore(storePath);
    store.policies[policyKey(tenantId, workerId)] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function removeWorkerExecutionPolicy(
  tenantId: string,
  workerId: string,
  actor: WorkerPolicyWriteActor,
  storePath?: string,
): Promise<boolean> {
  assertEnterpriseAdminWorkerPolicyWrite(actor);
  const normalizedTenant = tenantId.trim();
  const normalizedWorker = workerId.trim().toLowerCase();
  if (!normalizedTenant || !normalizedWorker) {
    return false;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = policyKey(normalizedTenant, normalizedWorker);
    if (!store.policies[key]) {
      return false;
    }
    delete store.policies[key];
    await saveStore(store, storePath);
    return true;
  });
}

export async function getWorkerExecutionProfile(input: {
  tenantId?: string;
  workerId: string;
  storePath?: string;
}): Promise<WorkerExecutionProfile> {
  const workerId = input.workerId.trim().toLowerCase();
  const tenantId = input.tenantId?.trim();
  if (!tenantId) {
    return defaultWorkerExecutionProfile(workerId);
  }
  const store = await loadStore(input.storePath);
  const record = store.policies[policyKey(tenantId, workerId)];
  if (!record) {
    return defaultWorkerExecutionProfile(workerId);
  }
  return {
    credentialPolicy: record.credentialPolicy,
    executionPlacement: record.executionPlacement,
  };
}
