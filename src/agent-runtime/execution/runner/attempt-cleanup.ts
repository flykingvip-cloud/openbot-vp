/** Fixed attempt teardown; release every owned resource in the original order. */
export async function cleanupEmbeddedAttempt(ports: {
  removeContextCompiler: () => void;
  removeToolResultGuard: () => void;
  removeReplyReminder: () => void;
  removeReplyRewriter: () => void;
  flushToolResults: () => Promise<void>;
  disposeSession: () => void;
  releaseWebSocket: () => void;
  releaseLock: () => Promise<void>;
}): Promise<void> {
  const errors: unknown[] = [];
  for (const release of [
    ports.removeContextCompiler,
    ports.removeToolResultGuard,
    ports.removeReplyReminder,
    ports.removeReplyRewriter,
    ports.flushToolResults,
    ports.disposeSession,
    ports.releaseWebSocket,
    ports.releaseLock,
  ]) {
    try {
      await Promise.resolve(release());
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Attempt cleanup failed");
  }
}
