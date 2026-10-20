/**
 * Employee provisioning + activation route handlers for platform auth.
 *
 * Handles enterprise-admin member removal, employee seat provisioning, and
 * (re)sending employee activation emails, plus the shared provisioning helpers.
 * Extracted from the platform-auth monolith (decomposition Task 5.13). Behavior
 * preserved verbatim. Employee self-registration and seat-offer accept/decline
 * live in ./routes-employee-register.ts.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import type { ControlUiEmailDeliverySummary } from "../control-ui-contract.js";
import { resolveInvitePositionId } from "../employee-position-bots.js";
import {
  ensureSeatForProvision,
  recordEnterpriseAssetAuditEvent,
  revokeConnectorCredentialBindings,
  saveEnterpriseSeatAssetsStore,
  startSeatHandoverForEmployee,
} from "../enterprise-seat-assets-store.js";
import { sendJson } from "../http-common.js";
import {
  applyPlatformAuthEmailDeliveryResult,
  deliverPlatformAuthEmailNotification,
  type PlatformAuthEmailDeliveryResult,
} from "../platform-auth-email.js";
import {
  hasPendingAdminProvision,
  hasPendingEmployeeProvision,
  resolveSessionContext,
  sendPlatformAuthSuccess,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import {
  buildEmployeeActivationUrl,
  hasRecentlySentEmployeeActivationEmail,
} from "./employee-activation-url.js";
import { resolveEmployeeInviteEmailAvailability } from "./employee-invite-email.js";
import { applyEnterpriseMemberOffboard } from "./member-offboard.js";
import { findUserByEmail, resolveMembershipSelectionForUser } from "./memberships.js";
import {
  isValidEmail,
  normalizeBoolean,
  normalizeDisplayName,
  normalizeEmail,
} from "./request-helpers.js";
import {
  loadSeatAssetsStoreForTenantId,
  resolveSeatAssetsStorePathForTenantId,
} from "./seat-store-loader.js";
import {
  readPlatformAuthSessionContextFromRequest,
  resolveEnterpriseAdminSessionContext,
} from "./session-context.js";
import type { PlatformAuthEmployeeProvision, PlatformAuthStore } from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import { buildPendingCode, findLatestActiveCode, issueActivationCode } from "./token-operations.js";

export {
  buildEmployeeActivationUrl,
  resolveEmployeeActivationOrigin,
} from "./employee-activation-url.js";

/**
 * Bind an invite to an existing position. `seatId` is required. A title does
 * not create or select the position; the console creates the vacant seat first.
 */
export async function createEmployeeProvisionWithSeat(params: {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  enterpriseId: string;
  employeeName: string;
  employeeEmail: string;
  createdByUserId: string;
  seatId: string;
  auditId?: string;
}): Promise<{
  seatId: string;
  seatTitle: string;
  teamLabel: string | null;
  responsibility: string | null;
  provision: PlatformAuthEmployeeProvision;
  plainCode: string;
  expiresAt: string;
}> {
  const seatId = params.seatId.trim();
  if (!seatId) {
    throw new Error("Position id is required.");
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const seatStorePath = resolveSeatAssetsStorePathForTenantId(params.enterpriseId);
  const seatStore = await loadSeatAssetsStoreForTenantId(params.enterpriseId);
  const seat = ensureSeatForProvision({
    store: seatStore,
    tenantId: params.enterpriseId,
    seatId,
    reuseByTitle: false,
    nowIso,
  });
  seat.status = "assigned";
  seat.updatedAt = nowIso;
  await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);
  const provision: PlatformAuthEmployeeProvision = {
    id: randomUUID(),
    assignmentId: randomUUID(),
    assignmentType: "new_hire",
    enterpriseId: params.enterpriseId,
    seatId: seat.seatId,
    employeeName: params.employeeName,
    employeeEmail: params.employeeEmail,
    normalizedEmployeeEmail: normalizeEmail(params.employeeEmail),
    status: "pending_activation",
    createdByUserId: params.createdByUserId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  params.store.employeeProvisions[provision.id] = provision;
  recordEnterpriseAssetAuditEvent({
    store: seatStore,
    tenantId: params.enterpriseId,
    eventType: "assignment.created",
    nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.createdByUserId,
    seatId: seat.seatId,
    metadata: {
      assignmentId: provision.assignmentId ?? provision.id,
      assignmentType: provision.assignmentType ?? "new_hire",
      targetEmail: params.employeeEmail,
    },
  });
  await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);
  const expiresAt = new Date(now + params.config.activationTtlHours * 60 * 60 * 1000).toISOString();
  const { plainCode } = issueActivationCode({
    store: params.store,
    enterpriseId: params.enterpriseId,
    provisionId: provision.id,
    email: params.employeeEmail,
    issuedByUserId: params.createdByUserId,
    codeType: "employeeActivation",
    expiresAt,
  });
  return {
    seatId: seat.seatId,
    seatTitle: seat.title,
    teamLabel: seat.teamLabel ?? null,
    responsibility: seat.responsibility ?? null,
    provision,
    plainCode,
    expiresAt,
  };
}

export async function handleMemberRemoveRoute(
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
  const context = resolveEnterpriseAdminSessionContext({ store, context: sessionContext });
  if (!context || !context.membership) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_FORBIDDEN",
      error: "Only enterprise administrators can remove members.",
    });
    return true;
  }
  const targetEmail = normalizeEmail(body.user);
  if (!isValidEmail(targetEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid email address.",
    });
    return true;
  }
  if (targetEmail === context.user.normalizedEmail) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_SELF_REMOVE",
      error: "Use sign out instead of removing your own account.",
    });
    return true;
  }
  const targetUser = findUserByEmail(store, targetEmail);
  if (!targetUser) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_NOT_FOUND",
      error: "That member could not be found.",
    });
    return true;
  }
  const membership = resolveMembershipSelectionForUser({
    store,
    userId: targetUser.id,
    enterpriseId: context.membership.enterpriseId,
  });
  if (!membership) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_NOT_FOUND",
      error: "That member could not be found.",
    });
    return true;
  }
  if (membership.membershipRole === "enterprise-admin") {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_ADMIN_PROTECTED",
      error: "Enterprise administrators cannot be removed from this panel.",
    });
    return true;
  }
  if (targetUser.status === "suspended") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_MEMBER_ALREADY_OFFBOARDED",
      error: "That member has already been offboarded.",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  const auditId = randomUUID();
  applyEnterpriseMemberOffboard({
    store,
    user: targetUser,
    membership,
    nowIso,
  });
  const seatStorePath = resolveSeatAssetsStorePathForTenantId(membership.enterpriseId);
  const seatStore = await loadSeatAssetsStoreForTenantId(membership.enterpriseId);
  startSeatHandoverForEmployee({
    store: seatStore,
    tenantId: membership.enterpriseId,
    employeeId: targetUser.id,
    nowIso,
    actorEmployeeId: context.user.id,
    auditId,
  });
  revokeConnectorCredentialBindings({
    store: seatStore,
    tenantId: membership.enterpriseId,
    ownerType: "employee",
    ownerId: targetUser.id,
    nowIso,
    actorEmployeeId: context.user.id,
    auditId,
    reason: "offboarded",
  });
  await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);
  await saveStore(config, store);
  const refreshedContext = resolveSessionContext(
    store,
    context.user,
    "enterprise-admin",
    context.membership,
  );
  if (!refreshedContext) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_INVALID",
      error: "Your session is no longer active. Please sign in again.",
    });
    return true;
  }
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context: refreshedContext,
    session: refreshedContext.session,
  });
  return true;
}

export async function handleEmployeeProvisionRoute(
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
  if (!context || !context.membership) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_EMPLOYEE_PROVISION_FORBIDDEN",
      error: "Only enterprise administrators can issue employee activations.",
    });
    return true;
  }
  const employeeEmail = normalizeEmail(body.email ?? body.employeeEmail);
  const employeeName = normalizeDisplayName(body.displayName ?? body.employeeName, employeeEmail);
  const invitedPosition = resolveInvitePositionId(body);
  const sendActivationEmail =
    body.sendActivationEmail === undefined ? true : normalizeBoolean(body.sendActivationEmail);
  if (!isValidEmail(employeeEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid employee email address.",
    });
    return true;
  }
  if (!invitedPosition.ok) {
    sendJson(res, 400, {
      ok: false,
      code: invitedPosition.code,
      error: invitedPosition.error,
    });
    return true;
  }
  const emailAvailability = resolveEmployeeInviteEmailAvailability({
    store,
    email: employeeEmail,
    enterpriseId: context.membership.enterpriseId,
  });
  if (emailAvailability.status === "already-member") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_ALREADY_ENTERPRISE_MEMBER",
      error: "该邮箱已是本企业员工，无法重复邀请。",
    });
    return true;
  }
  if (
    hasPendingAdminProvision(store, employeeEmail, context.membership.enterpriseId) ||
    hasPendingEmployeeProvision(store, employeeEmail, context.membership.enterpriseId)
  ) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
      error: "That employee already has a pending activation.",
    });
    return true;
  }
  let createdProvision: Awaited<ReturnType<typeof createEmployeeProvisionWithSeat>> | undefined;
  try {
    createdProvision = await createEmployeeProvisionWithSeat({
      config,
      store,
      enterpriseId: context.membership.enterpriseId,
      employeeName,
      employeeEmail,
      createdByUserId: context.user.id,
      seatId: invitedPosition.positionId,
      auditId: randomUUID(),
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_SEAT_PROVISION_FAILED",
      error: error instanceof Error ? error.message : "Seat provisioning failed.",
    });
    return true;
  }
  const {
    plainCode,
    expiresAt,
    seatTitle: resolvedSeatTitle,
    teamLabel: resolvedTeamLabel,
    responsibility: resolvedResponsibility,
  } = createdProvision;
  let emailDelivery: PlatformAuthEmailDeliveryResult | undefined;
  if (sendActivationEmail) {
    const recentlySent = hasRecentlySentEmployeeActivationEmail({
      store,
      email: employeeEmail,
      enterpriseId: context.membership.enterpriseId,
    });
    if (!recentlySent) {
      const notification = enqueuePlatformAuthNotification({
        store,
        type: "employee-activation-email",
        email: employeeEmail,
        enterpriseId: context.membership.enterpriseId,
        payload: {
          assignmentId: createdProvision.provision.assignmentId,
          enterpriseName: context.enterprise?.name ?? context.membership.enterpriseId,
          employeeName,
          employeeEmail,
          seatTitle: resolvedSeatTitle,
          ...(resolvedTeamLabel ? { teamLabel: resolvedTeamLabel } : {}),
          ...(resolvedResponsibility ? { responsibility: resolvedResponsibility } : {}),
          code: plainCode,
          expiresAt,
          activationUrl: buildEmployeeActivationUrl({
            req,
            basePath,
            code: plainCode,
            email: employeeEmail,
            employeeName,
          }),
          issuedByEmail: context.user.email,
          issuedByDisplayName: context.user.displayName,
        },
        createdAt: new Date().toISOString(),
      });
      // Persist the pending seat + queued notice before SMTP so a timed-out
      // retry hits PENDING_ACTIVATION_EXISTS instead of sending a second copy.
      await saveStore(config, store);
      emailDelivery = await deliverPlatformAuthEmailNotification(notification);
      applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, new Date().toISOString());
    }
  }
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    status: 201,
    config,
    store,
    context,
    session: context.session,
    ...(emailDelivery ? { emailDelivery } : {}),
    pendingActivation: buildPendingCode({
      assignmentId: createdProvision.provision.assignmentId,
      kind: "employee-activation",
      email: employeeEmail,
      enterpriseName: context.enterprise?.name,
      code: plainCode,
      expiresAt,
    }),
  });
  return true;
}

export async function handleEmployeeActivationSendRoute(
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
  if (!context || !context.membership) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_EMPLOYEE_ACTIVATION_FORBIDDEN",
      error: "Only enterprise administrators can send employee activations.",
    });
    return true;
  }
  const requestedEmails = Array.isArray(body.emails)
    ? [
        ...new Set(
          body.emails.map((entry) => normalizeEmail(entry)).filter((entry) => isValidEmail(entry)),
        ),
      ]
    : [];
  const requestedEmailSet = new Set(requestedEmails);
  const enterpriseId = context.membership.enterpriseId;
  const pendingProvisions = Object.values(store.employeeProvisions).filter((provision) => {
    if (provision.enterpriseId !== enterpriseId || provision.status !== "pending_activation") {
      return false;
    }
    return (
      requestedEmailSet.size === 0 ||
      requestedEmailSet.has(provision.normalizedEmployeeEmail) ||
      requestedEmailSet.has(normalizeEmail(provision.employeeEmail))
    );
  });
  if (pendingProvisions.length === 0) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_EMPLOYEE_ACTIVATION_NOT_FOUND",
      error: "No pending employee activations were found.",
    });
    return true;
  }
  const seatStorePath = resolveSeatAssetsStorePathForTenantId(enterpriseId);
  const seatStore = await loadSeatAssetsStoreForTenantId(enterpriseId);
  const activationDelivery: ControlUiEmailDeliverySummary = {
    total: pendingProvisions.length,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped:
      requestedEmailSet.size > 0
        ? Math.max(0, requestedEmailSet.size - pendingProvisions.length)
        : 0,
  };
  for (const provision of pendingProvisions) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + config.activationTtlHours * 60 * 60 * 1000).toISOString();
    const previousActivation = findLatestActiveCode({
      store,
      provisionId: provision.id,
      email: provision.employeeEmail,
      codeType: "employeeActivation",
    });
    if (
      hasRecentlySentEmployeeActivationEmail({
        store,
        email: provision.employeeEmail,
        enterpriseId,
      })
    ) {
      activationDelivery.skipped += 1;
      continue;
    }
    const { plainCode } = issueActivationCode({
      store,
      enterpriseId,
      provisionId: provision.id,
      email: provision.employeeEmail,
      issuedByUserId: context.user.id,
      codeType: "employeeActivation",
      expiresAt,
      replaces: previousActivation,
    });
    const seat = seatStore.seats[provision.seatId];
    const notification = enqueuePlatformAuthNotification({
      store,
      type: "employee-activation-email",
      email: provision.employeeEmail,
      enterpriseId,
      payload: {
        assignmentId: provision.assignmentId ?? provision.id,
        enterpriseName: context.enterprise?.name ?? enterpriseId,
        employeeName: provision.employeeName,
        employeeEmail: provision.employeeEmail,
        seatTitle: seat?.title ?? provision.seatId,
        ...(seat?.teamLabel ? { teamLabel: seat.teamLabel } : {}),
        ...(seat?.responsibility ? { responsibility: seat.responsibility } : {}),
        code: plainCode,
        expiresAt,
        activationUrl: buildEmployeeActivationUrl({
          req,
          basePath,
          code: plainCode,
          email: provision.employeeEmail,
          employeeName: provision.employeeName,
        }),
        issuedByEmail: context.user.email,
        issuedByDisplayName: context.user.displayName,
      },
      createdAt: nowIso,
    });
    if (!plainCode.trim()) {
      activationDelivery.failed += 1;
      continue;
    }
    const emailDelivery = await deliverPlatformAuthEmailNotification(notification);
    applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, new Date().toISOString());
    recordEnterpriseAssetAuditEvent({
      store: seatStore,
      tenantId: enterpriseId,
      eventType: "assignment.reminded",
      nowIso,
      auditId: randomUUID(),
      actorEmployeeId: context.user.id,
      seatId: provision.seatId,
      metadata: {
        assignmentId: provision.assignmentId ?? provision.id,
        assignmentType: provision.assignmentType ?? "new_hire",
        targetEmail: provision.employeeEmail,
      },
    });
    if (emailDelivery.status === "sent") {
      activationDelivery.sent += 1;
    } else if (emailDelivery.status === "failed") {
      activationDelivery.failed += 1;
      if (emailDelivery.error?.trim()) {
        activationDelivery.errors = [
          ...(activationDelivery.errors ?? []),
          emailDelivery.error.trim(),
        ].slice(0, 3);
      }
    } else {
      activationDelivery.queued += 1;
      if (!activationDelivery.queuedReason && emailDelivery.reason) {
        activationDelivery.queuedReason = emailDelivery.reason;
      }
    }
  }
  await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context,
    session: context.session,
    activationDelivery,
  });
  return true;
}
