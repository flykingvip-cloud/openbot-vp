import { createHash, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { bindOrganizationTaskForPersist } from "../gateway/evolution-control/task-outcome-binding.js";
import { resolveLiveCollaborationWorkspaceRoot } from "../gateway/workspace/group-locator.js";

export type TaskAssignmentStatus = "pending" | "accepted" | "running" | "completed" | "rejected";

/**
 * Routing policy lives in routing-policy.ts. Evolution apply/rollback may
 * revise that policy for *new* tasks only — never rewrite in-flight owners
 * or replay completed assignments.
 */

export type TaskAssignment = {
  id: string;
  organizationId: string;
  title: string;
  ownerAgentId: string;
  createdByAgentId: string;
  status: TaskAssignmentStatus;
  createdAt: string;
  updatedAt: string;
  ackRequired: boolean;
  acknowledgedAt?: string;
  completedAt?: string;
  notes?: string;
  /** Phase C4: human assignee (the new "person" dimension); absent = legacy per-agent task. */
  assigneeUserId?: string;
  /** Phase C4: due timestamp (ISO 8601). */
  dueAt?: string;
  /** Phase C4: provenance for meeting-derived tasks (used to recycle on meeting cancel). */
  sourceRef?: { kind: "meeting" | "collab-dispatch"; id: string };
  /** Authority tenant from the meeting/group writer. Never inferred later. */
  tenantId?: string;
  /** Trusted run id from the executor. Never inferred from title or group name. */
  runId?: string;
  /** Live evolution binding. Written only by the trusted organization binder. */
  experimentId?: string;
  applicationId?: string;
  cohortRef?: string;
};

type StoredTaskAssignments = {
  assignments?: TaskAssignment[];
};

function normalizeValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function nowIso(now: Date | string | undefined): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

export function buildTaskAssignmentId(params: {
  organizationId: string;
  title: string;
  ownerAgentId: string;
  createdByAgentId: string;
}): string {
  const input = [
    params.organizationId,
    params.title.trim(),
    params.ownerAgentId.trim(),
    params.createdByAgentId.trim(),
  ].join("\n");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function createTaskAssignment(params: {
  organizationId: string;
  title: string;
  ownerAgentId: string;
  createdByAgentId: string;
  id?: string;
  now?: Date | string;
  ackRequired?: boolean;
  notes?: string;
  tenantId?: string;
  runId?: string;
  assigneeUserId?: string;
}): TaskAssignment {
  const createdAt = nowIso(params.now);
  const organizationId = params.organizationId.trim();
  const title = params.title.trim();
  const ownerAgentId = params.ownerAgentId.trim();
  const createdByAgentId = params.createdByAgentId.trim();
  const notes = normalizeValue(params.notes);
  const tenantId = normalizeValue(params.tenantId);
  const runId = normalizeValue(params.runId);
  const assigneeUserId = normalizeValue(params.assigneeUserId);
  return {
    id:
      normalizeValue(params.id) ??
      buildTaskAssignmentId({ organizationId, title, ownerAgentId, createdByAgentId }),
    organizationId,
    title,
    ownerAgentId,
    createdByAgentId,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    ackRequired: params.ackRequired ?? true,
    ...(notes ? { notes } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(runId ? { runId } : {}),
    ...(assigneeUserId ? { assigneeUserId } : {}),
  };
}

/**
 * Deterministic id for a meeting-derived per-attendee task (stable across re-distribute,
 * so confirming a meeting's minutes twice replaces rather than duplicates the task).
 */
export function meetingTaskAssignmentId(
  meetingId: string,
  assigneeUserId: string,
  title: string,
): string {
  const titleHash = createHash("sha256").update(title.trim()).digest("hex").slice(0, 12);
  return `meeting-task:${meetingId}:${assigneeUserId.trim()}:${titleHash}`;
}

/**
 * Builds a meeting-derived TaskAssignment for one attendee (Phase C4). The assignee
 * is the human (`assigneeUserId`); `ownerAgentId`/`createdByAgentId` default to the
 * steward `main` (the agent that manages it — the organizer is a user, not an agent).
 * `sourceRef` records the originating meeting so cancel can recycle it. Owner/assignee
 * are stamped by the caller (the resolved organizer), never taken from untrusted input.
 */
export function buildMeetingTaskAssignment(params: {
  meetingId: string;
  organizationId: string;
  assigneeUserId: string;
  title: string;
  dueAt?: string;
  ownerAgentId?: string;
  createdByAgentId?: string;
  notes?: string;
  tenantId?: string;
  now?: Date | string;
}): TaskAssignment {
  const createdAt = nowIso(params.now);
  const title = params.title.trim();
  const assigneeUserId = params.assigneeUserId.trim();
  const ownerAgentId = (normalizeValue(params.ownerAgentId) ?? "main").trim();
  const dueAt = normalizeValue(params.dueAt);
  const notes = normalizeValue(params.notes);
  const tenantId = normalizeValue(params.tenantId);
  return {
    id: meetingTaskAssignmentId(params.meetingId, assigneeUserId, title),
    organizationId: params.organizationId.trim(),
    title,
    ownerAgentId,
    createdByAgentId: normalizeValue(params.createdByAgentId) ?? ownerAgentId,
    assigneeUserId,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    ackRequired: true,
    ...(dueAt ? { dueAt } : {}),
    sourceRef: { kind: "meeting", id: params.meetingId },
    ...(notes ? { notes } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

/**
 * Deterministic id for a CollabDispatch todo projection (no time window — §5.3).
 */
export function collabDispatchTodoAssignmentId(dispatchId: string, assigneeUserId: string): string {
  return `collab-todo:${dispatchId.trim()}:${assigneeUserId.trim()}`;
}

/**
 * Builds a CollabDispatch-derived TaskAssignment todo for one user when the
 * dispatch has no time window (Sprint D3). With a time window, prefer ScheduleEntry.
 */
export function buildCollabDispatchTodoAssignment(params: {
  dispatchId: string;
  organizationId: string;
  assigneeUserId: string;
  title: string;
  notes?: string;
  ownerAgentId?: string;
  createdByAgentId?: string;
  tenantId?: string;
  now?: Date | string;
}): TaskAssignment {
  const createdAt = nowIso(params.now);
  const title = params.title.trim();
  const assigneeUserId = params.assigneeUserId.trim();
  const ownerAgentId = (normalizeValue(params.ownerAgentId) ?? "main").trim();
  const notes = normalizeValue(params.notes);
  const tenantId = normalizeValue(params.tenantId);
  return {
    id: collabDispatchTodoAssignmentId(params.dispatchId, assigneeUserId),
    organizationId: params.organizationId.trim(),
    title,
    ownerAgentId,
    createdByAgentId: normalizeValue(params.createdByAgentId) ?? ownerAgentId,
    assigneeUserId,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    ackRequired: true,
    sourceRef: { kind: "collab-dispatch", id: params.dispatchId },
    ...(notes ? { notes } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

export function transitionTaskAssignment(
  assignment: TaskAssignment,
  status: TaskAssignmentStatus,
  params?: { now?: Date | string; notes?: string },
): TaskAssignment {
  const updatedAt = nowIso(params?.now);
  const notes = normalizeValue(params?.notes);
  return {
    ...assignment,
    status,
    updatedAt,
    ...(status === "accepted" || status === "running" || status === "completed"
      ? { acknowledgedAt: assignment.acknowledgedAt ?? updatedAt }
      : {}),
    ...(status === "completed" ? { completedAt: updatedAt } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function resolveOrganizationMemoryDir(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}): string {
  void params.workspaceDir;
  const root = path.join(resolveLiveCollaborationWorkspaceRoot(params.cfg), "groups");
  return path.join(root, encodePathSegment(params.organizationId), "memory");
}

export function resolveManagedOrganizationMemoryDir(organizationId: string): string {
  return path.join(
    resolveStateDir(),
    "collaboration",
    "groups",
    encodePathSegment(organizationId),
    "memory",
  );
}

function getAssignmentsFile(memoryDir: string): string {
  return path.join(memoryDir, "assignments.json");
}

function isTaskAssignment(value: unknown): value is TaskAssignment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.organizationId === "string" &&
    typeof record.title === "string" &&
    typeof record.ownerAgentId === "string" &&
    typeof record.createdByAgentId === "string" &&
    typeof record.status === "string"
  );
}

function parseAssignmentsJson(raw: string): TaskAssignment[] {
  const value = JSON.parse(raw) as StoredTaskAssignments | unknown[];
  const assignments: unknown[] = Array.isArray(value)
    ? value
    : Array.isArray(value.assignments)
      ? (value.assignments ?? [])
      : [];
  return assignments.filter(isTaskAssignment);
}

async function readAssignmentsFile(filePath: string): Promise<TaskAssignment[]> {
  try {
    return parseAssignmentsJson(await fs.readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

function readAssignmentsFileSync(filePath: string): TaskAssignment[] {
  try {
    if (!fsSync.existsSync(filePath)) {
      return [];
    }
    return parseAssignmentsJson(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

export async function readOrganizationTaskAssignments(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}): Promise<TaskAssignment[]> {
  const workspaceFile = getAssignmentsFile(resolveOrganizationMemoryDir(params));
  const managedFile = getAssignmentsFile(
    resolveManagedOrganizationMemoryDir(params.organizationId),
  );
  const [workspaceAssignments, managedAssignments] = await Promise.all([
    readAssignmentsFile(workspaceFile),
    readAssignmentsFile(managedFile),
  ]);
  const byId = new Map<string, TaskAssignment>();
  for (const assignment of [...managedAssignments, ...workspaceAssignments]) {
    byId.set(assignment.id, assignment);
  }
  return [...byId.values()];
}

export type OrganizationTaskPersistOptions = {
  persistDir?: string;
};

async function stampOrganizationAssignments(
  organizationId: string,
  assignments: TaskAssignment[],
  persistDir?: string,
): Promise<TaskAssignment[]> {
  const previous = await readManagedOrganizationTaskAssignments(organizationId);
  const previousById = new Map(previous.map((row) => [row.id, row]));
  return assignments.map((assignment) =>
    bindOrganizationTaskForPersist(assignment, previousById.get(assignment.id), persistDir),
  );
}

export async function writeOrganizationTaskAssignments(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  assignments: TaskAssignment[];
  persistDir?: string;
}): Promise<TaskAssignment[]> {
  const previousAssignments = await readOrganizationTaskAssignments({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.organizationId,
  });
  const previousById = new Map(previousAssignments.map((row) => [row.id, row]));
  const stamped = params.assignments.map((assignment) =>
    bindOrganizationTaskForPersist(assignment, previousById.get(assignment.id), params.persistDir),
  );
  const memoryDir = resolveOrganizationMemoryDir(params);
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(
    getAssignmentsFile(memoryDir),
    `${JSON.stringify({ assignments: stamped }, null, 2)}\n`,
  );
  return stamped;
}

export async function upsertOrganizationTaskAssignment(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  assignment: TaskAssignment;
  persistDir?: string;
}): Promise<TaskAssignment> {
  const assignments = await readOrganizationTaskAssignments({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.assignment.organizationId,
  });
  const next = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const id = params.assignment.id || randomUUID();
  next.set(id, { ...params.assignment, id });
  const written = await writeOrganizationTaskAssignments({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.assignment.organizationId,
    assignments: [...next.values()],
    persistDir: params.persistDir,
  });
  const stamped = written.find((row) => row.id === id);
  if (!stamped) {
    throw new Error(`Organization task persist lost assignment ${id}`);
  }
  return stamped;
}

/**
 * Managed-dir task store (Phase C4). Meeting fan-out is gateway-side and actor-scoped
 * (not tied to a specific agent workspace), so it reads/writes the workspace-independent
 * managed dir (`<stateDir>/collaboration/groups/<org>/memory`). `readOrganizationTaskAssignments`
 * already merges this dir, so M1 picks these tasks up without any workspace plumbing.
 */
export async function readManagedOrganizationTaskAssignments(
  organizationId: string,
): Promise<TaskAssignment[]> {
  return readAssignmentsFile(
    getAssignmentsFile(resolveManagedOrganizationMemoryDir(organizationId)),
  );
}

export function readManagedOrganizationTaskAssignmentsSync(
  organizationId: string,
): TaskAssignment[] {
  return readAssignmentsFileSync(
    getAssignmentsFile(resolveManagedOrganizationMemoryDir(organizationId)),
  );
}

export function taskAssignmentLatencyMs(task: TaskAssignment): number | undefined {
  if (!task.completedAt) {
    return undefined;
  }
  const createdAt = Date.parse(task.createdAt);
  const completedAt = Date.parse(task.completedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) || completedAt < createdAt) {
    return undefined;
  }
  return completedAt - createdAt;
}

export async function writeManagedOrganizationTaskAssignments(
  organizationId: string,
  assignments: TaskAssignment[],
  options?: OrganizationTaskPersistOptions,
): Promise<TaskAssignment[]> {
  const stamped = await stampOrganizationAssignments(
    organizationId,
    assignments,
    options?.persistDir,
  );
  const memoryDir = resolveManagedOrganizationMemoryDir(organizationId);
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(
    getAssignmentsFile(memoryDir),
    `${JSON.stringify({ assignments: stamped }, null, 2)}\n`,
  );
  return stamped;
}

export async function upsertManagedOrganizationTaskAssignment(
  assignment: TaskAssignment,
  options?: OrganizationTaskPersistOptions,
): Promise<TaskAssignment> {
  const existing = await readManagedOrganizationTaskAssignments(assignment.organizationId);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  byId.set(assignment.id, assignment);
  const written = await writeManagedOrganizationTaskAssignments(
    assignment.organizationId,
    [...byId.values()],
    options,
  );
  const stamped = written.find((row) => row.id === assignment.id);
  if (!stamped) {
    throw new Error(`Organization task persist lost assignment ${assignment.id}`);
  }
  return stamped;
}
