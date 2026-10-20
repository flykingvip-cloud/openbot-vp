import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { resolveWechatPersonalWorker, type WechatWorkerResolveOpts } from "./resolve-worker.js";
import { WECHAT_WORKER_OFFLINE_ERROR } from "./worker-contract.js";

type LoginResolveOpts = Pick<WechatWorkerResolveOpts, "nodeRegistry" | "allowLocalSidecar">;

export async function startWechatLoginWithQr(params: {
  accountId?: string;
  force?: boolean;
  timeoutMs?: number;
  nodeRegistry?: WechatWorkerResolveOpts["nodeRegistry"];
  allowLocalSidecar?: boolean;
}): Promise<{ qrDataUrl?: string; message: string }> {
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const worker = await resolveWechatPersonalWorker(pickResolve(params));
  const probe = await worker.probe();
  if (!probe.ok || !probe.online) {
    return {
      message: probe.error ?? WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
  try {
    const started = await worker.loginStart({
      accountId,
      force: params.force,
      timeoutMs: params.timeoutMs,
    });
    return {
      qrDataUrl: started.qrDataUrl,
      message: "Scan the QR with WeChat on your phone to bind this personal account.",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
}

export async function waitForWechatLogin(params: {
  accountId?: string;
  timeoutMs?: number;
  nodeRegistry?: WechatWorkerResolveOpts["nodeRegistry"];
  allowLocalSidecar?: boolean;
}): Promise<{ connected: boolean; message: string; wxid?: string; nickname?: string }> {
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const worker = await resolveWechatPersonalWorker(pickResolve(params));
  const probe = await worker.probe();
  if (!probe.ok || !probe.online) {
    return {
      connected: false,
      message: probe.error ?? WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
  const result = await worker.loginWait({
    accountId,
    timeoutMs: params.timeoutMs,
  });
  return {
    connected: result.connected,
    message: result.message,
    wxid: result.wxid,
    nickname: result.nickname,
  };
}

export async function logoutWechatAccount(params: {
  accountId?: string;
  nodeRegistry?: WechatWorkerResolveOpts["nodeRegistry"];
  allowLocalSidecar?: boolean;
}): Promise<{ cleared: boolean; loggedOut: boolean }> {
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const worker = await resolveWechatPersonalWorker(pickResolve(params));
  const result = await worker.logout({ accountId });
  return { cleared: result.cleared, loggedOut: result.cleared };
}

export async function probeWechatPersonalWorker(opts?: LoginResolveOpts): Promise<{
  ok: boolean;
  online: boolean;
  error?: string;
  loggedIn?: boolean;
  wxid?: string;
  nickname?: string;
}> {
  const worker = await resolveWechatPersonalWorker(pickResolve(opts ?? {}));
  const probe = await worker.probe();
  if (!probe.ok || !probe.online) {
    return { ok: false, online: false, error: probe.error ?? WECHAT_WORKER_OFFLINE_ERROR };
  }
  const status = await worker.status({ accountId: DEFAULT_ACCOUNT_ID });
  return {
    ok: true,
    online: true,
    loggedIn: status.loggedIn,
    wxid: status.wxid,
    nickname: status.nickname,
  };
}

function pickResolve(params: LoginResolveOpts): WechatWorkerResolveOpts {
  return {
    nodeRegistry: params.nodeRegistry,
    allowLocalSidecar: params.allowLocalSidecar,
  };
}
