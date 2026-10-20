import { uniqueTrustedMechanismCause } from "@openbot/evolution-core";
import {
  listRecentExecutionChainProvenance,
  turnSecurityFromProvenance,
  type TurnSecuritySensors,
} from "../../infra/execution-chain-provenance.js";
import { readSkillInvocationEvents } from "../skill-invocation/event-store.js";
import type { SkillInvocationCompletedEvent } from "../skill-invocation/types.js";
import { securityViolationFromFailureCategory } from "./observation-cohort.js";

export type { TurnSecuritySensors };

export type TurnSkillSensors = TurnSecuritySensors & {
  tenantId?: string;
};

/**
 * Inspect skill invocations and same-process exec/sandbox provenance
 * that actually ran in a turn window. Missing sources leave the sensor unset.
 */
export function inspectTurnSensorsFromSkillInvocations(input: {
  agentId: string;
  startedAt: number;
  endedAt: number;
  configDir?: string;
  runId?: string;
  toolsObserved?: number;
}): TurnSkillSensors {
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.endedAt)) {
    return {};
  }
  const startedAt = Math.min(input.startedAt, input.endedAt);
  const endedAt = Math.max(input.startedAt, input.endedAt);
  const events = readSkillInvocationEvents({
    agentId: input.agentId,
    ...(input.configDir ? { configDir: input.configDir } : {}),
  }).filter((event): event is Extract<typeof event, { type: "skill_invocation_completed" }> => {
    return (
      event.type === "skill_invocation_completed" &&
      event.completedAt >= startedAt &&
      event.completedAt <= endedAt
    );
  });
  const tenants = new Set(
    events
      .map((event) => event.tenantId?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const skillSecurity =
    events.length === 0
      ? undefined
      : events.some(
          (event) => securityViolationFromFailureCategory(event.failureCategory) === true,
        );
  const provenance = turnSecurityFromProvenance(
    listRecentExecutionChainProvenance({
      startedAt,
      endedAt,
      ...(input.runId ? { runId: input.runId } : {}),
    }),
  );
  const measuredViolation =
    skillSecurity === undefined && provenance.securityViolation === undefined
      ? undefined
      : skillSecurity === true || provenance.securityViolation === true;
  const runScoped = typeof input.runId === "string" && input.runId.trim() !== "";
  const chatOnlyInspected =
    runScoped &&
    input.toolsObserved === 0 &&
    skillSecurity === undefined &&
    provenance.securityViolation === undefined &&
    provenance.suspectedAuthorizationBypass !== true &&
    provenance.securityAttempt !== true;
  const securityViolation =
    measuredViolation === undefined && chatOnlyInspected ? false : measuredViolation;
  return {
    ...(typeof provenance.securityAttempt === "boolean"
      ? { securityAttempt: provenance.securityAttempt }
      : {}),
    ...(typeof provenance.securityControlDenied === "boolean"
      ? { securityControlDenied: provenance.securityControlDenied }
      : {}),
    ...(typeof provenance.authorizationBypass === "boolean"
      ? { authorizationBypass: provenance.authorizationBypass }
      : {}),
    ...(typeof provenance.suspectedAuthorizationBypass === "boolean"
      ? { suspectedAuthorizationBypass: provenance.suspectedAuthorizationBypass }
      : {}),
    ...(typeof securityViolation === "boolean" ? { securityViolation } : {}),
    ...(tenants.size === 1 ? { tenantId: [...tenants][0] } : {}),
  };
}

function completedInvocations(params?: { agentId?: string; configDir?: string }) {
  return readSkillInvocationEvents({
    ...(params?.agentId ? { agentId: params.agentId } : {}),
    ...(params?.configDir ? { configDir: params.configDir } : {}),
  }).filter(
    (event): event is SkillInvocationCompletedEvent => event.type === "skill_invocation_completed",
  );
}

function uniqueFailedMechanism(
  events: readonly SkillInvocationCompletedEvent[],
): { cause: string } | undefined {
  const cause = uniqueTrustedMechanismCause(
    events.filter((event) => event.outcome === "failure").map((event) => event.failureCategory),
  );
  return cause ? { cause } : undefined;
}

/** Unique trusted mechanism in a turn window. Mixed or generic categories stay unknown. */
export function inspectTurnFailureMechanism(input: {
  agentId: string;
  startedAt: number;
  endedAt: number;
  configDir?: string;
}): { cause: string } | undefined {
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.endedAt)) {
    return undefined;
  }
  const startedAt = Math.min(input.startedAt, input.endedAt);
  const endedAt = Math.max(input.startedAt, input.endedAt);
  return uniqueFailedMechanism(
    completedInvocations(input).filter(
      (event) => event.completedAt >= startedAt && event.completedAt <= endedAt,
    ),
  );
}

/** Unique trusted mechanism bound by explicit taskId. Never inferred from time. */
export function inspectTaskBoundFailureMechanism(input: {
  taskId: string;
  configDir?: string;
}): { cause: string } | undefined {
  const taskId = input.taskId.trim();
  if (!taskId) {
    return undefined;
  }
  return uniqueFailedMechanism(
    completedInvocations({ configDir: input.configDir }).filter((event) => event.taskId === taskId),
  );
}
