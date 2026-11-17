/** Explicit work-affiliation for default stop-cascade ports.
 *
 * Ownership is only the caller-supplied taskId. Never infer affiliation
 * from session, bot, time, or name similarity.
 */

export type OwnedChildExecutionAffiliation = {
  taskId: string;
  id: string;
  sessionId?: string;
  sessionKey?: string;
};

export type OwnedRemoteJobAffiliation = {
  taskId: string;
  jobId: string;
  leaseId?: string;
  authorized?: boolean;
  tenantId?: string;
  /** Live cancel consumer for this exact job+lease+authorization binding. */
  cancel?: () => Promise<boolean>;
};

const children = new Map<string, Map<string, OwnedChildExecutionAffiliation>>();
const remotes = new Map<string, Map<string, OwnedRemoteJobAffiliation>>();

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function registerOwnedChildExecution(input: OwnedChildExecutionAffiliation): void {
  const taskId = compact(input.taskId);
  const id = compact(input.id);
  if (!taskId || !id) {
    return;
  }
  let bucket = children.get(taskId);
  if (!bucket) {
    bucket = new Map();
    children.set(taskId, bucket);
  }
  bucket.set(id, {
    taskId,
    id,
    ...(compact(input.sessionId) ? { sessionId: compact(input.sessionId) } : {}),
    ...(compact(input.sessionKey) ? { sessionKey: compact(input.sessionKey) } : {}),
  });
}

export function unregisterOwnedChildExecution(taskId: string, id: string): void {
  const tid = compact(taskId);
  const rid = compact(id);
  const bucket = children.get(tid);
  if (!bucket) {
    return;
  }
  bucket.delete(rid);
  if (bucket.size === 0) {
    children.delete(tid);
  }
}

export function listOwnedChildExecutions(taskId: string): OwnedChildExecutionAffiliation[] {
  const bucket = children.get(compact(taskId));
  return bucket ? [...bucket.values()] : [];
}

export function registerOwnedRemoteJob(input: OwnedRemoteJobAffiliation): void {
  const taskId = compact(input.taskId);
  const jobId = compact(input.jobId);
  if (!taskId || !jobId) {
    return;
  }
  let bucket = remotes.get(taskId);
  if (!bucket) {
    bucket = new Map();
    remotes.set(taskId, bucket);
  }
  bucket.set(jobId, {
    taskId,
    jobId,
    ...(compact(input.leaseId) ? { leaseId: compact(input.leaseId) } : {}),
    authorized: input.authorized === true,
    ...(compact(input.tenantId) ? { tenantId: compact(input.tenantId) } : {}),
    ...(input.cancel ? { cancel: input.cancel } : {}),
  });
}

export function unregisterOwnedRemoteJob(taskId: string, jobId: string): void {
  const tid = compact(taskId);
  const jid = compact(jobId);
  const bucket = remotes.get(tid);
  if (!bucket) {
    return;
  }
  bucket.delete(jid);
  if (bucket.size === 0) {
    remotes.delete(tid);
  }
}

export function listOwnedRemoteJobs(taskId: string): OwnedRemoteJobAffiliation[] {
  const bucket = remotes.get(compact(taskId));
  return bucket ? [...bucket.values()] : [];
}

export function resetOwnedStopAffiliationsForTests(): void {
  children.clear();
  remotes.clear();
}
