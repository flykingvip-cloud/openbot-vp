import { resolveUserOperationalIdentityOAuthAdapterConfig } from "../user-operational-identity-oauth-adapters/index.js";
import type { UserOperationalIdentityProvider } from "../user-operational-identity-types.js";

export type EnterpriseSocialOAuthProviderSlug =
  | "weibo"
  | "douyin"
  | "bilibili"
  | "x-twitter"
  | "xiaohongshu"
  | "zhihu";

export type EnterpriseSocialOAuthProviderSpec = {
  slug: EnterpriseSocialOAuthProviderSlug;
  userProvider: UserOperationalIdentityProvider;
  connectorId: string;
  label: string;
};

export const ENTERPRISE_SOCIAL_OAUTH_PROVIDERS: EnterpriseSocialOAuthProviderSpec[] = [
  { slug: "weibo", userProvider: "weibo", connectorId: "weibo", label: "微博" },
  { slug: "douyin", userProvider: "douyin", connectorId: "douyin", label: "抖音" },
  { slug: "bilibili", userProvider: "bilibili", connectorId: "bilibili", label: "哔哩哔哩" },
  { slug: "x-twitter", userProvider: "x-twitter", connectorId: "x-twitter", label: "X（Twitter）" },
  {
    slug: "xiaohongshu",
    userProvider: "xiaohongshu",
    connectorId: "xiaohongshu",
    label: "小红书",
  },
  { slug: "zhihu", userProvider: "zhihu", connectorId: "zhihu", label: "知乎" },
];

const specBySlug = new Map(ENTERPRISE_SOCIAL_OAUTH_PROVIDERS.map((spec) => [spec.slug, spec]));

export function parseEnterpriseSocialOAuthProviderSlug(
  value: string,
): EnterpriseSocialOAuthProviderSpec | null {
  return specBySlug.get(value.trim() as EnterpriseSocialOAuthProviderSlug) ?? null;
}

export function isEnterpriseSocialOAuthProviderConfigured(
  spec: EnterpriseSocialOAuthProviderSpec,
  redirectUri?: string,
): boolean {
  return Boolean(
    resolveUserOperationalIdentityOAuthAdapterConfig({
      provider: spec.userProvider,
      redirectUri,
    }),
  );
}
