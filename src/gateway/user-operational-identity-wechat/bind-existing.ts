import type {
  UserOperationalIdentity,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
} from "../user-operational-identity-types.js";
import { bindWechatPersonalIdentityFromWxid } from "./bind.js";
import { probeWechatPersonalWorker } from "./login-qr.js";
import type { WechatWorkerResolveOpts } from "./resolve-worker.js";
import { WECHAT_WORKER_OFFLINE_ERROR } from "./worker-contract.js";

export const USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE =
  "USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE";
export const USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN =
  "USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN";
export const USER_IDENTITY_WXID_REQUIRED = "USER_IDENTITY_WXID_REQUIRED";

const NOT_LOGGED_IN_ERROR =
  "WeChat personal sidecar is online but the native WeChat session is not logged in.";

export type WechatPersonalExistingSessionSnapshot = {
  wxid: string;
  nickname?: string;
};

export type BindWechatPersonalExistingResult =
  | {
      ok: true;
      wxid: string;
      nickname?: string;
      identity: UserOperationalIdentity;
      grant?: UserOperationalIdentityGrant;
    }
  | { ok: false; code: string; error: string };

type BindExistingResolveOpts = Pick<WechatWorkerResolveOpts, "nodeRegistry" | "allowLocalSidecar">;

export type ProbeWechatPersonalExistingSession = (opts?: BindExistingResolveOpts) => Promise<{
  ok: boolean;
  online: boolean;
  error?: string;
  loggedIn?: boolean;
  wxid?: string;
  nickname?: string;
}>;

export type UserOiWriteLock = <T>(
  fn: (store: UserOperationalIdentityStore) => Promise<T> | T,
) => Promise<T>;

/**
 * Network-only: resolve/probe/status the worker and freeze wxid/nickname.
 * Must run outside the user-identity write lock.
 */
export async function resolveWechatPersonalExistingSessionSnapshot(params?: {
  nodeRegistry?: BindExistingResolveOpts["nodeRegistry"];
  allowLocalSidecar?: boolean;
  probeWorker?: ProbeWechatPersonalExistingSession;
}): Promise<
  | { ok: true; snapshot: WechatPersonalExistingSessionSnapshot }
  | { ok: false; code: string; error: string }
> {
  const probe = await (params?.probeWorker ?? probeWechatPersonalWorker)({
    nodeRegistry: params?.nodeRegistry,
    allowLocalSidecar: params?.allowLocalSidecar,
  });
  if (!probe.ok || !probe.online) {
    return {
      ok: false,
      code: USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE,
      error: probe.error ?? WECHAT_WORKER_OFFLINE_ERROR,
    };
  }
  if (!probe.loggedIn) {
    return {
      ok: false,
      code: USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN,
      error: NOT_LOGGED_IN_ERROR,
    };
  }
  const wxid = probe.wxid?.trim() ?? "";
  if (!wxid) {
    return {
      ok: false,
      code: USER_IDENTITY_WXID_REQUIRED,
      error: "wxid is required.",
    };
  }
  return {
    ok: true,
    snapshot: {
      wxid,
      nickname: probe.nickname,
    },
  };
}

/**
 * Two-phase native bind: probe the worker first, then persist under writeLock.
 * Callers must pass a lock that only wraps store writes — never hold that lock
 * around this whole function.
 */
export async function bindExistingWechatPersonalNativeSession(params: {
  writeLock: UserOiWriteLock;
  ownerId: string;
  displayName?: string;
  agentId?: string;
  accountId?: string;
  tenantId?: string | null;
  nowIso: string;
  skipRouteBinding?: boolean;
  nodeRegistry?: BindExistingResolveOpts["nodeRegistry"];
  allowLocalSidecar?: boolean;
  probeWorker?: ProbeWechatPersonalExistingSession;
}): Promise<BindWechatPersonalExistingResult> {
  const resolved = await resolveWechatPersonalExistingSessionSnapshot({
    nodeRegistry: params.nodeRegistry,
    allowLocalSidecar: params.allowLocalSidecar,
    probeWorker: params.probeWorker,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const { snapshot } = resolved;
  return params.writeLock(async (store) => {
    const bound = await bindWechatPersonalIdentityFromWxid({
      store,
      ownerId: params.ownerId,
      displayName: params.displayName?.trim() || snapshot.nickname || snapshot.wxid,
      wxid: snapshot.wxid,
      agentId: params.agentId,
      accountId: params.accountId,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      skipRouteBinding: params.skipRouteBinding,
    });
    if (!bound.ok) {
      return bound;
    }
    return {
      ok: true,
      wxid: snapshot.wxid,
      nickname: snapshot.nickname,
      identity: bound.identity,
      grant: bound.grant,
    };
  });
}
