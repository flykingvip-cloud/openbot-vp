/**
 * WeChat API — local-worker probe + optional legacy proxy helpers.
 *
 * Personal WeChat sessions live on the local worker only. Gateway probe and
 * login are fail-closed when the worker is offline. Do not store proxy apiKey
 * / context_token on the cloud Gateway for personal WeChat.
 */

import type { ResolvedWechatAccount, WechatLoginStatus } from "./types.js";
import { WECHAT_WORKER_OFFLINE_ERROR } from "./worker-contract.js";
import { resolveWechatPersonalWorker } from "./worker.js";

export async function sendWechatTextMessage(params: {
  account: ResolvedWechatAccount;
  to: string;
  text: string;
}): Promise<{ messageId: string; deliveryStatus?: string }> {
  const { account, to, text } = params;
  const worker = await resolveWechatPersonalWorker();
  const probe = await worker.probe();
  if (!probe.ok || !probe.online || !worker.sendText) {
    throw new Error(probe.error ?? WECHAT_WORKER_OFFLINE_ERROR);
  }
  return worker.sendText({ accountId: account.accountId, to, text });
}

export async function getWechatLoginStatus(
  account: ResolvedWechatAccount,
): Promise<WechatLoginStatus> {
  const worker = await resolveWechatPersonalWorker();
  try {
    const status = await worker.status({ accountId: account.accountId });
    if (!status.online) {
      return { status: "logged_out" };
    }
    if (status.loggedIn) {
      return {
        status: "logged_in",
        wxid: status.wxid,
        nickname: status.nickname,
      };
    }
    return { status: "logged_out" };
  } catch {
    return { status: "logged_out" };
  }
}

export function normalizeWechatTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^wechat:/i, "")
    .replace(/^user:/i, "")
    .trim();
  return trimmed || null;
}

export async function probeWechat(account: ResolvedWechatAccount): Promise<{
  ok: boolean;
  error?: string;
  loginStatus?: WechatLoginStatus;
}> {
  const worker = await resolveWechatPersonalWorker();
  const probe = await worker.probe();
  if (!probe.ok || !probe.online) {
    return {
      ok: false,
      error: probe.error ?? WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
  try {
    const status = await getWechatLoginStatus(account);
    return {
      ok: status.status === "logged_in",
      loginStatus: status,
      error: status.status !== "logged_in" ? `登录状态: ${status.status}` : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
}
