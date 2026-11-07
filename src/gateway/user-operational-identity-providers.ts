import type {
  UserOperationalIdentityAuthMode,
  UserOperationalIdentityManualKind,
  UserOperationalIdentityProvider,
  UserOperationalIdentityStatus,
} from "./user-operational-identity-types.js";
import {
  WECHAT_OFFICIAL_DATA_SYNC_ACTIONS,
  WECHAT_OFFICIAL_OPERATIONAL_ACTIONS,
} from "./wechat-official/index.js";

export type UserOperationalIdentityProviderCatalogEntry = {
  provider: UserOperationalIdentityProvider;
  label: string;
  category: "developer" | "communication" | "social" | "official";
  rolloutTier: "pilot" | "deferred";
  registrationReady: boolean;
  authMode: UserOperationalIdentityAuthMode;
  manualKind: UserOperationalIdentityManualKind | null;
  operationalActions: Array<{ action: string; label: string }>;
  reauthHint: string;
  degradedHint: string | null;
};

const SOCIAL_PUBLISH_ACTIONS: Array<{ action: string; label: string }> = [
  { action: "publish_post", label: "发布内容" },
  { action: "reply_comment", label: "回复评论" },
  { action: "sync_profile_metrics", label: "同步账号数据" },
];

const USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS: Array<{
  provider: UserOperationalIdentityProvider;
  label: string;
  category: UserOperationalIdentityProviderCatalogEntry["category"];
  rolloutTier: "pilot" | "deferred";
  registrationReady: boolean;
  authMode: UserOperationalIdentityAuthMode;
  manualKind: UserOperationalIdentityManualKind | null;
  operationalActions: Array<{ action: string; label: string }>;
  reauthHint: string;
  degradedHint: string | null;
}> = [
  {
    provider: "github-personal",
    label: "GitHub（个人）",
    category: "developer",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "oauth",
    manualKind: null,
    operationalActions: [
      { action: "create_issue", label: "创建 Issue" },
      { action: "create_pull_request", label: "创建 Pull Request" },
      { action: "comment", label: "发表评论" },
    ],
    reauthHint: "请重新授权 GitHub 个人访问令牌。",
    degradedHint: null,
  },
  {
    provider: "personal-email",
    label: "个人邮箱",
    category: "communication",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "smtp",
    operationalActions: [
      { action: "verify_credentials", label: "验证凭证" },
      { action: "sync_inbox", label: "同步收件箱" },
      { action: "read_email", label: "读取邮件" },
      { action: "search_email", label: "搜索邮件" },
      { action: "send_email", label: "发送邮件" },
      { action: "reply_email", label: "回复邮件" },
    ],
    reauthHint: "更新授权码后重新认证。",
    degradedHint: null,
  },
  {
    provider: "wechat-official",
    // Align label/actions with enterprise adapter (微信公众号).
    label: "微信公众号",
    category: "official",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "wechat_oa",
    operationalActions: [
      ...WECHAT_OFFICIAL_OPERATIONAL_ACTIONS,
      ...WECHAT_OFFICIAL_DATA_SYNC_ACTIONS,
    ],
    reauthHint: "请在微信公众平台刷新 AppSecret，并重新绑定公众号凭证。",
    // Align wording with enterprise wechat-official adapter.
    degradedHint: "个人微信（wechat）插件不等于公众号；请使用微信公众号 AppID / AppSecret。",
  },
  {
    provider: "weibo",
    label: "微博",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新微博账号访问凭证后重新绑定。",
    degradedHint: null,
  },
  {
    provider: "zhihu",
    label: "知乎",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新知乎账号访问凭证后重新绑定。",
    degradedHint: null,
  },
  {
    provider: "douyin",
    label: "抖音",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新抖音账号访问凭证后重新绑定。",
    degradedHint: null,
  },
  {
    provider: "xiaohongshu",
    label: "小红书",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新小红书账号访问凭证后重新绑定。",
    degradedHint: null,
  },
  {
    provider: "kuaishou",
    label: "快手",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新快手账号访问凭证后重新绑定。",
    degradedHint: null,
  },

  {
    provider: "bilibili",
    label: "哔哩哔哩",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: "social_account",
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请更新哔哩哔哩账号访问凭证后重新绑定。",
    degradedHint: null,
  },
  {
    provider: "x-twitter",
    label: "X",
    category: "social",
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "oauth",
    manualKind: null,
    operationalActions: SOCIAL_PUBLISH_ACTIONS,
    reauthHint: "请重新授权 X（Twitter）账号；发布类动作需要 tweet.write 权限。",
    degradedHint:
      "X 个人数字身份走 OAuth2+PKCE（与 GitHub 个人一致）。未授予 tweet.write 时仅可同步/阅读类动作，不可 publish_post / reply_comment。",
  },
  {
    provider: "feishu-personal",
    label: "飞书个人账号",
    category: "communication",
    rolloutTier: "deferred",
    registrationReady: false,
    authMode: "oauth",
    manualKind: null,
    operationalActions: [
      { action: "read", label: "读取" },
      { action: "draft", label: "起草" },
      { action: "send", label: "发送" },
    ],
    reauthHint: "飞书个人账号暂未开放绑定。",
    degradedHint: "当前仅支持企业 Bot/App 连接，个人账号绑定将在后续版本开放。",
  },
  {
    provider: "wechat-personal",
    label: "微信个人号",
    category: "social",
    // Local-worker QR only; not production-ready for cloud/LIVE.
    rolloutTier: "deferred",
    registrationReady: true,
    authMode: "qr_channel",
    manualKind: null,
    operationalActions: [{ action: "probe_status", label: "探测通道" }],
    reauthHint:
      "在本机打开 OpenBot 桌面端并确认节点已连接后，再扫码绑定。这不是手机微信在线，也不是公众号。",
    degradedHint:
      "微信个人号需本机 OpenBot 桌面通道在线后扫码；不等于公众号（微信公众号）或企微。会话仅保存在本地 worker，不进入云端 Gateway。",
  },
];

export function listUserOperationalIdentityProviderCatalog(): UserOperationalIdentityProviderCatalogEntry[] {
  return USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.map((adapter) => ({
    provider: adapter.provider,
    label: adapter.label,
    category: adapter.category,
    rolloutTier: adapter.rolloutTier,
    registrationReady: adapter.registrationReady,
    authMode: adapter.authMode,
    manualKind: adapter.manualKind,
    operationalActions: adapter.operationalActions.map((entry) => ({ ...entry })),
    reauthHint: adapter.reauthHint,
    degradedHint: adapter.degradedHint,
  }));
}

export function getUserOperationalIdentityProviderAdapter(
  provider: UserOperationalIdentityProvider,
): (typeof USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS)[number] | null {
  return (
    USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.find((entry) => entry.provider === provider) ?? null
  );
}

export function isUserOperationalIdentityProviderRegistrationReady(
  provider: UserOperationalIdentityProvider,
): boolean {
  return getUserOperationalIdentityProviderAdapter(provider)?.registrationReady === true;
}

export function isUserOperationalIdentityProviderManualAuth(
  provider: UserOperationalIdentityProvider,
): boolean {
  return getUserOperationalIdentityProviderAdapter(provider)?.authMode === "manual";
}

export function isUserOperationalIdentityProviderQrChannelAuth(
  provider: UserOperationalIdentityProvider,
): boolean {
  return getUserOperationalIdentityProviderAdapter(provider)?.authMode === "qr_channel";
}

export function getUserOperationalIdentityManualKind(
  provider: UserOperationalIdentityProvider,
): UserOperationalIdentityManualKind | null {
  return getUserOperationalIdentityProviderAdapter(provider)?.manualKind ?? null;
}

export function isUserOperationalIdentityPolicyAction(
  provider: UserOperationalIdentityProvider,
  action: string,
): boolean {
  const adapter = getUserOperationalIdentityProviderAdapter(provider);
  if (!adapter) {
    return false;
  }
  return adapter.operationalActions.some((entry) => entry.action === action);
}

export function resolveUserOperationalIdentityStatusHint(params: {
  provider: UserOperationalIdentityProvider;
  status: UserOperationalIdentityStatus;
}): { label: string; tone: "ok" | "warn" | "danger"; detail: string } {
  const adapter = getUserOperationalIdentityProviderAdapter(params.provider);
  if (params.status === "active") {
    return { label: "正常", tone: "ok", detail: "凭证可用。" };
  }
  if (params.status === "reauth_required") {
    return {
      label: "需重授权",
      tone: "warn",
      detail: adapter?.reauthHint ?? "请重新授权该运营身份。",
    };
  }
  if (params.status === "expired") {
    return { label: "已过期", tone: "danger", detail: "凭证已过期，请重新绑定。" };
  }
  return { label: "已停用", tone: "danger", detail: "该运营身份已停用。" };
}

export function parseUserOperationalIdentityProvider(
  value: unknown,
): UserOperationalIdentityProvider | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim() as UserOperationalIdentityProvider;
  return getUserOperationalIdentityProviderAdapter(normalized) ? normalized : null;
}

export const USER_OPERATIONAL_IDENTITY_PILOT_PROVIDERS: UserOperationalIdentityProvider[] =
  USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.filter((entry) => entry.registrationReady).map(
    (entry) => entry.provider,
  );

export const USER_OPERATIONAL_IDENTITY_SOCIAL_MANUAL_PROVIDERS: UserOperationalIdentityProvider[] =
  USER_OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.filter(
    (entry) => entry.manualKind === "social_account",
  ).map((entry) => entry.provider);
