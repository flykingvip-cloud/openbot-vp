/**
 * Durable async-wait job intent for background exec with notifyOnExit.
 * Survives gateway restart so recovery can claim without a second scheduler.
 * Not an executor: only facts for wait / exited / cleared.
 */
import fs from "node:fs";
import path from "node:path";
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../../infra/file-lock.js";

export type AsyncWaitJobStatus = "waiting" | "exited" | "cleared";

export type AsyncWaitJobIntent = {
  version: 1;
  jobId: string;
  sessionKey: string;
  sessionFile: string;
  taskId: string;
  executionAttempt: string;
  deliverableVersion: string;
  constraints: string[];
  pid?: number;
  startedAt: number;
  command?: string;
  status: AsyncWaitJobStatus;
  exitStatus?: "completed" | "failed" | "killed";
  exitedAtMs?: number;
  clearedAtMs?: number;
  /** Set when boot/recheck issued the one bounded wake for this intent. */
  recoveryWakeIssuedAtMs?: number;
};

const DIRNAME = "async-wait-jobs";

function jobsDir(sessionFile: string): string {
  return path.join(path.dirname(path.resolve(sessionFile)), DIRNAME);
}

function fileFor(sessionFile: string, jobId: string): string {
  return path.join(jobsDir(sessionFile), `${encodeURIComponent(jobId)}.json`);
}

function validIntent(value: unknown): value is AsyncWaitJobIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Partial<AsyncWaitJobIntent>;
  return (
    row.version === 1 &&
    typeof row.jobId === "string" &&
    row.jobId.trim().length > 0 &&
    typeof row.sessionKey === "string" &&
    row.sessionKey.trim().length > 0 &&
    typeof row.sessionFile === "string" &&
    row.sessionFile.trim().length > 0 &&
    typeof row.taskId === "string" &&
    row.taskId.trim().length > 0 &&
    typeof row.executionAttempt === "string" &&
    row.executionAttempt.trim().length > 0 &&
    typeof row.deliverableVersion === "string" &&
    row.deliverableVersion.trim().length > 0 &&
    Array.isArray(row.constraints) &&
    typeof row.startedAt === "number" &&
    Number.isFinite(row.startedAt) &&
    (row.status === "waiting" || row.status === "exited" || row.status === "cleared")
  );
}

function readFile(filePath: string): AsyncWaitJobIntent | undefined {
  try {
    const row = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return validIntent(row) ? row : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

function writeIntent(sessionFile: string, intent: AsyncWaitJobIntent): void {
  const dir = jobsDir(sessionFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = fileFor(sessionFile, intent.jobId);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  withFileLockSync(target, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    fs.writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
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
  const intent: AsyncWaitJobIntent = {
    version: 1,
    jobId,
    sessionKey,
    sessionFile,
    taskId,
    executionAttempt,
    deliverableVersion,
    constraints: [...(input.constraints ?? [])],
    startedAt: input.startedAt,
    status: "waiting",
    ...(typeof input.pid === "number" && Number.isFinite(input.pid) ? { pid: input.pid } : {}),
    ...(input.command?.trim() ? { command: input.command.trim().slice(0, 500) } : {}),
  };
  writeIntent(sessionFile, intent);
  return intent;
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
  return readFile(fileFor(file, id));
}

/** List durable intents for a session board directory (including exited/cleared). */
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
    const intent = readFile(path.join(dir, name));
    if (intent) {
      out.push(intent);
    }
  }
  return out;
}

export function listWaitingAsyncWaitJobIntents(sessionFile: string): AsyncWaitJobIntent[] {
  return listAsyncWaitJobIntents(sessionFile).filter((row) => row.status === "waiting");
}

/** Mark job exited (still durable for recovery claim / delivery). */
export function markAsyncWaitJobExited(input: {
  sessionFile: string;
  jobId: string;
  exitStatus: "completed" | "failed" | "killed";
  exitedAtMs?: number;
}): AsyncWaitJobIntent | undefined {
  const current = readAsyncWaitJobIntent(input.sessionFile, input.jobId);
  if (!current || current.status === "cleared") {
    return current;
  }
  const next: AsyncWaitJobIntent = {
    ...current,
    status: "exited",
    exitStatus: input.exitStatus,
    exitedAtMs: input.exitedAtMs ?? Date.now(),
  };
  writeIntent(input.sessionFile, next);
  return next;
}

/** Owner stop / pause / cancel: job must not wake after restart. */
export function clearAsyncWaitJobIntent(sessionFile: string, jobId: string): boolean {
  const current = readAsyncWaitJobIntent(sessionFile, jobId);
  if (!current) {
    return false;
  }
  if (current.status === "cleared") {
    return true;
  }
  writeIntent(sessionFile, {
    ...current,
    status: "cleared",
    clearedAtMs: Date.now(),
  });
  return true;
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

/** Record that recovery already issued the one bounded wake (idempotent). */
export function markAsyncWaitJobRecoveryWakeIssued(
  sessionFile: string,
  jobId: string,
  atMs: number = Date.now(),
): AsyncWaitJobIntent | undefined {
  const current = readAsyncWaitJobIntent(sessionFile, jobId);
  if (!current || current.status === "cleared") {
    return current;
  }
  if (typeof current.recoveryWakeIssuedAtMs === "number") {
    return current;
  }
  const next: AsyncWaitJobIntent = {
    ...current,
    recoveryWakeIssuedAtMs: atMs,
  };
  writeIntent(sessionFile, next);
  return next;
}

/** Test helper: wipe jobs dir for a session file. */
export function clearAsyncWaitJobsForTests(sessionFile: string): void {
  const dir = jobsDir(sessionFile);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
