import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHomePrefix, resolveRequiredHomeDir } from "../infra/home-dir.js";
import {
  ensurePortableCanonicalStoreWithFsm,
  type PortableCanonicalEnsureResult,
} from "./cogniweave-migration.js";
import type { DataMode, OpenBotConfig } from "./types.js";

/**
 * OpenBot Data Space resolution + initialization.
 *
 * Implements Phase 1 of the data-directory product spec
 * (docs/design/openbot-data-directory-product-spec-2026-07-10.md) and the frozen
 * data model (docs/design/openbot-data-space-model-v1-2026-07-10.md).
 *
 * The Data Space (`data.root`, default `~/OpenBot`) is the user-visible, migratable,
 * exportable data root. It is deliberately separate from the system state dir
 * (`~/.openbot`) which holds credentials, identity, and runtime sessions and is never
 * user-migratable.
 *
 * IMPORTANT (Phase 1 guardrail P1-NO-01): this module does NOT drive
 * `resolveAgentWorkspaceDir`. It provides first-class `data.*` resolution + the
 * install-time tree so the data-directory UI, doctor, and (Phase 2) the migration
 * engine share one source of truth.
 */

/** Current Data Space layout version (Data Space model §7.1). */
export const DATA_SCHEMA_VERSION = 1;

/** Folder name for the default Data Root under the user's home. */
export const DEFAULT_DATA_ROOT_DIRNAME = "OpenBot";

const DATA_ROOT_ENV_KEYS = ["OPENBOT_DATA_ROOT", "OPENCLAW_DATA_ROOT"] as const;

const META_DIRNAME = ".meta";
const MANIFEST_FILENAME = "manifest.json";
/** Portable CogniWeave canonical tree under Data Space (CW2-P1-02). */
const COGNIWEAVE_META_DIRNAME = "cogniweave";
const COGNIWEAVE_CANONICAL_FILENAME = "canonical.sqlite";
const COGNIWEAVE_MIGRATION_STATE_FILENAME = "migration_state.json";

function envHomedir(env: NodeJS.ProcessEnv): () => string {
  return () => resolveRequiredHomeDir(env, os.homedir);
}

function firstEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** Expand `~` and resolve to an absolute path, honoring OPENBOT_HOME/OPENCLAW_HOME. */
export function expandDataPath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    const expanded = expandHomePrefix(trimmed, {
      home: resolveRequiredHomeDir(env, homedir),
      env,
      homedir,
    });
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

/**
 * Default Data Root: `$OPENBOT_DATA_ROOT` override, else `~/OpenBot`.
 * This is what install/onboard writes into `data.root` on a fresh setup.
 */
export function resolveDefaultDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  const override = firstEnvValue(env, DATA_ROOT_ENV_KEYS);
  if (override) {
    return expandDataPath(override, env, homedir);
  }
  return path.join(resolveRequiredHomeDir(env, homedir), DEFAULT_DATA_ROOT_DIRNAME);
}

/** Effective Data Root: configured `data.root` (expanded) or the default. */
export function resolveDataRoot(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  const configured = cfg?.data?.root?.trim();
  if (configured) {
    return expandDataPath(configured, env, homedir);
  }
  return resolveDefaultDataRoot(env, homedir);
}

/** Storage mode. Unset defaults to "local" (on-disk). "managed" = SaaS-hosted. */
export function resolveDataMode(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DataMode {
  const envMode = env.OPENBOT_DATA_MODE?.trim() || env.OPENCLAW_DATA_MODE?.trim() || "";
  if (envMode === "managed" || envMode === "local") {
    return envMode;
  }
  return cfg?.data?.mode === "managed" ? "managed" : "local";
}

/** True when the Data Space is SaaS-managed (no disk exposure to employees). */
export function isManagedDataMode(cfg: OpenBotConfig | undefined): boolean {
  return resolveDataMode(cfg) === "managed";
}

/**
 * Shared-gateway multi-tenant addressing (spec D5 / P4).
 * Requires managed data mode AND OPENBOT_MULTITENANT=1 (or true/yes/on).
 * When off, managed deployments keep single-root / global control-plane paths
 * (one tenant per process remains safe without logical isolation).
 */
export function isSharedTenantAddressingEnabled(
  cfg?: OpenBotConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isManagedDataMode(cfg)) {
    return false;
  }
  const raw =
    env.OPENBOT_MULTITENANT?.trim() ||
    env.OPENCLAW_MULTITENANT?.trim() ||
    env.OPENBOT_MULTI_TENANT?.trim() ||
    "";
  const flag = raw.toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

/** Rebuildable cache dir: configured `data.cacheDir` (expanded) or `{root}/cache`. */
export function resolveDataCacheDir(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  const configured = cfg?.data?.cacheDir?.trim();
  if (configured) {
    return expandDataPath(configured, env, homedir);
  }
  return path.join(resolveDataRoot(cfg, env, homedir), "cache");
}

/**
 * Minimal Data Space subdirectories created on install (Data Space model §3,
 * product spec §4.1). Kept intentionally small in Phase 1 (`cache/` is rebuildable,
 * `.meta/` carries the manifest). Per-agent Agent Spaces are created lazily.
 */
export function resolveDataSpaceSubdirs(root: string): string[] {
  const cogniweaveMeta = resolveCogniWeaveMetaDir(root);
  return [
    path.join(root, "agents"),
    path.join(root, "shared", "knowledge"),
    path.join(root, "shared", "templates"),
    path.join(root, "memory", "personal"),
    path.join(root, "cache"),
    path.join(root, META_DIRNAME),
    cogniweaveMeta,
    path.join(cogniweaveMeta, "migrations"),
    path.join(cogniweaveMeta, "backups"),
  ];
}

export function resolveDataSpaceManifestPath(root: string): string {
  return path.join(root, META_DIRNAME, MANIFEST_FILENAME);
}

/** `{dataRoot}/.meta/cogniweave` — portable canonical + migration state. */
export function resolveCogniWeaveMetaDir(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), META_DIRNAME, COGNIWEAVE_META_DIRNAME);
}

/** Target path for portable CogniWeave canonical SQLite. */
export function resolvePortableCanonicalStorePath(dataRoot: string): string {
  return path.join(resolveCogniWeaveMetaDir(dataRoot), COGNIWEAVE_CANONICAL_FILENAME);
}

/** Durable cutover record for stateDir → Data Space canonical move. */
export function resolveCogniWeaveMigrationStatePath(dataRoot: string): string {
  return path.join(resolveCogniWeaveMetaDir(dataRoot), COGNIWEAVE_MIGRATION_STATE_FILENAME);
}

/** Legacy non-portable location under the system state dir. */
export function resolveLegacyCogniWeaveStorePath(stateDir: string): string {
  return path.join(path.resolve(stateDir), COGNIWEAVE_META_DIRNAME, COGNIWEAVE_CANONICAL_FILENAME);
}

export type {
  CogniWeaveMigrationPhase,
  CogniWeaveMigrationState,
  CogniWeaveMigrationTransition,
} from "./cogniweave-migration.js";

export type EnsurePortableCanonicalStoreResult = PortableCanonicalEnsureResult;

export {
  assertCogniWeaveWritesAllowed,
  CogniWeaveWriteFrozenError,
  isCogniWeaveCanonicalWriteFrozen,
  readCogniWeaveMigrationState,
  switchBackPortableCanonicalStore,
} from "./cogniweave-migration.js";

/**
 * Resolve the CogniWeave canonical store under Data Space and lazily cut over
 * from `~/.openbot/cogniweave/canonical.sqlite` when present.
 *
 * Explicit `configuredStorePath` wins (tests / advanced installs). Does not
 * delete the legacy file — switch-back remains possible via
 * `switchBackPortableCanonicalStore`.
 *
 * CW2-P1-02c: durable FSM with freeze_writes, crash rollback/roll-forward, and
 * checksum integrity before cutover_switched.
 */
export function ensurePortableCanonicalStore(params: {
  dataRoot: string;
  stateDir: string;
  configuredStorePath?: string;
}): EnsurePortableCanonicalStoreResult {
  // Ensure Data Space tree exists for portable meta (manifest + mode bits).
  ensureDataSpace({ root: params.dataRoot });
  return ensurePortableCanonicalStoreWithFsm(params);
}

export type DataSpaceManifest = {
  schemaVersion: number;
  createdAt: string;
  createdByVersion?: string;
  mode: DataMode;
};

export type EnsureDataSpaceResult = {
  root: string;
  created: boolean;
  manifestPath: string;
  manifest: DataSpaceManifest;
};

function readManifest(manifestPath: string): DataSpaceManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DataSpaceManifest>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      schemaVersion:
        typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : DATA_SCHEMA_VERSION,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      createdByVersion:
        typeof parsed.createdByVersion === "string" ? parsed.createdByVersion : undefined,
      mode: parsed.mode === "managed" ? "managed" : "local",
    };
  } catch {
    return null;
  }
}

function writeManifest(manifestPath: string, manifest: DataSpaceManifest): void {
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, payload, { encoding: "utf-8" });
}

/**
 * Idempotently create the minimal Data Space tree + `.meta/manifest.json`.
 *
 * - Never touches credentials/identity/runtime sessions (those live in the state dir).
 * - Safe to call repeatedly; only creates what is missing and writes the manifest once.
 * - Applies `chmod 700` semantics to the root on POSIX (product spec §11).
 */
export function ensureDataSpace(params: {
  root: string;
  mode?: DataMode;
  createdByVersion?: string;
}): EnsureDataSpaceResult {
  const root = path.resolve(params.root);
  const mode: DataMode = params.mode === "managed" ? "managed" : "local";
  const rootExisted = fs.existsSync(root);

  fs.mkdirSync(root, { recursive: true });
  // Restrict the data root to the owner (chmod 700 semantics). Best-effort on POSIX.
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(root, 0o700);
    } catch {
      // Non-fatal: permission tightening is advisory here and re-checked by doctor.
    }
  }

  for (const dir of resolveDataSpaceSubdirs(root)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const manifestPath = resolveDataSpaceManifestPath(root);
  const existingManifest = readManifest(manifestPath);
  const manifest: DataSpaceManifest = existingManifest ?? {
    schemaVersion: DATA_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    createdByVersion: params.createdByVersion,
    mode,
  };
  if (!existingManifest) {
    writeManifest(manifestPath, manifest);
  }

  return {
    root,
    created: !rootExisted,
    manifestPath,
    manifest,
  };
}

export type InitDataSpaceResult = {
  /** Config with `data.*` defaults applied (unchanged reference when nothing changed). */
  cfg: OpenBotConfig;
  /** True when the config `data` block was modified and should be persisted. */
  changed: boolean;
  /** On-disk ensure result (absent in managed/SaaS mode). */
  ensured?: EnsureDataSpaceResult;
};

/**
 * Install/onboard-time Data Space initialization (product spec §8.1).
 *
 * - Fills in `data.root` (default `~/OpenBot`), `data.mode` ("local"), and
 *   `data.schemaVersion` when missing, returning a patched config to persist.
 * - Creates the minimal on-disk tree + manifest for local mode.
 * - SaaS/managed mode (`data.mode === "managed"`): does NOT create a local tree and
 *   does NOT rewrite the server-provisioned root (product spec §8.2).
 *
 * Idempotent: re-running with an already-initialized config leaves it unchanged.
 */
export function initDataSpaceForConfig(
  cfg: OpenBotConfig,
  opts?: { createdByVersion?: string; env?: NodeJS.ProcessEnv },
): InitDataSpaceResult {
  const env = opts?.env ?? process.env;
  // Managed (SaaS): the tenant/user root is provisioned server-side; never touch disk here.
  if (resolveDataMode(cfg) === "managed") {
    return { cfg, changed: false };
  }

  const existing = cfg.data;
  const root = resolveDataRoot(cfg, env);
  const nextData = {
    ...existing,
    root: existing?.root?.trim() ? existing.root : root,
    mode: existing?.mode ?? ("local" as const),
    schemaVersion: existing?.schemaVersion ?? DATA_SCHEMA_VERSION,
  };
  const changed =
    !existing ||
    existing.root !== nextData.root ||
    existing.mode !== nextData.mode ||
    existing.schemaVersion !== nextData.schemaVersion;

  const ensured = ensureDataSpace({
    root,
    mode: "local",
    createdByVersion: opts?.createdByVersion,
  });

  return {
    cfg: changed ? { ...cfg, data: nextData } : cfg,
    changed,
    ensured,
  };
}
