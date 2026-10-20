import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChannelAccountSnapshot, ChannelsStatusSnapshot } from "../types.ts";

/** IM connectors that participate in enterprise channel ↔ operational-identity bridge. */
export const ENTERPRISE_IM_CHANNEL_IDS = ["wecom", "feishu", "dingtalk"] as const;
export type EnterpriseImChannelId = (typeof ENTERPRISE_IM_CHANNEL_IDS)[number];

export type TenantImCallbackEntry = {
  accountId: string;
  path: string;
  url: string;
  copyText: string;
};

export type TenantImProbeTone = "ok" | "warn" | "fail" | "not_running";

export type TenantImProbeResult = {
  channelId: string;
  tone: TenantImProbeTone;
  summary: string;
  hint: string | null;
  accounts: Array<{
    accountId: string;
    running: boolean;
    configured: boolean;
    lastError: string | null;
  }>;
};

export type TenantImBindingProbeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tenantImProbeBusy: boolean;
  tenantImProbeResult: TenantImProbeResult | null;
  tenantImProbeError: string | null;
  /** Optional: tenant form used to gate probe before calling the gateway. */
  tenantConfigForm?: Record<string, unknown> | null;
  tenantConfigDirty?: boolean;
};

export function isEnterpriseImChannelId(channelId: string | null | undefined): boolean {
  return (
    typeof channelId === "string" &&
    (ENTERPRISE_IM_CHANNEL_IDS as readonly string[]).includes(channelId)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readChannelAccounts(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
): Record<string, Record<string, unknown>> {
  const channels = asRecord(form?.channels);
  const channel = asRecord(channels?.[channelId]);
  const accounts = asRecord(channel?.accounts);
  if (!accounts) {
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [accountId, raw] of Object.entries(accounts)) {
    const acct = asRecord(raw);
    if (acct) {
      out[accountId] = acct;
    }
  }
  return out;
}

/** Default account-scoped webhook path (mirrors ensureImAccountWebhookPaths). */
export function defaultImWebhookPath(channelId: string, accountId: string): string {
  const prefix =
    channelId === "wecom"
      ? "wecom"
      : channelId === "feishu"
        ? "feishu"
        : channelId === "dingtalk"
          ? "dingtalk"
          : channelId;
  return `/${prefix}/a/${encodeURIComponent(accountId)}`;
}

function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function resolvePublicBaseUrl(params: {
  accountWebhookUrl?: string | null;
  publicBaseUrl?: string | null;
}): string {
  const override = params.accountWebhookUrl?.trim();
  if (override) {
    try {
      return new URL(override).origin;
    } catch {
      // fall through
    }
  }
  const configured = params.publicBaseUrl?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

/**
 * Derive LangHub-style callback URLs for a tenant IM channel from config form.
 * Prefer account `webhookUrl` when set; otherwise join public base + webhookPath.
 */
export function resolveTenantImCallbackEntries(params: {
  form: Record<string, unknown> | null | undefined;
  channelId: string;
  publicBaseUrl?: string | null;
  /** Prefer this account (tenant primary). Falls back to first unique URL. */
  accountId?: string | null;
}): TenantImCallbackEntry[] {
  if (!isEnterpriseImChannelId(params.channelId)) {
    return [];
  }
  const accounts = readChannelAccounts(params.form, params.channelId);
  const entries: TenantImCallbackEntry[] = [];
  for (const [accountId, acct] of Object.entries(accounts)) {
    const rawPath = typeof acct.webhookPath === "string" ? acct.webhookPath.trim() : "";
    const path = normalizeWebhookPath(rawPath || defaultImWebhookPath(params.channelId, accountId));
    const accountWebhookUrl =
      typeof acct.webhookUrl === "string" && acct.webhookUrl.trim() ? acct.webhookUrl.trim() : null;
    if (accountWebhookUrl) {
      entries.push({
        accountId,
        path,
        url: accountWebhookUrl,
        copyText: accountWebhookUrl,
      });
      continue;
    }
    const base = resolvePublicBaseUrl({
      publicBaseUrl: params.publicBaseUrl,
    });
    const url = base ? `${base.replace(/\/$/u, "")}${path}` : path;
    entries.push({
      accountId,
      path,
      url,
      copyText: url,
    });
  }

  const focusAccountId = params.accountId?.trim();
  if (focusAccountId) {
    const focused = entries.find((entry) => entry.accountId === focusAccountId);
    if (focused) {
      return [focused];
    }
  }

  // Collapse legacy duplicates (e.g. t_*_default + default sharing one webhookUrl).
  const seen = new Set<string>();
  const unique: TenantImCallbackEntry[] = [];
  for (const entry of entries) {
    const key = entry.url.trim() || entry.path;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

/** Short activation guidance shown next to Test (LangHub pending pattern). */
export function resolveTenantImPendingHint(channelId: string): string {
  switch (channelId) {
    case "wecom":
      return "若状态为 pending / 收不到事件：先确认应用可见范围，再向机器人发一条私聊；群聊需将机器人拉入群。";
    case "feishu":
      return "若事件未到达：先在飞书开放平台粘贴回调 URL 并保存；单聊先给机器人发消息，群聊每次需 @机器人。";
    case "dingtalk":
      return "若未连通：确认 Stream/HTTP 模式与开放平台回调一致；私聊先发一条消息激活，群聊需 @机器人。";
    default:
      return "保存凭证后，将 Callback URL 回填到开放平台事件订阅，再点击「测试连通」。";
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function listAccountCredentialCandidates(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
): Array<{ accountId: string; acct: Record<string, unknown> }> {
  const accounts = readChannelAccounts(form, channelId);
  const named = Object.entries(accounts).map(([accountId, acct]) => ({ accountId, acct }));
  if (named.length > 0) {
    return named;
  }
  const channel = asRecord(asRecord(form?.channels)?.[channelId]);
  return channel ? [{ accountId: "default", acct: channel }] : [];
}

function missingFieldsForImAccount(channelId: string, acct: Record<string, unknown>): string[] {
  if (channelId === "wecom") {
    const mode =
      acct.connectionMode === "websocket"
        ? "websocket"
        : acct.connectionMode === "callback"
          ? "callback"
          : nonEmptyString(acct.botId) && !nonEmptyString(acct.corpId)
            ? "websocket"
            : "callback";
    if (mode === "websocket") {
      const missing: string[] = [];
      if (!nonEmptyString(acct.botId)) {
        missing.push("botId");
      }
      if (!nonEmptyString(acct.secret)) {
        missing.push("secret");
      }
      return missing;
    }
    const missing: string[] = [];
    if (!nonEmptyString(acct.corpId)) {
      missing.push("corpId");
    }
    if (!(nonEmptyString(acct.agentId) || typeof acct.agentId === "number")) {
      missing.push("agentId");
    }
    if (!nonEmptyString(acct.secret)) {
      missing.push("secret");
    }
    if (!nonEmptyString(acct.token)) {
      missing.push("token");
    }
    if (!nonEmptyString(acct.encodingAesKey)) {
      missing.push("encodingAesKey");
    }
    return missing;
  }
  if (channelId === "feishu") {
    const missing: string[] = [];
    if (!nonEmptyString(acct.appId)) {
      missing.push("appId");
    }
    if (!nonEmptyString(acct.appSecret)) {
      missing.push("appSecret");
    }
    // Webhook mode requires verificationToken (gateway monitor enforces the same).
    if (acct.connectionMode === "webhook" && !nonEmptyString(acct.verificationToken)) {
      missing.push("verificationToken");
    }
    return missing;
  }
  if (channelId === "dingtalk") {
    const missing: string[] = [];
    if (!(nonEmptyString(acct.clientId) || nonEmptyString(acct.appKey))) {
      missing.push("clientId");
    }
    if (!(nonEmptyString(acct.clientSecret) || nonEmptyString(acct.appSecret))) {
      missing.push("clientSecret");
    }
    return missing;
  }
  return [];
}

/**
 * Returns a Chinese validation message when any IM account under the channel is
 * incomplete. Null means every present account has the required fields.
 */
export function describeTenantImCredentialGaps(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
  options?: { accountId?: string },
): string | null {
  if (!isEnterpriseImChannelId(channelId)) {
    return null;
  }
  let candidates = listAccountCredentialCandidates(form, channelId);
  const focusAccountId = options?.accountId?.trim();
  if (focusAccountId) {
    const focused = candidates.find((entry) => entry.accountId === focusAccountId);
    if (focused) {
      candidates = [focused];
    } else {
      const accounts = readChannelAccounts(form, channelId);
      const hasNamedAccounts = Object.keys(accounts).length > 0;
      // Legacy channel-root credentials (no accounts map): keep the synthetic "default"
      // candidate instead of treating a missing tenant account id as empty.
      if (hasNamedAccounts || candidates.length === 0) {
        candidates = [
          { accountId: focusAccountId, acct: asRecord(accounts[focusAccountId]) ?? {} },
        ];
      }
    }
  }
  if (candidates.length === 0) {
    return "请先添加渠道账户并填写必填凭证，再保存或测试。";
  }
  const gaps: string[] = [];
  for (const { accountId, acct } of candidates) {
    const missing = missingFieldsForImAccount(channelId, acct);
    if (missing.length > 0) {
      gaps.push(`账户 ${accountId} 缺少 ${missing.join("、")}`);
    }
  }
  if (gaps.length === 0) {
    return null;
  }
  const channelLabel =
    channelId === "wecom" ? "企业微信" : channelId === "feishu" ? "飞书" : "钉钉";
  return `${channelLabel}凭证未配齐：${gaps.join("；")}。请在上方表单补全后再保存 / 测试。`;
}

/**
 * Lightweight client-side check: whether every tenant IM account has required secrets.
 * Does not call the gateway.
 */
export function hasTenantImChannelCredentials(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
): boolean {
  return describeTenantImCredentialGaps(form, channelId) === null;
}

export function clearTenantImProbeState(state: {
  tenantImProbeResult?: TenantImProbeResult | null;
  tenantImProbeError?: string | null;
  tenantImProbeBusy?: boolean;
}): void {
  state.tenantImProbeResult = null;
  state.tenantImProbeError = null;
  state.tenantImProbeBusy = false;
}

/** Localize well-known plugin unconfigured reasons for the enterprise IM panel. */
export function localizeTenantImProbeError(channelId: string, raw: string): string {
  const text = raw.trim();
  if (channelId !== "wecom") {
    return text;
  }
  if (text === "WeCom requires corpId, agentId, secret, token, and a reachable webhook path.") {
    return "企业微信需要填写 corpId、agentId、secret、token，以及可访问的 webhookPath。";
  }
  if (text === "WeCom AIBot long connection requires botId and secret.") {
    return "企业微信长连接需要填写 Bot ID 与 Secret。";
  }
  if (text.startsWith("WeCom AIBot subscribe failed:")) {
    return text.replace("WeCom AIBot subscribe failed:", "企业微信长连接鉴权失败：");
  }
  if (text.startsWith("WeCom AIBot subscribe timed out")) {
    return "企业微信长连接鉴权超时，请检查 Bot ID / Secret 与网络连通性。";
  }
  if (text.startsWith("WeCom AIBot websocket")) {
    return text
      .replace("WeCom AIBot websocket error:", "企业微信长连接 WebSocket 错误：")
      .replace(
        "WeCom AIBot websocket closed before subscribe ack.",
        "企业微信长连接在鉴权完成前断开。",
      );
  }
  const detailed = text.match(
    /^WeCom missing required fields: ([^.]+)\.(?: Also set ([^.]+)\.)?$/u,
  );
  if (detailed?.[1]) {
    const callbackHint = detailed[2] ? ` 回调还需填写：${detailed[2]}。` : "";
    return `企业微信凭证未配齐，缺少：${detailed[1]}。${callbackHint}`.trim();
  }
  return text;
}

/** Summarize a channels.status snapshot for one IM channel (UI soft-bridge). */
export function summarizeTenantImProbeFromSnapshot(
  channelId: string,
  snapshot: ChannelsStatusSnapshot | null | undefined,
): TenantImProbeResult {
  return summarizeProbeAccounts(channelId, snapshot?.channelAccounts?.[channelId] ?? []);
}

function readAccountProbe(acct: ChannelAccountSnapshot): {
  ok: boolean | null;
  error: string | null;
} {
  const probe = acct.probe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return { ok: null, error: null };
  }
  const record = probe as { ok?: unknown; error?: unknown };
  const ok = typeof record.ok === "boolean" ? record.ok : null;
  const error =
    typeof record.error === "string" && record.error.trim() ? record.error.trim() : null;
  return { ok, error };
}

function summarizeProbeAccounts(
  channelId: string,
  accounts: ChannelAccountSnapshot[],
): TenantImProbeResult {
  if (accounts.length === 0) {
    return {
      channelId,
      tone: "not_running",
      summary: "未找到该渠道的租户账户。请先保存凭证。",
      hint: resolveTenantImPendingHint(channelId),
      accounts: [],
    };
  }
  const mapped = accounts.map((acct) => {
    const probe = readAccountProbe(acct);
    const runtimeError =
      typeof acct.lastError === "string" && acct.lastError.trim() ? acct.lastError : null;
    // Dedicated probe outcome wins over stale runtime lastError.
    const lastError =
      probe.ok === false ? (probe.error ?? runtimeError) : probe.ok === true ? null : runtimeError;
    return {
      accountId: acct.accountId,
      running: acct.running === true || acct.connected === true || probe.ok === true,
      configured: acct.configured !== false,
      lastError,
      probeOk: probe.ok,
    };
  });
  const accountsOut = mapped.map(({ accountId, running, configured, lastError }) => ({
    accountId,
    running,
    configured,
    lastError,
  }));
  const unconfigured = mapped.find((a) => !a.configured);
  const probeFailed = mapped.find((a) => a.probeOk === false);
  const anyError = mapped.find((a) => a.lastError);
  const probePassed = mapped.some((a) => a.probeOk === true);
  const anyRunning = mapped.some((a) => a.running);
  const anyConfigured = mapped.some((a) => a.configured);
  if (unconfigured || probeFailed || anyError) {
    const raw =
      unconfigured?.lastError ??
      probeFailed?.lastError ??
      anyError?.lastError ??
      "账户凭证未配齐（corpId / agentId / secret / token）。";
    return {
      channelId,
      tone: "fail",
      summary: `测试未通过：${localizeTenantImProbeError(channelId, raw)}`,
      hint: resolveTenantImPendingHint(channelId),
      accounts: accountsOut,
    };
  }
  if (probePassed) {
    return {
      channelId,
      tone: "ok",
      summary:
        channelId === "wecom" ? "长连接鉴权通过（已完成 AIBot subscribe）。" : "连通测试通过。",
      hint: null,
      accounts: accountsOut,
    };
  }
  if (anyRunning) {
    return {
      channelId,
      tone: "ok",
      summary: "连通正常（账户在当前 gateway 运行时可见）。",
      hint: null,
      accounts: accountsOut,
    };
  }
  if (anyConfigured) {
    return {
      channelId,
      tone: "warn",
      summary: "凭证已配置，但当前 gateway 未见运行中实例（可能尚未激活或非独立租户 runtime）。",
      hint: resolveTenantImPendingHint(channelId),
      accounts: accountsOut,
    };
  }
  return {
    channelId,
    tone: "not_running",
    summary: "账户未配置或未运行。",
    hint: resolveTenantImPendingHint(channelId),
    accounts: accountsOut,
  };
}

/** Probe tenant IM channel via channels.status({ tenantId, probe: true }). */
export async function probeTenantImChannel(
  state: TenantImBindingProbeState,
  params: { tenantId: string; channelId: string },
): Promise<TenantImProbeResult | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const tenantId = params.tenantId.trim();
  const channelId = params.channelId.trim();
  if (!tenantId || !channelId) {
    return null;
  }
  state.tenantImProbeBusy = true;
  state.tenantImProbeError = null;
  try {
    // Gate in the config flow: unsaved edits / incomplete credentials fail the
    // explicit test action — never surface as ambient post-load alarms.
    if (state.tenantConfigDirty) {
      const result: TenantImProbeResult = {
        channelId,
        tone: "fail",
        summary: "测试未通过：还有未保存的修改。请先保存凭证，再测试连通。",
        hint: resolveTenantImPendingHint(channelId),
        accounts: [],
      };
      state.tenantImProbeResult = result;
      return result;
    }
    const gap = describeTenantImCredentialGaps(state.tenantConfigForm, channelId);
    if (gap) {
      const result: TenantImProbeResult = {
        channelId,
        tone: "fail",
        summary: `测试未通过：${gap}`,
        hint: resolveTenantImPendingHint(channelId),
        accounts: [],
      };
      state.tenantImProbeResult = result;
      return result;
    }

    const res = await state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
      tenantId,
      probe: true,
      timeoutMs: 8000,
    });
    const accounts = res?.channelAccounts?.[channelId] ?? [];
    const result = summarizeProbeAccounts(channelId, accounts);
    state.tenantImProbeResult = result;
    return result;
  } catch (err) {
    state.tenantImProbeError = String(err);
    state.tenantImProbeResult = {
      channelId,
      tone: "fail",
      summary: `测试未通过：${String(err)}`,
      hint: resolveTenantImPendingHint(channelId),
      accounts: [],
    };
    return state.tenantImProbeResult;
  } finally {
    state.tenantImProbeBusy = false;
  }
}
