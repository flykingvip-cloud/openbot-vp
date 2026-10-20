import { loadConfig } from "../config/config.js";
import {
  findUserByEmail,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import { resolveTrustedAttribution } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";

export async function resolveTrustedPlatformAuthUserId(
  client: GatewayClient | null,
): Promise<string | null> {
  const email = client?.user?.trim().toLowerCase();
  if (!email) {
    return null;
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const user = findUserByEmail(platformStore, email);
  return user?.id ?? null;
}

export function resolveTrustedPlatformAuthUserIdFromSessionUser(
  platformUserId: string | null | undefined,
): string | null {
  const trimmed = platformUserId?.trim();
  return trimmed || null;
}

export async function resolveOperationalIdentityActorUserId(params: {
  platformUserId?: string | null;
  client?: GatewayClient | null;
}): Promise<string | null> {
  const direct = resolveTrustedPlatformAuthUserIdFromSessionUser(
    params.platformUserId ?? params.client?.platformUserId,
  );
  if (direct) {
    return direct;
  }
  const client = params.client ?? null;
  // 统一可信归属范式（R3 / Task 1.4）：优先复用 resolveTrustedAttribution(client).ownerId
  // （内部经 resolveBillingScope 解析平台 user.id，domain/tenant 感知），不新建第二套 session 读取链。
  const attribution = await resolveTrustedAttribution(client);
  if (attribution.ownerId) {
    return attribution.ownerId;
  }
  // 兜底：平台用户无企业 membership 时 attribution.ownerId 为空（resolveBillingScope 仅在有 enterpriseId 时带 user），
  // 回退既有 email→user.id 链以保持无 membership 用户的 owner 可解析（非回归）。
  return resolveTrustedPlatformAuthUserId(client);
}
