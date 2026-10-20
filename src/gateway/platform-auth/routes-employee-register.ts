/**
 * Employee self-registration and seat-assignment-offer route handlers.
 *
 * Handles employee account activation (claiming an activation code + seat) and
 * the accept/decline flows for seat-assignment offers. Extracted from the
 * platform-auth monolith (decomposition Task 5.13). Behavior preserved verbatim.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { ensureTrialCommercialAccess } from "../billing/ensure-trial-commercial-access.js";
import { bindInvitedEmployeeToPosition } from "../employee-position-bots.js";
import {
  acceptSeatAssignmentOffer,
  completeSeatHandover,
  declineSeatAssignmentOffer,
  recordEnterpriseAssetAuditEvent,
} from "../enterprise-seat-assets-store.js";
import { sendJson } from "../http-common.js";
import { ensureDefaultSeatModelGrant } from "../model-entitlement/ensure-default-seat-model-grant.js";
import {
  createSessionAndReply,
  DEFAULT_PLATFORM_AUTH_SCOPES,
  hashPassword,
  resolveSessionContext,
  sendPlatformAuthSuccess,
  verifyPassword,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { resolveEmployeeInviteEmailAvailability } from "./employee-invite-email.js";
import {
  assertStrongPassword,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  requiredString,
} from "./request-helpers.js";
import {
  loadSeatAssetsStoreForTenantId,
  saveSeatAssetsStoreForTenantId,
} from "./seat-store-loader.js";
import { readPlatformAuthSessionContextFromRequest } from "./session-context.js";
import type { PlatformAuthMembership, PlatformAuthUser } from "./store-types.js";
import { loadStore } from "./store.js";
import { normalizeActivationStatus, verifyOpaqueCode } from "./token-operations.js";

export async function handleEmployeeRegisterRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const displayName = normalizeDisplayName(body.displayName, email);
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
  if (!code) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_CODE_REQUIRED",
      error: "Activation code is required.",
    });
    return true;
  }
  const activation = Object.values(store.activationCodes).find(
    (entry) =>
      entry.codeType === "employeeActivation" &&
      entry.normalizedEmail === email &&
      normalizeActivationStatus(entry) === "active" &&
      verifyOpaqueCode(code, entry.codeHash),
  );
  if (!activation || !activation.enterpriseId || !activation.provisionId) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_CODE_INVALID",
      error: "The activation code is invalid or expired.",
    });
    return true;
  }
  const enterprise = store.enterprises[activation.enterpriseId];
  const provision = store.employeeProvisions[activation.provisionId];
  if (!enterprise || !provision || provision.status !== "pending_activation") {
    sendJson(res, 410, {
      ok: false,
      code: "PLATFORM_AUTH_ACTIVATION_STALE",
      error: "This activation request is no longer available.",
    });
    return true;
  }
  const invitedPositionId = provision.seatId?.trim() ?? "";
  if (!invitedPositionId) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_POSITION_UNBOUND",
      error: "This invite has no position. Activation cannot continue.",
    });
    return true;
  }
  const seatStore = await loadSeatAssetsStoreForTenantId(enterprise.id);
  const invitedSeat = seatStore.seats[invitedPositionId];
  if (!invitedSeat || invitedSeat.tenantId !== enterprise.id) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_POSITION_UNBOUND",
      error: "The invited position is not in this enterprise.",
    });
    return true;
  }
  const emailAvailability = resolveEmployeeInviteEmailAvailability({
    store,
    email,
    enterpriseId: enterprise.id,
  });
  if (emailAvailability.status === "already-member") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_ALREADY_ENTERPRISE_MEMBER",
      error: "该邮箱已是本企业员工，无法重复邀请。",
    });
    return true;
  }
  const existingUser = emailAvailability.existingUser;
  if (enterprise.status === "expired" || enterprise.status === "suspended") {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_UNAVAILABLE",
      error: "This enterprise is not accepting activations right now.",
    });
    return true;
  }
  if (enterprise.seatUsed >= enterprise.seatQuota) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SEAT_QUOTA_EXHAUSTED",
      error: "企业席位已满，请联系管理员扩容后再激活。",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  let createdNewUser = false;
  let user: PlatformAuthUser;
  if (existingUser) {
    if (!verifyPassword(password, existingUser.passwordHash)) {
      sendJson(res, 401, {
        ok: false,
        code: "PLATFORM_AUTH_INVALID_CREDENTIALS",
        error: "邮箱已有账号，请使用原密码完成加入企业。",
      });
      return true;
    }
    user = existingUser;
    user.lastLoginAt = nowIso;
    user.updatedAt = nowIso;
    if (user.status === "suspended") {
      user.status = "active";
    }
  } else {
    createdNewUser = true;
    user = {
      id: randomUUID(),
      email,
      normalizedEmail: email,
      displayName,
      passwordHash: hashPassword(password),
      passwordUpdatedAt: nowIso,
      emailVerifiedAt: nowIso,
      lastLoginAt: nowIso,
      loginFailedCount: 0,
      status: "active",
      source: "employee-activated",
      role: "operator",
      scopes: [...DEFAULT_PLATFORM_AUTH_SCOPES],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.users[user.id] = user;
  }
  const membership: PlatformAuthMembership = {
    id: randomUUID(),
    userId: user.id,
    enterpriseId: enterprise.id,
    membershipRole: "member",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.memberships[membership.id] = membership;
  enterprise.seatUsed += 1;
  enterprise.updatedAt = nowIso;
  provision.status = "activated";
  provision.activatedUserId = user.id;
  provision.activatedAt = nowIso;
  provision.updatedAt = nowIso;
  activation.status = "claimed";
  activation.claimedAt = nowIso;
  activation.claimedByUserId = user.id;
  activation.updatedAt = nowIso;
  // Same tenant seat store loaded before the user row was written.
  try {
    const auditId = randomUUID();
    recordEnterpriseAssetAuditEvent({
      store: seatStore,
      tenantId: enterprise.id,
      eventType: "asset.inheritance.applied",
      nowIso,
      auditId,
      actorEmployeeId: user.id,
      seatId: invitedPositionId,
      metadata: {
        assignmentId: provision.assignmentId ?? provision.id,
        assignmentType: provision.assignmentType ?? "new_hire",
      },
    });
    bindInvitedEmployeeToPosition({
      store: seatStore,
      tenantId: enterprise.id,
      seatId: invitedPositionId,
      employeeId: user.id,
      nowIso,
      actorEmployeeId: user.id,
      auditId,
    });
    completeSeatHandover({
      store: seatStore,
      tenantId: enterprise.id,
      seatId: provision.seatId,
      incomingEmployeeId: user.id,
      nowIso,
      actorEmployeeId: user.id,
      auditId,
    });
    recordEnterpriseAssetAuditEvent({
      store: seatStore,
      tenantId: enterprise.id,
      eventType: "assignment.accepted",
      nowIso,
      auditId,
      actorEmployeeId: user.id,
      seatId: provision.seatId,
      metadata: {
        assignmentId: provision.assignmentId ?? provision.id,
        assignmentType: provision.assignmentType ?? "new_hire",
        acceptedAt: nowIso,
      },
    });
  } catch (error) {
    if (createdNewUser) {
      delete store.users[user.id];
    }
    delete store.memberships[membership.id];
    enterprise.seatUsed = Math.max(0, enterprise.seatUsed - 1);
    provision.status = "pending_activation";
    delete provision.activatedUserId;
    delete provision.activatedAt;
    activation.status = "active";
    delete activation.claimedAt;
    delete activation.claimedByUserId;
    activation.updatedAt = nowIso;
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_SEAT_ASSIGNMENT_FAILED",
      error: error instanceof Error ? error.message : "Seat assignment failed.",
    });
    return true;
  }
  await saveSeatAssetsStoreForTenantId(enterprise.id, seatStore);
  // 试用租户：席位占用前补齐订阅/权益；失败不阻断激活。
  try {
    await ensureTrialCommercialAccess(enterprise.id);
  } catch {
    // best-effort
  }
  // 席位占位成功后写入套餐最低档模型授权；失败不回滚激活（运行时仍有懒加载兜底）。
  try {
    await ensureDefaultSeatModelGrant({
      tenantId: enterprise.id,
      seatId: provision.seatId,
      actorUserId: user.id,
    });
  } catch {
    // best-effort
  }
  const context = resolveSessionContext(store, user, "employee", membership);
  if (!context) {
    throw new Error("new employee membership must resolve to a scoped session");
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

export async function handleEmployeeAccessOfferAcceptRoute(
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
  if (!context || !context.membership || !context.enterprise) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in with an employee account before accepting a seat assignment.",
    });
    return true;
  }
  const offerId = requiredString(body.offerId);
  if (!offerId) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_OFFER_REQUIRED",
      error: "Seat assignment offer ID is required.",
    });
    return true;
  }
  const seatStore = await loadSeatAssetsStoreForTenantId(context.enterprise.id);
  const offerSeatId = seatStore.offers?.[offerId]?.seatId?.trim() ?? "";
  try {
    acceptSeatAssignmentOffer({
      store: seatStore,
      tenantId: context.enterprise.id,
      offerId,
      employeeId: context.user.id,
      nowIso: new Date().toISOString(),
      auditId: randomUUID(),
    });
  } catch (error) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_OFFER_ACCEPT_FAILED",
      error: error instanceof Error ? error.message : "Seat assignment acceptance failed.",
    });
    return true;
  }
  await saveSeatAssetsStoreForTenantId(context.enterprise.id, seatStore);
  if (offerSeatId) {
    try {
      await ensureDefaultSeatModelGrant({
        tenantId: context.enterprise.id,
        seatId: offerSeatId,
        actorUserId: context.user.id,
      });
    } catch {
      // best-effort：接受 offer 后仍可靠运行时懒加载兜底
    }
  }
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context,
    session: context.session,
  });
  return true;
}

export async function handleEmployeeAccessOfferDeclineRoute(
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
  if (!context || !context.membership || !context.enterprise) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in with an employee account before declining a seat assignment.",
    });
    return true;
  }
  const offerId = requiredString(body.offerId);
  if (!offerId) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_OFFER_REQUIRED",
      error: "Seat assignment offer ID is required.",
    });
    return true;
  }
  const seatStore = await loadSeatAssetsStoreForTenantId(context.enterprise.id);
  try {
    declineSeatAssignmentOffer({
      store: seatStore,
      tenantId: context.enterprise.id,
      offerId,
      employeeId: context.user.id,
      nowIso: new Date().toISOString(),
      auditId: randomUUID(),
    });
  } catch (error) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_OFFER_DECLINE_FAILED",
      error: error instanceof Error ? error.message : "Seat assignment decline failed.",
    });
    return true;
  }
  await saveSeatAssetsStoreForTenantId(context.enterprise.id, seatStore);
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context,
    session: context.session,
  });
  return true;
}
