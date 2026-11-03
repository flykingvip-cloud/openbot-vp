/** Current active-task amendment transaction. Ports are code dependencies, never config scripts. */
export type ActiveTaskAmendmentResult =
  | { kind: "defer" }
  | { kind: "barrier-rejected" }
  | { kind: "injected"; persisted: boolean }
  | { kind: "barrier-recorded" };

export type ActiveTaskAmendmentPorts = {
  readTaskId: () => string;
  persist: (expectedTaskId: string) => boolean;
  steer: () => boolean;
};

/** Preserve original ordering and once-consumption; no model, queue or presentation ownership. */
export function amendActiveTask(
  barrierFirst: boolean,
  ports: ActiveTaskAmendmentPorts,
): ActiveTaskAmendmentResult {
  const expectedTaskId = ports.readTaskId();
  let persistedEarly = false;
  if (barrierFirst && expectedTaskId) {
    persistedEarly = ports.persist(expectedTaskId);
    if (!persistedEarly) {
      return { kind: "barrier-rejected" };
    }
  }
  if (ports.steer()) {
    return {
      kind: "injected",
      persisted: persistedEarly || (Boolean(expectedTaskId) && ports.persist(expectedTaskId)),
    };
  }
  return persistedEarly ? { kind: "barrier-recorded" } : { kind: "defer" };
}
