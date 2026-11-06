/** Best-effort observer: execution callbacks create facts; result receipts only link them. */
import { randomUUID } from "node:crypto";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import {
  getExecutionEvidenceStore,
  type createExecutionEvidenceStore,
  type ExecutionSourceDeclaration,
} from "./execution-evidence-store.js";
export function createRuntimeEvidenceObserver(
  context: {
    taskId?: string;
    scope?: TrustedScope;
    runId: string;
    source?: ExecutionSourceDeclaration;
  },
  store: ReturnType<typeof createExecutionEvidenceStore> = getExecutionEvidenceStore(),
) {
  const ids: string[] = [];
  let overflow = false;
  return {
    capture(stage: "started" | "completed" | "failed" | "cancelled") {
      try {
        if (!context.taskId || !context.scope) {
          return;
        }
        const snapshot = store.query(context.scope);
        if (snapshot.reasons.includes("observation_disabled_or_scope_invalid")) {
          ids.length = 0;
          return;
        }
        if (ids.length >= 1000) {
          overflow = true;
          return;
        }
        const eventId = randomUUID();
        if (
          store.recordFact({
            source: context.source,
            eventId,
            taskId: context.taskId,
            scope: context.scope,
            runId: context.runId,
            occurredAt: Date.now(),
            stage,
          })
        ) {
          ids.push(eventId);
        }
      } catch {
        /* observation cannot affect execution */
      }
    },
    bind(record: TaskOutcomeRecord) {
      try {
        if (
          !context.taskId ||
          !context.scope ||
          !ids.length ||
          overflow ||
          record.taskId !== context.taskId
        ) {
          return false;
        }
        const captured = store.query(context.scope).facts.filter((f) => ids.includes(f.eventId));
        if (
          !captured.some((f) => f.stage === "started") ||
          !captured.some((f) => f.stage !== "started")
        ) {
          return false;
        }
        const run = record.runs.find((r) => r.runId === context.runId);
        const attempt = record.attempts.find(
          (a) =>
            a.runId === context.runId &&
            a.attemptId === run?.effectiveAttemptId &&
            run?.attemptIds.includes(a.attemptId),
        );
        if (!attempt) {
          return false;
        }
        return store.recordLink({
          receiptId:
            "turn:" + context.runId + ":" + record.outcomeVersion + ":" + attempt.attemptId,
          taskId: record.taskId,
          scope: record.scope,
          runId: context.runId,
          outcomeVersion: record.outcomeVersion,
          attemptId: attempt.attemptId,
          attemptGranularity: "turn",
          eventIds: [...ids],
        });
      } catch {
        return false;
      }
    },
  };
}
