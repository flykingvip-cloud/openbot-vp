import fs from "node:fs/promises";
import path from "node:path";
import type { CollaborationMember } from "@openbot/collaboration-core";
import type { GatewayCollaborationGroupOperatingState } from "./collaboration-learning/operating-state-types.js";
import {
  buildMembersFromEmbeddedProfile,
  buildWorkspaceSpaceSnapshot,
  coerceManagedMirrorProfile,
  createWorkspaceCollaborationStores,
  isStoredGroupProfile,
  listUserScopedCollaborationExtras,
  listWorkspaceCollaborationGroupIds,
  parseStoredGroupMembersFile,
  readWorkspaceSpaceSnapshotFromRoot,
  resolveGroupStoreFilePath,
  resolveManagedSpaceDirCandidates,
  toGroupProfile,
  type StoredGroupProfile,
} from "./collaboration-learning/shared.js";

type ReadTextFile = (filePath: string) => Promise<string>;

/**
 * A policy artifact read attempt. `found: false` means the file is genuinely
 * absent; every other failure throws so authorization can fail closed.
 */
export type EmployeePolicyFileRead = { found: boolean; value: unknown };

export type EmployeeSessionVisibilitySpace = ReturnType<typeof buildWorkspaceSpaceSnapshot> & {
  lifecycleStatus?: string | null;
};

export type EmployeeSessionVisibilitySpaceList = {
  spaces: EmployeeSessionVisibilitySpace[];
};

/** Strict policy read: only a genuinely absent file is treated as no data. */
export async function readEmployeePolicyJsonFile(
  filePath: string,
  readTextFile: ReadTextFile = async (targetPath) => await fs.readFile(targetPath, "utf8"),
): Promise<EmployeePolicyFileRead> {
  let raw: string;
  try {
    raw = await readTextFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { found: false, value: null };
    }
    throw new Error(`unable to read employee visibility policy: ${filePath}`, { cause: error });
  }
  try {
    return { found: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    throw new Error(`invalid employee visibility policy JSON: ${filePath}`, { cause: error });
  }
}

async function readFirstPolicyFile(paths: string[]): Promise<EmployeePolicyFileRead> {
  for (const filePath of new Set(paths)) {
    const read = await readEmployeePolicyJsonFile(filePath);
    if (read.found && read.value != null) {
      return read;
    }
  }
  return { found: false, value: null };
}

function parseRuntimeProfile(
  read: EmployeePolicyFileRead,
  source: string,
): StoredGroupProfile | null {
  if (!read.found) {
    return null;
  }
  if (!isStoredGroupProfile(read.value)) {
    throw new Error(`invalid employee visibility profile: ${source}`);
  }
  return read.value;
}

function parseManagedProfile(
  read: EmployeePolicyFileRead,
  groupId: string,
  source: string,
): StoredGroupProfile | null {
  if (!read.found) {
    return null;
  }
  const candidate =
    read.value &&
    typeof read.value === "object" &&
    !Array.isArray(read.value) &&
    "profile" in read.value
      ? (read.value as { profile?: unknown }).profile
      : read.value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`invalid managed employee visibility profile: ${source}`);
  }
  const record = candidate as Record<string, unknown>;
  if (
    ![record.id, record.groupId, record.name, record.displayName, record.groupCode].some(
      (entry) => typeof entry === "string" && entry.trim(),
    )
  ) {
    throw new Error(`incomplete managed employee visibility profile: ${source}`);
  }
  const profile = coerceManagedMirrorProfile(read.value, groupId);
  if (!profile) {
    throw new Error(`invalid managed employee visibility profile: ${source}`);
  }
  return profile;
}

function parseMembers(read: EmployeePolicyFileRead, source: string): CollaborationMember[] | null {
  if (!read.found) {
    return null;
  }
  const members = parseStoredGroupMembersFile(
    read.value as Parameters<typeof parseStoredGroupMembersFile>[0],
  );
  if (
    !members ||
    members.some(
      (member) =>
        !member ||
        typeof member !== "object" ||
        (member.memberKind !== "human" && member.memberKind !== "bot") ||
        typeof member.status !== "string",
    )
  ) {
    throw new Error(`invalid employee visibility members: ${source}`);
  }
  return members;
}

function parseOperatingState(
  read: EmployeePolicyFileRead,
  groupId: string,
  source: string,
): GatewayCollaborationGroupOperatingState | null {
  if (!read.found) {
    return null;
  }
  if (!read.value || typeof read.value !== "object" || Array.isArray(read.value)) {
    throw new Error(`invalid employee visibility operating state: ${source}`);
  }
  const state = read.value as Partial<GatewayCollaborationGroupOperatingState>;
  if (
    state.groupId !== groupId ||
    !state.groupProfile ||
    typeof state.groupProfile !== "object" ||
    !state.governance ||
    typeof state.governance !== "object"
  ) {
    throw new Error(`incomplete employee visibility operating state: ${source}`);
  }
  const lifecycleStatus = state.groupProfile.lifecycleStatus;
  if (lifecycleStatus != null && typeof lifecycleStatus !== "string") {
    throw new Error(`invalid employee visibility lifecycle status: ${source}`);
  }
  return read.value as GatewayCollaborationGroupOperatingState;
}

/**
 * Read only policy artifacts needed by session authorization. This path never
 * scans agent session stores and never materializes or rewrites group state.
 */
export async function listEmployeeSessionVisibilitySpaces(): Promise<EmployeeSessionVisibilitySpaceList> {
  const { stateDir, groupRootDir, workspaceDir } = createWorkspaceCollaborationStores();
  const workspaceGroupIds = await listWorkspaceCollaborationGroupIds(groupRootDir);
  const groupIds = [...workspaceGroupIds];
  const userScoped = await listUserScopedCollaborationExtras({
    workspaceDir,
    primaryGroupRootDir: groupRootDir,
  });
  const extraGroupIds = userScoped.groupIds.filter((groupId) => !groupIds.includes(groupId));
  const spaces = await Promise.all(
    groupIds.map(async (groupId) => {
      const runtimePaths = {
        profile: resolveGroupStoreFilePath({ groupRootDir, groupId, filename: "profile.json" }),
        members: resolveGroupStoreFilePath({ groupRootDir, groupId, filename: "members.json" }),
        operatingState: resolveGroupStoreFilePath({
          groupRootDir,
          groupId,
          filename: "operating-state.json",
        }),
      };
      const managedDirs = resolveManagedSpaceDirCandidates(stateDir, groupId);
      const managedProfilePaths = managedDirs.map((dir) => path.join(dir, "profile.json"));
      const managedMembersPaths = managedDirs.map((dir) => path.join(dir, "members.json"));
      const [
        runtimeProfileRead,
        runtimeMembersRead,
        operatingStateRead,
        managedProfileRead,
        managedMembersRead,
      ] = await Promise.all([
        readEmployeePolicyJsonFile(runtimePaths.profile),
        readEmployeePolicyJsonFile(runtimePaths.members),
        readEmployeePolicyJsonFile(runtimePaths.operatingState),
        readFirstPolicyFile(managedProfilePaths),
        readFirstPolicyFile(managedMembersPaths),
      ]);
      const profile =
        parseRuntimeProfile(runtimeProfileRead, runtimePaths.profile) ??
        parseManagedProfile(managedProfileRead, groupId, managedProfilePaths[0] ?? groupId);
      const members =
        parseMembers(runtimeMembersRead, runtimePaths.members) ??
        parseMembers(managedMembersRead, managedMembersPaths[0] ?? groupId) ??
        buildMembersFromEmbeddedProfile(profile);
      const operatingState = parseOperatingState(
        operatingStateRead,
        groupId,
        runtimePaths.operatingState,
      );
      if (!profile && members.length === 0 && !operatingState) {
        throw new Error(`missing employee visibility policy for collaboration group: ${groupId}`);
      }
      const snapshot = buildWorkspaceSpaceSnapshot({
        groupId,
        profile: toGroupProfile(profile),
        members,
        operatingState,
      });
      const profileLifecycleStatus =
        typeof profile?.lifecycleStatus === "string" ? profile.lifecycleStatus : null;
      return {
        ...snapshot,
        ...(profileLifecycleStatus ? { lifecycleStatus: profileLifecycleStatus } : {}),
      };
    }),
  );
  const extraSpaces = await Promise.all(
    extraGroupIds.map(async (groupId) => {
      const snapshot = await readWorkspaceSpaceSnapshotFromRoot({
        groupRootDir: userScoped.root,
        groupId,
      });
      return snapshot;
    }),
  );
  return {
    spaces: [
      ...spaces,
      ...extraSpaces.filter((space): space is NonNullable<typeof space> => Boolean(space)),
    ],
  };
}
