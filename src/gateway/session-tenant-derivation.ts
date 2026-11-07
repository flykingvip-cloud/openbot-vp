import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { isPlainObject } from "../utils.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import type { TenantConfigStore } from "./tenant-config.js";

/**
 * Derive session/log tenant attribution from channel-account ownership
 * (ops-decommission task 2.4/2.5).
 *
 * Sessions and logs are created by the global runtime and carry no tenant stamp,
 * so attribution is DERIVED: a session whose `(channel, accountId)` matches a
 * channel account configured under tenant T (in the tenant-config store) belongs
 * to T. Sessions whose account is not owned by any tenant are platform-global.
 *
 * Account maps written by 企业通道 (`accounts.<id>`) are indexed the same way as
 * the older array form (`accounts: [{ id }]`). A Feishu `platformEnterpriseId`
 * (tenant_key) is indexed separately so later employee login can match the
 * platform enterprise. The account id `t_<tenant>_default` is not that id.
 */

function rememberPlatformEnterprise(
  index: Map<string, string>,
  channelId: string,
  account: unknown,
  tenantId: string,
): void {
  if (!isPlainObject(account)) {
    return;
  }
  const platformEnterpriseId = (account as { platformEnterpriseId?: unknown }).platformEnterpriseId;
  if (typeof platformEnterpriseId !== "string" || !platformEnterpriseId.trim()) {
    return;
  }
  index.set(platformEnterpriseKey(channelId, platformEnterpriseId), tenantId);
}

function accountKey(channel: string, accountId: string): string {
  return `${channel.trim().toLowerCase()}:${normalizeAccountId(accountId)}`;
}

/** Lookup key for the platform enterprise id observed on a 企业通道 account. */
export function platformEnterpriseKey(channel: string, platformEnterpriseId: string): string {
  return `${channel.trim().toLowerCase()}:enterprise:${platformEnterpriseId.trim()}`;
}

/** Build a `(channel:accountId) -> tenantId` index from the tenant-config store. */
export function buildAccountTenantIndex(store: TenantConfigStore): Map<string, string> {
  const index = new Map<string, string>();
  for (const record of Object.values(store.tenants)) {
    const tenantId = canonicalizeTenantId(record.tenantId) ?? record.tenantId;
    const channels = (record.override as { channels?: unknown }).channels;
    if (!isPlainObject(channels)) {
      continue;
    }
    for (const [channelId, channelCfg] of Object.entries(channels)) {
      if (!isPlainObject(channelCfg)) {
        continue;
      }
      const accounts = (channelCfg as { accounts?: unknown }).accounts;
      if (Array.isArray(accounts)) {
        for (const account of accounts) {
          const id = isPlainObject(account) ? (account as { id?: unknown }).id : undefined;
          if (typeof id === "string" && id.trim()) {
            index.set(accountKey(channelId, id), tenantId);
            rememberPlatformEnterprise(index, channelId, account, tenantId);
          }
        }
        continue;
      }
      if (!isPlainObject(accounts)) {
        continue;
      }
      for (const [id, account] of Object.entries(accounts)) {
        if (!id.trim()) {
          continue;
        }
        index.set(accountKey(channelId, id), tenantId);
        rememberPlatformEnterprise(index, channelId, account, tenantId);
      }
    }
  }
  return index;
}

/** Resolve the OpenBot tenant that observed this platform enterprise id. */
export function deriveOpenBotTenantForPlatformEnterprise(
  index: Map<string, string>,
  channel: string,
  platformEnterpriseId: string,
): string | undefined {
  const id = platformEnterpriseId.trim();
  if (!channel.trim() || !id) {
    return undefined;
  }
  return index.get(platformEnterpriseKey(channel, id));
}

/**
 * Resolve the owning tenant for a session row given the account→tenant index.
 * Returns undefined when the session's account is not owned by any tenant
 * (platform-global).
 */
export function deriveSessionTenant(
  row: { channel?: string | null; lastAccountId?: string | null },
  index: Map<string, string>,
): string | undefined {
  const channel = row.channel?.trim();
  if (!channel) {
    return undefined;
  }
  return index.get(accountKey(channel, row.lastAccountId ?? DEFAULT_ACCOUNT_ID));
}
