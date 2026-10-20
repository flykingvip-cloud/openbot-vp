import type { ControlUiPlatformAuthState } from "../../../../src/gateway/control-ui-contract.js";
import type { Tab } from "../navigation.ts";

const CONTROLLED_LOGIN_PATHS = ["/", "/enterprise/login", "/platform/login"] as const;

export type ControlledLoginPath = (typeof CONTROLLED_LOGIN_PATHS)[number];

/**
 * Land only when the server confirmed the surface and the session kind matches
 * that surface. The form's intended entry is not a landing instruction.
 */
export function landTabForConfirmedSession(
  state: Pick<ControlUiPlatformAuthState, "sessionDomain" | "sessionKind"> | null | undefined,
): Tab | null {
  if (!state?.sessionDomain || !state.sessionKind) {
    return null;
  }
  if (
    state.sessionDomain === "platform" &&
    (state.sessionKind === "platform-admin" || state.sessionKind === "platform-super-admin")
  ) {
    return "platformDashboard";
  }
  if (state.sessionDomain === "enterprise" && state.sessionKind === "enterprise-admin") {
    return "enterpriseOverview";
  }
  if (state.sessionDomain === "employee" && state.sessionKind === "member") {
    return "me";
  }
  return null;
}

export function isControlledLoginPath(
  path: string | null | undefined,
): path is ControlledLoginPath {
  return CONTROLLED_LOGIN_PATHS.some((allowed) => allowed === path);
}

/**
 * Success copy written by `overview.platformAuth.notice.login` (and the
 * matching login.success string). Kept as literals so a stale banner can be
 * dropped without depending on the active locale.
 */
const STALE_ENTERPRISE_LOGIN_SUCCESS_NOTICES = new Set([
  "已登录企业工作台。",
  "Signed in to the enterprise workspace.",
]);

export function isStaleEnterpriseLoginSuccessNotice(notice: string | null | undefined): boolean {
  const trimmed = notice?.trim();
  return Boolean(trimmed && STALE_ENTERPRISE_LOGIN_SUCCESS_NOTICES.has(trimmed));
}

export type ControlledLoginDecision =
  | { action: "redirect"; tab: Tab }
  | { action: "continue"; tab: Tab }
  | { action: "stay"; clearStaleSuccessNotice: boolean };

/**
 * Leave `/enterprise/login` or `/platform/login` when the server already
 * confirmed that surface. Root `/` stays with the public-homepage and
 * `?session=` rules in `resolveRootPathRoleTab` — it is a controlled login
 * path, but not this short-circuit.
 *
 * Port chrome (`activePort`, the 「企」 monogram) is not an input. Landing
 * follows `landTabForConfirmedSession`, with `*Authenticated` as a fallback
 * when `sessionDomain` was not echoed on an otherwise confirmed session.
 *
 * `continue` is only for a confirmed session whose land tab the permission
 * gate would bounce. Callers should show 「进入企业工作台」 instead of
 * auto-navigating into that bounce.
 */
export function decideControlledLogin(input: {
  path: string | null | undefined;
  auth: Pick<ControlUiPlatformAuthState, "sessionDomain" | "sessionKind"> | null | undefined;
  enterpriseAuthenticated: boolean;
  platformAuthenticated: boolean;
  notice?: string | null;
  landReachable?: (tab: Tab) => boolean;
}): ControlledLoginDecision {
  const desired = desiredLandTabForControlledLogin(input);
  if (!desired) {
    return {
      action: "stay",
      clearStaleSuccessNotice:
        input.path === "/enterprise/login" &&
        !input.enterpriseAuthenticated &&
        isStaleEnterpriseLoginSuccessNotice(input.notice),
    };
  }
  const reachable = input.landReachable ? input.landReachable(desired) : true;
  if (!reachable) {
    return { action: "continue", tab: desired };
  }
  return { action: "redirect", tab: desired };
}

function desiredLandTabForControlledLogin(input: {
  path: string | null | undefined;
  auth: Pick<ControlUiPlatformAuthState, "sessionDomain" | "sessionKind"> | null | undefined;
  enterpriseAuthenticated: boolean;
  platformAuthenticated: boolean;
}): Tab | null {
  if (!isControlledLoginPath(input.path) || input.path === "/") {
    return null;
  }
  const confirmed = landTabForConfirmedSession(input.auth);
  if (input.path === "/enterprise/login") {
    if (confirmed === "enterpriseOverview" || input.enterpriseAuthenticated) {
      return "enterpriseOverview";
    }
    return null;
  }
  if (confirmed === "platformDashboard" || input.platformAuthenticated) {
    return "platformDashboard";
  }
  return null;
}
