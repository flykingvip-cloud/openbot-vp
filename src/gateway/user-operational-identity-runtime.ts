import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { resolveQueryScope } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";
import { resolveUserOperationalIdentityStorePathForClient } from "./tenant-context.js";
import {
  listUserOperationalIdentityAccessForAgent,
  resolveUserOperationalIdentity,
  type ResolveUserOperationalIdentityResult,
} from "./user-operational-identity-access.js";
import { createUserOperationalIdentityBindingRequest } from "./user-operational-identity-binding-request.js";
import { createUserOperationalIdentityContinuation } from "./user-operational-identity-continuation.js";
import { loadEmployeeOperationalAuthorization } from "./user-operational-identity-enterprise-authorization.js";
import {
  executeUserOperationalIdentityAction,
  parseUserOperationalIdentityExecutionPayload,
  type UserOperationalIdentityExecutionResult,
} from "./user-operational-identity-execution.js";
import {
  derivePersonalEmailResumeMessage,
  formatPersonalEmailSendGuidancePrompt,
  PERSONAL_EMAIL_PROVIDER,
} from "./user-operational-identity-guidance.js";
import {
  loadUserOperationalIdentityStore,
  withUserOperationalIdentityStoreWriteLockForOwner,
} from "./user-operational-identity-persistence.js";
import { resolveOperationalIdentityActorUserId } from "./user-operational-identity-session.js";
import { listUserOperationalIdentityGrantsForAgent } from "./user-operational-identity-store.js";
import { resolveTrustedUserOperationalIdentityAgentScope } from "./user-operational-identity-trusted-agent-scope.js";
import type { UserOperationalIdentityStore } from "./user-operational-identity-types.js";

export function persistPersonalEmailBindingHandoff(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
  agentScope: Parameters<typeof createUserOperationalIdentityContinuation>[0]["agentScope"];
  provider: string;
  requestedAction: string;
  sessionKey?: string | null;
  nowIso: string;
}): { bindingRequestId?: string; continuationToken?: string } {
  if (params.provider.trim().toLowerCase() !== PERSONAL_EMAIL_PROVIDER) {
    return {};
  }
  const createdRequest = createUserOperationalIdentityBindingRequest({
    store: params.store,
    ownerId: params.ownerId,
    agentId: params.agentId,
    agentScope: params.agentScope,
    provider: params.provider,
    requestedAction: params.requestedAction,
    sessionKey: params.sessionKey,
    nowIso: params.nowIso,
  });
  if (!createdRequest.ok) {
    return {};
  }
  const bindingRequestId = createdRequest.request.requestId;
  const createdContinuation = createUserOperationalIdentityContinuation({
    store: params.store,
    ownerId: params.ownerId,
    agentId: params.agentId,
    agentScope: params.agentScope,
    provider: params.provider,
    requestedAction: params.requestedAction,
    sessionKey: params.sessionKey,
    workbenchModule: "assistant",
    resumeMessage: derivePersonalEmailResumeMessage(params.requestedAction),
    bindingRequestId,
    autoResume: true,
    nowIso: params.nowIso,
  });
  return {
    bindingRequestId,
    continuationToken: createdContinuation.ok
      ? createdContinuation.continuation.continuationToken
      : undefined,
  };
}

export type UserOperationalIdentityRuntimeScope = {
  ownerId: string;
  agentId: string;
  sessionKey?: string | null;
};

async function resolveScopeFromUniqueAgentGrant(params: {
  agentId: string;
  ownerId?: string;
  sessionKey?: string | null;
}): Promise<UserOperationalIdentityRuntimeScope | null> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return null;
  }
  const store = await loadUserOiRuntimeStore(null);
  const grants = listUserOperationalIdentityGrantsForAgent(store, {
    agentId,
    ownerId: params.ownerId,
  });
  if (grants.length === 0) {
    return null;
  }
  const ownerIds = [...new Set(grants.map((grant) => grant.ownerId))];
  if (ownerIds.length !== 1) {
    return null;
  }
  return {
    ownerId: ownerIds[0],
    agentId,
    sessionKey: params.sessionKey ?? null,
  };
}

export async function resolveUserOperationalIdentityRuntimeScope(params: {
  client: GatewayClient | null;
  agentId?: string;
  sessionKey?: string | null;
  allowGrantFallback?: boolean;
}): Promise<UserOperationalIdentityRuntimeScope | null> {
  // Task 1.4: owner 解析失败才返回 null（不再硬性要求 client.user）。
  const ownerId = await resolveOperationalIdentityActorUserId({ client: params.client });
  const agentId =
    params.agentId?.trim() ||
    (params.sessionKey ? resolveSessionAgentId({ sessionKey: params.sessionKey }) : undefined) ||
    "";
  if (ownerId && agentId) {
    return {
      ownerId,
      agentId,
      sessionKey: params.sessionKey ?? null,
    };
  }
  if (params.allowGrantFallback === false || !agentId) {
    return null;
  }
  return resolveScopeFromUniqueAgentGrant({
    agentId,
    ownerId: ownerId || undefined,
    sessionKey: params.sessionKey,
  });
}

export async function listUserOperationalIdentityRuntimeAccess(params: {
  client: GatewayClient | null;
  agentId?: string;
  sessionKey?: string | null;
}): Promise<{
  scope: UserOperationalIdentityRuntimeScope;
  entries: ReturnType<typeof listUserOperationalIdentityAccessForAgent>;
} | null> {
  const scope = await resolveUserOperationalIdentityRuntimeScope(params);
  if (!scope) {
    return null;
  }
  const store = await loadUserOiRuntimeStore(params.client);
  const entries = listUserOperationalIdentityAccessForAgent({
    store,
    ownerId: scope.ownerId,
    agentId: scope.agentId,
  });
  return { scope, entries };
}

async function withUserOiRuntimeStoreWriteLock<T>(
  client: GatewayClient | null,
  fn: (store: UserOperationalIdentityStore) => Promise<T> | T,
  ownerIdOverride?: string,
): Promise<T> {
  const storePath = await resolveUserOperationalIdentityStorePathForClient(client);
  const ownerId =
    ownerIdOverride?.trim() || (await resolveOperationalIdentityActorUserId({ client })) || "";
  if (!ownerId) {
    throw new Error("governance_write_denied:missing_ownership_proof");
  }
  const scope = await resolveQueryScope(client);
  const tenantId = scope.kind === "tenant" ? scope.tenantId : null;
  return withUserOperationalIdentityStoreWriteLockForOwner({ ownerId, tenantId, storePath }, fn);
}

async function loadUserOiRuntimeStore(client: GatewayClient | null) {
  const storePath = await resolveUserOperationalIdentityStorePathForClient(client);
  return loadUserOperationalIdentityStore(storePath);
}

async function persistStoreMutation(
  client: GatewayClient | null,
  mutate: (store: UserOperationalIdentityStore) => void | Promise<void>,
  ownerId?: string,
): Promise<void> {
  await withUserOiRuntimeStoreWriteLock(
    client,
    async (store) => {
      await mutate(store);
      return store;
    },
    ownerId,
  );
}

export async function enforceUserOperationalIdentityRuntimeAccess(params: {
  client: GatewayClient | null;
  provider: string;
  action: string;
  agentId?: string;
  sessionKey?: string | null;
  audit?: boolean;
  createBindingRequestOnDeny?: boolean;
}): Promise<
  | {
      ok: true;
      scope: UserOperationalIdentityRuntimeScope;
      result: Extract<ResolveUserOperationalIdentityResult, { allowed: true }>;
    }
  | {
      ok: false;
      scope: UserOperationalIdentityRuntimeScope | null;
      result: Extract<ResolveUserOperationalIdentityResult, { allowed: false }> | null;
      message: string;
      bindingRequestId?: string;
      continuationToken?: string;
    }
> {
  const scope = await resolveUserOperationalIdentityRuntimeScope({
    client: params.client,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  if (!scope) {
    return {
      ok: false,
      scope: null,
      result: null,
      message: "Platform auth user context is required for user operational identity access.",
    };
  }
  const nowIso = new Date().toISOString();
  // Task 3.2: enterprise authorization gate (authoritative tenant/seat from
  // membership + seat binding; never from request params). Resolved before the
  // store lock; a deny short-circuits inside resolveUserOperationalIdentity.
  const enterpriseAuthorization = await loadEmployeeOperationalAuthorization(
    scope.ownerId,
    params.client,
  );
  const result = await withUserOiRuntimeStoreWriteLock(
    params.client,
    (store) =>
      resolveUserOperationalIdentity({
        store,
        provider: params.provider,
        action: params.action,
        currentUserId: scope.ownerId,
        currentUserEmail: params.client?.user,
        currentAgentId: scope.agentId,
        sessionKey: scope.sessionKey,
        nowIso,
        audit: params.audit,
        enterpriseAuthorization,
      }),
    scope.ownerId,
  );
  if (result.allowed) {
    return { ok: true, scope, result };
  }

  let bindingRequestId: string | undefined;
  let continuationToken: string | undefined;
  if (params.createBindingRequestOnDeny && result.needsBinding && params.client) {
    const agentScope = resolveTrustedUserOperationalIdentityAgentScope({
      currentUserId: scope.ownerId,
      currentUserEmail: params.client?.user,
      agentId: scope.agentId,
      sessionKey: scope.sessionKey,
    });
    await persistStoreMutation(
      params.client,
      (store) => {
        if (params.provider.trim().toLowerCase() === PERSONAL_EMAIL_PROVIDER) {
          const handoff = persistPersonalEmailBindingHandoff({
            store,
            ownerId: scope.ownerId,
            agentId: scope.agentId,
            agentScope,
            provider: params.provider,
            requestedAction: params.action,
            sessionKey: scope.sessionKey,
            nowIso,
          });
          bindingRequestId = handoff.bindingRequestId;
          continuationToken = handoff.continuationToken;
          return;
        }
        const created = createUserOperationalIdentityBindingRequest({
          store,
          ownerId: scope.ownerId,
          agentId: scope.agentId,
          agentScope,
          provider: params.provider,
          requestedAction: params.action,
          sessionKey: scope.sessionKey,
          nowIso,
        });
        if (created.ok) {
          bindingRequestId = created.request.requestId;
        }
      },
      scope.ownerId,
    );
  }

  return {
    ok: false,
    scope,
    result,
    message: result.message,
    bindingRequestId,
    continuationToken,
  };
}

export function formatUserOperationalIdentityRuntimePrompt(
  entries: ReturnType<typeof listUserOperationalIdentityAccessForAgent>,
): string | undefined {
  const active = entries.filter(
    (entry) => entry.status === "active" && entry.allowedActions.length > 0,
  );
  const emailGuidance = formatPersonalEmailSendGuidancePrompt();
  if (active.length === 0) {
    return emailGuidance;
  }
  const lines = active.map(
    (entry) =>
      `- ${entry.displayName} (${entry.providerLabel}, identityId=${entry.identityId}): ${entry.allowedActions.join(", ")}`,
  );
  const personalEmailSend = active.some(
    (entry) =>
      entry.provider === PERSONAL_EMAIL_PROVIDER &&
      (entry.allowedActions.includes("send_email") || entry.allowedActions.includes("reply_email")),
  );
  const wechatDraft = active.some(
    (entry) =>
      entry.provider === "wechat-official" &&
      (entry.allowedActions.includes("publish_draft") ||
        entry.allowedActions.includes("upload_thumb")),
  );
  return [
    "User operational identity access (personal; use user_operational_identity tool):",
    ...lines,
    "Call user_operational_identity with action=resolve before execute; action=execute performs the external operation using server-side credentials (tokens are never exposed).",
    personalEmailSend
      ? "Personal-email grant for THIS agent is ACTIVE (send_email/reply_email). When the user asks to send or reply, call user_operational_identity. Do not say authorization is missing. Do not use exec, mail, sendmail, mutt, or OPENBOT_SMTP_*."
      : "This agent has no active personal-email send/reply grant. Say that clearly and point to Personal Settings → 授权 / 运营身份. Do not probe mail or sendmail via exec.",
    ...(wechatDraft
      ? [
          "WeChat Official Account drafts: execute publish_draft with title, HTML content, and thumbUrl / thumbMediaId / thumbBase64 (≤64KB). Do not run wechat-article leftover publish scripts.",
        ]
      : []),
    "If access is denied, guide the user to bind/grant the provider in Personal Settings before retrying. Never send mail via exec or OPENBOT_SMTP_* env vars.",
    emailGuidance,
  ].join("\n");
}

export async function executeUserOperationalIdentityRuntimeAction(params: {
  client: GatewayClient | null;
  provider: string;
  action: string;
  payload?: Record<string, unknown>;
  agentId?: string;
  sessionKey?: string | null;
  audit?: boolean;
  createBindingRequestOnDeny?: boolean;
}): Promise<
  | {
      ok: true;
      scope: UserOperationalIdentityRuntimeScope;
      execution: Extract<UserOperationalIdentityExecutionResult, { ok: true }>;
      access: Extract<ResolveUserOperationalIdentityResult, { allowed: true }>;
    }
  | {
      ok: false;
      scope: UserOperationalIdentityRuntimeScope | null;
      code: string;
      message: string;
      bindingRequestId?: string;
      continuationToken?: string;
      needsBinding?: boolean;
      needsGrantConfirmation?: boolean;
    }
> {
  const enforcement = await enforceUserOperationalIdentityRuntimeAccess({
    client: params.client,
    provider: params.provider,
    action: params.action,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    audit: params.audit,
    createBindingRequestOnDeny: params.createBindingRequestOnDeny,
  });
  if (!enforcement.ok) {
    return {
      ok: false,
      scope: enforcement.scope,
      code: enforcement.result?.code ?? "USER_IDENTITY_DENIED",
      message: enforcement.message,
      bindingRequestId: enforcement.bindingRequestId,
      continuationToken: enforcement.continuationToken,
      needsBinding: enforcement.result?.needsBinding,
      needsGrantConfirmation: enforcement.result?.needsGrantConfirmation,
    };
  }

  const parsedPayload = parseUserOperationalIdentityExecutionPayload(params.payload ?? {});
  const nowIso = new Date().toISOString();
  const execution = await withUserOiRuntimeStoreWriteLock(
    params.client,
    async (store) =>
      executeUserOperationalIdentityAction({
        store,
        identity: enforcement.result.identity,
        provider: enforcement.result.identity.provider,
        action: params.action,
        payload: parsedPayload,
        ownerId: enforcement.scope.ownerId,
        agentId: enforcement.scope.agentId,
        sessionKey: enforcement.scope.sessionKey,
        nowIso,
        audit: params.audit,
      }),
    enforcement.scope.ownerId,
  );
  if (!execution.ok) {
    return {
      ok: false,
      scope: enforcement.scope,
      code: execution.code,
      message: execution.message,
    };
  }
  return {
    ok: true,
    scope: enforcement.scope,
    execution,
    access: enforcement.result,
  };
}
