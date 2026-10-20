import { randomBytes, randomUUID } from "node:crypto";
import type { EnterpriseSocialOAuthProviderSlug } from "./social-providers.js";

export type EnterpriseSocialOAuthSessionStatus = "pending" | "completed" | "expired";

export type EnterpriseSocialOAuthSession = {
  sessionId: string;
  tenantId: string;
  providerSlug: EnterpriseSocialOAuthProviderSlug;
  state: string;
  seatId?: string;
  createdByEmployeeId?: string;
  displayName?: string;
  codeVerifier?: string;
  status: EnterpriseSocialOAuthSessionStatus;
  createdAt: string;
  expiresAt: string;
  externalAccountId?: string;
  credentialBindingId?: string;
};

const sessions = new Map<string, EnterpriseSocialOAuthSession>();
const stateIndex = new Map<string, string>();

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function createEnterpriseSocialOAuthSession(params: {
  tenantId: string;
  providerSlug: EnterpriseSocialOAuthProviderSlug;
  seatId?: string;
  createdByEmployeeId?: string;
  displayName?: string;
  codeVerifier?: string;
  nowIso: string;
}): EnterpriseSocialOAuthSession {
  const session: EnterpriseSocialOAuthSession = {
    sessionId: randomUUID(),
    tenantId: params.tenantId,
    providerSlug: params.providerSlug,
    state: randomBytes(24).toString("hex"),
    seatId: params.seatId?.trim() || undefined,
    createdByEmployeeId: params.createdByEmployeeId?.trim() || undefined,
    displayName: params.displayName?.trim() || undefined,
    codeVerifier: params.codeVerifier?.trim() || undefined,
    status: "pending",
    createdAt: params.nowIso,
    expiresAt: new Date(new Date(params.nowIso).getTime() + DEFAULT_TTL_MS).toISOString(),
  };
  sessions.set(session.sessionId, session);
  stateIndex.set(session.state, session.sessionId);
  return session;
}

export function getEnterpriseSocialOAuthSessionByState(
  state: string,
): EnterpriseSocialOAuthSession | null {
  const sessionId = stateIndex.get(state.trim());
  if (!sessionId) {
    return null;
  }
  return sessions.get(sessionId) ?? null;
}

export function completeEnterpriseSocialOAuthSession(params: {
  session: EnterpriseSocialOAuthSession;
  externalAccountId: string;
  credentialBindingId: string;
  nowIso: string;
}): EnterpriseSocialOAuthSession {
  params.session.status = "completed";
  params.session.externalAccountId = params.externalAccountId;
  params.session.credentialBindingId = params.credentialBindingId;
  return params.session;
}

export function expireEnterpriseSocialOAuthSessions(nowIso: string): void {
  for (const session of sessions.values()) {
    if (session.status === "pending" && session.expiresAt <= nowIso) {
      session.status = "expired";
    }
  }
}
