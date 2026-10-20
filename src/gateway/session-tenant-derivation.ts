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
 * Note: until Phase 3 populates tenant channel-account credentials, the index is
 * empty and every session resolves to platform-global (tenant scope returns
 * none) — honest rather than false isolation.
 */

function accountKey(channel: string, accountId: string): string {
  return `${channel.trim().toLowerCase()}:${normalizeAccountId(accountId)}`;
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
      if (!Array.isArray(accounts)) {
        continue;
      }
      for (const account of accounts) {
        const id = isPlainObject(account) ? (account as { id?: unknown }).id : undefined;
        if (typeof id === "string" && id.trim()) {
          index.set(accountKey(channelId, id), tenantId);
        }
      }
    }
  }
  return index;
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
