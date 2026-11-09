/** Authoritative contract dimensions only; cohort identity is not causal or promotion evidence. */
import { createHash } from "node:crypto";
import type { Entrypoint, TaskContractIdentity, TrustedScope } from "../task-outcome/types.js";
export type CohortDimensions = {
  schemaVersion: 1;
  taskContract: TaskContractIdentity;
  taskContractVersion: string;
  judgementPolicyVersion: string;
  entrypoint: Entrypoint;
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
const kinds = new Set(["chat_turn", "code", "document", "external_action", "execution", "unknown"]);
const entrypointSet = {
  chat: true,
  gateway_agent: true,
  cron: true,
  cli: true,
  collab: true,
  subagent: true,
  supervisor: true,
} satisfies Record<Entrypoint, true>;
const entries = Object.keys(entrypointSet);
export function normalizeCohortDimensions(value: unknown): CohortDimensions | undefined {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.taskContract)) {
    return undefined;
  }
  const c = value.taskContract;
  if (
    !text(c.id) ||
    !text(c.version) ||
    !kinds.has(String(c.kind)) ||
    !Array.isArray(c.requiredValidators) ||
    c.requiredValidators.length > 100 ||
    !c.requiredValidators.every(text) ||
    !text(value.taskContractVersion) ||
    !text(value.judgementPolicyVersion) ||
    !entries.includes(String(value.entrypoint))
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    taskContract: {
      id: c.id,
      version: c.version,
      kind: c.kind as TaskContractIdentity["kind"],
      requiredValidators: [...new Set(c.requiredValidators)].toSorted(),
    },
    taskContractVersion: value.taskContractVersion,
    judgementPolicyVersion: value.judgementPolicyVersion,
    entrypoint: value.entrypoint as Entrypoint,
  };
}
/** Derive from original TaskOutcome fields, never an embedded client cohort declaration. */
export function readOutcomeCohort(record: unknown): CohortDimensions | undefined {
  if (!object(record)) {
    return undefined;
  }
  return normalizeCohortDimensions({
    schemaVersion: 1,
    taskContract: record.taskContract,
    taskContractVersion: record.taskContractVersion,
    judgementPolicyVersion: record.judgementPolicyVersion,
    entrypoint: record.entrypoint,
  });
}
export function cohortDimensionsKey(dimensions: CohortDimensions | undefined): string {
  const d = normalizeCohortDimensions(dimensions);
  return JSON.stringify(
    d
      ? [
          d.schemaVersion,
          d.taskContract.id,
          d.taskContract.version,
          d.taskContract.kind,
          d.taskContract.requiredValidators,
          d.taskContractVersion,
          d.judgementPolicyVersion,
          d.entrypoint,
        ]
      : null,
  );
}
export function buildCohortIdentity(input: {
  scope: TrustedScope;
  agentId: string;
  dimensions?: CohortDimensions;
  metricDictVersion: number;
  metricId: string;
}) {
  const d = normalizeCohortDimensions(input.dimensions);
  if (!d) {
    return { state: "unknown" as const, cohortRef: null, reasons: ["cohort_dimensions_missing"] };
  }
  if (d.taskContract.kind === "unknown") {
    return { state: "unknown" as const, cohortRef: null, reasons: ["cohort_task_kind_unknown"] };
  }
  if (
    !text(input.agentId) ||
    !text(input.metricId) ||
    !Number.isSafeInteger(input.metricDictVersion) ||
    input.metricDictVersion < 1
  ) {
    return { state: "unknown" as const, cohortRef: null, reasons: ["cohort_context_invalid"] };
  }
  const s = input.scope;
  const scope =
    s.kind === "personal"
      ? [s.kind, s.subjectRef, s.authzScopeRef, s.personalDomainId]
      : [s.kind, s.subjectRef, s.authzScopeRef, s.tenantId, s.enterpriseDomainId];
  if (!scope.every(text)) {
    return { state: "unknown" as const, cohortRef: null, reasons: ["cohort_scope_invalid"] };
  }
  const cohortRef = createHash("sha256")
    .update(
      JSON.stringify([
        1,
        scope,
        input.agentId,
        cohortDimensionsKey(d),
        input.metricDictVersion,
        input.metricId,
      ]),
    )
    .digest("hex");
  return { state: "known" as const, cohortRef, reasons: [] as string[] };
}
