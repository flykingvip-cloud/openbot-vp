/** Best-effort observer: execution callbacks create facts; result receipts only link them. */
import { randomUUID } from "node:crypto";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import {
  getExecutionEvidenceStore,
  type createExecutionEvidenceStore,
  type ExecutionSourceDeclaration,
} from "./execution-evidence-store.js";
import {
  getExecutionJournalRuntime,
  type createExecutionJournalRuntime,
} from "./execution-journal-runtime.js";
import { getOutcomeSourceStore, type createOutcomeSourceStore } from "./outcome-source.js";
export function createRuntimeEvidenceObserver(
  context: {
    taskId?: string;
    agentId?: string;
    scope?: TrustedScope;
    runId: string;
    source?: ExecutionSourceDeclaration;
  },
  store: ReturnType<typeof createExecutionEvidenceStore> = getExecutionEvidenceStore(),
  outcomeSources: ReturnType<typeof createOutcomeSourceStore> = getOutcomeSourceStore(),
  journal: ReturnType<typeof createExecutionJournalRuntime> = getExecutionJournalRuntime(),
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
          if (context.agentId && journal.isEnabled()) {
            const fact = store.query(context.scope).facts.find((item) => item.eventId === eventId);
            if (fact) {
              journal.recordFact({ agentId: context.agentId, fact });
            }
          }
        }
      } catch {
        /* observation cannot affect execution */
      }
    },
    bind(
      record: TaskOutcomeRecord,
      submission?: { agentId: string; provenance: "live" | "injected" | "unknown" },
    ) {
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
        const receipt = {
          receiptId:
            "turn:" + context.runId + ":" + record.outcomeVersion + ":" + attempt.attemptId,
          taskId: record.taskId,
          scope: record.scope,
          runId: context.runId,
          outcomeVersion: record.outcomeVersion,
          attemptId: attempt.attemptId,
          attemptGranularity: "turn" as const,
          eventIds: [...ids],
        };
        const linked = store.recordLink(receipt);
        if (
          linked &&
          submission &&
          journal.isEnabled() &&
          (!context.agentId || context.agentId === submission.agentId)
        ) {
          for (const fact of captured) {
            journal.recordFact({ agentId: submission.agentId, fact });
          }
          journal.recordLink({ agentId: submission.agentId, receipt });
        }
        if (linked && submission) {
          outcomeSources.record({
            agentId: submission.agentId,
            record,
            runId: context.runId,
            attemptId: attempt.attemptId,
            provenance: submission.provenance,
            collector: "runner_outcome_commit",
            observedAt: Date.now(),
          });
        }
        return linked;
      } catch {
        return false;
      }
    },
  };
}
