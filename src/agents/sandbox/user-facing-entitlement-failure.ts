/**
 * Map entitlement / lease / model-permission failures to short user-facing copy.
 * Keep reason codes in logs; never dump them into the chat transcript.
 *
 * Soft-recoverable stops (lease-mismatch / stale-snapshot) must NOT ask the user
 * to 「重新发送」— the runner self-advances instead. Hard blockers only:
 * notAllowed, leaseExpired/revoked, quota, secrets, real decisions.
 */

import type { WorkerHeartbeatReason } from "../../gateway/governance/account-worker-runtime.js";

const ACCOUNT_WORKER_BILLING_STOP = /account worker stopped billing actions:\s*([a-z0-9-]+)/i;
const RUNTIME_LEASE_EXPIRED = /runtime lease is expired/i;
const REQUESTED_MODEL_NOT_SUPPORTED = /Requested model .+ not supported/i;
const WORKSPACE_AUTH_FAILED = /workspace_authorization_failed|Workspace authorization failed/i;

/** Soft stops: runtime refreshes lease/snapshot and retries; never fuel chat with 「继续」. */
export const SOFT_RECOVERABLE_HEARTBEAT_REASONS = [
  "lease-mismatch",
  "stale-snapshot",
] as const satisfies readonly WorkerHeartbeatReason[];

const SOFT_RECOVERABLE_SET = new Set<string>(SOFT_RECOVERABLE_HEARTBEAT_REASONS);

/** Stable Chinese (product default) — match nearby 「云电脑没有启动」 style. */
export const ENTITLEMENT_USER_MESSAGES = {
  leaseExpired: "企业租约已到期，请联系管理员续租。",
  leaseRevoked: "当前账号执行权限已停用，请联系管理员。",
  /** @deprecated Soft-recoverable — not shown in chat; kept for grep/tests. */
  leaseMismatch: "",
  /** @deprecated Soft-recoverable — not shown in chat; kept for grep/tests. */
  staleSnapshot: "",
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
  // lease-mismatch / stale-snapshot intentionally omitted — soft recover, no chat copy
  "not-allowed": ENTITLEMENT_USER_MESSAGES.notAllowed,
  "decision-invalid": ENTITLEMENT_USER_MESSAGES.decisionInvalid,
  quota: ENTITLEMENT_USER_MESSAGES.quota,
  concurrency: ENTITLEMENT_USER_MESSAGES.concurrency,
  "heartbeat-stale": ENTITLEMENT_USER_MESSAGES.heartbeatStale,
  "missing-snapshot": ENTITLEMENT_USER_MESSAGES.missingSnapshot,
};

export function isSoftRecoverableEntitlementReason(reason: string): boolean {
  return SOFT_RECOVERABLE_SET.has(reason.trim().toLowerCase());
}

/**
 * True when the failure is a soft lease/snapshot refresh the runner should
 * self-advance on — never surface 「执行授权已更新，请重新发送消息后再试。」
 */
export function isSoftRecoverableEntitlementFailure(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  const billing = text.match(ACCOUNT_WORKER_BILLING_STOP);
  if (billing?.[1] && isSoftRecoverableEntitlementReason(billing[1])) {
    return true;
  }
  if (/\bstale-snapshot\b/i.test(text) || /\bstale snapshot\b/i.test(text)) {
    return true;
  }
  if (/\blease-mismatch\b/i.test(text)) {
    return true;
  }
  return false;
}

export function messageForWorkerHeartbeatReason(reason: string): string | null {
  const key = reason.trim().toLowerCase() as WorkerHeartbeatReason;
  if (isSoftRecoverableEntitlementReason(key)) {
    return null;
  }
  return HEARTBEAT_REASON_MESSAGES[key] ?? null;
}

/**
 * Returns a chat-safe sentence, or null when the error is not an entitlement class
 * (or is soft-recoverable and must not interrupt the user).
 */
export function userFacingEntitlementPreReplyFailure(message: string): string | null {
  const text = message.trim();
  if (!text) {
    return null;
  }

  if (isSoftRecoverableEntitlementFailure(text)) {
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
