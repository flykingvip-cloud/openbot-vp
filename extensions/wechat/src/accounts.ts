import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/compat";
import type { OpenBotConfig } from "openclaw/plugin-sdk/compat";
import type { ResolvedWechatAccount, WechatAccountConfig, WechatDeviceType } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveChannelBlock(cfg: OpenBotConfig): Record<string, unknown> | null {
  const channels = cfg?.channels;
  if (!isRecord(channels)) return null;
  const wechat = channels.wechat;
  if (!isRecord(wechat)) return null;
  return wechat as Record<string, unknown>;
}

export function listWechatAccountIds(cfg: OpenBotConfig): string[] {
  const block = resolveChannelBlock(cfg);
  if (!block) return [DEFAULT_ACCOUNT_ID];
  const accounts = block.accounts;
  if (!isRecord(accounts)) return [DEFAULT_ACCOUNT_ID];
  const ids = Object.keys(accounts).filter((id) => id.trim());
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultWechatAccountId(cfg: OpenBotConfig): string {
  const block = resolveChannelBlock(cfg);
  if (!block) return DEFAULT_ACCOUNT_ID;
  const defaultAccount = block.defaultAccount;
  if (typeof defaultAccount === "string" && defaultAccount.trim()) {
    return defaultAccount.trim();
  }
  return DEFAULT_ACCOUNT_ID;
}

export function resolveWechatAccount(params: {
  cfg: OpenBotConfig;
  accountId?: string | null;
}): ResolvedWechatAccount {
  const { cfg, accountId } = params;
  const resolvedAccountId = accountId?.trim() || resolveDefaultWechatAccountId(cfg);
  const block = resolveChannelBlock(cfg);

  let accountConfig: WechatAccountConfig;

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID || !block?.accounts) {
    accountConfig = {
      enabled: block?.enabled !== false,
      name: typeof block?.name === "string" ? block.name : null,
      apiKey: typeof block?.apiKey === "string" ? block.apiKey : "",
      proxyUrl: typeof block?.proxyUrl === "string" ? block.proxyUrl : "",
      webhookHost: typeof block?.webhookHost === "string" ? block.webhookHost : undefined,
      webhookPort: typeof block?.webhookPort === "number" ? block.webhookPort : undefined,
      webhookPath: typeof block?.webhookPath === "string" ? block.webhookPath : undefined,
      deviceType: block?.deviceType === "mac" ? "mac" : undefined,
      defaultTo: typeof block?.defaultTo === "string" ? block.defaultTo : undefined,
      dm: isRecord(block?.dm) ? (block.dm as WechatAccountConfig["dm"]) : undefined,
      textChunkLimit: typeof block?.textChunkLimit === "number" ? block.textChunkLimit : undefined,
    } as WechatAccountConfig;
  } else {
    const accounts = block!.accounts as Record<string, unknown>;
    const raw = accounts[resolvedAccountId];
    if (!isRecord(raw)) {
      return {
        accountId: resolvedAccountId,
        name: null,
        enabled: false,
        configured: false,
        config: { apiKey: "", proxyUrl: "" },
        apiKey: "",
        proxyUrl: "",
        webhookHost: null,
        webhookPort: 18789,
        webhookPath: "/webhook/wechat",
        deviceType: "ipad",
      };
    }
    accountConfig = {
      enabled: raw.enabled !== false,
      name: typeof raw.name === "string" ? raw.name : null,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      proxyUrl:
        typeof raw.proxyUrl === "string"
          ? raw.proxyUrl
          : typeof block?.proxyUrl === "string"
            ? block.proxyUrl
            : "",
      webhookHost:
        typeof raw.webhookHost === "string"
          ? raw.webhookHost
          : typeof block?.webhookHost === "string"
            ? block.webhookHost
            : undefined,
      webhookPort: typeof raw.webhookPort === "number" ? raw.webhookPort : undefined,
      webhookPath: typeof raw.webhookPath === "string" ? raw.webhookPath : undefined,
      deviceType: raw.deviceType === "mac" ? "mac" : undefined,
      defaultTo: typeof raw.defaultTo === "string" ? raw.defaultTo : undefined,
      dm: isRecord(raw.dm) ? (raw.dm as WechatAccountConfig["dm"]) : undefined,
      textChunkLimit: typeof raw.textChunkLimit === "number" ? raw.textChunkLimit : undefined,
    } as WechatAccountConfig;
  }

  const apiKey = accountConfig.apiKey ?? "";
  const proxyUrl = accountConfig.proxyUrl ?? "";
  // Personal WeChat is worker-backed. Do not require LIVE channels.wechat.proxyUrl.
  const configured = true;
  const deviceType: WechatDeviceType = accountConfig.deviceType ?? "ipad";

  return {
    accountId: resolvedAccountId,
    name: accountConfig.name ?? null,
    enabled: accountConfig.enabled !== false,
    configured,
    config: accountConfig,
    apiKey,
    proxyUrl,
    webhookHost: accountConfig.webhookHost ?? null,
    webhookPort: accountConfig.webhookPort ?? 18789,
    webhookPath: accountConfig.webhookPath ?? "/webhook/wechat",
    deviceType,
  };
}
