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
  resolveWechatAccount,
  listWechatAccountIds,
  resolveDefaultWechatAccountId,
} from "./accounts.js";
import { normalizeWechatTarget, probeWechat, sendWechatTextMessage } from "./api.js";
import { WechatConfigSchema } from "./config-schema.js";
import {
  resolveWechatGatewayWebhookListen,
  startWechatGatewayInboundWebhook,
} from "./inbound-webhook.js";
import { logoutWechatAccount, startWechatLoginWithQr, waitForWechatLogin } from "./login-qr.js";
import { getWechatRuntime } from "./runtime.js";
import type { ResolvedWechatAccount } from "./types.js";
import { WECHAT_WORKER_COMMANDS, WECHAT_WORKER_OFFLINE_ERROR } from "./worker-contract.js";
import { getBoundWechatPersonalNodeRegistry, resolveWechatPersonalWorker } from "./worker.js";

const meta = {
  id: "wechat",
  label: "WeChat",
  selectionLabel: "微信 (WeChat)",
  detailLabel: "微信个人号",
  docsPath: "/channels/wechat",
  docsLabel: "wechat",
  blurb: "微信个人号接入，支持私聊和群聊，通过代理服务连接。",
  aliases: ["weixin"],
  order: 78,
  quickstartAllowFrom: true,
};

const wechatConfigUiHints = {
  enabled: { label: "启用微信通道" },
  name: { label: "显示名称", help: "在控制台中显示的账号名称。" },
  apiKey: {
    label: "API Key",
    help: "代理服务的 API Key，用于认证通信。",
    sensitive: true,
    tags: ["secret"],
    placeholder: "wc_live_xxxxxxxxxxxxxxxx",
  },
  proxyUrl: {
    label: "代理服务地址",
    help: "微信代理服务的 HTTP 地址。",
    placeholder: "http://your-proxy-server:3000",
  },
  webhookHost: {
    label: "Webhook 公网地址",
    help: "不要填云端 Gateway。入站由 Mac Node 在 loopback 收，默认 127.0.0.1。",
    placeholder: "127.0.0.1",
  },
  webhookPort: {
    label: "Webhook 端口",
    help: "Webhook 监听端口，Mac Node loopback 入站端口，默认 18789。",
    advanced: true,
    placeholder: "18789",
  },
  webhookPath: {
    label: "Webhook 路径",
    help: "Webhook 回调路径，默认 /webhook/wechat。",
    advanced: true,
    placeholder: "/webhook/wechat",
  },
  deviceType: {
    label: "设备类型",
    help: "登录协议类型：ipad（默认，更稳定）或 mac。",
  },
  defaultTo: {
    label: "默认接收人",
    help: "手动发送消息时的默认微信 ID。",
    advanced: true,
  },
  defaultAccount: { label: "默认账户" },
  accounts: {
    label: "微信账户",
    help: "配置多个微信号时，每个号一个账户条目。",
    order: 90,
  },
  "dm.policy": { label: "私聊策略" },
  "dm.allowFrom": { label: "私聊白名单", placeholder: "wxid_xxx" },
  "accounts.*.enabled": { label: "启用此账户" },
  "accounts.*.name": { label: "显示名称" },
  "accounts.*.apiKey": { label: "API Key", sensitive: true, tags: ["secret"] },
  "accounts.*.proxyUrl": { label: "代理服务地址" },
  "accounts.*.webhookHost": { label: "Webhook 公网地址" },
  "accounts.*.webhookPort": { label: "Webhook 端口", advanced: true },
  "accounts.*.webhookPath": { label: "Webhook 路径", advanced: true },
  "accounts.*.deviceType": { label: "设备类型" },
  "accounts.*.defaultTo": { label: "默认接收人", advanced: true },
  "accounts.*.dm.policy": { label: "私聊策略" },
  "accounts.*.dm.allowFrom": { label: "私聊白名单" },
} as const;

function formatAllowEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^wechat:/i, "")
    .replace(/^user:/i, "");
}

function normalizeWechatTargetOrUndefined(raw: string | null | undefined): string | undefined {
  return normalizeWechatTarget(raw) ?? undefined;
}

const wechatConfigAccessors = createScopedAccountConfigAccessors({
  resolveAccount: ({ cfg, accountId }) => resolveWechatAccount({ cfg, accountId }),
  resolveAllowFrom: (account: ResolvedWechatAccount) => account.config.dm?.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({ allowFrom, normalizeEntry: formatAllowEntry }),
  resolveDefaultTo: (account: ResolvedWechatAccount) => account.config.defaultTo,
});

const wechatConfigBase = createScopedChannelConfigBase<ResolvedWechatAccount>({
  sectionKey: "wechat",
  listAccountIds: listWechatAccountIds,
  resolveAccount: (cfg, accountId) => resolveWechatAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultWechatAccountId,
  clearBaseFields: ["apiKey", "proxyUrl", "webhookHost", "webhookPort", "webhookPath", "name"],
});

const resolveWechatDmPolicy = createScopedDmSecurityResolver<ResolvedWechatAccount>({
  channelKey: "wechat",
  resolvePolicy: (account) => account.config.dm?.policy,
  resolveAllowFrom: (account) => account.config.dm?.allowFrom,
  allowFromPathSuffix: "dm.allowFrom",
  policyPathSuffix: "dm.policy",
  approveHint: "openclaw pairing approve wechat <code>",
  normalizeEntry: formatAllowEntry,
});

export const wechatDock: ChannelDock = {
  id: "wechat",
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: true,
    threads: false,
    blockStreaming: false,
  },
  outbound: { textChunkLimit: 2000 },
  config: wechatConfigAccessors,
};

export const wechatPlugin: ChannelPlugin<ResolvedWechatAccount> = {
  id: "wechat",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.wechat"] },
  configSchema: {
    ...buildChannelConfigSchema(WechatConfigSchema),
    uiHints: wechatConfigUiHints,
  },
  config: {
    ...wechatConfigBase,
    isConfigured: (account) => account.configured,
    unconfiguredReason: () =>
      "微信个人号需要已连接的桌面节点（或本机 sidecar），不要填写 LIVE channels.wechat.proxyUrl。",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name ?? undefined,
      enabled: account.enabled,
      configured: account.configured,
      mode: account.deviceType,
      webhookPath: account.webhookPath,
    }),
    ...wechatConfigAccessors,
  },
  pairing: {
    idLabel: "wechatId",
    normalizeAllowEntry: formatAllowEntry,
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveWechatAccount({ cfg });
      await sendWechatTextMessage({ account, to: id, text: "OpenBot: 你的访问已被批准。" });
    },
  },
  security: {
    resolveDmPolicy: resolveWechatDmPolicy,
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if ((account.config.dm?.policy ?? "pairing") === "open") {
        warnings.push(
          '- 微信私聊对所有人开放。建议设置 `channels.wechat.dm.policy="pairing"` 或 `"allowlist"`。',
        );
      }
      return warnings;
    },
  },
  messaging: {
    normalizeTarget: normalizeWechatTargetOrUndefined,
    targetResolver: {
      looksLikeId: (raw, normalized) => Boolean(normalized ?? raw.trim()),
      hint: "<wxid>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWechatAccount({ cfg, accountId });
      return listDirectoryUserEntriesFromAllowFrom({
        allowFrom: account.config.dm?.allowFrom,
        query,
        limit,
        normalizeId: (entry) => normalizeWechatTarget(String(entry)) ?? String(entry),
      });
    },
    listGroups: async () => [],
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeWechatTarget(input);
        if (!normalized) return { input, resolved: false, note: "empty target" };
        return { input, resolved: true, id: normalized };
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getWechatRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 2000,
    resolveTarget: ({ cfg, to, accountId }) => {
      const account = cfg ? resolveWechatAccount({ cfg, accountId }) : null;
      const target = normalizeWechatTarget(to) ?? normalizeWechatTarget(account?.config.defaultTo);
      if (!target) return { ok: false, error: missingTargetError("WeChat", "<wxid>") };
      return { ok: true, to: target };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveWechatAccount({ cfg, accountId });
      const result = await sendWechatTextMessage({ account, to, text });
      return {
        channel: "wechat",
        messageId: result.messageId,
        chatId: normalizeWechatTarget(to) ?? "",
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
      deviceType: snapshot.mode ?? "ipad",
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeWechat(account),
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
        mode: account.deviceType,
        webhookPath: account.webhookPath,
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
      const registry = getBoundWechatPersonalNodeRegistry();
      const hasWechatNode = Boolean(
        registry
          ?.listConnected()
          .some((node) => (node.commands ?? []).includes(WECHAT_WORKER_COMMANDS.probe)),
      );
      const worker = await resolveWechatPersonalWorker({
        nodeRegistry: registry,
        allowLocalSidecar: !hasWechatNode,
      });
      const probe = await worker.probe();
      if (!probe.ok || !probe.online) {
        const error = probe.error ?? WECHAT_WORKER_OFFLINE_ERROR;
        statusSink({
          running: false,
          lastError: error,
          lastStopAt: Date.now(),
          mode: account.deviceType,
        });
        throw new Error(error);
      }
      const status = await worker.status({ accountId: account.accountId });
      if (!status.loggedIn) {
        const error = "WeChat personal worker is not logged in.";
        statusSink({
          running: false,
          lastError: error,
          lastStopAt: Date.now(),
          mode: account.deviceType,
        });
        throw new Error(error);
      }
      let webhookStop: (() => Promise<void>) | undefined;
      let webhookPath = account.webhookPath;
      // Mac Node owns 18789 when a wechat-capable desktop node is connected.
      // Local-direct without a node: Gateway binds 127.0.0.1 only.
      if (!hasWechatNode) {
        const listen = resolveWechatGatewayWebhookListen({
          allowLocalSidecar: true,
          port: account.webhookPort,
        });
        if (listen) {
          try {
            const server = await startWechatGatewayInboundWebhook({
              port: listen.port,
              path: account.webhookPath,
            });
            webhookStop = server.stop;
            webhookPath = `http://127.0.0.1:${server.port}`;
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : "";
            if (code === "EADDRINUSE") {
              console.warn(
                `wechat inbound: 127.0.0.1:${listen.port} already in use; continuing without Gateway listener (Mac Node likely owns the port)`,
              );
            } else {
              throw error;
            }
          }
        }
      }
      statusSink({
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
        mode: account.deviceType,
        webhookPath,
      });
      await runPassiveAccountLifecycle({
        abortSignal: ctx.abortSignal,
        start: async () => (webhookStop ? { host: "127.0.0.1" as const } : null),
        stop: async () => {
          await webhookStop?.();
        },
        onStop: async () => {
          statusSink({ running: false, lastStopAt: Date.now() });
        },
      });
    },
    loginWithQrStart: async ({ accountId, force, timeoutMs }) =>
      await startWechatLoginWithQr({ accountId, force, timeoutMs }),
    loginWithQrWait: async ({ accountId, timeoutMs }) =>
      await waitForWechatLogin({ accountId, timeoutMs }),
    logoutAccount: async ({ account }) =>
      await logoutWechatAccount({ accountId: account.accountId }),
  },
};
