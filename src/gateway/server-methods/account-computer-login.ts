/**
 * Account Computer login plan, one-time method choice, and opt-in save.
 * Responses and broadcasts never include credential values.
 */
import { randomBytes } from "node:crypto";
import {
  classifyAccountComputerLogin,
  normalizeLoginHost,
  type LoginPageSignals,
} from "../../agents/sandbox/account-computer-login-classify.js";
import {
  readLoginPolicy,
  rememberObservedLoginMethod,
  writeLoginPolicy,
} from "../../agents/sandbox/account-computer-login-policy-store.js";
import {
  dropPendingSiteLoginForForm,
  loadSiteLoginSecret,
  promotePendingSiteLogin,
  readPendingSiteLogin,
  type SiteLoginSecret,
} from "../../agents/sandbox/account-computer-login-vault.js";
import {
  getLoginChoiceOffer,
  getLoginSaveOffer,
  notifyLoginChoice,
  notifySaveDecision,
  registerLoginChoiceOffer,
  registerLoginSaveOffer,
  waitForLoginChoice,
  waitForSaveDecision,
} from "../../agents/sandbox/account-computer-login-wait.js";
import { preflightAndFillSecureForm } from "../../agents/sandbox/secure-form-fill.js";
import {
  completeSecureForm,
  createSecureFormRequest,
  getPendingSecureForm,
} from "../../agents/sandbox/secure-form-store.js";
import type { SecureFormFieldTarget } from "../../agents/sandbox/secure-form-types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const CLIENT_IDENTITY_KEYS = [
  "profile",
  "profilePath",
  "containerName",
  "cdpPort",
  "noVncPort",
  "password",
  "values",
  "username",
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
          "account_computer_login does not accept credentials or a client profile",
        ),
      );
      return true;
    }
  }
  return false;
}

function requireAccount(client: GatewayClient | null, respond: RespondFn) {
  const account = resolveViewerAccount(client);
  if (!account) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "account_computer_login requires the signed-in account",
      ),
    );
    return null;
  }
  return account;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function asSignals(raw: unknown): LoginPageSignals {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const row = raw as Record<string, unknown>;
  return {
    signedIn: asBool(row.signedIn),
    password: asBool(row.password),
    qr: asBool(row.qr),
    sms: asBool(row.sms),
    captcha: asBool(row.captcha),
    passkey: asBool(row.passkey),
  };
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

function asDomainExtras(raw: unknown): { allowHosts?: string[]; expectedUrlPrefix?: string } {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const row = raw as Record<string, unknown>;
  return {
    ...(Array.isArray(row.allowHosts)
      ? { allowHosts: row.allowHosts.filter((host): host is string => typeof host === "string") }
      : {}),
    ...(typeof row.expectedUrlPrefix === "string"
      ? { expectedUrlPrefix: row.expectedUrlPrefix }
      : {}),
  };
}

function zeroize(secret: SiteLoginSecret) {
  secret.username = "";
  secret.password = "";
}

function valuesFromSecret(
  fields: SecureFormFieldTarget[],
  secret: SiteLoginSecret,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === "password") {
      values[field.fieldId] = secret.password;
    } else if (field.kind === "username" || field.kind === "email") {
      values[field.fieldId] = secret.username;
    }
  }
  return values;
}

export const accountComputerLoginHandlers: GatewayRequestHandlers = {
  "account_computer_login.plan": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = requireAccount(client, respond);
    if (!account) {
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const host = normalizeLoginHost(typeof params.host === "string" ? params.host : "");
    if (!sessionKey || !host) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "plan requires sessionKey and host"),
      );
      return;
    }
    const signals = asSignals(params.signals);
    const policy = await readLoginPolicy({ ...account, host });
    const classified = classifyAccountComputerLogin({ signals, policy });
    const preferredMethod = policy?.preferredMethod;
    const firstChoiceRecorded = Boolean(policy?.firstChoiceRecorded);

    if (classified.decision === "continue") {
      respond(true, { decision: "continue", host, firstChoiceRecorded });
      return;
    }

    if (classified.decision === "choose") {
      const choiceId = randomBytes(16).toString("hex");
      const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
      registerLoginChoiceOffer({
        choiceId,
        ...account,
        sessionKey,
        host,
        methods: classified.methods,
      });
      const waiter = waitForLoginChoice({ choiceId, timeoutMs });
      context.broadcast(
        "account_computer_login.choice_offered",
        { choiceId, sessionKey, host, methods: classified.methods },
        { dropIfSlow: true },
      );
      const picked = await waiter;
      if (picked === "timeout") {
        context.broadcast(
          "account_computer_login.choice_resolved",
          { choiceId, sessionKey, host },
          { dropIfSlow: true },
        );
        respond(true, { decision: "choose_timeout", host, choiceId });
        return;
      }
      const recorded = await readLoginPolicy({ ...account, host });
      respond(true, {
        decision: picked === "qr" ? "handoff" : "secure_form",
        ...(picked === "qr" ? { reason: "qr" } : {}),
        host,
        preferredMethod: recorded?.preferredMethod ?? picked,
        firstChoiceRecorded: true,
      });
      return;
    }

    if (classified.decision === "autofill") {
      const credentialId = policy?.rememberedCredentialId ?? "";
      const fields = asFields(params.fields);
      if (!fields || !fields.some((field) => field.kind === "password")) {
        respond(true, {
          decision: "autofill_needs_fields",
          host,
          preferredMethod: "auto",
          firstChoiceRecorded: true,
        });
        return;
      }
      const secret = await loadSiteLoginSecret(credentialId);
      if (!secret) {
        respond(true, {
          decision: "secure_form",
          host,
          code: "credential_missing",
          preferredMethod: preferredMethod ?? "auto",
          firstChoiceRecorded,
        });
        return;
      }
      const values = valuesFromSecret(fields, secret);
      zeroize(secret);
      const extras = asDomainExtras(params.domain);
      let formId = "";
      try {
        const offered = createSecureFormRequest({
          ...account,
          sessionKey,
          agentLabel: "Account Computer",
          reason: "auth",
          domain: { host, ...extras },
          fields,
        });
        formId = offered.formId;
        const form = getPendingSecureForm(offered.formId);
        if (!form) {
          respond(true, {
            decision: "autofill",
            host,
            status: "failed",
            code: "fill_error",
            preferredMethod: "auto",
          });
          return;
        }
        const filled = await preflightAndFillSecureForm({ form, values });
        const receipt =
          filled.status === "filled"
            ? completeSecureForm(offered.formId, {
                status: "filled",
                ...(typeof filled.submittedEnter === "boolean"
                  ? { submittedEnter: filled.submittedEnter }
                  : {}),
              })
            : completeSecureForm(offered.formId, {
                status: "failed",
                code: filled.code,
                detail: filled.detail,
              });
        const publicReceipt = receipt ?? filled;
        context.broadcast("secure_form.receipt", publicReceipt, { dropIfSlow: true });
        respond(true, {
          decision: "autofill",
          host,
          status: publicReceipt.status,
          ...(publicReceipt.code ? { code: publicReceipt.code } : {}),
          formId: publicReceipt.formId,
          preferredMethod: "auto",
          firstChoiceRecorded: true,
        });
      } catch {
        if (formId) {
          completeSecureForm(formId, { status: "failed", code: "fill_error" });
        }
        respond(true, {
          decision: "autofill",
          host,
          status: "failed",
          code: "fill_error",
          preferredMethod: "auto",
        });
      } finally {
        for (const key of Object.keys(values)) {
          values[key] = "";
          delete values[key];
        }
      }
      return;
    }

    if (classified.decision === "handoff") {
      const recorded =
        classified.reason === "qr"
          ? await rememberObservedLoginMethod({ ...account, host, method: "qr" })
          : policy;
      respond(true, {
        decision: "handoff",
        reason: classified.reason,
        host,
        ...(recorded
          ? {
              preferredMethod: recorded.preferredMethod,
              firstChoiceRecorded: recorded.firstChoiceRecorded,
            }
          : {}),
      });
      return;
    }

    const recorded = await rememberObservedLoginMethod({ ...account, host, method: "password" });
    respond(true, {
      decision: "secure_form",
      host,
      preferredMethod: recorded?.preferredMethod ?? "password",
      firstChoiceRecorded: recorded?.firstChoiceRecorded ?? true,
    });
  },

  "account_computer_login.choose": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = requireAccount(client, respond);
    if (!account) {
      return;
    }
    const choiceId = typeof params.choiceId === "string" ? params.choiceId.trim() : "";
    const method = params.method === "password" || params.method === "qr" ? params.method : null;
    const offer = choiceId ? getLoginChoiceOffer(choiceId) : null;
    if (!choiceId || !method || !offer) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "choice not found"));
      return;
    }
    if (offer.tenantId !== account.tenantId || offer.userId !== account.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "choice account mismatch"));
      return;
    }
    if (!offer.methods.includes(method)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "method is not offered"));
      return;
    }
    const existing = await readLoginPolicy({ ...account, host: offer.host });
    await writeLoginPolicy({
      ...account,
      host: offer.host,
      preferredMethod: method,
      firstChoiceRecorded: true,
      ...(existing?.rememberedCredentialId
        ? { rememberedCredentialId: existing.rememberedCredentialId }
        : {}),
      ...(existing?.saveDeclined ? { saveDeclined: true } : {}),
    });
    notifyLoginChoice(choiceId, method);
    context.broadcast(
      "account_computer_login.choice_resolved",
      { choiceId, sessionKey: offer.sessionKey, host: offer.host, method },
      { dropIfSlow: true },
    );
    respond(true, { ok: true, choiceId, method, host: offer.host });
  },

  "account_computer_login.offer_save": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = requireAccount(client, respond);
    if (!account) {
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const host = normalizeLoginHost(typeof params.host === "string" ? params.host : "");
    if (!sessionKey || !host) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "offer_save requires sessionKey and host"),
      );
      return;
    }
    const policy = await readLoginPolicy({ ...account, host });
    if (policy?.rememberedCredentialId || policy?.saveDeclined) {
      respond(true, { decision: "skip_save", host });
      return;
    }
    const pending = readPendingSiteLogin({ ...account, host });
    if (!pending) {
      respond(true, { decision: "skip_save", host, code: "nothing_to_save" });
      return;
    }
    if (pending.kind === "blocked") {
      respond(true, { decision: "save_blocked", host, code: "managed_vault_required" });
      return;
    }
    const saveId = randomBytes(16).toString("hex");
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
    registerLoginSaveOffer({ saveId, ...account, sessionKey, host });
    const waiter = waitForSaveDecision({ saveId, timeoutMs });
    context.broadcast(
      "account_computer_login.save_offered",
      { saveId, sessionKey, host },
      { dropIfSlow: true },
    );
    const decision = await waiter;
    if (decision === "timeout") {
      context.broadcast(
        "account_computer_login.save_resolved",
        { saveId, sessionKey, host, saved: false },
        { dropIfSlow: true },
      );
      respond(true, { decision: "save_timeout", host, saveId });
      return;
    }
    if (decision === "blocked") {
      respond(true, { decision: "save_blocked", host, code: "managed_vault_required" });
      return;
    }
    if (decision === "decline") {
      respond(true, { decision: "save_declined", host, preferredMethod: "password" });
      return;
    }
    respond(true, { decision: "saved", host, preferredMethod: "auto" });
  },

  "account_computer_login.save_decision": async ({ params, respond, client, context }) => {
    if (rejectIdentity(params, respond)) {
      return;
    }
    const account = requireAccount(client, respond);
    if (!account) {
      return;
    }
    const saveId = typeof params.saveId === "string" ? params.saveId.trim() : "";
    const save = params.save === true || params.save === "true";
    const decline = params.save === false || params.save === "false";
    const offer = saveId ? getLoginSaveOffer(saveId) : null;
    if (!saveId || !offer || (!save && !decline)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "save offer not found"));
      return;
    }
    if (offer.tenantId !== account.tenantId || offer.userId !== account.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "save account mismatch"));
      return;
    }
    if (decline) {
      const pending = readPendingSiteLogin({ ...account, host: offer.host });
      if (pending) {
        dropPendingSiteLoginForForm(pending.formId);
      }
      const existing = await readLoginPolicy({ ...account, host: offer.host });
      await writeLoginPolicy({
        ...account,
        host: offer.host,
        preferredMethod: existing?.preferredMethod === "qr" ? "qr" : "password",
        firstChoiceRecorded: true,
        saveDeclined: true,
        ...(existing?.rememberedCredentialId
          ? { rememberedCredentialId: existing.rememberedCredentialId }
          : {}),
      });
      notifySaveDecision(saveId, "decline");
      context.broadcast(
        "account_computer_login.save_resolved",
        { saveId, sessionKey: offer.sessionKey, host: offer.host, saved: false },
        { dropIfSlow: true },
      );
      respond(true, { ok: true, decision: "save_declined", host: offer.host });
      return;
    }
    const promoted = await promotePendingSiteLogin({ ...account, host: offer.host });
    if ("code" in promoted) {
      notifySaveDecision(
        saveId,
        promoted.code === "managed_vault_required" ? "blocked" : "decline",
      );
      respond(true, {
        ok: false,
        decision: promoted.code === "managed_vault_required" ? "save_blocked" : "skip_save",
        code: promoted.code,
        host: offer.host,
      });
      return;
    }
    const existing = await readLoginPolicy({ ...account, host: offer.host });
    await writeLoginPolicy({
      ...account,
      host: offer.host,
      preferredMethod: "auto",
      rememberedCredentialId: promoted.credentialId,
      firstChoiceRecorded: true,
      ...(existing?.saveDeclined ? {} : {}),
    });
    notifySaveDecision(saveId, "save");
    context.broadcast(
      "account_computer_login.save_resolved",
      { saveId, sessionKey: offer.sessionKey, host: offer.host, saved: true },
      { dropIfSlow: true },
    );
    respond(true, { ok: true, decision: "saved", host: offer.host, preferredMethod: "auto" });
  },
};
