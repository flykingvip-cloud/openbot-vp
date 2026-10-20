import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveManagedOrganizationMemoryDir,
  resolveOrganizationMemoryDir,
} from "./task-assignment.js";

export type PresenceState = {
  agentId: string;
  online: boolean;
  lastActiveAt: string;
  currentTask?: string;
};

type StoredPresence = {
  presence?: PresenceState[];
};

function getPresenceFile(memoryDir: string): string {
  return path.join(memoryDir, "presence.json");
}

function normalizeValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPresenceState(value: unknown): value is PresenceState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.agentId === "string" &&
    typeof record.online === "boolean" &&
    typeof record.lastActiveAt === "string"
  );
}

async function readPresenceFile(filePath: string): Promise<PresenceState[]> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as StoredPresence | unknown[];
    const presence: unknown[] = Array.isArray(value)
      ? value
      : Array.isArray(value.presence)
        ? (value.presence ?? [])
        : [];
    return presence.filter(isPresenceState);
  } catch {
    return [];
  }
}

export async function readOrganizationPresence(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}): Promise<PresenceState[]> {
  const workspaceFile = getPresenceFile(resolveOrganizationMemoryDir(params));
  const managedFile = getPresenceFile(resolveManagedOrganizationMemoryDir(params.organizationId));
  const [workspacePresence, managedPresence] = await Promise.all([
    readPresenceFile(workspaceFile),
    readPresenceFile(managedFile),
  ]);
  const byAgentId = new Map<string, PresenceState>();
  for (const presence of [...managedPresence, ...workspacePresence]) {
    byAgentId.set(presence.agentId, presence);
  }
  return [...byAgentId.values()];
}

export async function writeOrganizationPresence(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  presence: PresenceState[];
}): Promise<void> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(
    getPresenceFile(memoryDir),
    `${JSON.stringify({ presence: params.presence }, null, 2)}\n`,
  );
}

export async function upsertOrganizationPresence(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  presence: PresenceState;
}): Promise<PresenceState> {
  const presence = await readOrganizationPresence(params);
  const next = new Map(presence.map((entry) => [entry.agentId, entry]));
  const currentTask = normalizeValue(params.presence.currentTask);
  next.set(params.presence.agentId, {
    ...params.presence,
    ...(currentTask ? { currentTask } : {}),
  });
  await writeOrganizationPresence({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.organizationId,
    presence: [...next.values()],
  });
  return params.presence;
}
