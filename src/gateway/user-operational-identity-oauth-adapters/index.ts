import { createHash, randomBytes } from "node:crypto";
import type { UserOperationalIdentityProvider } from "../user-operational-identity-types.js";
import { bilibiliOAuthAdapter } from "./bilibili.js";
import { douyinOAuthAdapter } from "./douyin.js";
import { githubPersonalOAuthAdapter } from "./github.js";
import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { weiboOAuthAdapter } from "./weibo.js";
import { xTwitterOAuthAdapter } from "./x-twitter.js";
import { xiaohongshuOAuthAdapter } from "./xiaohongshu.js";
import { zhihuOAuthAdapter } from "./zhihu.js";

export type {
  UserOperationalIdentityOAuthAdapter,
  UserOperationalIdentityOAuthAdapterConfig,
} from "./types.js";

const USER_OPERATIONAL_IDENTITY_OAUTH_ADAPTERS: UserOperationalIdentityOAuthAdapter[] = [
  githubPersonalOAuthAdapter,
  weiboOAuthAdapter,
  douyinOAuthAdapter,
  bilibiliOAuthAdapter,
  xTwitterOAuthAdapter,
  xiaohongshuOAuthAdapter,
  zhihuOAuthAdapter,
];

const adapterByProvider = new Map<
  UserOperationalIdentityProvider,
  UserOperationalIdentityOAuthAdapter
>(USER_OPERATIONAL_IDENTITY_OAUTH_ADAPTERS.map((adapter) => [adapter.provider, adapter]));

export function getUserOperationalIdentityOAuthAdapter(
  provider: UserOperationalIdentityProvider,
): UserOperationalIdentityOAuthAdapter | null {
  return adapterByProvider.get(provider) ?? null;
}

export function resolveUserOperationalIdentityOAuthAdapterConfig(params: {
  provider: UserOperationalIdentityProvider;
  redirectUri?: string;
}): ReturnType<UserOperationalIdentityOAuthAdapter["resolveConfig"]> {
  const adapter = getUserOperationalIdentityOAuthAdapter(params.provider);
  if (!adapter) {
    return null;
  }
  return adapter.resolveConfig({ redirectUri: params.redirectUri });
}

export function buildUserOperationalIdentityPkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function listUserOperationalIdentityOAuthCapableProviders(): UserOperationalIdentityProvider[] {
  return [...adapterByProvider.keys()];
}
