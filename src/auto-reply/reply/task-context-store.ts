import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { writeFileWithinRoot } from "../../infra/fs-safe.js";
import { truncateUtf16Safe } from "../../utils.js";
import {
  type MemoryCheckpoint,
  type MemoryScope,
  type TaskLedgerEntry,
  type TaskStatus,
  detachArtifactsForTask,
  isTerminalTaskStatus,
  normalizeTaskStatus,
  resolveContinuityMemoryRoot,
} from "./session-continuity.js";

const TASK_LEDGER_FILE = "task_ledger.json";

export { isTerminalTaskStatus, normalizeTaskStatus } from "./session-continuity.js";

type LedgerFile<T> = {
  version: 1;
  updated_at: string;
  items: T[];
};

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeLedger(rootDir: string, items: TaskLedgerEntry[]): Promise<void> {
  const payload: LedgerFile<TaskLedgerEntry> = {
    version: 1,
    updated_at: new Date().toISOString(),
    items: items.toSorted((a, b) => a.updated_at.localeCompare(b.updated_at)),
  };
  await writeFileWithinRoot({
    rootDir,
    relativePath: TASK_LEDGER_FILE,
    data: `${JSON.stringify(payload, null, 2)}\n`,
    encoding: "utf8",
  });
}

async function readTaskLedger(rootDir: string): Promise<LedgerFile<TaskLedgerEntry>> {
  return await readJsonFile<LedgerFile<TaskLedgerEntry>>(path.join(rootDir, TASK_LEDGER_FILE), {
    version: 1,
    updated_at: new Date(0).toISOString(),
    items: [],
  });
}

/**
 * Mint an immutable random UUID-based task id (Sprint-3).
 * Format matches neighboring create*Id helpers: `task_` + uuid without dashes.
 * Must NOT derive from title/scope/owner — title updates must not rotate identity.
 * Legacy title-hash ids (`task_` + 16 hex of sha256(scope+owner+title)) remain valid
 * for lookup/update; we do not rewrite existing ledger rows.
 */
function mintTaskId(): string {
  return `task_${crypto.randomUUID().replace(/-/g, "")}`;
}

export type TaskContextScope = {
  scope: Extract<MemoryScope, "agent" | "group">;
  ownerId: string;
  rootDir: string;
};

export function resolveTaskContextScope(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
}): TaskContextScope {
  const groupId = params.sessionEntry?.groupId?.trim() || params.sessionEntry?.space?.trim();
  if (groupId) {
    return {
      scope: "group",
      ownerId: groupId,
      rootDir: resolveContinuityMemoryRoot({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        scope: "group",
        ownerId: groupId,
      }),
    };
  }
  const spaceMatch = params.sessionKey?.match(/(?:^|:)space:([^:]+)$/i);
  if (spaceMatch?.[1]) {
    const ownerId = spaceMatch[1];
    return {
      scope: "group",
      ownerId,
      rootDir: resolveContinuityMemoryRoot({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        scope: "group",
        ownerId,
      }),
    };
  }
  return {
    scope: "agent",
    ownerId: params.agentId,
    rootDir: resolveContinuityMemoryRoot({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      scope: "agent",
      ownerId: params.agentId,
    }),
  };
}

export async function listTaskContexts(scope: TaskContextScope): Promise<TaskLedgerEntry[]> {
  const ledger = await readTaskLedger(scope.rootDir);
  return ledger.items;
}

export async function getTaskContext(
  scope: TaskContextScope,
  taskId: string,
): Promise<TaskLedgerEntry | undefined> {
  const ledger = await readTaskLedger(scope.rootDir);
  return ledger.items.find((task) => task.id === taskId);
}

export async function createTaskContext(params: {
  scope: TaskContextScope;
  title: string;
  description?: string;
  status?: TaskStatus;
}): Promise<TaskLedgerEntry> {
  const title = params.title.trim();
  if (!title) {
    throw new Error("task title is required");
  }
  const ledger = await readTaskLedger(params.scope.rootDir);
  const now = new Date().toISOString();
  const task: TaskLedgerEntry = {
    id: mintTaskId(),
    scope: params.scope.scope,
    owner_id: params.scope.ownerId,
    title: truncateUtf16Safe(title, 120),
    description: params.description?.trim() ?? "",
    status: params.status ?? "active",
    context: { key_points: [] },
    artifacts: [],
    session_ids: [],
    last_session_id: "",
    updated_at: now,
  };
  const existing = ledger.items.find((entry) => entry.id === task.id);
  if (existing) {
    return existing;
  }
  await writeLedger(params.scope.rootDir, [...ledger.items, task]);
  return task;
}

export async function updateTaskContext(params: {
  scope: TaskContextScope;
  taskId: string;
  patch: Partial<
    Pick<TaskLedgerEntry, "title" | "description" | "status" | "context" | "project" | "decisions">
  >;
}): Promise<TaskLedgerEntry | undefined> {
  const ledger = await readTaskLedger(params.scope.rootDir);
  const index = ledger.items.findIndex((task) => task.id === params.taskId);
  if (index < 0) {
    return undefined;
  }
  const current = ledger.items[index];
  const patch = { ...params.patch };
  if (typeof patch.status === "string") {
    const normalized = normalizeTaskStatus(patch.status);
    if (normalized) {
      patch.status = normalized;
    } else {
      delete patch.status;
    }
  }
  // Avoid clobbering required fields when callers pass explicit undefined.
  if (patch.title === undefined) {
    delete patch.title;
  }
  if (patch.description === undefined) {
    delete patch.description;
  }
  if (patch.status === undefined) {
    delete patch.status;
  }
  const next: TaskLedgerEntry = {
    ...current,
    ...patch,
    context: patch.context ? { ...current.context, ...patch.context } : current.context,
    updated_at: new Date().toISOString(),
  };
  const items = [...ledger.items];
  items[index] = next;
  await writeLedger(params.scope.rootDir, items);

  // Sprint-1: on transition into a terminal status, detach artifacts for this
  // task. Reopen (terminal → active) must NOT auto-reattach.
  if (!isTerminalTaskStatus(current.status) && isTerminalTaskStatus(next.status)) {
    const reason =
      next.status === "done"
        ? "task_done"
        : `task_${String(next.status).trim().toLowerCase() || "terminal"}`;
    await detachArtifactsForTask({
      rootDir: params.scope.rootDir,
      taskId: params.taskId,
      now: next.updated_at,
      reason,
    });
  }
  return next;
}

export async function bindSessionToTaskContext(params: {
  scope: TaskContextScope;
  taskId: string;
  sessionKey: string;
  sessionId?: string;
}): Promise<TaskLedgerEntry | undefined> {
  const ledger = await readTaskLedger(params.scope.rootDir);
  const index = ledger.items.findIndex((task) => task.id === params.taskId);
  if (index < 0) {
    return undefined;
  }
  const current = ledger.items[index];
  const sessionIds = new Set(current.session_ids ?? []);
  sessionIds.add(params.sessionKey);
  const next: TaskLedgerEntry = {
    ...current,
    session_ids: [...sessionIds],
    last_session_id: params.sessionId ?? current.last_session_id,
    updated_at: new Date().toISOString(),
  };
  const items = [...ledger.items];
  items[index] = next;
  await writeLedger(params.scope.rootDir, items);
  return next;
}

export function buildTaskSummaryText(task: TaskLedgerEntry): string {
  const lines = [`Task: ${task.title} [${task.id}]`, `Status: ${task.status}`];
  if (task.description?.trim()) {
    lines.push(`Description: ${task.description.trim()}`);
  }
  if (task.project?.customer?.trim()) {
    lines.push(`Customer: ${task.project.customer.trim()}`);
  }
  if (task.project?.deal_stage?.trim()) {
    lines.push(`Stage: ${task.project.deal_stage.trim()}`);
  }
  const points = task.context.key_points.filter(Boolean);
  if (points.length > 0) {
    lines.push(`Summary: ${points.at(-1)}`);
  }
  const decisions = (task.decisions ?? []).slice(-5);
  if (decisions.length > 0) {
    lines.push("Decisions:");
    for (const decision of decisions) {
      lines.push(`- ${decision.text}`);
    }
  }
  return lines.join("\n");
}

export function rollupTaskSummaryFromCheckpoint(
  task: TaskLedgerEntry,
  checkpoint: MemoryCheckpoint,
): TaskLedgerEntry {
  const summary = checkpoint.summary?.trim();
  if (!summary) {
    return task;
  }
  const keyPoints = [...task.context.key_points];
  if (keyPoints[keyPoints.length - 1] !== summary) {
    keyPoints.push(summary);
  }
  const sessionIds = new Set(task.session_ids ?? []);
  if (checkpoint.session_key) {
    sessionIds.add(checkpoint.session_key);
  }
  return {
    ...task,
    context: { ...task.context, key_points: keyPoints.slice(-12) },
    session_ids: [...sessionIds],
    last_session_id: checkpoint.session_id || task.last_session_id,
    updated_at: checkpoint.created_at,
  };
}
