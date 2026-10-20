/**
 * DingTalk API — Token management and message sending.
 *
 * Reference: https://open.dingtalk.com/document/
 */

import type { ResolvedDingtalkAccount } from "./types.js";

const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

export async function getDingtalkAccessToken(account: ResolvedDingtalkAccount): Promise<string> {
  const cacheKey = `${account.clientId}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: account.clientId,
      appSecret: account.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk token request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { accessToken: string; expireIn: number };
  const token = data.accessToken;
  const expiresAt = Date.now() + (data.expireIn ?? 7200) * 1000;
  TOKEN_CACHE.set(cacheKey, { token, expiresAt });
  return token;
}

export async function sendDingtalkMessage(params: {
  account: ResolvedDingtalkAccount;
  to: string;
  text: string;
  isGroup?: boolean;
}): Promise<{ messageId: string }> {
  const { account, to, text, isGroup } = params;
  const token = await getDingtalkAccessToken(account);

  if (isGroup) {
    // 群聊消息通过 webhook 发送
    const response = await fetch("https://api.dingtalk.com/v1.0/robot/groupMessages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({
        msgParam: JSON.stringify({ content: text }),
        msgKey: "sampleText",
        openConversationId: to,
        robotCode: account.robotCode ?? account.clientId,
      }),
    });
    if (!response.ok) {
      throw new Error(`DingTalk group message failed: ${response.status}`);
    }
    const result = (await response.json()) as { processQueryKey?: string };
    return { messageId: result.processQueryKey ?? `group-${Date.now()}` };
  }

  // 单聊消息
  const response = await fetch("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify({
      msgParam: JSON.stringify({ content: text }),
      msgKey: "sampleText",
      userIds: [to],
      robotCode: account.robotCode ?? account.clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk direct message failed: ${response.status}`);
  }

  const result = (await response.json()) as { processQueryKey?: string };
  return { messageId: result.processQueryKey ?? `dm-${Date.now()}` };
}

export function normalizeDingtalkTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^dingtalk:/i, "")
    .replace(/^user:/i, "")
    .trim();
  return trimmed || null;
}

export async function probeDingtalk(account: ResolvedDingtalkAccount): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await getDingtalkAccessToken(account);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
