/**
 * Enterprise-side co-admin invite (「邀请管理员」 from the employee directory).
 *
 * An enterprise administrator picks an existing, active tenant employee
 * (`member` membership) and sends an admin invite email. The invitee accepts by
 * signing in through the enterprise (biz) entry with their EXISTING employee
 * password — the password is never changed. Accepting adds a second
 * `enterprise-admin` membership next to the existing `member` membership, so the
 * same email holds dual identity and the login channel picks the role
 * (see `listEligibleMembershipsForUser` in ./memberships.ts).
 *
 * This is intentionally separate from the platform-console
 * `admin-activation-email` / `createPendingAdminActivationForEnterprise` flow,
 * which provisions a brand-new admin account that sets its own password.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { sendJson } from "../http-common.js";
import {
  applyPlatformAuthEmailDeliveryResult,
  deliverPlatformAuthEmailNotification,
} from "../platform-auth-email.js";
import { sendPlatformAuthSuccess } from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import {
  acceptEnterpriseCoAdminInvite,
  ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE,
  ENTERPRISE_CO_ADMIN_INVITE_QUERY_PARAM,
  findActiveEnterpriseCoAdminInvite,
  findEnterpriseMembershipForRole,
} from "./enterprise-co-admin-invite.js";
import { findUserByEmail } from "./memberships.js";
import {
  isValidEmail,
  normalizeBoolean,
  normalizeEmail,
  requiredString,
} from "./request-helpers.js";
import { resolveEnterpriseAdminActivationOrigin } from "./routes-enterprise.js";
import {
  readPlatformAuthSessionContextFromRequest,
  resolveEnterpriseAdminSessionContext,
} from "./session-context.js";
import { loadStore, saveStore } from "./store.js";
import { issueActivationCode } from "./token-operations.js";

export {
  acceptEnterpriseCoAdminInvite,
  ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE,
  ENTERPRISE_CO_ADMIN_INVITE_QUERY_PARAM,
} from "./enterprise-co-admin-invite.js";

/**
 * Deep link into the enterprise (biz) login form. The invitee signs in with the
 * existing employee password; the login route consumes `adminInvite`.
 */
export function buildEnterpriseCoAdminInviteUrl(params: {
  req: IncomingMessage;
  basePath?: string;
  code: string;
  email: string;
}): string {
  const normalizedBase = params.basePath?.trim().replace(/\/+$/, "") ?? "";
  const url = new URL(
    `${normalizedBase || ""}/enterprise/login`,
    resolveEnterpriseAdminActivationOrigin(params.req),
  );
  url.searchParams.set("authMode", "login");
  url.searchParams.set(ENTERPRISE_CO_ADMIN_INVITE_QUERY_PARAM, params.code);
  url.searchParams.set("email", params.email);
  url.hash = "auth";
  return url.toString();
}

/**
 * POST /enterprise/admin/invite — enterprise admin invites an existing active
 * employee (by email) to also become an enterprise administrator.
 * Body: `{ user | email, resend?: boolean }`.
 */
export async function handleEnterpriseCoAdminInviteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
  basePath: string,
): Promise<boolean> {
  const store = await loadStore(config);
  const sessionContext = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  const context = resolveEnterpriseAdminSessionContext({ store, context: sessionContext });
  if (!context || !context.membership || !context.enterprise) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_INVITE_FORBIDDEN",
      error: "Only enterprise administrators can invite administrators.",
    });
    return true;
  }
  const enterpriseId = context.membership.enterpriseId;
  const targetEmail = normalizeEmail(body.user ?? body.email);
  if (!isValidEmail(targetEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
    });
    return true;
  }
  const targetUser = findUserByEmail(store, targetEmail);
  const memberMembership = targetUser
    ? findEnterpriseMembershipForRole(store, targetUser.id, enterpriseId, "member")
    : undefined;
  const adminMembership = targetUser
    ? findEnterpriseMembershipForRole(store, targetUser.id, enterpriseId, "enterprise-admin")
    : undefined;
  if (!targetUser || (!memberMembership && !adminMembership)) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_NOT_FOUND",
      error: "该邮箱不是本企业员工，请先在员工名录中完成员工激活。",
    });
    return true;
  }
  if (adminMembership) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_ALREADY_ENTERPRISE_ADMIN",
      error: "该员工已是本企业管理员。",
    });
    return true;
  }
  if (targetUser.status !== "active") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_INACTIVE",
      error: "该员工账号已停用，无法邀请为管理员。",
    });
    return true;
  }
  const resend = normalizeBoolean(body.resend);
  const pending = findActiveEnterpriseCoAdminInvite({
    store,
    enterpriseId,
    userId: targetUser.id,
  });
  if (pending && !resend) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_INVITE_PENDING",
      error: "已向该员工发送过管理员邀请，等待对方接受。",
      expiresAt: pending.expiresAt,
    });
    return true;
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + config.activationTtlHours * 60 * 60 * 1000).toISOString();
  const { plainCode } = issueActivationCode({
    store,
    enterpriseId,
    userId: targetUser.id,
    email: targetUser.email,
    issuedByUserId: context.user.id,
    codeType: ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE,
    expiresAt,
    replaces: pending ?? null,
  });
  const inviteUrl = buildEnterpriseCoAdminInviteUrl({
    req,
    basePath,
    code: plainCode,
    email: targetUser.email,
  });
  const notification = enqueuePlatformAuthNotification({
    store,
    type: "enterprise-co-admin-invite-email",
    email: targetUser.email,
    enterpriseId,
    payload: {
      enterpriseName: context.enterprise.name,
      inviteeName: targetUser.displayName,
      inviteeEmail: targetUser.email,
      inviteUrl,
      expiresAt,
      issuedByEmail: context.user.email,
      issuedByDisplayName: context.user.displayName,
    },
    createdAt: nowIso,
  });
  // Persist the invite before SMTP so a timed-out retry sees PENDING instead of
  // silently minting a second link.
  await saveStore(config, store);
  const emailDelivery = await deliverPlatformAuthEmailNotification(notification);
  applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, new Date().toISOString());
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    status: 201,
    config,
    store,
    context,
    session: context.session,
    emailDelivery,
  });
  return true;
}

/**
 * POST /enterprise/admin/invite/accept — accept with an already signed-in
 * session of the invited employee (e.g. from the employee console). Grants the
 * admin membership without changing the current session or password; the user
 * then signs in through the enterprise entry to act as admin.
 * Body: `{ code }`.
 */
export async function handleEnterpriseCoAdminInviteAcceptRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  const store = await loadStore(config);
  const sessionContext = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  const sessionUser = sessionContext?.user ? store.users[sessionContext.user.id] : undefined;
  if (!sessionContext || !sessionUser || sessionUser.status !== "active") {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in with the invited employee account to accept this invite.",
    });
    return true;
  }
  const result = acceptEnterpriseCoAdminInvite({
    store,
    user: sessionUser,
    code: requiredString(body.code ?? body.adminInvite),
  });
  if (!result.ok) {
    sendJson(res, result.status, { ok: false, code: result.code, error: result.error });
    return true;
  }
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context: sessionContext,
    session: sessionContext.session,
  });
  return true;
}
