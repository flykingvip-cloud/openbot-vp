/**
 * Auditable diagnosis delegation grant RPCs for evolution working-dna governance.
 */

import type { DiagnosticPrincipal } from "../../diagnosis/types.js";
import { getSharedDiagnosisDelegationMachine } from "../evolution-control/delegation-service.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "../evolution-control/evolution-grant.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import {
  assertClientMayAccessAgentDetailed,
  requireAuthenticatedOperatorPrincipal,
} from "./operator-access.js";
import { optionalString, requiredString } from "./request-params.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

async function trustedTenantId(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  respond: RespondFn,
  options?: { required?: boolean },
): Promise<string | null> {
  const enterprise = client?.sessionEnterpriseId?.trim();
  if (enterprise) {
    return enterprise;
  }
  const hinted = client?.sessionTenantId?.trim();
  if (hinted) {
    return hinted;
  }
  const membership = await resolveAuthoritativeMembership(client);
  if (membership.tenantId) {
    return membership.tenantId;
  }
  if (options?.required !== false && client) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"));
  }
  return null;
}

async function principalFromClient(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  respond: RespondFn,
): Promise<DiagnosticPrincipal | null> {
  const principalId = requireAuthenticatedOperatorPrincipal(client, respond);
  if (!principalId) {
    return null;
  }
  const tenantId = await trustedTenantId(client, respond, { required: true });
  if (!tenantId) {
    return null;
  }
  return {
    schemaVersion: 1,
    principalId,
    kind: "user",
    tenantId,
  };
}

export const evolutionDelegationHandlers: GatewayRequestHandlers = {
  "evolution.delegation.request": async ({ params, respond, client }) => {
    const commandId = requiredString(params, "commandId", respond);
    const agentId = requiredString(params, "agentId", respond);
    if (!commandId || !agentId) {
      return;
    }
    const access = await assertClientMayAccessAgentDetailed(client, agentId, respond);
    if (!access?.tenantId) {
      return;
    }
    const principal = await principalFromClient(client, respond);
    if (!principal) {
      return;
    }
    const evidenceRefs =
      Array.isArray(params.evidenceRefs) &&
      params.evidenceRefs.every((entry) => typeof entry === "string")
        ? params.evidenceRefs
        : [`ev:${commandId}`];
    const expiresAt =
      optionalString(params, "expiresAt") ?? new Date(Date.now() + 86_400_000).toISOString();
    const proposalId = optionalString(params, "proposalId") ?? undefined;
    try {
      const machine = getSharedDiagnosisDelegationMachine();
      const issuer = evolutionGrantActorFromPrincipal(
        { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
        "platform",
      );
      const enterprise = evolutionGrantActorFromPrincipal(principal, "enterprise");
      const result = requestEvolutionWorkingDnaGrant({
        machine,
        commandId,
        trusted: { tenantId: access.tenantId },
        issuer,
        approver: enterprise,
        grantee: enterprise,
        tenantId: access.tenantId,
        agentId: access.agentId,
        proposalId,
        evidenceRefs,
        expiresAt,
      });
      respond(true, {
        grantId: result.grantId,
        status: result.receipt.status,
        receipt: { commandId, grantId: result.grantId },
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "grant request failed",
        ),
      );
    }
  },

  "evolution.delegation.approve": async ({ params, respond, client }) => {
    const commandId = requiredString(params, "commandId", respond);
    const grantId = requiredString(params, "grantId", respond);
    if (!commandId || !grantId) {
      return;
    }
    const tenantId = await trustedTenantId(client, respond, { required: true });
    if (!tenantId) {
      return;
    }
    const principal = await principalFromClient(client, respond);
    if (!principal) {
      return;
    }
    try {
      const machine = getSharedDiagnosisDelegationMachine();
      const receipt = approveEvolutionGrant({
        machine,
        commandId,
        trusted: { tenantId },
        approver: evolutionGrantActorFromPrincipal(principal, "enterprise"),
        grantId,
      });
      respond(true, { grantId, status: receipt.status, receipt: { commandId, grantId } });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "grant approve failed",
        ),
      );
    }
  },

  "evolution.delegation.get": async ({ params, respond, client }) => {
    const grantId = requiredString(params, "grantId", respond);
    if (!grantId) {
      return;
    }
    const tenantId = await trustedTenantId(client, respond, { required: false });
    const machine = getSharedDiagnosisDelegationMachine();
    const grant = machine.getGrant(grantId);
    if (!grant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "grant not found"));
      return;
    }
    if (tenantId && grant.targetTenant && grant.targetTenant !== tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "grant not found"));
      return;
    }
    respond(true, {
      grant: {
        grantId: grant.grantId,
        status: machine.inspectGrant(grantId).status,
        targetTenant: grant.targetTenant,
        targetScope: grant.targetScope,
        allowedActions: grant.allowedActions,
        expiresAt: grant.expiresAt,
        purpose: grant.purpose,
        auditReceipt: grant.auditReceipt,
      },
    });
  },
};
