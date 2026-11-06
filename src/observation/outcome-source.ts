/** Disposable submission-path declarations, never business acceptance or production validation. */
import { createHash, randomUUID } from "node:crypto";
import type { OutcomeRecordMetadata } from "./outcome-reader.js";
export const OUTCOME_METADATA_SCHEMA_VERSION = 1;
export function outcomeMetadataFingerprint(r: OutcomeRecordMetadata): string {
  const s = r.scope;
  const scope =
    s.kind === "enterprise"
      ? [s.kind, s.subjectRef, s.authzScopeRef, s.tenantId, s.enterpriseDomainId]
      : [s.kind, s.subjectRef, s.authzScopeRef, s.personalDomainId];
  const runs = r.runs
    .map((x) => JSON.stringify([x.runId, x.attemptIds.toSorted(), x.effectiveAttemptId, x.status]))
    .toSorted();
  const attempts = r.attempts
    .map((x) => JSON.stringify([x.attemptId, x.runId, x.status, x.observedAt]))
    .toSorted();
  return createHash("sha256")
    .update(
      JSON.stringify([
        OUTCOME_METADATA_SCHEMA_VERSION,
        scope,
        r.taskId,
        r.outcomeVersion,
        r.decidedAt,
        r.taskJudgement,
        r.lifecycle,
        r.acceptance.status,
        r.delivery.status,
        r.decisiveRunId,
        r.decisiveAttemptId,
        r.deliveryId,
        runs,
        attempts,
      ]),
    )
    .digest("hex");
}
type Declaration = {
  agentId: string;
  record: OutcomeRecordMetadata & { revisionKind?: "new_execution" | "correction" };
  runId: string;
  attemptId: string;
  provenance: "live" | "injected" | "unknown";
  collector: "runner_outcome_commit";
  observedAt: number;
};
export function createOutcomeSourceStore(
  options: { enabled?: () => boolean; now?: () => number; capacity?: number; ttlMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const enabled =
    options.enabled ??
    (() =>
      /^(1|true|yes|on)$/i.test(process.env.OPENBOT_EXECUTION_ROUTER_OBSERVATION?.trim() ?? ""));
  const capacity = options.capacity ?? 1000;
  const ttlMs = options.ttlMs ?? 900000;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("invalid_retention");
  }
  const processId = randomUUID();
  let epoch = randomUUID();
  let active = false;
  const rows = new Map<
    string,
    {
      fingerprint: string;
      runId: string;
      attemptId: string;
      provenance: Declaration["provenance"];
      at: number;
      conflict: boolean;
    }
  >();
  const key = (agentId: string, r: OutcomeRecordMetadata) =>
    JSON.stringify([
      agentId,
      r.scope.kind,
      r.scope.subjectRef,
      r.scope.authzScopeRef,
      r.scope.kind === "enterprise" ? r.scope.tenantId : r.scope.personalDomainId,
      r.scope.kind === "enterprise" ? r.scope.enterpriseDomainId : null,
      r.taskId,
      r.outcomeVersion,
    ]);
  const sweep = () => {
    const on = enabled();
    if (on !== active) {
      rows.clear();
      epoch = randomUUID();
      active = on;
    }
    if (!on) {
      return false;
    }
    const at = now();
    if (!Number.isFinite(at)) {
      throw new Error("invalid_clock");
    }
    for (const [k, v] of rows) {
      if (at - v.at >= ttlMs) {
        rows.delete(k);
      }
    }
    return true;
  };
  return {
    record(input: Declaration): boolean {
      try {
        if (
          !sweep() ||
          !input.agentId ||
          input.record.revisionKind === "correction" ||
          input.collector !== "runner_outcome_commit" ||
          !["live", "injected", "unknown"].includes(input.provenance) ||
          !Number.isFinite(input.observedAt) ||
          input.observedAt > now() ||
          !Number.isSafeInteger(input.record.outcomeVersion) ||
          input.record.outcomeVersion < 1
        ) {
          return false;
        }
        const run = input.record.runs.find((r) => r.runId === input.runId);
        const attempt = input.record.attempts.find(
          (a) => a.attemptId === input.attemptId && a.runId === input.runId,
        );
        if (
          !attempt ||
          run?.effectiveAttemptId !== input.attemptId ||
          !run.attemptIds.includes(input.attemptId)
        ) {
          return false;
        }
        const k = key(input.agentId, input.record);
        const fingerprint = outcomeMetadataFingerprint(input.record);
        const prior = rows.get(k);
        if (prior) {
          if (
            prior.fingerprint !== fingerprint ||
            prior.runId !== input.runId ||
            prior.attemptId !== input.attemptId ||
            prior.provenance !== input.provenance
          ) {
            prior.conflict = true;
            return false;
          }
          return !prior.conflict;
        }
        rows.set(k, {
          fingerprint,
          runId: input.runId,
          attemptId: input.attemptId,
          provenance: input.provenance,
          at: now(),
          conflict: false,
        });
        while (rows.size > capacity) {
          rows.delete(rows.keys().next().value!);
        }
        return true;
      } catch {
        return false;
      }
    },
    query(agentId: string, record: OutcomeRecordMetadata) {
      let row: ReturnType<typeof rows.get>;
      try {
        if (sweep()) {
          row = rows.get(key(agentId, record));
          if (row && (row.conflict || row.fingerprint !== outcomeMetadataFingerprint(record))) {
            row = undefined;
          }
        }
      } catch {
        rows.clear();
        active = false;
        row = undefined;
      }
      return {
        provenance: row?.provenance ?? ("unknown" as const),
        collector: row ? ("runner_outcome_commit" as const) : null,
        metadataSchemaVersion: OUTCOME_METADATA_SCHEMA_VERSION,
        processId,
        epoch,
        retention: "process_memory" as const,
        capacity,
        ttlMs,
        sourceWatermark: null,
        productionValidated: false as const,
        reasons: [
          "submission_path_declaration_only",
          "retention_continuity_unknown",
          ...(row ? [] : ["exact_version_source_unavailable"]),
        ],
      };
    },
  };
}
let shared: ReturnType<typeof createOutcomeSourceStore> | undefined;
export function getOutcomeSourceStore() {
  return (shared ??= createOutcomeSourceStore());
}
