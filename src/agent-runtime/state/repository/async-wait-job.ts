/**
 * Async-wait job record operations (wait / exit / clear).
 * Types and locked I/O come from async-wait-job-store — not redefined here.
 */
import fs from "node:fs";
import path from "node:path";
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../../infra/file-lock.js";
import type { AsyncWaitJobIntent, AsyncWaitTrustedIdentity } from "./async-wait-job-store.js";
import {
  fileFor,
  jobsDir,
  normalizeIntent,
  readFileUnlocked,
  writeFileUnlocked,
} from "./async-wait-job-store.js";

/**
 * Atomic read → decide → write under the per-job lock.
 * Decide must not perform nested locks on the same job file.
 */
export function transitionAsyncWaitJobIntent(
  sessionFile: string,
  jobId: string,
  decide: (current: AsyncWaitJobIntent | undefined) => AsyncWaitJobIntent | undefined | "keep",
): AsyncWaitJobIntent | undefined {
  const file = sessionFile.trim();
  const id = jobId.trim();
  if (!file || !id) {
    return undefined;
  }
  const target = fileFor(file, id);
  return withFileLockSync(target, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    const current = readFileUnlocked(target);
    const decided = decide(current);
    if (decided === "keep") {
      return current;
    }
    if (!decided) {
      return undefined;
    }
    const next = normalizeIntent({ ...decided, version: 2 });
    writeFileUnlocked(file, next);
    return next;
  });
}

/** Record waiting intent when a notify-on-exit job is backgrounded with a live binding. */
export function recordAsyncWaitJobIntent(input: {
  jobId: string;
  sessionKey: string;
  sessionFile: string;
  taskId: string;
  executionAttempt: string;
  deliverableVersion: string;
  constraints?: string[];
  pid?: number;
  startedAt: number;
  command?: string;
  trustedIdentity?: AsyncWaitTrustedIdentity;
}): AsyncWaitJobIntent | undefined {
  const sessionFile = input.sessionFile.trim();
  const jobId = input.jobId.trim();
  const sessionKey = input.sessionKey.trim();
  const taskId = input.taskId.trim();
  const executionAttempt = input.executionAttempt.trim();
  const deliverableVersion = input.deliverableVersion.trim();
  if (
    !sessionFile ||
    !jobId ||
    !sessionKey ||
    !taskId ||
    !executionAttempt ||
    !deliverableVersion
  ) {
    return undefined;
  }
  return transitionAsyncWaitJobIntent(sessionFile, jobId, () => ({
    version: 2,
    jobId,
    sessionKey,
    sessionFile,
    taskId,
    executionAttempt,
    deliverableVersion,
    constraints: [...(input.constraints ?? [])],
    startedAt: input.startedAt,
    status: "waiting",
    recovery: { stage: "none", claimGeneration: 0 },
    ...(typeof input.pid === "number" && Number.isFinite(input.pid) ? { pid: input.pid } : {}),
    ...(input.command?.trim() ? { command: input.command.trim().slice(0, 500) } : {}),
    ...(input.trustedIdentity ? { trustedIdentity: { ...input.trustedIdentity } } : {}),
  }));
}

export function readAsyncWaitJobIntent(
  sessionFile: string,
  jobId: string,
): AsyncWaitJobIntent | undefined {
  const file = sessionFile.trim();
  const id = jobId.trim();
  if (!file || !id) {
    return undefined;
  }
  return readFileUnlocked(fileFor(file, id));
}

export function listAsyncWaitJobIntents(sessionFile: string): AsyncWaitJobIntent[] {
  const file = sessionFile.trim();
  if (!file) {
    return [];
  }
  const dir = jobsDir(file);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AsyncWaitJobIntent[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const intent = readFileUnlocked(path.join(dir, name));
    if (intent) {
      out.push(intent);
    }
  }
  return out;
}

export function listWaitingAsyncWaitJobIntents(sessionFile: string): AsyncWaitJobIntent[] {
  return listAsyncWaitJobIntents(sessionFile).filter((row) => row.status === "waiting");
}

/** Live process exit observation — credible result evidence. */
export function markAsyncWaitJobExited(input: {
  sessionFile: string;
  jobId: string;
  exitStatus: "completed" | "failed" | "killed";
  exitCode?: number | null;
  summary?: string;
  exitedAtMs?: number;
}): AsyncWaitJobIntent | undefined {
  const at = input.exitedAtMs ?? Date.now();
  return transitionAsyncWaitJobIntent(input.sessionFile, input.jobId, (current) => {
    if (!current || current.status === "cleared") {
      return current;
    }
    return {
      ...current,
      status: "exited",
      exitStatus: input.exitStatus,
      exitedAtMs: at,
      resultEvidence: {
        kind: "process_exit_observed",
        exitStatus: input.exitStatus,
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.summary?.trim() ? { summary: input.summary.trim().slice(0, 2000) } : {}),
        observedAtMs: at,
      },
      recovery: current.recovery ?? { stage: "none", claimGeneration: 0 },
    };
  });
}

/** Owner stop / pause / cancel under lock — wins over in-flight claim writers. */
export function clearAsyncWaitJobIntent(sessionFile: string, jobId: string): boolean {
  const next = transitionAsyncWaitJobIntent(sessionFile, jobId, (current) => {
    if (!current) {
      return undefined;
    }
    if (current.status === "cleared") {
      return "keep";
    }
    return {
      ...current,
      status: "cleared",
      clearedAtMs: Date.now(),
      recovery: {
        ...(current.recovery ?? { stage: "none", claimGeneration: 0 }),
        stage: "none",
        claimToken: undefined,
      },
    };
  });
  return Boolean(next);
}

export function clearAsyncWaitJobsForTask(sessionFile: string, taskId: string): number {
  const tid = taskId.trim();
  if (!tid) {
    return 0;
  }
  let n = 0;
  for (const intent of listAsyncWaitJobIntents(sessionFile)) {
    if (intent.taskId === tid && intent.status !== "cleared") {
      if (clearAsyncWaitJobIntent(sessionFile, intent.jobId)) {
        n += 1;
      }
    }
  }
  return n;
}

export function clearAsyncWaitJobsForTests(sessionFile: string): void {
  const dir = jobsDir(sessionFile);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
