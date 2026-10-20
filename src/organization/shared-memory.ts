import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveManagedOrganizationMemoryDir,
  resolveOrganizationMemoryDir,
} from "./task-assignment.js";

export type OrganizationDecisionStatus = "proposed" | "approved" | "rejected" | "superseded";
export type OrganizationArtifactStatus = "draft" | "ready" | "published" | "archived";
export type OrganizationOwnershipSubject = "artifact" | "task" | "decision";

export type OrganizationDecision = {
  id: string;
  organizationId: string;
  title: string;
  status: OrganizationDecisionStatus;
  createdByAgentId: string;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
  rationale?: string;
  notes?: string;
};

export type OrganizationArtifact = {
  id: string;
  organizationId: string;
  title: string;
  artifactType: string;
  ownerAgentId: string;
  createdByAgentId: string;
  createdAt: string;
  updatedAt: string;
  taskId: string;
  uri?: string;
  status: OrganizationArtifactStatus;
  notes?: string;
};

export type OrganizationOwnership = {
  id: string;
  organizationId: string;
  subjectType: OrganizationOwnershipSubject;
  subjectId: string;
  ownerAgentId: string;
  assignedByAgentId: string;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
  notes?: string;
};

function normalizeValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nowIso(now: Date | string | undefined): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16)}`;
}

function getMemoryFile(memoryDir: string, fileName: string): string {
  return path.join(memoryDir, fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isDecision(value: unknown): value is OrganizationDecision {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.title === "string" &&
    typeof value.createdByAgentId === "string" &&
    typeof value.status === "string"
  );
}

function isArtifact(value: unknown): value is OrganizationArtifact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.title === "string" &&
    typeof value.artifactType === "string" &&
    typeof value.ownerAgentId === "string" &&
    typeof value.taskId === "string"
  );
}

function isOwnership(value: unknown): value is OrganizationOwnership {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.subjectType === "string" &&
    typeof value.subjectId === "string" &&
    typeof value.ownerAgentId === "string"
  );
}

async function readItems<T>(filePath: string, guard: (value: unknown) => value is T): Promise<T[]> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    const items = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.items)
        ? value.items
        : [];
    return items.filter(guard);
  } catch {
    return [];
  }
}

async function readOrganizationMemoryFile<T>(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  fileName: string;
  guard: (value: unknown) => value is T;
}): Promise<T[]> {
  const workspaceFile = getMemoryFile(resolveOrganizationMemoryDir(params), params.fileName);
  const managedFile = getMemoryFile(
    resolveManagedOrganizationMemoryDir(params.organizationId),
    params.fileName,
  );
  const [workspaceItems, managedItems] = await Promise.all([
    readItems(workspaceFile, params.guard),
    readItems(managedFile, params.guard),
  ]);
  const byId = new Map<string, T>();
  for (const item of [...managedItems, ...workspaceItems]) {
    const id = isRecord(item) && typeof item.id === "string" ? item.id : undefined;
    if (id) {
      byId.set(id, item);
    }
  }
  return [...byId.values()];
}

async function writeOrganizationMemoryFile<T extends { id: string }>(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  fileName: string;
  items: T[];
}): Promise<void> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(
    getMemoryFile(memoryDir, params.fileName),
    `${JSON.stringify({ items: params.items }, null, 2)}\n`,
  );
}

export function createOrganizationDecision(params: {
  organizationId: string;
  title: string;
  createdByAgentId: string;
  status?: OrganizationDecisionStatus;
  taskId?: string;
  rationale?: string;
  notes?: string;
  now?: Date | string;
}): OrganizationDecision {
  const createdAt = nowIso(params.now);
  const organizationId = params.organizationId.trim();
  const title = params.title.trim();
  const createdByAgentId = params.createdByAgentId.trim();
  return {
    id: stableId("decision", [organizationId, title, createdByAgentId]),
    organizationId,
    title,
    createdByAgentId,
    status: params.status ?? "proposed",
    createdAt,
    updatedAt: createdAt,
    ...(normalizeValue(params.taskId) ? { taskId: params.taskId?.trim() } : {}),
    ...(normalizeValue(params.rationale) ? { rationale: params.rationale?.trim() } : {}),
    ...(normalizeValue(params.notes) ? { notes: params.notes?.trim() } : {}),
  };
}

export function createOrganizationArtifact(params: {
  organizationId: string;
  title: string;
  artifactType: string;
  ownerAgentId: string;
  createdByAgentId: string;
  taskId: string;
  uri?: string;
  status?: OrganizationArtifactStatus;
  notes?: string;
  now?: Date | string;
}): OrganizationArtifact {
  const createdAt = nowIso(params.now);
  const organizationId = params.organizationId.trim();
  const title = params.title.trim();
  const taskId = params.taskId.trim();
  const ownerAgentId = params.ownerAgentId.trim();
  const artifactType = params.artifactType.trim();
  return {
    id: stableId("artifact", [organizationId, taskId, title, artifactType]),
    organizationId,
    title,
    artifactType,
    ownerAgentId,
    createdByAgentId: params.createdByAgentId.trim(),
    taskId,
    status: params.status ?? "draft",
    createdAt,
    updatedAt: createdAt,
    ...(normalizeValue(params.uri) ? { uri: params.uri?.trim() } : {}),
    ...(normalizeValue(params.notes) ? { notes: params.notes?.trim() } : {}),
  };
}

export function createOrganizationOwnership(params: {
  organizationId: string;
  subjectType: OrganizationOwnershipSubject;
  subjectId: string;
  ownerAgentId: string;
  assignedByAgentId: string;
  taskId?: string;
  notes?: string;
  now?: Date | string;
}): OrganizationOwnership {
  const createdAt = nowIso(params.now);
  const organizationId = params.organizationId.trim();
  const subjectId = params.subjectId.trim();
  const ownerAgentId = params.ownerAgentId.trim();
  return {
    id: stableId("ownership", [organizationId, params.subjectType, subjectId, ownerAgentId]),
    organizationId,
    subjectType: params.subjectType,
    subjectId,
    ownerAgentId,
    assignedByAgentId: params.assignedByAgentId.trim(),
    createdAt,
    updatedAt: createdAt,
    ...(normalizeValue(params.taskId) ? { taskId: params.taskId?.trim() } : {}),
    ...(normalizeValue(params.notes) ? { notes: params.notes?.trim() } : {}),
  };
}

export const readOrganizationDecisions = (params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}) =>
  readOrganizationMemoryFile({
    ...params,
    fileName: "decisions.json",
    guard: isDecision,
  });

export const readOrganizationArtifacts = (params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}) =>
  readOrganizationMemoryFile({
    ...params,
    fileName: "artifacts.json",
    guard: isArtifact,
  });

export const readOrganizationOwnerships = (params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}) =>
  readOrganizationMemoryFile({
    ...params,
    fileName: "ownerships.json",
    guard: isOwnership,
  });

export async function upsertOrganizationDecision(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  decision: OrganizationDecision;
}): Promise<OrganizationDecision> {
  const items = await readOrganizationDecisions({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.decision.organizationId,
  });
  const next = new Map(items.map((item) => [item.id, item]));
  next.set(params.decision.id, params.decision);
  await writeOrganizationMemoryFile({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.decision.organizationId,
    fileName: "decisions.json",
    items: [...next.values()],
  });
  return params.decision;
}

export async function upsertOrganizationArtifact(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  artifact: OrganizationArtifact;
}): Promise<OrganizationArtifact> {
  const items = await readOrganizationArtifacts({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.artifact.organizationId,
  });
  const next = new Map(items.map((item) => [item.id, item]));
  next.set(params.artifact.id, params.artifact);
  await writeOrganizationMemoryFile({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.artifact.organizationId,
    fileName: "artifacts.json",
    items: [...next.values()],
  });
  return params.artifact;
}

export async function upsertOrganizationOwnership(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  ownership: OrganizationOwnership;
}): Promise<OrganizationOwnership> {
  const items = await readOrganizationOwnerships({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.ownership.organizationId,
  });
  const next = new Map(items.map((item) => [item.id, item]));
  next.set(params.ownership.id, params.ownership);
  await writeOrganizationMemoryFile({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.ownership.organizationId,
    fileName: "ownerships.json",
    items: [...next.values()],
  });
  return params.ownership;
}
