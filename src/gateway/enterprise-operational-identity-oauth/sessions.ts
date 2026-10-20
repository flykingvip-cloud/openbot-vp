import { randomBytes, randomUUID } from "node:crypto";

export type EnterpriseWechatOAuthSessionStatus = "pending" | "completed" | "expired";

export type EnterpriseWechatOAuthSession = {
  sessionId: string;
  tenantId: string;
  state: string;
  seatId?: string;
  createdByEmployeeId?: string;
  displayName?: string;
  /** 编辑已有身份时写入，OAuth 回调更新该身份凭证而非新建。 */
  targetIdentityId?: string;
  targetCredentialBindingId?: string;
  status: EnterpriseWechatOAuthSessionStatus;
  createdAt: string;
  expiresAt: string;
  authorizerAppId?: string;
};

const sessions = new Map<string, EnterpriseWechatOAuthSession>();
const stateIndex = new Map<string, string>();

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function createEnterpriseWechatOAuthSession(params: {
  tenantId: string;
  seatId?: string;
  createdByEmployeeId?: string;
  displayName?: string;
  targetIdentityId?: string;
  targetCredentialBindingId?: string;
  nowIso: string;
}): EnterpriseWechatOAuthSession {
  const session: EnterpriseWechatOAuthSession = {
    sessionId: randomUUID(),
    tenantId: params.tenantId,
    state: randomBytes(24).toString("hex"),
    seatId: params.seatId?.trim() || undefined,
    createdByEmployeeId: params.createdByEmployeeId?.trim() || undefined,
    displayName: params.displayName?.trim() || undefined,
    targetIdentityId: params.targetIdentityId?.trim() || undefined,
    targetCredentialBindingId: params.targetCredentialBindingId?.trim() || undefined,
    status: "pending",
    createdAt: params.nowIso,
    expiresAt: new Date(new Date(params.nowIso).getTime() + DEFAULT_TTL_MS).toISOString(),
  };
  sessions.set(session.sessionId, session);
  stateIndex.set(session.state, session.sessionId);
  return session;
}

export function getEnterpriseWechatOAuthSessionByState(
  state: string,
): EnterpriseWechatOAuthSession | null {
  const sessionId = stateIndex.get(state.trim());
  if (!sessionId) {
    return null;
  }
  return sessions.get(sessionId) ?? null;
}

export function getEnterpriseWechatOAuthSessionById(
  sessionId: string,
): EnterpriseWechatOAuthSession | null {
  return sessions.get(sessionId.trim()) ?? null;
}

export function completeEnterpriseWechatOAuthSession(params: {
  session: EnterpriseWechatOAuthSession;
  authorizerAppId: string;
  nowIso: string;
}): EnterpriseWechatOAuthSession {
  params.session.status = "completed";
  params.session.authorizerAppId = params.authorizerAppId;
  return params.session;
}

export function expireEnterpriseWechatOAuthSessions(nowIso: string): void {
  for (const session of sessions.values()) {
    if (session.status === "pending" && session.expiresAt <= nowIso) {
      session.status = "expired";
    }
  }
}
