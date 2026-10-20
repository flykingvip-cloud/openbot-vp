import {
  DEFAULT_ACCOUNT_ID,
  createAccountListHelpers,
  normalizeAccountId,
} from "openclaw/plugin-sdk/wecom";
import type { OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import type { ResolvedWecomAccount, WecomAccountConfig, WecomConnectionMode } from "./types.js";

const {
  listAccountIds: listWecomAccountIds,
  resolveDefaultAccountId: resolveDefaultWecomAccountId,
} = createAccountListHelpers("wecom");

export { listWecomAccountIds, resolveDefaultWecomAccountId };

const ENV_CORP_ID = "WECOM_CORP_ID";
const ENV_AGENT_ID = "WECOM_AGENT_ID";
const ENV_SECRET = "WECOM_SECRET";
const ENV_TOKEN = "WECOM_TOKEN";
const ENV_ENCODING_AES_KEY = "WECOM_ENCODING_AES_KEY";
const ENV_BOT_ID = "WECOM_BOT_ID";
const ENV_AIBOT_SECRET = "WECOM_AIBOT_SECRET";

function resolveConfiguredAccount(
  cfg: OpenBotConfig,
  accountId: string,
): WecomAccountConfig | undefined {
  const accounts = cfg.channels?.wecom?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId];
}

function mergeWecomAccountConfig(cfg: OpenBotConfig, accountId: string): WecomAccountConfig {
  const raw = cfg.channels?.wecom ?? {};
  const { accounts: _accounts, defaultAccount: _defaultAccount, ...base } = raw;
  const defaultAccountConfig = resolveConfiguredAccount(cfg, DEFAULT_ACCOUNT_ID) ?? {};
  const accountConfig = resolveConfiguredAccount(cfg, accountId) ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return { ...base, ...defaultAccountConfig } as WecomAccountConfig;
  }
  const {
    enabled: _enabled,
    corpId: _corpId,
    agentId: _agentId,
    secret: _secret,
    token: _token,
    encodingAesKey: _encodingAesKey,
    botId: _botId,
    ...defaultShared
  } = defaultAccountConfig;
  return { ...defaultShared, ...base, ...accountConfig } as WecomAccountConfig;
}

export function resolveWecomConnectionMode(value: unknown): WecomConnectionMode {
  return value === "websocket" ? "websocket" : "callback";
}

function resolveString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized || undefined;
}

function resolveAgentId(value: unknown): number | undefined {
  const normalized = resolveString(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveWecomAccount(params: {
  cfg: OpenBotConfig;
  accountId?: string | null;
}): ResolvedWecomAccount {
  const accountId = normalizeAccountId(params.accountId);
  const merged = mergeWecomAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.wecom?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;

  const connectionMode = resolveWecomConnectionMode(merged.connectionMode);
  const botId =
    resolveString(merged.botId) ??
    (accountId === DEFAULT_ACCOUNT_ID ? resolveString(process.env[ENV_BOT_ID]) : undefined);
  const corpId =
    resolveString(merged.corpId) ??
    (accountId === DEFAULT_ACCOUNT_ID ? resolveString(process.env[ENV_CORP_ID]) : undefined);
  const agentId =
    resolveAgentId(merged.agentId) ??
    (accountId === DEFAULT_ACCOUNT_ID ? resolveAgentId(process.env[ENV_AGENT_ID]) : undefined);
  const secret =
    resolveString(merged.secret) ??
    (accountId === DEFAULT_ACCOUNT_ID
      ? resolveString(
          connectionMode === "websocket"
            ? (process.env[ENV_AIBOT_SECRET] ?? process.env[ENV_SECRET])
            : process.env[ENV_SECRET],
        )
      : undefined);
  const token =
    resolveString(merged.token) ??
    (accountId === DEFAULT_ACCOUNT_ID ? resolveString(process.env[ENV_TOKEN]) : undefined);
  const encodingAesKey =
    resolveString(merged.encodingAesKey) ??
    (accountId === DEFAULT_ACCOUNT_ID
      ? resolveString(process.env[ENV_ENCODING_AES_KEY])
      : undefined);

  const configured =
    connectionMode === "websocket"
      ? Boolean(botId && secret)
      : Boolean(corpId && agentId && secret && token);
  return {
    accountId,
    name: resolveString(merged.name),
    enabled,
    config: merged,
    connectionMode,
    botId,
    corpId,
    agentId,
    secret,
    token,
    encodingAesKey,
    configured,
  };
}

export function listMissingWecomHardConfigFields(account: ResolvedWecomAccount): string[] {
  const missing: string[] = [];
  if (account.connectionMode === "websocket") {
    if (!account.botId) {
      missing.push("botId");
    }
    if (!account.secret) {
      missing.push("secret");
    }
    return missing;
  }
  if (!account.corpId) {
    missing.push("corpId");
  }
  if (account.agentId == null) {
    missing.push("agentId");
  }
  if (!account.secret) {
    missing.push("secret");
  }
  if (!account.token) {
    missing.push("token");
  }
  return missing;
}

export function listMissingWecomCallbackFields(account: ResolvedWecomAccount): string[] {
  if (account.connectionMode === "websocket") {
    return [];
  }
  const missing: string[] = [];
  if (!account.encodingAesKey) {
    missing.push("encodingAesKey");
  }
  if (!resolveWecomAccountWebhookPathHint(account)) {
    missing.push("webhookPath");
  }
  return missing;
}

function resolveWecomAccountWebhookPathHint(account: ResolvedWecomAccount): string | undefined {
  const fromConfig = resolveString(account.config.webhookPath);
  if (fromConfig) {
    return fromConfig;
  }
  const fromUrl = resolveString(account.config.webhookUrl);
  return fromUrl || undefined;
}

export function describeWecomUnconfiguredReason(account: ResolvedWecomAccount): string {
  const hard = listMissingWecomHardConfigFields(account);
  const soft = listMissingWecomCallbackFields(account);
  if (hard.length === 0) {
    return account.connectionMode === "websocket"
      ? "WeCom AIBot long connection requires botId and secret."
      : "WeCom requires corpId, agentId, secret, token, and a reachable webhook path.";
  }
  let message = `WeCom missing required fields: ${hard.join(", ")}.`;
  if (soft.length > 0) {
    message += ` Also set ${soft.join(", ")} for encrypted callbacks.`;
  }
  return message;
}
