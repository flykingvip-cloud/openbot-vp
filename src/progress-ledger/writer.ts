import { randomUUID } from "node:crypto";
import { LedgerWriteError } from "./errors.js";
import { applyEvent, foldEvents } from "./fold.js";
import { assertLedgerInvariants } from "./invariants.js";
import { getLedgerMetrics, type LedgerMetrics } from "./metrics.js";
import type { ProgressLedgerStore } from "./store.js";
import type { ExecutionEvent, ExecutionEventPayload, ExecutionLedger } from "./types.js";

const writeTails = new Map<string, Promise<unknown>>();

export function newLedgerEventId(): string {
  return `evt_${randomUUID()}`;
}

export function assertNotLegacyProgressSource(input: {
  kind?: string;
  source?: string;
  projectionKind?: string;
}): void {
  const tokens = [input.kind, input.source, input.projectionKind]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
  if (
    tokens.some(
      (value) =>
        value === "legacy_best_effort" ||
        value === "run_summary" ||
        value === "run_summary_guess" ||
        value === "planner_claim" ||
        value === "assistant_text",
    )
  ) {
    throw new LedgerWriteError("run summary / model claim is not canonical progress");
  }
}

function rejectLegacyPayload(payload: ExecutionEventPayload): void {
  assertNotLegacyProgressSource({
    source: typeof payload.toolName === "string" ? payload.toolName : undefined,
  });
  const evidenceRows = Array.isArray(payload.evidence)
    ? payload.evidence
    : payload.evidence
      ? [payload.evidence]
      : [];
  for (const row of evidenceRows) {
    assertNotLegacyProgressSource({
      kind: row.type,
      source: row.source,
    });
  }
}

async function withTaskLock<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(taskId) ?? Promise.resolve();
  let result: T;
  const next = previous.then(
    async () => {
      result = await run();
    },
    async () => {
      result = await run();
    },
  );
  writeTails.set(
    taskId,
    next.catch(() => undefined),
  );
  await next;
  return result!;
}

export async function appendLedgerEvent(
  store: ProgressLedgerStore,
  event: ExecutionEvent,
  options?: { metrics?: LedgerMetrics },
): Promise<{ event: ExecutionEvent; ledger: ExecutionLedger }> {
  const metrics = options?.metrics ?? getLedgerMetrics();
  return await withTaskLock(store.taskId, async () => {
    rejectLegacyPayload(event.payload);
    const existing = await store.loadEvents();
    if (existing.some((row) => row.id === event.id)) {
      throw new LedgerWriteError(`duplicate event id ${event.id}`);
    }
    const current = existing.length === 0 ? null : foldEvents(existing);
    try {
      const ledger = applyEvent(current, event);
      const nextEvents = [...existing, event];
      assertLedgerInvariants(nextEvents, ledger);
      await store.append(event);
      metrics.recordWriteAccepted();
      return { event, ledger };
    } catch (error) {
      if (error instanceof LedgerWriteError) {
        metrics.recordWriteRejected({
          message: error.message,
          id: error.invariantId,
          taskId: event.taskId,
        });
      }
      throw error;
    }
  });
}

export async function appendLedgerEvents(
  store: ProgressLedgerStore,
  events: readonly ExecutionEvent[],
): Promise<ExecutionLedger> {
  let ledger: ExecutionLedger | undefined;
  for (const event of events) {
    ledger = (await appendLedgerEvent(store, event)).ledger;
  }
  if (!ledger) {
    throw new LedgerWriteError("appendLedgerEvents requires at least one event");
  }
  return ledger;
}
