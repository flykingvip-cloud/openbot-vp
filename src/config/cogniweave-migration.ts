import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Durable CogniWeave canonical cutover FSM (CW2-P1-02c).
 *
 * Persists under `{dataRoot}/.meta/cogniweave/migration_state.json`.
 * Until `cutover_switched`, the legacy stateDir store remains authority.
 *
 * Path helpers here mirror `data-space.ts` so this module stays free of
 * circular imports (data-space re-exports `ensurePortableCanonicalStore`).
 */

const META_DIRNAME = ".meta";
const COGNIWEAVE_META_DIRNAME = "cogniweave";
const COGNIWEAVE_CANONICAL_FILENAME = "canonical.sqlite";
const COGNIWEAVE_MIGRATION_STATE_FILENAME = "migration_state.json";

export const COGNIWEAVE_MIGRATION_STATE_VERSION = 2 as const;

export type CogniWeaveMigrationPhase =
  | "idle"
  | "planned"
  | "freeze_writes"
  | "snapshot_copy"
  | "integrity_check"
  | "schema_migrate"
  | "shadow_verify"
  | "cutover_ready"
  | "cutover_switched"
  | "observe"
  | "completed"
  | "failed_rollback"
  | "failed_needs_manual";

export type CogniWeaveMigrationTransition = {
  at: string;
  from: CogniWeaveMigrationPhase;
  to: CogniWeaveMigrationPhase;
  note?: string;
  error?: string;
};

export type CogniWeaveMigrationState = {
  version: 1 | typeof COGNIWEAVE_MIGRATION_STATE_VERSION;
  phase: CogniWeaveMigrationPhase;
  fromPath: string;
  toPath: string;
  processId: string;
  plannedAt?: string;
  freezeAt?: string;
  cutoverAt?: string;
  completedAt?: string;
  fromChecksum?: string;
  toChecksum?: string;
  history: CogniWeaveMigrationTransition[];
  error?: string;
  dataPlaneId?: string;
};

export type PortableCanonicalEnsureResult = {
  storePath: string;
  cutoverFromLegacy: boolean;
  migrationStatePath: string;
  migrationState?: CogniWeaveMigrationState;
  /** True when a prior interrupted cutover was rolled back or roll-forwarded. */
  recovered?: boolean;
  switchedBack?: boolean;
};

const WRITE_FREEZE_PHASES = new Set<CogniWeaveMigrationPhase>([
  "freeze_writes",
  "snapshot_copy",
  "integrity_check",
  "schema_migrate",
  "shadow_verify",
  "cutover_ready",
  "failed_needs_manual",
]);

const PRE_CUTOVER_PHASES = new Set<CogniWeaveMigrationPhase>([
  "planned",
  "freeze_writes",
  "snapshot_copy",
  "integrity_check",
  "schema_migrate",
  "shadow_verify",
  "cutover_ready",
]);

const POST_CUTOVER_INCOMPLETE = new Set<CogniWeaveMigrationPhase>(["cutover_switched", "observe"]);

function resolveMetaDir(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), META_DIRNAME, COGNIWEAVE_META_DIRNAME);
}

function resolvePortablePath(dataRoot: string): string {
  return path.join(resolveMetaDir(dataRoot), COGNIWEAVE_CANONICAL_FILENAME);
}

function resolveMigrationStatePath(dataRoot: string): string {
  return path.join(resolveMetaDir(dataRoot), COGNIWEAVE_MIGRATION_STATE_FILENAME);
}

function resolveLegacyPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), COGNIWEAVE_META_DIRNAME, COGNIWEAVE_CANONICAL_FILENAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function processId(): string {
  return `pid_${process.pid}`;
}

function partialStorePath(storePath: string): string {
  return `${storePath}.partial`;
}

export function fileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function removeStoreArtifacts(storePath: string): void {
  for (const candidate of [
    storePath,
    `${storePath}-wal`,
    `${storePath}-shm`,
    partialStorePath(storePath),
    `${partialStorePath(storePath)}-wal`,
    `${partialStorePath(storePath)}-shm`,
  ]) {
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      // best-effort
    }
  }
}

function copyStoreWithSidecars(fromPath: string, toPath: string): void {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
  for (const suffix of ["-wal", "-shm"] as const) {
    const side = `${fromPath}${suffix}`;
    if (fs.existsSync(side)) {
      fs.copyFileSync(side, `${toPath}${suffix}`);
    }
  }
}

function isPhase(value: unknown): value is CogniWeaveMigrationPhase {
  return (
    typeof value === "string" &&
    [
      "idle",
      "planned",
      "freeze_writes",
      "snapshot_copy",
      "integrity_check",
      "schema_migrate",
      "shadow_verify",
      "cutover_ready",
      "cutover_switched",
      "observe",
      "completed",
      "failed_rollback",
      "failed_needs_manual",
    ].includes(value)
  );
}

/** Normalize v1 completed records and v2 durable FSM records. */
export function parseCogniWeaveMigrationState(raw: unknown): CogniWeaveMigrationState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (!isPhase(obj.phase) || typeof obj.fromPath !== "string" || typeof obj.toPath !== "string") {
    return null;
  }
  const history = Array.isArray(obj.history)
    ? obj.history.filter(
        (entry): entry is CogniWeaveMigrationTransition =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as CogniWeaveMigrationTransition).at === "string" &&
          isPhase((entry as CogniWeaveMigrationTransition).from) &&
          isPhase((entry as CogniWeaveMigrationTransition).to),
      )
    : [];
  return {
    version: obj.version === 1 ? 1 : COGNIWEAVE_MIGRATION_STATE_VERSION,
    phase: obj.phase,
    fromPath: obj.fromPath,
    toPath: obj.toPath,
    processId: typeof obj.processId === "string" ? obj.processId : "unknown",
    plannedAt: typeof obj.plannedAt === "string" ? obj.plannedAt : undefined,
    freezeAt: typeof obj.freezeAt === "string" ? obj.freezeAt : undefined,
    cutoverAt: typeof obj.cutoverAt === "string" ? obj.cutoverAt : undefined,
    completedAt: typeof obj.completedAt === "string" ? obj.completedAt : undefined,
    fromChecksum: typeof obj.fromChecksum === "string" ? obj.fromChecksum : undefined,
    toChecksum: typeof obj.toChecksum === "string" ? obj.toChecksum : undefined,
    history,
    error: typeof obj.error === "string" ? obj.error : undefined,
    dataPlaneId: typeof obj.dataPlaneId === "string" ? obj.dataPlaneId : undefined,
  };
}

export function readCogniWeaveMigrationState(dataRoot: string): CogniWeaveMigrationState | null {
  const statePath = resolveMigrationStatePath(dataRoot);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf-8")) as unknown;
    return parseCogniWeaveMigrationState(raw);
  } catch {
    return null;
  }
}

export function writeCogniWeaveMigrationState(
  dataRoot: string,
  state: CogniWeaveMigrationState,
): string {
  const statePath = resolveMigrationStatePath(dataRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, statePath);
  return statePath;
}

export function isCogniWeaveCanonicalWriteFrozen(
  dataRootOrState: string | CogniWeaveMigrationState | null,
): boolean {
  const state =
    typeof dataRootOrState === "string"
      ? readCogniWeaveMigrationState(dataRootOrState)
      : dataRootOrState;
  return state ? WRITE_FREEZE_PHASES.has(state.phase) : false;
}

export class CogniWeaveWriteFrozenError extends Error {
  readonly code = "COGNIWEAVE_WRITE_FROZEN";
  constructor(phase: CogniWeaveMigrationPhase) {
    super(`CogniWeave canonical writes are frozen during migration phase=${phase}`);
    this.name = "CogniWeaveWriteFrozenError";
  }
}

export function assertCogniWeaveWritesAllowed(dataRoot: string): void {
  const state = readCogniWeaveMigrationState(dataRoot);
  if (state && WRITE_FREEZE_PHASES.has(state.phase)) {
    throw new CogniWeaveWriteFrozenError(state.phase);
  }
}

function transition(
  state: CogniWeaveMigrationState,
  to: CogniWeaveMigrationPhase,
  note?: string,
  error?: string,
): CogniWeaveMigrationState {
  const at = nowIso();
  const next: CogniWeaveMigrationState = {
    ...state,
    version: COGNIWEAVE_MIGRATION_STATE_VERSION,
    phase: to,
    history: [...state.history, { at, from: state.phase, to, note, error }],
    error: error ?? (to === "completed" || to === "idle" ? undefined : state.error),
  };
  if (to === "planned") {
    next.plannedAt = at;
  }
  if (to === "freeze_writes") {
    next.freezeAt = at;
  }
  if (to === "cutover_switched") {
    next.cutoverAt = at;
  }
  if (to === "completed") {
    next.completedAt = at;
  }
  return next;
}

function persist(dataRoot: string, state: CogniWeaveMigrationState): CogniWeaveMigrationState {
  writeCogniWeaveMigrationState(dataRoot, state);
  return state;
}

function rollbackPreCutover(
  dataRoot: string,
  state: CogniWeaveMigrationState,
  reason: string,
): CogniWeaveMigrationState {
  removeStoreArtifacts(state.toPath);
  let next = transition(state, "failed_rollback", reason, reason);
  next = persist(dataRoot, next);
  next = transition(next, "idle", "pre-cutover rollback complete");
  return persist(dataRoot, next);
}

function rollForwardPostCutover(
  dataRoot: string,
  state: CogniWeaveMigrationState,
): CogniWeaveMigrationState {
  let next = state;
  if (next.phase === "cutover_switched") {
    next = persist(dataRoot, transition(next, "observe", "crash recover roll-forward"));
  }
  if (next.phase === "observe") {
    next = persist(dataRoot, transition(next, "completed", "crash recover roll-forward"));
  }
  return next;
}

/**
 * Recover interrupted cutover, then ensure the effective store path.
 *
 * Authority rules:
 * - configuredStorePath wins
 * - completed / post-cutover portable exists → portable
 * - pre-cutover / no portable → legacy when present, else portable (new install)
 */
export function ensurePortableCanonicalStoreWithFsm(params: {
  dataRoot: string;
  stateDir: string;
  configuredStorePath?: string;
}): PortableCanonicalEnsureResult {
  const configured = params.configuredStorePath?.trim();
  const migrationStatePath = resolveMigrationStatePath(params.dataRoot);
  if (configured) {
    const storePath = path.resolve(configured);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    return { storePath, cutoverFromLegacy: false, migrationStatePath };
  }

  const portablePath = resolvePortablePath(params.dataRoot);
  const legacyPath = resolveLegacyPath(params.stateDir);
  fs.mkdirSync(resolveMetaDir(params.dataRoot), { recursive: true, mode: 0o700 });

  let state = readCogniWeaveMigrationState(params.dataRoot);
  let recovered = false;

  if (state && PRE_CUTOVER_PHASES.has(state.phase)) {
    state = rollbackPreCutover(params.dataRoot, state, `resume after crash in ${state.phase}`);
    recovered = true;
  }

  if (state && POST_CUTOVER_INCOMPLETE.has(state.phase)) {
    if (fs.existsSync(portablePath)) {
      state = rollForwardPostCutover(params.dataRoot, state);
      recovered = true;
      return {
        storePath: portablePath,
        cutoverFromLegacy: false,
        migrationStatePath,
        migrationState: state,
        recovered,
      };
    }
    state = rollbackPreCutover(
      params.dataRoot,
      state,
      "post-cutover missing portable store; switch-back to idle",
    );
    recovered = true;
  }

  if (fs.existsSync(portablePath)) {
    return {
      storePath: portablePath,
      cutoverFromLegacy: false,
      migrationStatePath,
      migrationState: state ?? undefined,
      recovered,
    };
  }

  if (!fs.existsSync(legacyPath)) {
    return { storePath: portablePath, cutoverFromLegacy: false, migrationStatePath, recovered };
  }

  // After pre-cutover rollback, legacy remains authority until a fresh cutover succeeds.
  if (recovered && state?.phase === "idle") {
    return {
      storePath: legacyPath,
      cutoverFromLegacy: false,
      migrationStatePath,
      migrationState: state,
      recovered,
    };
  }

  const fromChecksum = fileSha256(legacyPath);
  state = persist(params.dataRoot, {
    version: COGNIWEAVE_MIGRATION_STATE_VERSION,
    phase: "idle",
    fromPath: legacyPath,
    toPath: portablePath,
    processId: processId(),
    fromChecksum,
    history: [],
  });
  state = persist(params.dataRoot, transition(state, "planned", "legacy store detected"));
  state = persist(params.dataRoot, transition(state, "freeze_writes", "freeze canonical writes"));

  const staging = partialStorePath(portablePath);
  removeStoreArtifacts(portablePath);
  state = persist(params.dataRoot, transition(state, "snapshot_copy", "copy legacy → partial"));
  try {
    copyStoreWithSidecars(legacyPath, staging);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state = rollbackPreCutover(params.dataRoot, state, `snapshot_copy failed: ${message}`);
    return {
      storePath: legacyPath,
      cutoverFromLegacy: false,
      migrationStatePath,
      migrationState: state,
      recovered: true,
    };
  }

  state = persist(params.dataRoot, transition(state, "integrity_check", "verify checksum"));
  const toChecksum = fileSha256(staging);
  if (toChecksum !== fromChecksum) {
    state = rollbackPreCutover(
      params.dataRoot,
      { ...state, toChecksum },
      `checksum mismatch src=${fromChecksum} dst=${toChecksum}`,
    );
    return {
      storePath: legacyPath,
      cutoverFromLegacy: false,
      migrationStatePath,
      migrationState: state,
      recovered: true,
    };
  }
  state = { ...state, toChecksum };

  state = persist(params.dataRoot, transition(state, "schema_migrate", "no-op same schema"));
  state = persist(params.dataRoot, transition(state, "shadow_verify", "size/checksum ok"));
  state = persist(params.dataRoot, transition(state, "cutover_ready", "ready to promote"));

  fs.renameSync(staging, portablePath);
  for (const suffix of ["-wal", "-shm"] as const) {
    const stagedSide = `${staging}${suffix}`;
    if (fs.existsSync(stagedSide)) {
      fs.renameSync(stagedSide, `${portablePath}${suffix}`);
    }
  }

  state = persist(params.dataRoot, transition(state, "cutover_switched", "portable is authority"));
  state = persist(params.dataRoot, transition(state, "observe", "post-cutover observe"));
  state = persist(params.dataRoot, transition(state, "completed", "cutover complete"));

  return {
    storePath: portablePath,
    cutoverFromLegacy: true,
    migrationStatePath,
    migrationState: state,
    recovered,
  };
}

/**
 * Post-cutover switch-back: restore legacy authority when previous store is intact
 * and the portable store has not accepted divergent writes.
 */
export function switchBackPortableCanonicalStore(params: {
  dataRoot: string;
  stateDir: string;
}): PortableCanonicalEnsureResult {
  const migrationStatePath = resolveMigrationStatePath(params.dataRoot);
  const portablePath = resolvePortablePath(params.dataRoot);
  const legacyPath = resolveLegacyPath(params.stateDir);
  const state = readCogniWeaveMigrationState(params.dataRoot);

  if (!fs.existsSync(legacyPath)) {
    throw new Error(`switch-back refused: legacy store missing at ${legacyPath}`);
  }
  if (state?.fromChecksum) {
    const legacyChecksum = fileSha256(legacyPath);
    if (legacyChecksum !== state.fromChecksum) {
      throw new Error(
        `switch-back refused: legacy checksum changed (${legacyChecksum} != ${state.fromChecksum})`,
      );
    }
  }
  if (fs.existsSync(portablePath) && state?.fromChecksum && state.toChecksum) {
    const portableChecksum = fileSha256(portablePath);
    if (portableChecksum !== state.toChecksum && portableChecksum !== state.fromChecksum) {
      throw new Error("switch-back refused: portable store diverged; prefer roll-forward repair");
    }
  }

  removeStoreArtifacts(portablePath);
  let next: CogniWeaveMigrationState = state ?? {
    version: COGNIWEAVE_MIGRATION_STATE_VERSION,
    phase: "completed",
    fromPath: legacyPath,
    toPath: portablePath,
    processId: processId(),
    history: [],
  };
  next = persist(
    params.dataRoot,
    transition(next, "failed_rollback", "operator switch-back to legacy store"),
  );
  next = persist(params.dataRoot, transition(next, "idle", "switch-back complete"));

  return {
    storePath: legacyPath,
    cutoverFromLegacy: false,
    migrationStatePath,
    migrationState: next,
    switchedBack: true,
  };
}
