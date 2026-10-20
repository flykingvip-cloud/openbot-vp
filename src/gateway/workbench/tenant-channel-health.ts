import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import { type OpenBotConfig, loadConfig } from "../../config/config.js";
import {
  DEFAULT_CHANNEL_CONNECT_GRACE_MS,
  DEFAULT_CHANNEL_STALE_EVENT_THRESHOLD_MS,
  evaluateChannelHealth,
} from "../channel-health-policy.js";
import type { ChannelRuntimeSnapshot } from "../server-channels.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "../tenant-config.js";
import type { EnterpriseNoticesOfflineChannel } from "./enterprise-notices-read-model.js";

function isAccountEnabled(plugin: ChannelPlugin, account: unknown, cfg: OpenBotConfig): boolean {
  return plugin.config.isEnabled
    ? plugin.config.isEnabled(account, cfg)
    : !account ||
        typeof account !== "object" ||
        (account as { enabled?: boolean }).enabled !== false;
}

/**
 * Resolve the tenant's CONFIGURED + ENABLED channel accounts and flag any that
 * are currently offline (`not-running` / `disconnected` / `stuck` /
 * `stale-socket` per {@link evaluateChannelHealth}).
 *
 * Tenant scoping mirrors `channels.status`: the CONFIG view is resolved per
 * tenant (which accounts the tenant owns), then matched against the gateway
 * runtime snapshot. The runtime snapshot is gateway-global until per-tenant
 * runtime activation (Phase 8) — same documented caveat as `channels.status`.
 * Scoping by the tenant's configured accounts keeps a tenant from seeing
 * channels it never configured; a configured account with no running global
 * instance honestly reports `not-running` (offline), which is the signal we
 * want for the admin notices surface.
 */
export async function resolveTenantOfflineChannels(params: {
  enterpriseId: string;
  runtime: ChannelRuntimeSnapshot;
  now?: number;
}): Promise<EnterpriseNoticesOfflineChannel[]> {
  const now = params.now ?? Date.now();
  const store = await loadTenantConfigStore();
  const cfg = resolveConfigForTenant({
    platformDefault: loadConfig(),
    override: getTenantConfigOverride(store, params.enterpriseId),
  });
  const offline: EnterpriseNoticesOfflineChannel[] = [];
  for (const plugin of listChannelPlugins()) {
    const channelId = plugin.id;
    let accountIds: string[];
    try {
      accountIds = plugin.config.listAccountIds(cfg);
    } catch {
      continue;
    }
    const defaultAccountId = resolveChannelDefaultAccountId({ plugin, cfg, accountIds });
    for (const accountId of accountIds) {
      let account: unknown;
      try {
        account = plugin.config.resolveAccount(cfg, accountId);
      } catch {
        continue;
      }
      if (!isAccountEnabled(plugin, account, cfg)) {
        continue;
      }
      if (plugin.config.isConfigured) {
        let configured = false;
        try {
          configured = await plugin.config.isConfigured(account, cfg);
        } catch {
          configured = false;
        }
        if (!configured) {
          continue;
        }
      }
      const snapshot =
        params.runtime.channelAccounts[channelId]?.[accountId] ??
        (accountId === defaultAccountId ? params.runtime.channels[channelId] : undefined);
      const evaluation = evaluateChannelHealth(snapshot ?? {}, {
        channelId,
        now,
        staleEventThresholdMs: DEFAULT_CHANNEL_STALE_EVENT_THRESHOLD_MS,
        channelConnectGraceMs: DEFAULT_CHANNEL_CONNECT_GRACE_MS,
      });
      if (!evaluation.healthy) {
        offline.push({ channelId, accountId, reason: evaluation.reason });
      }
    }
  }
  return offline;
}
