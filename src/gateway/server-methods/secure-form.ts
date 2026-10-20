import {
  dropPendingSiteLoginForForm,
  rememberPasswordFillForSave,
} from "../../agents/sandbox/account-computer-login-vault.js";
import {
  readAccountComputerPreview,
  type AccountComputerPreviewPayload,
} from "../../agents/sandbox/account-computer-stream.js";
import { ensureSecureFormFillHostWired } from "../../agents/sandbox/secure-form-fill-host.js";
import { preflightAndFillSecureForm } from "../../agents/sandbox/secure-form-fill.js";
import { createAccountHandoffGateProbe } from "../../agents/sandbox/secure-form-handoff-gate-probe.js";
import {
  peekHandoffResumeReason,
  waitForHandoffReturn,
} from "../../agents/sandbox/secure-form-handoff-wait.js";
import {
  cancelSecureForm,
  cancelSecureFormsForAccount,
  completeSecureForm,
  createSecureFormRequest,
  getPendingSecureForm,
  updateSecureFormFields,
} from "../../agents/sandbox/secure-form-store.js";
import type {
  SecureFormFailureCode,
  SecureFormFieldTarget,
  SecureFormHandoffReason,
  SecureFormReason,
} from "../../agents/sandbox/secure-form-types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

ensureSecureFormFillHostWired();

const CLIENT_IDENTITY_KEYS = [
  "profile",
  "profilePath",
  "containerName",
  "cdpPort",
  "noVncPort",
  "password",
  "userDataDir",
  "accountId",
  "computerId",
] as const;

function resolveViewerAccount(
  client: GatewayClient | null,
): { tenantId: string; userId: string } | null {
  const tenantId = client?.sessionEnterpriseId?.trim() ?? "";
  const userId = client?.platformUserId?.trim() ?? "";
  if (!tenantId || !userId || userId.includes("@")) {
    return null;
  }
  const hint = client?.sessionTenantId?.trim();
  if (hint && hint !== tenantId) {
    return null;
  }
  return { tenantId, userId };
}

function rejectIdentity(params: Record<string, unknown>, respond: RespondFn) {
  for (const key of CLIENT_IDENTITY_KEYS) {
    if (params[key] != null && params[key] !== "") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "secure_form does not accept a client profile or computer id",
        ),
      );
      return true;
    }
  }
  return false;
}

function asReason(raw: unknown): SecureFormReason | null {
  return raw === "auth" || raw === "otp" || raw === "challenge" ? raw : null;
}

function asFields(raw: unknown): SecureFormFieldTarget[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const out: SecureFormFieldTarget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const row = item as Record<string, unknown>;
    const fieldId = typeof row.fieldId === "string" ? row.fieldId.trim() : "";
    const kind = row.kind;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!fieldId || !label) {
      return null;
    }
    if (
      kind !== "username" &&
      kind !== "password" &&
      kind !== "otp" &&
      kind !== "text" &&
      kind !== "email"
    ) {
      return null;
    }
    out.push({
      fieldId,
      kind,
      label,
      ...(typeof row.ref === "string" && row.ref.trim() ? { ref: row.ref.trim() } : {}),
      ...(typeof row.selector === "string" && row.selector.trim()
        ? { selector: row.selector.trim() }
        : {}),
      ...(typeof row.accessibleName === "string" && row.accessibleName.trim()
        ? { accessibleName: row.accessibleName.trim() }
        : {}),
      ...(typeof row.required === "boolean" ? { required: row.required } : {}),
    });
  }
  return out;
}

export const secureFormHandlers: GatewayRequestHandlers = {
  "secure_form.request": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const reason = asReason(params.reason);
    const domainRaw = params.domain;
    const fields = asFields(params.fields);
    if (!sessionKey || !reason || !fields || !domainRaw || typeof domainRaw !== "object") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "secure_form.request requires sessionKey, reason, domain, fields",
        ),
      );
      return;
    }
    const domainObj = domainRaw as Record<string, unknown>;
    const host = typeof domainObj.host === "string" ? domainObj.host.trim() : "";
    if (!host) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "domain.host required"));
      return;
    }
    try {
      const offered = createSecureFormRequest({
        ...account,
        sessionKey,
        agentLabel: typeof params.agentLabel === "string" ? params.agentLabel : "Agent",
        reason,
        domain: {
          host,
          ...(Array.isArray(domainObj.allowHosts)
            ? {
                allowHosts: domainObj.allowHosts.filter((h): h is string => typeof h === "string"),
              }
            : {}),
          ...(typeof domainObj.expectedUrlPrefix === "string"
            ? { expectedUrlPrefix: domainObj.expectedUrlPrefix }
            : {}),
        },
        fields,
        submitAfterFill: params.submitAfterFill === true,
        hint: typeof params.hint === "string" ? params.hint : undefined,
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      });
      // Never echo field values — offered has none.
      context.broadcast("secure_form.offered", offered, { dropIfSlow: true });
      respond(true, { formId: offered.formId, offered });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "request failed",
        ),
      );
    }
  },

  "secure_form.submit": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const formId = typeof params.formId === "string" ? params.formId.trim() : "";
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const valuesRaw = params.values;
    if (!formId || !sessionKey || !valuesRaw || typeof valuesRaw !== "object") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "secure_form.submit requires formId, sessionKey, values",
        ),
      );
      return;
    }
    const form = getPendingSecureForm(formId);
    if (!form) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "form not found or expired"),
      );
      return;
    }
    if (form.tenantId !== account.tenantId || form.userId !== account.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "form account mismatch"));
      return;
    }
    if (form.sessionKey !== sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "form session mismatch"));
      return;
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(valuesRaw as Record<string, unknown>)) {
      if (typeof v === "string") {
        values[k] = v;
      }
    }
    if (form.reason === "auth") {
      try {
        await rememberPasswordFillForSave({
          tenantId: account.tenantId,
          userId: account.userId,
          host: form.domain.host,
          formId: form.formId,
          sessionKey: form.sessionKey,
          fields: form.fields,
          values,
        });
      } catch {
        // Stash is best-effort. Fill still runs, and this path must not log values.
      }
    }
    const fillReceipt = await preflightAndFillSecureForm({ form, values });
    if (fillReceipt.status !== "filled") {
      dropPendingSiteLoginForForm(formId);
    }
    const finalized =
      fillReceipt.status === "filled"
        ? completeSecureForm(formId, {
            status: "filled",
            ...(typeof fillReceipt.submittedEnter === "boolean"
              ? { submittedEnter: fillReceipt.submittedEnter }
              : {}),
          })
        : completeSecureForm(formId, {
            status: "failed",
            code: fillReceipt.code,
            detail: fillReceipt.detail,
          });
    const receipt = finalized ?? fillReceipt;
    context.broadcast("secure_form.receipt", receipt, { dropIfSlow: true });
    respond(true, receipt);
  },

  "secure_form.cancel": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const formId = typeof params.formId === "string" ? params.formId.trim() : "";
    const code = (
      typeof params.code === "string" ? params.code : "user_declined"
    ) as SecureFormFailureCode;
    const form = getPendingSecureForm(formId);
    if (!form) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "form not found"));
      return;
    }
    if (form.tenantId !== account.tenantId || form.userId !== account.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "form account mismatch"));
      return;
    }
    const receipt = cancelSecureForm(
      formId,
      code,
      typeof params.detail === "string" ? params.detail : undefined,
    );
    if (receipt) {
      context.broadcast("secure_form.receipt", receipt, { dropIfSlow: true });
    }
    respond(true, receipt);
  },

  "secure_form.remap": async ({ params, respond, client }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const formId = typeof params.formId === "string" ? params.formId.trim() : "";
    const fields = asFields(params.fields);
    const form = getPendingSecureForm(formId);
    if (!form || !fields) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "remap requires formId and fields"),
      );
      return;
    }
    if (form.tenantId !== account.tenantId || form.userId !== account.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "form account mismatch"));
      return;
    }
    const updated = updateSecureFormFields(formId, fields);
    respond(true, { formId, fields: updated?.fields ?? fields });
  },

  "secure_form.handoff": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey required"));
      return;
    }
    const relatedFormId =
      typeof params.relatedFormId === "string" ? params.relatedFormId.trim() : "";
    const cancelledReceipts = relatedFormId
      ? [cancelSecureForm(relatedFormId, "cancelled_by_takeover", "handoff")].filter(
          (r): r is NonNullable<typeof r> => Boolean(r),
        )
      : cancelSecureFormsForAccount({
          ...account,
          code: "cancelled_by_takeover",
          detail: "handoff",
        });
    for (const receipt of cancelledReceipts) {
      context.broadcast("secure_form.receipt", receipt, { dropIfSlow: true });
    }
    const reason = (
      typeof params.reason === "string" ? params.reason : "user_takeover"
    ) as SecureFormHandoffReason;
    // Auto-resume QR/SMS gates: always the short default.
    // Ignore agent-supplied instruction so chat/tool echo cannot reintroduce snapshot narration.
    const AUTO_RESUME_HANDOFF_REASONS = new Set(["qr", "sms"]);
    const DEFAULT_HANDOFF_INSTRUCTION =
      "请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。";
    const reasonIsAutoResume = AUTO_RESUME_HANDOFF_REASONS.has(String(reason));
    const instruction = reasonIsAutoResume
      ? DEFAULT_HANDOFF_INSTRUCTION
      : typeof params.instruction === "string" && params.instruction.trim()
        ? params.instruction.trim()
        : DEFAULT_HANDOFF_INSTRUCTION;
    const payload: AccountComputerPreviewPayload = readAccountComputerPreview({
      ...account,
      issueUrl: true,
      sessionKey,
      takeControl: true,
      operatorLabel: account.userId,
    });
    // Decision F: handoff entry card — no secrets in payload.
    context.broadcast(
      "secure_form.handoff_active",
      {
        sessionKey,
        instruction,
        reason,
        ...(payload.controlledBy ? { controlledBy: payload.controlledBy } : {}),
      },
      { dropIfSlow: true },
    );
    respond(true, {
      preview: payload,
      reason,
      instruction,
      status: "handoff_active",
      controlledByKind: payload.controlledBy?.kind,
    });
  },

  "secure_form.await_return": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "secure_form requires the signed-in account"),
      );
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey required"));
      return;
    }
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
    const pollIntervalMs =
      typeof params.pollIntervalMs === "number" && params.pollIntervalMs > 0
        ? params.pollIntervalMs
        : undefined;
    const outcome = await waitForHandoffReturn({
      sessionKey,
      timeoutMs,
      ...(pollIntervalMs ? { pollIntervalMs } : {}),
      // Default: watch page for signed-in / fixture-ok so QR/SMS resume without「交给AI」.
      pollGateCleared: createAccountHandoffGateProbe(account),
      onAutoGateCleared: async () => {
        // Give input back to the agent so navigation can continue.
        readAccountComputerPreview({
          ...account,
          issueUrl: false,
          sessionKey,
          releaseControl: true,
        });
        context.broadcast(
          "secure_form.handoff_returned",
          { sessionKey, resume: "auto_gate_cleared" },
          { dropIfSlow: true },
        );
      },
    });
    if (outcome === "handoff_returned") {
      const resume = peekHandoffResumeReason(sessionKey);
      // Ensure UI clears the reminder card on auto-resume (idempotent with onAutoGateCleared).
      if (resume === "auto_gate_cleared") {
        context.broadcast(
          "secure_form.handoff_returned",
          { sessionKey, resume: "auto_gate_cleared" },
          { dropIfSlow: true },
        );
      }
      respond(true, {
        ok: true,
        status: "handoff_returned",
        sessionKey,
        ...(resume ? { resume } : {}),
      });
      return;
    }
    respond(true, {
      ok: false,
      status: "handoff_active",
      code: "user_timeout",
      detail: "await_return timed out",
      sessionKey,
    });
  },
};
