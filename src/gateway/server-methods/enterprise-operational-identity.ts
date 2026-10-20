import { ownershipProofForEnterpriseOperationalIdentity } from "../data-governance/ownership-proof.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  requireResolvedEnterpriseAdminTenantId,
  requireResolvedEnterpriseTenantId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import { summarizeOperationalIdentityRelationships } from "../enterprise-operational-identity-access.js";
import { saveEnterpriseSeatAssetsStoreWithOiGovernance } from "../enterprise-operational-identity-governance.js";
import { listOperationalIdentityProviderCatalog } from "../enterprise-operational-identity-providers.js";
import {
  enforceOperationalIdentityRuntimeAccess,
  enrollEmployeeEnterpriseIdentity,
  executeEnterpriseOperationalIdentityRuntimeAction,
  listEmployeeEnterpriseIdentityEnrollmentIds,
  listOperationalIdentityRuntimeAccess,
  listOperationalIdentityRuntimeAccessForSeat,
  previewOperationalIdentityImplicitInheritExitDelta,
  readOperationalIdentityTenantGrantMode,
  revokeEmployeeEnterpriseIdentity,
  updateOperationalIdentityTenantGrantMode,
} from "../enterprise-operational-identity-runtime.js";
import { listTenantDataSourceIdentityBindings } from "../enterprise-operational-identity-store.js";
import type { OperationalIdentityTenantGrantMode } from "../enterprise-operational-identity-types.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function toOperationalIdentityErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Operational identity operation failed.");
}

export const enterpriseOperationalIdentityHandlers: GatewayRequestHandlers = {
  "enterprise-operational-identity.access.resolve": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const seatId = stringValue(params.seatId);
    const agentId = stringValue(params.agentId);
    const identityId = stringValue(params.identityId);
    const action = stringValue(params.action);
    if (!seatId || !agentId || !identityId || !action) {
      respondInvalid(respond, "seatId, agentId, identityId, and action are required");
      return;
    }
    try {
      const enforcement = await enforceOperationalIdentityRuntimeAccess({
        client,
        identityId,
        action,
        seatId,
        agentId,
      });
      if (enforcement.ok) {
        respond(true, {
          tenantId: enforcement.scope.tenantId,
          allowed: true,
          identity: enforcement.result.identity,
          policyId: enforcement.result.policy.policyId,
        });
        return;
      }
      respond(true, {
        tenantId: enforcement.scope?.tenantId ?? tenantId,
        allowed: false,
        code: enforcement.result?.code ?? "IDENTITY_ACTION_DENIED",
        message: enforcement.message,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.access.list-for-seat-agent": async ({
    client,
    params,
    respond,
  }) => {
    const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const seatId = stringValue(params.seatId) || undefined;
    const agentId = stringValue(params.agentId) || undefined;
    try {
      const access = await listOperationalIdentityRuntimeAccess({
        client,
        seatId,
        agentId,
      });
      if (!access) {
        respondInvalid(respond, "seatId and agentId are required for operational identity access");
        return;
      }
      if ((canonicalizeTenantId(access.scope.tenantId) ?? access.scope.tenantId) !== tenantId) {
        respondInvalid(respond, "tenantId must match authenticated enterprise scope.");
        return;
      }
      respond(true, {
        tenantId: access.scope.tenantId,
        seatId: access.scope.seatId,
        agentId: access.scope.agentId,
        entries: access.entries,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.access.list-for-seat": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const seatId = stringValue(params.seatId) || undefined;
    try {
      const access = await listOperationalIdentityRuntimeAccessForSeat({ client, seatId });
      if (!access) {
        respondInvalid(respond, "Active enterprise seat context is required.");
        return;
      }
      if ((canonicalizeTenantId(access.scope.tenantId) ?? access.scope.tenantId) !== tenantId) {
        respondInvalid(respond, "tenantId must match authenticated enterprise scope.");
        return;
      }
      respond(true, {
        tenantId: access.scope.tenantId,
        seatId: access.scope.seatId,
        entries: access.entries,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.employee.enrollments": async ({ client, params, respond }) => {
    const agentId = stringValue(params.agentId) || undefined;
    try {
      const result = await listEmployeeEnterpriseIdentityEnrollmentIds({ client, agentId });
      if (!result) {
        respondInvalid(respond, "Active enterprise seat context is required.");
        return;
      }
      respond(true, {
        tenantId: result.scope.tenantId,
        agentId: result.scope.agentId,
        identityIds: result.identityIds,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.employee.authorize": async ({ client, params, respond }) => {
    const identityId = stringValue(params.identityId);
    const agentId = stringValue(params.agentId) || undefined;
    const allowedActionsRaw = params.allowedActions;
    const allowedActions = Array.isArray(allowedActionsRaw)
      ? allowedActionsRaw.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    try {
      const result = await enrollEmployeeEnterpriseIdentity({
        client,
        identityId,
        agentId,
        ...(allowedActions ? { allowedActions } : {}),
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.message, {
            details: { code: result.code },
          }),
        );
        return;
      }
      respond(true, {
        tenantId: result.scope.tenantId,
        agentId: result.scope.agentId,
        identityId: result.identityId,
        enrolled: true,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.employee.revoke": async ({ client, params, respond }) => {
    const identityId = stringValue(params.identityId);
    const agentId = stringValue(params.agentId) || undefined;
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    try {
      const result = await revokeEmployeeEnterpriseIdentity({ client, identityId, agentId });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.message, {
            details: { code: result.code },
          }),
        );
        return;
      }
      respond(true, {
        tenantId: result.scope.tenantId,
        agentId: result.scope.agentId,
        identityId: result.identityId,
        enrolled: false,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.relationships.summary": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const nowIso = new Date().toISOString();
    const seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
    );
    const relationships = summarizeOperationalIdentityRelationships({
      store: seatStore,
      tenantId,
      nowIso,
    });
    respond(true, { tenantId, relationships });
  },

  "enterprise-operational-identity.bindings.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const identityId = stringValue(params.identityId) || undefined;
    const dataSourceId = stringValue(params.dataSourceId) || undefined;
    const seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
    );
    const bindings = listTenantDataSourceIdentityBindings(seatStore, tenantId, identityId).filter(
      (binding) => (dataSourceId ? binding.dataSourceId === dataSourceId : true),
    );
    respond(true, { tenantId, bindings });
  },

  "enterprise-operational-identity.admin.grant-mode.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const seatStore = await loadEnterpriseSeatAssetsStore(
        await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
      );
      const settings = readOperationalIdentityTenantGrantMode(seatStore, tenantId);
      const implicitInheritExitDelta = previewOperationalIdentityImplicitInheritExitDelta({
        store: seatStore,
        tenantId,
      });
      respond(true, { tenantId, settings, implicitInheritExitDelta });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.admin.grant-mode.set": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const grantModeRaw = stringValue(params.grantMode);
    if (grantModeRaw !== "seat_inherit_until_curated" && grantModeRaw !== "explicit_owner_grant") {
      respondInvalid(
        respond,
        "grantMode must be seat_inherit_until_curated or explicit_owner_grant",
      );
      return;
    }
    const grantMode = grantModeRaw as OperationalIdentityTenantGrantMode;
    try {
      const storePath = await resolveControlPlaneStorePathForClient(
        client,
        TENANT_SEAT_ASSETS_FILE,
      );
      const seatStore = await loadEnterpriseSeatAssetsStore(storePath);
      const nowIso = new Date().toISOString();
      const result = updateOperationalIdentityTenantGrantMode({
        store: seatStore,
        tenantId,
        grantMode,
        nowIso,
      });
      await saveEnterpriseSeatAssetsStoreWithOiGovernance({
        storePath,
        store: seatStore,
        tenantId,
        governedIdentityIds: [],
        ownershipProof: ownershipProofForEnterpriseOperationalIdentity({ tenantId }),
      });
      respond(true, {
        tenantId,
        settings: result.settings,
        implicitInheritExitDelta: result.implicitInheritExitDelta,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },

  "enterprise-operational-identity.providers.catalog": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    respond(true, {
      tenantId,
      catalog: listOperationalIdentityProviderCatalog(),
    });
  },

  "enterprise-operational-identity.execute": async ({ client, params, respond }) => {
    const identityId = stringValue(params.identityId);
    const action = stringValue(params.action);
    const agentId = stringValue(params.agentId);
    const seatId = stringValue(params.seatId) || undefined;
    if (!identityId || !action || !agentId) {
      respondInvalid(respond, "identityId, action, and agentId are required");
      return;
    }
    const payload =
      params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
        ? (params.payload as Record<string, unknown>)
        : {};
    try {
      const result = await executeEnterpriseOperationalIdentityRuntimeAction({
        client,
        identityId,
        action,
        payload,
        seatId,
        agentId,
      });
      if (!result.ok) {
        respond(true, {
          executed: false,
          code: result.code,
          message: result.message,
          tenantId: result.scope?.tenantId ?? null,
          seatId: result.scope?.seatId ?? seatId ?? null,
          agentId: result.scope?.agentId ?? agentId,
        });
        return;
      }
      respond(true, {
        executed: true,
        tenantId: result.scope.tenantId,
        seatId: result.scope.seatId,
        agentId: result.scope.agentId,
        identityId,
        policyId: result.policyId,
        provider: result.execution.provider,
        action: result.execution.action,
        executionId: result.execution.executionId,
        output: result.execution.output,
      });
    } catch (error) {
      respond(false, undefined, toOperationalIdentityErrorShape(error));
    }
  },
};
