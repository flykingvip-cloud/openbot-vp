/**
 * Map entitlement / lease / model-permission failures to short user-facing copy.
 * Keep reason codes in logs; never dump them into the chat transcript.
 */

import type { WorkerHeartbeatReason } from "../../gateway/governance/account-worker-runtime.js";

const ACCOUNT_WORKER_BILLING_STOP = /account worker stopped billing actions:\s*([a-z0-9-]+)/i;
const RUNTIME_LEASE_EXPIRED = /runtime lease is expired/i;
const REQUESTED_MODEL_NOT_SUPPORTED = /Requested model .+ not supported/i;
const WORKSPACE_AUTH_FAILED = /workspace_authorization_failed|Workspace authorization failed/i;

/** Stable Chinese (product default) — match nearby 「云电脑没有启动」 style. */
export const ENTITLEMENT_USER_MESSAGES = {
  leaseExpired: "企业租约已到期，请联系管理员续租。",
  leaseRevoked: "当前账号执行权限已停用，请联系管理员。",
  leaseMismatch: "执行授权已更新，请重新发送消息后再试。",
  staleSnapshot: "执行授权已更新，请重新发送消息后再试。",
  notAllowed: "当前账号没有执行该操作的权限，请联系管理员。",
  decisionInvalid: "执行授权无效，请重新发送消息；若仍失败请联系管理员。",
  quota: "可用额度不足，请联系管理员充值或调整配额后重试。",
  concurrency: "同时进行的任务已达上限，请稍后再试。",
  heartbeatStale: "连接已超时，请重新发送消息后再试。",
  missingSnapshot: "执行环境未就绪，请重新发送消息；若仍失败请联系管理员。",
  modelNotSupported: "当前账号无权使用该模型，请更换模型或联系管理员开通。",
  workspaceAuthorization: "工作区未授权，请联系管理员开通后再试。",
  genericEntitlement: "当前无法继续使用，请联系管理员检查租约、额度或模型权限。",
} as const;

const HEARTBEAT_REASON_MESSAGES: Partial<Record<WorkerHeartbeatReason, string>> = {
  "lease-expired": ENTITLEMENT_USER_MESSAGES.leaseExpired,
  revoked: ENTITLEMENT_USER_MESSAGES.leaseRevoked,
  "lease-mismatch": ENTITLEMENT_USER_MESSAGES.leaseMismatch,
  "stale-snapshot": ENTITLEMENT_USER_MESSAGES.staleSnapshot,
  "not-allowed": ENTITLEMENT_USER_MESSAGES.notAllowed,
  "decision-invalid": ENTITLEMENT_USER_MESSAGES.decisionInvalid,
  quota: ENTITLEMENT_USER_MESSAGES.quota,
  concurrency: ENTITLEMENT_USER_MESSAGES.concurrency,
  "heartbeat-stale": ENTITLEMENT_USER_MESSAGES.heartbeatStale,
  "missing-snapshot": ENTITLEMENT_USER_MESSAGES.missingSnapshot,
};

export function messageForWorkerHeartbeatReason(reason: string): string | null {
  const key = reason.trim().toLowerCase() as WorkerHeartbeatReason;
  return HEARTBEAT_REASON_MESSAGES[key] ?? null;
}

/**
 * Returns a chat-safe sentence, or null when the error is not an entitlement class.
 */
export function userFacingEntitlementPreReplyFailure(message: string): string | null {
  const text = message.trim();
  if (!text) {
    return null;
  }

  const billing = text.match(ACCOUNT_WORKER_BILLING_STOP);
  if (billing?.[1]) {
    return (
      messageForWorkerHeartbeatReason(billing[1]) ?? ENTITLEMENT_USER_MESSAGES.genericEntitlement
    );
  }

  if (RUNTIME_LEASE_EXPIRED.test(text) || /\blease-expired\b/i.test(text)) {
    return ENTITLEMENT_USER_MESSAGES.leaseExpired;
  }
  if (/\brevoked\b/i.test(text) && /lease|account worker|runtime/i.test(text)) {
    return ENTITLEMENT_USER_MESSAGES.leaseRevoked;
  }
  if (REQUESTED_MODEL_NOT_SUPPORTED.test(text)) {
    return ENTITLEMENT_USER_MESSAGES.modelNotSupported;
  }
  if (WORKSPACE_AUTH_FAILED.test(text)) {
    return ENTITLEMENT_USER_MESSAGES.workspaceAuthorization;
  }
  if (/AccountWorkerFailedError/i.test(text) && /billing|lease|quota|not-allowed/i.test(text)) {
    return ENTITLEMENT_USER_MESSAGES.genericEntitlement;
  }
  return null;
}
