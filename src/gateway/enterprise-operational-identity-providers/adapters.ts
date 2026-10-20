import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import type { OperationalIdentityProviderAdapter } from "./contract.js";

export const OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS: OperationalIdentityProviderAdapter[] = [
  {
    provider: "wechat-official",
    label: "微信公众号",
    category: "official",
    connectorIds: ["wechat-official", "wechat-mp"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在微信公众平台刷新 AppSecret，并重新绑定公众号凭证。",
    degradedHint: "个人微信（wechat）插件不等于公众号；请使用微信公众号 AppID / AppSecret。",
    actions: [
      { action: "upload_thumb", label: "上传封面", kind: "operational" },
      { action: "upload_content_image", label: "上传正文图片", kind: "operational" },
      { action: "publish_draft", label: "创建草稿", kind: "operational" },
      { action: "publish_article", label: "发布文章", kind: "operational" },
      { action: "get_publish_status", label: "查询发布状态", kind: "operational" },
      { action: "broadcast_article", label: "群发图文", kind: "operational" },
      { action: "sync_follower_stats", label: "同步粉丝统计", kind: "data_sync" },
      { action: "sync_article_metrics", label: "同步阅读数据", kind: "data_sync" },
    ],
  },
  {
    provider: "wechat-channels",
    label: "微信视频号",
    category: "official",
    connectorIds: ["wechat-channels", "wechat-video"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在视频号助手或开放平台重新授权，并更新绑定凭证。",
    actions: [
      { action: "publish_video", label: "发布视频", kind: "operational" },
      { action: "publish_live_notice", label: "发布直播预告", kind: "operational" },
      { action: "sync_video_metrics", label: "同步播放数据", kind: "data_sync" },
    ],
  },
  {
    provider: "github-org",
    label: "GitHub Org",
    category: "business",
    connectorIds: ["github-org", "github"],
    rolloutTier: "p2",
    registrationReady: true,
    reauthHint: "请刷新 GitHub Org App / PAT 凭证并确认组织授权范围。",
    degradedHint: "GitHub Copilot 远程能力不等于 GitHub Org 运营身份。",
    actions: [
      { action: "create_issue", label: "创建 Issue", kind: "operational" },
      { action: "create_comment", label: "发表评论", kind: "operational" },
      { action: "sync_repository_metadata", label: "同步仓库元数据", kind: "data_sync" },
    ],
  },
  {
    provider: "notion",
    label: "Notion",
    category: "business",
    connectorIds: ["notion"],
    rolloutTier: "p2",
    registrationReady: true,
    reauthHint: "请重新授权 Notion Integration 并确认页面/数据库权限。",
    actions: [
      { action: "create_page", label: "创建页面", kind: "operational" },
      { action: "update_page", label: "更新页面", kind: "operational" },
      { action: "publish_page", label: "发布页面", kind: "operational" },
      { action: "sync_database_schema", label: "同步数据库结构", kind: "data_sync" },
    ],
  },
  {
    provider: "weibo",
    label: "微博（企业）",
    category: "official",
    connectorIds: ["weibo", "weibo-official"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在微博开放平台重新授权并更新岗位绑定的连接器凭证。",
    actions: [
      { action: "post_status", label: "发布微博", kind: "operational" },
      { action: "upload_image", label: "上传图片", kind: "operational" },
      { action: "sync_follower_stats", label: "同步粉丝数据", kind: "data_sync" },
    ],
  },
  {
    provider: "douyin",
    label: "抖音（企业）",
    category: "official",
    connectorIds: ["douyin", "douyin-official"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在抖音开放平台重新授权并更新岗位绑定的连接器凭证。",
    actions: [
      { action: "publish_video", label: "发布视频", kind: "operational" },
      { action: "sync_user_profile", label: "同步用户资料", kind: "data_sync" },
    ],
  },
  {
    provider: "bilibili",
    label: "哔哩哔哩（企业）",
    category: "official",
    connectorIds: ["bilibili", "bilibili-official"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在哔哩哔哩开放平台重新授权并更新岗位绑定的连接器凭证。",
    actions: [
      { action: "publish_article", label: "发布专栏", kind: "operational" },
      { action: "publish_video", label: "发布视频", kind: "operational" },
      { action: "sync_video_metrics", label: "同步播放数据", kind: "data_sync" },
    ],
  },
  {
    provider: "x-twitter",
    label: "X（Twitter）",
    category: "official",
    connectorIds: ["x-twitter", "twitter", "x"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在 X Developer Portal 重新授权 OAuth 2.0 并更新凭证。",
    actions: [
      { action: "post_tweet", label: "发布推文", kind: "operational" },
      { action: "reply_tweet", label: "回复推文", kind: "operational" },
      { action: "sync_engagement_metrics", label: "同步互动数据", kind: "data_sync" },
    ],
  },
  {
    provider: "xiaohongshu",
    label: "小红书（企业）",
    category: "official",
    connectorIds: ["xiaohongshu", "xhs"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在小红书开放平台重新授权并更新岗位绑定的连接器凭证。",
    degradedHint: "内容发布能力取决于开放平台已审批的接口权限。",
    actions: [
      { action: "publish_note", label: "发布笔记", kind: "operational" },
      { action: "sync_shop_profile", label: "同步店铺资料", kind: "data_sync" },
    ],
  },
  {
    provider: "zhihu",
    label: "知乎（企业）",
    category: "official",
    connectorIds: ["zhihu", "zhihu-official"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在知乎开放平台重新授权并更新岗位绑定的连接器凭证。",
    degradedHint: "内容发布能力取决于开放平台已审批的接口权限。",
    actions: [
      { action: "publish_answer", label: "发布回答", kind: "operational" },
      { action: "publish_article", label: "发布文章", kind: "operational" },
      { action: "sync_content_metrics", label: "同步内容数据", kind: "data_sync" },
    ],
  },
  {
    provider: "kuaishou",
    label: "快手（企业）",
    category: "official",
    connectorIds: ["kuaishou", "kuaishou-official"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请在快手开放平台重新授权并更新岗位绑定的连接器凭证。",
    degradedHint: "内容发布能力取决于开放平台已审批的接口权限。",
    actions: [
      { action: "publish_video", label: "发布视频", kind: "operational" },
      { action: "sync_video_metrics", label: "同步播放数据", kind: "data_sync" },
    ],
  },
  {
    provider: "tencent-meeting",
    label: "腾讯会议（企业）",
    category: "communication",
    connectorIds: ["tencent-meeting", "tencent-meeting-enterprise", "wemeet"],
    rolloutTier: "p0",
    registrationReady: true,
    reauthHint: "请到 https://meeting.tencent.com/ai-skill 重新获取 Token，并在此更新后测试连接。",
    degradedHint: "预约/取消会议取决于该 Token 在腾讯会议 MCP 上已开通的权限。",
    actions: [
      { action: "schedule_meeting", label: "预约会议", kind: "operational" },
      { action: "cancel_meeting", label: "取消会议", kind: "operational" },
      { action: "get_meeting", label: "查询会议", kind: "operational" },
      { action: "get_meeting_by_code", label: "按会议号查询", kind: "operational" },
      { action: "list_meetings", label: "列出会议", kind: "operational" },
    ],
  },
];

const adapterByProvider = new Map(
  OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.map((adapter) => [adapter.provider, adapter]),
);

const adapterByConnectorId = new Map<string, OperationalIdentityProviderAdapter>();
for (const adapter of OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS) {
  for (const connectorId of adapter.connectorIds) {
    adapterByConnectorId.set(connectorId.toLowerCase(), adapter);
  }
}

export function getOperationalIdentityProviderAdapter(
  provider: EnterpriseOperationalIdentityProvider,
): OperationalIdentityProviderAdapter {
  const adapter = adapterByProvider.get(provider);
  if (!adapter) {
    throw new Error(`Unsupported operational identity provider: ${provider}`);
  }
  return adapter;
}

const LEGACY_REMOVED_OPERATIONAL_IDENTITY_PRESENTATION = {
  feishu: { label: "飞书", category: "communication" as const },
  wecom: { label: "企业微信", category: "communication" as const },
  dingtalk: { label: "钉钉", category: "communication" as const },
  "enterprise-email": { label: "企业邮箱", category: "official" as const },
  jira: { label: "Jira", category: "business" as const },
};

export function tryGetOperationalIdentityProviderAdapter(
  provider: string,
): OperationalIdentityProviderAdapter | null {
  return adapterByProvider.get(provider as EnterpriseOperationalIdentityProvider) ?? null;
}

export function resolveOperationalIdentityProviderPresentation(provider: string): {
  label: string;
  category: "official" | "communication" | "business";
  catalogRemoved: boolean;
} {
  const adapter = tryGetOperationalIdentityProviderAdapter(provider);
  if (adapter) {
    return { label: adapter.label, category: adapter.category, catalogRemoved: false };
  }
  const legacy =
    LEGACY_REMOVED_OPERATIONAL_IDENTITY_PRESENTATION[
      provider as keyof typeof LEGACY_REMOVED_OPERATIONAL_IDENTITY_PRESENTATION
    ];
  if (legacy) {
    const label =
      legacy.label === "企业邮箱"
        ? `${legacy.label}（员工自行配置，已移出企业目录）`
        : legacy.label === "飞书" || legacy.label === "企业微信" || legacy.label === "钉钉"
          ? `${legacy.label}（已移出目录，可经 MCP 接入）`
          : `${legacy.label}（已移出企业目录）`;
    return {
      label,
      category: legacy.category,
      catalogRemoved: true,
    };
  }
  return { label: provider, category: "official", catalogRemoved: true };
}

export function resolveOperationalIdentityAdapterFromConnectorId(
  connectorId: string,
): OperationalIdentityProviderAdapter | null {
  return adapterByConnectorId.get(connectorId.trim().toLowerCase()) ?? null;
}
