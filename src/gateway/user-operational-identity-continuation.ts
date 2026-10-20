import { randomUUID } from "node:crypto";
import { resolveUserOperationalIdentity } from "./user-operational-identity-access.js";
import {
  isUserOperationalIdentityProviderManualAuth,
  parseUserOperationalIdentityProvider,
} from "./user-operational-identity-providers.js";
import type {
  UserOperationalIdentityContinuation,
  UserOperationalIdentityContinuationResumePayload,
  UserOperationalIdentityContinuationStatus,
  UserOperationalIdentityProvider,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const DEFAULT_CONTINUATION_TTL_MS = 60 * 60 * 1000;

function uniqueProviders(providers: string[]): UserOperationalIdentityProvider[] {
  const seen = new Set<UserOperationalIdentityProvider>();
  for (const entry of providers) {
    const parsed = parseUserOperationalIdentityProvider(entry);
    if (parsed) {
      seen.add(parsed);
    }
  }
  return [...seen];
}

function expireStaleContinuations(
  store: UserOperationalIdentityStore,
  ownerId: string,
  nowIso: string,
): void {
  for (const continuation of Object.values(store.continuations)) {
    if (continuation.ownerId !== ownerId) {
      continue;
    }
    if (
      (continuation.status === "pending_binding" ||
        continuation.status === "pending_oauth" ||
        continuation.status === "ready_to_resume") &&
      continuation.expiresAt <= nowIso
    ) {
      continuation.status = "expired";
      continuation.updatedAt = nowIso;
    }
  }
}

function hasActiveIdentityForProvider(
  store: UserOperationalIdentityStore,
  ownerId: string,
  provider: UserOperationalIdentityProvider,
): boolean {
  return Object.values(store.identities).some(
    (identity) =>
      identity.ownerId === ownerId &&
      identity.provider === provider &&
      !identity.revokedAt &&
      identity.status === "active",
  );
}

function evaluateContinuationReadiness(params: {
  store: UserOperationalIdentityStore;
  continuation: UserOperationalIdentityContinuation;
  nowIso: string;
  currentUserEmail?: string | null;
}): UserOperationalIdentityContinuationStatus {
  const { continuation, store, nowIso } = params;
  if (continuation.status === "resumed" || continuation.status === "cancelled") {
    return continuation.status;
  }
  if (continuation.expiresAt <= nowIso) {
    return "expired";
  }

  const completedProviders = continuation.requiredProviders.filter((provider) =>
    hasActiveIdentityForProvider(store, continuation.ownerId, provider),
  );
  continuation.completedProviders = completedProviders;

  // Manual providers (SMTP / OA / social) complete via credentials.bind, not OAuth.
  // Once an active identity exists they should not stay stuck in pending_oauth.
  const pendingOAuth = continuation.requiredProviders.filter((provider) => {
    if (!completedProviders.includes(provider)) {
      return false;
    }
    if (continuation.oauthCompletedProviders.includes(provider)) {
      return false;
    }
    const parsed = parseUserOperationalIdentityProvider(provider);
    if (parsed && isUserOperationalIdentityProviderManualAuth(parsed)) {
      return false;
    }
    return true;
  });
  if (pendingOAuth.length > 0) {
    return "pending_oauth";
  }

  const pendingBinding = continuation.requiredProviders.filter(
    (provider) => !completedProviders.includes(provider),
  );
  if (pendingBinding.length > 0) {
    return "pending_binding";
  }

  const access = resolveUserOperationalIdentity({
    store,
    provider: continuation.provider,
    action: continuation.requestedAction,
    currentUserId: continuation.ownerId,
    currentUserEmail: params.currentUserEmail,
    currentAgentId: continuation.agentId,
    sessionKey: continuation.sessionKey,
    nowIso,
    audit: false,
  });
  if (!access.allowed) {
    return access.needsGrantConfirmation ? "pending_binding" : "pending_binding";
  }

  return "ready_to_resume";
}

export function createUserOperationalIdentityContinuation(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
  agentScope: UserOperationalIdentityContinuation["agentScope"];
  provider: string;
  requestedAction: string;
  sessionKey?: string | null;
  workbenchModule?: string | null;
  resumeMessage?: string;
  resumeIntentId?: string;
  executionPayload?: Record<string, unknown>;
  requiredProviders?: string[];
  bindingRequestId?: string;
  autoResume?: boolean;
  nowIso: string;
  expiresAt?: string;
}):
  | { ok: true; continuation: UserOperationalIdentityContinuation }
  | { ok: false; code: string; error: string } {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  const requestedAction = params.requestedAction.trim();
  const agentId = params.agentId.trim();
  if (!provider || !requestedAction || !agentId) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_INVALID",
      error: "provider, requestedAction, and agentId are required.",
    };
  }
  const requiredProviders = uniqueProviders([provider, ...(params.requiredProviders ?? [])]);
  const expiresAt =
    params.expiresAt ??
    new Date(new Date(params.nowIso).getTime() + DEFAULT_CONTINUATION_TTL_MS).toISOString();
  const continuation: UserOperationalIdentityContinuation = {
    continuationId: randomUUID(),
    continuationToken: randomUUID(),
    ownerId: params.ownerId,
    bindingRequestId: params.bindingRequestId?.trim() || undefined,
    sessionKey: params.sessionKey ?? null,
    workbenchModule: params.workbenchModule?.trim() || null,
    agentId,
    agentScope: params.agentScope,
    provider,
    requestedAction,
    resumeMessage: params.resumeMessage?.trim() || undefined,
    resumeIntentId: params.resumeIntentId?.trim() || undefined,
    executionPayload:
      params.executionPayload && typeof params.executionPayload === "object"
        ? { ...params.executionPayload }
        : undefined,
    requiredProviders,
    completedProviders: [],
    oauthCompletedProviders: [],
    status: "pending_binding",
    autoResume: params.autoResume !== false,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    expiresAt,
  };
  params.store.continuations[continuation.continuationId] = continuation;
  return { ok: true, continuation };
}

export function getUserOperationalIdentityContinuationByToken(
  store: UserOperationalIdentityStore,
  ownerId: string,
  continuationToken: string,
): UserOperationalIdentityContinuation | null {
  const token = continuationToken.trim();
  if (!token) {
    return null;
  }
  return (
    Object.values(store.continuations).find(
      (entry) => entry.ownerId === ownerId && entry.continuationToken === token,
    ) ?? null
  );
}

export function getUserOperationalIdentityContinuation(
  store: UserOperationalIdentityStore,
  ownerId: string,
  continuationId: string,
): UserOperationalIdentityContinuation | null {
  const continuation = store.continuations[continuationId];
  if (!continuation || continuation.ownerId !== ownerId) {
    return null;
  }
  return continuation;
}

export function completeOAuthForUserOperationalIdentityContinuation(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  continuationToken: string;
  provider: string;
  nowIso: string;
  currentUserEmail?: string | null;
}):
  | { ok: true; continuation: UserOperationalIdentityContinuation }
  | { ok: false; code: string; error: string } {
  const parsedProvider = parseUserOperationalIdentityProvider(params.provider);
  if (!parsedProvider) {
    return { ok: false, code: "USER_IDENTITY_PROVIDER_INVALID", error: "provider is invalid." };
  }
  const continuation = getUserOperationalIdentityContinuationByToken(
    params.store,
    params.ownerId,
    params.continuationToken,
  );
  if (!continuation) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_NOT_FOUND",
      error: "Continuation not found.",
    };
  }
  if (!continuation.requiredProviders.includes(parsedProvider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_PROVIDER_MISMATCH",
      error: "Provider is not part of this continuation.",
    };
  }
  if (!hasActiveIdentityForProvider(params.store, params.ownerId, parsedProvider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_NOT_BOUND",
      error: "Provider identity must be bound before OAuth completion.",
    };
  }
  if (!continuation.oauthCompletedProviders.includes(parsedProvider)) {
    continuation.oauthCompletedProviders.push(parsedProvider);
  }
  continuation.oauthCompletedAt = params.nowIso;
  continuation.updatedAt = params.nowIso;
  continuation.status = evaluateContinuationReadiness({
    store: params.store,
    continuation,
    nowIso: params.nowIso,
    currentUserEmail: params.currentUserEmail,
  });
  return { ok: true, continuation };
}

export function refreshUserOperationalIdentityContinuations(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  nowIso: string;
  currentUserEmail?: string | null;
}): UserOperationalIdentityContinuation[] {
  expireStaleContinuations(params.store, params.ownerId, params.nowIso);
  const updated: UserOperationalIdentityContinuation[] = [];
  for (const continuation of Object.values(params.store.continuations)) {
    if (continuation.ownerId !== params.ownerId) {
      continue;
    }
    if (
      continuation.status === "resumed" ||
      continuation.status === "cancelled" ||
      continuation.status === "expired"
    ) {
      continue;
    }
    const nextStatus = evaluateContinuationReadiness({
      store: params.store,
      continuation,
      nowIso: params.nowIso,
      currentUserEmail: params.currentUserEmail,
    });
    if (nextStatus !== continuation.status) {
      continuation.status = nextStatus;
      continuation.updatedAt = params.nowIso;
      updated.push(continuation);
    }
  }
  return updated;
}

export function resumeUserOperationalIdentityContinuation(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  continuationToken: string;
  nowIso: string;
  currentUserEmail?: string | null;
  force?: boolean;
}):
  | {
      ok: true;
      continuation: UserOperationalIdentityContinuation;
      resume: UserOperationalIdentityContinuationResumePayload;
    }
  | { ok: false; code: string; error: string; continuation?: UserOperationalIdentityContinuation } {
  const continuation = getUserOperationalIdentityContinuationByToken(
    params.store,
    params.ownerId,
    params.continuationToken,
  );
  if (!continuation) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_NOT_FOUND",
      error: "Continuation not found.",
    };
  }
  refreshUserOperationalIdentityContinuations({
    store: params.store,
    ownerId: params.ownerId,
    nowIso: params.nowIso,
    currentUserEmail: params.currentUserEmail,
  });
  if (continuation.status === "expired") {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_EXPIRED",
      error: "Continuation has expired.",
      continuation,
    };
  }
  if (continuation.status !== "ready_to_resume" && !params.force) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_NOT_READY",
      error: "Continuation is not ready to resume yet.",
      continuation,
    };
  }
  const resumeMessage =
    continuation.resumeMessage?.trim() ||
    `请继续执行此前中断的任务（${continuation.provider} · ${continuation.requestedAction}）。`;
  continuation.status = "resumed";
  continuation.resumedAt = params.nowIso;
  continuation.updatedAt = params.nowIso;
  const resume: UserOperationalIdentityContinuationResumePayload = {
    continuationId: continuation.continuationId,
    continuationToken: continuation.continuationToken,
    sessionKey: continuation.sessionKey,
    workbenchModule: continuation.workbenchModule,
    agentId: continuation.agentId,
    resumeMessage,
    autoResume: continuation.autoResume,
    resumeIntentId: continuation.resumeIntentId,
    executionPayload: continuation.executionPayload,
    publishIntent: continuation.resumeIntentId
      ? {
          intentId: continuation.resumeIntentId,
          provider: continuation.provider,
          operationalAction: continuation.requestedAction,
          objectTitle:
            resumeMessage.match(/^标题：(.+)$/m)?.[1]?.trim() || continuation.requestedAction,
          objectSummary: resumeMessage.match(/^摘要：(.+)$/m)?.[1]?.trim() || undefined,
        }
      : undefined,
  };
  return { ok: true, continuation, resume };
}

export function listPendingUserOperationalIdentityContinuations(
  store: UserOperationalIdentityStore,
  ownerId: string,
  nowIso: string,
): UserOperationalIdentityContinuation[] {
  expireStaleContinuations(store, ownerId, nowIso);
  return Object.values(store.continuations)
    .filter(
      (entry) =>
        entry.ownerId === ownerId &&
        (entry.status === "pending_binding" ||
          entry.status === "pending_oauth" ||
          entry.status === "ready_to_resume"),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function cancelUserOperationalIdentityContinuation(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  continuationToken: string;
  nowIso: string;
}):
  | { ok: true; continuation: UserOperationalIdentityContinuation }
  | { ok: false; code: string; error: string } {
  const continuation = getUserOperationalIdentityContinuationByToken(
    params.store,
    params.ownerId,
    params.continuationToken,
  );
  if (!continuation) {
    return {
      ok: false,
      code: "USER_IDENTITY_CONTINUATION_NOT_FOUND",
      error: "Continuation not found.",
    };
  }
  continuation.status = "cancelled";
  continuation.updatedAt = params.nowIso;
  return { ok: true, continuation };
}
