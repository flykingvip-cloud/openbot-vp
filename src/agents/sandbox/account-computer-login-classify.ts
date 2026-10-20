/**
 * Account Computer login method classifier.
 *
 * The model reports what the snapshot shows. This function picks the next
 * step. It never accepts or returns credentials.
 */

export type AccountComputerLoginMethod = "password" | "qr" | "auto";

export type LoginPageSignals = {
  /** Page already shows an authenticated session. */
  signedIn?: boolean;
  /** Username/password (or equivalent typed) fields are visible. */
  password?: boolean;
  /** QR or scan-to-login is visible (e.g. WeChat QR). */
  qr?: boolean;
  /** Phone number + SMS OTP participation surface is visible. */
  sms?: boolean;
  captcha?: boolean;
  passkey?: boolean;
};

export type LoginPolicyView = {
  preferredMethod: AccountComputerLoginMethod;
  rememberedCredentialId?: string;
  firstChoiceRecorded: boolean;
};

export type LoginPlanDecision =
  | { decision: "continue" }
  | { decision: "secure_form" }
  | { decision: "choose"; methods: Array<"password" | "qr"> }
  | { decision: "handoff"; reason: "qr" | "sms" | "captcha" | "passkey" }
  | { decision: "autofill" };

function flag(value: boolean | undefined): boolean {
  return value === true;
}

/**
 * Prefer a saved password when one exists. Otherwise honor the host's
 * recorded choice. A first visit that shows both password and QR asks once.
 * Captcha and passkey hand off only when a typed password form is not available.
 */
export function classifyAccountComputerLogin(params: {
  signals: LoginPageSignals;
  policy?: LoginPolicyView | null;
}): LoginPlanDecision {
  const signals = params.signals;
  const policy = params.policy ?? null;
  if (flag(signals.signedIn)) {
    return { decision: "continue" };
  }

  const password = flag(signals.password);
  const qr = flag(signals.qr);
  const captcha = flag(signals.captcha);
  const passkey = flag(signals.passkey);

  if (policy?.preferredMethod === "auto" && policy.rememberedCredentialId && password) {
    return { decision: "autofill" };
  }

  if (policy?.firstChoiceRecorded) {
    if (policy.preferredMethod === "qr" && (qr || !password)) {
      return { decision: "handoff", reason: "qr" };
    }
    if ((policy.preferredMethod === "password" || policy.preferredMethod === "auto") && password) {
      return { decision: "secure_form" };
    }
    if ((policy.preferredMethod === "password" || policy.preferredMethod === "auto") && qr) {
      return { decision: "handoff", reason: "qr" };
    }
  }

  if (password && qr) {
    return { decision: "choose", methods: ["password", "qr"] };
  }
  if (password) {
    return { decision: "secure_form" };
  }
  if (qr) {
    return { decision: "handoff", reason: "qr" };
  }
  const sms = flag(signals.sms);
  if (sms) {
    return { decision: "handoff", reason: "sms" };
  }
  if (captcha) {
    return { decision: "handoff", reason: "captcha" };
  }
  if (passkey) {
    return { decision: "handoff", reason: "passkey" };
  }
  return { decision: "continue" };
}

/** Registrable host key for per-site policy. Empty when the input is not a host. */
export function normalizeLoginHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (!host) {
    return "";
  }
  try {
    if (host.includes("://")) {
      host = new URL(host).hostname.toLowerCase();
    }
  } catch {
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  }
  host = host.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
  host = host.replace(/:\d+$/, "");
  if (host.startsWith("[") || host.includes("@")) {
    return "";
  }
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  if (
    !host ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.includes("..") ||
    host.startsWith(".") ||
    host.endsWith(".")
  ) {
    return "";
  }
  return host;
}
