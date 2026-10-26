/**
 * Side channel: prepare (agent-runner) registers awaiting delivery; dispatch
 * confirms after the channel send succeeds or fails. Keeps ReplyPayload clean.
 */
export type AwaitingDeliveryRegistration = {
  taskId: string;
  deliveryId: string;
  agentId: string;
  runId: string;
  registeredAtMs: number;
};

const byRunId = new Map<string, AwaitingDeliveryRegistration>();

export function registerAwaitingDelivery(
  reg: Omit<AwaitingDeliveryRegistration, "registeredAtMs">,
): void {
  const runId = reg.runId.trim();
  const taskId = reg.taskId.trim();
  const deliveryId = reg.deliveryId.trim();
  const agentId = reg.agentId.trim();
  if (!runId || !taskId || !deliveryId || !agentId) {
    return;
  }
  byRunId.set(runId, {
    taskId,
    deliveryId,
    agentId,
    runId,
    registeredAtMs: Date.now(),
  });
}

/** Peek without removing — useful when multiple final payloads share one run. */
export function peekAwaitingDelivery(runId: string): AwaitingDeliveryRegistration | undefined {
  const id = runId.trim();
  if (!id) {
    return undefined;
  }
  return byRunId.get(id);
}

/** Take (remove) registration after terminal confirm, or when abandoning. */
export function takeAwaitingDelivery(runId: string): AwaitingDeliveryRegistration | undefined {
  const id = runId.trim();
  if (!id) {
    return undefined;
  }
  const got = byRunId.get(id);
  if (got) {
    byRunId.delete(id);
  }
  return got;
}

/** Test helper. */
export function clearAwaitingDeliveriesForTests(): void {
  byRunId.clear();
}
