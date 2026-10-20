/**
 * Secure Form gateway events — isolated subscription module.
 *
 * Offered cards are session-scoped: only the chat that requested the form
 * shows / can submit it. Receipts clear the card and may set a brief status.
 * Handoff (P5b): handoff_active shows the in-chat F entry card (not fullscreen overlay); handoff_returned clears it.
 */

import { t } from "../../i18n/index.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import {
  handBackComputerPreview,
  takeoverComputerPreview,
  type ComputerPreviewChrome,
} from "../views/account-computer-preview.ts";

export type SecureFormFieldKindUi = "username" | "password" | "otp" | "text" | "email";

export type SecureFormFieldTargetUi = {
  fieldId: string;
  kind: SecureFormFieldKindUi;
  label: string;
  ref?: string;
  selector?: string;
  accessibleName?: string;
  required?: boolean;
};

export type SecureFormOfferedUi = {
  formId: string;
  sessionKey: string;
  agentLabel: string;
  reason: string;
  domain: { host: string; allowHosts?: string[]; expectedUrlPrefix?: string };
  fields: SecureFormFieldTargetUi[];
  submitAfterFill?: boolean;
  hint?: string;
  timeoutMs?: number;
  createdAt: number;
};

export type SecureFormReceiptUi = {
  formId: string;
  status: "filled" | "failed";
  code?: string;
  detail?: string;
  completedAt: number;
  submittedEnter?: boolean;
};

/** Decision F: short instruction card while user holds the desktop. */
export type SecureFormHandoffActiveUi = {
  sessionKey: string;
  instruction: string;
  reason?: string;
  controlledBy?: { kind: "agent" | "user"; label: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseSecureFormOffered(payload: unknown): SecureFormOfferedUi | null {
  if (!isRecord(payload)) {
    return null;
  }
  const formId = typeof payload.formId === "string" ? payload.formId.trim() : "";
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  const domainRaw = payload.domain;
  const fieldsRaw = payload.fields;
  if (!formId || !sessionKey || !isRecord(domainRaw) || !Array.isArray(fieldsRaw)) {
    return null;
  }
  const host = typeof domainRaw.host === "string" ? domainRaw.host.trim() : "";
  if (!host || fieldsRaw.length === 0) {
    return null;
  }
  const fields: SecureFormFieldTargetUi[] = [];
  for (const item of fieldsRaw) {
    if (!isRecord(item)) {
      return null;
    }
    const fieldId = typeof item.fieldId === "string" ? item.fieldId.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const kind = item.kind;
    if (
      !fieldId ||
      !label ||
      (kind !== "username" &&
        kind !== "password" &&
        kind !== "otp" &&
        kind !== "text" &&
        kind !== "email")
    ) {
      return null;
    }
    fields.push({
      fieldId,
      kind,
      label,
      ...(typeof item.ref === "string" && item.ref.trim() ? { ref: item.ref.trim() } : {}),
      ...(typeof item.selector === "string" && item.selector.trim()
        ? { selector: item.selector.trim() }
        : {}),
      ...(typeof item.accessibleName === "string" && item.accessibleName.trim()
        ? { accessibleName: item.accessibleName.trim() }
        : {}),
      ...(typeof item.required === "boolean" ? { required: item.required } : {}),
    });
  }
  return {
    formId,
    sessionKey,
    agentLabel: typeof payload.agentLabel === "string" ? payload.agentLabel : "Agent",
    reason: typeof payload.reason === "string" ? payload.reason : "auth",
    domain: {
      host,
      ...(Array.isArray(domainRaw.allowHosts)
        ? {
            allowHosts: domainRaw.allowHosts.filter((h): h is string => typeof h === "string"),
          }
        : {}),
      ...(typeof domainRaw.expectedUrlPrefix === "string"
        ? { expectedUrlPrefix: domainRaw.expectedUrlPrefix }
        : {}),
    },
    fields,
    ...(payload.submitAfterFill === true ? { submitAfterFill: true } : {}),
    ...(typeof payload.hint === "string" && payload.hint.trim()
      ? { hint: payload.hint.trim() }
      : {}),
    ...(typeof payload.timeoutMs === "number" ? { timeoutMs: payload.timeoutMs } : {}),
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : Date.now(),
  };
}

export function parseSecureFormReceipt(payload: unknown): SecureFormReceiptUi | null {
  if (!isRecord(payload)) {
    return null;
  }
  const formId = typeof payload.formId === "string" ? payload.formId.trim() : "";
  const status = payload.status;
  if (!formId || (status !== "filled" && status !== "failed")) {
    return null;
  }
  return {
    formId,
    status,
    ...(typeof payload.code === "string" ? { code: payload.code } : {}),
    ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
    completedAt: typeof payload.completedAt === "number" ? payload.completedAt : Date.now(),
    ...(typeof payload.submittedEnter === "boolean"
      ? { submittedEnter: payload.submittedEnter }
      : {}),
  };
}

export function parseSecureFormHandoffActive(payload: unknown): SecureFormHandoffActiveUi | null {
  if (!isRecord(payload)) {
    return null;
  }
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  const instruction =
    typeof payload.instruction === "string" && payload.instruction.trim()
      ? payload.instruction.trim()
      : "";
  if (!sessionKey || !instruction) {
    return null;
  }
  const controlledRaw = payload.controlledBy;
  let controlledBy: SecureFormHandoffActiveUi["controlledBy"];
  if (isRecord(controlledRaw)) {
    const kind = controlledRaw.kind;
    const label = typeof controlledRaw.label === "string" ? controlledRaw.label.trim() : "";
    if ((kind === "agent" || kind === "user") && label) {
      controlledBy = { kind, label };
    }
  }
  return {
    sessionKey,
    instruction,
    ...(typeof payload.reason === "string" && payload.reason.trim()
      ? { reason: payload.reason.trim() }
      : {}),
    ...(controlledBy ? { controlledBy } : {}),
  };
}

export type SecureFormGatewayHost = GatewayHost & {
  sessionKey: string;
  secureFormOffered: SecureFormOfferedUi | null;
  secureFormValues: Record<string, string>;
  secureFormBusy: boolean;
  secureFormError: string | null;
  secureFormReceipt: SecureFormReceiptUi | null;
  secureFormHandoff: SecureFormHandoffActiveUi | null;
};

export function handleSecureFormGatewayEvent(host: GatewayHost, evt: GatewayEventFrame): boolean {
  const h = host as SecureFormGatewayHost;
  if (evt.event === "secure_form.offered") {
    const offered = parseSecureFormOffered(evt.payload);
    if (!offered) {
      return true;
    }
    // Session-scoped: ignore forms for other chats.
    if (offered.sessionKey !== h.sessionKey) {
      return true;
    }
    h.secureFormOffered = offered;
    h.secureFormValues = {};
    h.secureFormError = null;
    h.secureFormReceipt = null;
    h.secureFormBusy = false;
    return true;
  }

  if (evt.event === "secure_form.receipt") {
    const receipt = parseSecureFormReceipt(evt.payload);
    if (!receipt) {
      return true;
    }
    const pending = h.secureFormOffered;
    if (pending && pending.formId === receipt.formId) {
      // Clear local values so secrets never linger in UI state.
      for (const key of Object.keys(h.secureFormValues ?? {})) {
        h.secureFormValues[key] = "";
        delete h.secureFormValues[key];
      }
      h.secureFormValues = {};
      h.secureFormOffered = null;
      h.secureFormBusy = false;
      h.secureFormError = null;
      h.secureFormReceipt = receipt;
      // Auto-clear the brief status banner.
      globalThis.setTimeout(() => {
        if (h.secureFormReceipt?.formId === receipt.formId) {
          h.secureFormReceipt = null;
        }
      }, 4000);
    }
    return true;
  }

  if (evt.event === "secure_form.handoff_active") {
    const handoff = parseSecureFormHandoffActive(evt.payload);
    if (!handoff) {
      return true;
    }
    if (handoff.sessionKey !== h.sessionKey) {
      return true;
    }
    // Form is cancelled on the server; clear any leftover card/values locally.
    for (const key of Object.keys(h.secureFormValues ?? {})) {
      h.secureFormValues[key] = "";
      delete h.secureFormValues[key];
    }
    h.secureFormValues = {};
    h.secureFormOffered = null;
    h.secureFormBusy = false;
    h.secureFormError = null;
    h.secureFormHandoff = handoff;
    // Align local chrome with server takeControl so preview refresh does not
    // ambient-releaseControl mid-gate (that forced manual_handback on Zhihu).
    if ("computerPreviewRevision" in h && "sessionKey" in h) {
      const chrome = h as unknown as ComputerPreviewChrome;
      takeoverComputerPreview(chrome, t("chat.computerYou"), {
        sessionKey: handoff.sessionKey,
      });
      const refresh = (
        h as { refreshAccountComputerPreview?: (a: "open" | "status" | "end") => void }
      ).refreshAccountComputerPreview;
      void refresh?.("open");
    }
    // Never jump Control UI to a separate fullscreen surface for handoff —
    // the in-chat card is the entry point (docked computer chrome is enough).
    if (
      "computerPreviewSize" in h &&
      (h as { computerPreviewSize?: string }).computerPreviewSize === "fullscreen"
    ) {
      (h as { computerPreviewSize: string }).computerPreviewSize = "docked";
      if ("computerPreviewRevision" in h) {
        const rev = (h as { computerPreviewRevision: number }).computerPreviewRevision;
        (h as { computerPreviewRevision: number }).computerPreviewRevision = rev + 1;
      }
    }
    return true;
  }

  if (evt.event === "secure_form.handoff_returned") {
    const payload = evt.payload;
    if (!isRecord(payload)) {
      return true;
    }
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
    if (!sessionKey || sessionKey !== h.sessionKey) {
      return true;
    }
    h.secureFormHandoff = null;
    // Auto resume already released on server — clear local hold without explicitHandback.
    const resume = typeof payload.resume === "string" ? payload.resume : "";
    if (resume === "auto_gate_cleared" && "computerPreviewRevision" in h) {
      handBackComputerPreview(h as unknown as ComputerPreviewChrome, { silent: true });
    }
    return true;
  }

  return false;
}
