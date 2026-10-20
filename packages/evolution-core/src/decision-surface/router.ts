/**
 * Pure surface router. Reads the existing evolution surface catalog and
 * returns a decision endpoint. It does not register surfaces.
 */
import { getEvolutionSurface, isForbiddenSurfaceId } from "../surfaces.js";
import { evolutionTargetKey, type EvolutionTarget } from "../types.js";
import {
  RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID,
  type EvolutionDecisionEndpoint,
  type EvolutionDecisionParticipation,
  type EvolutionDecisionRequiredAuthority,
} from "./dto.js";

export type EvolutionDecisionOwnership =
  | { kind: "agent_self" }
  | { kind: "agent_enterprise"; delegated: boolean }
  | { kind: "knowledge_personal" }
  | { kind: "knowledge_enterprise" }
  | { kind: "capability_enterprise_private" }
  | { kind: "capability_platform_public" }
  | { kind: "organization_enterprise" }
  | { kind: "system" };

export type EvolutionDecisionRouteInput = {
  target: EvolutionTarget;
  surfaceId: string;
  ownership: EvolutionDecisionOwnership;
  crossTenantRepeat: boolean;
  platformFixAffectsEnterprise: boolean;
  touchesEmployeePersonalAsset: boolean;
};

export type EvolutionDecisionRoute =
  | {
      ok: true;
      endpoint: EvolutionDecisionEndpoint;
      participation: EvolutionDecisionParticipation;
      requiredAuthority: EvolutionDecisionRequiredAuthority;
      targetKey: string;
      surfaceId: string;
      registered: true;
      reason: string;
    }
  | {
      ok: false;
      code:
        | "forbidden_surface"
        | "unknown_surface"
        | "surface_not_registered"
        | "inconsistent_target";
      registered: false;
      reason: string;
    };

function ownershipDomain(ownership: EvolutionDecisionOwnership): EvolutionTarget["domain"] {
  switch (ownership.kind) {
    case "agent_self":
    case "agent_enterprise":
      return "agent";
    case "knowledge_personal":
    case "knowledge_enterprise":
      return "knowledge";
    case "capability_enterprise_private":
    case "capability_platform_public":
      return "capability";
    case "organization_enterprise":
      return "organization";
    case "system":
      return "system";
  }
}

function defaultEndpoint(ownership: EvolutionDecisionOwnership): {
  endpoint: EvolutionDecisionEndpoint;
  reason: string;
} {
  switch (ownership.kind) {
    case "agent_self":
      return { endpoint: "employee", reason: "agent_self" };
    case "agent_enterprise":
      return ownership.delegated
        ? { endpoint: "enterprise", reason: "agent_enterprise_delegated" }
        : { endpoint: "employee", reason: "agent_enterprise_without_delegation" };
    case "knowledge_personal":
      return { endpoint: "employee", reason: "knowledge_personal" };
    case "knowledge_enterprise":
      return { endpoint: "enterprise", reason: "knowledge_enterprise" };
    case "capability_enterprise_private":
      return { endpoint: "enterprise", reason: "capability_enterprise_private" };
    case "capability_platform_public":
      return { endpoint: "platform", reason: "capability_platform_public" };
    case "organization_enterprise":
      return { endpoint: "enterprise", reason: "organization_enterprise" };
    case "system":
      return { endpoint: "platform", reason: "system" };
  }
}

function enterpriseSide(ownership: EvolutionDecisionOwnership): boolean {
  return (
    ownership.kind === "agent_enterprise" ||
    ownership.kind === "knowledge_enterprise" ||
    ownership.kind === "capability_enterprise_private" ||
    ownership.kind === "organization_enterprise"
  );
}

function requiredAuthorityFor(input: {
  endpoint: EvolutionDecisionEndpoint;
  participation: EvolutionDecisionParticipation;
}): EvolutionDecisionRequiredAuthority {
  if (input.participation === "employee_final_authorization") {
    return "employee_and_enterprise";
  }
  if (input.participation === "enterprise_canary") {
    return "platform_and_enterprise";
  }
  return input.endpoint;
}

function withParticipation(input: {
  endpoint: EvolutionDecisionEndpoint;
  reason: string;
  ownership: EvolutionDecisionOwnership;
  platformFixAffectsEnterprise: boolean;
  touchesEmployeePersonalAsset: boolean;
  target: EvolutionTarget;
  surfaceId: string;
}): EvolutionDecisionRoute {
  let participation: EvolutionDecisionParticipation = "none";
  if (
    input.touchesEmployeePersonalAsset &&
    (enterpriseSide(input.ownership) || input.endpoint === "platform")
  ) {
    participation = "employee_final_authorization";
  } else if (input.endpoint === "platform" && input.platformFixAffectsEnterprise) {
    participation = "enterprise_canary";
  }
  return {
    ok: true,
    endpoint: input.endpoint,
    participation,
    requiredAuthority: requiredAuthorityFor({ endpoint: input.endpoint, participation }),
    targetKey: evolutionTargetKey(input.target),
    surfaceId: input.surfaceId,
    registered: true,
    reason: input.reason,
  };
}

export function routeEvolutionDecisionSurface(
  input: EvolutionDecisionRouteInput,
): EvolutionDecisionRoute {
  if (isForbiddenSurfaceId(input.surfaceId)) {
    return { ok: false, code: "forbidden_surface", registered: false, reason: "forbidden surface" };
  }
  if (input.surfaceId === RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID) {
    return {
      ok: false,
      code: "surface_not_registered",
      registered: false,
      reason: "engineering remediation is not in the evolution surface registry",
    };
  }
  const surface = getEvolutionSurface(input.surfaceId);
  if (!surface) {
    return {
      ok: false,
      code: "unknown_surface",
      registered: false,
      reason: "unregistered surface",
    };
  }
  if (
    ownershipDomain(input.ownership) !== input.target.domain ||
    surface.domain !== input.target.domain
  ) {
    return {
      ok: false,
      code: "inconsistent_target",
      registered: false,
      reason: "ownership, target, and surface domain must match",
    };
  }

  if (input.crossTenantRepeat) {
    return withParticipation({
      endpoint: "platform",
      reason: "cross_tenant_repeat",
      ownership: input.ownership,
      platformFixAffectsEnterprise: input.platformFixAffectsEnterprise,
      touchesEmployeePersonalAsset: input.touchesEmployeePersonalAsset,
      target: input.target,
      surfaceId: input.surfaceId,
    });
  }

  const selected = defaultEndpoint(input.ownership);
  return withParticipation({
    endpoint: selected.endpoint,
    reason: selected.reason,
    ownership: input.ownership,
    platformFixAffectsEnterprise: input.platformFixAffectsEnterprise,
    touchesEmployeePersonalAsset: input.touchesEmployeePersonalAsset,
    target: input.target,
    surfaceId: input.surfaceId,
  });
}
