import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type WorkspaceStatus = "draft" | "testing" | "ready" | "error";
export type WorkspaceKind = "local" | "cloud";
export type CloudWorkspaceProvider =
  | "aliyun-oss"
  | "aws-s3"
  | "azure-blob"
  | "huawei-obs"
  | "s3-compatible";

export type LocalWorkspaceConfig = {
  path: string;
  resolvedPath: string;
  readable: boolean;
  writable: boolean;
};

export type CloudWorkspaceConfig = {
  provider: CloudWorkspaceProvider;
  endpoint: string;
  bucket: string;
  rootPrefix: string;
  region?: string;
  accountName?: string;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  runtimePath: string;
  createdAt: string;
  updatedAt: string;
  credentialRef?: string;
  lastError?: string | null;
  local?: LocalWorkspaceConfig;
  cloud?: CloudWorkspaceConfig;
};

type StoredWorkspaceCredential = {
  ref: string;
  provider: CloudWorkspaceProvider;
  accessKeyId: string;
  secretAccessKey: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceStorePayload = {
  version: 1;
  workspaces: WorkspaceRecord[];
  robotBindings: Record<string, string>;
};

type WorkspaceCredentialPayload = {
  version: 1;
  credentials: StoredWorkspaceCredential[];
};

const WORKSPACE_STORE_VERSION = 1 as const;

function resolveWorkspaceRootDir() {
  return path.join(resolveStateDir(), "workspaces");
}

function resolveWorkspaceStorePath() {
  return path.join(resolveWorkspaceRootDir(), "store.json");
}

function resolveWorkspaceCredentialStorePath() {
  return path.join(resolveWorkspaceRootDir(), "credentials.json");
}

async function ensureWorkspaceStoreDir() {
  const rootDir = resolveWorkspaceRootDir();
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  return rootDir;
}

async function readJsonFileOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await ensureWorkspaceStoreDir();
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function loadWorkspaceStore(): Promise<WorkspaceStorePayload> {
  return await readJsonFileOrDefault(resolveWorkspaceStorePath(), {
    version: WORKSPACE_STORE_VERSION,
    workspaces: [],
    robotBindings: {},
  } satisfies WorkspaceStorePayload);
}

async function saveWorkspaceStore(store: WorkspaceStorePayload) {
  await writeJsonFile(resolveWorkspaceStorePath(), store);
}

async function loadWorkspaceCredentialStore(): Promise<WorkspaceCredentialPayload> {
  return await readJsonFileOrDefault(resolveWorkspaceCredentialStorePath(), {
    version: WORKSPACE_STORE_VERSION,
    credentials: [],
  } satisfies WorkspaceCredentialPayload);
}

async function saveWorkspaceCredentialStore(store: WorkspaceCredentialPayload) {
  await writeJsonFile(resolveWorkspaceCredentialStorePath(), store);
}

export async function saveWorkspaceCredential(params: {
  provider: CloudWorkspaceProvider;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const store = await loadWorkspaceCredentialStore();
  const now = new Date().toISOString();
  const ref = `workspace-cred:${randomUUID()}`;
  store.credentials.push({
    ref,
    provider: params.provider,
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    createdAt: now,
    updatedAt: now,
  });
  await saveWorkspaceCredentialStore(store);
  return ref;
}

export async function getWorkspaceCredentialByRef(ref: string) {
  const store = await loadWorkspaceCredentialStore();
  return store.credentials.find((entry) => entry.ref === ref) ?? null;
}

export async function upsertWorkspace(record: WorkspaceRecord) {
  const store = await loadWorkspaceStore();
  const existingIndex = store.workspaces.findIndex((entry) => entry.id === record.id);
  if (existingIndex >= 0) {
    store.workspaces[existingIndex] = record;
  } else {
    store.workspaces.push(record);
  }
  await saveWorkspaceStore(store);
}

export async function createWorkspaceRecord(
  params: Omit<WorkspaceRecord, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date().toISOString();
  const record: WorkspaceRecord = {
    id: `ws_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    ...params,
  };
  await upsertWorkspace(record);
  return record;
}

export async function getWorkspaceById(workspaceId: string) {
  const store = await loadWorkspaceStore();
  return store.workspaces.find((entry) => entry.id === workspaceId) ?? null;
}

export async function bindRobotWorkspace(agentId: string, workspaceId: string) {
  const store = await loadWorkspaceStore();
  store.robotBindings[agentId] = workspaceId;
  await saveWorkspaceStore(store);
}

export async function getBoundWorkspaceId(agentId: string) {
  const store = await loadWorkspaceStore();
  return store.robotBindings[agentId] ?? null;
}

export async function ensureWorkspaceRuntimeDir(workspaceId: string) {
  const runtimePath = path.join(resolveWorkspaceRootDir(), "runtime", workspaceId);
  await fs.mkdir(runtimePath, { recursive: true, mode: 0o700 });
  return runtimePath;
}

export type DecommissionRobotWorkspaceResult = {
  workspaceId: string | null;
  localPath: string | null;
  runtimePath: string | null;
};

/**
 * Removes a robot's workspace-store binding and workspace record. Returns paths
 * the caller should trash alongside agent config/session dirs.
 */
export async function decommissionRobotWorkspace(
  agentId: string,
): Promise<DecommissionRobotWorkspaceResult> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return { workspaceId: null, localPath: null, runtimePath: null };
  }
  const store = await loadWorkspaceStore();
  const workspaceId = store.robotBindings[normalizedAgentId] ?? null;
  delete store.robotBindings[normalizedAgentId];

  let localPath: string | null = null;
  if (workspaceId) {
    const index = store.workspaces.findIndex((entry) => entry.id === workspaceId);
    if (index >= 0) {
      const record = store.workspaces[index];
      if (record?.kind === "local") {
        localPath = record.local?.resolvedPath?.trim() || record.local?.path?.trim() || null;
      }
      store.workspaces.splice(index, 1);
    }
  }
  await saveWorkspaceStore(store);

  const runtimePath = workspaceId
    ? path.join(resolveWorkspaceRootDir(), "runtime", workspaceId)
    : null;
  return { workspaceId, localPath, runtimePath };
}
