/**
 * Decides whether a server-resolved principal may submit a command.
 * Grant checks reuse evaluateAuthorityGate. This module does not issue grants.
 */
import {
  evaluateAuthorityGate,
  type AuthorityGrantView,
  type EvolutionSurface,
} from "../contracts.js";
import { getEvolutionSurface } from "../surfaces.js";
import { evolutionTargetKey } from "../types.js";
import {
  EVOLUTION_DECISION_CROSS_TENANT_CASE_ACTIONS,
  evolutionDecisionEndpointAllows,
  mapEvolutionDecisionCommand,
} from "./command-map.js";
import type {
  EvolutionDecisionAction,
  EvolutionDecisionAuthorityFacts,
  EvolutionDecisionCommand,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
} from "./dto.js";
import type { EvolutionDecisionRoute, EvolutionDecisionRouteInput } from "./router.js";
import { evolutionDecisionTenantMatches } from "./visibility.js";

const EMPLOYEE_GATED_ACTIONS = new Set<EvolutionDecisionAction>([
  "authorize",
  "start_experiment",
  "approve_application",
  "apply_canary",
  "promote",
]);

const CANARY_GATED_ACTIONS = new Set<EvolutionDecisionAction>([
  "apply_canary",
  "verify",
  "promote",
]);

const FORWARD_CORE_ACTIONS = new Set<EvolutionDecisionAction>([
  "authorize",
  "start_experiment",
  "approve_application",
  "apply_canary",
  "verify",
  "promote",
]);

export type EvolutionDecisionAuthorityDenial = {
  ok: false;
  code: string;
  reason: string;
};

function isCoreSurface(surface: EvolutionSurface): boolean {
  return (
    surface.domain === "system" ||
    surface.authorityRole === "platform" ||
    surface.requiredApprovals.includes("platform")
  );
}

export function resolveEvolutionDecisionAuthority(input: {
  item: EvolutionDecisionItem;
  command: EvolutionDecisionCommand;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  route: EvolutionDecisionRoute;
  routeInput: EvolutionDecisionRouteInput;
}): { ok: true } | EvolutionDecisionAuthorityDenial {
  const deny = (code: string, reason: string): EvolutionDecisionAuthorityDenial => ({
    ok: false,
    code,
    reason,
  });
  if (
    evolutionTargetKey(input.routeInput.target) !== evolutionTargetKey(input.item.target) ||
    input.routeInput.surfaceId !== input.item.surfaceId ||
    (input.route.ok && input.route.requiredAuthority !== input.item.requiredAuthority)
  ) {
    return deny(
      "route_binding_mismatch",
      "route input does not match the decision target, surface, or required authority",
    );
  }
  if (!input.route.ok) {
    return deny(input.route.code, input.route.reason);
  }
  if (input.command.decisionId !== input.item.decisionId) {
    return deny("decision_mismatch", "command decision id does not match the item");
  }
  if (!input.item.allowedActions.includes(input.command.action)) {
    return deny("action_not_allowed", "action is not open on this decision");
  }
  const mapped = mapEvolutionDecisionCommand(input.command.action);
  if (!mapped.ok) {
    return deny(mapped.code, "action is not a control-plane decision command");
  }
  if (!evolutionDecisionTenantMatches(input.item, input.principal)) {
    return deny("tenant_mismatch", "trusted tenant does not match the decision tenant");
  }
  if (input.principal.audience === "enterprise" && input.principal.enterpriseAdmin !== true) {
    return deny(
      "enterprise_admin_required",
      "enterprise audience requires a server-resolved enterprise admin",
    );
  }
  if (input.principal.audience === "platform" && input.principal.platformOperator !== true) {
    return deny(
      "platform_operator_required",
      "platform audience requires a server-resolved platform operator",
    );
  }

  const surface = getEvolutionSurface(input.item.surfaceId);
  if (
    input.principal.audience === "enterprise" &&
    surface &&
    isCoreSurface(surface) &&
    FORWARD_CORE_ACTIONS.has(input.command.action)
  ) {
    return deny(
      "enterprise_not_core_approver",
      "enterprise admin cannot approve core or system changes",
    );
  }

  const employeeFinalAction =
    input.command.action === "employee_final_authorization" &&
    input.principal.audience === "employee" &&
    input.route.participation === "employee_final_authorization";
  const enterpriseCanaryAction =
    input.command.action === "participate_canary" &&
    input.principal.audience === "enterprise" &&
    input.route.participation === "enterprise_canary";
  if (
    input.principal.audience !== input.route.endpoint &&
    !employeeFinalAction &&
    !enterpriseCanaryAction
  ) {
    return deny("wrong_endpoint", "principal audience is not the decision endpoint");
  }
  if (!evolutionDecisionEndpointAllows(input.principal.audience, input.command.action)) {
    return deny(
      "endpoint_action_forbidden",
      "this audience cannot take that action even when the item and grant list it",
    );
  }
  // Participation confirmations only exist on their own participation route;
  // elsewhere they would reach the delegation approval with nothing to confirm.
  if (
    input.command.action === "participate_canary" &&
    input.route.participation !== "enterprise_canary"
  ) {
    return deny(
      "participation_required",
      "participate_canary needs an enterprise canary participation route",
    );
  }
  if (
    input.command.action === "employee_final_authorization" &&
    input.route.participation !== "employee_final_authorization"
  ) {
    return deny(
      "participation_required",
      "employee_final_authorization needs an employee final authorization route",
    );
  }
  if (
    input.route.reason === "cross_tenant_repeat" &&
    !(EVOLUTION_DECISION_CROSS_TENANT_CASE_ACTIONS as readonly string[]).includes(
      input.command.action,
    )
  ) {
    return deny(
      "cross_tenant_mutation_forbidden",
      "cross-tenant repeat escalates a redacted case and does not transfer surface mutation authority",
    );
  }

  if (input.route.participation === "employee_final_authorization") {
    if (employeeFinalAction) {
      const target = input.item.target;
      if (target.domain === "agent") {
        if (!input.principal.ownerAgentId) {
          return deny(
            "owner_unproven",
            "employee final authorization requires a server-resolved agent owner",
          );
        }
        if (input.principal.ownerAgentId !== target.agentId) {
          return deny("owner_mismatch", "employee final authorization requires the owning agent");
        }
      } else if (target.domain === "knowledge") {
        if (!input.principal.ownerAssetId) {
          return deny(
            "owner_unproven",
            "employee final authorization requires a server-resolved asset owner",
          );
        }
        if (input.principal.ownerAssetId !== target.assetId) {
          return deny("owner_mismatch", "employee final authorization requires the owning asset");
        }
      } else {
        return deny(
          "owner_unproven",
          "employee final authorization is only valid for a personal agent or knowledge asset",
        );
      }
      // Checked after identity, route, and owner, so only the owner learns it.
      // A replay of the accepted commandId never reaches authority.
      if (input.facts.employeeFinalAuthorization) {
        return deny(
          "participation_already_satisfied",
          "the owner's final authorization is already recorded",
        );
      }
      return { ok: true };
    }
    if (
      EMPLOYEE_GATED_ACTIONS.has(input.command.action) &&
      !input.facts.employeeFinalAuthorization
    ) {
      return deny(
        "employee_authorization_required",
        "personal-asset changes wait for employee final authorization",
      );
    }
  }

  if (input.route.participation === "enterprise_canary") {
    if (enterpriseCanaryAction) {
      // Checked after admin, tenant, and route, so only this enterprise's
      // admin learns it. A replay of the accepted commandId never reaches here.
      if (input.facts.enterpriseCanaryAcknowledged) {
        return deny(
          "participation_already_satisfied",
          "this enterprise has already confirmed its canary participation",
        );
      }
      return { ok: true };
    }
    if (
      CANARY_GATED_ACTIONS.has(input.command.action) &&
      !input.facts.enterpriseCanaryAcknowledged
    ) {
      return deny(
        "enterprise_canary_required",
        "platform role does not replace enterprise canary participation",
      );
    }
  }

  if (!surface) {
    return deny("unknown_surface", "unregistered surface fails closed");
  }
  const gate = evaluateAuthorityGate({
    surface,
    grant: input.grant,
    tenantScope: input.item.tenantScope,
    trustedTenantId: input.principal.trustedTenantId,
    requestedAction: mapped.mapping.surfaceOperation,
    evidenceRefs: input.item.sourceEvidenceRefs,
    confidentialityScope: input.item.confidentialityScope,
    expandScope: false,
  });
  if (!gate.ok) {
    return deny(gate.code, gate.reason);
  }
  return { ok: true };
}
