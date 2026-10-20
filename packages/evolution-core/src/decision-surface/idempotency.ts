/**
 * Idempotency for a decision command. Replay returns the prior receipt plan
 * and does not mutate the prior list. A reused command id that points at a
 * different decision, action, or version is a rebind. Replay also requires
 * the stored tenant, decision version, target, surface, and principal binding.
 */
import { evolutionTargetKey } from "../types.js";
import type {
  EvolutionDecisionCommand,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
} from "./dto.js";
import { evolutionDecisionCommandExpired } from "./dto.js";
import type { EvolutionDecisionRoute } from "./router.js";

export type EvolutionDecisionCommandRecord = {
  commandId: string;
  decisionId: string;
  action: string;
  expectedVersion: string;
  decisionVersion: string;
  tenantScope: string | null;
  targetKey: string;
  surfaceId: string;
  requiredAuthority: string;
  principalAudience: string;
  principalTenantId: string | null;
  ownerAgentId: string;
  ownerAssetId: string;
  enterpriseAdmin: boolean;
  platformOperator: boolean;
  /** Route endpoint and participation at acceptance. A replay must match them. */
  routeEndpoint?: string;
  routeParticipation?: string;
  auditReceiptRef: string;
  controlPlaneRef?: string;
};

export function captureEvolutionDecisionCommandRecord(input: {
  command: EvolutionDecisionCommand;
  item: EvolutionDecisionItem;
  principal: EvolutionDecisionPrincipal;
  auditReceiptRef: string;
  controlPlaneRef?: string;
  /** Route the command was accepted on. When given, replays also bind to it. */
  route?: EvolutionDecisionRoute;
}): EvolutionDecisionCommandRecord {
  return {
    commandId: input.command.commandId,
    decisionId: input.command.decisionId,
    action: input.command.action,
    expectedVersion: input.command.expectedVersion,
    decisionVersion: input.item.decisionVersion,
    tenantScope: input.item.tenantScope,
    targetKey: evolutionTargetKey(input.item.target),
    surfaceId: input.item.surfaceId,
    requiredAuthority: input.item.requiredAuthority,
    principalAudience: input.principal.audience,
    principalTenantId: input.principal.trustedTenantId,
    ownerAgentId: input.principal.ownerAgentId ?? "",
    ownerAssetId: input.principal.ownerAssetId ?? "",
    enterpriseAdmin: input.principal.enterpriseAdmin,
    platformOperator: input.principal.platformOperator,
    ...(input.route?.ok
      ? { routeEndpoint: input.route.endpoint, routeParticipation: input.route.participation }
      : {}),
    auditReceiptRef: input.auditReceiptRef,
    ...(input.controlPlaneRef ? { controlPlaneRef: input.controlPlaneRef } : {}),
  };
}

function replayRouteMatches(
  record: EvolutionDecisionCommandRecord,
  route: EvolutionDecisionRoute | undefined,
): boolean {
  if (record.routeEndpoint === undefined && record.routeParticipation === undefined) {
    return true;
  }
  return (
    route !== undefined &&
    route.ok &&
    route.endpoint === record.routeEndpoint &&
    route.participation === record.routeParticipation
  );
}

export function evolutionDecisionReplayBindingMatches(
  record: EvolutionDecisionCommandRecord,
  input: {
    item: EvolutionDecisionItem;
    principal: EvolutionDecisionPrincipal;
    route?: EvolutionDecisionRoute;
  },
): boolean {
  return (
    replayRouteMatches(record, input.route) &&
    record.decisionVersion === input.item.decisionVersion &&
    record.tenantScope === input.item.tenantScope &&
    record.targetKey === evolutionTargetKey(input.item.target) &&
    record.surfaceId === input.item.surfaceId &&
    record.requiredAuthority === input.item.requiredAuthority &&
    record.principalAudience === input.principal.audience &&
    record.principalTenantId === input.principal.trustedTenantId &&
    record.ownerAgentId === (input.principal.ownerAgentId ?? "") &&
    record.ownerAssetId === (input.principal.ownerAssetId ?? "") &&
    record.enterpriseAdmin === input.principal.enterpriseAdmin &&
    record.platformOperator === input.principal.platformOperator
  );
}

export function evolutionDecisionIdempotencyKey(input: {
  commandId: string;
  decisionId: string;
  action: string;
  expectedVersion?: string;
}): string {
  return [input.commandId, input.decisionId, input.action, input.expectedVersion ?? ""].join("|");
}

export function classifyEvolutionDecisionIdempotency(input: {
  command: EvolutionDecisionCommand;
  prior: readonly EvolutionDecisionCommandRecord[];
}):
  | { kind: "fresh" }
  | { kind: "replay"; record: EvolutionDecisionCommandRecord }
  | { kind: "rebind" } {
  const existing = input.prior.find((row) => row.commandId === input.command.commandId);
  if (!existing) {
    return { kind: "fresh" };
  }
  const same =
    evolutionDecisionIdempotencyKey(existing) === evolutionDecisionIdempotencyKey(input.command);
  return same ? { kind: "replay", record: existing } : { kind: "rebind" };
}

export function freshEvolutionDecisionExpired(input: {
  item: Pick<EvolutionDecisionItem, "status" | "expiresAt">;
  now: string;
}): boolean {
  return evolutionDecisionCommandExpired(input.item, input.now);
}
