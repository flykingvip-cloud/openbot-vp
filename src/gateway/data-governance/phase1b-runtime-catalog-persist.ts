/**
 * Phase 1B runtime Catalog persist helpers.
 *
 * Item 2: admit classified authority rows into `{stateDir}/data-governance/catalog.json`.
 * Item 5: persist existing user-owned workspace rows via put + compareAndPut.
 * Host ~/.openbot / default stateDir writes stay denied unless the explicit
 * host-write env is set. Not LIVE, not unlock, not item 5 met.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStateDir } from "../../config/paths.js";
import { getOrCreateFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  persistClassifiedAuthorityRows,
  type AuthorityCandidateRow,
  type PersistClassifiedResult,
} from "./phase1b-classified-persist.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type { CatalogRecord } from "./types.js";

export const RUNTIME_CATALOG_HOST_WRITE_ENV = "OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE";

export function assertRuntimeCatalogStateDirAllowed(
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const resolved = path.resolve(stateDir);
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error("runtime_catalog_state_dir_required");
  }
  if (env[RUNTIME_CATALOG_HOST_WRITE_ENV] === "1") {
    return;
  }
  const homeOpenbot = path.resolve(os.homedir(), ".openbot");
  const defaultState = path.resolve(resolveStateDir(env));
  if (
    resolved === defaultState ||
    resolved === homeOpenbot ||
    resolved.startsWith(`${homeOpenbot}${path.sep}`)
  ) {
    throw new Error("runtime_catalog_host_write_forbidden");
  }
}

export async function persistClassifiedAuthorityRowsToRuntimeCatalog(params: {
  stateDir: string;
  candidates: AuthorityCandidateRow[];
  rejected?: Array<{ reason?: string; resourceId?: string; workspaceKind?: string }>;
  now?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PersistClassifiedResult & { catalogPath: string }> {
  assertRuntimeCatalogStateDirAllowed(params.stateDir, params.env ?? process.env);
  const catalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const store = getOrCreateFileDataGovernanceCatalogStore({ storePath: catalogPath });
  const persist = await persistClassifiedAuthorityRows({
    store,
    candidates: params.candidates,
    rejected: params.rejected,
    now: params.now,
  });
  return { ...persist, catalogPath };
}

export const RUNTIME_CATALOG_WRITE_DECISION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/design/evidence/memory-workspace-phase1b-item5-runtime-write-decision.json",
);

export type RuntimeCatalogWriteDecision = {
  runtimeCatalogWrite: "authorized" | "not-authorized";
  path: string;
  executed: boolean;
  wiredToProductionResolver: boolean;
  implicitResolveStateDir: "forbidden" | "allowed";
  live: string;
};

export function loadRuntimeCatalogWriteDecision(
  filePath: string = RUNTIME_CATALOG_WRITE_DECISION_PATH,
): RuntimeCatalogWriteDecision {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as RuntimeCatalogWriteDecision;
}

export function assertRuntimeCatalogWriteAuthorized(
  decision: RuntimeCatalogWriteDecision = loadRuntimeCatalogWriteDecision(),
): void {
  if (decision.runtimeCatalogWrite !== "authorized") {
    throw new Error("runtime_catalog_write_not_authorized");
  }
  if (decision.path !== "authorize-compare-and-put-user-owned") {
    throw new Error("runtime_catalog_write_path_forbidden");
  }
  if (decision.wiredToProductionResolver) {
    throw new Error("runtime_catalog_write_must_not_flip_wire");
  }
  if (decision.implicitResolveStateDir !== "forbidden") {
    throw new Error("runtime_catalog_implicit_resolve_state_dir_must_stay_forbidden");
  }
  if (decision.live !== "forbidden") {
    throw new Error("runtime_catalog_live_must_stay_forbidden");
  }
}

const USER_OWNED_ASSET_ID = /^ws:([^:]+):user:([^:]+):asset:(.+)$/;

export type RuntimeCatalogPersistResult = {
  persisted: string[];
  compareAndPutConfirmed: string[];
  skipped: Array<{ resourceId: string; reason: string }>;
};

export function assertEvidenceOnlyRuntimeCatalogStateDir(stateDir: string): void {
  const resolved = path.resolve(stateDir);
  const live = path.resolve(resolveStateDir());
  if (resolved === live) {
    throw new Error("runtime_catalog_live_state_dir_forbidden");
  }
  const liveCatalog = path.resolve(resolveDataGovernanceCatalogPath(live));
  const targetCatalog = path.resolve(resolveDataGovernanceCatalogPath(resolved));
  if (targetCatalog === liveCatalog) {
    throw new Error("runtime_catalog_live_catalog_path_forbidden");
  }
  const openbotSeg = `${path.sep}.openbot`;
  if (
    resolved === path.join(os.homedir(), ".openbot") ||
    resolved.endsWith(openbotSeg) ||
    resolved.includes(`${openbotSeg}${path.sep}`)
  ) {
    throw new Error("runtime_catalog_openbot_state_dir_forbidden");
  }
}

export function isUserOwnedAssetWorkspace(record: CatalogRecord): boolean {
  if (record.envelope.resourceType !== "workspace") {
    return false;
  }
  if (record.envelope.owner.kind !== "user") {
    return false;
  }
  const match = USER_OWNED_ASSET_ID.exec(record.envelope.resourceId);
  const agentAssetId = match?.[3]?.trim();
  return Boolean(match && agentAssetId);
}

function admitRecord(record: CatalogRecord, now: string): CatalogRecord {
  return {
    ...record,
    envelope: {
      ...record.envelope,
      governanceVersion: 1,
      createdAt: record.envelope.createdAt,
      updatedAt: now,
    },
  };
}

async function writeUserOwnedRuntimeCatalogRows(params: {
  stateDir: string;
  records: CatalogRecord[];
  now: string;
}): Promise<RuntimeCatalogPersistResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const persisted: string[] = [];
  const compareAndPutConfirmed: string[] = [];
  const skipped: RuntimeCatalogPersistResult["skipped"] = [];

  for (const record of params.records) {
    const resourceId = record.envelope.resourceId;
    if (!isUserOwnedAssetWorkspace(record)) {
      skipped.push({ resourceId, reason: "not_user_owned_asset_workspace" });
      continue;
    }
    const existing = await catalog.get(resourceId);
    if (existing && isUserOwnedAssetWorkspace(existing)) {
      persisted.push(resourceId);
      continue;
    }
    const created = admitRecord(record, params.now);
    await catalog.put(created);
    const next: CatalogRecord = {
      ...created,
      envelope: {
        ...created.envelope,
        governanceVersion: 2,
        updatedAt: params.now,
      },
    };
    const cas = await catalog.compareAndPut({
      resourceId,
      expectedGovernanceVersion: 1,
      next,
    });
    if (!cas.ok) {
      throw new Error(`runtime_catalog_compare_and_put_failed:${cas.conflict}`);
    }
    persisted.push(resourceId);
    compareAndPutConfirmed.push(resourceId);
  }

  return { persisted, compareAndPutConfirmed, skipped };
}

export async function persistUserOwnedRuntimeCatalogRows(params: {
  stateDir: string;
  records: CatalogRecord[];
  now?: string;
}): Promise<RuntimeCatalogPersistResult> {
  // Stamp authorizes an explicit later target. This helper still refuses
  // resolveStateDir() / ~/.openbot so laptop or implicit LIVE is not written.
  assertEvidenceOnlyRuntimeCatalogStateDir(params.stateDir);
  return writeUserOwnedRuntimeCatalogRows({
    stateDir: params.stateDir,
    records: params.records,
    now: params.now ?? "2026-08-18T00:00:00.000Z",
  });
}

export async function persistUserOwnedHostCatalogRows(params: {
  stateDir: string;
  records: CatalogRecord[];
  now?: string;
}): Promise<RuntimeCatalogPersistResult> {
  return writeUserOwnedRuntimeCatalogRows({
    stateDir: params.stateDir,
    records: params.records,
    now: params.now ?? "2026-08-18T00:00:00.000Z",
  });
}

export function liveRuntimeCatalogPresent(stateDir: string = resolveStateDir()): boolean {
  return fs.existsSync(resolveDataGovernanceCatalogPath(stateDir));
}
