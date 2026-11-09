import { GatewayRequestError, type GatewayBrowserClient } from "../gateway.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import { applyPersonalEmailPresetToEditor } from "../wiring/personal-email-presets.ts";

const WECHAT_PERSONAL_OFFLINE_HINT =
  "本机微信通道未连接。请先打开本机 OpenBot 桌面端，再点重新检测。";
const WECHAT_PERSONAL_NOT_LOGGED_IN_HINT =
  "本机通道已接通，但还没有可用的微信登录态。请先打开并登录本机微信，再点重新检测。";

function formatWechatPersonalDetectedLabel(wxid: string, nickname?: string | null): string {
  const id = wxid.trim();
  const name = nickname?.trim();
  if (name && name !== id) {
    return `已检测到本机微信：${name} / ${id}`;
  }
  return `已检测到本机微信：${id}`;
}

function wechatPersonalBindErrorMessage(error: unknown): string {
  if (error instanceof GatewayRequestError) {
    const details = error.details;
    const rawCode =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as { code?: unknown }).code
        : undefined;
    const detailCode = typeof rawCode === "string" ? rawCode : "";
    if (
      detailCode === "USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE" ||
      /offline|unreachable/i.test(error.message)
    ) {
      return WECHAT_PERSONAL_OFFLINE_HINT;
    }
    if (detailCode === "USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN") {
      return WECHAT_PERSONAL_NOT_LOGGED_IN_HINT;
    }
    if (detailCode === "USER_IDENTITY_WXID_REQUIRED") {
      return "本机微信已连接但未返回账号标识，无法绑定。";
    }
    if (detailCode === "USER_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND") {
      return error.message || "该微信账号已经绑定过个人身份。";
    }
    if (
      detailCode === "NATIVE_WECHAT_SESSION_REQUIRED" ||
      /NATIVE_WECHAT_SESSION_REQUIRED|501/.test(error.message)
    ) {
      return "当前通道使用本机已有微信登录态，不能扫码登录。请先在本机微信完成登录后再绑定。";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "绑定本机微信失败。";
}

export type UserOperationalIdentitySummary = {
  identityId: string;
  provider: string;
  providerLabel: string;
  displayName: string;
  externalAccountId?: string;
  status: "active" | "expired" | "reauth_required" | "revoked";
  grantCount: number;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  enterpriseIm?: {
    channel: "feishu";
    authorizationLevel: "identity_only" | "authorized";
    localCredentialsDeleted: boolean;
    platformRevokeRecorded: boolean;
    statusLabel: string;
    userGrantedScopes: string[];
    platformUserId: string;
    platformEnterpriseId: string;
    accountId: string;
  };
};

export type UserOperationalIdentityProviderCatalogEntry = {
  provider: string;
  label: string;
  category: "developer" | "communication" | "social" | "official";
  rolloutTier: "pilot" | "deferred";
  registrationReady: boolean;
  authMode?: "oauth" | "manual" | "qr_channel";
  manualKind?: "wechat_oa" | "social_account" | "smtp" | null;
  operationalActions: Array<{ action: string; label: string }>;
  reauthHint: string;
  degradedHint: string | null;
};

export type UserOperationalIdentityGrantSummary = {
  grantId: string;
  identityId: string;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  allowedActions: string[];
  grantMode: "auto" | "explicit";
  status: "active" | "revoked";
  confirmedAt?: string;
  grantVersion?: number;
  expiresAt?: string;
  confirmMode?: "read_only" | "draft_then_confirm" | "limited_auto";
  resourceScope?: { groups: string[]; docs: string[]; calendars: string[] };
};

export type UserOperationalIdentityUsageSummary = {
  headline: string;
  excerpt?: string;
  recipients?: string[];
  subject?: string;
  wordCount?: number;
  attachmentCount?: number;
  repository?: string;
  issueNumber?: number;
  publishKind?: "draft" | "publish" | "broadcast";
  tags?: string[];
  externalId?: string;
};

export type UserOperationalIdentityUsageMetrics = {
  readCount?: number;
  shareCount?: number;
  commentCount?: number;
  likeCount?: number;
  followerCount?: number;
  refreshedAt?: string;
};

export type UserOperationalIdentityUsageEventSummary = {
  eventId: string;
  agentId: string;
  identityId: string;
  provider: string;
  action: string;
  result: "allowed" | "denied" | "reauth_required";
  denialCode?: string;
  createdAt: string;
  summary?: UserOperationalIdentityUsageSummary;
  metrics?: UserOperationalIdentityUsageMetrics;
};

export type UserOperationalIdentityUsageRange = "7d" | "30d" | "90d" | "all";

export type UserOperationalIdentityBindingRequestSummary = {
  requestId: string;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  provider: string;
  requestedAction: string;
  status: "pending" | "completed" | "cancelled" | "expired";
  sessionKey?: string | null;
  createdAt: string;
  expiresAt: string;
};

export type UserOperationalIdentityContinuationSummary = {
  continuationId: string;
  continuationToken: string;
  bindingRequestId?: string;
  sessionKey?: string | null;
  workbenchModule?: string | null;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  provider: string;
  requestedAction: string;
  resumeMessage?: string;
  resumeIntentId?: string;
  requiredProviders: string[];
  completedProviders: string[];
  oauthCompletedProviders: string[];
  status:
    | "pending_binding"
    | "pending_oauth"
    | "ready_to_resume"
    | "resumed"
    | "expired"
    | "cancelled";
  autoResume: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type UserOperationalIdentityContinuationResumePayload = {
  continuationId: string;
  continuationToken: string;
  sessionKey?: string | null;
  workbenchModule?: string | null;
  agentId: string;
  resumeMessage: string;
  autoResume: boolean;
  resumeIntentId?: string;
};

/**
 * 企业运营身份库中、对某机器人（agentId）可用的身份条目（只读）。
 * 由企业管理员通过席位/Agent 策略授权，员工侧仅查看，不自助授权。
 */
export type EnterpriseAgentIdentityEntry = {
  identityId: string;
  displayName: string;
  provider: string;
  providerLabel: string;
  status: string;
  allowedActions: string[];
  /** 该员工是否已为当前机器人启用此企业身份（员工域授权）。 */
  enrolled: boolean;
};

export type UserOperationalIdentitySnapshot = {
  identities: UserOperationalIdentitySummary[];
  grants: UserOperationalIdentityGrantSummary[];
  usageHistory: UserOperationalIdentityUsageEventSummary[];
  providerCatalog: UserOperationalIdentityProviderCatalogEntry[];
  pendingBindingRequests: UserOperationalIdentityBindingRequestSummary[];
  pendingContinuations?: UserOperationalIdentityContinuationSummary[];
  // 岗位级企业身份目录（由企业策略授权，与具体机器人无关）。
  enterpriseSeatIdentities?: EnterpriseAgentIdentityEntry[];
  /** identityId → 已绑定到旗下机器人的 agentId 列表（员工 enrollment 汇总）。 */
  enterpriseEnrolledAgentIdsByIdentity?: Record<string, string[]>;
  /** Gateway egress IP for WeChat OA IP whitelist configuration. */
  gatewayEgressIp?: string | null;
  /** True when gateway process can resolve OPENBOT_SMTP_* platform mail. */
  platformSmtpConfigured?: boolean;
  /** True when xiaohongshu-mcp sidecar is reachable from the gateway. */
  xiaohongshuApiConfigured?: boolean;
  feishuEmployeeChannel?: {
    accountId: string;
    employeeUiHint: "enterprise_not_open" | "waiting_admin_scopes" | "app_can_attempt";
    loginEnabled: boolean;
    statusLabel: string;
    platformEnterpriseId: string | null;
    childExecutionBlocked: boolean;
  } | null;
  // 按 agentId 缓存的企业运营身份库可用条目（懒加载，展开机器人授权面板时填充）。
  enterpriseAccessByAgent?: Record<string, EnterpriseAgentIdentityEntry[]>;
};

/** Left-nav key for personal authorization split: add:<provider> | bound | grants */
export type UserOperationalIdentityNav = "bound" | "grants" | `add:${string}`;

export function parseUserOperationalIdentityAddProvider(
  nav: string | null | undefined,
): string | null {
  if (!nav?.startsWith("add:")) {
    return null;
  }
  const provider = nav.slice("add:".length).trim();
  return provider || null;
}

export function buildUserOperationalIdentityAddNav(provider: string): UserOperationalIdentityNav {
  return `add:${provider.trim()}`;
}

export type UserOperationalIdentityHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  userOperationalIdentities: UserOperationalIdentitySnapshot | null;
  userOperationalIdentityBusy: boolean;
  userOperationalIdentityError: string | null;
  userOperationalIdentityNotice: string | null;
  userOperationalIdentityNav: UserOperationalIdentityNav;
  userOperationalIdentityUsageRange?: UserOperationalIdentityUsageRange;
  userOperationalIdentityUsageEventId?: string | null;
  userOperationalIdentityEditorOpen: boolean;
  userOperationalIdentityEditorProvider: string;
  userOperationalIdentityEditorDisplayName: string;
  userOperationalIdentityEditorCredentialHandleId: string;
  userOperationalIdentityEditorAppId: string;
  userOperationalIdentityEditorAppSecret: string;
  userOperationalIdentityEditorSmtpHost: string;
  userOperationalIdentityEditorSmtpPort: string;
  userOperationalIdentityEditorSmtpUser: string;
  userOperationalIdentityEditorImapHost: string;
  userOperationalIdentityEditorImapPort: string;
  userOperationalIdentityEditorImapUser: string;
  userOperationalIdentityEditorUsePlatformSmtp: boolean;
  userOperationalIdentityEditorPersonalEmailPresetNote?: string | null;
  userOperationalIdentityEditorIdentityId: string | null;
  wechatPersonalQrWorkerOnline: boolean | null;
  wechatPersonalQrStatus: "idle" | "offline" | "scanning" | "logged_in" | "error";
  wechatPersonalQrDataUrl: string | null;
  wechatPersonalQrMessage: string | null;
  wechatPersonalQrWxid: string | null;
  userOperationalIdentityEditorGrantAgentId?: string | null;
  userOperationalIdentityOAuthSessionId: string | null;
  userOperationalIdentityReturnSessionKey: string | null;
  userOperationalIdentityReturnModule: string | null;
  userOperationalIdentityContinuationToken: string | null;
  userOperationalIdentityContinuationNotice: string | null;
};

type ListResponse = {
  ownerId: string;
  identities?: UserOperationalIdentitySummary[];
  grants?: UserOperationalIdentityGrantSummary[];
  usageHistory?: UserOperationalIdentityUsageEventSummary[];
  providerCatalog?: UserOperationalIdentityProviderCatalogEntry[];
  gatewayEgressIp?: string | null;
  platformSmtpConfigured?: boolean;
};

function applySnapshot(
  host: UserOperationalIdentityHost,
  payload: ListResponse,
  pendingBindingRequests: UserOperationalIdentityBindingRequestSummary[] = [],
  pendingContinuations: UserOperationalIdentityContinuationSummary[] = [],
) {
  // Preserve any already-loaded enterprise access cache across personal-identity
  // refreshes so expanding a robot panel does not have to re-fetch every time.
  const enterpriseAccessByAgent = host.userOperationalIdentities?.enterpriseAccessByAgent ?? {};
  const enterpriseSeatIdentities = host.userOperationalIdentities?.enterpriseSeatIdentities;
  const enterpriseEnrolledAgentIdsByIdentity =
    host.userOperationalIdentities?.enterpriseEnrolledAgentIdsByIdentity;
  host.userOperationalIdentities = {
    identities: payload.identities ?? [],
    grants: payload.grants ?? [],
    usageHistory: payload.usageHistory ?? [],
    providerCatalog: payload.providerCatalog ?? [],
    gatewayEgressIp: payload.gatewayEgressIp ?? null,
    platformSmtpConfigured: Boolean(payload.platformSmtpConfigured),
    pendingBindingRequests,
    pendingContinuations,
    enterpriseAccessByAgent,
    ...(enterpriseSeatIdentities ? { enterpriseSeatIdentities } : {}),
    ...(enterpriseEnrolledAgentIdsByIdentity ? { enterpriseEnrolledAgentIdsByIdentity } : {}),
  };
}

/**
 * 懒加载某机器人在企业运营身份库中的可用身份（只读）。结果合并进当前快照的
 * `enterpriseAccessByAgent[agentId]`，供机器人授权面板展示「企业身份库」分组。
 */
export async function loadRobotEnterpriseIdentityAccess(
  host: UserOperationalIdentityHost,
  agentId: string,
): Promise<void> {
  const trimmedAgentId = agentId.trim();
  if (!host.client || !host.connected || !trimmedAgentId) {
    return;
  }
  // Ensure the personal snapshot exists so the panel can show personal identities
  // and so we have a snapshot object to merge enterprise access into. On surfaces
  // that don't preload it (e.g. the robots settings tab) it may still be null.
  if (!host.userOperationalIdentities) {
    await loadUserOperationalIdentities(host);
  }
  try {
    const result = await host.client.request<{ entries?: EnterpriseAgentIdentityEntry[] }>(
      "enterprise-operational-identity.access.list-for-seat-agent",
      { agentId: trimmedAgentId },
    );
    const enrollmentResult = await host.client
      .request<{ identityIds?: string[] }>("enterprise-operational-identity.employee.enrollments", {
        agentId: trimmedAgentId,
      })
      .catch(() => null);
    const enrolledIds = new Set(enrollmentResult?.identityIds ?? []);
    const entries = (result?.entries ?? []).map((entry) => ({
      ...entry,
      enrolled: enrolledIds.has(entry.identityId),
    }));
    // Merge into the snapshot; synthesize an empty one if the personal load failed
    // so the enterprise library still renders independently.
    const snapshot: UserOperationalIdentitySnapshot = host.userOperationalIdentities ?? {
      identities: [],
      grants: [],
      usageHistory: [],
      providerCatalog: [],
      pendingBindingRequests: [],
    };
    host.userOperationalIdentities = {
      ...snapshot,
      enterpriseAccessByAgent: {
        ...snapshot.enterpriseAccessByAgent,
        [trimmedAgentId]: entries,
      },
    };
  } catch {
    // Enterprise library is governed server-side; on failure leave the group empty.
  }
}

/** 批量同步岗位级企业身份目录 + 各机器人 enrollment 汇总（个人设置「企业身份」Tab）。 */
export async function syncEmployeeEnterpriseIdentityAccess(
  host: UserOperationalIdentityHost,
  agentIds: string[],
): Promise<void> {
  const uniqueAgentIds = [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))];
  if (!host.client || !host.connected) {
    return;
  }
  if (!host.userOperationalIdentities) {
    await loadUserOperationalIdentities(host);
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  try {
    const seatResult = await host.client.request<{ entries?: EnterpriseAgentIdentityEntry[] }>(
      "enterprise-operational-identity.access.list-for-seat",
      {},
    );
    const seatEntries = seatResult?.entries ?? [];
    const enrolledAgentIdsByIdentity: Record<string, string[]> = {};
    await Promise.all(
      uniqueAgentIds.map(async (agentId) => {
        const enrollmentResult = await host
          .client!.request<{ identityIds?: string[] }>(
            "enterprise-operational-identity.employee.enrollments",
            { agentId },
          )
          .catch(() => null);
        for (const identityId of enrollmentResult?.identityIds ?? []) {
          const list = enrolledAgentIdsByIdentity[identityId] ?? [];
          if (!list.includes(agentId)) {
            list.push(agentId);
          }
          enrolledAgentIdsByIdentity[identityId] = list;
        }
        await loadRobotEnterpriseIdentityAccess(host, agentId);
      }),
    );
    const snapshot: UserOperationalIdentitySnapshot = host.userOperationalIdentities ?? {
      identities: [],
      grants: [],
      usageHistory: [],
      providerCatalog: [],
      pendingBindingRequests: [],
    };
    host.userOperationalIdentities = {
      ...snapshot,
      enterpriseSeatIdentities: seatEntries.map((entry) => ({
        ...entry,
        enrolled: (enrolledAgentIdsByIdentity[entry.identityId] ?? []).length > 0,
      })),
      enterpriseEnrolledAgentIdsByIdentity: enrolledAgentIdsByIdentity,
      enterpriseAccessByAgent: snapshot.enterpriseAccessByAgent ?? {},
    };
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

/**
 * 按身份维度同步机器人绑定：将某企业身份绑定到员工选定的旗下机器人集合。
 */
export async function applyEnterpriseIdentityRobotBindings(
  host: UserOperationalIdentityHost,
  input: { identityId: string; agentIds: string[]; ownedAgentIds: string[] },
): Promise<boolean> {
  const identityId = input.identityId.trim();
  if (!host.client || !host.connected || !identityId) {
    return false;
  }
  const owned = new Set(input.ownedAgentIds.map((id) => id.trim()).filter(Boolean));
  const desired = new Set(input.agentIds.map((id) => id.trim()).filter((id) => owned.has(id)));
  const currentByIdentity =
    host.userOperationalIdentities?.enterpriseEnrolledAgentIdsByIdentity?.[identityId] ?? [];
  const current = new Set(currentByIdentity.filter((id) => owned.has(id)));
  const toAdd = [...desired].filter((agentId) => !current.has(agentId));
  const toRemove = [...current].filter((agentId) => !desired.has(agentId));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return true;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    for (const agentId of toAdd) {
      await host.client.request("enterprise-operational-identity.employee.authorize", {
        agentId,
        identityId,
      });
    }
    for (const agentId of toRemove) {
      await host.client.request("enterprise-operational-identity.employee.revoke", {
        agentId,
        identityId,
      });
    }
    await syncEmployeeEnterpriseIdentityAccess(host, [...owned]);
    const displayName =
      host.userOperationalIdentities?.enterpriseSeatIdentities?.find(
        (entry) => entry.identityId === identityId,
      )?.displayName ?? identityId;
    host.userOperationalIdentityNotice = `已更新「${displayName}」的机器人绑定。`;
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "更新企业身份机器人绑定失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

/**
 * 员工域企业身份授权：按「期望启用集合」同步某机器人的企业身份 enrollment。
 * 对比当前已启用：新增的 → authorize；取消的 → revoke。受企业策略边界约束（服务端校验）。
 */
export async function applyRobotEnterpriseIdentityEnrollments(
  host: UserOperationalIdentityHost,
  input: { agentId: string; desiredIdentityIds: string[] },
): Promise<boolean> {
  const agentId = input.agentId.trim();
  if (!host.client || !host.connected || !agentId) {
    return false;
  }
  const current = host.userOperationalIdentities?.enterpriseAccessByAgent?.[agentId] ?? [];
  const currentEnrolled = new Set(
    current.filter((entry) => entry.enrolled).map((entry) => entry.identityId),
  );
  const desired = new Set(input.desiredIdentityIds);
  const toAdd = [...desired].filter((identityId) => !currentEnrolled.has(identityId));
  const toRemove = [...currentEnrolled].filter((identityId) => !desired.has(identityId));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return true;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    for (const identityId of toAdd) {
      await host.client.request("enterprise-operational-identity.employee.authorize", {
        agentId,
        identityId,
      });
    }
    for (const identityId of toRemove) {
      await host.client.request("enterprise-operational-identity.employee.revoke", {
        agentId,
        identityId,
      });
    }
    await loadRobotEnterpriseIdentityAccess(host, agentId);
    host.userOperationalIdentityNotice = `企业身份授权已更新（新增 ${toAdd.length}、取消 ${toRemove.length}）。`;
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "更新企业身份授权失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function loadUserOperationalIdentities(
  host: UserOperationalIdentityHost,
): Promise<UserOperationalIdentitySnapshot | null> {
  if (!host.client || !host.connected) {
    host.userOperationalIdentityError = "网关未连接，暂无法加载我的运营身份。";
    return null;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  try {
    const [listResult, pendingResult, continuationResult] = await Promise.all([
      host.client.request<ListResponse>("user-operational-identity.list"),
      host.client.request<{ requests?: UserOperationalIdentityBindingRequestSummary[] }>(
        "user-operational-identity.binding-request.list-pending",
      ),
      host.client.request<{ continuations?: UserOperationalIdentityContinuationSummary[] }>(
        "user-operational-identity.continuation.list-pending",
      ),
    ]);
    applySnapshot(
      host,
      listResult ?? {},
      pendingResult?.requests ?? [],
      continuationResult?.continuations ?? [],
    );
    return host.userOperationalIdentities;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "加载我的运营身份失败。";
    return null;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function bindUserOperationalIdentityViaOAuth(
  host: UserOperationalIdentityHost,
  input: {
    displayName: string;
    provider: string;
    externalAccountId?: string;
    continuationToken?: string;
    callbackOrigin?: string;
    basePath?: string;
    returnPath?: string;
  },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    const started = await host.client.request<{
      sessionId?: string;
      authorizeUrl?: string | null;
      simulateAllowed?: boolean;
    }>("user-operational-identity.oauth.start", {
      displayName: input.displayName,
      provider: input.provider,
      continuationToken: input.continuationToken,
      callbackOrigin: input.callbackOrigin ?? window.location.origin,
      basePath: input.basePath,
      returnPath: input.returnPath ?? window.location.pathname + window.location.search,
    });
    const sessionId = started?.sessionId?.trim();
    if (!sessionId) {
      host.userOperationalIdentityError = "无法启动 OAuth 绑定。";
      return false;
    }
    host.userOperationalIdentityOAuthSessionId = sessionId;
    if (started?.authorizeUrl) {
      openExternalUrlSafe(started.authorizeUrl);
      host.userOperationalIdentityNotice = "已打开授权页面，完成后会自动返回工作台。";
      const completed = await pollUserOperationalIdentityOAuthSession(host, sessionId);
      if (!completed) {
        return false;
      }
    } else if (started?.simulateAllowed) {
      await host.client.request("user-operational-identity.oauth.simulate-complete", {
        sessionId,
        externalAccountId: input.externalAccountId?.trim() || undefined,
      });
    } else {
      host.userOperationalIdentityError = "当前 Provider 暂不支持 OAuth 绑定。";
      return false;
    }
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice =
      input.provider === "feishu-personal"
        ? "飞书身份已绑定。机器人授权需另行确认，本次不会自动授权。"
        : "运营身份已绑定，可在下方把使用权授给旗下数字人。";
    host.userOperationalIdentityOAuthSessionId = null;
    host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav(input.provider);
    closeUserOperationalIdentityEditor(host);
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "OAuth 绑定运营身份失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

async function pollUserOperationalIdentityOAuthSession(
  host: UserOperationalIdentityHost,
  sessionId: string,
  attempts = 120,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  for (let index = 0; index < attempts; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    try {
      const status = await host.client.request<{
        session?: { status?: string };
      }>("user-operational-identity.oauth.status", { sessionId });
      if (status?.session?.status === "completed") {
        return true;
      }
      if (status?.session?.status === "expired" || status?.session?.status === "cancelled") {
        host.userOperationalIdentityError = "OAuth 会话已过期或已取消。";
        return false;
      }
    } catch {
      // Keep polling until timeout.
    }
  }
  host.userOperationalIdentityError = "等待 OAuth 回调超时，请重试。";
  return false;
}

export async function resumeUserOperationalIdentityOAuthFromReturn(
  host: UserOperationalIdentityHost,
  sessionId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  try {
    const status = await host.client.request<{
      session?: { status?: string };
    }>("user-operational-identity.oauth.status", { sessionId });
    if (status?.session?.status !== "completed") {
      host.userOperationalIdentityError = "OAuth 尚未完成。";
      return false;
    }
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "OAuth 授权已完成，可在下方把使用权授给旗下数字人。";
    const resumedProvider =
      host.userOperationalIdentityEditorProvider?.trim() ||
      host.userOperationalIdentities?.identities?.find((identity) => identity.status === "active")
        ?.provider ||
      "";
    host.userOperationalIdentityNav = resumedProvider
      ? buildUserOperationalIdentityAddNav(resumedProvider)
      : "bound";
    closeUserOperationalIdentityEditor(host);
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "读取 OAuth 结果失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function bindUserOperationalIdentityViaManualCredentials(
  host: UserOperationalIdentityHost,
  input: {
    displayName: string;
    provider: string;
    appId?: string;
    appSecret?: string;
    accountHandle?: string;
    accessToken?: string;
    identityId?: string;
    smtpFrom?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    imapHost?: string;
    imapPort?: string;
    imapUser?: string;
    usePlatformSmtp?: boolean;
  },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.credentials.bind", {
      displayName: input.displayName,
      provider: input.provider,
      appId: input.appId,
      appSecret: input.appSecret,
      accountHandle: input.accountHandle,
      accessToken: input.accessToken,
      identityId: input.identityId,
      smtpFrom: input.smtpFrom,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpUser: input.smtpUser,
      smtpPass: input.smtpPass,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapUser: input.imapUser,
      usePlatformSmtp: input.usePlatformSmtp,
    });
    await loadUserOperationalIdentities(host);
    const catalog = host.userOperationalIdentities?.providerCatalog ?? [];
    const label = catalog.find((entry) => entry.provider === input.provider)?.label ?? "运营身份";
    if (input.provider === "personal-email") {
      host.userOperationalIdentityNotice = input.identityId
        ? `${label}凭证已更新。已授权给「大白管家」，找大白说「帮我查/发/回邮件」；也可在个人设置授权给其他机器人。`
        : `${label}已绑定。已授权给「大白管家」，找大白即可智能收发；个人设置里可继续授权其他机器人。`;
    } else {
      host.userOperationalIdentityNotice = input.identityId
        ? `${label}凭证已更新并通过认证，可在下方把使用权授给旗下数字人。`
        : `${label}已添加并通过认证，可在下方把使用权授给旗下数字人。`;
    }
    host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav(input.provider);
    closeUserOperationalIdentityEditor(host);
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "绑定运营身份失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

function resetWechatPersonalQr(host: UserOperationalIdentityHost) {
  host.wechatPersonalQrWorkerOnline = null;
  host.wechatPersonalQrStatus = "idle";
  host.wechatPersonalQrDataUrl = null;
  host.wechatPersonalQrMessage = null;
  host.wechatPersonalQrWxid = null;
}

export async function recheckWechatPersonalChannel(
  host: UserOperationalIdentityHost,
): Promise<boolean> {
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  try {
    return await probeWechatPersonalQrWorker(host);
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function probeWechatPersonalQrWorker(
  host: UserOperationalIdentityHost,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    host.wechatPersonalQrWorkerOnline = false;
    host.wechatPersonalQrStatus = "offline";
    host.wechatPersonalQrMessage =
      "工作台还没连上 Gateway。请先打开本机 OpenBot 桌面端并确认节点已连接。";
    return false;
  }
  try {
    const probe = await host.client.request<{
      workerOnline?: boolean;
      loggedIn?: boolean;
      wxid?: string;
      nickname?: string;
      error?: string;
    }>("user-operational-identity.wechat-personal.status", {});
    const online = Boolean(probe?.workerOnline);
    host.wechatPersonalQrWorkerOnline = online;
    host.wechatPersonalQrWxid = probe?.wxid ?? null;
    host.wechatPersonalQrDataUrl = null;
    if (!online) {
      host.wechatPersonalQrStatus = "offline";
      host.wechatPersonalQrMessage = WECHAT_PERSONAL_OFFLINE_HINT;
      return false;
    }
    if (probe?.loggedIn && probe.wxid?.trim()) {
      host.wechatPersonalQrStatus = "logged_in";
      host.wechatPersonalQrMessage = formatWechatPersonalDetectedLabel(probe.wxid, probe.nickname);
    } else {
      host.wechatPersonalQrStatus = "idle";
      host.wechatPersonalQrWxid = null;
      host.wechatPersonalQrMessage = WECHAT_PERSONAL_NOT_LOGGED_IN_HINT;
    }
    return true;
  } catch {
    host.wechatPersonalQrWorkerOnline = false;
    host.wechatPersonalQrStatus = "offline";
    host.wechatPersonalQrDataUrl = null;
    host.wechatPersonalQrMessage = WECHAT_PERSONAL_OFFLINE_HINT;
    return false;
  }
}

export async function bindUserOperationalIdentityViaWechatPersonalExisting(
  host: UserOperationalIdentityHost,
  input?: { displayName?: string; agentId?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    host.userOperationalIdentityError = "网关未连接。";
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    const online = await probeWechatPersonalQrWorker(host);
    if (!online) {
      host.userOperationalIdentityError =
        host.wechatPersonalQrMessage ?? WECHAT_PERSONAL_OFFLINE_HINT;
      return false;
    }
    if (host.wechatPersonalQrStatus !== "logged_in" || !host.wechatPersonalQrWxid?.trim()) {
      host.userOperationalIdentityError =
        host.wechatPersonalQrMessage ?? WECHAT_PERSONAL_NOT_LOGGED_IN_HINT;
      return false;
    }
    const bound = await host.client.request<{
      connected?: boolean;
      wxid?: string;
      nickname?: string;
      identity?: { identityId?: string };
    }>("user-operational-identity.wechat-personal.bind-existing", {
      displayName:
        input?.displayName?.trim() ||
        host.userOperationalIdentityEditorDisplayName.trim() ||
        "微信个人号",
      agentId: input?.agentId?.trim() || undefined,
    });
    if (!bound?.connected || !bound.wxid) {
      host.wechatPersonalQrStatus = "error";
      host.userOperationalIdentityError = "绑定本机微信失败。";
      host.wechatPersonalQrMessage = host.userOperationalIdentityError;
      return false;
    }
    host.wechatPersonalQrStatus = "logged_in";
    host.wechatPersonalQrWxid = bound.wxid;
    host.wechatPersonalQrMessage = formatWechatPersonalDetectedLabel(bound.wxid, bound.nickname);
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "微信个人号已绑定。会话保存在本地 worker，未写入云端。";
    host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav("wechat-personal");
    return true;
  } catch (error) {
    const message = wechatPersonalBindErrorMessage(error);
    host.wechatPersonalQrStatus = host.wechatPersonalQrWorkerOnline === false ? "offline" : "error";
    host.userOperationalIdentityError = message;
    host.wechatPersonalQrMessage = message;
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function bindUserOperationalIdentityViaWechatPersonalQr(
  host: UserOperationalIdentityHost,
  input?: { displayName?: string; agentId?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    host.userOperationalIdentityError = "网关未连接。";
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    const online = await probeWechatPersonalQrWorker(host);
    if (!online) {
      host.userOperationalIdentityError = host.wechatPersonalQrMessage ?? "本地微信 worker 离线。";
      return false;
    }
    const started = await host.client.request<{
      qrDataUrl?: string;
      message?: string;
      status?: string;
    }>("user-operational-identity.wechat-personal.qr.start", { force: true });
    if (!started?.qrDataUrl) {
      host.wechatPersonalQrStatus = "offline";
      host.wechatPersonalQrDataUrl = null;
      host.wechatPersonalQrMessage = started?.message ?? "无法生成二维码。";
      host.userOperationalIdentityError = host.wechatPersonalQrMessage;
      return false;
    }
    host.wechatPersonalQrDataUrl = started.qrDataUrl;
    host.wechatPersonalQrStatus = "scanning";
    host.wechatPersonalQrMessage = started.message ?? "请用微信扫码。";
    const waited = await host.client.request<{
      connected?: boolean;
      wxid?: string;
      message?: string;
      identity?: { identityId?: string };
    }>("user-operational-identity.wechat-personal.qr.wait", {
      displayName:
        input?.displayName?.trim() ||
        host.userOperationalIdentityEditorDisplayName.trim() ||
        "微信个人号",
      agentId: input?.agentId?.trim() || undefined,
    });
    if (!waited?.connected || !waited.wxid) {
      host.wechatPersonalQrStatus = "error";
      host.wechatPersonalQrMessage = waited?.message ?? "扫码超时。";
      host.userOperationalIdentityError = host.wechatPersonalQrMessage;
      return false;
    }
    host.wechatPersonalQrStatus = "logged_in";
    host.wechatPersonalQrWxid = waited.wxid;
    host.wechatPersonalQrMessage = `已绑定 ${waited.wxid}`;
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "微信个人号已绑定。会话保存在本地 worker，未写入云端。";
    host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav("wechat-personal");
    return true;
  } catch (error) {
    host.wechatPersonalQrStatus = host.wechatPersonalQrWorkerOnline === false ? "offline" : "error";
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "微信个人号扫码绑定失败。";
    host.wechatPersonalQrMessage = host.userOperationalIdentityError;
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function createUserOperationalIdentity(
  host: UserOperationalIdentityHost,
  input: {
    displayName: string;
    provider: string;
    externalAccountId?: string;
    appId?: string;
    appSecret?: string;
    accountHandle?: string;
    accessToken?: string;
    identityId?: string;
    smtpFrom?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    imapHost?: string;
    imapPort?: string;
    imapUser?: string;
    usePlatformSmtp?: boolean;
    continuationToken?: string;
    callbackOrigin?: string;
    basePath?: string;
  },
): Promise<boolean> {
  const catalog = host.userOperationalIdentities?.providerCatalog ?? [];
  const entry = catalog.find((item) => item.provider === input.provider);
  const authMode =
    entry?.authMode ??
    (entry?.manualKind ||
    input.provider === "wechat-official" ||
    input.provider === "personal-email"
      ? "manual"
      : "oauth");
  if (authMode === "qr_channel" || input.provider === "wechat-personal") {
    return bindUserOperationalIdentityViaWechatPersonalExisting(host, {
      displayName: input.displayName,
      agentId: host.userOperationalIdentityEditorGrantAgentId?.trim() || undefined,
    });
  }
  if (authMode === "manual") {
    return bindUserOperationalIdentityViaManualCredentials(host, {
      displayName: input.displayName,
      provider: input.provider,
      appId: input.appId,
      appSecret: input.appSecret,
      accountHandle: input.accountHandle ?? input.externalAccountId,
      accessToken: input.accessToken ?? input.appSecret,
      identityId: input.identityId,
      smtpFrom: input.smtpFrom ?? input.accountHandle ?? input.externalAccountId,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpUser: input.smtpUser,
      smtpPass: input.smtpPass ?? input.accessToken ?? input.appSecret,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapUser: input.imapUser,
      usePlatformSmtp: input.usePlatformSmtp,
    });
  }
  // Re-open of an already-bound OAuth identity → reauthorize (not a blank new bind).
  if (input.identityId?.trim()) {
    return reauthorizeUserOperationalIdentity(host, input.identityId.trim());
  }
  return bindUserOperationalIdentityViaOAuth(host, input);
}

export async function revokeUserOperationalIdentity(
  host: UserOperationalIdentityHost,
  identityId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.revoke", { identityId });
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "运营身份已停用。";
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "停用运营身份失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function reauthorizeUserOperationalIdentity(
  host: UserOperationalIdentityHost,
  identityId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    const started = await host.client.request<{
      sessionId?: string;
      authorizeUrl?: string | null;
      simulateAllowed?: boolean;
      purpose?: string;
      authMode?: "oauth" | "manual" | "qr_channel";
      provider?: string;
      displayName?: string;
      externalAccountId?: string;
    }>("user-operational-identity.reauthorize", {
      identityId,
      callbackOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      returnPath:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : undefined,
    });
    if (started?.authMode === "manual") {
      const provider = started.provider ?? "wechat-official";
      const catalog = host.userOperationalIdentities?.providerCatalog ?? [];
      const entry = catalog.find((item) => item.provider === provider);
      const manualKind =
        entry?.manualKind ??
        (provider === "wechat-official"
          ? "wechat_oa"
          : provider === "personal-email"
            ? "smtp"
            : "social_account");
      host.userOperationalIdentityEditorOpen = true;
      host.userOperationalIdentityEditorIdentityId = identityId;
      host.userOperationalIdentityEditorProvider = provider;
      host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav(provider);
      host.userOperationalIdentityEditorDisplayName = started.displayName ?? "";
      host.userOperationalIdentityEditorAppSecret = "";
      host.userOperationalIdentityEditorSmtpHost = "";
      host.userOperationalIdentityEditorSmtpPort = "587";
      host.userOperationalIdentityEditorSmtpUser = "";
      host.userOperationalIdentityEditorImapHost = "";
      host.userOperationalIdentityEditorImapPort = "993";
      host.userOperationalIdentityEditorImapUser = "";
      host.userOperationalIdentityEditorPersonalEmailPresetNote = null;
      host.userOperationalIdentityEditorUsePlatformSmtp = false;
      if (manualKind === "wechat_oa") {
        host.userOperationalIdentityEditorAppId = started.externalAccountId ?? "";
        host.userOperationalIdentityEditorCredentialHandleId = "";
        host.userOperationalIdentityNotice = "请重新填写 AppSecret 以完成重新认证。";
      } else if (manualKind === "smtp") {
        host.userOperationalIdentityEditorAppId = "";
        host.userOperationalIdentityEditorCredentialHandleId = started.externalAccountId ?? "";
        host.userOperationalIdentityEditorUsePlatformSmtp = Boolean(
          host.userOperationalIdentities?.platformSmtpConfigured,
        );
        applyPersonalEmailPresetToEditor(host);
        host.userOperationalIdentityNotice = "请更新 SMTP 配置以完成重新认证。";
      } else {
        host.userOperationalIdentityEditorAppId = "";
        host.userOperationalIdentityEditorCredentialHandleId = started.externalAccountId ?? "";
        host.userOperationalIdentityNotice = "请重新填写访问凭证以完成重新认证。";
      }
      return true;
    }
    if (started?.authMode === "qr_channel") {
      host.userOperationalIdentityEditorOpen = true;
      host.userOperationalIdentityEditorIdentityId = identityId;
      host.userOperationalIdentityEditorProvider = "wechat-personal";
      host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav("wechat-personal");
      host.userOperationalIdentityEditorDisplayName = started.displayName ?? "微信个人号";
      host.userOperationalIdentityNotice = "请在本机微信已登录时重新绑定。";
      await probeWechatPersonalQrWorker(host);
      return true;
    }
    const sessionId = started?.sessionId?.trim();
    if (!sessionId) {
      host.userOperationalIdentityError = "无法启动 OAuth 重新认证。";
      return false;
    }
    host.userOperationalIdentityOAuthSessionId = sessionId;
    if (started?.authorizeUrl) {
      openExternalUrlSafe(started.authorizeUrl);
      host.userOperationalIdentityNotice = "已打开重新认证页面，完成后会自动返回工作台。";
      const completed = await pollUserOperationalIdentityOAuthSession(host, sessionId);
      if (!completed) {
        return false;
      }
    } else if (started?.simulateAllowed) {
      await host.client.request("user-operational-identity.oauth.simulate-complete", {
        sessionId,
      });
    } else {
      host.userOperationalIdentityError = "当前 Provider 暂不支持 OAuth 重新认证。";
      return false;
    }
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "运营身份凭证已重新认证。";
    host.userOperationalIdentityOAuthSessionId = null;
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "重新认证运营身份失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function confirmUserOperationalIdentityGrant(
  host: UserOperationalIdentityHost,
  input: {
    identityId: string;
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    allowedActions: string[];
    tenantId?: string;
    seatId?: string;
    sessionKey?: string | null;
  },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.grants.upsert", {
      ...input,
      grantMode: input.agentScope === "owned" ? "auto" : "explicit",
      confirmExplicit: input.agentScope !== "owned",
    });
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "机器人授权已保存。";
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "保存机器人授权失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

const PERSONAL_IDENTITY_GRANT_SCOPES = new Set(["owned", "shared"] as const);

function resolvePersonalGrantAgentScope(
  agentId: string,
  agentScopesById?: Record<string, "owned" | "shared" | "group">,
): "owned" | "shared" {
  const scoped = agentScopesById?.[agentId];
  if (scoped === "shared" || scoped === "group") {
    // Personal settings never open group-session grants; treat group as shared explicit.
    return "shared";
  }
  return "owned";
}

/**
 * 按身份同步旗下数字人授权（授权管理页：身份 → 多选自有/席位共享数字人）。
 * 对比该 identity 下 owned|shared + active 授权：新增 → upsert；取消 → revoke。仅刷新一次。
 * 席位归属的 shared 机器人走 explicit + confirmExplicit。
 */
export async function applyIdentityOperationalRobotGrants(
  host: UserOperationalIdentityHost,
  input: {
    identityId: string;
    desiredAgentIds: string[];
    agentScopesById?: Record<string, "owned" | "shared" | "group">;
    sessionKey?: string | null;
  },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const identityId = input.identityId.trim();
  if (!identityId) {
    return false;
  }
  const snapshot = host.userOperationalIdentities;
  const identity = (snapshot?.identities ?? []).find((entry) => entry.identityId === identityId);
  if (!identity) {
    host.userOperationalIdentityError = "未找到该绑定账户。";
    return false;
  }
  const catalogEntry = (snapshot?.providerCatalog ?? []).find(
    (entry) => entry.provider === identity.provider,
  );
  const catalogActions = catalogEntry?.operationalActions.map((item) => item.action) ?? [];
  const allowedActions = catalogActions.length > 0 ? catalogActions : ["*"];
  const desiredAgentIds = [
    ...new Set(input.desiredAgentIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const currentGrants = (snapshot?.grants ?? []).filter(
    (grant) =>
      grant.identityId === identityId &&
      grant.status === "active" &&
      PERSONAL_IDENTITY_GRANT_SCOPES.has(grant.agentScope as "owned" | "shared"),
  );
  const currentAgentIds = new Set(currentGrants.map((grant) => grant.agentId));
  const desiredSet = new Set(desiredAgentIds);
  const toAdd = desiredAgentIds.filter((agentId) => !currentAgentIds.has(agentId));
  const toRevoke = currentGrants.filter((grant) => !desiredSet.has(grant.agentId));
  if (toAdd.length === 0 && toRevoke.length === 0) {
    host.userOperationalIdentityNotice = "授权未变化。";
    return true;
  }
  if (identity.provider === "feishu-personal" && toAdd.length > 0 && toRevoke.length === 0) {
    host.userOperationalIdentityError =
      "飞书的动作、资源范围、确认方式和有效期在机器人「运营授权」里确认。";
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    if (identity.provider !== "feishu-personal") {
      for (const agentId of toAdd) {
        const agentScope = resolvePersonalGrantAgentScope(agentId, input.agentScopesById);
        await host.client.request("user-operational-identity.grants.upsert", {
          identityId,
          agentId,
          agentScope,
          allowedActions,
          sessionKey: input.sessionKey,
          grantMode: agentScope === "owned" ? "auto" : "explicit",
          confirmExplicit: agentScope !== "owned",
        });
      }
    }
    for (const grant of toRevoke) {
      await host.client.request("user-operational-identity.grants.revoke", {
        grantId: grant.grantId,
      });
    }
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice =
      identity.provider === "feishu-personal" && toAdd.length > 0
        ? `已取消 ${toRevoke.length} 个机器人。新的飞书动作请在机器人「运营授权」里确认。`
        : `授权已更新（新增 ${toAdd.length}、取消 ${toRevoke.length}）。`;
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "更新账户授权失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

/**
 * 按「期望选择」一次性同步某机器人的个人身份授权（多选 + 二次修改）。
 * 对比当前 active 授权：新增勾选的 → upsert；取消勾选的 → revoke。仅刷新一次。
 */
export async function applyRobotOperationalIdentityGrants(
  host: UserOperationalIdentityHost,
  input: {
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    desired: Array<{
      identityId: string;
      allowedActions: string[];
      resourceScope?: { groups: string[]; docs: string[]; calendars: string[] };
      confirmMode?: "read_only" | "draft_then_confirm" | "limited_auto";
      expiresAt?: string;
    }>;
    sessionKey?: string | null;
  },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const agentId = input.agentId.trim();
  if (!agentId) {
    return false;
  }
  if (input.agentScope === "group" && input.desired.length > 0) {
    host.userOperationalIdentityError = "个人身份不能从设置页直接授权给协作小组会话机器人。";
    return false;
  }
  const grantScope: "owned" | "shared" = input.agentScope === "shared" ? "shared" : "owned";
  const currentGrants = (host.userOperationalIdentities?.grants ?? []).filter(
    (grant) =>
      grant.agentId === agentId &&
      grant.status === "active" &&
      PERSONAL_IDENTITY_GRANT_SCOPES.has(grant.agentScope as "owned" | "shared"),
  );
  const desiredIds = new Set(input.desired.map((entry) => entry.identityId));
  const providerFor = (identityId: string) =>
    host.userOperationalIdentities?.identities.find(
      (identity) => identity.identityId === identityId,
    )?.provider;
  const sameList = (left: string[] | undefined, right: string[] | undefined) =>
    [...(left ?? [])].toSorted().join("\0") === [...(right ?? [])].toSorted().join("\0");
  const toWrite = input.desired.filter((entry) => {
    const current = currentGrants.find((grant) => grant.identityId === entry.identityId);
    if (!current) {
      return true;
    }
    if (providerFor(entry.identityId) !== "feishu-personal") {
      return false;
    }
    return !(
      sameList(current.allowedActions, entry.allowedActions) &&
      current.confirmMode === entry.confirmMode &&
      (current.expiresAt ?? "") === (entry.expiresAt ?? "") &&
      sameList(current.resourceScope?.groups, entry.resourceScope?.groups) &&
      sameList(current.resourceScope?.docs, entry.resourceScope?.docs) &&
      sameList(current.resourceScope?.calendars, entry.resourceScope?.calendars)
    );
  });
  const toRevoke = currentGrants.filter((grant) => !desiredIds.has(grant.identityId));
  if (toWrite.length === 0 && toRevoke.length === 0) {
    host.userOperationalIdentityNotice = "授权未变化。";
    return true;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    for (const entry of toWrite) {
      const workplace = providerFor(entry.identityId) === "feishu-personal";
      await host.client.request("user-operational-identity.grants.upsert", {
        identityId: entry.identityId,
        agentId,
        agentScope: grantScope,
        allowedActions: entry.allowedActions,
        resourceScope: entry.resourceScope,
        confirmMode: entry.confirmMode,
        expiresAt: entry.expiresAt,
        sessionKey: input.sessionKey,
        grantMode: workplace || grantScope !== "owned" ? "explicit" : "auto",
        confirmExplicit: workplace || grantScope !== "owned",
      });
    }
    for (const grant of toRevoke) {
      await host.client.request("user-operational-identity.grants.revoke", {
        grantId: grant.grantId,
      });
    }
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = `授权已更新（写入 ${toWrite.length}、取消 ${toRevoke.length}）。`;
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "更新机器人授权失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function revokeUserOperationalIdentityGrantRecord(
  host: UserOperationalIdentityHost,
  grantId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.grants.revoke", { grantId });
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "机器人授权已撤销。";
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "撤销机器人授权失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export async function completeUserOperationalIdentityBindingRequest(
  host: UserOperationalIdentityHost,
  requestId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.binding-request.complete", { requestId });
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "绑定请求已完成，可返回原任务继续。";
    return true;
  } catch (error) {
    host.userOperationalIdentityError =
      error instanceof Error ? error.message : "完成绑定请求失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

/** Prefer active, then reauth/expired; most recently updated wins. Secrets never prefilled. */
export function findEditableUserOperationalIdentityForProvider(
  host: UserOperationalIdentityHost,
  provider: string,
): UserOperationalIdentitySummary | null {
  const normalized = provider.trim();
  if (!normalized) {
    return null;
  }
  const candidates = (host.userOperationalIdentities?.identities ?? []).filter(
    (identity) =>
      identity.provider === normalized &&
      (identity.status === "active" ||
        identity.status === "reauth_required" ||
        identity.status === "expired"),
  );
  if (candidates.length === 0) {
    return null;
  }
  const rank = (status: UserOperationalIdentitySummary["status"]) =>
    status === "active" ? 0 : status === "reauth_required" ? 1 : 2;
  return [...candidates].toSorted((left, right) => {
    const statusDelta = rank(left.status) - rank(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  })[0];
}

export function setUserOperationalIdentityNav(
  host: UserOperationalIdentityHost,
  nav: UserOperationalIdentityNav,
) {
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityUsageEventId = null;
  if (nav === "grants") {
    // Legacy deep-link: land on bound overview (授权管理 removed from nav).
    host.userOperationalIdentityNav = "bound";
    closeUserOperationalIdentityEditor(host);
    return;
  }
  host.userOperationalIdentityNav = nav;
  const addProvider = parseUserOperationalIdentityAddProvider(nav);
  if (addProvider) {
    const existing = findEditableUserOperationalIdentityForProvider(host, addProvider);
    if (existing) {
      closeUserOperationalIdentityEditor(host);
      return;
    }
    openUserOperationalIdentityEditor(host, { provider: addProvider });
    return;
  }
  if (nav === "bound") {
    closeUserOperationalIdentityEditor(host);
  }
}

export function openUserOperationalIdentityEditor(
  host: UserOperationalIdentityHost,
  params?: { provider?: string; displayName?: string; identityId?: string | null } | string,
) {
  host.userOperationalIdentityEditorOpen = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  host.userOperationalIdentityEditorAppSecret = "";
  host.userOperationalIdentityEditorSmtpHost = "";
  host.userOperationalIdentityEditorSmtpPort = "587";
  host.userOperationalIdentityEditorSmtpUser = "";
  host.userOperationalIdentityEditorImapHost = "";
  host.userOperationalIdentityEditorImapPort = "993";
  host.userOperationalIdentityEditorImapUser = "";
  host.userOperationalIdentityEditorPersonalEmailPresetNote = null;
  const normalized = typeof params === "string" ? { provider: params } : (params ?? {});
  const nextProvider = normalized.provider?.trim() || "";
  host.userOperationalIdentityEditorProvider = nextProvider;
  if (nextProvider) {
    host.userOperationalIdentityNav = buildUserOperationalIdentityAddNav(nextProvider);
  }

  const catalog = host.userOperationalIdentities?.providerCatalog ?? [];
  const entry = catalog.find((item) => item.provider === nextProvider);
  const manualKind =
    entry?.manualKind ??
    (nextProvider === "wechat-official"
      ? "wechat_oa"
      : nextProvider === "personal-email"
        ? "smtp"
        : null);

  const existing =
    (normalized.identityId?.trim()
      ? (host.userOperationalIdentities?.identities ?? []).find(
          (identity) => identity.identityId === normalized.identityId?.trim(),
        )
      : null) ??
    (nextProvider ? findEditableUserOperationalIdentityForProvider(host, nextProvider) : null);

  if (existing) {
    host.userOperationalIdentityEditorIdentityId = existing.identityId;
    host.userOperationalIdentityEditorDisplayName =
      normalized.displayName?.trim() || existing.displayName || entry?.label || "";
    const account = existing.externalAccountId?.trim() || "";
    if (manualKind === "wechat_oa" || nextProvider === "wechat-official") {
      host.userOperationalIdentityEditorAppId = account;
      host.userOperationalIdentityEditorCredentialHandleId = "";
    } else {
      host.userOperationalIdentityEditorAppId = "";
      host.userOperationalIdentityEditorCredentialHandleId = account;
    }
    host.userOperationalIdentityEditorUsePlatformSmtp =
      nextProvider === "personal-email" &&
      Boolean(host.userOperationalIdentities?.platformSmtpConfigured);
    if (nextProvider === "personal-email") {
      applyPersonalEmailPresetToEditor(host);
    }
    return;
  }

  host.userOperationalIdentityEditorIdentityId = null;
  host.userOperationalIdentityEditorAppId = "";
  host.userOperationalIdentityEditorCredentialHandleId = "";
  host.userOperationalIdentityEditorUsePlatformSmtp =
    nextProvider === "personal-email" &&
    Boolean(host.userOperationalIdentities?.platformSmtpConfigured);
  if (normalized.displayName?.trim()) {
    host.userOperationalIdentityEditorDisplayName = normalized.displayName.trim();
  } else if (nextProvider === "wechat-official") {
    host.userOperationalIdentityEditorDisplayName = "微信公众号";
  } else if (nextProvider === "personal-email") {
    host.userOperationalIdentityEditorDisplayName = "个人邮箱";
  } else if (nextProvider) {
    host.userOperationalIdentityEditorDisplayName = entry?.label ?? "";
  } else {
    host.userOperationalIdentityEditorDisplayName = "";
  }
  if (nextProvider === "wechat-personal") {
    void probeWechatPersonalQrWorker(host);
  }
}

export async function verifyUserOperationalIdentityCredentials(
  host: UserOperationalIdentityHost,
  identityId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  host.userOperationalIdentityBusy = true;
  host.userOperationalIdentityError = null;
  host.userOperationalIdentityNotice = null;
  try {
    await host.client.request("user-operational-identity.credentials.verify", { identityId });
    await loadUserOperationalIdentities(host);
    host.userOperationalIdentityNotice = "凭证验证通过。";
    return true;
  } catch (error) {
    host.userOperationalIdentityError = error instanceof Error ? error.message : "验证凭证失败。";
    return false;
  } finally {
    host.userOperationalIdentityBusy = false;
  }
}

export function closeUserOperationalIdentityEditor(host: UserOperationalIdentityHost) {
  resetWechatPersonalQr(host);
  host.userOperationalIdentityEditorOpen = false;
  host.userOperationalIdentityEditorProvider = "";
  host.userOperationalIdentityEditorDisplayName = "";
  host.userOperationalIdentityEditorCredentialHandleId = "";
  host.userOperationalIdentityEditorAppId = "";
  host.userOperationalIdentityEditorAppSecret = "";
  host.userOperationalIdentityEditorSmtpHost = "";
  host.userOperationalIdentityEditorSmtpPort = "587";
  host.userOperationalIdentityEditorSmtpUser = "";
  host.userOperationalIdentityEditorUsePlatformSmtp = false;
  host.userOperationalIdentityEditorIdentityId = null;
  host.userOperationalIdentityOAuthSessionId = null;
  const addProvider = parseUserOperationalIdentityAddProvider(host.userOperationalIdentityNav);
  if (addProvider && !findEditableUserOperationalIdentityForProvider(host, addProvider)) {
    // Cancelled a first-time bind form — return to account overview.
    host.userOperationalIdentityNav = "bound";
  }
}

export function setUserOperationalIdentityBindingReturnContext(
  host: UserOperationalIdentityHost,
  params: { sessionKey?: string | null; module?: string | null },
) {
  host.userOperationalIdentityReturnSessionKey = params.sessionKey?.trim() || null;
  host.userOperationalIdentityReturnModule = params.module?.trim() || null;
}

export function clearUserOperationalIdentityBindingReturnContext(
  host: UserOperationalIdentityHost,
) {
  host.userOperationalIdentityReturnSessionKey = null;
  host.userOperationalIdentityReturnModule = null;
}

export async function handoffUserOperationalIdentityTask(
  host: UserOperationalIdentityHost,
  input: {
    agentId: string;
    provider: string;
    requestedAction: string;
    sessionKey?: string | null;
    workbenchModule?: string | null;
    resumeMessage?: string;
    resumeIntentId?: string;
    executionPayload?: Record<string, unknown>;
    requiredProviders?: string[];
    autoResume?: boolean;
  },
): Promise<{
  bindingRequest: UserOperationalIdentityBindingRequestSummary | null;
  continuation: UserOperationalIdentityContinuationSummary | null;
}> {
  const bindingRequest = await createUserOperationalIdentityBindingRequestRecord(host, {
    agentId: input.agentId,
    provider: input.provider,
    requestedAction: input.requestedAction,
    sessionKey: input.sessionKey,
  });
  const continuation = await createUserOperationalIdentityContinuation(host, {
    agentId: input.agentId,
    provider: input.provider,
    requestedAction: input.requestedAction,
    sessionKey: input.sessionKey,
    workbenchModule: input.workbenchModule,
    resumeMessage: input.resumeMessage,
    resumeIntentId: input.resumeIntentId,
    executionPayload: input.executionPayload,
    requiredProviders: input.requiredProviders,
    bindingRequestId: bindingRequest?.requestId,
    autoResume: input.autoResume,
  });
  await loadUserOperationalIdentities(host);
  return { bindingRequest, continuation };
}

export async function createUserOperationalIdentityBindingRequestRecord(
  host: UserOperationalIdentityHost,
  input: {
    agentId: string;
    provider: string;
    requestedAction: string;
    sessionKey?: string | null;
  },
): Promise<UserOperationalIdentityBindingRequestSummary | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  try {
    const result = await host.client.request<{
      request?: UserOperationalIdentityBindingRequestSummary;
    }>("user-operational-identity.binding-request.create", input);
    return result?.request ?? null;
  } catch {
    return null;
  }
}

export async function createUserOperationalIdentityContinuation(
  host: UserOperationalIdentityHost,
  input: {
    agentId: string;
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
  },
): Promise<UserOperationalIdentityContinuationSummary | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  try {
    const result = await host.client.request<{
      continuation?: UserOperationalIdentityContinuationSummary;
    }>("user-operational-identity.continuation.create", input);
    const continuation = result?.continuation ?? null;
    if (continuation?.continuationToken) {
      host.userOperationalIdentityContinuationToken = continuation.continuationToken;
    }
    return continuation;
  } catch {
    return null;
  }
}

export async function resumeUserOperationalIdentityContinuationFlow(
  host: UserOperationalIdentityHost,
  input: {
    continuationToken: string;
    force?: boolean;
  },
): Promise<UserOperationalIdentityContinuationResumePayload | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  try {
    const result = await host.client.request<{
      resume?: UserOperationalIdentityContinuationResumePayload;
    }>("user-operational-identity.continuation.resume", {
      continuationToken: input.continuationToken,
      force: input.force === true,
    });
    return result?.resume ?? null;
  } catch {
    return null;
  }
}

export function clearUserOperationalIdentityContinuationToken(host: UserOperationalIdentityHost) {
  host.userOperationalIdentityContinuationToken = null;
}
