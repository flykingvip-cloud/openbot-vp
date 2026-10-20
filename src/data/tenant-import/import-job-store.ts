import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";
import type { TenantImportPhase } from "./import-job.js";

/**
 * tenant-import job store (SaaS tenant data architecture §10.4 / §14 `platform.tenant.import.*`).
 *
 * Persists one record per import job so `platform.tenant.import.start` is idempotent by
 * `importJobId` (SAAS-T-02: a retry returns the original result, never a second commit) and so
 * `platform.tenant.import.status` can be queried after the fact. Also supports the §10.4
 * "same package already imported" guard via `(targetTenantId, packageSha256)`. Persisted JSON
 * (CONFIG_DIR), injectable `storePath` for tests — mirrors the billing stores' file pattern.
 */

export const TENANT_IMPORT_JOB_STORE_VERSION = 1;

export type TenantImportJobStatus = "running" | "done" | "failed";

export type TenantImportJobRecord = {
  importJobId: string;
  targetTenantId: string;
  status: TenantImportJobStatus;
  phase: TenantImportPhase;
  packageSha256?: string;
  committedFiles?: number;
  stats?: { stagedFiles: number; rewrittenFiles: number };
  errors?: string[];
  operatorId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TenantImportJobStore = {
  version: number;
  jobs: Record<string, TenantImportJobRecord>;
};

const DEFAULT_FILENAME = "openbot-tenant-import-jobs.json";

export function resolveDefaultTenantImportJobStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_FILENAME);
}

function normalize(parsed: Partial<TenantImportJobStore> | null | undefined): TenantImportJobStore {
  return {
    version: parsed?.version ?? TENANT_IMPORT_JOB_STORE_VERSION,
    jobs: parsed?.jobs ?? {},
  };
}

function resolvePath(storePath?: string): string {
  return storePath?.trim() || resolveDefaultTenantImportJobStorePath();
}

async function loadStore(storePath?: string): Promise<TenantImportJobStore> {
  return normalize(await readJsonFile<Partial<TenantImportJobStore>>(resolvePath(storePath)));
}

async function saveStore(store: TenantImportJobStore, storePath?: string): Promise<void> {
  await writeJsonAtomic(resolvePath(storePath), {
    ...store,
    version: TENANT_IMPORT_JOB_STORE_VERSION,
  });
}

export async function getTenantImportJob(
  importJobId: string,
  storePath?: string,
): Promise<TenantImportJobRecord | null> {
  const store = await loadStore(storePath);
  return store.jobs[importJobId] ?? null;
}

/** §10.4: find a completed import of the same package into the same tenant (duplicate guard). */
export async function findCompletedImportByPackage(
  targetTenantId: string,
  packageSha256: string | undefined,
  storePath?: string,
): Promise<TenantImportJobRecord | null> {
  if (!packageSha256) {
    return null;
  }
  const store = await loadStore(storePath);
  return (
    Object.values(store.jobs).find(
      (job) =>
        job.targetTenantId === targetTenantId &&
        job.packageSha256 === packageSha256 &&
        job.status === "done",
    ) ?? null
  );
}

/** Insert or update a job record; `createdAt` is preserved across updates, `updatedAt` refreshed. */
export async function upsertTenantImportJob(
  record: Omit<TenantImportJobRecord, "createdAt" | "updatedAt"> & { createdAt?: string },
  storePath?: string,
): Promise<TenantImportJobRecord> {
  const store = await loadStore(storePath);
  const now = new Date().toISOString();
  const existing = store.jobs[record.importJobId];
  const next: TenantImportJobRecord = {
    ...record,
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    updatedAt: now,
  };
  store.jobs[record.importJobId] = next;
  await saveStore(store, storePath);
  return next;
}

export async function listTenantImportJobs(storePath?: string): Promise<TenantImportJobRecord[]> {
  const store = await loadStore(storePath);
  return Object.values(store.jobs).toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
