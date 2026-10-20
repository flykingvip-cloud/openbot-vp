/**
 * supervisor/driver.ts — persist + drive supervised tasks (M2, Task 2.4).
 *
 * `tickSupervisedTask` advances one task by one engine step and persists the
 * snapshot. `tickAllActiveSupervisedTasks` is the cron/maintenance entrypoint.
 * `abortSupervisedTask` stops a non-terminal task (R6.3) and cancels live runs.
 */

import {
  isInFlightTaskState,
  superviseTick,
  type SupervisorPorts,
  type SuperviseTickOptions,
} from "./engine.js";
import { isSupervisorEnabled } from "./feature.js";
import { cancelSupervisorRun, hasSupervisorRun } from "./run-registry.js";
import { getTask, listActiveTasks, updateTask } from "./store.js";
import { isTerminalTaskState, type SupervisedTask } from "./types.js";

/** One tick per taskId at a time (avoid overlapping rounds). */
const tickLocks = new Map<string, Promise<unknown>>();

function withTickLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const id = taskId.trim();
  const prior = tickLocks.get(id) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  tickLocks.set(
    id,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function buildTickOptions(
  taskId: string,
  ports: SupervisorPorts,
  task: SupervisedTask,
  opts?: SuperviseTickOptions & { storeDir?: string },
): SuperviseTickOptions & { storeDir?: string } {
  const storeDir = opts?.storeDir;
  const retryableExitCodes = opts?.retryableExitCodes ?? ports.worker.getRetryableExitCodes?.(task);
  return {
    ...opts,
    ...(retryableExitCodes ? { retryableExitCodes } : {}),
    persist: async (snapshot) => {
      if (isTerminalTaskState(snapshot.state) && snapshot.state !== "aborted") {
        // terminal transitions are written once at tick end; still allow aborted mid-flight
      }
      await updateTask(taskId, () => snapshot, storeDir);
    },
    isAborted: async () => {
      const latest = await getTask(taskId, storeDir);
      return latest?.state === "aborted";
    },
  };
}

async function reconcileStaleInFlight(
  task: SupervisedTask,
  storeDir?: string,
): Promise<SupervisedTask> {
  if (!isInFlightTaskState(task.state)) {
    return task;
  }
  if (hasSupervisorRun(task.taskId)) {
    return task;
  }
  if (task.state === "validating") {
    return task;
  }
  return updateTask(
    task.taskId,
    (t) => ({ ...t, state: "planned", activeRun: undefined }),
    storeDir,
  );
}

async function recycleWorkspaceIfTerminal(
  previous: SupervisedTask,
  next: SupervisedTask,
  ports: SupervisorPorts,
): Promise<void> {
  if (isTerminalTaskState(previous.state) || !isTerminalTaskState(next.state)) {
    return;
  }
  if (ports.reporter) {
    await ports.reporter.finalReport(next).catch(() => undefined);
  }
  if (!next.workspace?.root || !ports.workspace.recycle) {
    return;
  }
  await ports.workspace.recycle(next.workspace).catch(() => undefined);
}

export async function tickSupervisedTask(
  taskId: string,
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions & { storeDir?: string },
): Promise<SupervisedTask | null> {
  return withTickLock(taskId, async () => {
    let current = await getTask(taskId, opts?.storeDir);
    if (!current) {
      return null;
    }
    if (!isSupervisorEnabled(opts?.env, opts?.readConfig)) {
      return current;
    }

    if (isInFlightTaskState(current.state) && hasSupervisorRun(taskId)) {
      return current;
    }

    current = await reconcileStaleInFlight(current, opts?.storeDir);

    const tickOpts = buildTickOptions(taskId, ports, current, opts);
    const next = await superviseTick(current, ports, tickOpts);
    if (next === current) {
      return current;
    }
    const persisted = await updateTask(taskId, () => next, opts?.storeDir);
    await recycleWorkspaceIfTerminal(current, persisted, ports);
    return persisted;
  });
}

export async function tickAllActiveSupervisedTasks(
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions & { storeDir?: string },
): Promise<number> {
  if (!isSupervisorEnabled(opts?.env, opts?.readConfig)) {
    return 0;
  }
  const active = await listActiveTasks(opts?.storeDir);
  let driven = 0;
  for (const task of active) {
    try {
      await tickSupervisedTask(task.taskId, ports, opts);
      driven += 1;
    } catch {
      // isolate: one bad task must not block the sweep
    }
  }
  return driven;
}

/**
 * Abort a supervised task: persist `aborted` first (store wins), then cancel any
 * live in-process Worker run (R6.3 / 11.3).
 */
export async function abortSupervisedTask(
  taskId: string,
  ports?: Pick<SupervisorPorts, "worker" | "workspace" | "reporter">,
  storeDir?: string,
): Promise<SupervisedTask | null> {
  try {
    const aborted = await updateTask(
      taskId,
      (task) => {
        if (isTerminalTaskState(task.state)) {
          return task;
        }
        return { ...task, state: "aborted", activeRun: undefined };
      },
      storeDir,
    );
    if (ports?.worker?.cancelActive) {
      await ports.worker.cancelActive(taskId).catch(() => undefined);
    } else {
      await cancelSupervisorRun(taskId).catch(() => undefined);
    }
    if (ports?.reporter) {
      await ports.reporter.finalReport(aborted).catch(() => undefined);
    }
    if (aborted.workspace?.root && ports?.workspace.recycle) {
      await ports.workspace.recycle(aborted.workspace).catch(() => undefined);
    }
    return aborted;
  } catch {
    return null;
  }
}

/** Default maintenance interval when the gateway driver is enabled. */
export const SUPERVISOR_TICK_INTERVAL_MS = 60_000;

export function startSupervisorDriver(params: {
  ports: SupervisorPorts;
  storeDir?: string;
  intervalMs?: number;
  tickOptions?: SuperviseTickOptions;
}): { stop: () => void } {
  const intervalMs = params.intervalMs ?? SUPERVISOR_TICK_INTERVAL_MS;
  const tick = () => {
    void tickAllActiveSupervisedTasks(params.ports, {
      ...params.tickOptions,
      storeDir: params.storeDir,
    });
  };
  if (!isSupervisorEnabled(params.tickOptions?.env, params.tickOptions?.readConfig)) {
    return { stop: () => undefined };
  }
  const handle = setInterval(tick, intervalMs);
  return {
    stop: () => clearInterval(handle),
  };
}
