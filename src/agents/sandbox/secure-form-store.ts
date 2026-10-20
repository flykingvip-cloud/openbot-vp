import { randomBytes } from "node:crypto";
import { accountComputerKey } from "./account-computer-stream.js";
import {
  type SecureFormDomainBinding,
  type SecureFormFailureCode,
  type SecureFormFieldTarget,
  type SecureFormOffered,
  type SecureFormReason,
  type SecureFormReceipt,
} from "./secure-form-types.js";

export type PendingSecureForm = SecureFormOffered & {
  expiresAt: number;
};

const PENDING = new Map<string, PendingSecureForm>();
/** Account keys with an active formLock (tenant\0user). */
const FORM_LOCKS = new Set<string>();

const DEFAULT_TIMEOUT_MS = 300_000;

export function resetSecureFormStoreForTests() {
  PENDING.clear();
  FORM_LOCKS.clear();
}

export function isAccountFormLocked(tenantId: string, userId: string): boolean {
  return FORM_LOCKS.has(accountComputerKey(tenantId, userId));
}

function setLock(tenantId: string, userId: string, on: boolean) {
  const key = accountComputerKey(tenantId, userId);
  if (on) {
    FORM_LOCKS.add(key);
  } else {
    FORM_LOCKS.delete(key);
  }
}

function prune(now = Date.now()) {
  for (const [id, form] of PENDING) {
    if (form.expiresAt <= now) {
      PENDING.delete(id);
      // Drop lock if no other pending for same account
      refreshLock(form.tenantId, form.userId);
    }
  }
}

function refreshLock(tenantId: string, userId: string) {
  const key = accountComputerKey(tenantId, userId);
  for (const form of PENDING.values()) {
    if (form.tenantId === tenantId && form.userId === userId) {
      FORM_LOCKS.add(key);
      return;
    }
  }
  FORM_LOCKS.delete(key);
}

export function createSecureFormRequest(params: {
  tenantId: string;
  userId: string;
  sessionKey: string;
  agentLabel: string;
  reason: SecureFormReason;
  domain: SecureFormDomainBinding;
  fields: SecureFormFieldTarget[];
  submitAfterFill?: boolean;
  hint?: string;
  timeoutMs?: number;
  nowMs?: number;
}): SecureFormOffered {
  prune(params.nowMs);
  const now = params.nowMs ?? Date.now();
  const host = params.domain.host.trim().toLowerCase();
  if (!host) {
    throw new Error("secure_form requires domain.host");
  }
  if (!params.fields.length) {
    throw new Error("secure_form requires at least one field");
  }
  if (params.submitAfterFill) {
    if (params.fields.length !== 1 || params.fields[0]?.kind !== "otp") {
      throw new Error("submitAfterFill requires exactly one otp field");
    }
  }
  const formId = randomBytes(16).toString("hex");
  const timeoutMs = Math.max(1_000, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const offered: PendingSecureForm = {
    formId,
    sessionKey: params.sessionKey.trim(),
    agentLabel: params.agentLabel.trim() || "Agent",
    reason: params.reason,
    domain: {
      host,
      ...(params.domain.allowHosts
        ? {
            allowHosts: params.domain.allowHosts.map((h) => h.trim().toLowerCase()).filter(Boolean),
          }
        : {}),
      ...(params.domain.expectedUrlPrefix
        ? { expectedUrlPrefix: params.domain.expectedUrlPrefix }
        : {}),
    },
    fields: params.fields.map((f) => ({ ...f, fieldId: f.fieldId.trim() })),
    ...(params.submitAfterFill ? { submitAfterFill: true } : {}),
    ...(params.hint?.trim() ? { hint: params.hint.trim() } : {}),
    timeoutMs,
    createdAt: now,
    expiresAt: now + timeoutMs,
    tenantId: params.tenantId.trim(),
    userId: params.userId.trim(),
  };
  PENDING.set(formId, offered);
  setLock(offered.tenantId, offered.userId, true);
  return { ...offered };
}

export function getPendingSecureForm(formId: string, nowMs?: number): PendingSecureForm | null {
  prune(nowMs);
  return PENDING.get(formId.trim()) ?? null;
}

export function updateSecureFormFields(
  formId: string,
  fields: SecureFormFieldTarget[],
): PendingSecureForm | null {
  const form = PENDING.get(formId.trim());
  if (!form) {
    return null;
  }
  form.fields = fields.map((f) => ({ ...f }));
  return { ...form };
}

export function completeSecureForm(
  formId: string,
  receipt: Omit<SecureFormReceipt, "formId" | "completedAt"> & { completedAt?: number },
): SecureFormReceipt | null {
  const form = PENDING.get(formId.trim());
  if (!form) {
    return null;
  }
  PENDING.delete(form.formId);
  refreshLock(form.tenantId, form.userId);
  return {
    formId: form.formId,
    status: receipt.status,
    ...(receipt.code ? { code: receipt.code } : {}),
    ...(receipt.detail ? { detail: receipt.detail } : {}),
    ...(receipt.remappedFields ? { remappedFields: receipt.remappedFields } : {}),
    ...(typeof receipt.submittedEnter === "boolean"
      ? { submittedEnter: receipt.submittedEnter }
      : {}),
    completedAt: receipt.completedAt ?? Date.now(),
  };
}

export function cancelSecureForm(
  formId: string,
  code: SecureFormFailureCode = "user_declined",
  detail?: string,
): SecureFormReceipt | null {
  return completeSecureForm(formId, {
    status: "failed",
    code,
    ...(detail ? { detail } : {}),
  });
}

/** Cancel every pending form for an account (takeover / end computer). */
export function cancelSecureFormsForAccount(params: {
  tenantId: string;
  userId: string;
  code: SecureFormFailureCode;
  detail?: string;
}): SecureFormReceipt[] {
  const out: SecureFormReceipt[] = [];
  for (const form of PENDING.values()) {
    if (form.tenantId !== params.tenantId.trim() || form.userId !== params.userId.trim()) {
      continue;
    }
    const receipt = cancelSecureForm(form.formId, params.code, params.detail);
    if (receipt) {
      out.push(receipt);
    }
  }
  return out;
}

export function listPendingSecureFormIdsForTests(): string[] {
  return [...PENDING.keys()];
}
