/**
 * Enterprise / tenant provisioning helpers for platform auth.
 *
 * Owns tenant slug generation, creation-mode defaults, and the enterprise +
 * pending-admin-activation creation flow. Extracted from the platform-auth
 * monolith (decomposition Task 5.13).
 *
 * Behavior is preserved verbatim from the monolith.
 */

import { randomUUID } from "node:crypto";
import { entitleTenantForPlan } from "../capability-packs/tenant-pack-entitlements.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { buildEnterpriseContact } from "./enterprise-contact.js";
import { toTrialDays, toTrialSeats } from "./request-helpers.js";
import type {
  EnterpriseCreatedSource,
  EnterpriseStatus,
  PlatformAuthEnterprise,
  PlatformAuthEnterpriseAdminProvision,
  PlatformAuthEnterpriseContactSource,
  PlatformAuthStore,
  PlatformTenantApprovalStatus,
  PlatformTenantCreationMode,
  PlatformTenantLifecycleStage,
} from "./store-types.js";
import { issueActivationCode } from "./token-operations.js";

export function normalizeTenantCreationMode(value: unknown): PlatformTenantCreationMode {
  return value === "formal" || value === "advanced" ? value : "quick-trial";
}

export function tenantCreationDefaults(mode: PlatformTenantCreationMode): {
  status: EnterpriseStatus;
  plan: string;
  billingStatus: string;
  lifecycleStage: PlatformTenantLifecycleStage;
  approvalStatus: PlatformTenantApprovalStatus;
  defaultPolicyName: string;
} {
  switch (mode) {
    case "formal":
      return {
        status: "paid",
        plan: "business",
        billingStatus: "active",
        lifecycleStage: "active_onboarding",
        approvalStatus: "not_required",
        defaultPolicyName: "Standard Production Policy",
      };
    case "advanced":
      return {
        status: "suspended",
        plan: "custom",
        billingStatus: "approval_pending",
        lifecycleStage: "governance_review",
        approvalStatus: "pending",
        defaultPolicyName: "Advanced Governance Policy",
      };
    case "quick-trial":
    default:
      return {
        status: "trial",
        plan: "trial",
        billingStatus: "trialing",
        lifecycleStage: "trial_onboarding",
        approvalStatus: "not_required",
        defaultPolicyName: "Starter Trial Policy",
      };
  }
}

export function slugifyTenant(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

export function uniqueSlug(store: PlatformAuthStore, baseName: string): string {
  const base = slugifyTenant(baseName);
  let candidate = base;
  let index = 2;
  const existing = new Set(
    Object.values(store.enterprises)
      .map((enterprise) => enterprise.slug.trim())
      .filter(Boolean),
  );
  while (existing.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createEnterpriseWithPendingAdminActivation(params: {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  enterpriseName: string;
  adminName: string;
  adminEmail: string;
  trialDays?: unknown;
  seatCount?: unknown;
  createdSource: EnterpriseCreatedSource;
  creationMode?: unknown;
  createdByPlatformUserId?: string;
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
  contactName?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  companySize?: unknown;
  industry?: unknown;
  contactSource?: PlatformAuthEnterpriseContactSource;
}): {
  enterprise: PlatformAuthEnterprise;
  provision: PlatformAuthEnterpriseAdminProvision;
  plainCode: string;
  expiresAt: string;
} {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const slug = uniqueSlug(params.store, params.enterpriseName);
  const enterpriseId = `${slug}-${randomUUID().slice(0, 8)}`;
  const trialDays = toTrialDays(params.store.policy, params.trialDays);
  const seatQuota = toTrialSeats(params.store.policy, params.seatCount);
  const trialEndsAt = new Date(now + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const creationMode = normalizeTenantCreationMode(params.creationMode);
  const creationDefaults = tenantCreationDefaults(creationMode);
  const enterprise: PlatformAuthEnterprise = {
    id: enterpriseId,
    name: params.enterpriseName,
    slug,
    status: creationDefaults.status,
    plan: creationDefaults.plan,
    createdSource: params.createdSource,
    creationMode,
    lifecycleStage: creationDefaults.lifecycleStage,
    approvalStatus: creationDefaults.approvalStatus,
    defaultPolicyName: creationDefaults.defaultPolicyName,
    ...(params.createdByPlatformUserId
      ? { createdByPlatformUserId: params.createdByPlatformUserId }
      : {}),
    billingStatus: creationDefaults.billingStatus,
    createdAt: nowIso,
    updatedAt: nowIso,
    trialStartedAt: nowIso,
    trialEndsAt,
    trialDaysSnapshot: trialDays,
    trialSeatQuotaSnapshot: seatQuota,
    seatQuota,
    seatUsed: 0,
    contact: buildEnterpriseContact({
      adminName: params.adminName,
      adminEmail: params.adminEmail,
      contactName: params.contactName,
      contactEmail: params.contactEmail,
      contactPhone: params.contactPhone,
      companySize: params.companySize,
      industry: params.industry,
      source:
        params.contactSource ??
        (params.createdSource === "platform-created" ? "platform-created" : "admin-provision"),
      nowIso,
    }),
    allowReadOnlyAfterExpiry: true,
    ...(params.upgradeUrl || params.store.policy.upgradeUrl
      ? { upgradeUrl: params.upgradeUrl || params.store.policy.upgradeUrl }
      : {}),
    ...(params.contactAdvisorUrl || params.store.policy.contactAdvisorUrl
      ? {
          contactAdvisorUrl: params.contactAdvisorUrl || params.store.policy.contactAdvisorUrl,
        }
      : {}),
  };
  params.store.enterprises[enterpriseId] = enterprise;
  const provision: PlatformAuthEnterpriseAdminProvision = {
    id: randomUUID(),
    enterpriseId,
    adminName: params.adminName,
    adminEmail: params.adminEmail,
    normalizedAdminEmail: params.adminEmail,
    status: "pending_activation",
    ...(params.createdByPlatformUserId ? { createdByUserId: params.createdByPlatformUserId } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  params.store.adminProvisions[provision.id] = provision;
  const expiresAt = new Date(now + params.config.activationTtlHours * 60 * 60 * 1000).toISOString();
  const { plainCode } = issueActivationCode({
    store: params.store,
    enterpriseId,
    provisionId: provision.id,
    email: params.adminEmail,
    ...(params.createdByPlatformUserId ? { issuedByUserId: params.createdByPlatformUserId } : {}),
    codeType: "enterpriseAdminActivation",
    expiresAt,
  });
  // Official A/B packs: grant starter + cn-office (or plan-resolved packs) at create time.
  // Failures must not block tenant creation — seed scripts remain the recovery path.
  try {
    entitleTenantForPlan({
      tenantId: enterpriseId,
      plan: enterprise.plan,
      source: "auto-provision",
    });
  } catch (error) {
    console.warn(
      `[enterprise-provisioning] entitleTenantForPlan failed for ${enterpriseId}: ${String(error)}`,
    );
  }
  return { enterprise, provision, plainCode, expiresAt };
}

/** Attach a pending enterprise-admin activation to an existing tenant. */
export function createPendingAdminActivationForEnterprise(params: {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  enterpriseId: string;
  adminName: string;
  adminEmail: string;
  createdByPlatformUserId?: string;
}): {
  provision: PlatformAuthEnterpriseAdminProvision;
  plainCode: string;
  expiresAt: string;
} {
  const enterprise = params.store.enterprises[params.enterpriseId];
  if (!enterprise) {
    throw new Error(`enterprise not found: ${params.enterpriseId}`);
  }
  const nowIso = new Date().toISOString();
  for (const existing of Object.values(params.store.adminProvisions)) {
    if (existing.enterpriseId === params.enterpriseId && existing.status === "pending_activation") {
      existing.status = "revoked";
      existing.revokedReason = "replaced_by_platform_admin_update";
      existing.updatedAt = nowIso;
    }
  }
  const provision: PlatformAuthEnterpriseAdminProvision = {
    id: randomUUID(),
    enterpriseId: params.enterpriseId,
    adminName: params.adminName,
    adminEmail: params.adminEmail,
    normalizedAdminEmail: params.adminEmail,
    status: "pending_activation",
    ...(params.createdByPlatformUserId ? { createdByUserId: params.createdByPlatformUserId } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  params.store.adminProvisions[provision.id] = provision;
  const expiresAt = new Date(
    Date.now() + params.config.activationTtlHours * 60 * 60 * 1000,
  ).toISOString();
  const { plainCode } = issueActivationCode({
    store: params.store,
    enterpriseId: params.enterpriseId,
    provisionId: provision.id,
    email: params.adminEmail,
    ...(params.createdByPlatformUserId ? { issuedByUserId: params.createdByPlatformUserId } : {}),
    codeType: "enterpriseAdminActivation",
    expiresAt,
  });
  return { provision, plainCode, expiresAt };
}
