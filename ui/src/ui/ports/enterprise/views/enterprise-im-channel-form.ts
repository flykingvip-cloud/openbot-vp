/**
 * Curated enterprise IM channel credential form (wecom / feishu / dingtalk).
 *
 * Renders only the fields needed for tenant onboarding — not the full multi-account
 * catchall schema used by the ops Channels page. Writes to
 * `channels.<id>.accounts.<accountId>.*` so Callback URL + webhook path helpers stay aligned.
 *
 * Feishu/Dingtalk default to long-connection modes (websocket / stream). Callback URL and
 * webhook-only secrets appear only when connectionMode is webhook.
 */

import { html, type TemplateResult } from "lit";
import { defaultImWebhookPath } from "../../../controllers/tenant-im-binding.ts";

export type EnterpriseImFormChannelId = "wecom" | "feishu" | "dingtalk";

/** Normalized UI mode across enterprise IM channels. */
export type EnterpriseImUiConnectionMode = "websocket" | "stream" | "webhook" | "callback";

export type EnterpriseImCredentialField = {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  secret?: boolean;
};

const WECOM_AIBOT_FIELDS: EnterpriseImCredentialField[] = [
  {
    key: "botId",
    label: "Bot ID",
    help: "企微管理后台 → 智能机器人 → API 长连接模式中的 Bot ID。",
    placeholder: "aibXXXXXXXX",
  },
  {
    key: "secret",
    label: "长连接 Secret",
    help: "智能机器人长连接专用 Secret（点击获取后请立即保存，仅显示一次）。",
    secret: true,
  },
];

const WECOM_CALLBACK_FIELDS: EnterpriseImCredentialField[] = [
  {
    key: "corpId",
    label: "企业 Corp ID",
    help: "企业微信管理后台 → 我的企业 中的企业 ID。",
    placeholder: "ww1234567890abcdef",
  },
  {
    key: "agentId",
    label: "应用 Agent ID",
    help: "自建应用详情页中的 AgentId。",
    placeholder: "1000002",
  },
  {
    key: "secret",
    label: "应用 Secret",
    help: "自建应用 Secret，用于获取 access_token 并回复消息。",
    secret: true,
  },
  {
    key: "token",
    label: "回调 Token",
    help: "接收消息服务器配置中的 Token（可随机生成后粘贴到此）。",
    secret: true,
  },
  {
    key: "encodingAesKey",
    label: "回调 EncodingAESKey",
    help: "接收消息服务器配置中的 43 位 EncodingAESKey。",
    secret: true,
    placeholder: "43 位密钥",
  },
];

const FEISHU_BASE_FIELDS: EnterpriseImCredentialField[] = [
  {
    key: "appId",
    label: "App ID",
    help: "飞书开放平台「凭证与基础信息」中的 App ID。",
    placeholder: "cli_xxx",
  },
  {
    key: "appSecret",
    label: "App Secret",
    help: "飞书开放平台「凭证与基础信息」中的 App Secret。",
    secret: true,
  },
];

const FEISHU_WEBHOOK_FIELDS: EnterpriseImCredentialField[] = [
  {
    key: "verificationToken",
    label: "Verification Token",
    help: "事件与回调 → 加密策略中的 Verification Token。",
    secret: true,
  },
  {
    key: "encryptKey",
    label: "Encrypt Key",
    help: "事件与回调 → 加密策略中的 Encrypt Key（可选但建议填写）。",
    secret: true,
  },
];

const DINGTALK_FIELDS: EnterpriseImCredentialField[] = [
  {
    key: "clientId",
    label: "Client ID / AppKey",
    help: "钉钉开放平台「凭证与基础信息」中的 Client ID。",
  },
  {
    key: "clientSecret",
    label: "Client Secret / AppSecret",
    help: "钉钉开放平台「凭证与基础信息」中的 Client Secret。",
    secret: true,
  },
];

const ROOT_META_KEYS = new Set(["accounts", "defaultAccount", "enabled"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function defaultEnterpriseImConnectionMode(
  channelId: EnterpriseImFormChannelId,
): EnterpriseImUiConnectionMode {
  switch (channelId) {
    case "feishu":
    case "wecom":
      return "websocket";
    case "dingtalk":
      return "stream";
  }
}

/** Stored config value for connectionMode. */
export function toStoredConnectionMode(
  channelId: EnterpriseImFormChannelId,
  uiMode: EnterpriseImUiConnectionMode,
): string | undefined {
  if (channelId === "wecom") {
    return uiMode === "websocket" ? "websocket" : "callback";
  }
  if (channelId === "feishu") {
    return uiMode === "webhook" ? "webhook" : "websocket";
  }
  if (channelId === "dingtalk") {
    return uiMode === "webhook" ? "webhook" : "stream";
  }
  return undefined;
}

export function resolveEnterpriseImConnectionMode(params: {
  channelId: EnterpriseImFormChannelId;
  values: Record<string, unknown>;
}): EnterpriseImUiConnectionMode {
  const raw = typeof params.values.connectionMode === "string" ? params.values.connectionMode : "";
  if (params.channelId === "wecom") {
    // Legacy configs without connectionMode stay on corp-app callback.
    if (!raw) {
      const hasBot = typeof params.values.botId === "string" && params.values.botId.trim();
      const hasCorp = typeof params.values.corpId === "string" && params.values.corpId.trim();
      if (hasBot && !hasCorp) {
        return "websocket";
      }
      if (hasCorp) {
        return "callback";
      }
      return "websocket";
    }
    return raw === "websocket" ? "websocket" : "callback";
  }
  if (params.channelId === "feishu") {
    return raw === "webhook" ? "webhook" : "websocket";
  }
  if (params.channelId === "dingtalk") {
    return raw === "webhook" ? "webhook" : "stream";
  }
  return defaultEnterpriseImConnectionMode(params.channelId);
}

export function enterpriseImNeedsCallbackUrl(
  channelId: EnterpriseImFormChannelId,
  mode: EnterpriseImUiConnectionMode,
): boolean {
  if (channelId === "wecom") {
    return mode === "callback";
  }
  return mode === "webhook";
}

export function resolveEnterpriseImCredentialFields(
  channelId: EnterpriseImFormChannelId,
  mode: EnterpriseImUiConnectionMode = defaultEnterpriseImConnectionMode(channelId),
): EnterpriseImCredentialField[] {
  switch (channelId) {
    case "wecom":
      return mode === "websocket" ? WECOM_AIBOT_FIELDS : WECOM_CALLBACK_FIELDS;
    case "feishu":
      return mode === "webhook"
        ? [...FEISHU_BASE_FIELDS, ...FEISHU_WEBHOOK_FIELDS]
        : FEISHU_BASE_FIELDS;
    case "dingtalk":
      return DINGTALK_FIELDS;
  }
}

export type EnterpriseImSetupSectionId = "platform" | "openbot";

export type EnterpriseImSetupSection = {
  id: EnterpriseImSetupSectionId;
  title: string;
  items: string[];
};

/** Two-part checklist: open-platform prep + in-product config / verify. */
export function resolveEnterpriseImSetupGuide(
  channelId: EnterpriseImFormChannelId,
  mode: EnterpriseImUiConnectionMode = defaultEnterpriseImConnectionMode(channelId),
): EnterpriseImSetupSection[] {
  switch (channelId) {
    case "wecom":
      if (mode === "websocket") {
        return [
          {
            id: "platform",
            title: "开放平台检查",
            items: [
              "管理后台 → 智能机器人 → 手动创建 → API 模式",
              "选择「使用长连接」，复制 Bot ID，并点击获取 Secret（仅显示一次）",
              "设置机器人可见范围；无需配置 URL / Token / EncodingAESKey",
            ],
          },
          {
            id: "openbot",
            title: "本页配置",
            items: [
              "保持「WebSocket 长连接」，填写 Bot ID / Secret 并保存",
              "无需回填 Callback URL；网关会主动连接企微长连接服务",
              "向机器人发「你好」，再点击「测试连通」",
            ],
          },
        ];
      }
      return [
        {
          id: "platform",
          title: "开放平台检查",
          items: [
            "管理后台创建自建应用，并设置成员可见范围",
            "在「接收消息」准备 Token / EncodingAESKey（可随机生成）",
            "确认企业可信 IP / 发布状态满足回调要求",
          ],
        },
        {
          id: "openbot",
          title: "本页配置",
          items: [
            "选择「URL 回调」，填写五项凭证并保存（自动生成账户级回调路径）",
            "复制 Callback URL，回填到企微「接收消息」并保存",
            "向机器人发「你好」，再点击「测试连通」",
          ],
        },
      ];
    case "feishu":
      if (mode === "webhook") {
        return [
          {
            id: "platform",
            title: "开放平台检查",
            items: [
              "创建企业自建应用，并添加「机器人」能力",
              "权限管理导入消息收发相关权限（含 im:message:send_as_bot 等）",
              "事件与回调生成 Verification Token / Encrypt Key；添加「接收消息」事件与卡片回传",
              "创建版本并发布（未发布则成员侧不可用）",
            ],
          },
          {
            id: "openbot",
            title: "本页配置",
            items: [
              "选择「URL 回调」，填写 App ID / Secret 与 Verification Token 后保存",
              "复制 Callback URL，事件订阅选「开发者服务器」并粘贴保存",
              "私聊机器人发「你好」，再点击「测试连通」",
            ],
          },
        ];
      }
      return [
        {
          id: "platform",
          title: "开放平台检查",
          items: [
            "创建企业自建应用，并添加「机器人」能力",
            "权限管理导入消息收发相关权限（含 im:message:send_as_bot 等）",
            "事件订阅选择「使用长连接接收事件」并验证；添加「接收消息」事件",
            "创建版本并发布（未发布则成员侧不可用）",
          ],
        },
        {
          id: "openbot",
          title: "本页配置",
          items: [
            "保持「WebSocket 长连接」，填写 App ID / App Secret 并保存",
            "无需回填 Callback URL；确认开放平台长连接状态为已连接",
            "私聊机器人发「你好」，再点击「测试连通」",
          ],
        },
      ];
    case "dingtalk":
      if (mode === "webhook") {
        return [
          {
            id: "platform",
            title: "开放平台检查",
            items: [
              "开发者后台创建应用并添加机器人能力",
              "开通 Card.Streaming.Write、Card.Instance.Write、qyapi_robot_sendmsg",
              "创建版本并发布；群聊使用时确认群归属组织与应用一致",
            ],
          },
          {
            id: "openbot",
            title: "本页配置",
            items: [
              "选择「URL 回调」，填写 Client ID / Secret 并保存",
              "复制 Callback URL；机器人消息接收切 HTTP，粘贴 https 地址后发布",
              "私聊或 @机器人发「你好」，再点击「测试连通」",
            ],
          },
        ];
      }
      return [
        {
          id: "platform",
          title: "开放平台检查",
          items: [
            "开发者后台创建应用并添加机器人能力",
            "开通 Card.Streaming.Write、Card.Instance.Write、qyapi_robot_sendmsg",
            "保持消息接收为 Stream 模式；创建版本并发布",
            "群聊使用时确认群归属组织与应用一致",
          ],
        },
        {
          id: "openbot",
          title: "本页配置",
          items: [
            "保持「Stream 长连接」，填写 Client ID / Secret 并保存",
            "无需回填 Webhook；确认应用已发布",
            "私聊或 @机器人发「你好」，再点击「测试连通」",
          ],
        },
      ];
  }
}

/** Flat step list (compat / tests). Prefer resolveEnterpriseImSetupGuide for UI. */
export function resolveEnterpriseImSetupSteps(
  channelId: EnterpriseImFormChannelId,
  mode: EnterpriseImUiConnectionMode = defaultEnterpriseImConnectionMode(channelId),
): string[] {
  return resolveEnterpriseImSetupGuide(channelId, mode).flatMap((section) => section.items);
}

export function resolveEnterpriseImModeNote(
  channelId: EnterpriseImFormChannelId,
  mode: EnterpriseImUiConnectionMode,
): string {
  if (channelId === "wecom") {
    return mode === "websocket"
      ? "长连接模式：填写 Bot ID + Secret 后保存即可。"
      : "回调模式：保存后复制 Callback URL 回填企微即可。";
  }
  if (mode === "webhook") {
    return "回调模式：保存后将 Callback URL 回填开放平台。";
  }
  if (channelId === "feishu") {
    return "长连接模式：开放平台事件订阅请选「使用长连接接收事件」。";
  }
  return "长连接模式：机器人消息接收请保持 Stream。";
}

/** Same-origin public Help Center guide for each enterprise IM channel. */
export function resolveEnterpriseImHelpHref(channelId: EnterpriseImFormChannelId): string {
  return `/help/${channelId}`;
}

export function resolveEnterpriseImHelpLabel(channelId: EnterpriseImFormChannelId): string {
  switch (channelId) {
    case "wecom":
      return "企业微信配置指南";
    case "feishu":
      return "飞书配置指南";
    case "dingtalk":
      return "钉钉配置指南";
  }
}

/** Prefer t_<tenant>_default, then default, then first existing account key. */
export function resolveEnterpriseImPrimaryAccountId(
  accounts: Record<string, unknown> | null | undefined,
  tenantId: string,
): string {
  const preferred = defaultEnterpriseImAccountId(tenantId);
  const keys = accounts && typeof accounts === "object" ? Object.keys(accounts) : [];
  if (keys.includes(preferred)) {
    return preferred;
  }
  if (keys.includes("default")) {
    return "default";
  }
  if (keys.length > 0) {
    return keys[0];
  }
  return preferred;
}

export function defaultEnterpriseImAccountId(tenantId: string): string {
  const normalized = tenantId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const slug = normalized || "tenant";
  return `t_${slug}_default`;
}

export function readEnterpriseImAccountValues(params: {
  form: Record<string, unknown> | null | undefined;
  channelId: EnterpriseImFormChannelId;
  accountId: string;
}): Record<string, unknown> {
  const channel = asRecord(asRecord(params.form?.channels)?.[params.channelId]);
  if (!channel) {
    return {};
  }
  const accounts = asRecord(channel.accounts);
  const account = asRecord(accounts?.[params.accountId]) ?? {};
  const rootCreds: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(channel)) {
    if (!ROOT_META_KEYS.has(key)) {
      rootCreds[key] = value;
    }
  }
  // Account wins; root fills gaps for legacy configs that only stored root-level secrets.
  return { ...rootCreds, ...account };
}

function applyDefaultConnectionMode(
  channelId: EnterpriseImFormChannelId,
  account: Record<string, unknown>,
): void {
  if (typeof account.connectionMode === "string" && account.connectionMode.trim()) {
    return;
  }
  // Legacy WeCom corp-app configs (have corpId, no botId) stay on callback.
  if (channelId === "wecom") {
    const hasCorp = typeof account.corpId === "string" && account.corpId.trim();
    const hasBot = typeof account.botId === "string" && account.botId.trim();
    if (hasCorp && !hasBot) {
      account.connectionMode = "callback";
      return;
    }
  }
  const uiDefault = defaultEnterpriseImConnectionMode(channelId);
  const stored = toStoredConnectionMode(channelId, uiDefault);
  if (stored) {
    account.connectionMode = stored;
  }
}

/**
 * Ensure channel + primary account exist in the in-memory form.
 * Migrates root-level credential keys into the account when creating it.
 * Does not persist — caller patches configRaw locally.
 */
export function ensureEnterpriseImAccountForm(params: {
  form: Record<string, unknown>;
  channelId: EnterpriseImFormChannelId;
  tenantId: string;
}): { form: Record<string, unknown>; accountId: string } {
  const root = structuredClone(params.form);
  const channels = asRecord(root.channels) ?? {};
  root.channels = channels;
  const entry = asRecord(channels[params.channelId]) ?? {};
  if (entry.enabled === undefined) {
    entry.enabled = true;
  }
  const accounts = asRecord(entry.accounts) ?? {};
  const accountId = resolveEnterpriseImPrimaryAccountId(accounts, params.tenantId);
  let account = asRecord(accounts[accountId]);
  if (!account) {
    account = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!ROOT_META_KEYS.has(key)) {
        account[key] = value;
      }
    }
    applyDefaultConnectionMode(params.channelId, account);
    const path = typeof account.webhookPath === "string" ? account.webhookPath.trim() : "";
    if (!path) {
      account.webhookPath = defaultImWebhookPath(params.channelId, accountId);
    }
    accounts[accountId] = account;
  } else {
    applyDefaultConnectionMode(params.channelId, account);
    const path = typeof account.webhookPath === "string" ? account.webhookPath.trim() : "";
    if (!path) {
      account.webhookPath = defaultImWebhookPath(params.channelId, accountId);
    }
    accounts[accountId] = account;
  }
  entry.accounts = accounts;
  channels[params.channelId] = entry;
  return { form: root, accountId };
}

/** Patch one credential field on the primary tenant account (in-memory). */
export function setEnterpriseImAccountFieldValue(params: {
  form: Record<string, unknown>;
  channelId: EnterpriseImFormChannelId;
  tenantId: string;
  field: string;
  value: unknown;
}): Record<string, unknown> {
  const { form, accountId } = ensureEnterpriseImAccountForm({
    form: params.form,
    channelId: params.channelId,
    tenantId: params.tenantId,
  });
  const channel = asRecord(asRecord(form.channels)?.[params.channelId]) ?? {};
  const accounts = asRecord(channel.accounts) ?? {};
  const account = asRecord(accounts[accountId]) ?? {};
  account[params.field] = params.value;
  accounts[accountId] = account;
  channel.accounts = accounts;
  const channels = asRecord(form.channels) ?? {};
  channels[params.channelId] = channel;
  form.channels = channels;
  return form;
}

function renderModeSelector(params: {
  channelId: EnterpriseImFormChannelId;
  mode: EnterpriseImUiConnectionMode;
  disabled?: boolean;
  onModeChange: (mode: EnterpriseImUiConnectionMode) => void;
}): TemplateResult {
  if (params.channelId === "wecom") {
    return html`
      <label class="enterprise-im-curated__field">
        <span class="enterprise-im-curated__label">连接模式</span>
        <select
          class="enterprise-im-curated__input"
          data-testid="enterprise-im-connection-mode"
          data-field="connectionMode"
          .value=${params.mode === "websocket" ? "websocket" : "callback"}
          ?disabled=${Boolean(params.disabled)}
          @change=${(event: Event) => {
            const next = (event.target as HTMLSelectElement).value;
            params.onModeChange(next === "websocket" ? "websocket" : "callback");
          }}
        >
          <option value="websocket">WebSocket 长连接 / 智能机器人（推荐）</option>
          <option value="callback">URL 回调 / 自建应用（备选）</option>
        </select>
        <span class="enterprise-im-curated__help">
          长连接只需 Bot ID + Secret；URL 回调需自建应用五项凭证并回填 Callback。
        </span>
      </label>
    `;
  }
  const longValue = params.channelId === "feishu" ? "websocket" : "stream";
  const longLabel =
    params.channelId === "feishu" ? "WebSocket 长连接（推荐）" : "Stream 长连接（推荐）";
  return html`
    <label class="enterprise-im-curated__field">
      <span class="enterprise-im-curated__label">连接模式</span>
      <select
        class="enterprise-im-curated__input"
        data-testid="enterprise-im-connection-mode"
        data-field="connectionMode"
        .value=${params.mode === "webhook" ? "webhook" : longValue}
        ?disabled=${Boolean(params.disabled)}
        @change=${(event: Event) => {
          const next = (event.target as HTMLSelectElement).value;
          params.onModeChange(
            next === "webhook" ? "webhook" : (longValue as EnterpriseImUiConnectionMode),
          );
        }}
      >
        <option value=${longValue}>${longLabel}</option>
        <option value="webhook">URL 回调（备选）</option>
      </select>
      <span class="enterprise-im-curated__help">
        长连接无需公网回调；仅在已有网关公网地址或必须 HTTP 推送时改用 URL 回调。
      </span>
    </label>
  `;
}

export function renderEnterpriseImChannelForm(params: {
  channelId: EnterpriseImFormChannelId;
  form: Record<string, unknown>;
  tenantId: string;
  disabled?: boolean;
  onFieldChange: (field: string, value: string) => void;
}): TemplateResult {
  const { form, accountId } = ensureEnterpriseImAccountForm({
    form: params.form,
    channelId: params.channelId,
    tenantId: params.tenantId,
  });
  const values = readEnterpriseImAccountValues({
    form,
    channelId: params.channelId,
    accountId,
  });
  const mode = resolveEnterpriseImConnectionMode({
    channelId: params.channelId,
    values,
  });
  const fields = resolveEnterpriseImCredentialFields(params.channelId, mode);
  const note = resolveEnterpriseImModeNote(params.channelId, mode);
  const helpHref = resolveEnterpriseImHelpHref(params.channelId);
  const helpLabel = resolveEnterpriseImHelpLabel(params.channelId);

  return html`
    <div
      class="enterprise-im-curated"
      data-testid="enterprise-im-curated-form"
      data-connection-mode=${mode}
    >
      <div class="enterprise-im-curated__toolbar">
        <div class="enterprise-im-curated__section-title">接入配置</div>
        <a
          class="enterprise-im-curated__guide-link"
          href=${helpHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="enterprise-im-help-link"
        >
          ${helpLabel}
        </a>
      </div>
      <div class="enterprise-im-curated__guide-bar" data-testid="enterprise-im-setup-guide">
        <span class="enterprise-im-curated__guide-meta">${note}</span>
      </div>
      <div class="enterprise-im-curated__fields">
        ${renderModeSelector({
          channelId: params.channelId,
          mode,
          disabled: params.disabled,
          onModeChange: (nextMode) => {
            const stored = toStoredConnectionMode(params.channelId, nextMode);
            if (stored) {
              params.onFieldChange("connectionMode", stored);
            }
          },
        })}
        ${fields.map((field) => {
          const raw = values[field.key];
          const value =
            typeof raw === "string"
              ? raw
              : typeof raw === "number" || typeof raw === "boolean"
                ? String(raw)
                : "";
          return html`
            <label class="enterprise-im-curated__field">
              <span class="enterprise-im-curated__label">${field.label}</span>
              <input
                class="enterprise-im-curated__input"
                type=${field.secret ? "password" : "text"}
                name=${`channels.${params.channelId}.accounts.${accountId}.${field.key}`}
                data-field=${field.key}
                .value=${value}
                placeholder=${field.placeholder ?? ""}
                autocomplete="off"
                spellcheck="false"
                ?disabled=${Boolean(params.disabled)}
                @input=${(event: Event) => {
                  const next = (event.target as HTMLInputElement).value;
                  params.onFieldChange(field.key, next);
                }}
              />
              <span class="enterprise-im-curated__help">${field.help}</span>
            </label>
          `;
        })}
      </div>
    </div>
  `;
}
