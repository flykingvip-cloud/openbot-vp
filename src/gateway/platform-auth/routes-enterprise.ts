/**
 * Enterprise / platform-admin route handlers for platform auth.
 *
 * Handles platform-admin creation, enterprise creation (self-service and
 * platform-initiated), and enterprise-admin activation. Extracted from the
 * platform-auth monolith (decomposition Task 5.13). Behavior preserved verbatim.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { scheduleTrialCommercialAccess } from "../billing/ensure-trial-commercial-access.js";
import { sendJson } from "../http-common.js";
import {
  applyPlatformAuthEmailDeliveryResult,
  deliverPlatformAuthEmailNotification,
} from "../platform-auth-email.js";
import {
  canManagePlatform,
  canManagePlatformAdmins,
  createSessionAndReply,
  DEFAULT_PLATFORM_AUTH_SCOPES,
  hashPassword,
  hasPendingAdminProvision,
  normalizePlatformAdminScopes,
  PLATFORM_ADMIN_SCOPES,
  resolvePlatformRole,
  resolveSessionContext,
  sendPlatformAuthSuccess,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import { findPrimaryEnterpriseAdminContact } from "./enterprise-customer-attributes.js";
import {
  createEnterpriseWithPendingAdminActivation,
  createPendingAdminActivationForEnterprise,
  normalizeTenantCreationMode,
} from "./enterprise-provisioning.js";
import { findUserByEmail } from "./memberships.js";
import { resolvePublicPlatformBaseUrl } from "./public-request.js";
import {
  assertStrongPassword,
  cleanUrl,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  normalizeTenantName,
  requiredString,
} from "./request-helpers.js";
import { loadSeatAssetsStoreForTenantId } from "./seat-store-loader.js";
import {
  buildPlatformAuthState,
  readPlatformAuthSessionContextFromRequest,
} from "./session-context.js";
import type {
  PlatformAuthEnterpriseAdminProvision,
  PlatformAuthMembership,
  PlatformAuthUser,
} from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import {
  buildPendingCode,
  findLatestActiveCode,
  invalidateUserSessions,
  issueActivationCode,
  normalizeActivationStatus,
  verifyOpaqueCode,
} from "./token-operations.js";

function resolveRequestOrigin(req: IncomingMessage): string {
  const publicBaseUrl = resolvePublicPlatformBaseUrl();
  if (publicBaseUrl) {
    return publicBaseUrl;
  }
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.trim().split(",")[0]?.trim() || "http"
      : (req.socket as { encrypted?: boolean } | undefined)?.encrypted
        ? "https"
        : "http";
  const forwardedHost = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"];
  const host =
    typeof forwardedHost === "string" && forwardedHost.trim()
      ? forwardedHost.trim().split(",")[0]?.trim()
      : Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host;
  return `${proto || "http"}://${host?.trim() || "127.0.0.1:18789"}`;
}

/**
 * Deep link for enterprise-admin activation (set password + claim invite).
 * Prefer biz console origin — never admin/platform console origin.
 */
export function resolveEnterpriseAdminActivationOrigin(req: IncomingMessage): string {
  const explicit =
    process.env.OPENBOT_PUBLIC_ENTERPRISE_BASE_URL?.trim() ||
    process.env.OPENCLAW_PUBLIC_ENTERPRISE_BASE_URL?.trim() ||
    "";
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const platform = resolvePublicPlatformBaseUrl();
  if (platform) {
    try {
      const parsed = new URL(platform);
      const host = parsed.hostname.toLowerCase();
      for (const prefix of ["admin", "gw", "www"]) {
        if (host.startsWith(`${prefix}.`)) {
          parsed.hostname = `biz.${host.slice(prefix.length + 1)}`;
          return parsed.origin;
        }
      }
      if (host.startsWith("biz.")) {
        return parsed.origin;
      }
    } catch {
      // fall through
    }
  }
  try {
    const fromReq = new URL(resolveRequestOrigin(req));
    const host = fromReq.hostname.toLowerCase();
    for (const prefix of ["admin", "gw", "www"]) {
      if (host.startsWith(`${prefix}.`)) {
        fromReq.hostname = `biz.${host.slice(prefix.length + 1)}`;
        return fromReq.origin;
      }
    }
    return fromReq.origin;
  } catch {
    return resolveRequestOrigin(req);
  }
}

export function buildEnterpriseAdminActivationUrl(params: {
  req: IncomingMessage;
  basePath?: string;
  code: string;
  email?: string;
  adminName?: string;
}): string {
  const normalizedBase = params.basePath?.trim().replace(/\/+$/, "") ?? "";
  const url = new URL(
    `${normalizedBase || ""}/enterprise/login`,
    resolveEnterpriseAdminActivationOrigin(params.req),
  );
  url.searchParams.set("authMode", "enterprise-activate");
  url.searchParams.set("code", params.code);
  const email = params.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  const adminName = params.adminName?.trim();
  if (adminName && (!email || adminName.toLowerCase() !== email.toLowerCase())) {
    url.searchParams.set("name", adminName);
  }
  url.hash = "auth";
  return url.toString();
}

async function deliverAdminActivationEmail(params: {
  store: Awaited<ReturnType<typeof loadStore>>;
  req: IncomingMessage;
  enterpriseId: string;
  enterpriseName: string;
  adminEmail: string;
  adminName: string;
  plainCode: string;
  expiresAt: string;
  createdAt?: string;
}): Promise<Awaited<ReturnType<typeof deliverPlatformAuthEmailNotification>>> {
  const activationUrl = buildEnterpriseAdminActivationUrl({
    req: params.req,
    code: params.plainCode,
    email: params.adminEmail,
    adminName: params.adminName,
  });
  const createdAt = params.createdAt ?? new Date().toISOString();
  const notification = enqueuePlatformAuthNotification({
    store: params.store,
    type: "admin-activation-email",
    email: params.adminEmail,
    enterpriseId: params.enterpriseId,
    payload: {
      companyName: params.enterpriseName,
      contactName: params.adminName,
      workEmail: params.adminEmail,
      adminEmail: params.adminEmail,
      adminName: params.adminName,
      enterpriseName: params.enterpriseName,
      code: params.plainCode,
      expiresAt: params.expiresAt,
      activationUrl,
    },
    createdAt,
  });
  const emailDelivery = await deliverPlatformAuthEmailNotification(notification);
  applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, createdAt);
  return emailDelivery;
}

export async function handlePlatformAdminCreateRoute(
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
  if (!context?.user || !canManagePlatformAdmins(context.user)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SUPER_ADMIN_REQUIRED",
      error: "Only super administrators can create platform administrators.",
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
      error: "Enter a valid admin email address.",
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
  if (findUserByEmail(store, email)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  const userId = randomUUID();
  store.users[userId] = {
    id: userId,
    email,
    normalizedEmail: email,
    displayName,
    passwordHash: hashPassword(password),
    passwordUpdatedAt: nowIso,
    emailVerifiedAt: nowIso,
    loginFailedCount: 0,
    status: "active",
    source: "platform-created",
    platformRole: "admin",
    role: "operator",
    scopes:
      Array.isArray(body.scopes) && body.scopes.length > 0
        ? normalizePlatformAdminScopes(body.scopes)
        : [...PLATFORM_ADMIN_SCOPES],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    status: 201,
    config,
    store,
    context,
    session: context.session,
  });
  return true;
}

export async function handlePlatformAdminRemoveRoute(
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
  if (!context?.user || !canManagePlatformAdmins(context.user)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SUPER_ADMIN_REQUIRED",
      error: "Only super administrators can remove platform administrators.",
    });
    return true;
  }
  const email = normalizeEmail(body.user ?? body.email);
  if (!isValidEmail(email)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid admin email address.",
    });
    return true;
  }
  if (email === context.user.normalizedEmail) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_SELF_REMOVE",
      error: "You cannot remove your own platform administrator account.",
    });
    return true;
  }
  const target = findUserByEmail(store, email);
  if (!target || resolvePlatformRole(target) === null) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_NOT_FOUND",
      error: "That platform administrator could not be found.",
    });
    return true;
  }
  if (resolvePlatformRole(target) === "super-admin") {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SUPER_ADMIN_PROTECTED",
      error: "Super administrators cannot be removed from this panel.",
    });
    return true;
  }
  const nowIso = new Date().toISOString();
  delete target.platformRole;
  if ("platformAdmin" in target) {
    delete target.platformAdmin;
  }
  target.updatedAt = nowIso;
  invalidateUserSessions(store, target.id);
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    status: 200,
    config,
    store,
    context,
    session: context.session,
  });
  return true;
}

export async function handleEnterpriseCreateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  const enterpriseName = normalizeTenantName(body.enterpriseName ?? body.tenantName);
  const adminName = normalizeDisplayName(body.adminName ?? body.displayName, "");
  const adminEmail = normalizeEmail(body.adminEmail ?? body.email);
  if (!enterpriseName) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_NAME_REQUIRED",
      error: "Enterprise name is required.",
    });
    return true;
  }
  if (!isValidEmail(adminEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid admin email address.",
    });
    return true;
  }
  if (findUserByEmail(store, adminEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
  if (hasPendingAdminProvision(store, adminEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
      error: "That administrator already has a pending activation.",
    });
    return true;
  }
  const { enterprise, plainCode, expiresAt } = createEnterpriseWithPendingAdminActivation({
    config,
    store,
    enterpriseName,
    adminName,
    adminEmail,
    trialDays: body.trialDays,
    seatCount: body.seatCount,
    createdSource: "self-service",
  });
  await saveStore(config, store);
  scheduleTrialCommercialAccess(enterprise.id);
  await sendPlatformAuthSuccess({
    res,
    status: 201,
    config,
    store,
    pendingActivation: buildPendingCode({
      kind: "enterprise-admin-activation",
      email: adminEmail,
      enterpriseName,
      code: plainCode,
      expiresAt,
    }),
  });
  return true;
}

export async function handlePlatformEnterpriseCreateRoute(
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
  if (!context?.user || !canManagePlatform(context.user)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_PLATFORM_ADMIN_REQUIRED",
      error: "Only platform administrators can create enterprises here.",
    });
    return true;
  }
  const enterpriseName = normalizeTenantName(body.enterpriseName ?? body.tenantName);
  const adminName = normalizeDisplayName(body.adminName ?? body.displayName, "");
  const adminEmail = normalizeEmail(body.adminEmail ?? body.email);
  const creationMode = normalizeTenantCreationMode(body.creationMode);
  if (!enterpriseName) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_NAME_REQUIRED",
      error: "Enterprise name is required.",
    });
    return true;
  }
  if (!isValidEmail(adminEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid admin email address.",
    });
    return true;
  }
  if (findUserByEmail(store, adminEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
  const { enterprise, provision, plainCode, expiresAt } =
    createEnterpriseWithPendingAdminActivation({
      config,
      store,
      enterpriseName,
      adminName,
      adminEmail,
      trialDays: body.trialDays,
      seatCount: body.seatCount,
      createdSource: "platform-created",
      creationMode,
      createdByPlatformUserId: context.user.id,
      upgradeUrl: cleanUrl(body.upgradeUrl),
      contactAdvisorUrl: cleanUrl(body.contactAdvisorUrl),
    });
  const activationUrl = buildEnterpriseAdminActivationUrl({
    req,
    code: plainCode,
    email: adminEmail,
    adminName: provision.adminName || adminName,
  });
  const emailDelivery = await deliverAdminActivationEmail({
    store,
    req,
    enterpriseId: enterprise.id,
    enterpriseName,
    adminEmail,
    adminName: provision.adminName || adminName,
    plainCode,
    expiresAt,
  });
  await saveStore(config, store);
  scheduleTrialCommercialAccess(enterprise.id);
  await sendPlatformAuthSuccess({
    res,
    status: 201,
    config,
    store,
    context,
    session: context.session,
    emailDelivery,
    pendingActivation: buildPendingCode({
      kind: "enterprise-admin-activation",
      email: adminEmail,
      enterpriseName,
      enterpriseId: enterprise.id,
      activationUrl,
      code: plainCode,
      expiresAt,
    }),
  });
  return true;
}

export async function handleEnterpriseAdminActivateRoute(
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
      entry.codeType === "enterpriseAdminActivation" &&
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
  const provision = store.adminProvisions[activation.provisionId];
  if (!enterprise || !provision || provision.status !== "pending_activation") {
    sendJson(res, 410, {
      ok: false,
      code: "PLATFORM_AUTH_ACTIVATION_STALE",
      error: "This activation request is no longer available.",
    });
    return true;
  }
  if (findUserByEmail(store, email)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
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
      error: "The enterprise has no remaining seats.",
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
    lastLoginAt: nowIso,
    loginFailedCount: 0,
    status: "active",
    source: enterprise.createdSource === "platform-created" ? "platform-created" : "self-created",
    role: "operator",
    scopes: [...DEFAULT_PLATFORM_AUTH_SCOPES],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.users[user.id] = user;
  const membership: PlatformAuthMembership = {
    id: randomUUID(),
    userId: user.id,
    enterpriseId: enterprise.id,
    membershipRole: "enterprise-admin",
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
  const context = resolveSessionContext(store, user, "enterprise-admin", membership);
  if (!context) {
    throw new Error("new enterprise admin membership must resolve to a scoped session");
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

function findPendingAdminProvisionForEnterprise(
  store: Awaited<ReturnType<typeof loadStore>>,
  enterpriseId: string,
): PlatformAuthEnterpriseAdminProvision | undefined {
  return Object.values(store.adminProvisions).find(
    (entry) => entry.enterpriseId === enterpriseId && entry.status === "pending_activation",
  );
}

async function issueAndDeliverAdminActivation(params: {
  config: ResolvedPlatformAuthConfig;
  store: Awaited<ReturnType<typeof loadStore>>;
  req: IncomingMessage;
  enterpriseId: string;
  enterpriseName: string;
  provision: PlatformAuthEnterpriseAdminProvision;
  issuedByUserId: string;
  sendEmail: boolean;
}): Promise<{
  plainCode: string;
  expiresAt: string;
  activationUrl: string;
  emailDelivery?: Awaited<ReturnType<typeof deliverPlatformAuthEmailNotification>>;
}> {
  const now = Date.now();
  const expiresAt = new Date(now + params.config.activationTtlHours * 60 * 60 * 1000).toISOString();
  const previousActivation =
    Object.values(params.store.activationCodes)
      .filter(
        (activation) =>
          activation.codeType === "enterpriseAdminActivation" &&
          activation.provisionId === params.provision.id &&
          activation.status === "active",
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    findLatestActiveCode({
      store: params.store,
      provisionId: params.provision.id,
      email: params.provision.adminEmail,
      codeType: "enterpriseAdminActivation",
    });
  const { plainCode } = issueActivationCode({
    store: params.store,
    enterpriseId: params.enterpriseId,
    provisionId: params.provision.id,
    email: params.provision.adminEmail,
    issuedByUserId: params.issuedByUserId,
    codeType: "enterpriseAdminActivation",
    expiresAt,
    replaces: previousActivation,
  });
  const activationUrl = buildEnterpriseAdminActivationUrl({
    req: params.req,
    code: plainCode,
    email: params.provision.adminEmail,
    adminName: params.provision.adminName,
  });
  let emailDelivery: Awaited<ReturnType<typeof deliverPlatformAuthEmailNotification>> | undefined;
  if (params.sendEmail) {
    emailDelivery = await deliverAdminActivationEmail({
      store: params.store,
      req: params.req,
      enterpriseId: params.enterpriseId,
      enterpriseName: params.enterpriseName,
      adminEmail: params.provision.adminEmail,
      adminName: params.provision.adminName,
      plainCode,
      expiresAt,
    });
  }
  return {
    plainCode,
    expiresAt,
    activationUrl,
    ...(emailDelivery ? { emailDelivery } : {}),
  };
}

/** Resend pending enterprise-admin activation email (platform operator). */
export async function handlePlatformEnterpriseAdminActivationSendRoute(
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
  if (!context?.user || !canManagePlatform(context.user)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_PLATFORM_ADMIN_REQUIRED",
      error: "Only platform administrators can resend enterprise admin activations.",
    });
    return true;
  }
  const enterpriseId = typeof body.enterpriseId === "string" ? body.enterpriseId.trim() : "";
  const enterprise = enterpriseId ? store.enterprises[enterpriseId] : undefined;
  if (!enterprise) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_NOT_FOUND",
      error: "Enterprise not found.",
    });
    return true;
  }
  const provision = findPendingAdminProvisionForEnterprise(store, enterpriseId);
  if (!provision) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_ACTIVATION_NOT_FOUND",
      error: "No pending enterprise administrator activation was found for this tenant.",
    });
    return true;
  }
  const { plainCode, expiresAt, emailDelivery, activationUrl } =
    await issueAndDeliverAdminActivation({
      config,
      store,
      req,
      enterpriseId,
      enterpriseName: enterprise.name,
      provision,
      issuedByUserId: context.user.id,
      sendEmail: true,
    });
  provision.updatedAt = new Date().toISOString();
  await saveStore(config, store);
  const seatStore = await loadSeatAssetsStoreForTenantId(enterpriseId);
  sendJson(res, 200, {
    ok: true,
    ...(emailDelivery ? { emailDelivery } : {}),
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
      pendingActivation: buildPendingCode({
        kind: "enterprise-admin-activation",
        email: provision.adminEmail,
        enterpriseName: enterprise.name,
        enterpriseId,
        activationUrl,
        code: plainCode,
        expiresAt,
      }),
    }),
  });
  return true;
}

/**
 * Create / update primary enterprise-admin contact from the platform console.
 * - Pending: update name/email and optionally reissue + email activation.
 * - Activated: update the admin user's display name / email.
 * - Missing: create a new pending admin activation.
 */
export async function handlePlatformEnterpriseAdminUpdateRoute(
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
  if (!context?.user || !canManagePlatform(context.user)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_PLATFORM_ADMIN_REQUIRED",
      error: "Only platform administrators can update enterprise admin contacts.",
    });
    return true;
  }
  const enterpriseId = typeof body.enterpriseId === "string" ? body.enterpriseId.trim() : "";
  const enterprise = enterpriseId ? store.enterprises[enterpriseId] : undefined;
  if (!enterprise) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_NOT_FOUND",
      error: "Enterprise not found.",
    });
    return true;
  }
  const adminEmail = normalizeEmail(body.adminEmail ?? body.email);
  const adminName = normalizeDisplayName(body.adminName ?? body.displayName, adminEmail);
  const resendActivation = body.resendActivation !== false;
  if (!isValidEmail(adminEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid admin email address.",
    });
    return true;
  }
  if (!adminName) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_ADMIN_NAME_REQUIRED",
      error: "Administrator name is required.",
    });
    return true;
  }

  const primary = findPrimaryEnterpriseAdminContact(store, enterpriseId);
  const pending = findPendingAdminProvisionForEnterprise(store, enterpriseId);
  const nowIso = new Date().toISOString();
  let plainCode: string | undefined;
  let expiresAt: string | undefined;
  let activationUrl: string | undefined;
  let emailDelivery: Awaited<ReturnType<typeof deliverPlatformAuthEmailNotification>> | undefined;

  if (primary.activated && primary.user) {
    const existingOther = findUserByEmail(store, adminEmail);
    if (existingOther && existingOther.id !== primary.user.id) {
      sendJson(res, 409, {
        ok: false,
        code: "PLATFORM_AUTH_EMAIL_EXISTS",
        error: "That email is already registered.",
      });
      return true;
    }
    primary.user.displayName = adminName;
    primary.user.email = adminEmail;
    primary.user.normalizedEmail = adminEmail;
    primary.user.updatedAt = nowIso;
    enterprise.updatedAt = nowIso;
    await saveStore(config, store);
    await sendPlatformAuthSuccess({
      res,
      status: 200,
      config,
      store,
      context,
      session: context.session,
    });
    return true;
  }

  if (pending) {
    if (
      pending.normalizedAdminEmail !== adminEmail &&
      (findUserByEmail(store, adminEmail) ||
        Object.values(store.adminProvisions).some(
          (entry) =>
            entry.id !== pending.id &&
            entry.normalizedAdminEmail === adminEmail &&
            entry.status === "pending_activation",
        ))
    ) {
      sendJson(res, 409, {
        ok: false,
        code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
        error: "That administrator already has a pending activation or registered account.",
      });
      return true;
    }
    pending.adminName = adminName;
    pending.adminEmail = adminEmail;
    pending.normalizedAdminEmail = adminEmail;
    pending.updatedAt = nowIso;
    enterprise.updatedAt = nowIso;
    if (resendActivation) {
      const delivery = await issueAndDeliverAdminActivation({
        config,
        store,
        req,
        enterpriseId,
        enterpriseName: enterprise.name,
        provision: pending,
        issuedByUserId: context.user.id,
        sendEmail: true,
      });
      plainCode = delivery.plainCode;
      expiresAt = delivery.expiresAt;
      emailDelivery = delivery.emailDelivery;
      activationUrl = delivery.activationUrl;
    }
  } else {
    if (findUserByEmail(store, adminEmail) || hasPendingAdminProvision(store, adminEmail)) {
      sendJson(res, 409, {
        ok: false,
        code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
        error: "That administrator already has a pending activation or registered account.",
      });
      return true;
    }
    const created = createPendingAdminActivationForEnterprise({
      config,
      store,
      enterpriseId,
      adminName,
      adminEmail,
      createdByPlatformUserId: context.user.id,
    });
    plainCode = created.plainCode;
    expiresAt = created.expiresAt;
    enterprise.updatedAt = nowIso;
    if (resendActivation) {
      emailDelivery = await deliverAdminActivationEmail({
        store,
        req,
        enterpriseId,
        enterpriseName: enterprise.name,
        adminEmail,
        adminName,
        plainCode,
        expiresAt,
        createdAt: nowIso,
      });
      activationUrl = buildEnterpriseAdminActivationUrl({
        req,
        code: plainCode,
        email: adminEmail,
        adminName,
      });
    }
  }

  await saveStore(config, store);
  const seatStore = await loadSeatAssetsStoreForTenantId(enterprise.id);
  sendJson(res, 200, {
    ok: true,
    ...(emailDelivery ? { emailDelivery } : {}),
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
      ...(plainCode && expiresAt
        ? {
            pendingActivation: buildPendingCode({
              kind: "enterprise-admin-activation",
              email: adminEmail,
              enterpriseName: enterprise.name,
              enterpriseId: enterprise.id,
              ...(activationUrl
                ? { activationUrl }
                : {
                    activationUrl: buildEnterpriseAdminActivationUrl({
                      req,
                      code: plainCode,
                      email: adminEmail,
                      adminName,
                    }),
                  }),
              code: plainCode,
              expiresAt,
            }),
          }
        : {}),
    }),
  });
  return true;
}
