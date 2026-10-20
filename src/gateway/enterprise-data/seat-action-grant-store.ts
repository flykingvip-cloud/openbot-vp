import { randomUUID } from "node:crypto";
import {
  assertConnectorActionGrantable,
  findConnectorAction,
  EnterpriseDataStoreError,
} from "./connector-action-store.js";
import {
  buildConnectorActionRefKey,
  type ConnectorActionRef,
  type EnterpriseDataStore,
  type SeatActionGrant,
} from "./types.js";

export function findSeatActionGrant(
  store: EnterpriseDataStore,
  tenantId: string,
  seatId: string,
  ref: ConnectorActionRef,
): SeatActionGrant | null {
  const key = buildConnectorActionRefKey(ref);
  return (
    Object.values(store.seatActionGrants).find(
      (grant) =>
        grant.tenantId === tenantId &&
        grant.seatId === seatId &&
        !grant.revokedAt &&
        buildConnectorActionRefKey(grant) === key,
    ) ?? null
  );
}

export function listSeatActionGrants(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId?: string;
}): SeatActionGrant[] {
  return Object.values(params.store.seatActionGrants)
    .filter((grant) => {
      if (grant.tenantId !== params.tenantId) {
        return false;
      }
      if (grant.revokedAt) {
        return false;
      }
      if (params.seatId && grant.seatId !== params.seatId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function upsertSeatActionGrant(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  scopePolicyId?: string;
  approvalPolicyId?: string;
  nowIso: string;
}): SeatActionGrant {
  const action = findConnectorAction(params.store, params.tenantId, params);
  if (!action) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_NOT_FOUND",
      `Action ${params.actionKey}@${params.version} not found.`,
    );
  }
  assertConnectorActionGrantable(action);
  if (action.lifecycle === "deprecated") {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_DEPRECATED",
      `Action ${params.actionKey}@${params.version} is deprecated and cannot receive new grants.`,
    );
  }
  const existing = findSeatActionGrant(params.store, params.tenantId, params.seatId, params);
  if (existing) {
    existing.scopePolicyId = params.scopePolicyId;
    existing.approvalPolicyId = params.approvalPolicyId;
    return existing;
  }
  const grant: SeatActionGrant = {
    grantId: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    connectorId: params.connectorId,
    actionKey: params.actionKey,
    version: params.version,
    scopePolicyId: params.scopePolicyId,
    approvalPolicyId: params.approvalPolicyId,
    effect: "allow",
    createdAt: params.nowIso,
  };
  params.store.seatActionGrants[grant.grantId] = grant;
  return grant;
}

export function revokeSeatActionGrant(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  grantId: string;
  nowIso: string;
}): SeatActionGrant {
  const grant = params.store.seatActionGrants[params.grantId];
  if (!grant || grant.tenantId !== params.tenantId) {
    throw new EnterpriseDataStoreError(
      "SEAT_ACTION_GRANT_NOT_FOUND",
      "Seat action grant not found.",
    );
  }
  grant.revokedAt = params.nowIso;
  return grant;
}
