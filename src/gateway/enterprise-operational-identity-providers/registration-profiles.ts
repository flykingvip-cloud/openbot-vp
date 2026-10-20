import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import type {
  OperationalIdentityRegistrationMethod,
  OperationalIdentityRegistrationProfile,
} from "./contract.js";

export const OPERATIONAL_IDENTITY_REGISTRATION_PROFILES: Partial<
  Record<EnterpriseOperationalIdentityProvider, OperationalIdentityRegistrationProfile>
> = {
  "wechat-official": {
    summary: "Agent 发图文/草稿需 AppID + AppSecret；保存前把网关出口 IP 加入公众号 IP 白名单。",
    methods: ["manual"],
    manualFields: [
      {
        key: "appId",
        label: "AppID",
        kind: "text",
        required: true,
        storage: "metadata",
        hint: "wx 开头，来自微信公众平台 → 开发 → 基本配置",
      },
      {
        key: "appSecret",
        label: "AppSecret",
        kind: "password",
        required: true,
        storage: "secret",
        hint: "开发者密码（仅显示一次）。留空则保持原凭证。",
      },
    ],
    verifyChecks: [{ key: "client_credential", label: "AppID / AppSecret 校验通过" }],
    actionRequirements: [
      { action: "upload_content_image", requiredFieldKeys: ["appId"] },
      { action: "publish_article", requiredFieldKeys: ["appId"] },
      { action: "publish_draft", requiredFieldKeys: ["appId"] },
    ],
  },
  "wechat-channels": {
    summary: "Agent 发视频号内容需视频号助手 / 开放平台 OAuth，不使用公众号 AppSecret。",
    methods: ["oauth"],
    oauthHint: "在视频号助手或微信开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "视频号授权校验通过" }],
    actionRequirements: [{ action: "publish_video", requiredFieldKeys: [] }],
  },
  "github-org": {
    summary:
      "Agent 操作组织仓库需 GitHub App Installation 或 fine-grained PAT（repo 权限），与员工端个人 GitHub OAuth 不同。",
    methods: ["oauth", "manual"],
    oauthHint: "用 GitHub App 安装到组织，或填写 fine-grained PAT。",
    manualFields: [
      {
        key: "installationId",
        label: "GitHub App Installation ID",
        kind: "text",
        required: false,
        storage: "metadata",
        hint: "GitHub App 安装到组织后的 Installation ID。",
      },
      {
        key: "personalAccessToken",
        label: "Personal Access Token",
        kind: "password",
        required: false,
        storage: "secret",
        hint: "fine-grained PAT，至少含目标仓库 contents/issues。与 Installation 二选一。",
      },
    ],
    verifyChecks: [{ key: "github_auth", label: "GitHub 组织凭证校验通过" }],
    actionRequirements: [{ action: "create_issue", requiredFieldKeys: [] }],
  },
  notion: {
    summary: "AI 操作 Notion 需 Integration Token 并授权目标页面/数据库。",
    methods: ["oauth", "manual"],
    manualFields: [
      {
        key: "integrationToken",
        label: "Integration Token",
        kind: "password",
        required: true,
        storage: "secret",
      },
    ],
    verifyChecks: [{ key: "notion_auth", label: "Notion API 认证通过" }],
    actionRequirements: [{ action: "create_page", requiredFieldKeys: [] }],
  },
  weibo: {
    summary: "AI 发微博需微博开放平台 OAuth 授权。",
    methods: ["oauth"],
    oauthHint: "在微博开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "post_status", requiredFieldKeys: [] }],
  },
  douyin: {
    summary: "AI 发抖音视频需抖音开放平台 OAuth 授权。",
    methods: ["oauth"],
    oauthHint: "在抖音开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "publish_video", requiredFieldKeys: [] }],
  },
  bilibili: {
    summary: "AI 发 B 站内容需哔哩哔哩开放平台 OAuth 授权。",
    methods: ["oauth"],
    oauthHint: "在哔哩哔哩开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "publish_video", requiredFieldKeys: [] }],
  },
  "x-twitter": {
    summary: "AI 发推文需 X API OAuth 2.0 授权。",
    methods: ["oauth"],
    oauthHint: "在 X Developer Portal 完成 OAuth 2.0 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth 2.0 token 有效" }],
    actionRequirements: [{ action: "post_tweet", requiredFieldKeys: [] }],
  },
  xiaohongshu: {
    summary: "AI 发小红书笔记需开放平台 OAuth 授权（取决于已审批接口权限）。",
    methods: ["oauth"],
    oauthHint: "在小红书开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "publish_note", requiredFieldKeys: [] }],
  },
  zhihu: {
    summary: "AI 发知乎内容需知乎 OAuth 授权。",
    methods: ["oauth"],
    oauthHint: "在知乎开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "publish_answer", requiredFieldKeys: [] }],
  },
  kuaishou: {
    summary: "AI 发快手视频需快手开放平台 OAuth 授权（取决于已审批接口权限）。",
    methods: ["oauth"],
    oauthHint: "在快手开放平台完成 OAuth 授权。",
    verifyChecks: [{ key: "oauth_token", label: "OAuth access_token 有效" }],
    actionRequirements: [{ action: "publish_video", requiredFieldKeys: [] }],
  },
  "tencent-meeting": {
    summary:
      "填入腾讯会议 AI Skill Token（meeting.tencent.com/ai-skill），保存后「测试连接」走 MCP 鉴权。",
    methods: ["manual"],
    manualFields: [
      {
        key: "token",
        label: "腾讯会议 Token",
        kind: "password",
        required: true,
        storage: "secret",
        hint: "在 https://meeting.tencent.com/ai-skill 获取，仅保存在租户凭证库。",
      },
    ],
    verifyChecks: [{ key: "auth_ok", label: "腾讯会议 Token 验证通过" }],
    actionRequirements: [
      { action: "schedule_meeting", requiredFieldKeys: ["token"] },
      { action: "cancel_meeting", requiredFieldKeys: ["token"] },
      { action: "get_meeting", requiredFieldKeys: ["token"] },
      { action: "get_meeting_by_code", requiredFieldKeys: ["token"] },
      { action: "list_meetings", requiredFieldKeys: ["token"] },
    ],
  },
};

export function getOperationalIdentityRegistrationProfile(
  provider: EnterpriseOperationalIdentityProvider,
): OperationalIdentityRegistrationProfile {
  const profile = OPERATIONAL_IDENTITY_REGISTRATION_PROFILES[provider];
  if (!profile) {
    throw new Error(`Unsupported operational identity provider: ${provider}`);
  }
  return profile;
}

export function listOperationalIdentityRegistrationMethods(
  provider: EnterpriseOperationalIdentityProvider,
): OperationalIdentityRegistrationMethod[] {
  return getOperationalIdentityRegistrationProfile(provider).methods;
}
