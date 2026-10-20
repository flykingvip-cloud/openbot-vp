import { randomUUID } from "node:crypto";
import { resolveUserOperationalIdentity } from "./user-operational-identity-access.js";
import {
  parseUserOperationalIdentityProvider,
  USER_OPERATIONAL_IDENTITY_PILOT_PROVIDERS,
} from "./user-operational-identity-providers.js";
import type {
  UserOperationalIdentityBindingRequest,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const DEFAULT_BINDING_REQUEST_TTL_MS = 30 * 60 * 1000;

export function createUserOperationalIdentityBindingRequest(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
  agentScope: UserOperationalIdentityBindingRequest["agentScope"];
  provider: string;
  requestedAction: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
  nowIso: string;
  expiresAt?: string;
}):
  | { ok: true; request: UserOperationalIdentityBindingRequest }
  | { ok: false; code: string; error: string } {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  if (!provider) {
    return { ok: false, code: "USER_IDENTITY_PROVIDER_INVALID", error: "provider is invalid." };
  }
  const agentId = params.agentId.trim();
  const requestedAction = params.requestedAction.trim();
  if (!agentId || !requestedAction) {
    return {
      ok: false,
      code: "USER_IDENTITY_BINDING_REQUEST_INVALID",
      error: "agentId and requestedAction are required.",
    };
  }
  const expiresAt =
    params.expiresAt ??
    new Date(new Date(params.nowIso).getTime() + DEFAULT_BINDING_REQUEST_TTL_MS).toISOString();
  const request: UserOperationalIdentityBindingRequest = {
    requestId: randomUUID(),
    ownerId: params.ownerId,
    tenantId: params.tenantId?.trim() || undefined,
    seatId: params.seatId?.trim() || undefined,
    sessionKey: params.sessionKey ?? null,
    agentId,
    agentScope: params.agentScope,
    provider,
    requestedAction,
    status: "pending",
    createdAt: params.nowIso,
    expiresAt,
  };
  params.store.bindingRequests[request.requestId] = request;
  return { ok: true, request };
}

export function getUserOperationalIdentityBindingRequest(
  store: UserOperationalIdentityStore,
  ownerId: string,
  requestId: string,
): UserOperationalIdentityBindingRequest | null {
  const request = store.bindingRequests[requestId];
  if (!request || request.ownerId !== ownerId) {
    return null;
  }
  return request;
}

export function cancelUserOperationalIdentityBindingRequest(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  requestId: string;
  nowIso: string;
}):
  | { ok: true; request: UserOperationalIdentityBindingRequest }
  | { ok: false; code: string; error: string } {
  const request = getUserOperationalIdentityBindingRequest(
    params.store,
    params.ownerId,
    params.requestId,
  );
  if (!request || request.status !== "pending") {
    return {
      ok: false,
      code: "USER_IDENTITY_BINDING_REQUEST_NOT_FOUND",
      error: "Binding request not found.",
    };
  }
  request.status = "cancelled";
  request.completedAt = params.nowIso;
  return { ok: true, request };
}

export function completeUserOperationalIdentityBindingRequest(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  requestId: string;
  nowIso: string;
  currentUserEmail?: string | null;
}):
  | { ok: true; request: UserOperationalIdentityBindingRequest }
  | { ok: false; code: string; error: string } {
  const request = getUserOperationalIdentityBindingRequest(
    params.store,
    params.ownerId,
    params.requestId,
  );
  if (!request || request.status !== "pending") {
    return {
      ok: false,
      code: "USER_IDENTITY_BINDING_REQUEST_NOT_FOUND",
      error: "Binding request not found.",
    };
  }
  if (request.expiresAt <= params.nowIso) {
    request.status = "expired";
    request.completedAt = params.nowIso;
    return {
      ok: false,
      code: "USER_IDENTITY_BINDING_REQUEST_EXPIRED",
      error: "Binding request has expired.",
    };
  }
  const access = resolveUserOperationalIdentity({
    store: params.store,
    provider: request.provider,
    action: request.requestedAction,
    currentUserId: params.ownerId,
    currentUserEmail: params.currentUserEmail,
    currentAgentId: request.agentId,
    sessionKey: request.sessionKey,
    nowIso: params.nowIso,
    audit: false,
  });
  if (!access.allowed) {
    return {
      ok: false,
      code: access.code,
      error:
        access.code === "USER_IDENTITY_NOT_BOUND"
          ? "Bind the required operational identity before completing this request."
          : access.message,
    };
  }
  request.status = "completed";
  request.completedAt = params.nowIso;
  return { ok: true, request };
}

export function listPendingUserOperationalIdentityBindingRequests(
  store: UserOperationalIdentityStore,
  ownerId: string,
  nowIso: string,
): UserOperationalIdentityBindingRequest[] {
  return Object.values(store.bindingRequests)
    .filter((request) => {
      if (request.ownerId !== ownerId) {
        return false;
      }
      if (request.status === "pending" && request.expiresAt <= nowIso) {
        request.status = "expired";
        request.completedAt = nowIso;
        return false;
      }
      return request.status === "pending";
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function suggestPilotProviderForBindingRequest(provider: string): boolean {
  const parsed = parseUserOperationalIdentityProvider(provider);
  return parsed ? USER_OPERATIONAL_IDENTITY_PILOT_PROVIDERS.includes(parsed) : false;
}
