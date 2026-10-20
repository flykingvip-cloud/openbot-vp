import { CONTROL_UI_ENTERPRISE_BASE_PATH } from "../../../../src/gateway/control-ui-contract.js";
import { normalizeBasePath } from "../navigation.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import { formatIdentityPolicyCapabilityError } from "../ports/enterprise/semantic/enterprise-identity-policy-actions.ts";
import {
  countUnreadBindingActivity,
  readBindingActivitySeenAt,
} from "../ports/enterprise/views/enterprise-identity-binding-activity-prefs.ts";
import { requestOpenBotAppRerender } from "../request-app-rerender.ts";

export type EnterpriseIdentityVerifyPhase = "idle" | "running" | "passed" | "failed";

export type EnterpriseOperationalIdentityHost = {
  basePath: string;
  platformAuthBusy: boolean;
  platformAuthError: string | null;
  platformAuthNotice: string | null;
  enterpriseOperationalIdentities: EnterpriseOperationalIdentitySnapshot | null;
  enterpriseOperationalIdentityBusy: boolean;
  enterpriseOperationalIdentityLoaded: boolean;
  enterpriseOperationalIdentityError: string | null;
  enterpriseOperationalIdentityNotice: string | null;
  enterpriseIdentityVerifyId?: string;
  enterpriseIdentityVerifyPhase?: EnterpriseIdentityVerifyPhase;
  enterpriseIdentityVerifyMessage?: string;
};

const ENTERPRISE_OPERATIONAL_IDENTITY_FETCH_TIMEOUT_MS = 25_000;

let pendingEnterpriseOperationalIdentityLoad: Promise<EnterpriseOperationalIdentitySnapshot | null> | null =
  null;
let lastEnterpriseOperationalIdentityEnsureKey: string | null = null;

function notifyEnterpriseOperationalIdentityChanged() {
  requestOpenBotAppRerender();
}

function beginEnterpriseOperationalIdentityBusy(host: EnterpriseOperationalIdentityHost) {
  host.enterpriseOperationalIdentityBusy = true;
  notifyEnterpriseOperationalIdentityChanged();
}

function endEnterpriseOperationalIdentityBusy(host: EnterpriseOperationalIdentityHost) {
  host.enterpriseOperationalIdentityBusy = false;
  notifyEnterpriseOperationalIdentityChanged();
}

async function fetchEnterpriseOperationalIdentity(
  url: string,
  init: RequestInit,
  timeoutMs = ENTERPRISE_OPERATIONAL_IDENTITY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("加载企业身份超时，请稍后重试。", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function ensureEnterpriseOperationalIdentitiesSnapshot(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  refreshKey: string,
  options?: { force?: boolean },
): void {
  const normalizedTenantId = tenantId.trim();
  const normalizedKey = refreshKey.trim();
  if (!normalizedTenantId || !normalizedKey) {
    return;
  }
  if (
    pendingEnterpriseOperationalIdentityLoad &&
    lastEnterpriseOperationalIdentityEnsureKey === normalizedKey
  ) {
    return;
  }
  if (
    !options?.force &&
    host.enterpriseOperationalIdentityLoaded &&
    host.enterpriseOperationalIdentities &&
    lastEnterpriseOperationalIdentityEnsureKey === normalizedKey
  ) {
    return;
  }
  lastEnterpriseOperationalIdentityEnsureKey = normalizedKey;
  pendingEnterpriseOperationalIdentityLoad = loadEnterpriseOperationalIdentities(
    host,
    normalizedTenantId,
  ).finally(() => {
    pendingEnterpriseOperationalIdentityLoad = null;
  });
}

export type EnterpriseOperationalIdentitySummary = {
  identityId: string;
  provider: string;
  providerLabel: string;
  category: "official" | "communication" | "business";
  displayName: string;
  credentialBindingId: string;
  connectorProfileId?: string;
  externalAccountId?: string;
  steward?: {
    kind: "seat" | "employee";
    ownerId: string;
  };
  stewardLabel?: string;
  stewardDetail?: string;
  status: "active" | "expired" | "reauth_required";
  policyCount: number;
  dataSourceBindingCount: number;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  configReadiness?: {
    items: Array<{
      key: string;
      label: string;
      satisfied: boolean;
      scope: "field" | "verify" | "identity";
      detail?: string;
    }>;
    probedAt?: string;
  };
  capabilities?: string[];
  capabilityMissing?: string[];
  capabilityDiscoveredAt?: string;
  providerMetadata?: Record<string, string>;
  credentialEditPreview?: {
    fields: Record<string, string>;
    secretsConfigured: string[];
  };
  connectionStatus?: string;
  healthStatus?: "active" | "warning" | "failed";
  connectionStatusLabel?: string;
  agentReady?: boolean;
  capabilityDetails?: Array<{
    action: string;
    label: string;
    risk: "low" | "medium" | "high";
    enabled: boolean;
    alias?: string;
  }>;
  statusHint?: {
    status: "active" | "expired" | "reauth_required";
    label: string;
    tone: "ok" | "warn" | "danger";
    detail: string;
  };
};

export type EnterpriseOperationalIdentityRegistrationProfile = {
  summary: string;
  methods: Array<"oauth" | "manual">;
  manualFields?: Array<{
    key: string;
    label: string;
    kind: "text" | "password" | "email" | "url" | "number";
    required: boolean;
    storage: "metadata" | "secret";
    hint?: string;
  }>;
  oauthHint?: string;
  verifyChecks: Array<{ key: string; label: string }>;
  actionRequirements: Array<{ action: string; requiredFieldKeys: string[] }>;
};

export type EnterpriseOperationalIdentityProviderCatalogEntry = {
  provider: string;
  label: string;
  category: "official" | "communication" | "business";
  connectorIds: string[];
  rolloutTier: "p0" | "p2";
  registrationReady: boolean;
  operationalActions: Array<{ action: string; label: string }>;
  dataSyncActions: Array<{ action: string; label: string }>;
  reauthHint: string;
  degradedHint: string | null;
  registrationProfile?: EnterpriseOperationalIdentityRegistrationProfile;
  oauthConfigured?: boolean;
  oauthTicketReady?: boolean;
};

export type EnterpriseOperationalIdentityPolicySummary = {
  policyId: string;
  identityId: string;
  seatIds: string[];
  allowedAgentIds: string[];
  allowedActions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseEmployeeIdentityEnrollmentSummary = {
  enrollmentId: string;
  tenantId: string;
  employeeId: string;
  agentId: string;
  identityId: string;
  allowedActions: string[];
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseIdentityBindingActivitySummary = {
  auditEventId: string;
  eventType: "identity.bound" | "identity.unbound";
  resourceId?: string;
  actorEmployeeId?: string;
  metadata?: Record<string, string | number | boolean | null | string[]>;
  createdAt: string;
};

export type EnterpriseOperationalIdentitySnapshot = {
  identities: EnterpriseOperationalIdentitySummary[];
  providerCounts: Record<string, number>;
  providerCatalog: EnterpriseOperationalIdentityProviderCatalogEntry[];
  policies: EnterpriseOperationalIdentityPolicySummary[];
  employeeEnrollments?: EnterpriseEmployeeIdentityEnrollmentSummary[];
  bindingActivity?: EnterpriseIdentityBindingActivitySummary[];
  dataSourceBindings: Array<{
    bindingId: string;
    identityId: string;
    dataSourceId: string;
    purpose: string;
    createdAt: string;
    updatedAt: string;
  }>;
  eligibleCredentialBindings: Array<{
    credentialBindingId: string;
    connectorId: string;
    ownerType: string;
    ownerId: string;
    status: string;
  }>;
  gatewayEgressIp?: string | null;
  eligibleDataSources: Array<{
    sourceId: string;
    sourceKey: string;
    displayName: string;
    connectorId: string;
    status: string;
  }>;
};

type EnterpriseOperationalIdentityError = {
  ok: false;
  code?: string;
  error?: string;
};

type EnterpriseOperationalIdentitySuccess = {
  ok: true;
  auditId?: string;
  identity?: EnterpriseOperationalIdentitySummary;
  policy?: EnterpriseOperationalIdentityPolicySummary;
};

function buildEnterpriseUrl(basePath: string, tenantId: string, suffix: string): string {
  const normalizedBase = normalizeBasePath(basePath ?? "");
  const root = normalizedBase
    ? `${normalizedBase}${CONTROL_UI_ENTERPRISE_BASE_PATH}`
    : CONTROL_UI_ENTERPRISE_BASE_PATH;
  return `${root}/${encodeURIComponent(tenantId)}${suffix}`;
}

function trimErrorMessage(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEnterpriseOperationalIdentityError(
  payload: EnterpriseOperationalIdentityError | null,
  status: number,
): string {
  const fallback = trimErrorMessage(payload?.error) || `Request failed (${status})`;
  switch (payload?.code) {
    case "ENTERPRISE_IDENTITY_NOT_ENABLED":
      return "企业运营身份服务尚未启用，请先启用平台登录并使用企业管理员账号。";
    case "ENTERPRISE_IDENTITY_UNAUTHORIZED":
      return "当前登录会话已失效，请重新以企业管理员身份登录。";
    case "ENTERPRISE_IDENTITY_ADMIN_REQUIRED":
      return "仅企业管理员可管理企业运营身份。";
    case "ENTERPRISE_IDENTITY_TENANT_FORBIDDEN":
      return "当前账号没有该企业租户的管理权限。";
    case "ENTERPRISE_IDENTITY_LOCAL_ONLY":
      return "当前入口未被识别为已配置的企业控制台（公网域名或本机控制台）。请通过 openbot.love 或本机 Control UI 登录企业管理员后再试。";
    case "ENTERPRISE_IDENTITY_SEAT_REQUIRED":
      return "身份使用策略必须至少绑定一个岗位（Seat）。";
    case "ENTERPRISE_IDENTITY_CREDENTIAL_NOT_FOUND":
      return "所选凭证绑定不存在或不属于当前企业。";
    case "ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED":
      return "该凭证连接器暂不支持注册为企业运营身份。";
    case "ENTERPRISE_WECHAT_OAUTH_NOT_CONFIGURED":
      return "微信第三方平台 OAuth 未配置。自有公众号请使用 AppID + AppSecret 手动保存。";
    case "ENTERPRISE_WECHAT_OAUTH_TICKET_MISSING":
      return "微信 component_verify_ticket 尚未就绪。请在开放平台配置授权事件接收 URL 并等待推送，或临时设置 OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET。";
    case "ENTERPRISE_WECHAT_OAUTH_START_FAILED":
      return fallback;
    case "ENTERPRISE_IDENTITY_CAPABILITY_NOT_DISCOVERED": {
      const localized = formatIdentityPolicyCapabilityError({
        code: payload?.code,
        error: payload?.error,
      });
      return localized ?? fallback;
    }
    default: {
      const localized = formatIdentityPolicyCapabilityError({
        error: payload?.error,
        code: payload?.code,
      });
      return localized ?? fallback;
    }
  }
}

async function readEnterpriseOperationalIdentityPayload<T>(
  response: Response,
): Promise<{ payload: T | null; error: string | null }> {
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const errorPayload = payload as EnterpriseOperationalIdentityError | null;
    return {
      payload: null,
      error: formatEnterpriseOperationalIdentityError(errorPayload, response.status),
    };
  }
  return { payload, error: null };
}

function applyIdentitySnapshot(
  host: EnterpriseOperationalIdentityHost,
  snapshot: EnterpriseOperationalIdentitySnapshot | undefined,
) {
  if (!snapshot) {
    return;
  }
  host.enterpriseOperationalIdentities = snapshot;
}

export async function loadEnterpriseOperationalIdentities(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
): Promise<EnterpriseOperationalIdentitySnapshot | null> {
  // First paint may freeze the page; later GET refreshes must not disable
  // 连接身份 / 平台选择 / 表单，否则点开编辑器立刻整页点不动。
  const freezeUi = !host.enterpriseOperationalIdentityLoaded;
  if (freezeUi) {
    beginEnterpriseOperationalIdentityBusy(host);
  }
  host.enterpriseOperationalIdentityError = null;
  try {
    const response = await fetchEnterpriseOperationalIdentity(
      buildEnterpriseUrl(host.basePath, tenantId, "/identities"),
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<{
      ok: boolean;
      identities?: EnterpriseOperationalIdentitySummary[];
      providerCounts?: Record<string, number>;
      providerCatalog?: EnterpriseOperationalIdentityProviderCatalogEntry[];
      policies?: EnterpriseOperationalIdentityPolicySummary[];
      employeeEnrollments?: EnterpriseEmployeeIdentityEnrollmentSummary[];
      bindingActivity?: EnterpriseIdentityBindingActivitySummary[];
      dataSourceBindings?: EnterpriseOperationalIdentitySnapshot["dataSourceBindings"];
      eligibleCredentialBindings?: EnterpriseOperationalIdentitySnapshot["eligibleCredentialBindings"];
      eligibleDataSources?: EnterpriseOperationalIdentitySnapshot["eligibleDataSources"];
      gatewayEgressIp?: string | null;
    }>(response);
    if (error || !payload?.ok) {
      host.enterpriseOperationalIdentityError = error ?? "加载企业运营身份失败。";
      return null;
    }
    const snapshot: EnterpriseOperationalIdentitySnapshot = {
      identities: payload.identities ?? [],
      providerCounts: payload.providerCounts ?? {},
      providerCatalog: payload.providerCatalog ?? [],
      policies: payload.policies ?? [],
      employeeEnrollments: payload.employeeEnrollments ?? [],
      bindingActivity: payload.bindingActivity ?? [],
      dataSourceBindings: payload.dataSourceBindings ?? [],
      eligibleCredentialBindings: payload.eligibleCredentialBindings ?? [],
      eligibleDataSources: payload.eligibleDataSources ?? [],
      gatewayEgressIp: payload.gatewayEgressIp ?? null,
    };
    applyIdentitySnapshot(host, snapshot);
    const unreadBindingChanges = countUnreadBindingActivity(
      snapshot.bindingActivity ?? [],
      readBindingActivitySeenAt(tenantId),
    );
    if (unreadBindingChanges > 0 && !host.enterpriseOperationalIdentityNotice) {
      host.enterpriseOperationalIdentityNotice = `有 ${unreadBindingChanges} 条新的员工身份绑定变更，可在「企业身份 → 绑定总览」中查看。`;
    }
    return snapshot;
  } catch (error) {
    host.enterpriseOperationalIdentityError =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "加载企业运营身份失败。";
    return null;
  } finally {
    host.enterpriseOperationalIdentityLoaded = true;
    if (freezeUi) {
      endEnterpriseOperationalIdentityBusy(host);
    } else {
      notifyEnterpriseOperationalIdentityChanged();
    }
  }
}

export async function loadEnterpriseIdentityCredentialEditPreview(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  identityId: string,
): Promise<{
  fields: Record<string, string>;
  secretsConfigured: string[];
  credentialBindingId?: string;
  externalAccountId?: string;
} | null> {
  const normalizedIdentityId = identityId.trim();
  if (!normalizedIdentityId) {
    return null;
  }
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identities/${encodeURIComponent(normalizedIdentityId)}/credential-edit-preview`,
      ),
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<{
      ok: boolean;
      credentialEditPreview?: {
        fields: Record<string, string>;
        secretsConfigured: string[];
      };
      credentialBindingId?: string;
      externalAccountId?: string;
    }>(response);
    if (error || !payload?.ok || !payload.credentialEditPreview) {
      return null;
    }
    const fields = { ...payload.credentialEditPreview.fields };
    const appId = fields.appId?.trim() || payload.externalAccountId?.trim() || "";
    if (appId) {
      fields.appId = appId;
    }
    return {
      fields,
      secretsConfigured: payload.credentialEditPreview.secretsConfigured ?? [],
      ...(payload.credentialBindingId ? { credentialBindingId: payload.credentialBindingId } : {}),
      ...(payload.externalAccountId ? { externalAccountId: payload.externalAccountId } : {}),
    };
  } catch {
    return null;
  }
}

export async function createEnterpriseOperationalIdentity(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input: {
    displayName: string;
    credentialBindingId: string;
    connectorProfileId?: string;
    externalAccountId?: string;
  },
): Promise<EnterpriseOperationalIdentitySuccess | null> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(host.basePath, tenantId, "/identities/create"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "创建企业运营身份失败。";
      return null;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "企业身份已连接。";
    return payload;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function revokeEnterpriseOperationalIdentity(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  identityId: string,
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identities/${encodeURIComponent(identityId)}/revoke`,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "停用企业运营身份失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "企业运营身份已停用。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function reauthorizeEnterpriseOperationalIdentity(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  identityId: string,
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identities/${encodeURIComponent(identityId)}/reauthorize`,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "重授权企业运营身份失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "企业运营身份已重新校验。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function updateEnterpriseOperationalIdentity(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  identityId: string,
  input: { displayName: string },
): Promise<EnterpriseOperationalIdentitySuccess | null> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identities/${encodeURIComponent(identityId)}/update`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName: input.displayName }),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "更新企业身份失败。";
      return null;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "身份显示名称已更新。";
    return payload;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

const VERIFY_FEEDBACK_MIN_VISIBLE_MS = 500;

function humanizeIdentityVerifyDetail(detail: string): string {
  const rejectedIp = /invalid ip\s+([0-9a-f.:]+)/i.exec(detail)?.[1];
  if (rejectedIp) {
    return `IP 白名单未放行 ${rejectedIp}，请在微信公众平台 → 开发 → 基本配置中添加后再试。`;
  }
  return detail;
}

function formatVerifyResultNotice(
  status: EnterpriseOperationalIdentitySummary["status"],
  missingItems?: Array<{ label: string; detail?: string }>,
): string {
  if (status === "active") {
    return "连接测试通过：凭证已通过平台校验，身份可正常使用。";
  }
  const detailed = missingItems?.find((item) => item.detail?.trim());
  if (detailed?.detail?.trim()) {
    return `连接测试未通过：${humanizeIdentityVerifyDetail(detailed.detail.trim())}`;
  }
  const missingLabels = missingItems?.map((item) => item.label).filter(Boolean) ?? [];
  if (missingLabels.length > 0) {
    return `连接测试未通过：尚缺 ${missingLabels.slice(0, 3).join("、")}${missingLabels.length > 3 ? " 等" : ""}。`;
  }
  if (status === "reauth_required") {
    return "连接测试未通过：凭证不完整或需要重新授权。";
  }
  return "连接测试未通过：凭证已失效或缺失。";
}

function setIdentityVerifyState(
  host: EnterpriseOperationalIdentityHost,
  input: {
    identityId: string;
    phase: EnterpriseIdentityVerifyPhase;
    message: string;
  },
) {
  host.enterpriseIdentityVerifyId = input.identityId;
  host.enterpriseIdentityVerifyPhase = input.phase;
  host.enterpriseIdentityVerifyMessage = input.message;
  notifyEnterpriseOperationalIdentityChanged();
}

async function holdVerifyFeedback(startedAt: number) {
  const remaining = VERIFY_FEEDBACK_MIN_VISIBLE_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remaining);
    });
  }
}

export async function verifyEnterpriseOperationalIdentity(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  identityId: string,
): Promise<EnterpriseOperationalIdentitySuccess | null> {
  const startedAt = Date.now();
  setIdentityVerifyState(host, {
    identityId,
    phase: "running",
    message: "正在向平台验证凭证…",
  });
  beginEnterpriseOperationalIdentityBusy(host);
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identities/${encodeURIComponent(identityId)}/verify`,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      await holdVerifyFeedback(startedAt);
      const message = error ?? "连接测试失败。";
      host.enterpriseOperationalIdentityError = message;
      setIdentityVerifyState(host, {
        identityId,
        phase: "failed",
        message,
      });
      return null;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    await holdVerifyFeedback(startedAt);
    const status = payload.identity?.status ?? "expired";
    const readiness = (
      payload as {
        readiness?: { items?: Array<{ label: string; satisfied: boolean; detail?: string }> };
      }
    ).readiness;
    const missingItems = readiness?.items?.filter((item) => !item.satisfied) ?? [];
    const message = formatVerifyResultNotice(status, missingItems);
    const passed = status === "active";
    host.enterpriseOperationalIdentityNotice = message;
    setIdentityVerifyState(host, {
      identityId,
      phase: passed ? "passed" : "failed",
      message,
    });
    return payload;
  } catch (error) {
    await holdVerifyFeedback(startedAt);
    const message = error instanceof Error ? error.message : "连接测试失败。";
    host.enterpriseOperationalIdentityError = message;
    setIdentityVerifyState(host, {
      identityId,
      phase: "failed",
      message,
    });
    return null;
  } finally {
    endEnterpriseOperationalIdentityBusy(host);
  }
}

export async function upsertEnterpriseOperationalIdentityPolicy(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input: {
    identityId: string;
    policyId?: string;
    seatIds: string[];
    allowedAgentIds: string[];
    allowedActions: string[];
    enabled?: boolean;
  },
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(host.basePath, tenantId, "/identity-policies/upsert"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "保存身份使用策略失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "身份使用策略已保存。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function createEnterpriseOperationalIdentityBinding(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input: {
    identityId: string;
    dataSourceId: string;
    purpose: "source_authentication" | "source_collection" | "source_sync";
  },
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(host.basePath, tenantId, "/identity-bindings/create"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "创建数据源身份绑定失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "数据源身份绑定已创建。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function removeEnterpriseOperationalIdentityBinding(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  bindingId: string,
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/identity-bindings/${encodeURIComponent(bindingId)}/delete`,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      EnterpriseOperationalIdentitySuccess | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "移除数据源身份绑定失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "数据源身份绑定已移除。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function startEnterpriseWechatOfficialOAuth(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input?: {
    seatId?: string;
    displayName?: string;
    identityId?: string;
    credentialBindingId?: string;
  },
): Promise<boolean> {
  return startEnterpriseOperationalIdentityOAuth(host, tenantId, "wechat-official", input);
}

async function pollEnterpriseWechatOfficialOAuthStatus(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  sessionId: string,
): Promise<void> {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const response = await fetch(
        buildEnterpriseUrl(host.basePath, tenantId, "/oauth/wechat-official/status"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ sessionId }),
        },
      );
      const { payload } = await readEnterpriseOperationalIdentityPayload<{
        ok?: boolean;
        status?: string;
        authorizerAppId?: string | null;
      }>(response);
      if (!payload?.ok) {
        continue;
      }
      if (payload.status === "completed") {
        await loadEnterpriseOperationalIdentities(host, tenantId);
        host.enterpriseOperationalIdentityNotice = payload.authorizerAppId
          ? `微信公众号 ${payload.authorizerAppId} 授权成功。`
          : "微信公众号授权成功。";
        return;
      }
      if (payload.status === "expired") {
        host.enterpriseOperationalIdentityError = "微信公众号授权会话已过期，请重新扫码。";
        return;
      }
    } catch {
      // ignore transient poll errors
    }
  }
}

export async function startEnterpriseOperationalIdentityOAuth(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  provider: string,
  input?: {
    seatId?: string;
    displayName?: string;
    identityId?: string;
    credentialBindingId?: string;
  },
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  const providerSlug = provider.trim();
  const providerLabels: Record<string, string> = {
    "wechat-official": "微信公众号",
    weibo: "微博",
    douyin: "抖音",
    bilibili: "哔哩哔哩",
    "x-twitter": "X（Twitter）",
    xiaohongshu: "小红书",
    zhihu: "知乎",
  };
  const providerLabel = providerLabels[providerSlug] ?? providerSlug;
  try {
    const response = await fetch(
      buildEnterpriseUrl(
        host.basePath,
        tenantId,
        `/oauth/${encodeURIComponent(providerSlug)}/start`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          seatId: input?.seatId?.trim() || undefined,
          displayName: input?.displayName?.trim() || undefined,
          identityId: input?.identityId?.trim() || undefined,
          credentialBindingId: input?.credentialBindingId?.trim() || undefined,
        }),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      | { ok: boolean; authorizeUrl?: string | null; sessionId?: string }
      | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      const apiError = payload && "error" in payload ? String(payload.error ?? "") : "";
      const apiCode = payload && "code" in payload ? String(payload.code ?? "") : "";
      if (apiCode === "ENTERPRISE_WECHAT_OAUTH_NOT_CONFIGURED") {
        host.enterpriseOperationalIdentityError =
          "微信第三方平台 OAuth 未配置。自有公众号请使用下方 AppID + AppSecret 手动保存。";
      } else if (apiCode === "ENTERPRISE_WECHAT_OAUTH_TICKET_MISSING") {
        host.enterpriseOperationalIdentityError =
          "微信 component_verify_ticket 尚未就绪。请配置授权事件接收 URL 或临时设置 OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET。";
      } else {
        host.enterpriseOperationalIdentityError =
          error ?? (apiError || `启动${providerLabel} OAuth 失败。`);
      }
      return false;
    }
    if (payload.authorizeUrl) {
      const opened = openExternalUrlSafe(payload.authorizeUrl);
      if (!opened) {
        window.location.assign(payload.authorizeUrl);
      }
      if (providerSlug === "wechat-official" && payload.sessionId) {
        void pollEnterpriseWechatOfficialOAuthStatus(host, tenantId, payload.sessionId);
        host.enterpriseOperationalIdentityNotice =
          "已打开微信公众号外部登录页，请管理员扫码完成授权；完成后将自动刷新目录。";
      } else {
        host.enterpriseOperationalIdentityNotice =
          providerSlug === "wechat-official"
            ? "已打开微信公众号外部登录页，请管理员扫码完成授权；完成后点击刷新目录。"
            : `已打开${providerLabel}外部登录页，请完成登录授权；完成后点击刷新目录。`;
      }
    } else {
      host.enterpriseOperationalIdentityNotice =
        providerSlug === "wechat-official"
          ? "OAuth 会话已创建，但未返回授权链接，请检查微信第三方平台配置。"
          : `OAuth 会话已创建，但未返回授权链接，请检查 ${providerLabel} OAuth 配置。`;
    }
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function upsertEnterpriseOperationalIdentityCredential(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input: {
    connectorId: string;
    fields: Record<string, string>;
    allowMultiple?: boolean;
    credentialBindingId?: string;
    accountLabel?: string;
    externalAccountId?: string;
  },
): Promise<{ credentialBindingId: string } | null> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(host.basePath, tenantId, "/credentials/upsert"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      { ok: boolean; credentialBindingId?: string } | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok || !payload.credentialBindingId) {
      host.enterpriseOperationalIdentityError = error ?? "保存凭证配置失败。";
      return null;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = "凭证配置已保存，可继续连接身份。";
    return { credentialBindingId: payload.credentialBindingId };
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}

export async function createEnterpriseConnectorCredential(
  host: EnterpriseOperationalIdentityHost,
  tenantId: string,
  input: { connectorId: string; allowMultiple?: boolean },
): Promise<boolean> {
  host.enterpriseOperationalIdentityBusy = true;
  host.enterpriseOperationalIdentityError = null;
  host.enterpriseOperationalIdentityNotice = null;
  try {
    const response = await fetch(
      buildEnterpriseUrl(host.basePath, tenantId, "/credentials/create"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      },
    );
    const { payload, error } = await readEnterpriseOperationalIdentityPayload<
      { ok: boolean } | EnterpriseOperationalIdentityError
    >(response);
    if (error || !payload || !("ok" in payload) || !payload.ok) {
      host.enterpriseOperationalIdentityError = error ?? "绑定连接器凭证失败。";
      return false;
    }
    await loadEnterpriseOperationalIdentities(host, tenantId);
    host.enterpriseOperationalIdentityNotice = input.allowMultiple
      ? "已创建新的连接器凭证，可继续连接下一条企业身份。"
      : "连接器凭证已绑定，可在对应通道连接企业身份。";
    return true;
  } finally {
    host.enterpriseOperationalIdentityBusy = false;
  }
}
