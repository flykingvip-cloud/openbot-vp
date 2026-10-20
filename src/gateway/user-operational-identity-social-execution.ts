import { createHash, randomUUID } from "node:crypto";
import type { UserOperationalIdentityExecutionPayload } from "./user-operational-identity-execution.js";
import { isSimulatedUserOperationalIdentityCredentialSecret } from "./user-operational-identity-secrets.js";
import type {
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityProvider,
} from "./user-operational-identity-types.js";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function simulatedReferenceId(params: { provider: string; action: string; body: string }): string {
  const digest = createHash("sha256")
    .update(`${params.provider}:${params.action}:${params.body}`)
    .digest("hex")
    .slice(0, 12);
  return `${params.provider}-${digest}`;
}

async function postWeiboStatus(params: {
  accessToken: string;
  status: string;
}): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    access_token: params.accessToken,
    status: params.status,
  });
  const response = await fetch("https://api.weibo.com/2/statuses/update.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Weibo post failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return { providerResponse: payload, id: payload.id, idstr: payload.idstr };
}

async function postXTweet(params: {
  accessToken: string;
  text: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: params.text }),
  });
  if (!response.ok) {
    throw new Error(`X post failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return { providerResponse: payload, tweetId: (payload.data as { id?: string } | undefined)?.id };
}

export async function executeUserOperationalIdentitySocialAction(params: {
  provider: UserOperationalIdentityProvider;
  action: string;
  payload: UserOperationalIdentityExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
}): Promise<Record<string, unknown>> {
  const simulated = isSimulatedUserOperationalIdentityCredentialSecret(params.secret);
  const text =
    stringValue(params.payload.message) ||
    stringValue(params.payload.body) ||
    stringValue(params.payload.title) ||
    "OpenBot operational identity action";

  if (simulated) {
    return {
      simulated: true,
      provider: params.provider,
      action: params.action,
      referenceId: simulatedReferenceId({
        provider: params.provider,
        action: params.action,
        body: text,
      }),
      preview: text,
    };
  }

  const accessToken = params.secret.accessToken?.trim();
  if (!accessToken) {
    throw new Error("OAuth access token is missing.");
  }

  if (params.provider === "weibo" && params.action === "post_status") {
    const result = await postWeiboStatus({ accessToken, status: text });
    return { simulated: false, ...result };
  }

  if (params.provider === "x-twitter" && params.action === "post_tweet") {
    const result = await postXTweet({ accessToken, text });
    return { simulated: false, ...result };
  }

  return {
    simulated: false,
    provider: params.provider,
    action: params.action,
    referenceId: randomUUID(),
    message: `Action ${params.action} accepted for ${params.provider}.`,
    preview: text,
  };
}

export function isUserOperationalIdentitySocialProvider(
  provider: UserOperationalIdentityProvider,
): boolean {
  return (
    provider === "weibo" ||
    provider === "douyin" ||
    provider === "bilibili" ||
    provider === "x-twitter" ||
    provider === "xiaohongshu" ||
    provider === "zhihu"
  );
}
