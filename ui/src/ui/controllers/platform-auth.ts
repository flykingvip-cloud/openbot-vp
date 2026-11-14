import {
  CONTROL_UI_PLATFORM_AUTH_BASE_PATH,
  type ControlUiAuthMode,
  type ControlUiMembershipChoice,
  type ControlUiPlatformAuthError,
  type ControlUiPlatformAuthMode,
  type ControlUiPlatformAuthState,
  type ControlUiPlatformAuthSuccess,
  type ControlUiPlatformTenantCreationMode,
  type ControlUiPlatformTrialApplicationResult,
  type ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import { agentsCapability } from "../capability/agents/index.ts";
import { adaptAgentsLoadCapabilityState } from "../capability/view-state.ts";
import { signOutMessage } from "../employee-shell/native-bridge.ts";
import { sendToNativeHost } from "../employee-shell/native-host.ts";
import { normalizeBasePath } from "../navigation.ts";
import { PASSWORD_RESET_LOGIN_PATH } from "../routing/password-reset-link.ts";
import { originForPort, resolvePortFromSubdomain } from "../routing/subdomain-resolver.ts";
import { formatAdminActivationEmailReceipt } from "./admin-activation-email-receipt.ts";
import { createEnterpriseSeat } from "./enterprise-seat-assets.ts";
import {
  formatSurfaceMismatchLoginMessage,
  type SurfaceMismatchDetails,
} from "./surface-mismatch-message.ts";

export type PlatformAuthHost = {
  basePath: string;
  connected?: boolean;
  client?: { request?: unknown } | null;
  workbenchPrimaryModule?: string | null;
  loadKnowledgeUniverseHome?: (opts?: { force?: boolean }) => Promise<void>;
  platformAuthBusy: boolean;
  platformAuthError: string | null;
  platformAuthNotice?: string | null;
  platformAuthMode: ControlUiPlatformAuthMode;
  platformAuthEmail: string;
  platformAuthPassword: string;
  platformAuthDisplayName: string;
  platformAuthPlatformAdminDisplayName: string;
  platformAuthTenantName: string;
  platformAuthSeatTitle: string;
  platformAuthExpectedUsers: string;
  platformAuthUseCase: string;
  platformAuthCompanySize: string;
  platformAuthNeedsDemo: string;
  platformAuthIndustry: string;
  platformAuthTrialStep: 1 | 2;
  platformAuthInviteCode: string;
  platformAuthMfaCode?: string;
  platformAuthMfaEnrollment?: { otpAuthUrl: string; recoveryCodes: string[] } | null;
  platformAuthMfaStage?: "none" | "code" | "enroll";
  platformAuthCurrentPassword: string;
  platformAuthNewPassword: string;
  platformAuthPolicyTrialDays: string;
  platformAuthPolicySeatCount: string;
  platformAuthPolicyUpgradeUrl: string;
  platformAuthPolicyContactAdvisorUrl: string;
  platformAuthInstanceEnterpriseId: string;
  platformAuthInstanceTrialDays: string;
  platformAuthInstanceSeatCount: string;
  platformAuthInstanceUpgradeUrl: string;
  platformAuthInstanceContactAdvisorUrl: string;
  platformAuthCreationMode?: ControlUiPlatformTenantCreationMode;
  platformAuthPlatformAdminEmail: string;
  platformAuthPlatformAdminPassword: string;
  platformAuthPlatformAdminScopes: string[];
  platformAuthLoginIntent?: "enterprise-admin" | "platform-admin";
  platformAuthMembershipChoices?: ControlUiMembershipChoice[];
  platformAuthMembershipId?: string;
  /**
   * Enterprise co-admin invite code from the「接受管理员邀请」email link
   * (`?adminInvite=`). Consumed by the enterprise login; the existing employee
   * password is reused and never changed.
   */
  platformAuthAdminInviteCode?: string;
  connect: () => void;
  lastError: string | null;
  lastErrorCode: string | null;
  platformAuthState: ControlUiPlatformAuthState | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  bootstrapAuthMode: ControlUiAuthMode | null;
  bootstrapAuthSession: ControlUiTrustedProxySession | null;
};

type PlatformAuthRoute =
  | "/platform/bootstrap"
  | "/platform/admin/create"
  | "/platform/admin/remove"
  | "/enterprise/create"
  | "/employee/provision"
  | "/employee/activation/send"
  | "/employee/register"
  | "/platform/trial/apply"
  | "/platform/trial/applications/approve"
  | "/platform/trial/applications/reject"
  | "/enterprise/admin/activate"
  | "/enterprise/admin/invite"
  | "/login"
  | "/logout"
  | "/password/forgot"
  | "/password/change"
  | "/password/reset"
  | "/platform/enterprise/create"
  | "/platform/enterprise/trial/policy/update"
  | "/platform/enterprise/trial/instance/update"
  | "/platform/enterprise/admin/update"
  | "/platform/enterprise/admin/activation/send"
  | "/platform/security/mfa-policy"
  | "/member/remove"
  | "/session"
  | "/session/switch"
  | "/employee-access/offer/accept"
  | "/employee-access/offer/decline"
  | "/invite"
  | "/invite/revoke";

export type PlatformEmployeeProvisionInput = {
  employeeName: string;
  employeeEmail: string;
  seatId?: string | null;
  seatTitle: string;
  teamLabel?: string | null;
  responsibility?: string | null;
  sendActivationEmail?: boolean;
};

export type PlatformEmployeeActivationSendInput = {
  emails?: string[];
};

type PlatformEmployeeProvisionOptions = {
  manageBusy?: boolean;
  throwOnError?: boolean;
};

/** Query param carried by the enterprise co-admin invite email link. */
export const ENTERPRISE_ADMIN_INVITE_QUERY_PARAM = "adminInvite";

/** Reads the co-admin invite code from the current URL (`?adminInvite=`). */
export function readEnterpriseAdminInviteCodeFromLocation(
  location: Pick<Location, "search"> | null = typeof window !== "undefined"
    ? window.location
    : null,
): string {
  if (!location) {
    return "";
  }
  return (
    new URLSearchParams(location.search).get(ENTERPRISE_ADMIN_INVITE_QUERY_PARAM)?.trim() ?? ""
  );
}

/** Drops the consumed invite code from the address bar so it is not replayed. */
function clearEnterpriseAdminInviteFromLocation(): void {
  if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
    return;
  }
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(ENTERPRISE_ADMIN_INVITE_QUERY_PARAM)) {
      return;
    }
    url.searchParams.delete(ENTERPRISE_ADMIN_INVITE_QUERY_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // best effort
  }
}

function buildPlatformAuthUrl(basePath: string, suffix: PlatformAuthRoute): string {
  const normalizedBase = normalizeBasePath(basePath ?? "");
  const root = normalizedBase
    ? `${normalizedBase}${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}`
    : CONTROL_UI_PLATFORM_AUTH_BASE_PATH;
  return `${root}${suffix}`;
}

/** Current page path for local session-cookie selection on /session reads. */
function currentPagePathForSessionRequest(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const pathname = window.location?.pathname;
  return typeof pathname === "string" && pathname.trim() ? pathname : null;
}

function platformAuthSessionRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const pagePath = currentPagePathForSessionRequest();
  if (pagePath) {
    headers["x-openbot-page-path"] = pagePath;
  }
  return headers;
}

function trimErrorMessage(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readLoginSurface(
  payload: object | null,
  key: "requestSurface" | "targetSurface",
): SurfaceMismatchDetails["requestSurface"] {
  if (!payload || !(key in payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return value === "employee" || value === "enterprise" || value === "platform" ? value : undefined;
}

/** Maps gateway login codes to actionable copy for the auth form. */
export function localizePlatformAuthLoginError(
  code: string | undefined,
  fallback: string,
  _basePath = "",
  details?: SurfaceMismatchDetails,
): string {
  switch (code) {
    case "PLATFORM_AUTH_NO_ENTERPRISE_MEMBERSHIP":
      return "此账号尚未加入任何企业。请先使用邀请码注册，或联系管理员开通席位。";
    case "PLATFORM_AUTH_ROLE_MISMATCH":
      return "你没有企业管理员资格，请尝试从员工端登录。";
    case "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED":
      return "此账号加入了多家企业。请选择要进入的企业后再继续。";
    case "PLATFORM_AUTH_POSITION_REQUIRED":
      return "此员工账号还没有绑定岗位，暂时不能登录。";
    case "PLATFORM_AUTH_POSITION_UNVERIFIED":
      return "岗位台账暂时无法核验，不能登录。请确认入职岗位已写入后再试。";
    case "PLATFORM_AUTH_SURFACE_INELIGIBLE":
      return "此账号不能从当前入口登录。请改用与身份匹配的登录页。";
    case "PLATFORM_AUTH_SURFACE_MISMATCH":
      return formatSurfaceMismatchLoginMessage(details);
    case "PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED":
      return "进入平台控制台需要在平台登录页完成验证器验证，不能沿用当前会话。";
    case "PLATFORM_AUTH_SURFACE_ENTRY_REQUIRED":
      return "请从目标端的登录入口继续。当前页面不会改用另一端的会话。";
    case "PLATFORM_AUTH_MFA_INVALID":
      return "验证码不正确或已过期。";
    case "PLATFORM_AUTH_ADMIN_INVITE_INVALID":
      return "管理员邀请无效，或邀请发给了其他账号。请使用收到邀请邮件的员工账号登录。";
    case "PLATFORM_AUTH_ADMIN_INVITE_EXPIRED":
      return "管理员邀请已过期或已被撤销，请联系企业管理员重新发送。";
    case "PLATFORM_AUTH_ADMIN_INVITE_STALE":
      return "你已不是该企业的员工，无法接受管理员邀请。";
    default:
      return localizePlatformAuthOperatorError(
        Object.assign(new Error(fallback), { code: code ?? "" }),
      );
  }
}

function applyPlatformAuthSuccess(
  host: PlatformAuthHost,
  payload: ControlUiPlatformAuthSuccess,
): void {
  const session = payload.platformAuth.session ?? payload.session ?? null;
  host.platformAuthState = session ? { ...payload.platformAuth, session } : payload.platformAuth;
  host.bootstrapAuthMode = "trusted-proxy";
  host.bootstrapAuthSession = session;
  host.lastError = null;
  host.lastErrorCode = null;
  // Seat grants may land after the first agents.list; re-hydrate so AI 助手
  // and knowledge surfaces see the post-auth actor scope.
  if (host.connected && host.client) {
    void agentsCapability.load(adaptAgentsLoadCapabilityState(host as never));
    if (host.workbenchPrimaryModule === "knowledge") {
      void host.loadKnowledgeUniverseHome?.({ force: true });
    }
  }
}

async function postPlatformAuth(
  host: PlatformAuthHost,
  suffix: PlatformAuthRoute,
  body?: Record<string, unknown>,
  options?: { signal?: AbortSignal },
): Promise<ControlUiPlatformAuthSuccess> {
  const response = await fetch(buildPlatformAuthUrl(host.basePath, suffix), {
    method: "POST",
    headers: body
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" },
    credentials: "same-origin",
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  const payload = (await response.json().catch(() => null)) as
    | ControlUiPlatformAuthSuccess
    | ControlUiPlatformAuthError
    | null;
  if (!response.ok || !payload || !payload.ok) {
    const code =
      payload && "code" in payload && typeof payload.code === "string" ? payload.code : "";
    const message =
      trimErrorMessage(payload && "error" in payload ? payload.error : null) ||
      `Request failed (${response.status})`;
    const loginPath =
      payload && "loginPath" in payload && typeof payload.loginPath === "string"
        ? payload.loginPath
        : undefined;
    throw Object.assign(new Error(message), { code, loginPath });
  }
  applyPlatformAuthSuccess(host, payload);
  return payload;
}

/**
 * Login JSON can hydrate UI state even when the browser rejects Set-Cookie.
 * Gateway WS auth requires the HttpOnly cookie, so verify it landed before connect.
 */
async function assertPlatformSessionCookieLanded(host: PlatformAuthHost): Promise<boolean> {
  try {
    const response = await fetch(buildPlatformAuthUrl(host.basePath, "/session"), {
      method: "GET",
      headers: platformAuthSessionRequestHeaders(),
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "same-origin",
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json().catch(() => null)) as {
      session?: unknown;
      sessionKind?: unknown;
      enabled?: boolean;
    } | null;
    if (payload && typeof payload === "object") {
      // Prefer cookie-backed /session as the UI source of truth after login/switch.
      host.platformAuthState = payload as ControlUiPlatformAuthState;
      const session =
        payload.session && typeof payload.session === "object"
          ? (payload.session as ControlUiTrustedProxySession)
          : null;
      host.bootstrapAuthSession = session;
      if (session) {
        host.bootstrapAuthMode = "trusted-proxy";
      }
    }
    return Boolean(payload?.session) || Boolean(payload?.sessionKind);
  } catch {
    return false;
  }
}

async function connectAfterSessionCookie(host: PlatformAuthHost): Promise<boolean> {
  if (await assertPlatformSessionCookieLanded(host)) {
    host.connect();
    return true;
  }
  host.bootstrapAuthSession = null;
  host.platformAuthError =
    "登录已成功，但浏览器未保存平台会话 Cookie（Gateway 无法认证）。请清除 openbot.love 相关 Cookie 后重试，并检查是否拦截了跨站/第三方 Cookie。";
  return false;
}

function clearTrialApplyFields(host: PlatformAuthHost): void {
  host.platformAuthExpectedUsers = "";
  host.platformAuthUseCase = "";
  host.platformAuthCompanySize = "";
  host.platformAuthNeedsDemo = "";
  host.platformAuthIndustry = "";
}

function resolveTrialApplyNotice(
  result: ControlUiPlatformTrialApplicationResult | undefined,
): string | undefined {
  return typeof result?.message === "string" && result.message.trim()
    ? result.message.trim()
    : undefined;
}

/**
 * MFA-aware platform login. Performs the fetch directly (not via the throwing
 * postPlatformAuth) so it can capture the gateway's MFA challenge responses
 * (412 enroll-first / 401 mfa_required|mfa_invalid) without throwing.
 *
 * Returns "ok" on success (caller connects), or sets the MFA stage on the host
 * and returns "mfa" so the platform login UI renders the OTP field.
 * Employee and enterprise login pass `enforceMfa: false` and never enter that stage.
 */
async function postPlatformLoginWithMfa(
  host: PlatformAuthHost,
  body: Record<string, unknown>,
  options?: { enforceMfa?: boolean },
): Promise<"ok" | "mfa" | "error"> {
  const response = await fetch(buildPlatformAuthUrl(host.basePath, "/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | (ControlUiPlatformAuthSuccess & { code?: string })
    | (ControlUiPlatformAuthError & {
        mfaEnrollment?: { otpAuthUrl: string; recoveryCodes: string[] };
        membershipChoices?: ControlUiMembershipChoice[];
      })
    | null;

  if (response.ok && payload && payload.ok) {
    applyPlatformAuthSuccess(host, payload);
    host.platformAuthMfaStage = "none";
    host.platformAuthMfaEnrollment = null;
    host.platformAuthMfaCode = "";
    host.platformAuthMembershipChoices = [];
    host.platformAuthMembershipId = "";
    return "ok";
  }

  const code = payload && "code" in payload ? payload.code : undefined;
  const fallback =
    trimErrorMessage(payload && "error" in payload ? payload.error : null) ||
    `Request failed (${response.status})`;
  const mismatchDetails: SurfaceMismatchDetails = {
    requestSurface: readLoginSurface(payload, "requestSurface"),
    targetSurface: readLoginSurface(payload, "targetSurface"),
  };
  const mfaChallenge =
    code === "PLATFORM_AUTH_MFA_REQUIRED" ||
    code === "PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST" ||
    code === "PLATFORM_AUTH_MFA_INVALID";
  if (options?.enforceMfa === false && mfaChallenge) {
    host.platformAuthMfaStage = "none";
    host.platformAuthMfaEnrollment = null;
    host.platformAuthMfaCode = "";
    host.platformAuthNotice = null;
    host.platformAuthError = "此入口只需密码登录，不需要验证器验证码。";
    return "error";
  }
  if (code === "PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST") {
    const enrollment =
      payload && "mfaEnrollment" in payload ? (payload.mfaEnrollment ?? null) : null;
    host.platformAuthMfaStage = "enroll";
    host.platformAuthMfaEnrollment = enrollment;
    host.platformAuthMfaCode = "";
    host.platformAuthError = null;
    host.platformAuthNotice = "需要先完成两步验证设置。请把账号加入验证器，再输入首个动态验证码。";
    return "mfa";
  }
  if (code === "PLATFORM_AUTH_MFA_REQUIRED") {
    host.platformAuthMfaStage = "code";
    host.platformAuthMfaCode = "";
    host.platformAuthError = null;
    host.platformAuthNotice = "此账号已开启两步验证。请输入验证器中的 6 位动态验证码后再次登录。";
    return "mfa";
  }
  if (code === "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED") {
    const choices =
      payload && "membershipChoices" in payload && Array.isArray(payload.membershipChoices)
        ? payload.membershipChoices
        : [];
    host.platformAuthMembershipChoices = choices;
    host.platformAuthMfaStage = "none";
    host.platformAuthNotice = null;
    host.platformAuthError = localizePlatformAuthLoginError(
      code,
      fallback,
      host.basePath,
      mismatchDetails,
    );
    return "error";
  }
  host.platformAuthMembershipChoices = [];

  if (code === "PLATFORM_AUTH_MFA_INVALID") {
    // Keep the current stage (code or enroll) so the user can retry.
    if (host.platformAuthMfaStage !== "enroll") {
      host.platformAuthMfaStage = "code";
    }
    host.platformAuthNotice = null;
    host.platformAuthError = localizePlatformAuthLoginError(code, "验证码不正确或已过期。");
    return "error";
  }

  host.platformAuthNotice = null;
  host.platformAuthError = localizePlatformAuthLoginError(
    code,
    fallback,
    host.basePath,
    mismatchDetails,
  );
  return "error";
}

/** Explicit target sent with every login. MFA retries use the same fields. */
function loginTargetFields(
  host: PlatformAuthHost,
  adminInviteCode: string,
): {
  sessionDomain: "employee" | "enterprise" | "platform";
  expectedSessionKind?: "enterprise-admin";
  membershipId?: string;
  tenantId?: string;
} {
  const selectedId = host.platformAuthMembershipId?.trim() ?? "";
  const choice = host.platformAuthMembershipChoices?.find(
    (entry) => entry.membershipId === selectedId,
  );
  const selection = choice
    ? { membershipId: choice.membershipId, tenantId: choice.enterpriseId }
    : {};
  if (host.platformAuthLoginIntent === "enterprise-admin" || adminInviteCode) {
    return { sessionDomain: "enterprise", expectedSessionKind: "enterprise-admin", ...selection };
  }
  if (host.platformAuthLoginIntent === "platform-admin") {
    return { sessionDomain: "platform" };
  }
  return { sessionDomain: "employee", ...selection };
}

export async function submitPlatformAuth(host: PlatformAuthHost): Promise<{
  notice?: string;
  passwordReset?: ControlUiPlatformAuthSuccess["passwordReset"];
} | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    const email = host.platformAuthEmail.trim();
    const displayName = host.platformAuthDisplayName.trim();
    const enterpriseName = host.platformAuthTenantName.trim();
    const code = host.platformAuthInviteCode.trim();
    switch (host.platformAuthMode) {
      case "platform-bootstrap":
        await postPlatformAuth(host, "/platform/bootstrap", {
          email,
          password: host.platformAuthPassword,
          displayName,
        });
        host.platformAuthPassword = "";
        await connectAfterSessionCookie(host);
        break;
      case "platform-super-admin-login": {
        const mfaCode = host.platformAuthMfaCode?.trim();
        const result = await postPlatformLoginWithMfa(host, {
          email,
          password: host.platformAuthPassword,
          sessionDomain: "platform",
          expectedPlatformRole: "super-admin",
          ...(mfaCode ? { mfaCode } : {}),
        });
        if (result === "ok") {
          host.platformAuthPassword = "";
          await connectAfterSessionCookie(host);
        }
        break;
      }
      case "platform-admin-login": {
        const mfaCode = host.platformAuthMfaCode?.trim();
        const result = await postPlatformLoginWithMfa(host, {
          email,
          password: host.platformAuthPassword,
          sessionDomain: "platform",
          expectedPlatformRole: "admin",
          ...(mfaCode ? { mfaCode } : {}),
        });
        if (result === "ok") {
          host.platformAuthPassword = "";
          await connectAfterSessionCookie(host);
        }
        break;
      }
      case "enterprise-create": {
        const payload = await postPlatformAuth(host, "/enterprise/create", {
          enterpriseName,
          adminName: displayName,
          adminEmail: email,
        });
        host.platformAuthMode = "enterprise-activate";
        host.platformAuthInviteCode = payload.platformAuth.pendingActivation?.code ?? "";
        host.platformAuthPassword = "";
        break;
      }
      case "enterprise-activate":
        await postPlatformAuth(host, "/enterprise/admin/activate", {
          email,
          password: host.platformAuthPassword,
          displayName,
          code,
        });
        host.platformAuthPassword = "";
        host.platformAuthInviteCode = "";
        await connectAfterSessionCookie(host);
        break;
      case "employee-register":
        await postPlatformAuth(host, "/employee/register", {
          email,
          password: host.platformAuthPassword,
          displayName,
          code,
        });
        host.platformAuthPassword = "";
        host.platformAuthInviteCode = "";
        await connectAfterSessionCookie(host);
        break;
      case "login": {
        const adminInviteCode =
          host.platformAuthAdminInviteCode?.trim() || readEnterpriseAdminInviteCodeFromLocation();
        const choices = host.platformAuthMembershipChoices ?? [];
        if (choices.length > 1 && !host.platformAuthMembershipId?.trim()) {
          host.platformAuthError = "请选择要进入的企业。";
          break;
        }
        host.platformAuthMfaStage = "none";
        host.platformAuthMfaEnrollment = null;
        host.platformAuthMfaCode = "";
        const result = await postPlatformLoginWithMfa(
          host,
          {
            email,
            password: host.platformAuthPassword,
            // An admin invite link always lands on the enterprise entry: accept the
            // invite (adds enterprise-admin next to member) and sign in as admin.
            ...loginTargetFields(host, adminInviteCode),
            ...(adminInviteCode ? { adminInviteCode } : {}),
          },
          { enforceMfa: false },
        );
        if (result === "ok") {
          host.platformAuthPassword = "";
          if (adminInviteCode) {
            host.platformAuthAdminInviteCode = "";
            clearEnterpriseAdminInviteFromLocation();
            host.platformAuthNotice =
              "已接受管理员邀请。你的账号现在同时拥有员工与企业管理员身份，登录密码保持不变。";
          }
          await connectAfterSessionCookie(host);
        }
        break;
      }
      case "forgot-password": {
        const payload = await postPlatformAuth(host, "/password/forgot", { email });
        host.platformAuthMode = "password-reset";
        host.platformAuthPassword = "";
        host.platformAuthInviteCode = payload.platformAuth.pendingPasswordReset?.code ?? "";
        break;
      }
      case "password-reset": {
        const payload = await postPlatformAuth(host, "/password/reset", {
          email,
          password: host.platformAuthPassword,
          code,
        });
        host.platformAuthPassword = "";
        host.platformAuthInviteCode = "";
        if (payload.passwordReset?.sessionIssued === false) {
          host.bootstrapAuthSession = null;
          host.platformAuthMode =
            payload.passwordReset.returnSurface === "platform" ? "platform-admin-login" : "login";
          return {
            notice: "密码已更新。请从原来的登录入口重新登录。",
            passwordReset: payload.passwordReset,
          };
        }
        break;
      }
      case "platform-enterprise-create": {
        const creationMode = host.platformAuthCreationMode ?? "quick-trial";
        const payload = await postPlatformAuth(host, "/platform/enterprise/create", {
          enterpriseName,
          adminName: displayName || email.split("@")[0] || "企业管理员",
          adminEmail: email,
          creationMode,
          ...(host.platformAuthInstanceTrialDays.trim()
            ? { trialDays: Number.parseInt(host.platformAuthInstanceTrialDays.trim(), 10) }
            : {}),
          ...(host.platformAuthInstanceSeatCount.trim()
            ? { seatCount: Number.parseInt(host.platformAuthInstanceSeatCount.trim(), 10) }
            : {}),
          ...(host.platformAuthInstanceUpgradeUrl.trim()
            ? { upgradeUrl: host.platformAuthInstanceUpgradeUrl.trim() }
            : {}),
          ...(host.platformAuthInstanceContactAdvisorUrl.trim()
            ? { contactAdvisorUrl: host.platformAuthInstanceContactAdvisorUrl.trim() }
            : {}),
        });
        host.platformAuthPassword = "";
        const pending = payload.platformAuth.pendingActivation;
        host.platformAuthInviteCode = pending?.code ?? "";
        if (pending?.enterpriseId?.trim()) {
          host.platformAuthInstanceEnterpriseId = pending.enterpriseId.trim();
        }
        host.platformAuthInstanceTrialDays = "";
        host.platformAuthInstanceSeatCount = "";
        host.platformAuthInstanceUpgradeUrl = "";
        host.platformAuthInstanceContactAdvisorUrl = "";
        const createdLabel =
          creationMode === "quick-trial" ? "试用租户已创建。" : "企业租户已创建。";
        const receipt = formatAdminActivationEmailReceipt(payload.emailDelivery, email);
        if (receipt.level === "ok") {
          host.platformAuthNotice = `${createdLabel}${receipt.text}`;
          host.platformAuthError = null;
        } else {
          host.platformAuthNotice = createdLabel;
          host.platformAuthError = receipt.text;
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

const DEFAULT_PLATFORM_ADMIN_CREATE_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
] as const;

export async function createPlatformAdmin(host: PlatformAuthHost): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    const scopes =
      host.platformAuthPlatformAdminScopes.length > 0
        ? host.platformAuthPlatformAdminScopes
        : [...DEFAULT_PLATFORM_ADMIN_CREATE_SCOPES];
    await postPlatformAuth(host, "/platform/admin/create", {
      email: host.platformAuthPlatformAdminEmail.trim(),
      password: host.platformAuthPlatformAdminPassword,
      displayName: host.platformAuthPlatformAdminDisplayName.trim(),
      scopes,
    });
    host.platformAuthPlatformAdminDisplayName = "";
    host.platformAuthPlatformAdminEmail = "";
    host.platformAuthPlatformAdminPassword = "";
    // Keep full-scope default so the next "管理员" create matches the UI preset.
    host.platformAuthPlatformAdminScopes = [...DEFAULT_PLATFORM_ADMIN_CREATE_SCOPES];
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function removePlatformAdmin(host: PlatformAuthHost, user: string): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/admin/remove", {
      user: user.trim(),
    });
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function submitPlatformTrialApply(
  host: PlatformAuthHost,
): Promise<{ notice?: string } | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    const enterpriseName = host.platformAuthTenantName.trim();
    const contactName = host.platformAuthDisplayName.trim();
    const workEmail = host.platformAuthEmail.trim();
    const payload = await postPlatformAuth(host, "/platform/trial/apply", {
      companyName: enterpriseName,
      contactName,
      workEmail,
      expectedUsers: host.platformAuthExpectedUsers.trim(),
      useCase: host.platformAuthUseCase.trim(),
      ...(host.platformAuthCompanySize.trim()
        ? { companySize: host.platformAuthCompanySize.trim() }
        : {}),
      ...(host.platformAuthNeedsDemo.trim()
        ? { needsDemo: host.platformAuthNeedsDemo.trim() === "yes" }
        : {}),
      ...(host.platformAuthIndustry.trim() ? { industry: host.platformAuthIndustry.trim() } : {}),
    });
    clearTrialApplyFields(host);
    host.platformAuthPassword = "";
    host.platformAuthInviteCode = payload.platformAuth.pendingActivation?.code ?? "";
    if (payload.trialApplication?.mode === "manual") {
      host.platformAuthMode = "enterprise-create";
      return { notice: resolveTrialApplyNotice(payload.trialApplication) };
    }
    host.platformAuthMode = "enterprise-activate";
    return { notice: resolveTrialApplyNotice(payload.trialApplication) };
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

/**
 * Super-admin only: toggles the platform MFA policy (requireMfaForPlatformAdmins).
 * Persists a runtime override (no gateway restart). On success the returned
 * platformAuth state refreshes the toggle's displayed value.
 */
export async function setPlatformMfaPolicy(
  host: PlatformAuthHost,
  requireMfa: boolean,
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/security/mfa-policy", {
      requireMfaForPlatformAdmins: requireMfa,
    });
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function logoutPlatformAuth(
  host: PlatformAuthHost,
  nativeWindow?: Window,
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/logout");
    host.bootstrapAuthSession = null;
    host.platformAuthPassword = "";
    host.connect();
    // When running inside WKWebView, also clear the native PlatformAuth session.
    // HTTP logout + connect() alone leaves native authenticated and re-bootstraps.
    sendToNativeHost(signOutMessage(), nativeWindow);
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

function resolveInviteTenantId(host: PlatformAuthHost): string {
  return (
    host.platformAuthState?.enterprise?.id?.trim() ||
    host.platformAuthState?.session?.tenantId?.trim() ||
    ""
  );
}

/**
 * Create a vacant position, then invite the employee onto that stable id.
 * Title never selects or creates the position inside `/employee/provision`.
 */
export async function inviteEmployeeToNewPosition(params: {
  host: PlatformAuthHost;
  tenantId?: string | null;
  employeeName: string;
  employeeEmail: string;
  seatTitle: string;
  teamLabel?: string | null;
  responsibility?: string | null;
  sendActivationEmail?: boolean;
  manageBusy?: boolean;
  throwOnError?: boolean;
}): Promise<ControlUiPlatformAuthSuccess | undefined> {
  const manageBusy = params.manageBusy !== false;
  if (manageBusy) {
    params.host.platformAuthBusy = true;
  }
  params.host.platformAuthError = null;
  try {
    const tenantId = params.tenantId?.trim() || resolveInviteTenantId(params.host);
    const seatTitle = params.seatTitle.trim();
    if (!tenantId) {
      const error = new Error("缺少企业租户，无法创建岗位。");
      params.host.platformAuthError = error.message;
      if (params.throwOnError) {
        throw error;
      }
      return undefined;
    }
    if (!seatTitle) {
      const error = new Error("请输入岗位名称。");
      params.host.platformAuthError = error.message;
      if (params.throwOnError) {
        throw error;
      }
      return undefined;
    }
    const created = await createEnterpriseSeat(
      params.host,
      tenantId,
      {
        seatTitle,
        teamLabel: params.teamLabel,
        responsibility: params.responsibility,
      },
      { manageBusy: false },
    );
    const seatId = created?.seat?.seatId?.trim() ?? "";
    if (!seatId) {
      const error = new Error(params.host.platformAuthError ?? "岗位创建失败");
      params.host.platformAuthError = error.message;
      if (params.throwOnError) {
        throw error;
      }
      return undefined;
    }
    return await provisionPlatformAuthEmployee(
      params.host,
      {
        employeeName: params.employeeName,
        employeeEmail: params.employeeEmail,
        seatId,
        seatTitle,
        teamLabel: params.teamLabel,
        responsibility: params.responsibility,
        sendActivationEmail: params.sendActivationEmail,
      },
      { manageBusy: false, throwOnError: params.throwOnError },
    );
  } finally {
    if (manageBusy) {
      params.host.platformAuthBusy = false;
    }
  }
}

export async function createPlatformAuthInvite(host: PlatformAuthHost): Promise<void> {
  await inviteEmployeeToNewPosition({
    host,
    employeeName: host.platformAuthDisplayName.trim(),
    employeeEmail: host.platformAuthEmail.trim(),
    seatTitle: host.platformAuthSeatTitle.trim(),
  });
}

export async function provisionPlatformAuthEmployee(
  host: PlatformAuthHost,
  input: PlatformEmployeeProvisionInput,
  options: PlatformEmployeeProvisionOptions = {},
): Promise<ControlUiPlatformAuthSuccess | undefined> {
  const manageBusy = options.manageBusy !== false;
  if (manageBusy) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    const seatId = input.seatId?.trim() ?? "";
    if (!seatId) {
      const error = new Error("Invite requires an existing position id.");
      host.platformAuthError = error.message;
      if (options.throwOnError) {
        throw error;
      }
      return undefined;
    }
    const payload = await postPlatformAuth(host, "/employee/provision", {
      employeeName: input.employeeName.trim(),
      employeeEmail: input.employeeEmail.trim(),
      seatId,
      seatTitle: input.seatTitle.trim(),
      ...(input.teamLabel?.trim() ? { teamLabel: input.teamLabel.trim() } : {}),
      ...(input.responsibility?.trim() ? { responsibility: input.responsibility.trim() } : {}),
      ...(input.sendActivationEmail === false ? { sendActivationEmail: false } : {}),
    });
    host.platformAuthInviteCode = payload.platformAuth.pendingActivation?.code ?? "";
    return payload;
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
    if (options.throwOnError) {
      throw error;
    }
    return undefined;
  } finally {
    if (manageBusy) {
      host.platformAuthBusy = false;
    }
  }
}

export async function sendPlatformEmployeeActivations(
  host: PlatformAuthHost,
  input: PlatformEmployeeActivationSendInput = {},
  options?: { quiet?: boolean },
): Promise<ControlUiPlatformAuthSuccess | undefined> {
  // Invite modal tracks per-email busy; avoid global platformAuthBusy flipping every row.
  if (!options?.quiet) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    return await postPlatformAuth(
      host,
      "/employee/activation/send",
      input.emails?.length ? { emails: input.emails } : { all: true },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    host.platformAuthError =
      raw === "Not Found"
        ? "激活发送接口不可用，请重启 Gateway 后重试。"
        : raw.includes("No pending employee activations")
          ? "未找到该成员的待激活记录，请确认已通过导入或搭建创建。"
          : localizePlatformAuthOperatorError(error);
    return undefined;
  } finally {
    if (!options?.quiet) {
      host.platformAuthBusy = false;
    }
  }
}

export async function revokePlatformAuthInvite(
  host: PlatformAuthHost,
  code: string,
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/invite/revoke", {
      code: code.trim(),
    });
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function removePlatformAuthMember(
  host: PlatformAuthHost,
  user: string,
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/member/remove", {
      user: user.trim(),
    });
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export type PlatformEnterpriseAdminInviteOptions = {
  /** Replace a still-pending invite with a fresh link (「重新发送」). */
  resend?: boolean;
};

/**
 * Enterprise console「邀请管理员」: invite an existing active employee (from the
 * employee directory) to ALSO become an enterprise administrator. The invitee
 * receives an email, signs in through the enterprise entry with the existing
 * employee password, and keeps dual identity (employee + enterprise admin).
 */
export async function invitePlatformEnterpriseAdmin(
  host: PlatformAuthHost,
  email: string,
  options: PlatformEnterpriseAdminInviteOptions = {},
): Promise<ControlUiPlatformAuthSuccess | undefined> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postPlatformAuth(host, "/enterprise/admin/invite", {
      user: email.trim(),
      ...(options.resend ? { resend: true } : {}),
    });
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
    return undefined;
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function acceptPlatformSeatAssignmentOffer(
  host: PlatformAuthHost,
  offerId: string,
): Promise<{ notice: string } | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/employee-access/offer/accept", {
      offerId: offerId.trim(),
    });
    return { notice: "已接受岗位绑定。" };
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function declinePlatformSeatAssignmentOffer(
  host: PlatformAuthHost,
  offerId: string,
): Promise<{ notice: string } | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/employee-access/offer/decline", {
      offerId: offerId.trim(),
    });
    return { notice: "已拒绝岗位绑定。" };
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function changePlatformAuthPassword(
  host: PlatformAuthHost,
  body: {
    currentPassword: string;
    newPassword: string;
  },
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/password/change", body);
    host.connect();
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function updatePlatformTrialPolicy(
  host: PlatformAuthHost,
  body: {
    defaultTrialDays?: number;
    defaultTrialSeatCount?: number;
    upgradeUrl?: string;
    contactAdvisorUrl?: string;
  },
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/enterprise/trial/policy/update", body);
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export function localizePlatformAuthOperatorError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const raw = error instanceof Error ? error.message : String(error);
  switch (code) {
    case "PLATFORM_AUTH_EMAIL_EXISTS":
      return "该邮箱已注册。请改用其他邮箱，或先处理已有账号。";
    case "PLATFORM_AUTH_INVALID_EMAIL":
      return "请输入有效的管理员邮箱。";
    case "PLATFORM_AUTH_WEAK_PASSWORD":
      return "密码至少需要 8 个字符。";
    case "PLATFORM_AUTH_SUPER_ADMIN_REQUIRED":
      return "需要超级管理员权限才能管理平台管理员。请使用超管账号重新登录后再试。";
    case "PLATFORM_AUTH_ADMIN_SELF_REMOVE":
      return "不能撤销自己的平台管理员账号。";
    case "PLATFORM_AUTH_ADMIN_NOT_FOUND":
      return "未找到该平台管理员，可能已被撤销。";
    case "PLATFORM_AUTH_SUPER_ADMIN_PROTECTED":
      return "超级管理员不能从本页撤销。";
    case "PLATFORM_AUTH_ALREADY_ENTERPRISE_MEMBER":
      return "该邮箱已是本企业员工，无法重复邀请。";
    case "PLATFORM_AUTH_INVALID_CREDENTIALS":
      return "邮箱已有账号，请使用原密码完成加入企业。";
    case "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS":
      return "该管理员仍有待激活开通记录。请先处理旧激活（或等待其失效）后再批准。";
    case "PLATFORM_AUTH_PLATFORM_ADMIN_REQUIRED":
      return "需要平台管理员权限。请重新登录平台管理会话后再试。";
    case "PLATFORM_AUTH_EMPLOYEE_PROVISION_FORBIDDEN":
    case "PLATFORM_AUTH_EMPLOYEE_ACTIVATION_FORBIDDEN":
    case "PLATFORM_AUTH_MEMBER_FORBIDDEN":
      return "需要企业管理员权限才能邀请/激活员工。若你同时是平台管理员，请先点击「以企业管理员身份继续」，或重新从企业登录入口登录。";
    case "PLATFORM_TRIAL_APPLICATION_NOT_FOUND":
      return "试用申请不存在或已被清理。";
    case "PLATFORM_TRIAL_APPLICATION_NOT_PENDING":
      return "该申请不在待审批状态，可能已处理或已开通。";
    case "PLATFORM_AUTH_ENTERPRISE_NOT_FOUND":
      return "未找到对应企业租户，无法更新试用设定。";
    case "PLATFORM_AUTH_ADMIN_ACTIVATION_NOT_FOUND":
      return "该租户没有待激活的管理员开通记录，请先添加或编辑管理员。";
    case "PLATFORM_AUTH_ADMIN_NAME_REQUIRED":
      return "请填写管理员姓名。";
    case "PLATFORM_AUTH_MFA_INVALID":
      return "验证码不正确或已过期。";
    case "PLATFORM_AUTH_ADMIN_INVITE_FORBIDDEN":
      return "需要企业管理员权限才能邀请管理员。请切换到企业管理员身份后再试。";
    case "PLATFORM_AUTH_ADMIN_INVITE_PENDING":
      return "已向该员工发送过管理员邀请，等待对方接受。如需重发，请点击「重发管理员邀请」。";
    case "PLATFORM_AUTH_ALREADY_ENTERPRISE_ADMIN":
      return "该员工已是本企业管理员。";
    case "PLATFORM_AUTH_MEMBER_NOT_FOUND":
      return "该邮箱不是本企业员工，请先在员工名录中完成员工激活。";
    case "PLATFORM_AUTH_MEMBER_INACTIVE":
      return "该员工账号已停用，无法邀请为管理员。";
    default:
      break;
  }
  if (/already registered/i.test(raw)) {
    return "该邮箱已注册。请改用其他邮箱，或先处理已有账号。";
  }
  if (/pending activation/i.test(raw)) {
    return "该管理员仍有待激活开通记录。请先处理旧激活（或等待其失效）后再批准。";
  }
  if (/Only platform administrators/i.test(raw)) {
    return "需要平台管理员权限。请重新登录平台管理会话后再试。";
  }
  if (/Only enterprise administrators can (issue|send) employee activations/i.test(raw)) {
    return "需要企业管理员权限才能邀请/激活员工。若你同时是平台管理员，请先点击「以企业管理员身份继续」，或重新从企业登录入口登录。";
  }
  if (/Only enterprise administrators can remove members/i.test(raw)) {
    return "需要企业管理员权限才能移除成员。请切换到企业管理员身份后再试。";
  }
  if (/Password must be at least 8 characters/i.test(raw)) {
    return "密码至少需要 8 个字符。";
  }
  if (/Enter a valid admin email/i.test(raw)) {
    return "请输入有效的管理员邮箱。";
  }
  if (/Only super administrators can (create|remove) platform administrators/i.test(raw)) {
    return "需要超级管理员权限才能管理平台管理员。请使用超管账号重新登录后再试。";
  }
  return raw;
}

export async function updatePlatformTrialInstance(
  host: PlatformAuthHost,
  body: {
    enterpriseId: string;
    trialDays?: number;
    seatCount?: number;
    upgradeUrl?: string;
    contactAdvisorUrl?: string;
  },
  options?: { quiet?: boolean; signal?: AbortSignal },
): Promise<void> {
  if (!options?.quiet) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/enterprise/trial/instance/update", body, {
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      host.platformAuthError =
        "延长试用超时。若刷新后截止日已更新，说明服务端已生效，可忽略本次超时。";
    } else if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      host.platformAuthError =
        "延长试用超时。若刷新后截止日已更新，说明服务端已生效，可忽略本次超时。";
    } else {
      host.platformAuthError = localizePlatformAuthOperatorError(error);
    }
  } finally {
    if (!options?.quiet) {
      host.platformAuthBusy = false;
    }
  }
}

export async function updatePlatformEnterpriseAdmin(
  host: PlatformAuthHost,
  body: {
    enterpriseId: string;
    adminName: string;
    adminEmail: string;
    resendActivation?: boolean;
  },
  options?: { quiet?: boolean; signal?: AbortSignal },
): Promise<void> {
  if (!options?.quiet) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/enterprise/admin/update", body, {
      signal: options?.signal,
    });
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    if (!options?.quiet) {
      host.platformAuthBusy = false;
    }
  }
}

export async function resendPlatformEnterpriseAdminActivation(
  host: PlatformAuthHost,
  body: { enterpriseId: string },
  options?: { quiet?: boolean; signal?: AbortSignal },
): Promise<ControlUiPlatformAuthSuccess | undefined> {
  if (!options?.quiet) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    const payload = await postPlatformAuth(
      host,
      "/platform/enterprise/admin/activation/send",
      body,
      { signal: options?.signal },
    );
    const receipt = formatAdminActivationEmailReceipt(
      payload.emailDelivery,
      host.platformAuthEmail,
    );
    if (receipt.level === "ok") {
      host.platformAuthNotice = receipt.text;
      host.platformAuthError = null;
    } else {
      host.platformAuthNotice = null;
      host.platformAuthError = receipt.text;
    }
    return payload;
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
    return undefined;
  } finally {
    if (!options?.quiet) {
      host.platformAuthBusy = false;
    }
  }
}

export async function approvePlatformTrialApplication(
  host: PlatformAuthHost,
  body: {
    applicationId: string;
    trialDays?: number;
    seatCount?: number;
    reviewNote?: string;
  },
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/trial/applications/approve", body);
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function rejectPlatformTrialApplication(
  host: PlatformAuthHost,
  body: {
    applicationId: string;
    rejectionReason: string;
    reviewNote?: string;
  },
): Promise<void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    await postPlatformAuth(host, "/platform/trial/applications/reject", body);
  } catch (error) {
    host.platformAuthError = localizePlatformAuthOperatorError(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

type SurfaceName = "employee" | "enterprise" | "platform";

function targetSurfaceForSessionKind(
  kind: "enterprise-admin" | "platform-admin" | "platform-super-admin" | "member",
): SurfaceName {
  if (kind === "member") {
    return "employee";
  }
  if (kind === "enterprise-admin") {
    return "enterprise";
  }
  return "platform";
}

/** Page surface from the host, then the path. Null only when there is no window. */
export function currentPageSurface(): SurfaceName | null {
  if (typeof window === "undefined") {
    return null;
  }
  const resolved = resolvePortFromSubdomain(window.location.host);
  if (
    resolved.port === "employee" ||
    resolved.port === "enterprise" ||
    resolved.port === "platform"
  ) {
    return resolved.port;
  }
  if (resolved.isPublicHome) {
    return "employee";
  }
  const path = window.location.pathname;
  if (path === "/enterprise" || path.startsWith("/enterprise/")) {
    return "enterprise";
  }
  if (path === "/platform" || path.startsWith("/platform/")) {
    return "platform";
  }
  return "employee";
}

function navigateToSurfaceLogin(surface: SurfaceName): void {
  if (typeof window === "undefined") {
    return;
  }
  const path = PASSWORD_RESET_LOGIN_PATH[surface];
  const resolved = resolvePortFromSubdomain(window.location.host);
  if (resolved.isOpenBotDomain) {
    window.location.assign(`${originForPort(surface)}${path}`);
    return;
  }
  window.location.assign(path);
}

export async function switchPlatformAuthSessionKind(
  host: PlatformAuthHost,
  params: {
    targetSessionKind: "enterprise-admin" | "platform-admin" | "platform-super-admin" | "member";
    tenantId?: string | null;
  },
  options?: { quiet?: boolean },
): Promise<boolean> {
  const quiet = Boolean(options?.quiet);
  if (!quiet) {
    host.platformAuthBusy = true;
    host.platformAuthError = null;
  }
  try {
    await postPlatformAuth(host, "/session/switch", {
      targetSessionKind: params.targetSessionKind,
      ...(params.tenantId?.trim() ? { tenantId: params.tenantId.trim() } : {}),
    });
    const target = targetSurfaceForSessionKind(params.targetSessionKind);
    const here = currentPageSurface();
    // The new cookie is for the target surface. Reading /session on this page
    // returns the cookie for THIS host, which is a different session.
    if (here && here !== target) {
      navigateToSurfaceLogin(target);
      return true;
    }
    // Switch JSON can hydrate UI before the browser commits Set-Cookie. Re-read
    // /session so cookie-backed identity is the source of truth before connect.
    const landed = await assertPlatformSessionCookieLanded(host);
    if (!landed || host.platformAuthState?.sessionKind !== params.targetSessionKind) {
      host.platformAuthError =
        "身份切换未生效：浏览器未更新平台会话 Cookie。请清除 openbot.love 相关 Cookie 后，从企业登录入口重新登录。";
      return false;
    }
    if (typeof host.connect === "function") {
      host.connect();
    }
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "";
    if (
      code === "PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED" ||
      code === "PLATFORM_AUTH_SURFACE_ENTRY_REQUIRED"
    ) {
      host.platformAuthError = localizePlatformAuthLoginError(code, "请从目标端登录入口继续。");
      if (!quiet) {
        const surface =
          code === "PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED"
            ? "platform"
            : targetSurfaceForSessionKind(params.targetSessionKind);
        navigateToSurfaceLogin(surface);
      }
      return false;
    }
    if (!quiet) {
      host.platformAuthError = localizePlatformAuthOperatorError(error);
    }
    return false;
  } finally {
    if (!quiet) {
      host.platformAuthBusy = false;
    }
  }
}
