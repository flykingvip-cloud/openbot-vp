import { resolveStateDir } from "../../config/paths.js";
import {
  authenticateGovernanceCall,
  createDataGovernanceInventoryApi,
  evaluateLaterWaveEnablementAtHost,
  getSharedDataGovernanceCatalog,
  isLaterWaveAdapterEnablement,
  listGovernanceRecoveryReceipts,
  readGovernanceRecoveryReceipt,
  resolveLaterWaveEnablementRoot,
  type GovernedResourceType,
  type LifecycleState,
} from "../data-governance/index.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveCallerGovernanceTenant } from "./operator-access.js";
import type { GatewayRequestHandlers } from "./types.js";

const GOVERNED_TYPES = new Set<GovernedResourceType>([
  "workspace",
  "agent",
  "conversation_archive",
  "knowledge",
  "memory",
  "operational_identity",
]);
const LIFECYCLES = new Set<LifecycleState>([
  "pending",
  "active",
  "read_only",
  "archived",
  "recovery_required",
  "quarantined",
  "retired",
  "deletion_pending",
  "purged",
]);

/**
 * Platform-level operator inventory surface.
 * Tenant-scoped callers are bound to membership tenantId (params.tenantId is never authoritative).
 * Platform admins (operator.admin) may inspect across tenants.
 * Uses the process-shared catalog store (not a per-request instance).
 */
function resolveInventoryApi() {
  return createDataGovernanceInventoryApi({
    store: getSharedDataGovernanceCatalog(),
  });
}

function asResourceType(value: unknown): GovernedResourceType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (!GOVERNED_TYPES.has(value as GovernedResourceType)) {
    return undefined;
  }
  return value as GovernedResourceType;
}

function asLifecycleState(value: unknown): LifecycleState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (!LIFECYCLES.has(value as LifecycleState)) {
    return undefined;
  }
  return value as LifecycleState;
}

export const dataGovernanceHandlers: GatewayRequestHandlers = {
  "dataGovernance.inventory.list": async ({ params, client, respond }) => {
    try {
      const resourceType = asResourceType(params.resourceType);
      if (params.resourceType !== undefined && resourceType === undefined) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "resourceType must be workspace|agent|conversation_archive|knowledge|memory|operational_identity",
          ),
        );
        return;
      }
      const lifecycleState = asLifecycleState(params.lifecycleState);
      if (params.lifecycleState !== undefined && lifecycleState === undefined) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "lifecycleState is invalid"),
        );
        return;
      }
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin && !caller.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "trusted tenant context required"),
        );
        return;
      }
      const requestedTenant =
        params.tenantId === null
          ? null
          : typeof params.tenantId === "string"
            ? params.tenantId
            : undefined;
      if (
        !caller.isPlatformAdmin &&
        requestedTenant !== undefined &&
        requestedTenant !== caller.tenantId
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "cross-tenant inventory access denied"),
        );
        return;
      }
      const tenantId = caller.isPlatformAdmin ? requestedTenant : caller.tenantId;
      const api = resolveInventoryApi();
      const items = await api.list({ resourceType, tenantId, lifecycleState });
      respond(true, {
        items,
        access: caller.isPlatformAdmin ? "platform_admin" : "tenant_bound",
        boundTenantId: caller.isPlatformAdmin ? null : caller.tenantId,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String((err as Error)?.message ?? err)),
      );
    }
  },

  "dataGovernance.inventory.listRecoveryRequired": async ({ params, client, respond }) => {
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin && !caller.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "trusted tenant context required"),
        );
        return;
      }
      const resourceType = asResourceType(params.resourceType);
      if (params.resourceType !== undefined && resourceType === undefined) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "resourceType must be workspace|agent|conversation_archive|knowledge|memory|operational_identity",
          ),
        );
        return;
      }
      const tenantId = caller.isPlatformAdmin
        ? typeof params.tenantId === "string"
          ? params.tenantId
          : params.tenantId === null
            ? null
            : undefined
        : caller.tenantId;
      const api = resolveInventoryApi();
      const items = await api.listRecoveryRequired({ tenantId, resourceType });
      respond(true, {
        items,
        access: caller.isPlatformAdmin ? "platform_admin" : "tenant_bound",
        boundTenantId: caller.isPlatformAdmin ? null : caller.tenantId,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String((err as Error)?.message ?? err)),
      );
    }
  },

  "dataGovernance.inventory.get": async ({ params, client, respond }) => {
    const resourceId = typeof params.resourceId === "string" ? params.resourceId.trim() : "";
    if (!resourceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "resourceId required"));
      return;
    }
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin && !caller.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "trusted tenant context required"),
        );
        return;
      }
      const api = resolveInventoryApi();
      const got = await api.get(resourceId);
      if (!got) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "resource_not_found"));
        return;
      }
      // null tenantId is never a shared visibility domain for tenant-bound callers.
      if (!caller.isPlatformAdmin && got.record.envelope.tenantId !== caller.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "cross-tenant inventory access denied"),
        );
        return;
      }
      respond(true, got);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String((err as Error)?.message ?? err)),
      );
    }
  },

  "dataGovernance.inventory.diagnose": async ({ params, client, respond }) => {
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "platform admin required for inventory diagnose"),
        );
        return;
      }
      const observedLocators = Array.isArray(params.observedLocators)
        ? params.observedLocators.filter((v): v is string => typeof v === "string")
        : [];
      const resourceTypeHints: Record<string, GovernedResourceType> = {};
      if (params.resourceTypeHints && typeof params.resourceTypeHints === "object") {
        for (const [locator, rawType] of Object.entries(
          params.resourceTypeHints as Record<string, unknown>,
        )) {
          const typed = asResourceType(rawType);
          if (typed) {
            resourceTypeHints[locator] = typed;
          }
        }
      }
      const requireProofForTypes = Array.isArray(params.requireProofForTypes)
        ? params.requireProofForTypes
            .map((v) => asResourceType(v))
            .filter((v): v is GovernedResourceType => v !== undefined)
        : undefined;
      const ownershipProofs = Array.isArray(params.ownershipProofs)
        ? params.ownershipProofs.flatMap((raw) => {
            if (!raw || typeof raw !== "object") {
              return [];
            }
            const row = raw as Record<string, unknown>;
            const resourceId = typeof row.resourceId === "string" ? row.resourceId.trim() : "";
            if (!resourceId) {
              return [];
            }
            const tenantId =
              row.tenantId === null ? null : typeof row.tenantId === "string" ? row.tenantId : null;
            const owner =
              row.owner && typeof row.owner === "object"
                ? (row.owner as {
                    kind?: string;
                    userId?: string;
                    seatId?: string;
                    groupId?: string;
                    systemId?: string;
                  })
                : null;
            const scope =
              row.scope && typeof row.scope === "object"
                ? (row.scope as {
                    kind?: string;
                    userId?: string;
                    tenantId?: string;
                    groupId?: string;
                  })
                : null;
            if (!owner?.kind || !scope?.kind) {
              return [];
            }
            // Narrow to supported proof shapes only (user/position/group/system × user/tenant/group/system).
            const ownerParsed =
              owner.kind === "user" && typeof owner.userId === "string"
                ? { kind: "user" as const, userId: owner.userId }
                : owner.kind === "position" && typeof owner.seatId === "string"
                  ? { kind: "position" as const, seatId: owner.seatId }
                  : owner.kind === "group" && typeof owner.groupId === "string"
                    ? { kind: "group" as const, groupId: owner.groupId }
                    : owner.kind === "system" && typeof owner.systemId === "string"
                      ? { kind: "system" as const, systemId: owner.systemId }
                      : null;
            const scopeParsed =
              scope.kind === "user" && typeof scope.userId === "string"
                ? { kind: "user" as const, userId: scope.userId }
                : scope.kind === "tenant" && typeof scope.tenantId === "string"
                  ? { kind: "tenant" as const, tenantId: scope.tenantId }
                  : scope.kind === "group" && typeof scope.groupId === "string"
                    ? { kind: "group" as const, groupId: scope.groupId }
                    : scope.kind === "system"
                      ? { kind: "system" as const }
                      : null;
            if (!ownerParsed || !scopeParsed) {
              return [];
            }
            return [
              {
                resourceId,
                tenantId,
                owner: ownerParsed,
                scope: scopeParsed,
                agentAssetId:
                  typeof row.agentAssetId === "string"
                    ? row.agentAssetId
                    : row.agentAssetId === null
                      ? null
                      : undefined,
              },
            ];
          })
        : [];
      const api = resolveInventoryApi();
      const report = await api.diagnose({
        observedLocators,
        resourceTypeHints,
        ownershipProofs,
        requireProofForTypes,
      });
      respond(true, report);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String((err as Error)?.message ?? err)),
      );
    }
  },

  "dataGovernance.recovery.listReceipts": async ({ params, client, respond }) => {
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "platform admin required for recovery receipts"),
        );
        return;
      }
      const operationId =
        typeof params.operationId === "string" ? params.operationId.trim() : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const receipts = listGovernanceRecoveryReceipts({ operationId, limit });
      respond(true, {
        receipts: receipts.map((r) => ({
          fileName: r.fileName,
          operationId: r.receipt.operationId,
          stage: r.receipt.stage,
          reason: r.receipt.reason,
          agentId: r.receipt.agentId,
          haltCompensation: r.receipt.haltCompensation,
          createdAt: r.receipt.createdAt,
        })),
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      const invalid =
        message.startsWith("invalid_recovery_") || message === "invalid_recovery_path";
      respond(
        false,
        undefined,
        errorShape(invalid ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE, message),
      );
    }
  },

  "dataGovernance.recovery.getReceipt": async ({ params, client, respond }) => {
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "platform admin required for recovery receipts"),
        );
        return;
      }
      const operationId = typeof params.operationId === "string" ? params.operationId.trim() : "";
      const stage = typeof params.stage === "string" ? params.stage.trim() : "";
      if (!operationId || !stage) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "operationId and stage required"),
        );
        return;
      }
      const receipt = readGovernanceRecoveryReceipt({ operationId, stage });
      if (!receipt) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "receipt_not_found"));
        return;
      }
      respond(true, { receipt });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      const invalid =
        message.startsWith("invalid_recovery_") || message === "invalid_recovery_path";
      respond(
        false,
        undefined,
        errorShape(invalid ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE, message),
      );
    }
  },

  "dataGovernance.laterWave.evaluateEnablement": async ({ params, client, respond }) => {
    try {
      const caller = await resolveCallerGovernanceTenant(client);
      if (!caller.isPlatformAdmin) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "platform admin required for later-wave enablement",
          ),
        );
        return;
      }
      if (!isLaterWaveAdapterEnablement(params.adapter)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "adapter must be tenant-cloud|dedicated|byos|cold-archive",
          ),
        );
        return;
      }
      const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
      if (!tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId required"));
        return;
      }
      const authCall = await authenticateGovernanceCall(client);
      if (!authCall.ok || authCall.call.callerTenantId !== tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenant_not_authorized"));
        return;
      }
      const result = await evaluateLaterWaveEnablementAtHost({
        callerTenantId: tenantId,
        authorizedTenantId: tenantId,
        adapter: params.adapter,
        signedRegionReceipt: params.signedRegionReceipt,
        call: authCall.call,
        receiptDir: resolveLaterWaveEnablementRoot(resolveStateDir()),
      });
      respond(true, {
        ok: result.ok,
        reasonCode: result.ok ? undefined : result.reasonCode,
        receipt: result.receipt,
        liveCutover: false,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String((err as Error)?.message ?? err)),
      );
    }
  },
};
