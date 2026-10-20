/**
 * Account Computer P4 file export, restore, and migration (v4.1 §4, §5.2, §11).
 *
 * Durable trees are the current agent workspace, that agent's artifacts, the
 * account memory directory, and `state/browser`. They are resolved through
 * the existing data-root helpers. Shared skills are not copied. The legacy
 * shared browser profile is not part of a durable export: adopting it is a
 * separate single-owner pipeline, and the default is an empty cold profile.
 *
 * Restore and rollback replace only the selected directories. Credential
 * files, sessions, and other agents stay where they are.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensureColdAccountBrowserProfile } from "../../browser/account-browser-namespace.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  resolveAccountExecutionPaths,
  type AccountExecutionPaths,
} from "../../gateway/account-execution-paths.js";
import type { TenantContext } from "../../gateway/tenant-context.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  AccountTreeSnapshotError,
  copyDirectory,
  createTreeManifest,
  directoryHasReauthSentinel,
  isPathInside,
  pathExists,
  restoreSwappedDirectory,
  swapDirectory,
  treeMatchesManifest,
  type AccountTreeManifest,
} from "./account-dir-snapshot.js";
import {
  activateSharedBrowserExport,
  exportSharedBrowserProfile,
  rollbackSharedBrowserExport,
  verifySharedBrowserExport,
  type AccountMigrationOutcome,
  type AccountMigrationRefusal,
  type SharedBrowserExportResult,
  type SharedBrowserMigrationSession,
} from "./account-shared-browser-migration.js";

export type AccountDurableKind = "workspace" | "artifacts" | "memory" | "browser";

export const ACCOUNT_DURABLE_KINDS: readonly AccountDurableKind[] = [
  "workspace",
  "artifacts",
  "memory",
  "browser",
];

export type AccountDurableDirs = Record<AccountDurableKind, string>;

export type AccountDurableTransferSession = {
  kind: "session";
  version: 1;
  id: string;
  phase: "exported" | "verified" | "activated" | "rolled-back" | "failed";
  outcome: AccountMigrationOutcome | null;
  activationOutcome: "MIGRATED" | "REAUTH_REQUIRED" | null;
  reason: string | null;
  tenantId: string;
  userId: string;
  agentId: string;
  kinds: AccountDurableKind[];
  archiveRoot: string;
  dirs: AccountDurableDirs;
  absent: AccountDurableKind[];
  manifests: Partial<Record<AccountDurableKind, AccountTreeManifest>>;
  rollback: Partial<Record<AccountDurableKind, { previousExisted: boolean }>>;
  liveMutated: boolean;
  browserReauth: boolean;
};

export type AccountDurableExportResult = AccountMigrationRefusal | AccountDurableTransferSession;

export type AccountBrowserAdoption =
  | { kind: "cold-start"; copied: false; targetProfileDir: string }
  | AccountMigrationRefusal
  | SharedBrowserMigrationSession;

type Scope = {
  ctx: TenantContext;
  cfg: OpenBotConfig | undefined;
  agentId: string;
  env?: NodeJS.ProcessEnv;
};

function refusal(reason: string): AccountMigrationRefusal {
  return { kind: "refused", outcome: "FAILED", reason, copied: false };
}

function normalizeKinds(kinds: readonly string[]): AccountDurableKind[] | null {
  if (kinds.length === 0) {
    return null;
  }
  const allowed = new Set<string>(ACCOUNT_DURABLE_KINDS);
  const seen = new Set<string>();
  const ordered: AccountDurableKind[] = [];
  for (const kind of kinds) {
    if (!allowed.has(kind) || seen.has(kind)) {
      return null;
    }
    seen.add(kind);
    ordered.push(kind as AccountDurableKind);
  }
  return ordered;
}

/** Workspace, artifacts, memory, and the account browser profile. */
export function resolveAccountDurableDirs(params: Scope): AccountDurableDirs {
  const paths: AccountExecutionPaths = resolveAccountExecutionPaths(params);
  return {
    workspace: paths.workspaceDir,
    artifacts: paths.artifactsDir,
    memory: path.join(paths.dataRoot, "memory"),
    browser: paths.browserProfileDir,
  };
}

function archiveConflicts(
  archiveRoot: string,
  userRoot: string,
  dirs: AccountDurableDirs,
): boolean {
  const archive = path.resolve(archiveRoot);
  if (isPathInside(userRoot, archive) || isPathInside(archive, userRoot)) {
    return true;
  }
  for (const dir of Object.values(dirs)) {
    if (isPathInside(dir, archive) || isPathInside(archive, dir)) {
      return true;
    }
  }
  return false;
}

function treeDir(archiveRoot: string, kind: AccountDurableKind): string {
  return path.join(archiveRoot, "trees", kind);
}

function rollbackDir(archiveRoot: string, kind: AccountDurableKind): string {
  return path.join(archiveRoot, ".rollback", kind);
}

function failedDurable(
  session: AccountDurableTransferSession,
  reason: string,
): AccountDurableTransferSession {
  return { ...session, phase: "failed", outcome: "FAILED", reason, liveMutated: false };
}

function sameDirs(
  left: AccountDurableDirs,
  right: AccountDurableDirs,
  kinds: AccountDurableKind[],
) {
  return kinds.every((kind) => path.resolve(left[kind]) === path.resolve(right[kind]));
}

export async function exportAccountDurableFiles(
  params: Scope & {
    kinds: readonly AccountDurableKind[];
    archiveRoot: string;
    deviceBoundCredentials?: boolean;
  },
): Promise<AccountDurableExportResult> {
  const kinds = normalizeKinds(params.kinds);
  if (!kinds) {
    return refusal("invalid-kinds");
  }
  const agentId = normalizeAgentId(params.agentId);
  const execution = resolveAccountExecutionPaths({ ...params, agentId });
  const dirs = resolveAccountDurableDirs({ ...params, agentId });
  const archiveRoot = path.resolve(params.archiveRoot);
  if (archiveConflicts(archiveRoot, execution.userRoot, dirs)) {
    return refusal("archive-inside-account");
  }
  const absent: AccountDurableKind[] = [];
  const manifests: AccountDurableTransferSession["manifests"] = {};
  try {
    for (const kind of kinds) {
      const live = dirs[kind];
      if (!(await pathExists(live))) {
        absent.push(kind);
        continue;
      }
      const dest = treeDir(archiveRoot, kind);
      await copyDirectory(live, dest);
      manifests[kind] = await createTreeManifest(dest);
    }
  } catch (error) {
    const reason = error instanceof AccountTreeSnapshotError ? error.reason : "export-failed";
    return refusal(reason);
  }
  const browserReauth =
    kinds.includes("browser") &&
    (params.deviceBoundCredentials === true ||
      (manifests.browser
        ? await directoryHasReauthSentinel(treeDir(archiveRoot, "browser"))
        : false));
  return {
    kind: "session",
    version: 1,
    id: randomUUID(),
    phase: "exported",
    outcome: null,
    activationOutcome: null,
    reason: null,
    tenantId: params.ctx.tenantId,
    userId: params.ctx.userId,
    agentId,
    kinds,
    archiveRoot,
    dirs,
    absent,
    manifests,
    rollback: {},
    liveMutated: false,
    browserReauth,
  };
}

async function durableArchiveMatches(session: AccountDurableTransferSession): Promise<boolean> {
  for (const kind of session.kinds) {
    const stored = treeDir(session.archiveRoot, kind);
    if (session.absent.includes(kind)) {
      if (await pathExists(stored)) {
        return false;
      }
      continue;
    }
    const manifest = session.manifests[kind];
    if (!manifest || !(await treeMatchesManifest(stored, manifest))) {
      return false;
    }
  }
  return true;
}

export async function verifyAccountDurableExport(
  value: AccountDurableExportResult,
): Promise<AccountDurableExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase !== "exported" && value.phase !== "verified") {
    return failedDurable(value, "not-exported");
  }
  if (!(await durableArchiveMatches(value))) {
    return failedDurable(value, "verify-mismatch");
  }
  const browserReauth =
    value.browserReauth ||
    (value.kinds.includes("browser") &&
      !value.absent.includes("browser") &&
      (await directoryHasReauthSentinel(treeDir(value.archiveRoot, "browser"))));
  return { ...value, phase: "verified", reason: null, browserReauth };
}

async function revertKinds(session: AccountDurableTransferSession): Promise<void> {
  for (const kind of session.kinds) {
    const snap = session.rollback[kind];
    if (!snap) {
      continue;
    }
    await restoreSwappedDirectory({
      liveDir: session.dirs[kind],
      rollbackDir: rollbackDir(session.archiveRoot, kind),
      previousExisted: snap.previousExisted,
    });
  }
}

export async function restoreAccountDurableFiles(
  value: AccountDurableExportResult,
  params: Scope & { deviceBoundCredentials?: boolean },
): Promise<AccountDurableExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase === "activated") {
    return value;
  }
  if (value.phase !== "verified") {
    return failedDurable(
      value,
      value.phase === "failed" ? (value.reason ?? "failed") : "not-verified",
    );
  }
  const agentId = normalizeAgentId(params.agentId);
  const dirs = resolveAccountDurableDirs({ ...params, agentId });
  if (
    params.ctx.tenantId !== value.tenantId ||
    params.ctx.userId !== value.userId ||
    agentId !== value.agentId ||
    !sameDirs(dirs, value.dirs, value.kinds)
  ) {
    return failedDurable(value, "path-changed");
  }
  const verified = await verifyAccountDurableExport(value);
  if (verified.kind === "refused" || verified.phase !== "verified") {
    return verified.kind === "session"
      ? failedDurable(verified, verified.reason ?? "verify-mismatch")
      : verified;
  }
  const rollback: AccountDurableTransferSession["rollback"] = {};
  const session: AccountDurableTransferSession = { ...verified, rollback, dirs };
  try {
    for (const kind of session.kinds) {
      const incoming = session.absent.includes(kind) ? null : treeDir(session.archiveRoot, kind);
      const swapped = await swapDirectory({
        liveDir: session.dirs[kind],
        incomingDir: incoming,
        rollbackDir: rollbackDir(session.archiveRoot, kind),
      });
      rollback[kind] = { previousExisted: swapped.previousExisted };
    }
  } catch (error) {
    try {
      await revertKinds(session);
    } catch {
      // The swap helper already attempted to put each live directory back.
    }
    const reason = error instanceof AccountTreeSnapshotError ? error.reason : "restore-failed";
    return failedDurable(session, reason);
  }
  let browserReauth = session.browserReauth || params.deviceBoundCredentials === true;
  if (session.kinds.includes("browser") && !session.absent.includes("browser")) {
    try {
      browserReauth = browserReauth || (await directoryHasReauthSentinel(session.dirs.browser));
    } catch (error) {
      try {
        await revertKinds(session);
      } catch {
        // Best effort. The outcome stays FAILED either way.
      }
      const reason = error instanceof AccountTreeSnapshotError ? error.reason : "restore-failed";
      return failedDurable(session, reason);
    }
  }
  if (!session.kinds.includes("browser")) {
    browserReauth = false;
  }
  const activationOutcome: "MIGRATED" | "REAUTH_REQUIRED" = browserReauth
    ? "REAUTH_REQUIRED"
    : "MIGRATED";
  return {
    ...session,
    phase: "activated",
    outcome: activationOutcome,
    activationOutcome,
    reason: null,
    rollback,
    liveMutated: true,
    browserReauth,
  };
}

export async function rollbackAccountDurableRestore(
  value: AccountDurableExportResult,
): Promise<AccountDurableExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase !== "activated") {
    return failedDurable(value, "not-activated");
  }
  try {
    await revertKinds(value);
  } catch (error) {
    const reason = error instanceof AccountTreeSnapshotError ? error.reason : "rollback-failed";
    return { ...value, phase: "failed", outcome: "FAILED", reason, liveMutated: true };
  }
  return {
    ...value,
    phase: "rolled-back",
    outcome: null,
    reason: null,
    liveMutated: false,
  };
}

/**
 * Default: cold empty account profile, shared user-data is not copied.
 * With single-owner proof, start export only. The caller verifies, activates,
 * and may roll back. Extra targets or a client profile path copy nothing.
 */
export async function adoptAccountBrowserProfile(
  params: Scope & {
    sourceUserDataDir: string;
    singleOwnerProof: boolean;
    workDir: string;
    deviceBoundCredentials?: boolean;
    extraTargets?: readonly string[];
    requestedProfileDir?: string;
  },
): Promise<AccountBrowserAdoption> {
  const dirs = resolveAccountDurableDirs(params);
  const targetProfileDir = dirs.browser;
  if ((params.extraTargets?.length ?? 0) > 0) {
    return refusal("fan-out");
  }
  if (
    params.requestedProfileDir &&
    path.resolve(params.requestedProfileDir) !== path.resolve(targetProfileDir)
  ) {
    return refusal("client-profile");
  }
  if (!params.singleOwnerProof) {
    await ensureColdAccountBrowserProfile(targetProfileDir);
    return { kind: "cold-start", copied: false, targetProfileDir };
  }
  return exportSharedBrowserProfile({
    sourceUserDataDir: params.sourceUserDataDir,
    targets: [targetProfileDir],
    singleOwnerProof: true,
    workDir: params.workDir,
    deviceBoundCredentials: params.deviceBoundCredentials,
  });
}

export {
  activateSharedBrowserExport,
  exportSharedBrowserProfile,
  rollbackSharedBrowserExport,
  verifySharedBrowserExport,
};
export type { AccountMigrationOutcome, AccountMigrationRefusal, SharedBrowserExportResult };
