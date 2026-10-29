/**
 * Live ResumeParkedRecheck for the chat.send entry path.
 *
 * applyFocusSwitchGate already fail-closes when authOk===false or stopActive===true.
 * chat.send must resolve those flags from real send-time signals before resume
 * proceeds — never call the gate without a recheck on the user resume path.
 *
 * ## Resume stop policy (authoritative by trusted scope + taskId)
 *
 * Ephemeral `chatAbortControllers` are NOT authoritative: `abortChatRunById`
 * aborts then deletes the controller, so a later resume that only scans live
 * aborted controllers can see false and wrongly allow resume.
 *
 * Authoritative stop is recorded under a **trusted scope** plus the **original
 * taskId**. Scope kind rules (never silently coerce missing identity to ""):
 *
 * - **managed**: trusted non-empty `tenantId` + `userId` + canonical `sessionKey`
 * - **personal**: trusted non-empty `userId` + canonical `sessionKey`; tenant is
 *   the explicit personal marker {@link AUTHORITATIVE_STOP_PERSONAL_TENANT}
 * - **internal**: must pass `scopeKind: "internal"` explicitly; uses internal
 *   markers — never inferred from blank identity
 *
 * Incomplete scope refuses record/clear. Resume query that cannot verify
 * identity returns **unverifiable** and is treated as blocked (never as
 * "not stopped"). taskId alone is never a registry key.
 *
 * Production entry ({@link authoritativeStopIdentityFromClient}) picks managed
 * vs personal from the trusted security profile — not from tenant presence.
 * Managed with a missing tenant stays managed and fails closed on resume.
 * A bare missing client never auto-gets internal.
 *
 * Resume of that scoped taskId is denied while the record exists — even after
 * the AbortController entry is cleaned. Other taskIds in the same scope, and
 * the same taskId under another session/tenant/user, are unaffected. Undo
 * clears only the matching scope+taskId. Task-park aborts do not record a stop
 * (park is not a user stop barrier).
 *
 * ## Durability boundary (disclose)
 *
 * The registry is a **process-local Map**. It survives AbortController delete
 * within one gateway process for single-gateway, no-mid-restart exploratory
 * tests. It is **not** durable across process restart / multi-host; cross-
 * process stop authority remains separately unproven.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { ResumeParkedRecheck } from "../../conversation-task/session-task-board.js";
import {
  applyFocusSwitchGate,
  type FocusSwitchGateDecision,
} from "../../conversation-task/session-task-board.js";
import { resolveSecurityProfile } from "../security-profile.js";

export type ResolveResumeParkedRecheckParams = {
  /** Session send policy already resolved for this turn. */
  sendPolicy?: string;
  /**
   * False when personal-workbench / ownership checks failed (caller may still
   * invoke for belt-and-suspenders after an early return path).
   */
  accessAuthorized?: boolean;
  /**
   * False when the WS client has no usable identity after hydrate
   * (user / platformUserId / pairedDeviceId / membership / connect role).
   */
  clientIdentityOk?: boolean;
  /** True when a session-wide stop/abort barrier is active (broad deny). */
  stopActive?: boolean;
  /**
   * Authoritative per-taskId stop lookup. When provided, resumeParkedTask
   * queries this with the resume target taskId (wins over boolean stopActive
   * for that task).
   */
  isTaskStopActive?: (taskId: string) => boolean;
};

/**
 * Build the recheck object chat.send passes into applyFocusSwitchGate.
 * Missing optional flags stay permissive only when not explicitly false/deny;
 * stopActive is fail-closed when true.
 */
export function resolveResumeParkedRecheck(
  params: ResolveResumeParkedRecheckParams = {},
): ResumeParkedRecheck {
  const authOk =
    params.sendPolicy !== "deny" &&
    params.accessAuthorized !== false &&
    params.clientIdentityOk !== false;
  return {
    authOk,
    stopActive: params.stopActive === true,
    ...(typeof params.isTaskStopActive === "function"
      ? { isTaskStopActive: params.isTaskStopActive }
      : {}),
  };
}

export type SessionStopBarrierEntry = {
  sessionKey: string;
  controller?: { signal?: { aborted?: boolean } };
};

/** Explicit personal tenant marker — never silently coerce missing tenant to "". */
export const AUTHORITATIVE_STOP_PERSONAL_TENANT = "__personal__";
/** Explicit internal tenant/user markers — only when scopeKind is "internal". */
export const AUTHORITATIVE_STOP_INTERNAL_TENANT = "__internal__";
export const AUTHORITATIVE_STOP_INTERNAL_USER = "__internal__";

export type AuthoritativeTaskStopScopeKind = "managed" | "personal" | "internal";

/** Trusted scope dimensions that must bind with taskId — never taskId alone. */
export type AuthoritativeTaskStopScope = {
  kind: AuthoritativeTaskStopScopeKind;
  /** Trusted tenant id (managed) or explicit personal/internal marker. */
  tenantId: string;
  /** Trusted user id (managed/personal) or explicit internal marker. */
  userId: string;
  /** Canonical trusted session key — required for every kind. */
  sessionKey: string;
};

export type AuthoritativeTaskStopEntry = AuthoritativeTaskStopScope & {
  taskId: string;
  stoppedAtMs: number;
  reason?: string;
};

export type AuthoritativeTaskStopScopeInput = {
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  /**
   * Explicit scope kind. When omitted:
   * - non-empty real tenantId → managed
   * - else non-empty userId → personal
   * - else → refuse (null); never silently coerce blank identity to ""
   * Pass `internal` explicitly for tests / ACP / non-WS callers.
   */
  scopeKind?: AuthoritativeTaskStopScopeKind;
};

export type AuthoritativeTaskStopQueryResult =
  | { state: "active" }
  | { state: "inactive" }
  | { state: "unverifiable"; reason: "incomplete_scope" | "missing_task_id" };

/**
 * Process-local authoritative stop registry.
 * Key = tenantId + userId + sessionKey + taskId (see {@link authoritativeStopRegistryKey}).
 * NOT durable across gateway restart / multi-host.
 */
const authoritativeTaskStops = new Map<string, AuthoritativeTaskStopEntry>();

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRealManagedTenantId(tenantId: string): boolean {
  return (
    tenantId !== AUTHORITATIVE_STOP_PERSONAL_TENANT &&
    tenantId !== AUTHORITATIVE_STOP_INTERNAL_TENANT
  );
}

/**
 * Resolve trusted identity dimensions (without sessionKey).
 * Returns null when identity is incomplete for the resolved kind —
 * never silently coerces missing tenant/user to empty string.
 */
export function resolveAuthoritativeTaskStopIdentity(
  params: Omit<AuthoritativeTaskStopScopeInput, "sessionKey">,
): { kind: AuthoritativeTaskStopScopeKind; tenantId: string; userId: string } | null {
  const rawTenant = trimOrNull(params.tenantId);
  const rawUser = trimOrNull(params.userId);
  const explicitKind = params.scopeKind;

  let kind: AuthoritativeTaskStopScopeKind | null = explicitKind ?? null;
  if (!kind) {
    if (rawTenant && isRealManagedTenantId(rawTenant)) {
      kind = "managed";
    } else if (rawUser) {
      kind = "personal";
    } else {
      return null;
    }
  }

  if (kind === "managed") {
    if (!rawTenant || !isRealManagedTenantId(rawTenant) || !rawUser) {
      return null;
    }
    return { kind, tenantId: rawTenant, userId: rawUser };
  }

  if (kind === "personal") {
    if (!rawUser) {
      return null;
    }
    // Personal never stores silent ""; use explicit marker. A real tenant with
    // explicit personal kind is promoted to managed (same identity requirements).
    if (rawTenant && isRealManagedTenantId(rawTenant)) {
      return { kind: "managed", tenantId: rawTenant, userId: rawUser };
    }
    return {
      kind: "personal",
      tenantId: AUTHORITATIVE_STOP_PERSONAL_TENANT,
      userId: rawUser,
    };
  }

  // internal — only when explicitly requested; never inferred from blanks.
  if (explicitKind !== "internal") {
    return null;
  }
  return {
    kind: "internal",
    tenantId: AUTHORITATIVE_STOP_INTERNAL_TENANT,
    userId: rawUser ?? AUTHORITATIVE_STOP_INTERNAL_USER,
  };
}

/**
 * Build a trusted stop scope. Incomplete identity or missing sessionKey → null
 * (callers must NOT fall back to taskId-only or coerce blanks to "").
 */
export function resolveAuthoritativeTaskStopScope(
  params: AuthoritativeTaskStopScopeInput,
): AuthoritativeTaskStopScope | null {
  const sessionKey = trimOrNull(params.sessionKey);
  if (!sessionKey) {
    return null;
  }
  const identity = resolveAuthoritativeTaskStopIdentity(params);
  if (!identity) {
    return null;
  }
  return {
    kind: identity.kind,
    tenantId: identity.tenantId,
    userId: identity.userId,
    sessionKey,
  };
}

/** Stable Map key — all scope dimensions always present; never taskId alone. */
export function authoritativeStopRegistryKey(
  scope: AuthoritativeTaskStopScope,
  taskId: string,
): string {
  return `k:${scope.kind}\0t:${scope.tenantId}\0u:${scope.userId}\0s:${scope.sessionKey}\0task:${taskId}`;
}

export function resetAuthoritativeTaskStopsForTest(): void {
  authoritativeTaskStops.clear();
}

export function recordAuthoritativeTaskStop(
  params: AuthoritativeTaskStopScopeInput & {
    taskId: string;
    reason?: string;
    nowMs?: number;
  },
): AuthoritativeTaskStopEntry | null {
  const taskId = trimOrNull(params.taskId);
  const scope = resolveAuthoritativeTaskStopScope(params);
  // Missing scope or taskId — refuse. Do NOT fall back to global taskId keying.
  if (!taskId || !scope) {
    return null;
  }
  const entry: AuthoritativeTaskStopEntry = {
    ...scope,
    taskId,
    stoppedAtMs: params.nowMs ?? Date.now(),
    ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
  };
  authoritativeTaskStops.set(authoritativeStopRegistryKey(scope, taskId), entry);
  return entry;
}

export function clearAuthoritativeTaskStop(
  params: AuthoritativeTaskStopScopeInput & { taskId: string },
): boolean {
  const taskId = trimOrNull(params.taskId);
  const scope = resolveAuthoritativeTaskStopScope(params);
  // Missing scope — refuse. Do NOT clear every session that shares this taskId.
  if (!taskId || !scope) {
    return false;
  }
  return authoritativeTaskStops.delete(authoritativeStopRegistryKey(scope, taskId));
}

/**
 * Query authoritative stop. Incomplete scope / missing taskId → `unverifiable`
 * (resume must treat this as blocked — never as "not stopped").
 */
export function queryAuthoritativeTaskStop(
  params: AuthoritativeTaskStopScopeInput & {
    taskId: string;
    /** Optional external store for tests. */
    store?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
  },
): AuthoritativeTaskStopQueryResult {
  const taskId = trimOrNull(params.taskId);
  if (!taskId) {
    return { state: "unverifiable", reason: "missing_task_id" };
  }
  const scope = resolveAuthoritativeTaskStopScope(params);
  if (!scope) {
    return { state: "unverifiable", reason: "incomplete_scope" };
  }
  const store = params.store ?? authoritativeTaskStops;
  return store.has(authoritativeStopRegistryKey(scope, taskId))
    ? { state: "active" }
    : { state: "inactive" };
}

/**
 * True only when a stop record is actively present under a complete scope.
 * Incomplete scope → false (not active). Resume paths must use
 * {@link queryAuthoritativeTaskStop} / {@link buildResumeTaskStopActive} so
 * unverifiable identity fails closed instead of meaning "not stopped".
 */
export function isAuthoritativeTaskStopActive(
  params: AuthoritativeTaskStopScopeInput & {
    taskId: string;
    store?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
  },
): boolean {
  return queryAuthoritativeTaskStop(params).state === "active";
}

/**
 * True when stop should block resume.
 *
 * Prefer authoritative stop by trusted scope + `taskId` when provided. Live
 * aborted controllers are only a secondary signal (they disappear after
 * abortChatRun deletes them). Missing scope never falls back to taskId-only.
 */
export function sessionStopBarrierActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
  /** When set, query authoritative stop for this original taskId first. */
  taskId?: string;
  tenantId?: string | null;
  userId?: string | null;
  scopeKind?: AuthoritativeTaskStopScopeKind;
  /** Optional external store; defaults to the module registry. */
  authoritativeStops?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
}): boolean {
  const taskId = trimOrNull(params.taskId) ?? "";
  if (taskId) {
    const store = params.authoritativeStops ?? authoritativeTaskStops;
    const sessionKeyList: string[] = [];
    for (const rawKey of params.sessionKeys) {
      const trimmed = trimOrNull(rawKey);
      if (trimmed) {
        sessionKeyList.push(trimmed);
      }
    }

    // Identity incomplete → unverifiable → fail closed (never "not stopped").
    const identity = resolveAuthoritativeTaskStopIdentity({
      tenantId: params.tenantId,
      userId: params.userId,
      scopeKind: params.scopeKind,
    });
    if (!identity || sessionKeyList.length === 0) {
      return true;
    }

    let sawCompleteInactive = false;
    for (const sessionKey of sessionKeyList) {
      const result = queryAuthoritativeTaskStop({
        taskId,
        tenantId: params.tenantId,
        userId: params.userId,
        scopeKind: params.scopeKind,
        sessionKey,
        store,
      });
      if (result.state === "active" || result.state === "unverifiable") {
        return true;
      }
      if (result.state === "inactive") {
        sawCompleteInactive = true;
      }
    }
    // Complete scoped miss: do NOT fall back to a global taskId lookup.
    void sawCompleteInactive;
  }

  const keys = new Set<string>();
  for (const key of params.sessionKeys) {
    const trimmed = trimOrNull(key);
    if (trimmed) {
      keys.add(trimmed);
    }
  }
  if (keys.size === 0) {
    return false;
  }
  for (const entry of params.chatAbortControllers.values()) {
    const sessionKey = trimOrNull(entry.sessionKey);
    if (!sessionKey || !keys.has(sessionKey)) {
      continue;
    }
    if (entry.controller?.signal?.aborted === true) {
      return true;
    }
  }
  return false;
}

/**
 * Build the resume-time per-taskId stop predicate used by chat.send.
 * Combines scoped authoritative task stops with any still-live aborted controllers.
 * Unverifiable identity fails closed (returns true → deny resume).
 */
export function buildResumeTaskStopActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
  tenantId?: string | null;
  userId?: string | null;
  scopeKind?: AuthoritativeTaskStopScopeKind;
}): (taskId: string) => boolean {
  const sessionKeys = [...params.sessionKeys];
  const controllers = params.chatAbortControllers;
  const tenantId = params.tenantId;
  const userId = params.userId;
  const scopeKind = params.scopeKind;
  return (taskId: string) =>
    sessionStopBarrierActive({
      sessionKeys,
      chatAbortControllers: controllers,
      taskId,
      tenantId,
      userId,
      scopeKind,
    });
}

/**
 * Production entry classifier for authoritative stop identity.
 *
 * Mode comes from the trusted security profile / auth deployment context
 * (`resolveSecurityProfile` → managed_enterprise | personal_local) — NEVER from
 * whether a tenant id happens to be present on the client.
 *
 * - managed_enterprise → scopeKind "managed" (missing tenant stays managed →
 *   unverifiable → refuse resume)
 * - personal_local → scopeKind "personal"
 * - bare missing client does NOT auto-qualify as "internal" (internal is only
 *   via explicit scopeKind on lower-level APIs)
 */
export function authoritativeStopIdentityFromClient(
  client:
    | {
        sessionEnterpriseId?: string;
        sessionTenantId?: string;
        platformUserId?: string;
        user?: string;
      }
    | null
    | undefined,
  options?: {
    /** Trusted server config; defaults to loadConfig(). Never from client hints. */
    cfg?: OpenBotConfig;
    env?: NodeJS.ProcessEnv;
  },
): {
  scopeKind: AuthoritativeTaskStopScopeKind;
  tenantId: string | null;
  userId: string | null;
} {
  const cfg = options?.cfg ?? loadConfig();
  const env = options?.env ?? process.env;
  const profile = resolveSecurityProfile(cfg, env);
  const scopeKind: AuthoritativeTaskStopScopeKind =
    profile.profile === "managed_enterprise" ? "managed" : "personal";

  if (!client) {
    return { scopeKind, tenantId: null, userId: null };
  }
  const tenantRaw = (client.sessionEnterpriseId ?? client.sessionTenantId)?.trim() || null;
  const userRaw = (client.platformUserId ?? client.user)?.trim() || null;
  return { scopeKind, tenantId: tenantRaw, userId: userRaw };
}

export function clientIdentityOkForResume(
  client:
    | {
        user?: string;
        platformUserId?: string;
        pairedDeviceId?: string;
        sessionMembershipId?: string;
        connect?: { role?: string };
      }
    | null
    | undefined,
): boolean {
  if (!client) {
    // Non-WS / internal callers (tests, ACP) — do not fail-close on identity alone.
    return true;
  }
  if (typeof client.user === "string" && client.user.trim()) {
    return true;
  }
  if (typeof client.platformUserId === "string" && client.platformUserId.trim()) {
    return true;
  }
  if (typeof client.pairedDeviceId === "string" && client.pairedDeviceId.trim()) {
    return true;
  }
  if (typeof client.sessionMembershipId === "string" && client.sessionMembershipId.trim()) {
    return true;
  }
  if (typeof client.connect?.role === "string" && client.connect.role.trim()) {
    return true;
  }
  return false;
}

/**
 * Production chat.send entry: always inject a live ResumeParkedRecheck so the
 * resume path cannot bypass auth/stop revalidation.
 */
export function applyChatFocusSwitchGateWithResumeRecheck(params: {
  sessionFile?: string;
  incomingText: string;
  nowMs?: number;
  workspacePaths?: string[];
  proceed?: boolean;
  recheckInputs: ResolveResumeParkedRecheckParams;
}): FocusSwitchGateDecision {
  return applyFocusSwitchGate({
    sessionFile: params.sessionFile,
    incomingText: params.incomingText,
    nowMs: params.nowMs,
    workspacePaths: params.workspacePaths,
    proceed: params.proceed,
    recheck: resolveResumeParkedRecheck(params.recheckInputs),
  });
}
