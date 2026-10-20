import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/compat";
import type { OpenBotConfig } from "openclaw/plugin-sdk/compat";
import type {
  ResolvedDingtalkAccount,
  DingtalkAccountConfig,
  DingtalkConnectionMode,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveChannelBlock(cfg: OpenBotConfig): Record<string, unknown> | null {
  const channels = cfg?.channels;
  if (!isRecord(channels)) return null;
  const dingtalk = channels.dingtalk;
  if (!isRecord(dingtalk)) return null;
  return dingtalk as Record<string, unknown>;
}

export function listDingtalkAccountIds(cfg: OpenBotConfig): string[] {
  const block = resolveChannelBlock(cfg);
  if (!block) return [DEFAULT_ACCOUNT_ID];
  const accounts = block.accounts;
  if (!isRecord(accounts)) return [DEFAULT_ACCOUNT_ID];
  const ids = Object.keys(accounts).filter((id) => id.trim());
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultDingtalkAccountId(cfg: OpenBotConfig): string {
  const block = resolveChannelBlock(cfg);
  if (!block) return DEFAULT_ACCOUNT_ID;
  const defaultAccount = block.defaultAccount;
  if (typeof defaultAccount === "string" && defaultAccount.trim()) {
    return defaultAccount.trim();
  }
  return DEFAULT_ACCOUNT_ID;
}

export function resolveDingtalkAccount(params: {
  cfg: OpenBotConfig;
  accountId?: string | null;
}): ResolvedDingtalkAccount {
  const { cfg, accountId } = params;
  const resolvedAccountId = accountId?.trim() || resolveDefaultDingtalkAccountId(cfg);
  const block = resolveChannelBlock(cfg);

  let accountConfig: DingtalkAccountConfig;

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID || !block?.accounts) {
    accountConfig = {
      enabled: block?.enabled !== false,
      name: typeof block?.name === "string" ? block.name : null,
      clientId: typeof block?.clientId === "string" ? block.clientId : "",
      clientSecret: typeof block?.clientSecret === "string" ? block.clientSecret : undefined,
      connectionMode: block?.connectionMode === "webhook" ? "webhook" : "stream",
      robotCode: typeof block?.robotCode === "string" ? block.robotCode : undefined,
      webhookPath: typeof block?.webhookPath === "string" ? block.webhookPath : undefined,
      webhookUrl: typeof block?.webhookUrl === "string" ? block.webhookUrl : undefined,
      defaultTo: typeof block?.defaultTo === "string" ? block.defaultTo : undefined,
      dm: isRecord(block?.dm) ? (block.dm as DingtalkAccountConfig["dm"]) : undefined,
      textChunkLimit: typeof block?.textChunkLimit === "number" ? block.textChunkLimit : undefined,
    } as DingtalkAccountConfig;
  } else {
    const accounts = block.accounts as Record<string, unknown>;
    const raw = accounts[resolvedAccountId];
    if (!isRecord(raw)) {
      return {
        accountId: resolvedAccountId,
        name: null,
        enabled: false,
        configured: false,
        config: { clientId: "" },
        clientId: "",
        clientSecret: "",
        connectionMode: "stream",
        robotCode: null,
      };
    }
    accountConfig = {
      enabled: raw.enabled !== false,
      name: typeof raw.name === "string" ? raw.name : null,
      clientId:
        typeof raw.clientId === "string"
          ? raw.clientId
          : typeof block?.clientId === "string"
            ? block.clientId
            : "",
      clientSecret:
        typeof raw.clientSecret === "string"
          ? raw.clientSecret
          : typeof block?.clientSecret === "string"
            ? block.clientSecret
            : undefined,
      connectionMode:
        raw.connectionMode === "webhook"
          ? "webhook"
          : block?.connectionMode === "webhook"
            ? "webhook"
            : "stream",
      robotCode:
        typeof raw.robotCode === "string"
          ? raw.robotCode
          : typeof block?.robotCode === "string"
            ? block.robotCode
            : undefined,
      webhookPath: typeof raw.webhookPath === "string" ? raw.webhookPath : undefined,
      webhookUrl: typeof raw.webhookUrl === "string" ? raw.webhookUrl : undefined,
      defaultTo: typeof raw.defaultTo === "string" ? raw.defaultTo : undefined,
      dm: isRecord(raw.dm) ? (raw.dm as DingtalkAccountConfig["dm"]) : undefined,
      textChunkLimit: typeof raw.textChunkLimit === "number" ? raw.textChunkLimit : undefined,
    } as DingtalkAccountConfig;
  }

  const clientId = accountConfig.clientId ?? "";
  const clientSecret = accountConfig.clientSecret ?? "";
  const connectionMode: DingtalkConnectionMode = accountConfig.connectionMode ?? "stream";
  const configured = Boolean(clientId && clientSecret);

  return {
    accountId: resolvedAccountId,
    name: accountConfig.name ?? null,
    enabled: accountConfig.enabled !== false,
    configured,
    config: accountConfig,
    clientId,
    clientSecret,
    connectionMode,
    robotCode: accountConfig.robotCode ?? null,
  };
}
