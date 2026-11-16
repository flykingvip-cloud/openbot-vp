/** Read-only projection of durable executor evidence into sample execution refs. */
import type { EvidenceReadView } from "../executor-evidence/read-port.js";
import type { ExecutionEvidence, Provenance } from "./sample-assembler.js";

function asProvenance(value: string | undefined): Provenance {
  return value === "live" || value === "seed" || value === "injected" || value === "unknown"
    ? value
    : "unknown";
}

function asCollector(value: string | undefined): ExecutionEvidence["collector"] {
  return value === "runtime_execution" || value === "test" ? value : "unknown";
}

function inWindow(time: number | null | undefined, from: number, to: number): time is number {
  return typeof time === "number" && Number.isFinite(time) && time >= from && time < to;
}

/** Map retained CommandReceipt / ModelCallEvidence / budget associations into execution events. */
export function projectDurableExecutorExecutions(input: {
  view: EvidenceReadView;
  taskId: string;
  outcomeVersion: number;
  from: number;
  to: number;
}): ExecutionEvidence[] {
  if (input.view.completeness === "mismatch") {
    return [];
  }
  const executions: ExecutionEvidence[] = [];
  const associated = input.view.associations.filter(
    (row) =>
      row.finalOutcomeVersion === input.outcomeVersion &&
      row.chain.taskId === input.taskId &&
      typeof row.callId === "string" &&
      row.callId.trim().length > 0,
  );
  const byCallId = new Map(associated.map((row) => [row.callId, row]));
  for (const call of input.view.calls) {
    if (call.taskId !== input.taskId) {
      continue;
    }
    const association = byCallId.get(call.callId);
    if (!association) {
      continue;
    }
    const attemptId = association.taskAttemptId ?? association.attemptId ?? call.attemptId;
    const scope = association.trustedScope ?? call.scope;
    if (!attemptId || !scope) {
      continue;
    }
    const times: { suffix: string; at: number }[] = [];
    if (inWindow(call.startedAt, input.from, input.to)) {
      times.push({ suffix: "started", at: call.startedAt });
    }
    if (inWindow(call.completedAt, input.from, input.to) && call.completedAt !== call.startedAt) {
      times.push({ suffix: "completed", at: call.completedAt });
    }
    if (!times.length) {
      continue;
    }
    const sourceId = JSON.stringify([
      "durable_executor_evidence",
      call.evidenceId,
      input.view.capacity.watermark,
    ]);
    for (const time of times) {
      executions.push({
        sourceId,
        eventId: `${call.evidenceId}:${time.suffix}`,
        occurredAt: new Date(time.at).toISOString(),
        provenance: asProvenance(call.provenance),
        collector: asCollector(call.collector),
        runId: call.runId,
        scope,
        taskId: call.taskId,
        outcomeVersion: input.outcomeVersion,
        attemptId,
        capabilityCallId: association.capabilityCallId ?? call.callId,
        deliveryId: association.deliveryId ?? undefined,
      });
    }
  }
  return executions;
}
