import { buildChannelUiCatalog } from "../../channels/plugins/catalog.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import {
  type ChannelId,
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId,
} from "../../channels/plugins/index.js";
import { buildChannelAccountSnapshot } from "../../channels/plugins/status.js";
import type { ChannelAccountSnapshot, ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/config.js";
import { getChannelActivity } from "../../infra/channel-activity.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { requireResolvedEnterpriseTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import {
  presentFeishuEnterpriseObservation,
  readFeishuEnterpriseChannelContract,
} from "../enterprise-im-channel-contract.js";
import {
  readFeishuProbeObservation,
  persistFeishuEnterpriseProbe,
} from "../enterprise-im-channel-persist.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChannelsLogoutParams,
  validateChannelsStatusParams,
} from "../protocol/index.js";
import { writeTenantConfigView } from "../tenant-config-service.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "../tenant-config.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type ChannelLogoutPayload = {
  channel: ChannelId;
  accountId: string;
  cleared: boolean;
  [key: string]: unknown;
};

/** Known channel credential field names cleared on tenant-scoped logout. */
const CHANNEL_SECRET_KEYS = new Set([
  "botToken",
  "token",
  "appToken",
  "apiKey",
  "password",
  "signingSecret",
  "accessToken",
  "refreshToken",
  "webhookSecret",
  "userToken",
  "authToken",
  "privateKey",
  "secret",
]);

function clearSecretFields(record: Record<string, unknown>): boolean {
  let cleared = false;
  for (const key of Object.keys(record)) {
    if (CHANNEL_SECRET_KEYS.has(key) && record[key] != null && record[key] !== "") {
      delete record[key];
      cleared = true;
    }
  }
  return cleared;
}

/**
 * Clear channel credentials from a tenant config view without touching the
 * global openbot.json or stopping the shared channel runtime.
 */
export function clearTenantChannelCredentials(params: {
  cfg: OpenBotConfig;
  channelId: ChannelId;
  accountId?: string | null;
}): { next: OpenBotConfig; accountId: string; cleared: boolean } {
  const resolvedAccountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const channels = params.cfg.channels ? { ...params.cfg.channels } : {};
  const channelRaw = channels[params.channelId];
  if (!channelRaw || typeof channelRaw !== "object" || Array.isArray(channelRaw)) {
    return {
      next: params.cfg,
      accountId: resolvedAccountId,
      cleared: false,
    };
  }
  const channel = { ...(channelRaw as Record<string, unknown>) };
  let cleared = false;

  // Top-level channel secrets (e.g. telegram.botToken for default account).
  if (!params.accountId?.trim() || resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    cleared = clearSecretFields(channel) || cleared;
  }

  const accountsRaw = channel.accounts;
  if (accountsRaw && typeof accountsRaw === "object" && !Array.isArray(accountsRaw)) {
    const accounts = { ...(accountsRaw as Record<string, unknown>) };
    const targetIds = params.accountId?.trim() ? [resolvedAccountId] : Object.keys(accounts);
    for (const id of targetIds) {
      const entry = accounts[id];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const nextEntry = { ...(entry as Record<string, unknown>) };
      if (clearSecretFields(nextEntry)) {
        cleared = true;
        accounts[id] = nextEntry;
      }
    }
    channel.accounts = accounts;
  }

  channels[params.channelId] = channel as never;
  return {
    next: { ...params.cfg, channels },
    accountId: resolvedAccountId,
    cleared,
  };
}

export async function logoutChannelAccount(params: {
  channelId: ChannelId;
  accountId?: string | null;
  cfg: OpenBotConfig;
  context: GatewayRequestContext;
  plugin: ChannelPlugin;
}): Promise<ChannelLogoutPayload> {
  const resolvedAccountId =
    params.accountId?.trim() ||
    params.plugin.config.defaultAccountId?.(params.cfg) ||
    params.plugin.config.listAccountIds(params.cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const account = params.plugin.config.resolveAccount(params.cfg, resolvedAccountId);
  await params.context.stopChannel(params.channelId, resolvedAccountId);
  const result = await params.plugin.gateway?.logoutAccount?.({
    cfg: params.cfg,
    accountId: resolvedAccountId,
    account,
    runtime: defaultRuntime,
  });
  if (!result) {
    throw new Error(`Channel ${params.channelId} does not support logout`);
  }
  const cleared = Boolean(result.cleared);
  const loggedOut = typeof result.loggedOut === "boolean" ? result.loggedOut : cleared;
  if (loggedOut) {
    params.context.markChannelLoggedOut(params.channelId, true, resolvedAccountId);
  }
  return {
    channel: params.channelId,
    accountId: resolvedAccountId,
    ...result,
    cleared,
  };
}

export const channelsHandlers: GatewayRequestHandlers = {
  "channels.status": async ({ params, respond, context, client }) => {
    if (!validateChannelsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.status params: ${formatValidationErrors(validateChannelsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const probe = (params as { probe?: boolean }).probe === true;
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = typeof timeoutMsRaw === "number" ? Math.max(1000, timeoutMsRaw) : 10_000;
    // Tenant scope: resolve the config view per tenant so a tenant only sees its
    // own channel accounts/credentials. The runtime snapshot stays global until
    // per-tenant runtime activation (Phase 8) — accounts with no running global
    // instance simply report "not running", which is honest rather than leaking
    // the platform runtime as the tenant's.
    const tenantScope = (params as { tenantId?: string }).tenantId;
    let cfg: OpenBotConfig;
    let tenantId: string | undefined;
    if (typeof tenantScope === "string" && tenantScope.trim()) {
      const resolvedTenantId = await requireResolvedEnterpriseTenantId({
        client,
        params: params as Record<string, unknown>,
        respond,
      });
      if (!resolvedTenantId) {
        return;
      }
      tenantId = resolvedTenantId;
      const store = await loadTenantConfigStore();
      cfg = resolveConfigForTenant({
        platformDefault: loadConfig(),
        override: getTenantConfigOverride(store, tenantId),
      });
    } else {
      cfg = loadConfig();
    }
    const runtime = context.getRuntimeSnapshot();
    const plugins = listChannelPlugins();
    const pluginMap = new Map<ChannelId, ChannelPlugin>(
      plugins.map((plugin) => [plugin.id, plugin]),
    );

    const resolveRuntimeSnapshot = (
      channelId: ChannelId,
      accountId: string,
      defaultAccountId: string,
    ): ChannelAccountSnapshot | undefined => {
      const accounts = runtime.channelAccounts[channelId];
      const defaultRuntime = runtime.channels[channelId];
      const raw =
        accounts?.[accountId] ?? (accountId === defaultAccountId ? defaultRuntime : undefined);
      if (!raw) {
        return undefined;
      }
      return raw;
    };

    const isAccountEnabled = (plugin: ChannelPlugin, account: unknown) =>
      plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : !account ||
          typeof account !== "object" ||
          (account as { enabled?: boolean }).enabled !== false;

    const buildChannelAccounts = async (channelId: ChannelId) => {
      const plugin = pluginMap.get(channelId);
      if (!plugin) {
        return {
          accounts: [] as ChannelAccountSnapshot[],
          defaultAccountId: DEFAULT_ACCOUNT_ID,
          defaultAccount: undefined as ChannelAccountSnapshot | undefined,
          resolvedAccounts: {} as Record<string, unknown>,
        };
      }
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: ChannelAccountSnapshot[] = [];
      const resolvedAccounts: Record<string, unknown> = {};
      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        const enabled = isAccountEnabled(plugin, account);
        resolvedAccounts[accountId] = account;
        let probeResult: unknown;
        let lastProbeAt: number | null = null;
        if (probe && enabled && plugin.status?.probeAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            probeResult = await plugin.status.probeAccount({
              account,
              timeoutMs,
              cfg,
            });
            lastProbeAt = Date.now();
          }
        }
        let auditResult: unknown;
        if (probe && enabled && plugin.status?.auditAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            auditResult = await plugin.status.auditAccount({
              account,
              timeoutMs,
              cfg,
              probe: probeResult,
            });
          }
        }
        const runtimeSnapshot = resolveRuntimeSnapshot(channelId, accountId, defaultAccountId);
        const snapshot = await buildChannelAccountSnapshot({
          plugin,
          cfg,
          accountId,
          runtime: runtimeSnapshot,
          probe: probeResult,
          audit: auditResult,
        });
        // When credentials are incomplete, surface the plugin's unconfigured
        // reason even if the global runtime never started this account (common
        // for tenant-scoped status before per-tenant runtime activation).
        if (
          snapshot.configured === false &&
          !snapshot.lastError &&
          plugin.config.unconfiguredReason
        ) {
          snapshot.lastError = plugin.config.unconfiguredReason(account, cfg);
        }
        if (lastProbeAt) {
          snapshot.lastProbeAt = lastProbeAt;
        }
        if (tenantId && channelId === "feishu") {
          const stored = readFeishuEnterpriseChannelContract({
            config: cfg as unknown as Record<string, unknown>,
            accountId,
          });
          snapshot.platformEnterpriseId = stored.platformEnterpriseId;
          snapshot.enterpriseImCapability = stored.capabilityStatus ?? undefined;
          snapshot.enterpriseImChildExecutionBlocked = stored.childExecutionBlocked;
          snapshot.enterpriseImEmployeeUiHint = stored.employeeUiHint;
          const observation = readFeishuProbeObservation(probeResult);
          if (observation) {
            const recorded = await persistFeishuEnterpriseProbe({
              tenantId,
              accountId,
              observation,
            });
            const presented =
              recorded ??
              presentFeishuEnterpriseObservation({
                observation,
                channelEnabled: !stored.childExecutionBlocked,
                nowIso: new Date().toISOString(),
                storedPlatformEnterpriseId: stored.platformEnterpriseId,
              });
            snapshot.platformEnterpriseId = presented.platformEnterpriseId;
            snapshot.enterpriseImCapability = presented.capabilityStatus;
            snapshot.enterpriseImChildExecutionBlocked = presented.childExecutionBlocked;
            snapshot.enterpriseImEmployeeUiHint = presented.employeeUiHint;
          }
        }
        const activity = getChannelActivity({
          channel: channelId as never,
          accountId,
        });
        if (snapshot.lastInboundAt == null) {
          snapshot.lastInboundAt = activity.inboundAt;
        }
        if (snapshot.lastOutboundAt == null) {
          snapshot.lastOutboundAt = activity.outboundAt;
        }
        accounts.push(snapshot);
      }
      const defaultAccount =
        accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0];
      return { accounts, defaultAccountId, defaultAccount, resolvedAccounts };
    };

    const uiCatalog = buildChannelUiCatalog(plugins);
    const payload: Record<string, unknown> = {
      ts: Date.now(),
      channelOrder: uiCatalog.order,
      channelLabels: uiCatalog.labels,
      channelDetailLabels: uiCatalog.detailLabels,
      channelSystemImages: uiCatalog.systemImages,
      channelMeta: uiCatalog.entries,
      channels: {} as Record<string, unknown>,
      channelAccounts: {} as Record<string, unknown>,
      channelDefaultAccountId: {} as Record<string, unknown>,
    };
    const channelsMap = payload.channels as Record<string, unknown>;
    const accountsMap = payload.channelAccounts as Record<string, unknown>;
    const defaultAccountIdMap = payload.channelDefaultAccountId as Record<string, unknown>;
    for (const plugin of plugins) {
      const { accounts, defaultAccountId, defaultAccount, resolvedAccounts } =
        await buildChannelAccounts(plugin.id);
      const fallbackAccount =
        resolvedAccounts[defaultAccountId] ?? plugin.config.resolveAccount(cfg, defaultAccountId);
      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account: fallbackAccount,
            cfg,
            defaultAccountId,
            snapshot:
              defaultAccount ??
              ({
                accountId: defaultAccountId,
              } as ChannelAccountSnapshot),
          })
        : {
            configured: defaultAccount?.configured ?? false,
          };
      channelsMap[plugin.id] = summary;
      accountsMap[plugin.id] = accounts;
      defaultAccountIdMap[plugin.id] = defaultAccountId;
    }

    respond(true, payload, undefined);
  },
  "channels.logout": async ({ params, respond, context, client }) => {
    if (!validateChannelsLogoutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.logout params: ${formatValidationErrors(validateChannelsLogoutParams.errors)}`,
        ),
      );
      return;
    }
    const rawChannel = (params as { channel?: unknown }).channel;
    const channelId = typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid channels.logout channel"),
      );
      return;
    }
    const accountIdRaw = (params as { accountId?: unknown }).accountId;
    const accountId = typeof accountIdRaw === "string" ? accountIdRaw.trim() : undefined;
    const tenantScope = (params as { tenantId?: string }).tenantId;

    // Tenant-scoped logout: clear secrets in the tenant override only.
    // Do not call plugin.logoutAccount (writes global openbot.json) and do not
    // stopChannel (would affect the shared global runtime).
    if (typeof tenantScope === "string" && tenantScope.trim()) {
      const tenantId = await requireResolvedEnterpriseTenantId({
        client,
        params: params as Record<string, unknown>,
        respond,
      });
      if (!tenantId) {
        return;
      }
      try {
        const store = await loadTenantConfigStore();
        const platformDefault = loadConfig();
        const view = resolveConfigForTenant({
          platformDefault,
          override: getTenantConfigOverride(store, tenantId),
        });
        const clearedView = clearTenantChannelCredentials({
          cfg: view,
          channelId,
          accountId,
        });
        if (clearedView.cleared) {
          const write = await writeTenantConfigView({
            tenantId,
            config: clearedView.next,
            platformDefault,
          });
          if (!write.ok) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, write.message));
            return;
          }
        }
        respond(
          true,
          {
            channel: channelId,
            accountId: clearedView.accountId,
            cleared: clearedView.cleared,
            scope: "tenant",
            runtimeStopped: false,
            note: "Tenant credentials cleared; global channel runtime was not stopped.",
          },
          undefined,
        );
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      }
      return;
    }

    const plugin = getChannelPlugin(channelId);
    if (!plugin?.gateway?.logoutAccount) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel ${channelId} does not support logout`),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before logging out"),
      );
      return;
    }
    try {
      const payload = await logoutChannelAccount({
        channelId,
        accountId,
        cfg: snapshot.config ?? {},
        context,
        plugin,
      });
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
