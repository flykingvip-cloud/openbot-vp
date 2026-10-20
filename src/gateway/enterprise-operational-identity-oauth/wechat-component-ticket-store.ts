import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

export const WECHAT_COMPONENT_TICKET_STORE_VERSION = 1;

export type WechatComponentTicketStore = {
  version: number;
  componentAppId?: string;
  verifyTicket?: string;
  updatedAt?: string;
};

const DEFAULT_TICKET_FILENAME = "openbot-enterprise-wechat-component-ticket.json";

let cachedTicket: WechatComponentTicketStore | null = null;

export function resolveDefaultWechatComponentTicketStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_TICKET_FILENAME);
}

export function normalizeWechatComponentTicketStore(
  parsed: Partial<WechatComponentTicketStore> | null | undefined,
): WechatComponentTicketStore {
  return {
    version: parsed?.version ?? WECHAT_COMPONENT_TICKET_STORE_VERSION,
    componentAppId: parsed?.componentAppId?.trim() || undefined,
    verifyTicket: parsed?.verifyTicket?.trim() || undefined,
    updatedAt: parsed?.updatedAt?.trim() || undefined,
  };
}

export async function loadWechatComponentTicketStore(
  storePath?: string,
): Promise<WechatComponentTicketStore> {
  if (!storePath && cachedTicket) {
    return cachedTicket;
  }
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultWechatComponentTicketStorePath(),
  );
  const parsed = await readJsonFile<Partial<WechatComponentTicketStore>>(resolvedPath);
  const normalized = normalizeWechatComponentTicketStore(parsed);
  if (!storePath) {
    cachedTicket = normalized;
  }
  return normalized;
}

export async function saveWechatComponentVerifyTicket(params: {
  componentAppId: string;
  verifyTicket: string;
  nowIso: string;
  storePath?: string;
}): Promise<WechatComponentTicketStore> {
  const store: WechatComponentTicketStore = {
    version: WECHAT_COMPONENT_TICKET_STORE_VERSION,
    componentAppId: params.componentAppId.trim(),
    verifyTicket: params.verifyTicket.trim(),
    updatedAt: params.nowIso,
  };
  const resolvedPath = resolveUserPath(
    params.storePath?.trim() || resolveDefaultWechatComponentTicketStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
  if (!params.storePath) {
    cachedTicket = store;
  }
  return store;
}

export function resolveWechatComponentVerifyTicketFromEnvOrCache(
  store?: WechatComponentTicketStore | null,
): string | null {
  const fromEnv = process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const expectedAppId = process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_APPID?.trim();
  const ticket = store?.verifyTicket?.trim();
  if (!ticket) {
    return null;
  }
  if (expectedAppId && store?.componentAppId && store.componentAppId !== expectedAppId) {
    return null;
  }
  return ticket;
}

export function clearWechatComponentTicketStoreCache(): void {
  cachedTicket = null;
}
