/**
 * Account Computer P4 shared-browser migration (v4.1 §5.2).
 *
 * The legacy tree is `CONFIG_DIR/browser/openclaw/user-data`. The default is
 * to leave it there. One proved single-owner export may run
 * export → verify → activate → rollback. A second account is fan-out and
 * copies nothing. WebAuthn, passkeys, and device-bound 2FA land as
 * REAUTH_REQUIRED. Outcomes are only MIGRATED, REAUTH_REQUIRED, or FAILED.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import {
  AccountTreeSnapshotError,
  copyDirectory,
  createTreeManifest,
  directoryHasReauthSentinel,
  isLegacySharedOpenClawUserData,
  isPathInside,
  pathExists,
  restoreSwappedDirectory,
  swapDirectory,
  treeMatchesManifest,
  type AccountTreeManifest,
} from "./account-dir-snapshot.js";

export type AccountMigrationOutcome = "MIGRATED" | "REAUTH_REQUIRED" | "FAILED";

export type AccountMigrationRefusal = {
  kind: "refused";
  outcome: "FAILED";
  reason: string;
  copied: false;
};

export type SharedBrowserMigrationSession = {
  kind: "session";
  version: 1;
  id: string;
  phase: "exported" | "verified" | "activated" | "rolled-back" | "failed";
  outcome: AccountMigrationOutcome | null;
  activationOutcome: "MIGRATED" | "REAUTH_REQUIRED" | null;
  reason: string | null;
  sourceUserDataDir: string;
  targetProfileDir: string;
  workDir: string;
  stagingDir: string;
  rollbackDir: string;
  manifest: AccountTreeManifest | null;
  previousExisted: boolean;
  deviceBound: boolean;
  /** True only while the shared tree is the live account profile. */
  copiedToTarget: boolean;
};

export type SharedBrowserExportResult = AccountMigrationRefusal | SharedBrowserMigrationSession;

type ExportClaim = {
  version: 1;
  sourceUserDataDir: string;
  targetProfileDir: string;
  phase: SharedBrowserMigrationSession["phase"];
};

const CLAIM_FILE = ".openbot-single-owner-claim.json";

function refusal(reason: string): AccountMigrationRefusal {
  return { kind: "refused", outcome: "FAILED", reason, copied: false };
}

function claimPathFor(sourceUserDataDir: string): string {
  return path.join(path.dirname(path.resolve(sourceUserDataDir)), CLAIM_FILE);
}

function pathsOverlap(left: string, right: string): boolean {
  return isPathInside(left, right) || isPathInside(right, left);
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}

async function readClaim(sourceUserDataDir: string): Promise<ExportClaim | null> {
  const parsed = await readJsonFile<ExportClaim>(claimPathFor(sourceUserDataDir));
  if (!parsed || parsed.version !== 1 || !parsed.targetProfileDir || !parsed.sourceUserDataDir) {
    return null;
  }
  return parsed;
}

async function claimLooksPresent(sourceUserDataDir: string): Promise<boolean> {
  return pathExists(claimPathFor(sourceUserDataDir));
}

async function writeClaim(sourceUserDataDir: string, claim: ExportClaim): Promise<void> {
  await writeJsonAtomic(claimPathFor(sourceUserDataDir), claim);
}

function failedSession(
  session: SharedBrowserMigrationSession,
  reason: string,
): SharedBrowserMigrationSession {
  return {
    ...session,
    phase: "failed",
    outcome: "FAILED",
    reason,
    copiedToTarget: false,
  };
}

export async function exportSharedBrowserProfile(params: {
  sourceUserDataDir: string;
  /** Exactly one account profile. Any other length is refused before a copy. */
  targets: readonly string[];
  singleOwnerProof: boolean;
  workDir: string;
  deviceBoundCredentials?: boolean;
}): Promise<SharedBrowserExportResult> {
  if (!isLegacySharedOpenClawUserData(params.sourceUserDataDir)) {
    return refusal("not-legacy-shared-profile");
  }
  if (params.targets.length === 0) {
    return refusal("no-target");
  }
  if (params.targets.length !== 1) {
    return refusal("fan-out");
  }
  if (!params.singleOwnerProof) {
    return refusal("no-single-owner-proof");
  }
  const sourceUserDataDir = path.resolve(params.sourceUserDataDir);
  const targetProfileDir = path.resolve(params.targets[0] ?? "");
  const workDir = path.resolve(params.workDir);
  if (!(await pathExists(sourceUserDataDir))) {
    return refusal("missing-source");
  }
  if (
    pathsOverlap(sourceUserDataDir, workDir) ||
    pathsOverlap(targetProfileDir, workDir) ||
    pathsOverlap(sourceUserDataDir, targetProfileDir)
  ) {
    return refusal("path-overlap");
  }
  if (await claimLooksPresent(sourceUserDataDir)) {
    const existing = await readClaim(sourceUserDataDir);
    if (!existing) {
      return refusal("unreadable-claim");
    }
    if (path.resolve(existing.targetProfileDir) !== targetProfileDir) {
      return refusal("fan-out");
    }
    return refusal("already-exported");
  }

  const stagingDir = path.join(workDir, "staging");
  const rollbackDir = path.join(workDir, "rollback");
  try {
    await copyDirectory(sourceUserDataDir, stagingDir);
    const manifest = await createTreeManifest(stagingDir);
    const deviceBound =
      params.deviceBoundCredentials === true || (await directoryHasReauthSentinel(stagingDir));
    const claim: ExportClaim = {
      version: 1,
      sourceUserDataDir,
      targetProfileDir,
      phase: "exported",
    };
    try {
      await fs.mkdir(path.dirname(claimPathFor(sourceUserDataDir)), { recursive: true });
      await fs.writeFile(claimPathFor(sourceUserDataDir), `${JSON.stringify(claim, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      if (errorCode(error) !== "EEXIST") {
        return refusal("claim-failed");
      }
      const existing = await readClaim(sourceUserDataDir);
      if (existing && path.resolve(existing.targetProfileDir) !== targetProfileDir) {
        return refusal("fan-out");
      }
      return refusal("already-exported");
    }
    return {
      kind: "session",
      version: 1,
      id: randomUUID(),
      phase: "exported",
      outcome: null,
      activationOutcome: null,
      reason: null,
      sourceUserDataDir,
      targetProfileDir,
      workDir,
      stagingDir,
      rollbackDir,
      manifest,
      previousExisted: false,
      deviceBound,
      copiedToTarget: false,
    };
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    if (error instanceof AccountTreeSnapshotError) {
      return refusal(error.reason);
    }
    return refusal("export-failed");
  }
}

export async function verifySharedBrowserExport(
  value: SharedBrowserExportResult,
): Promise<SharedBrowserExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase === "verified") {
    return value;
  }
  if (value.phase !== "exported" || !value.manifest) {
    return failedSession(value, "not-exported");
  }
  const matches = await treeMatchesManifest(value.stagingDir, value.manifest);
  if (!matches) {
    return failedSession(value, "verify-mismatch");
  }
  const deviceBound = value.deviceBound || (await directoryHasReauthSentinel(value.stagingDir));
  const next: SharedBrowserMigrationSession = {
    ...value,
    phase: "verified",
    deviceBound,
    reason: null,
  };
  try {
    await writeClaim(value.sourceUserDataDir, {
      version: 1,
      sourceUserDataDir: value.sourceUserDataDir,
      targetProfileDir: value.targetProfileDir,
      phase: "verified",
    });
  } catch {
    // The session is the pipeline authority. A claim rewrite must not undo verify.
  }
  return next;
}

export async function activateSharedBrowserExport(
  value: SharedBrowserExportResult,
): Promise<SharedBrowserExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase === "activated") {
    return value;
  }
  if (value.phase !== "verified" || !value.manifest) {
    return failedSession(
      value,
      value.phase === "failed" ? (value.reason ?? "failed") : "not-verified",
    );
  }
  const matches = await treeMatchesManifest(value.stagingDir, value.manifest);
  if (!matches) {
    return failedSession(value, "verify-mismatch");
  }
  try {
    const swapped = await swapDirectory({
      liveDir: value.targetProfileDir,
      incomingDir: value.stagingDir,
      rollbackDir: value.rollbackDir,
    });
    let deviceBound = value.deviceBound;
    try {
      deviceBound = deviceBound || (await directoryHasReauthSentinel(value.targetProfileDir));
    } catch (error) {
      await restoreSwappedDirectory({
        liveDir: value.targetProfileDir,
        rollbackDir: value.rollbackDir,
        previousExisted: swapped.previousExisted,
      }).catch(() => undefined);
      const reason = error instanceof AccountTreeSnapshotError ? error.reason : "activate-failed";
      return failedSession(value, reason);
    }
    const activationOutcome: "MIGRATED" | "REAUTH_REQUIRED" = deviceBound
      ? "REAUTH_REQUIRED"
      : "MIGRATED";
    const next: SharedBrowserMigrationSession = {
      ...value,
      phase: "activated",
      outcome: activationOutcome,
      activationOutcome,
      reason: null,
      previousExisted: swapped.previousExisted,
      deviceBound,
      copiedToTarget: true,
    };
    try {
      await writeClaim(value.sourceUserDataDir, {
        version: 1,
        sourceUserDataDir: value.sourceUserDataDir,
        targetProfileDir: value.targetProfileDir,
        phase: "activated",
      });
    } catch {
      // Live bytes already match the export. Claim phase is advisory.
    }
    return next;
  } catch (error) {
    const reason = error instanceof AccountTreeSnapshotError ? error.reason : "activate-failed";
    return failedSession(value, reason);
  }
}

export async function rollbackSharedBrowserExport(
  value: SharedBrowserExportResult,
): Promise<SharedBrowserExportResult> {
  if (value.kind === "refused") {
    return value;
  }
  if (value.phase !== "activated") {
    return failedSession(value, "not-activated");
  }
  try {
    await restoreSwappedDirectory({
      liveDir: value.targetProfileDir,
      rollbackDir: value.rollbackDir,
      previousExisted: value.previousExisted,
    });
  } catch (error) {
    const reason = error instanceof AccountTreeSnapshotError ? error.reason : "rollback-failed";
    return failedSession({ ...value, copiedToTarget: true }, reason);
  }
  try {
    await writeClaim(value.sourceUserDataDir, {
      version: 1,
      sourceUserDataDir: value.sourceUserDataDir,
      targetProfileDir: value.targetProfileDir,
      phase: "rolled-back",
    });
  } catch {
    // The profile directory was already restored.
  }
  return {
    ...value,
    phase: "rolled-back",
    outcome: null,
    reason: null,
    copiedToTarget: false,
  };
}

/**
 * One-shot export → verify → activate. Rollback stays on the staged session
 * API. Without single-owner proof this copies nothing.
 */
export async function exportSingleOwnerBrowserProfile(params: {
  sourceUserDataDir: string;
  targetProfileDir: string;
  singleOwnerProof: boolean;
  deviceBoundCredentials?: boolean;
}): Promise<AccountMigrationOutcome> {
  if (!params.singleOwnerProof) {
    return "FAILED";
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-browser-migrate-"));
  try {
    const exported = await exportSharedBrowserProfile({
      sourceUserDataDir: params.sourceUserDataDir,
      targets: [params.targetProfileDir],
      singleOwnerProof: true,
      workDir,
      deviceBoundCredentials: params.deviceBoundCredentials,
    });
    const verified = await verifySharedBrowserExport(exported);
    const activated = await activateSharedBrowserExport(verified);
    if (
      activated.kind === "session" &&
      (activated.outcome === "MIGRATED" || activated.outcome === "REAUTH_REQUIRED")
    ) {
      return activated.outcome;
    }
    return "FAILED";
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
