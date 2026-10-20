/**
 * Trial application route handlers for platform auth.
 *
 * Handles trial application submission (auto / auto-with-sales / manual review),
 * approval, rejection, trial-policy update, and per-enterprise trial-instance
 * update. Extracted from the platform-auth monolith (decomposition Task 5.13).
 * Behavior preserved verbatim.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scheduleTrialCommercialAccess } from "../billing/ensure-trial-commercial-access.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { sendJson } from "../http-common.js";
import {
  enqueueLeadNotification,
  hasPendingAdminProvision,
  revokeStalePendingAdminProvisions,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { createEnterpriseWithPendingAdminActivation } from "./enterprise-provisioning.js";
import { findUserByEmail } from "./memberships.js";
import {
  decideTrialApplyMode,
  isValidEmail,
  normalizeBoolean,
  normalizeDisplayName,
  normalizeEmail,
  normalizeOptionalText,
  normalizeTenantName,
  parseExpectedUsers,
  requiredStringList,
} from "./request-helpers.js";
import { buildPlatformAuthState } from "./session-context.js";
import type { PlatformAuthTrialApplication } from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import { buildPendingCode } from "./token-operations.js";

export async function handleTrialApplyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
): Promise<boolean> {
  const store = await loadStore(config);
  const companyName = normalizeTenantName(
    body.companyName ?? body.enterpriseName ?? body.tenantName,
  );
  const contactName = normalizeDisplayName(
    body.contactName ?? body.adminName ?? body.displayName,
    "",
  );
  const workEmail = normalizeEmail(body.workEmail ?? body.adminEmail ?? body.email);
  const expectedUsers = parseExpectedUsers(body.expectedUsers ?? body.teamSize);
  const useCase = requiredStringList(body.useCase ?? body.useCases);
  const companySize = normalizeOptionalText(body.companySize);
  const needsDemo = normalizeBoolean(body.needsDemo);
  const industry = normalizeOptionalText(body.industry);
  if (!companyName) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_TRIAL_COMPANY_NAME_REQUIRED",
      error: "Company name is required.",
    });
    return true;
  }
  if (!contactName) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_TRIAL_CONTACT_NAME_REQUIRED",
      error: "Contact name is required.",
    });
    return true;
  }
  if (!isValidEmail(workEmail)) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_EMAIL",
      error: "Enter a valid work email address.",
    });
    return true;
  }
  if (!expectedUsers) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_TRIAL_EXPECTED_USERS_REQUIRED",
      error: "Expected user count is required.",
    });
    return true;
  }
  if (!useCase) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_TRIAL_USE_CASE_REQUIRED",
      error: "Use case is required.",
    });
    return true;
  }
  if (findUserByEmail(store, workEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_EMAIL_EXISTS",
      error: "That email is already registered.",
    });
    return true;
  }
  revokeStalePendingAdminProvisions(store, workEmail);
  if (hasPendingAdminProvision(store, workEmail)) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_PENDING_ACTIVATION_EXISTS",
      error: "That administrator already has a pending activation.",
    });
    return true;
  }

  const decision = decideTrialApplyMode({
    companyName,
    workEmail,
    expectedUsers,
    needsDemo,
  });
  const nowIso = new Date().toISOString();
  if (decision.mode === "manual") {
    const existingPending = Object.values(store.trialApplications).find(
      (entry) => entry.normalizedWorkEmail === workEmail && entry.status === "pending",
    );
    if (existingPending) {
      existingPending.companyName = companyName;
      existingPending.contactName = contactName;
      existingPending.expectedUsers = expectedUsers;
      existingPending.useCase = useCase;
      if (companySize) {
        existingPending.companySize = companySize;
      }
      if (industry) {
        existingPending.industry = industry;
      }
      existingPending.needsDemo = needsDemo;
      existingPending.reviewReasons = [...decision.reviewReasons];
      existingPending.updatedAt = nowIso;
      await saveStore(config, store);
      const seatStore = await loadEnterpriseSeatAssetsStore();
      sendJson(res, 200, {
        ok: true,
        platformAuth: await buildPlatformAuthState({
          config,
          store,
          seatStore,
        }),
        trialApplication: {
          mode: "manual",
          message: "我们已经收到你的申请，产品顾问会尽快联系你。",
        },
      });
      return true;
    }
  }
  const trialApplication: PlatformAuthTrialApplication = {
    id: randomUUID(),
    companyName,
    contactName,
    workEmail,
    normalizedWorkEmail: workEmail,
    expectedUsers,
    useCase,
    ...(companySize ? { companySize } : {}),
    needsDemo,
    ...(industry ? { industry } : {}),
    mode: decision.mode,
    highIntentLead: decision.highIntentLead,
    reviewReasons: [...decision.reviewReasons],
    status: decision.mode === "manual" ? "pending" : "converted",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.trialApplications[trialApplication.id] = trialApplication;

  if (decision.mode === "manual") {
    enqueueLeadNotification({
      store,
      type: "sales-follow-up",
      trialApplicationId: trialApplication.id,
      email: workEmail,
      payload: {
        companyName,
        contactName,
        workEmail,
        expectedUsers,
        useCase,
        ...(companySize ? { companySize } : {}),
        ...(industry ? { industry } : {}),
        reviewReasons: trialApplication.reviewReasons,
      },
      createdAt: nowIso,
    });
    await saveStore(config, store);
    const seatStore = await loadEnterpriseSeatAssetsStore();
    sendJson(res, 202, {
      ok: true,
      platformAuth: await buildPlatformAuthState({
        config,
        store,
        seatStore,
      }),
      trialApplication: {
        mode: "manual",
        message: "我们的产品顾问将在 24 小时内联系你。",
      },
    });
    return true;
  }

  const seatCount =
    decision.mode === "auto"
      ? store.policy.defaultTrialSeatCount
      : Math.max(store.policy.defaultTrialSeatCount, 10);
  const { enterprise, provision, plainCode, expiresAt } =
    createEnterpriseWithPendingAdminActivation({
      config,
      store,
      enterpriseName: companyName,
      adminName: contactName,
      adminEmail: workEmail,
      seatCount,
      createdSource: "self-service",
    });
  trialApplication.enterpriseId = enterprise.id;
  trialApplication.provisionId = provision.id;
  trialApplication.updatedAt = new Date().toISOString();
  enqueueLeadNotification({
    store,
    type: "admin-activation-email",
    trialApplicationId: trialApplication.id,
    email: workEmail,
    enterpriseId: enterprise.id,
    payload: {
      companyName,
      contactName,
      workEmail,
      code: plainCode,
      expiresAt,
    },
    createdAt: nowIso,
  });
  if (decision.mode === "auto_with_sales") {
    enqueueLeadNotification({
      store,
      type: "sales-follow-up",
      trialApplicationId: trialApplication.id,
      email: workEmail,
      enterpriseId: enterprise.id,
      payload: {
        companyName,
        contactName,
        workEmail,
        expectedUsers,
        useCase,
        ...(companySize ? { companySize } : {}),
        ...(industry ? { industry } : {}),
        needsDemo,
      },
      createdAt: nowIso,
    });
  }
  await saveStore(config, store);
  scheduleTrialCommercialAccess(enterprise.id);
  const seatStore = await loadEnterpriseSeatAssetsStore();
  sendJson(res, 201, {
    ok: true,
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      pendingActivation: buildPendingCode({
        kind: "enterprise-admin-activation",
        email: workEmail,
        enterpriseName: companyName,
        code: plainCode,
        expiresAt,
      }),
    }),
    trialApplication: {
      mode: decision.mode,
      message:
        decision.mode === "auto"
          ? "\uD83C\uDF89 试用已开通，请前往邮箱激活。"
          : "\uD83C\uDF89 试用已开通，我们的产品顾问将联系你。",
    },
  });
  return true;
}
