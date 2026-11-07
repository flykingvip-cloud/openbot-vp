/**
 * Slice 1a contract for the existing 企业通道 page.
 *
 * Feishu app credentials stay on channels.feishu.accounts.<id>.
 * A connection check records the platform enterprise id (Feishu tenant_key)
 * and whether the app can attempt each checklist row. That is not employee
 * authorization, and it is not a Measured pass.
 *
 * Child employee execution (slice 1b) must read `enterpriseImChildExecutionBlocked`.
 * When the enterprise connection is missing or disabled, new execution is blocked.
 */

export type EnterpriseImCapabilityRowStatus = "granted" | "missing" | "unknown" | "not_checked";

export type EnterpriseImCapabilityStatus = {
  checkedAt: string;
  projectGroupRead: EnterpriseImCapabilityRowStatus;
  projectDocs: EnterpriseImCapabilityRowStatus;
  sendAsUser: EnterpriseImCapabilityRowStatus;
  newMessageTrigger: EnterpriseImCapabilityRowStatus;
};

/** What 个人设置「授权」 may show. Not an employee login and not a Measured result. */
export type EnterpriseImEmployeeUiHint =
  | "enterprise_not_open"
  | "waiting_admin_scopes"
  | "app_can_attempt";

export type EnterpriseImConnectionAuditKind =
  | "enable"
  | "disable"
  | "scope_change"
  | "connection_check";

export type EnterpriseImConnectionAuditEvent = {
  at: string;
  kind: EnterpriseImConnectionAuditKind;
  accountId?: string;
  ok?: boolean;
};

export type FeishuEnterpriseProbeObservation = {
  ok: boolean;
  /** Null when the tenant query did not return a tenant_key. Do not clear a stored id. */
  tenantKey: string | null;
  /** Null when the scope list could not be read. Empty array means the app returned no grants. */
  grantedScopeNames: string[] | null;
};

const AUDIT_LIMIT = 20;

const GROUP_READ_SCOPES = new Set([
  "im:message",
  "im:message:readonly",
  "im:message.group_msg",
  "im:message.group_msg:readonly",
  "im:message.history:readonly",
]);

const SEND_AS_USER_SCOPES = new Set(["im:message.send_as_user", "im:message:send_as_user"]);

const MESSAGE_BASE_SCOPES = new Set(["im:message", "im:message:readonly"]);

const TRIGGER_SCOPES = new Set([
  "im:message.group_at_msg",
  "im:message.group_at_msg:readonly",
  "im:message.p2p_msg",
  "im:message.p2p_msg:readonly",
  "im:message.receive_as_bot",
  "im:message.receive_v1",
]);

const DOC_PREFIXES = ["docx:", "drive:", "wiki:", "docs:"];

export function isEnterpriseImChildExecutionBlocked(
  channel: { enabled?: boolean } | null | undefined,
): boolean {
  if (!channel) {
    return true;
  }
  return channel.enabled === false;
}

export function classifyFeishuAppCapabilities(params: {
  grantedScopeNames: string[] | null;
  checkedAt: string;
}): EnterpriseImCapabilityStatus {
  if (params.grantedScopeNames === null) {
    return {
      checkedAt: params.checkedAt,
      projectGroupRead: "unknown",
      projectDocs: "unknown",
      sendAsUser: "unknown",
      newMessageTrigger: "unknown",
    };
  }
  const names = new Set(params.grantedScopeNames.map((name) => name.trim()).filter(Boolean));
  const has = (scope: string) => names.has(scope);
  const hasAny = (scopes: Set<string>) => [...scopes].some((scope) => has(scope));
  const docs = [...names].some((name) => DOC_PREFIXES.some((prefix) => name.startsWith(prefix)));
  return {
    checkedAt: params.checkedAt,
    projectGroupRead: hasAny(GROUP_READ_SCOPES) ? "granted" : "missing",
    projectDocs: docs ? "granted" : "missing",
    sendAsUser: hasAny(SEND_AS_USER_SCOPES) && hasAny(MESSAGE_BASE_SCOPES) ? "granted" : "missing",
    newMessageTrigger: hasAny(TRIGGER_SCOPES) ? "granted" : "missing",
  };
}

export function feishuEmployeeUiHint(params: {
  channel: { enabled?: boolean } | null | undefined;
  capability: EnterpriseImCapabilityStatus | null | undefined;
}): EnterpriseImEmployeeUiHint {
  if (isEnterpriseImChildExecutionBlocked(params.channel)) {
    return "enterprise_not_open";
  }
  const capability = params.capability;
  if (!capability) {
    return "waiting_admin_scopes";
  }
  const rows = [
    capability.projectGroupRead,
    capability.projectDocs,
    capability.sendAsUser,
    capability.newMessageTrigger,
  ];
  return rows.every((row) => row === "granted") ? "app_can_attempt" : "waiting_admin_scopes";
}

export function formatFeishuEmployeeUiHint(hint: EnterpriseImEmployeeUiHint): string {
  switch (hint) {
    case "enterprise_not_open":
      return "企业尚未开通";
    case "waiting_admin_scopes":
      return "等待管理员开通权限";
    case "app_can_attempt":
      return "应用权限可尝试（不是员工授权）";
  }
}

type ChannelRecord = {
  enabled?: boolean;
  accounts?: Record<string, Record<string, unknown>>;
  connectionAudit?: EnterpriseImConnectionAuditEvent[];
};

function channelMap(config: Record<string, unknown>): Record<string, ChannelRecord> {
  const channels = config.channels;
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) {
    config.channels = {};
  }
  return config.channels as Record<string, ChannelRecord>;
}

function feishuChannel(config: Record<string, unknown>): ChannelRecord {
  const channels = channelMap(config);
  const current = channels.feishu;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    channels.feishu = {};
  }
  return channels.feishu;
}

function appendAudit(channel: ChannelRecord, event: EnterpriseImConnectionAuditEvent): void {
  const prior = Array.isArray(channel.connectionAudit) ? channel.connectionAudit : [];
  channel.connectionAudit = [...prior, event].slice(-AUDIT_LIMIT);
}

function capabilityChanged(
  previous: EnterpriseImCapabilityStatus | undefined,
  next: EnterpriseImCapabilityStatus,
): boolean {
  if (!previous) {
    return true;
  }
  return (
    previous.projectGroupRead !== next.projectGroupRead ||
    previous.projectDocs !== next.projectDocs ||
    previous.sendAsUser !== next.sendAsUser ||
    previous.newMessageTrigger !== next.newMessageTrigger
  );
}

/**
 * Present a connection-check observation without writing config.
 * Used when the tenant save fails so the status payload still shows what the app can attempt.
 * A missing tenant_key does not replace a previously stored platform enterprise id.
 */
export function presentFeishuEnterpriseObservation(params: {
  observation: FeishuEnterpriseProbeObservation;
  channelEnabled: boolean;
  nowIso: string;
  storedPlatformEnterpriseId?: string | null;
}): {
  platformEnterpriseId: string | null;
  capabilityStatus: EnterpriseImCapabilityStatus;
  childExecutionBlocked: boolean;
  employeeUiHint: EnterpriseImEmployeeUiHint;
} {
  const capabilityStatus = classifyFeishuAppCapabilities({
    grantedScopeNames: params.observation.grantedScopeNames,
    checkedAt: params.nowIso,
  });
  const channel = { enabled: params.channelEnabled };
  const platformEnterpriseId =
    params.observation.tenantKey ??
    (params.storedPlatformEnterpriseId?.trim() ? params.storedPlatformEnterpriseId.trim() : null);
  return {
    platformEnterpriseId,
    capabilityStatus,
    childExecutionBlocked: isEnterpriseImChildExecutionBlocked(channel),
    employeeUiHint: feishuEmployeeUiHint({ channel, capability: capabilityStatus }),
  };
}

/** Apply a Feishu connection-check observation onto the tenant config view. */
export function applyFeishuEnterpriseObservation(params: {
  config: Record<string, unknown>;
  accountId: string;
  observation: FeishuEnterpriseProbeObservation;
  nowIso: string;
}): {
  platformEnterpriseId: string | null;
  capabilityStatus: EnterpriseImCapabilityStatus;
  childExecutionBlocked: boolean;
  employeeUiHint: EnterpriseImEmployeeUiHint;
} {
  const channel = feishuChannel(params.config);
  const accounts = channel.accounts ?? {};
  channel.accounts = accounts;
  const existing = accounts[params.accountId];
  const account = existing ? { ...existing } : {};
  const previousCapability = account.capabilityStatus as EnterpriseImCapabilityStatus | undefined;
  const capabilityStatus = classifyFeishuAppCapabilities({
    grantedScopeNames: params.observation.grantedScopeNames,
    checkedAt: params.nowIso,
  });
  if (params.observation.tenantKey) {
    account.platformEnterpriseId = params.observation.tenantKey;
  }
  account.capabilityStatus = capabilityStatus;
  accounts[params.accountId] = account;
  appendAudit(channel, {
    at: params.nowIso,
    kind: "connection_check",
    accountId: params.accountId,
    ok: params.observation.ok,
  });
  if (params.observation.ok && capabilityChanged(previousCapability, capabilityStatus)) {
    appendAudit(channel, {
      at: params.nowIso,
      kind: "scope_change",
      accountId: params.accountId,
      ok: true,
    });
  }
  const childExecutionBlocked = isEnterpriseImChildExecutionBlocked(channel);
  return {
    platformEnterpriseId:
      typeof account.platformEnterpriseId === "string" ? account.platformEnterpriseId : null,
    capabilityStatus,
    childExecutionBlocked,
    employeeUiHint: feishuEmployeeUiHint({ channel, capability: capabilityStatus }),
  };
}

function channelEnabled(channel: ChannelRecord | undefined): boolean | null {
  if (!channel) {
    return null;
  }
  return channel.enabled !== false;
}

function readFeishuChannel(config: Record<string, unknown>): ChannelRecord | undefined {
  const channels = config.channels;
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) {
    return undefined;
  }
  const feishu = (channels as Record<string, ChannelRecord>).feishu;
  if (!feishu || typeof feishu !== "object" || Array.isArray(feishu)) {
    return undefined;
  }
  return feishu;
}

/** Record enable/disable on a tenant config.set of the existing 企业通道 form. */
export function appendFeishuEnterpriseConfigAudit(params: {
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
  nowIso: string;
}): void {
  const previousFeishu = readFeishuChannel(params.previous);
  const nextFeishu = readFeishuChannel(params.next);
  if (!nextFeishu) {
    return;
  }
  const before = channelEnabled(previousFeishu);
  const after = channelEnabled(nextFeishu);
  if (before !== false && after === false) {
    appendAudit(nextFeishu, { at: params.nowIso, kind: "disable", ok: true });
    return;
  }
  if (!previousFeishu && after === true) {
    appendAudit(nextFeishu, { at: params.nowIso, kind: "enable", ok: true });
    return;
  }
  if (previousFeishu?.enabled === false && after === true) {
    appendAudit(nextFeishu, { at: params.nowIso, kind: "enable", ok: true });
  }
}

export function readFeishuEnterpriseChannelContract(params: {
  config: Record<string, unknown> | null | undefined;
  accountId?: string | null;
}): {
  childExecutionBlocked: boolean;
  employeeUiHint: EnterpriseImEmployeeUiHint;
  platformEnterpriseId: string | null;
  capabilityStatus: EnterpriseImCapabilityStatus | null;
} {
  const channels = params.config?.channels;
  const feishu =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? (channels as Record<string, ChannelRecord>).feishu
      : undefined;
  const accounts = feishu?.accounts ?? {};
  const accountId = params.accountId?.trim();
  const account = accountId ? accounts[accountId] : undefined;
  const capability = account?.capabilityStatus as EnterpriseImCapabilityStatus | undefined;
  const platformEnterpriseId =
    typeof account?.platformEnterpriseId === "string" && account.platformEnterpriseId.trim()
      ? account.platformEnterpriseId.trim()
      : null;
  return {
    childExecutionBlocked: isEnterpriseImChildExecutionBlocked(feishu),
    employeeUiHint: feishuEmployeeUiHint({ channel: feishu, capability }),
    platformEnterpriseId,
    capabilityStatus: capability ?? null,
  };
}
