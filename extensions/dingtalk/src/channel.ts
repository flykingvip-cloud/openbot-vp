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
} from "openclaw/plugin-sdk/compat";
import {
  resolveDingtalkAccount,
  listDingtalkAccountIds,
  resolveDefaultDingtalkAccountId,
} from "./accounts.js";
import { normalizeDingtalkTarget, probeDingtalk, sendDingtalkMessage } from "./api.js";
import { DingtalkConfigSchema } from "./config-schema.js";
import { dingtalkOnboardingAdapter } from "./onboarding.js";
import { getDingtalkRuntime } from "./runtime.js";
import type { ResolvedDingtalkAccount } from "./types.js";

const meta = {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "钉钉 (DingTalk)",
  detailLabel: "钉钉机器人",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "钉钉企业内部应用，支持 Stream 模式和 HTTP 回调。",
  aliases: ["dingding"],
  order: 80,
  quickstartAllowFrom: true,
};

const dingtalkConfigUiHints = {
  enabled: { label: "启用钉钉通道" },
  name: { label: "显示名称", help: "在控制台中显示的应用名称。" },
  clientId: {
    label: "Client ID (AppKey)",
    help: "钉钉开放平台应用的 AppKey / Client ID。",
    placeholder: "dingxxxxxxxxx",
  },
  clientSecret: {
    label: "Client Secret (AppSecret)",
    help: "钉钉开放平台应用的 AppSecret / Client Secret。",
    sensitive: true,
    tags: ["secret"],
  },
  connectionMode: {
    label: "连接模式",
    help: "Stream 模式（推荐，无需公网 IP）或 Webhook 模式（需要公网回调地址）。",
  },
  robotCode: {
    label: "机器人编码",
    help: "钉钉机器人的 robotCode，用于发送消息。留空则使用 Client ID。",
    placeholder: "dingxxxxxxxxx",
    advanced: true,
  },
  webhookPath: {
    label: "Webhook 路径",
    help: "HTTP 回调模式下的回调路径。",
    placeholder: "/dingtalk",
    advanced: true,
  },
  webhookUrl: {
    label: "公网回调 URL",
    help: "HTTP 回调模式下的完整公网回调地址。",
    advanced: true,
    placeholder: "https://gateway.example.com/dingtalk",
  },
  defaultTo: {
    label: "默认接收人",
    help: "手动发送消息时的默认用户 ID。",
    advanced: true,
  },
  defaultAccount: { label: "默认账户" },
  accounts: {
    label: "应用账户",
    help: "配置多个钉钉应用时，每个应用一个账户条目。",
    order: 90,
  },
  "dm.policy": { label: "私聊策略" },
  "dm.allowFrom": { label: "私聊白名单", placeholder: "userId" },
  "accounts.*.enabled": { label: "启用此账户" },
  "accounts.*.name": { label: "显示名称" },
  "accounts.*.clientId": { label: "Client ID (AppKey)", placeholder: "dingxxxxxxxxx" },
  "accounts.*.clientSecret": {
    label: "Client Secret (AppSecret)",
    sensitive: true,
    tags: ["secret"],
  },
  "accounts.*.connectionMode": { label: "连接模式" },
  "accounts.*.robotCode": { label: "机器人编码", advanced: true },
  "accounts.*.webhookPath": { label: "Webhook 路径", advanced: true },
  "accounts.*.webhookUrl": { label: "公网回调 URL", advanced: true },
  "accounts.*.defaultTo": { label: "默认接收人", advanced: true },
  "accounts.*.dm.policy": { label: "私聊策略" },
  "accounts.*.dm.allowFrom": { label: "私聊白名单" },
} as const;

function formatAllowEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^dingtalk:/i, "")
    .replace(/^user:/i, "");
}

function normalizeDingtalkTargetOrUndefined(raw: string | null | undefined): string | undefined {
  return normalizeDingtalkTarget(raw) ?? undefined;
}

const dingtalkConfigAccessors = createScopedAccountConfigAccessors({
  resolveAccount: ({ cfg, accountId }) => resolveDingtalkAccount({ cfg, accountId }),
  resolveAllowFrom: (account: ResolvedDingtalkAccount) => account.config.dm?.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({ allowFrom, normalizeEntry: formatAllowEntry }),
  resolveDefaultTo: (account: ResolvedDingtalkAccount) => account.config.defaultTo,
});

const dingtalkConfigBase = createScopedChannelConfigBase<ResolvedDingtalkAccount>({
  sectionKey: "dingtalk",
  listAccountIds: listDingtalkAccountIds,
  resolveAccount: (cfg, accountId) => resolveDingtalkAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultDingtalkAccountId,
  clearBaseFields: ["clientId", "clientSecret", "robotCode", "webhookPath", "webhookUrl", "name"],
});

const resolveDingtalkDmPolicy = createScopedDmSecurityResolver<ResolvedDingtalkAccount>({
  channelKey: "dingtalk",
  resolvePolicy: (account) => account.config.dm?.policy,
  resolveAllowFrom: (account) => account.config.dm?.allowFrom,
  allowFromPathSuffix: "dm.allowFrom",
  policyPathSuffix: "dm.policy",
  approveHint: "openclaw pairing approve dingtalk <code>",
  normalizeEntry: formatAllowEntry,
});

export const dingtalkDock: ChannelDock = {
  id: "dingtalk",
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: true,
    threads: false,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 2000 },
  config: dingtalkConfigAccessors,
};

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
  id: "dingtalk",
  meta,
  onboarding: dingtalkOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: {
    ...buildChannelConfigSchema(DingtalkConfigSchema),
    uiHints: dingtalkConfigUiHints,
  },
  config: {
    ...dingtalkConfigBase,
    isConfigured: (account) => account.configured,
    unconfiguredReason: () => "钉钉通道需要配置 Client ID 和 Client Secret。",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name ?? undefined,
      enabled: account.enabled,
      configured: account.configured,
      mode: account.connectionMode,
    }),
    ...dingtalkConfigAccessors,
  },
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: formatAllowEntry,
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveDingtalkAccount({ cfg });
      await sendDingtalkMessage({ account, to: id, text: "OpenBot: 你的访问已被批准。" });
    },
  },
  security: {
    resolveDmPolicy: resolveDingtalkDmPolicy,
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if ((account.config.dm?.policy ?? "pairing") === "open") {
        warnings.push(
          '- 钉钉私聊对所有人开放。建议设置 `channels.dingtalk.dm.policy="pairing"` 或 `"allowlist"`。',
        );
      }
      return warnings;
    },
  },
  messaging: {
    normalizeTarget: normalizeDingtalkTargetOrUndefined,
    targetResolver: {
      looksLikeId: (raw, normalized) => Boolean(normalized ?? raw.trim()),
      hint: "<userId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      return listDirectoryUserEntriesFromAllowFrom({
        allowFrom: account.config.dm?.allowFrom,
        query,
        limit,
        normalizeId: (entry) => normalizeDingtalkTarget(String(entry)) ?? String(entry),
      });
    },
    listGroups: async () => [],
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeDingtalkTarget(input);
        if (!normalized) return { input, resolved: false, note: "empty target" };
        return { input, resolved: true, id: normalized };
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getDingtalkRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 2000,
    resolveTarget: ({ cfg, to, accountId }) => {
      const account = cfg ? resolveDingtalkAccount({ cfg, accountId }) : null;
      const target =
        normalizeDingtalkTarget(to) ?? normalizeDingtalkTarget(account?.config.defaultTo);
      if (!target) return { ok: false, error: missingTargetError("DingTalk", "<userId>") };
      return { ok: true, to: target };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      const result = await sendDingtalkMessage({ account, to, text });
      return {
        channel: "dingtalk",
        messageId: result.messageId,
        chatId: normalizeDingtalkTarget(to) ?? "",
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
      connectionMode: snapshot.mode ?? "stream",
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeDingtalk(account),
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const base = buildComputedAccountStatusSnapshot({
        accountId: account.accountId,
        name: account.name ?? undefined,
        enabled: account.enabled,
        configured: account.configured,
        runtime,
        probe,
      });
      return {
        ...base,
        mode: account.connectionMode,
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
        mode: account.connectionMode,
      });
      await runPassiveAccountLifecycle({
        abortSignal: ctx.abortSignal,
        start: async () => {
          // Stream mode: connect to DingTalk Stream API
          // Webhook mode: register webhook route
          // Both modes handled by the monitor
          return undefined;
        },
        stop: async () => {},
        onStop: async () => {
          statusSink({ running: false, lastStopAt: Date.now() });
        },
      });
    },
  },
};
