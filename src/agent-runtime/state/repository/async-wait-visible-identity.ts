/**
 * Employee-visible wait identity for a real async-wait job only.
 * This never mints a job to satisfy a test. Missing or non-waiting jobs
 * produce no identity.
 */
import type { AsyncWaitJobIntent, AsyncWaitJobStatus } from "./async-wait-job-store.js";
import { listWaitingAsyncWaitJobIntents } from "./async-wait-job.js";

export type VisibleAsyncWaitIdentity = {
  jobId: string;
  taskId: string;
  status: AsyncWaitJobStatus;
  executionAttempt?: string;
};

function listJobs(sessionFile: string): AsyncWaitJobIntent[] {
  try {
    return listWaitingAsyncWaitJobIntents(sessionFile);
  } catch {
    return [];
  }
}

/** One waiting job for the current task, if a real job already exists. */
export function visibleAsyncWaitIdentity(params: {
  sessionFile?: string;
  taskId?: string;
}): VisibleAsyncWaitIdentity | undefined {
  const sessionFile = params.sessionFile?.trim();
  const taskId = params.taskId?.trim();
  if (!sessionFile) {
    return undefined;
  }
  const waiting = listJobs(sessionFile).filter((job) => job.status === "waiting");
  const matched = taskId ? waiting.filter((job) => job.taskId === taskId) : waiting;
  const job = matched[0];
  if (!job?.jobId) {
    return undefined;
  }
  return {
    jobId: job.jobId,
    taskId: job.taskId,
    status: job.status,
    ...(job.executionAttempt ? { executionAttempt: job.executionAttempt } : {}),
  };
}
