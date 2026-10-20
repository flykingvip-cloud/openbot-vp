import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomically } from "../../plugin-sdk/json-store.js";
import {
  resolveCollaborationSharedGroupRoot,
  resolveGroupWorkspacePath,
  uniquePaths,
} from "./shared.js";

export type LedgerItem = {
  id: string;
  updated_at?: string;
};

export type LedgerFile<T extends LedgerItem = LedgerItem> = {
  version: 1;
  updated_at: string;
  items: T[];
};

export type GroupStorageMigrationReport = {
  groupId: string;
  collaborationRoot: string;
  canonicalGroupDir: string;
  canonicalMemoryDir: string;
  legacyGroupDirs: string[];
  mergedTaskCount: number;
  mergedArtifactCount: number;
  mergedCheckpointCount: number;
  copiedGroupFiles: string[];
  updatedProfilePaths: string[];
  backupDir: string | null;
  removedLegacyDirs: string[];
  dryRun: boolean;
};

function groupDirCandidates(groupRootDir: string, groupId: string): string[] {
  return uniquePaths([
    resolveGroupWorkspacePath(groupRootDir, groupId),
    path.join(path.resolve(groupRootDir), groupId),
  ]);
}

export function mergeLedgerItems<T extends LedgerItem>(sources: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const items of sources) {
    for (const item of items) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
        continue;
      }
      const existingTs = existing.updated_at ?? "";
      const nextTs = item.updated_at ?? "";
      if (nextTs.localeCompare(existingTs) > 0) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()].toSorted((left, right) =>
    (left.updated_at ?? "").localeCompare(right.updated_at ?? ""),
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readLedgerFile<T extends LedgerItem>(
  filePath: string,
): Promise<LedgerFile<T> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as LedgerFile<T>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function collectLedgerSources<T extends LedgerItem>(
  legacyGroupDirs: string[],
  filename: string,
): Promise<LedgerFile<T>[]> {
  const sources: LedgerFile<T>[] = [];
  for (const groupDir of legacyGroupDirs) {
    const filePath = path.join(groupDir, "memory", filename);
    const ledger = await readLedgerFile<T>(filePath);
    if (ledger) {
      sources.push(ledger);
    }
  }
  return sources;
}

async function collectCheckpointFiles(legacyGroupDirs: string[]): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const groupDir of legacyGroupDirs) {
    const checkpointDir = path.join(groupDir, "memory", "checkpoints");
    if (!(await pathExists(checkpointDir))) {
      continue;
    }
    const entries = await fs.readdir(checkpointDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const existing = byName.get(entry.name);
      const candidate = path.join(checkpointDir, entry.name);
      if (!existing) {
        byName.set(entry.name, candidate);
        continue;
      }
      const [existingStat, candidateStat] = await Promise.all([
        fs.stat(existing),
        fs.stat(candidate),
      ]);
      if (candidateStat.mtimeMs > existingStat.mtimeMs) {
        byName.set(entry.name, candidate);
      }
    }
  }
  return byName;
}

async function collectTopLevelGroupFiles(legacyGroupDirs: string[]): Promise<Map<string, string>> {
  const filenames = [
    "profile.json",
    "members.json",
    "operating-state.json",
    "participations.json",
    "bindings.json",
    "capsules.json",
  ];
  const selected = new Map<string, string>();
  for (const filename of filenames) {
    let bestPath: string | null = null;
    let bestMtime = -1;
    for (const groupDir of legacyGroupDirs) {
      const candidate = path.join(groupDir, filename);
      if (!(await pathExists(candidate))) {
        continue;
      }
      const stat = await fs.stat(candidate);
      if (stat.mtimeMs > bestMtime) {
        bestMtime = stat.mtimeMs;
        bestPath = candidate;
      }
    }
    if (bestPath) {
      selected.set(filename, bestPath);
    }
  }
  return selected;
}

export async function discoverLegacyGroupDirs(params: {
  stateDir: string;
  groupId: string;
  extraRoots?: string[];
}): Promise<string[]> {
  const found = new Set<string>();
  const scanRoots = uniquePaths([
    ...(params.extraRoots ?? []),
    path.join(params.stateDir, "workspace"),
  ]);

  try {
    const entries = await fs.readdir(params.stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("workspace")) {
        scanRoots.push(path.join(params.stateDir, entry.name));
      }
    }
  } catch {
    // ignore unreadable state dir
  }

  for (const workspaceDir of scanRoots) {
    const groupRootDir = path.join(workspaceDir, ".openbot", "collaboration", "groups");
    for (const candidate of groupDirCandidates(groupRootDir, params.groupId)) {
      if (await pathExists(candidate)) {
        found.add(path.resolve(candidate));
      }
    }
  }

  return [...found].toSorted((left, right) => left.localeCompare(right));
}

export async function migrateCollaborationGroupStorage(params: {
  groupId: string;
  collaborationRoot: string;
  legacyGroupDirs: string[];
  managedSpaceProfilePath?: string | null;
  backupDir?: string | null;
  dryRun?: boolean;
  removeLegacyCopies?: boolean;
}): Promise<GroupStorageMigrationReport> {
  const dryRun = params.dryRun ?? false;
  const canonicalGroupDir = resolveGroupWorkspacePath(
    resolveCollaborationSharedGroupRoot(params.collaborationRoot),
    params.groupId,
  );
  const canonicalMemoryDir = path.join(canonicalGroupDir, "memory");
  const legacyGroupDirs = uniquePaths(
    params.legacyGroupDirs.filter((dir) => path.resolve(dir) !== path.resolve(canonicalGroupDir)),
  );

  const taskSources = await collectLedgerSources<LedgerItem>(legacyGroupDirs, "task_ledger.json");
  const artifactSources = await collectLedgerSources<LedgerItem>(
    legacyGroupDirs,
    "artifact_ledger.json",
  );
  const mergedTasks = mergeLedgerItems(taskSources.map((entry) => entry.items));
  const mergedArtifacts = mergeLedgerItems(artifactSources.map((entry) => entry.items));
  const checkpointFiles = await collectCheckpointFiles(legacyGroupDirs);
  const topLevelFiles = await collectTopLevelGroupFiles(legacyGroupDirs);

  const report: GroupStorageMigrationReport = {
    groupId: params.groupId,
    collaborationRoot: path.resolve(params.collaborationRoot),
    canonicalGroupDir,
    canonicalMemoryDir,
    legacyGroupDirs,
    mergedTaskCount: mergedTasks.length,
    mergedArtifactCount: mergedArtifacts.length,
    mergedCheckpointCount: checkpointFiles.size,
    copiedGroupFiles: [],
    updatedProfilePaths: [],
    backupDir: params.backupDir ?? null,
    removedLegacyDirs: [],
    dryRun,
  };

  if (dryRun) {
    report.copiedGroupFiles = [...topLevelFiles.keys()];
    if (params.managedSpaceProfilePath) {
      report.updatedProfilePaths.push(params.managedSpaceProfilePath);
    }
    return report;
  }

  if (params.backupDir) {
    await fs.mkdir(params.backupDir, { recursive: true });
    for (const legacyDir of legacyGroupDirs) {
      const backupTarget = path.join(
        params.backupDir,
        legacyDir.replaceAll(path.sep, "__").replaceAll(":", "_"),
      );
      await fs.cp(legacyDir, backupTarget, { recursive: true, force: true });
    }
  }

  await fs.mkdir(path.join(canonicalMemoryDir, "checkpoints"), { recursive: true });

  const now = new Date().toISOString();
  await writeJsonFileAtomically(path.join(canonicalMemoryDir, "task_ledger.json"), {
    version: 1,
    updated_at: now,
    items: mergedTasks,
  } satisfies LedgerFile);
  await writeJsonFileAtomically(path.join(canonicalMemoryDir, "artifact_ledger.json"), {
    version: 1,
    updated_at: now,
    items: mergedArtifacts,
  } satisfies LedgerFile);

  for (const [filename, sourcePath] of checkpointFiles.entries()) {
    const targetPath = path.join(canonicalMemoryDir, "checkpoints", filename);
    await fs.copyFile(sourcePath, targetPath);
  }

  for (const [filename, sourcePath] of topLevelFiles.entries()) {
    const targetPath = path.join(canonicalGroupDir, filename);
    await fs.copyFile(sourcePath, targetPath);
    report.copiedGroupFiles.push(filename);
  }

  if (params.managedSpaceProfilePath && (await pathExists(params.managedSpaceProfilePath))) {
    const raw = JSON.parse(await fs.readFile(params.managedSpaceProfilePath, "utf8")) as {
      profile?: Record<string, unknown>;
    };
    const profile = (raw.profile ?? raw) as Record<string, unknown>;
    profile.workspacePath = canonicalGroupDir;
    profile.updatedAtMs = Date.now();
    const nextPayload = raw.profile ? { profile } : profile;
    await writeJsonFileAtomically(params.managedSpaceProfilePath, nextPayload);
    report.updatedProfilePaths.push(params.managedSpaceProfilePath);

    const canonicalProfilePath = path.join(canonicalGroupDir, "profile.json");
    await writeJsonFileAtomically(canonicalProfilePath, profile);
    report.copiedGroupFiles.push("profile.json");
  }

  if (params.removeLegacyCopies) {
    for (const legacyDir of legacyGroupDirs) {
      await fs.rm(legacyDir, { recursive: true, force: true });
      report.removedLegacyDirs.push(legacyDir);
    }
  }

  return report;
}

export function resolveManagedSpaceProfilePath(stateDir: string, groupId: string): string {
  return path.join(stateDir, "spaces", groupId, "profile.json");
}
