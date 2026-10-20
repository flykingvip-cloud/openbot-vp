/**
 * supervisor/store.ts — runtime persistence for supervised tasks (M1, Task 1.2).
 *
 * One JSON file per task at `CONFIG_DIR/supervisor/tasks/<taskId>.json`, atomic
 * write (temp+rename) + per-taskId serial write queue, so concurrent updates from
 * the engine/api never interleave. NOT written to `.loom/registry.yaml` (that is a
 * dev-tree governance artifact; this is runtime state). Survives restart →
 * `resumeActive` re-drives non-terminal tasks.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { isTerminalTaskState, type SupervisedTask } from "./types.js";

export function resolveSupervisorTasksDir(storeDir?: string): string {
  return resolveUserPath(storeDir?.trim() || path.join(CONFIG_DIR, "supervisor", "tasks"));
}

function taskFilePath(taskId: string, storeDir?: string): string {
  return path.join(resolveSupervisorTasksDir(storeDir), `${taskId}.json`);
}

// Per-taskId serial write queue (avoids interleaved read-modify-write).
const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(taskId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  writeQueues.set(
    taskId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export async function createTask(task: SupervisedTask, storeDir?: string): Promise<SupervisedTask> {
  const taskId = task.taskId.trim();
  if (!taskId) {
    throw new Error("taskId is required");
  }
  return enqueue(taskId, async () => {
    const filePath = taskFilePath(taskId, storeDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const existing = await readJsonFile<SupervisedTask>(filePath);
    if (existing) {
      throw new Error(`supervised task "${taskId}" already exists`);
    }
    await writeJsonAtomic(filePath, task);
    return task;
  });
}

export async function getTask(taskId: string, storeDir?: string): Promise<SupervisedTask | null> {
  return readJsonFile<SupervisedTask>(taskFilePath(taskId.trim(), storeDir));
}

/**
 * Atomic read-modify-write of a task (serialized per taskId). The mutator returns
 * the next task; `updatedAt` is stamped automatically.
 */
export async function updateTask(
  taskId: string,
  mutator: (task: SupervisedTask) => SupervisedTask,
  storeDir?: string,
): Promise<SupervisedTask> {
  const id = taskId.trim();
  return enqueue(id, async () => {
    const filePath = taskFilePath(id, storeDir);
    const current = await readJsonFile<SupervisedTask>(filePath);
    if (!current) {
      throw new Error(`supervised task "${id}" not found`);
    }
    const next = { ...mutator(current), updatedAt: new Date().toISOString() };
    await writeJsonAtomic(filePath, next);
    return next;
  });
}

export async function listTasks(storeDir?: string): Promise<SupervisedTask[]> {
  const dir = resolveSupervisorTasksDir(storeDir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const tasks: SupervisedTask[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const task = await readJsonFile<SupervisedTask>(path.join(dir, name));
    if (task) {
      tasks.push(task);
    }
  }
  return tasks;
}

/** Non-terminal tasks only (engine drive set / resume). */
export async function listActiveTasks(storeDir?: string): Promise<SupervisedTask[]> {
  return (await listTasks(storeDir)).filter((t) => !isTerminalTaskState(t.state));
}

/**
 * Re-drive every non-terminal task after a restart (D-ASYNC). `drive` is invoked
 * per active task; failures are isolated so one bad task never blocks the rest.
 */
export async function resumeActive(
  drive: (task: SupervisedTask) => Promise<void>,
  storeDir?: string,
): Promise<number> {
  const active = await listActiveTasks(storeDir);
  for (const task of active) {
    try {
      await drive(task);
    } catch {
      // isolate: a single task's resume failure must not abort the sweep.
    }
  }
  return active.length;
}
