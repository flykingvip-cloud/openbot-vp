import {
  loadTenantRetentionConfigView,
  updateTenantRetentionPolicy,
} from "../../conversations/tenant-retention-config.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { buildSeatMemoryScopeSnapshots } from "../enterprise-seat-assets-governance.js";
import {
  listTenantSeats,
  loadEnterpriseSeatAssetsStore,
  type EnterpriseMemoryTransferClass,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import type { GatewayRequestHandlers } from "./types.js";

/** Enterprise memory governance — org-owned scope metadata only (no private content). */

export type EnterpriseMemoryGovernanceScopeRow = {
  scopeId: string;
  transferClass: Exclude<EnterpriseMemoryTransferClass, "private">;
};

export type EnterpriseMemoryGovernanceSeatRow = {
  seatId: string;
  title: string;
  scopes: EnterpriseMemoryGovernanceScopeRow[];
};

export type EnterpriseMemoryGovernanceOverview = {
  seats: EnterpriseMemoryGovernanceSeatRow[];
  privacyNote: string;
};

export const ENTERPRISE_MEMORY_GOVERNANCE_PRIVACY_NOTE =
  "仅展示岗位/组织记忆范围元数据；员工私人记忆对管理员不可见，也无法通过此界面打开正文。";

export function buildEnterpriseMemoryGovernanceOverview(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
}): EnterpriseMemoryGovernanceOverview {
  const seats = listTenantSeats(params.store, params.tenantId).map((seat) => {
    const scopes = buildSeatMemoryScopeSnapshots({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      includePrivate: false,
    })
      .filter(
        (
          snapshot,
        ): snapshot is { scopeId: string; transferClass: "inheritable" | "review_required" } =>
          snapshot.transferClass !== "private",
      )
      .map((snapshot) => ({
        scopeId: snapshot.scopeId,
        transferClass: snapshot.transferClass,
      }));
    return {
      seatId: seat.seatId,
      title: seat.title,
      scopes,
    };
  });
  return {
    seats,
    privacyNote: ENTERPRISE_MEMORY_GOVERNANCE_PRIVACY_NOTE,
  };
}

export const enterpriseMemoryGovernanceHandlers: GatewayRequestHandlers = {
  "enterprise-memory.governance.overview": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const storePath = await resolveControlPlaneStorePathForClient(
      client ?? null,
      TENANT_SEAT_ASSETS_FILE,
    );
    const store = await loadEnterpriseSeatAssetsStore(storePath);
    const overview = buildEnterpriseMemoryGovernanceOverview({ store, tenantId });
    respond(true, {
      tenantId,
      overview: {
        privacyNote: overview.privacyNote,
        seats: overview.seats.map((seat) => ({
          seatId: seat.seatId,
          title: seat.title,
          scopes: seat.scopes.map((scope) => ({
            scopeId: scope.scopeId,
            transferClass: scope.transferClass,
          })),
        })),
      },
    });
  },

  "enterprise-memory.governance.retention.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const view = await loadTenantRetentionConfigView(tenantId);
    respond(true, { ...view, tenantId });
  },

  "enterprise-memory.governance.retention.update": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const conversation =
      params.conversation && typeof params.conversation === "object"
        ? (params.conversation as Record<string, unknown>)
        : undefined;
    const patch = {
      ...(typeof params.complianceProfile === "string"
        ? { complianceProfile: params.complianceProfile as "standard" | "financial" | "custom" }
        : {}),
      ...(conversation
        ? {
            conversation: {
              ...(typeof conversation.activeDays === "number"
                ? { activeDays: conversation.activeDays }
                : {}),
              ...(typeof conversation.archiveDays === "number"
                ? { archiveDays: conversation.archiveDays }
                : {}),
              ...(typeof conversation.deleteAfterDays === "number"
                ? { deleteAfterDays: conversation.deleteAfterDays }
                : {}),
            },
          }
        : {}),
    };
    const view = await updateTenantRetentionPolicy({ tenantId, patch });
    respond(true, { ...view, tenantId, ok: true });
  },
};
