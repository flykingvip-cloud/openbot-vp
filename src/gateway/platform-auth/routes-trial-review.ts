/**
 * Trial application review route handlers (approve / reject), trial-policy
 * update, and per-enterprise trial-instance update.
 *
 * Sibling of ./routes-trial.ts (which keeps the public application-submission
 * handler). Extracted from the platform-auth monolith (decomposition Task 5.13).
 * Behavior preserved verbatim.
 */

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
  hasPendingAdminProvision,
  revokeStalePendingAdminProvisions,
  sendPlatformAuthSuccess,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import { createEnterpriseWithPendingAdminActivation } from "./enterprise-provisioning.js";
import { findUserByEmail } from "./memberships.js";
import {
  cleanUrl,
  normalizeOptionalText,
  normalizePolicy,
  normalizePositiveInt,
  requiredString,
  toTrialDays,
  toTrialSeats,
} from "./request-helpers.js";
import { buildEnterpriseAdminActivationUrl } from "./routes-enterprise.js";
import {
  loadSeatAssetsStoreForContext,
  loadSeatAssetsStoreForTenantId,
} from "./seat-store-loader.js";
import {
  buildPlatformAuthState,
  readPlatformAuthSessionContextFromRequest,
} from "./session-context.js";
import { loadStore, saveStore } from "./store.js";
import { buildPendingCode } from "./token-operations.js";

export async function handleTrialApplicationApproveRoute(
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
      error: "Only platform administrators can review trial applications.",
    });
    return true;
  }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const application = applicationId ? store.trialApplications[applicationId] : undefined;
  if (!application) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_TRIAL_APPLICATION_NOT_FOUND",
      error: "Trial application not found.",
    });
    return true;
  }
  if (application.status !== "pending") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_TRIAL_APPLICATION_NOT_PENDING",
      error: "Trial application is not awaiting review.",
    });
    return true;
  }
  revokeStalePendingAdminProvisions(store, application.normalizedWorkEmail);
  if (findUserByEmail(store, application.normalizedWorkEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
  if (hasPendingAdminProvision(store, application.normalizedWorkEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
      error: "That administrator already has a pending activation.",
    });
    return true;
  }
  const reviewNote = normalizeOptionalText(body.reviewNote, 500);
  const trialDays = body.trialDays !== undefined ? body.trialDays : undefined;
  const seatCount = body.seatCount !== undefined ? body.seatCount : undefined;
  const { enterprise, provision, plainCode, expiresAt } =
    createEnterpriseWithPendingAdminActivation({
      config,
      store,
      enterpriseName: application.companyName,
      adminName: application.contactName,
      adminEmail: application.normalizedWorkEmail,
      ...(trialDays !== undefined ? { trialDays } : {}),
      ...(seatCount !== undefined ? { seatCount } : {}),
      createdSource: "self-service",
      createdByPlatformUserId: context.user.id,
      contactName: application.contactName,
      contactEmail: application.workEmail,
      ...(application.companySize ? { companySize: application.companySize } : {}),
      ...(application.industry ? { industry: application.industry } : {}),
      contactSource: "trial-application",
    });
  const nowIso = new Date().toISOString();
  application.status = "converted";
  application.enterpriseId = enterprise.id;
  application.provisionId = provision.id;
  application.reviewedAt = nowIso;
  application.reviewedByPlatformUserId = context.user.id;
  if (reviewNote) {
    application.reviewNote = reviewNote;
  }
  application.updatedAt = nowIso;
  const activationUrl = buildEnterpriseAdminActivationUrl({
    req,
    code: plainCode,
    email: application.normalizedWorkEmail,
    adminName: application.contactName,
  });
  const notification = enqueuePlatformAuthNotification({
    store,
    type: "admin-activation-email",
    trialApplicationId: application.id,
    email: application.normalizedWorkEmail,
    enterpriseId: enterprise.id,
    payload: {
      companyName: application.companyName,
      contactName: application.contactName,
      workEmail: application.normalizedWorkEmail,
      adminEmail: application.normalizedWorkEmail,
      adminName: application.contactName,
      enterpriseName: application.companyName,
      code: plainCode,
      expiresAt,
      activationUrl,
    },
    createdAt: nowIso,
  });
  const emailDelivery = await deliverPlatformAuthEmailNotification(notification);
  applyPlatformAuthEmailDeliveryResult(notification, emailDelivery, new Date().toISOString());
  await saveStore(config, store);
  scheduleTrialCommercialAccess(enterprise.id);
  const seatStore = await loadSeatAssetsStoreForTenantId(enterprise.id);
  sendJson(res, 200, {
    ok: true,
    emailDelivery,
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
      pendingActivation: buildPendingCode({
        kind: "enterprise-admin-activation",
        email: application.normalizedWorkEmail,
        enterpriseName: application.companyName,
        code: plainCode,
        expiresAt,
      }),
    }),
  });
  return true;
}

export async function handleTrialApplicationRejectRoute(
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
      error: "Only platform administrators can review trial applications.",
    });
    return true;
  }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const application = applicationId ? store.trialApplications[applicationId] : undefined;
  if (!application) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_TRIAL_APPLICATION_NOT_FOUND",
      error: "Trial application not found.",
    });
    return true;
  }
  if (application.status !== "pending") {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_TRIAL_APPLICATION_NOT_PENDING",
      error: "Trial application is not awaiting review.",
    });
    return true;
  }
  const rejectionReason = normalizeOptionalText(body.rejectionReason, 200);
  if (!rejectionReason) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_TRIAL_REJECTION_REASON_REQUIRED",
      error: "Rejection reason is required.",
    });
    return true;
  }
  const reviewNote = normalizeOptionalText(body.reviewNote, 500);
  const nowIso = new Date().toISOString();
  application.status = "rejected";
  application.rejectionReason = rejectionReason;
  application.reviewedAt = nowIso;
  application.reviewedByPlatformUserId = context.user.id;
  if (reviewNote) {
    application.reviewNote = reviewNote;
  }
  application.updatedAt = nowIso;
  await saveStore(config, store);
  const seatStore = await loadSeatAssetsStoreForContext(context);
  sendJson(res, 200, {
    ok: true,
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
    }),
  });
  return true;
}

export async function handleTrialPolicyUpdateRoute(
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
      error: "Only platform administrators can update trial policy.",
    });
    return true;
  }
  store.policy = normalizePolicy({
    defaultTrialDays: normalizePositiveInt(body.defaultTrialDays) ?? store.policy.defaultTrialDays,
    allowedTrialDays: Array.isArray(body.allowedTrialDays)
      ? body.allowedTrialDays.map((value) => normalizePositiveInt(value) ?? 0)
      : store.policy.allowedTrialDays,
    defaultTrialSeatCount:
      normalizePositiveInt(body.defaultTrialSeatCount) ?? store.policy.defaultTrialSeatCount,
    trialSeatOptions: Array.isArray(body.trialSeatOptions)
      ? body.trialSeatOptions.map((value) => normalizePositiveInt(value) ?? 0)
      : store.policy.trialSeatOptions,
    allowCustomTrialSeatCount:
      typeof body.allowCustomTrialSeatCount === "boolean"
        ? body.allowCustomTrialSeatCount
        : store.policy.allowCustomTrialSeatCount,
    trialExpiryPolicy:
      body.trialExpiryPolicy === "redirect_to_upgrade" ||
      body.trialExpiryPolicy === "redirect_to_sales" ||
      body.trialExpiryPolicy === "choose"
        ? body.trialExpiryPolicy
        : store.policy.trialExpiryPolicy,
    trialExpiryHandling:
      body.trialExpiryHandling === "auto_stop" ||
      body.trialExpiryHandling === "read_only" ||
      body.trialExpiryHandling === "grace_period"
        ? body.trialExpiryHandling
        : store.policy.trialExpiryHandling,
    trialGraceDays: (() => {
      const raw = body.trialGraceDays;
      const parsed =
        typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed >= 0
        ? Math.floor(parsed)
        : store.policy.trialGraceDays;
    })(),
    upgradeUrl: cleanUrl(body.upgradeUrl) ?? store.policy.upgradeUrl,
    contactAdvisorUrl: cleanUrl(body.contactAdvisorUrl) ?? store.policy.contactAdvisorUrl,
    updatedAt: new Date().toISOString(),
  });
  await saveStore(config, store);
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context,
    session: context.session,
  });
  return true;
}

export async function handleTrialInstanceUpdateRoute(
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
      error: "Only platform administrators can update enterprise trial settings.",
    });
    return true;
  }
  const enterpriseId = requiredString(body.enterpriseId);
  const enterprise = store.enterprises[enterpriseId];
  if (!enterprise) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_ENTERPRISE_NOT_FOUND",
      error: "The enterprise could not be found.",
    });
    return true;
  }
  const now = Date.now();
  const hasSeatCount = body.seatCount !== undefined;
  const hasTrialDays = body.trialDays !== undefined;
  if (hasSeatCount) {
    const seatQuota = toTrialSeats(store.policy, body.seatCount);
    enterprise.trialSeatQuotaSnapshot = seatQuota;
    enterprise.seatQuota = Math.max(seatQuota, enterprise.seatUsed);
  }
  if (hasTrialDays) {
    const trialDays = toTrialDays(store.policy, body.trialDays);
    enterprise.trialDaysSnapshot = trialDays;
    enterprise.trialStartedAt = enterprise.trialStartedAt ?? new Date(now).toISOString();
    enterprise.trialEndsAt = new Date(now + trialDays * 24 * 60 * 60 * 1000).toISOString();
    enterprise.status = "trial";
    enterprise.trialExpiredAt = undefined;
    // Re-extending starts a fresh trial window, so any prior expiry/grace bookkeeping is stale.
    enterprise.expiredHandledAt = undefined;
    enterprise.graceEndsAt = undefined;
  }
  if (
    body.expiryHandling === "auto_stop" ||
    body.expiryHandling === "read_only" ||
    body.expiryHandling === "grace_period"
  ) {
    enterprise.expiryHandling = body.expiryHandling;
  }
  enterprise.updatedAt = new Date(now).toISOString();
  if (cleanUrl(body.upgradeUrl)) {
    enterprise.upgradeUrl = cleanUrl(body.upgradeUrl);
  }
  if (cleanUrl(body.contactAdvisorUrl)) {
    enterprise.contactAdvisorUrl = cleanUrl(body.contactAdvisorUrl);
  }
  await saveStore(config, store);
  scheduleTrialCommercialAccess(enterpriseId);
  // Write already succeeded — respond lean so the UI is not stuck on「保存中…」
  // while seat-assets + billing enrichment rebuild the full platformAuth payload.
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
    context,
    session: context.session,
    lean: true,
  });
  return true;
}
