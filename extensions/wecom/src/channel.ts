import {
  buildChannelConfigSchema,
  buildComputedAccountStatusSnapshot,
  createAccountStatusSink,
  createScopedAccountConfigAccessors,
  createScopedChannelConfigBase,
  createScopedDmSecurityResolver,
  DEFAULT_ACCOUNT_ID,
  formatNormalizedAllowFromEntries,
  listDirectoryUserEntriesFromAllowFrom,
  missingTargetError,
  runPassiveAccountLifecycle,
  type ChannelDock,
  type ChannelPlugin,
  type OpenBotConfig,
  normalizeAccountId,
} from "openclaw/plugin-sdk/wecom";
import {
  resolveWecomAccount,
  listWecomAccountIds,
  resolveDefaultWecomAccountId,
} from "./accounts.js";
import { describeWecomUnconfiguredReason } from "./accounts.js";
import { normalizeWecomTarget, probeWecom, sendWecomTextMessage } from "./api.js";
import { WecomConfigSchema } from "./config-schema.js";
import { startWecomMonitor } from "./monitor.js";
import { wecomOnboardingAdapter } from "./onboarding.js";
import { getWecomRuntime } from "./runtime.js";
import type { ResolvedWecomAccount } from "./types.js";
import { resolveWecomWebhookPath } from "./webhook.js";

const meta = {
  id: "wecom",
  label: "WeCom",
  selectionLabel: "WeCom (Enterprise WeChat)",
  detailLabel: "WeCom app",
  docsPath: "/channels/wecom",
  docsLabel: "wecom",
  blurb: "Enterprise WeChat app via callback webhook and send API.",
  aliases: ["qywx", "enterprise-wechat"],
  order: 79,
  quickstartAllowFrom: true,
};

const wecomConfigUiHints = {
  enabled: {
    label: "Enable WeCom",
  },
  name: {
    label: "Display Name",
    help: "Optional label shown in the control UI for this enterprise app.",
  },
  connectionMode: {
    label: "Connection Mode",
    help: "AIBot WebSocket long connection (botId + secret) or classic corp-app URL callback.",
  },
  botId: {
    label: "AIBot Bot ID",
    help: "智能机器人 Bot ID from WeCom admin (API long-connection mode).",
    placeholder: "aibXXXXXXXX",
  },
  corpId: {
    label: "Corp ID",
    help: "Enterprise WeChat Corp ID from the WeCom admin console.",
    placeholder: "ww1234567890abcdef",
  },
  agentId: {
    label: "Agent ID",
    help: "Application Agent ID for the WeCom app that sends and receives messages.",
    placeholder: "1000002",
  },
  secret: {
    label: "App / AIBot Secret",
    help: "Corp-app Secret for callback mode, or AIBot long-connection Secret for websocket mode.",
    sensitive: true,
    tags: ["secret"],
  },
  token: {
    label: "Callback Token",
    help: "Token configured in the WeCom callback settings.",
    sensitive: true,
    tags: ["secret"],
  },
  encodingAesKey: {
    label: "Encoding AES Key",
    help: "43-character callback encryption key from the WeCom admin console.",
    sensitive: true,
    tags: ["secret"],
  },
  webhookPath: {
    label: "Webhook Path",
    help: "Relative callback path exposed by the OpenBot gateway.",
    placeholder: "/wecom",
  },
  webhookUrl: {
    label: "Public Webhook URL",
    help: "Optional public callback URL override if the gateway URL is not directly reachable.",
    advanced: true,
    placeholder: "https://gateway.example.com/wecom",
  },
  defaultTo: {
    label: "Default User ID",
    help: "Fallback WeCom userId for manual outbound sends when no explicit target is provided.",
    advanced: true,
    placeholder: "zhangsan",
  },
  defaultAccount: {
    label: "Default Enterprise Account",
    help: "Select which named account should be used when multiple enterprises or apps are configured.",
  },
  accounts: {
    label: "Enterprise Accounts",
    help: "Add one entry per enterprise or app when you need separate credentials, webhook paths, or routing.",
    order: 90,
  },
  "dm.policy": {
    label: "DM Policy",
    help: "Choose whether new senders are paired, allowlisted, or always accepted.",
  },
  "dm.allowFrom": {
    label: "DM Allowlist",
    help: "Optional WeCom userId allowlist used when DM policy is allowlist.",
    placeholder: "zhangsan",
  },
  textChunkLimit: {
    label: "Text Chunk Limit",
    help: "Maximum outbound text size before OpenBot splits replies into multiple WeCom messages.",
    advanced: true,
  },
  "accounts.*.enabled": {
    label: "Enable This Enterprise Account",
  },
  "accounts.*.name": {
    label: "Display Name",
    help: "Optional UI label for this enterprise or app.",
  },
  "accounts.*.corpId": {
    label: "Corp ID",
    placeholder: "ww1234567890abcdef",
  },
  "accounts.*.agentId": {
    label: "Agent ID",
    placeholder: "1000002",
  },
  "accounts.*.secret": {
    label: "App Secret",
    sensitive: true,
    tags: ["secret"],
  },
  "accounts.*.token": {
    label: "Callback Token",
    sensitive: true,
    tags: ["secret"],
  },
  "accounts.*.encodingAesKey": {
    label: "Encoding AES Key",
    sensitive: true,
    tags: ["secret"],
  },
  "accounts.*.webhookPath": {
    label: "Webhook Path",
    placeholder: "/wecom/sales",
  },
  "accounts.*.webhookUrl": {
    label: "Public Webhook URL",
    advanced: true,
    placeholder: "https://gateway.example.com/wecom/sales",
  },
  "accounts.*.defaultTo": {
    label: "Default User ID",
    advanced: true,
    placeholder: "zhangsan",
  },
  "accounts.*.dm.policy": {
    label: "DM Policy",
  },
  "accounts.*.dm.allowFrom": {
    label: "DM Allowlist",
    placeholder: "zhangsan",
  },
  "accounts.*.textChunkLimit": {
    label: "Text Chunk Limit",
    advanced: true,
  },
} as const;

function formatAllowEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^wecom:/i, "")
    .replace(/^user:/i, "");
}

const wecomConfigAccessors = createScopedAccountConfigAccessors({
  resolveAccount: ({ cfg, accountId }) => resolveWecomAccount({ cfg, accountId }),
  resolveAllowFrom: (account: ResolvedWecomAccount) => account.config.dm?.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: formatAllowEntry,
    }),
  resolveDefaultTo: (account: ResolvedWecomAccount) => account.config.defaultTo,
});

const wecomConfigBase = createScopedChannelConfigBase<ResolvedWecomAccount>({
  sectionKey: "wecom",
  listAccountIds: listWecomAccountIds,
  resolveAccount: (cfg, accountId) => resolveWecomAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultWecomAccountId,
  clearBaseFields: [
    "corpId",
    "agentId",
    "secret",
    "token",
    "encodingAesKey",
    "webhookPath",
    "webhookUrl",
    "name",
  ],
});

const resolveWecomDmPolicy = createScopedDmSecurityResolver<ResolvedWecomAccount>({
  channelKey: "wecom",
  resolvePolicy: (account) => account.config.dm?.policy,
  resolveAllowFrom: (account) => account.config.dm?.allowFrom,
  allowFromPathSuffix: "dm.allowFrom",
  policyPathSuffix: "dm.policy",
  approveHint: "openclaw pairing approve wecom <code>",
  normalizeEntry: formatAllowEntry,
});

export const wecomDock: ChannelDock = {
  id: "wecom",
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    media: false,
    threads: false,
    blockStreaming: true,
  },
  outbound: {
    textChunkLimit: 1800,
  },
  config: wecomConfigAccessors,
};

export const wecomPlugin: ChannelPlugin<ResolvedWecomAccount> = {
  id: "wecom",
  meta,
  onboarding: wecomOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wecom"] },
  configSchema: {
    ...buildChannelConfigSchema(WecomConfigSchema),
    uiHints: wecomConfigUiHints,
  },
  config: {
    ...wecomConfigBase,
    isConfigured: (account) => account.configured,
    unconfiguredReason: (account) => describeWecomUnconfiguredReason(account),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      webhookPath:
        account.connectionMode === "websocket"
          ? undefined
          : (resolveWecomWebhookPath(account) ?? undefined),
    }),
    ...wecomConfigAccessors,
  },
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: formatAllowEntry,
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveWecomAccount({ cfg });
      await sendWecomTextMessage({
        account,
        to: id,
        text: "OpenBot: your access has been approved.",
      });
    },
  },
  security: {
    resolveDmPolicy: resolveWecomDmPolicy,
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if ((account.config.dm?.policy ?? "pairing") === "open") {
        warnings.push(
          '- WeCom DMs are open to anyone. Set `channels.wecom.dm.policy="pairing"` or `"allowlist"`.',
        );
      }
      return warnings;
    },
  },
  messaging: {
    normalizeTarget: normalizeWecomTarget,
    targetResolver: {
      looksLikeId: (raw, normalized) => Boolean(normalized ?? raw.trim()),
      hint: "<userId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWecomAccount({ cfg, accountId });
      return listDirectoryUserEntriesFromAllowFrom({
        allowFrom: account.config.dm?.allowFrom,
        query,
        limit,
        normalizeId: (entry) => normalizeWecomTarget(String(entry)) ?? String(entry),
      });
    },
    listGroups: async () => [],
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeWecomTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "empty target" };
        }
        if (kind === "group") {
          return { input, resolved: false, note: "WeCom group routing is not implemented yet" };
        }
        return { input, resolved: true, id: normalized };
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getWecomRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 1800,
    resolveTarget: ({ cfg, to, accountId }) => {
      const account = cfg ? resolveWecomAccount({ cfg, accountId }) : null;
      const target = normalizeWecomTarget(to) ?? normalizeWecomTarget(account?.config.defaultTo);
      if (!target) {
        return {
          ok: false,
          error: missingTargetError("WeCom", "<userId>"),
        };
      }
      return { ok: true, to: target };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveWecomAccount({ cfg, accountId });
      const result = await sendWecomTextMessage({
        account,
        to,
        text,
      });
      return {
        channel: "wecom",
        messageId: result.messageId,
        chatId: normalizeWecomTarget(to) ?? "",
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeWecom(account),
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const base = buildComputedAccountStatusSnapshot({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        runtime,
        probe,
      });
      return {
        ...base,
        webhookPath: resolveWecomWebhookPath(account),
        dmPolicy: account.config.dm?.policy ?? "pairing",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const statusSink = createAccountStatusSink({
        accountId: account.accountId,
        setStatus: ctx.setStatus,
      });
      statusSink({
        running: true,
        lastStartAt: Date.now(),
        webhookPath: resolveWecomWebhookPath(account),
      });
      await runPassiveAccountLifecycle({
        abortSignal: ctx.abortSignal,
        start: async () =>
          await startWecomMonitor({
            account,
            config: ctx.cfg,
            runtime: ctx.runtime,
            statusSink,
          }),
        stop: async (unregister) => {
          unregister?.();
        },
        onStop: async () => {
          statusSink({
            running: false,
            lastStopAt: Date.now(),
          });
        },
      });
    },
  },
};
