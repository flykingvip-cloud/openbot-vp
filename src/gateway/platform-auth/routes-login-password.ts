/**
 * Login + password (forgot/reset/change) + platform bootstrap route handlers.
 *
 * Sibling of ./routes-auth.ts (which keeps the smaller session/logout/listing
 * handlers). Extracted from the platform-auth monolith (decomposition Task 5.13).
 * Behavior preserved verbatim.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import type { ControlUiPlatformPendingCode } from "../control-ui-contract.js";
import { buildEmployeeAccessSnapshot } from "../enterprise-seat-assets-store.js";
import { appendEnterpriseAuditEvent } from "../enterprise-security/audit-log.js";
import { resolveClientIpFromRequest } from "../enterprise-security/client-ip.js";
import { isEnterpriseCallerIpAllowed } from "../enterprise-security/session-enforcement.js";
import { sendJson } from "../http-common.js";
import {
  applyPlatformAuthEmailDeliveryResult,
  deliverPlatformAuthEmailNotification,
  type PlatformAuthEmailDeliveryResult,
} from "../platform-auth-email.js";
import { stringValue } from "../records.js";
import {
  clearFailedLoginState,
  createSessionAndReply,
  DEFAULT_PLATFORM_AUTH_SCOPES,
  hashPassword,
  hasAnyPlatformAdmins,
  isUserLocked,
  platformRoleSatisfiesExpected,
  recordFailedLogin,
  refreshEnterpriseStatuses,
  resolveEffectiveMfaPolicy,
  resolvePlatformRole,
  resolveSessionContext,
  sendPlatformAuthSuccess,
  verifyPassword,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import { acceptEnterpriseCoAdminInvite } from "./enterprise-co-admin-invite.js";
import {
  emitPlatformLoginAuditEvent,
  generateRequestId,
  type PlatformLoginAuditEvent,
  type PlatformLoginOutcome,
} from "./login-audit.js";
import { findUserByEmail, listMembershipsByUserId } from "./memberships.js";
import {
  activateMfaEnrollment,
  consumeRecoveryCode,
  enrollMfa,
  getMfaEnrollmentState,
  verifyMfaCode,
} from "./mfa-store.js";
import {
  assertStrongPassword,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  requiredString,
} from "./request-helpers.js";
import { loadSeatAssetsStoreForTenantId } from "./seat-store-loader.js";
import { readPlatformAuthSessionContextFromRequest } from "./session-context.js";
import { deriveSessionDomain } from "./session-domain.js";
import type { PlatformAuthUser } from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import {
  assertTargetMatchesRequest,
  buildPasswordResetLink,
  employeePositionLoginBlock,
  evaluateEmployeePosition,
  hintFromIncomingMessage,
  LOGIN_PATH_BY_SURFACE,
  loginUrlForSurface,
  passwordResetReturn,
  resolveLoginTarget,
  resolveRequestSessionSurface,
  selectSurfaceMembership,
} from "./target-surface.js";
import {
  buildPendingCode,
  findLatestActiveCode,
  invalidateUserSessions,
  issueActivationCode,
  normalizeActivationStatus,
  verifyOpaqueCode,
} from "./token-operations.js";

function requestProto(req: IncomingMessage): "http:" | "https:" {
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  if (
    typeof forwardedProto === "string" &&
    forwardedProto.trim().toLowerCase().startsWith("http")
  ) {
    return forwardedProto.trim().toLowerCase().startsWith("https") ? "https:" : "http:";
  }
  return (req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https:" : "http:";
}

function buildPasswordResetUrl(params: { req: IncomingMessage; code: string }): string {
  return buildPasswordResetLink({
    hint: hintFromIncomingMessage(params.req),
    code: params.code,
    proto: requestProto(params.req),
  }).href;
}

async function employeePositionError(params: {
  userId: string;
  enterpriseId: string;
}): Promise<{ status: number; code: string; error: string } | null> {
  let tenantSeatCount = 0;
  let hasCurrentSeat = false;
  try {
    const seatStore = await loadSeatAssetsStoreForTenantId(params.enterpriseId);
    tenantSeatCount = Object.values(seatStore.seats).filter(
      (seat) => seat.tenantId === params.enterpriseId,
    ).length;
    hasCurrentSeat = Boolean(
      buildEmployeeAccessSnapshot({
        store: seatStore,
        tenantId: params.enterpriseId,
        employeeId: params.userId,
      }).currentSeat,
    );
  } catch {
    return {
      status: 409,
      code: "PLATFORM_AUTH_POSITION_UNVERIFIED",
      error: "Employee position could not be verified.",
    };
  }
  return employeePositionLoginBlock(evaluateEmployeePosition({ tenantSeatCount, hasCurrentSeat }));
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function sessionIntentForKind(
  sessionKind: "platform-super-admin" | "platform-admin" | "enterprise-admin" | "member",
): "default" | "enterprise-admin" | "employee" {
  if (sessionKind === "enterprise-admin") {
    return "enterprise-admin";
  }
  if (sessionKind === "member") {
    return "employee";
  }
  return "default";
}

export async function handleLoginRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode.trim() : "";
  const expectedPlatformRole =
    body.expectedPlatformRole === "super-admin" || body.expectedPlatformRole === "admin"
      ? body.expectedPlatformRole
      : null;
  // Enterprise co-admin invite accepted at sign-in: the employee proves the
  // account with the EXISTING password (never changed) and the invite code adds
  // the `enterprise-admin` membership next to `member` (dual identity).
  const adminInviteCode =
    typeof body.adminInviteCode === "string" ? body.adminInviteCode.trim() : "";

  // Request correlation + audit scaffolding (Requirements 6.1, 6.6).
  const requestId = generateRequestId();
  const ip = resolveClientIpFromRequest(req);
  const userAgentHeader = req.headers["user-agent"];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
  res.setHeader("X-Request-Id", requestId);
  let audited = false;
  const audit = async (
    outcome: PlatformLoginOutcome,
    extra: Partial<PlatformLoginAuditEvent> = {},
  ): Promise<void> => {
    if (audited) {
      return;
    }
    audited = true;
    await emitPlatformLoginAuditEvent({
      ts: new Date().toISOString(),
      requestId,
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
      email,
      outcome,
      expectedRole: expectedPlatformRole,
      ...extra,
    });
  };

  if (!isValidEmail(email)) {
    await audit("invalid_credentials");
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
      requestId,
    });
    return true;
  }

  const store = await loadStore(config);
  const user = findUserByEmail(store, email);

  if (!user) {
    await audit("invalid_credentials");
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_CREDENTIALS",
      error: "Email or password is incorrect.",
      requestId,
    });
    return true;
  }

  if (isUserLocked(user)) {
    await audit("account_locked");
    sendJson(res, 423, {
      ok: false,
      code: "PLATFORM_AUTH_ACCOUNT_LOCKED",
      error: "Too many failed attempts. Try again later.",
      lockedUntil: user.lockedUntil,
      requestId,
    });
    return true;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    recordFailedLogin(user);
    await saveStore(config, store);
    await audit("invalid_credentials");
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_CREDENTIALS",
      error: "Email or password is incorrect.",
      requestId,
    });
    return true;
  }

  if (user.status !== "active") {
    await audit("account_suspended");
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_USER_SUSPENDED",
      error: "This account is not active.",
      requestId,
    });
    return true;
  }

  const targetResult = resolveLoginTarget({
    sessionDomain: body.sessionDomain,
    loginIntent: body.loginIntent,
    expectedSessionKind: body.expectedSessionKind,
    expectedPlatformRole: body.expectedPlatformRole,
    adminInviteCode,
  });
  if (!targetResult.ok) {
    await audit("role_mismatch");
    sendJson(res, targetResult.status, {
      ok: false,
      code: targetResult.code,
      error: targetResult.error,
      requestId,
    });
    return true;
  }
  const surfaceAgreement = assertTargetMatchesRequest(
    hintFromIncomingMessage(req),
    targetResult.target.surface,
  );
  if (!surfaceAgreement.ok) {
    // Host and body name different portals. biz.openbot.love + sessionDomain
    // "employee" (the public card after an enterprise logout) is rejected here.
    // Point the client at the portal for the login it already attempted.
    await audit("role_mismatch");
    const targetSurface = surfaceAgreement.targetSurface;
    sendJson(res, surfaceAgreement.status, {
      ok: false,
      code: surfaceAgreement.code,
      error: surfaceAgreement.error,
      requestSurface: surfaceAgreement.requestSurface,
      targetSurface,
      loginPath: LOGIN_PATH_BY_SURFACE[targetSurface],
      loginUrl: loginUrlForSurface(targetSurface),
      requestId,
    });
    return true;
  }
  const platformRole = resolvePlatformRole(user);
  // Omitted target is the employee entry. A platform-only account must not
  // receive a platform session on that entry.
  if (
    !targetResult.target.explicit &&
    platformRole !== null &&
    listMembershipsByUserId(store, user.id).length === 0
  ) {
    await audit("role_mismatch");
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SURFACE_INELIGIBLE",
      error: "This account cannot enter the employee surface.",
      requestId,
    });
    return true;
  }
  if (targetResult.target.surface === "platform") {
    const expectedRole = targetResult.target.expectedPlatformRole;
    const roleOk = expectedRole
      ? platformRoleSatisfiesExpected(platformRole, expectedRole)
      : platformRole !== null;
    if (!roleOk) {
      await audit("role_mismatch");
      sendJson(res, 403, {
        ok: false,
        code: "PLATFORM_AUTH_ROLE_MISMATCH",
        error:
          expectedRole === "super-admin"
            ? "This account is not a super administrator."
            : "This account is not a platform administrator.",
        requestId,
      });
      return true;
    }
  }

  let adminInviteMembershipId: string | undefined;
  let adminInviteEnterpriseId: string | undefined;
  if (adminInviteCode && targetResult.target.surface === "enterprise") {
    const accepted = acceptEnterpriseCoAdminInvite({
      store,
      user,
      code: adminInviteCode,
    });
    if (!accepted.ok) {
      await audit("role_mismatch");
      sendJson(res, accepted.status, {
        ok: false,
        code: accepted.code,
        error: accepted.error,
        requestId,
      });
      return true;
    }
    adminInviteMembershipId = accepted.membership.id;
    adminInviteEnterpriseId = accepted.membership.enterpriseId;
  }

  const isPlatformLoginIntent = targetResult.target.surface === "platform";
  // MFA follows the request host, not only the body. www.openbot.love,
  // openbot.love, and biz.openbot.love are employee and enterprise entries.
  // A platform target on those hosts is already a surface mismatch. An
  // ambiguous local caller can still complete a platform login, which is how
  // admin.openbot.love and /platform/login keep the authenticator gate.
  const requestSurface = resolveRequestSessionSurface(hintFromIncomingMessage(req));
  const platformMfaSurface =
    requestSurface.kind === "ambiguous" || requestSurface.surface === "platform";
  const membershipId = adminInviteMembershipId ?? optionalString(body.membershipId);
  const tenantId = adminInviteEnterpriseId ?? optionalString(body.tenantId);
  const selectedMembership =
    targetResult.target.surface === "platform"
      ? undefined
      : selectSurfaceMembership({
          store,
          userId: user.id,
          surface: targetResult.target.surface,
          membershipId,
          enterpriseId: tenantId,
        });
  if (selectedMembership && !selectedMembership.ok) {
    await audit("role_mismatch");
    sendJson(res, selectedMembership.status, {
      ok: false,
      code: selectedMembership.code,
      error: selectedMembership.error,
      ...(selectedMembership.membershipChoices
        ? { membershipChoices: selectedMembership.membershipChoices }
        : {}),
      requestId,
    });
    return true;
  }
  if (selectedMembership?.ok && targetResult.target.surface === "employee") {
    const positionError = await employeePositionError({
      userId: user.id,
      enterpriseId: selectedMembership.membership.enterpriseId,
    });
    if (positionError) {
      await audit("role_mismatch");
      sendJson(res, positionError.status, {
        ok: false,
        code: positionError.code,
        error: positionError.error,
        requestId,
      });
      return true;
    }
  }

  // ── MFA gate ───────────────────────────────────────────────────────────────
  // Authenticator codes are required only for the platform login host
  // (admin.openbot.love) or a local /platform path. Employee public home
  // (www.openbot.love and openbot.love) and enterprise login
  // (biz.openbot.love/enterprise/login) succeed without OTP even when the
  // account has enrolled TOTP for the platform console.
  let mfaUsed = false;
  if (isPlatformLoginIntent && platformMfaSurface) {
    const enrollment = await getMfaEnrollmentState(user.id);
    if (enrollment.enabled) {
      if (!mfaCode) {
        await audit("mfa_required");
        sendJson(res, 401, {
          ok: false,
          code: "PLATFORM_AUTH_MFA_REQUIRED",
          error: "Enter your authenticator code to continue.",
          requestId,
        });
        return true;
      }
      const ok =
        (await verifyMfaCode(user.id, mfaCode)) || (await consumeRecoveryCode(user.id, mfaCode));
      if (!ok) {
        recordFailedLogin(user);
        await saveStore(config, store);
        await audit("mfa_invalid");
        sendJson(res, 401, {
          ok: false,
          code: "PLATFORM_AUTH_MFA_INVALID",
          error: "验证码不正确或已过期。",
          requestId,
        });
        return true;
      }
      mfaUsed = true;
    } else if (platformRole !== null) {
      const mfaRequired = resolveEffectiveMfaPolicy(config, store);

      if (mfaCode) {
        const ok = enrollment.pending
          ? await activateMfaEnrollment(user.id, mfaCode)
          : (await verifyMfaCode(user.id, mfaCode)) ||
            (await consumeRecoveryCode(user.id, mfaCode));
        if (!ok) {
          recordFailedLogin(user);
          await saveStore(config, store);
          await audit("mfa_invalid");
          sendJson(res, 401, {
            ok: false,
            code: "PLATFORM_AUTH_MFA_INVALID",
            error: "验证码不正确或已过期。",
            requestId,
          });
          return true;
        }
        mfaUsed = true;
      } else if (mfaRequired) {
        // No code supplied and MFA is required.
        if (!enrollment.enabled) {
          // Not enrolled (or pending) → drive inline enrollment.
          const result = await enrollMfa(user.id, user.email);
          await audit("mfa_required_enroll_first");
          sendJson(res, 412, {
            ok: false,
            code: "PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST",
            error: "Set up two-factor authentication to continue.",
            requestId,
            mfaEnrollment: {
              otpAuthUrl: result.otpAuthUrl,
              recoveryCodes: result.recoveryCodes,
            },
          });
          return true;
        }
        // Enrolled but no code → prompt for OTP.
        await audit("mfa_required");
        sendJson(res, 401, {
          ok: false,
          code: "PLATFORM_AUTH_MFA_REQUIRED",
          error: "Enter your authenticator code to continue.",
          requestId,
        });
        return true;
      }
      // mfaRequired === false and no code → allow without MFA (mfaUsed stays false).
    }
  }

  const nowIso = new Date().toISOString();
  clearFailedLoginState(user, nowIso);
  const sessionIntent =
    targetResult.target.surface === "platform"
      ? "default"
      : targetResult.target.surface === "enterprise"
        ? "enterprise-admin"
        : "employee";
  const context = resolveSessionContext(
    store,
    user,
    sessionIntent,
    selectedMembership?.ok ? selectedMembership.membership : null,
  );
  if (!context) {
    await audit("role_mismatch");
    const choiceResult =
      targetResult.target.surface === "platform"
        ? null
        : selectSurfaceMembership({
            store,
            userId: user.id,
            surface: targetResult.target.surface,
          });
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED",
      error: "Choose an enterprise to continue.",
      ...(choiceResult && !choiceResult.ok && choiceResult.membershipChoices
        ? { membershipChoices: choiceResult.membershipChoices }
        : {}),
      requestId,
    });
    return true;
  }
  if (
    context.enterprise &&
    context.enterprise.status === "trial" &&
    context.enterprise.trialEndsAt
  ) {
    refreshEnterpriseStatuses(store);
  }

  const loginEnterpriseId = context.enterprise?.id?.trim();
  if (loginEnterpriseId) {
    let ipAllowed = false;
    try {
      ipAllowed = await isEnterpriseCallerIpAllowed(loginEnterpriseId, ip);
    } catch {
      ipAllowed = false;
    }
    if (!ipAllowed) {
      await audit("ip_not_allowed", {
        sessionKind: context.sessionKind,
        domain: deriveSessionDomain(context),
        mfaUsed,
      });
      try {
        await appendEnterpriseAuditEvent({
          ts: new Date().toISOString(),
          tenantId: loginEnterpriseId,
          kind: "login_ip_denied",
          actorUserId: user.id,
          summary: "login refused by ip allowlist",
        });
      } catch {
        // The 403 still stands when the tenant audit file cannot be written.
      }
      sendJson(res, 403, {
        ok: false,
        code: "PLATFORM_AUTH_IP_NOT_ALLOWED",
        error: "This network is not on the enterprise allowlist.",
        requestId,
      });
      return true;
    }
    try {
      await appendEnterpriseAuditEvent({
        ts: new Date().toISOString(),
        tenantId: loginEnterpriseId,
        kind: "login_success",
        actorUserId: user.id,
        summary: "login succeeded",
      });
    } catch {
      // Login continues when the tenant audit file cannot be written.
    }
  }
  await audit("success", {
    sessionKind: context.sessionKind,
    domain: deriveSessionDomain(context),
    mfaUsed,
  });
  await createSessionAndReply({
    req,
    res,
    config,
    store,
    context,
    ...(deriveSessionDomain(context) === "platform" ? { mfaVerified: mfaUsed } : {}),
  });
  return true;
}

export async function handlePasswordForgotRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
    });
    return true;
  }
  const user = findUserByEmail(store, email);
  let pendingPasswordReset: ControlUiPlatformPendingCode | undefined;
  let emailDelivery: PlatformAuthEmailDeliveryResult | undefined;
  if (user && user.status === "active") {
    const expiresAt = new Date(
      Date.now() + config.passwordResetTtlMinutes * 60 * 1000,
    ).toISOString();
    const previous = findLatestActiveCode({
      store,
      email,
      userId: user.id,
      codeType: "passwordReset",
    });
    const { plainCode } = issueActivationCode({
      store,
      email,
      userId: user.id,
      codeType: "passwordReset",
      expiresAt,
      replaces: previous ?? null,
    });
    pendingPasswordReset = buildPendingCode({
      kind: "password-reset",
      email,
      code: plainCode,
      expiresAt,
    });
    const notification = enqueuePlatformAuthNotification({
      store,
      type: "password-reset-email",
      email,
      payload: {
        email,
        displayName: user.displayName || email,
        code: plainCode,
        expiresAt,
        resetUrl: buildPasswordResetUrl({
          req,
          code: plainCode,
        }),
      },
      createdAt: new Date().toISOString(),
    });
    emailDelivery = await deliverPlatformAuthEmailNotification(notification);
    applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, new Date().toISOString());
    await saveStore(config, store);
  }
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    pendingPasswordReset,
    ...(emailDelivery ? { emailDelivery } : {}),
  });
  return true;
}

export async function handlePasswordResetRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const code = requiredString(body.code ?? body.inviteCode);
  if (!isValidEmail(email)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
    });
    return true;
  }
  const weakPassword = assertStrongPassword(password);
  if (weakPassword) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_WEAK_PASSWORD",
      error: weakPassword,
    });
    return true;
  }
  const activation = Object.values(store.activationCodes).find(
    (entry) =>
      entry.codeType === "passwordReset" &&
      entry.normalizedEmail === email &&
      normalizeActivationStatus(entry) === "active" &&
      verifyOpaqueCode(code, entry.codeHash),
  );
  if (!activation?.userId) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_CODE_INVALID",
      error: "The reset code is invalid or expired.",
    });
    return true;
  }
  const user = store.users[activation.userId];
  if (!user) {
    sendJson(res, 410, {
      ok: false,
      code: "PLATFORM_AUTH_RESET_STALE",
      error: "This password reset request is no longer available.",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  user.passwordHash = hashPassword(password);
  user.passwordUpdatedAt = nowIso;
  user.updatedAt = nowIso;
  clearFailedLoginState(user, nowIso);
  invalidateUserSessions(store, user.id);
  activation.status = "claimed";
  activation.claimedAt = nowIso;
  activation.claimedByUserId = user.id;
  activation.updatedAt = nowIso;
  await saveStore(config, store);
  // Reset returns the caller to the originating surface login. It does not
  // issue a session from the account's default role.
  const resetReturn = passwordResetReturn({ hint: hintFromIncomingMessage(req) });
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    passwordReset: {
      sessionIssued: false,
      returnSurface: resetReturn.returnSurface,
      loginPath: resetReturn.loginPath,
    },
  });
  return true;
}

export async function handlePasswordChangeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  const store = await loadStore(config);
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  if (!context) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in before changing your password.",
    });
    return true;
  }
  const currentPassword = normalizePassword(body.currentPassword);
  const nextPassword = normalizePassword(body.newPassword ?? body.password);
  if (!verifyPassword(currentPassword, context.user.passwordHash)) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_CREDENTIALS",
      error: "Current password is incorrect.",
    });
    return true;
  }
  const weakPassword = assertStrongPassword(nextPassword);
  if (weakPassword) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_WEAK_PASSWORD",
      error: weakPassword,
    });
    return true;
  }
  const user = store.users[context.user.id];
  if (!user) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in before changing your password.",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  user.passwordHash = hashPassword(nextPassword);
  user.passwordUpdatedAt = nowIso;
  user.updatedAt = nowIso;
  invalidateUserSessions(store, user.id);
  const nextContext = resolveSessionContext(
    store,
    user,
    sessionIntentForKind(context.sessionKind),
    context.membership,
  );
  if (!nextContext) {
    // The original session was valid, but a concurrent membership change must
    // never be replaced with an arbitrary fallback membership.
    await saveStore(config, store);
    await sendPlatformAuthSuccess({
      res,
      config,
      store,
    });
    return true;
  }
  await createSessionAndReply({
    req,
    res,
    config,
    store,
    context: nextContext,
  });
  return true;
}

export async function handlePlatformBootstrapRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  if (hasAnyPlatformAdmins(store)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_BOOTSTRAP_COMPLETED",
      error: "Platform bootstrap has already completed.",
    });
    return true;
  }
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const displayName = normalizeDisplayName(body.displayName, email);
  if (!isValidEmail(email)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
    });
    return true;
  }
  const weakPassword = assertStrongPassword(password);
  if (weakPassword) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_WEAK_PASSWORD",
      error: weakPassword,
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  const user: PlatformAuthUser = {
    id: randomUUID(),
    email,
    normalizedEmail: email,
    displayName,
    passwordHash: hashPassword(password),
    passwordUpdatedAt: nowIso,
    emailVerifiedAt: nowIso,
    loginFailedCount: 0,
    status: "active",
    source: "platform-operator",
    platformAdmin: true,
    platformRole: "super-admin",
    role: "operator",
    scopes: [...DEFAULT_PLATFORM_AUTH_SCOPES],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.users[user.id] = user;
  const context = resolveSessionContext(store, user);
  if (!context) {
    throw new Error("new platform bootstrap user must resolve to a platform session");
  }
  await createSessionAndReply({
    req,
    res,
    config,
    store,
    context,
    status: 201,
  });
  return true;
}
