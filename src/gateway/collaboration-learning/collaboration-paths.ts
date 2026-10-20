import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { rewriteOpenclawPathToOpenbotIfPresent } from "./openbot-path-rewrite.js";
import {
  createWorkspaceCollaborationStores,
  normalizeValue,
  resolveGroupStoreFilePath,
  resolveGroupWorkspacePath,
} from "./shared.js";

const OPERATING_STATE_FILENAME = "operating-state.json";
const GROUP_CHARTER_FILENAME = "governance/group-charter.json";
const COLLABORATION_LEDGER_FILENAME = "ledger/collaboration.jsonl";
/** GROUP_PUBLIC chat transcript — shared among members of this group only. */
export const GROUP_PUBLIC_TRANSCRIPT_RELATIVE_PATH = "runtime/transcript.jsonl";

export type GroupCollaborationPaths = {
  groupId: string;
  stateDir: string;
  workspaceDir: string;
  collaborationWorkspaceRoot: string | null;
  /** Primary runtime group root — all reads and writes go here. */
  groupRootDir: string;
  /** Same as groupDir. Historical spaces/ mirror is not a live write root. */
  managedSpaceDir: string;
  groupDir: string;
  /** Shared files root for group tools (today: same as groupDir). */
  workspacePath: string;
  memoryDir: string;
  participationsFile: string;
  operatingStateFile: string;
  governanceDir: string;
  groupCharterFile: string;
  ledgerDir: string;
  collaborationLedgerFile: string;
  /**
   * Canonical GROUP_PUBLIC transcript for `space:{groupId}`.
   * Shared by members of this group only (not tenant-wide, not cross-group).
   */
  publicTranscriptFile: string;
};

/**
 * Single entry for group collaboration filesystem layout.
 * Delegates to `createWorkspaceCollaborationStores()` — do not parallel a second resolver.
 */
export function resolveGroupCollaborationPaths(
  groupId: string,
  cfg?: ReturnType<typeof loadConfig>,
): GroupCollaborationPaths {
  const normalizedGroupId = normalizeValue(groupId);
  if (!normalizedGroupId) {
    throw new Error("groupId is required");
  }
  const stores = createWorkspaceCollaborationStores(cfg);
  const groupDir = resolveGroupWorkspacePath(stores.groupRootDir, normalizedGroupId);
  return {
    groupId: normalizedGroupId,
    stateDir: stores.stateDir,
    workspaceDir: stores.workspaceDir,
    collaborationWorkspaceRoot: stores.collaborationWorkspaceRoot,
    groupRootDir: stores.groupRootDir,
    managedSpaceDir: groupDir,
    groupDir,
    workspacePath: groupDir,
    memoryDir: path.join(groupDir, "memory"),
    participationsFile: resolveGroupStoreFilePath({
      groupRootDir: stores.groupRootDir,
      groupId: normalizedGroupId,
      filename: "participations.json",
    }),
    operatingStateFile: resolveGroupStoreFilePath({
      groupRootDir: stores.groupRootDir,
      groupId: normalizedGroupId,
      filename: OPERATING_STATE_FILENAME,
    }),
    governanceDir: path.join(groupDir, "governance"),
    groupCharterFile: resolveGroupStoreFilePath({
      groupRootDir: stores.groupRootDir,
      groupId: normalizedGroupId,
      filename: GROUP_CHARTER_FILENAME,
    }),
    ledgerDir: path.join(groupDir, "ledger"),
    collaborationLedgerFile: resolveGroupStoreFilePath({
      groupRootDir: stores.groupRootDir,
      groupId: normalizedGroupId,
      filename: COLLABORATION_LEDGER_FILENAME,
    }),
    publicTranscriptFile: path.join(groupDir, GROUP_PUBLIC_TRANSCRIPT_RELATIVE_PATH),
  };
}

/**
 * Pre-P0.0a (legacy) locations of collaboration runtime facts. Used verbatim while
 * `collaboration.runtimeNamespace` is off so the flag-off layout stays byte-identical.
 */
export function resolveLegacyGroupRuntimeFactPaths(
  groupId: string,
  cfg?: ReturnType<typeof loadConfig>,
): { groupDir: string; roundsDir: string; ledgerFile: string } {
  const paths = resolveGroupCollaborationPaths(groupId, cfg);
  return {
    groupDir: paths.groupDir,
    roundsDir: path.join(paths.groupDir, "runtime", "rounds"),
    ledgerFile: paths.collaborationLedgerFile,
  };
}

/**
 * Absolute path of the member-shared GROUP_PUBLIC transcript for a collaboration group.
 * Callers must still enforce membership ACL before reading or writing this file.
 */
export function resolveGroupPublicTranscriptPath(
  groupId: string,
  cfg?: ReturnType<typeof loadConfig>,
): string {
  return rewriteOpenclawPathToOpenbotIfPresent(
    resolveGroupCollaborationPaths(groupId, cfg).publicTranscriptFile,
  );
}

/**
 * True when `sessionFile` points at a collaboration group shared transcript
 * (`…/groups/<groupId>/runtime/transcript.jsonl`), which is intentionally outside
 * per-agent `sessions/` directories.
 */
export function isGroupPublicTranscriptSessionFile(
  sessionFile: string | null | undefined,
): boolean {
  const trimmed = sessionFile?.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = path.resolve(trimmed).replace(/\\/g, "/");
  return /\/groups\/[^/]+\/runtime\/transcript\.jsonl$/i.test(normalized);
}

/** Ensure primary group workspace + memory dirs exist; returns canonical workspacePath. */
export async function materializeGroupCollaborationWorkspace(
  groupId: string,
  cfg?: OpenBotConfig,
): Promise<string> {
  const paths = resolveGroupCollaborationPaths(groupId, cfg);
  await fs.mkdir(paths.workspacePath, { recursive: true });
  await fs.mkdir(paths.memoryDir, { recursive: true });
  await fs.mkdir(paths.governanceDir, { recursive: true });
  await fs.mkdir(paths.ledgerDir, { recursive: true });
  await fs.mkdir(path.join(paths.groupDir, "runtime"), { recursive: true });
  return paths.workspacePath;
}
