/**
 * Agent-facing enterprise customer attribute summary (schema v1).
 *
 * Purpose: give digital humans a stable, read-only projection of trial /
 * enterprise / contact fields so they can classify and adapt later.
 *
 * Non-goals (explicitly out of scope):
 * - sales routing / owner assignment product
 * - nurture / auto follow-up workflows
 * - OpenBot-operator-specific ops surfaces
 */

import { isValidEmail } from "./request-helpers.js";
import type {
  EnterpriseStatus,
  PlatformAuthEnterprise,
  PlatformAuthMembership,
  PlatformAuthStore,
  PlatformAuthTrialApplication,
  PlatformAuthUser,
  PlatformTrialApplyMode,
} from "./store-types.js";

export const ENTERPRISE_CUSTOMER_ATTRIBUTES_SCHEMA_VERSION = 1 as const;

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "foxmail.com",
  "yeah.net",
  "proton.me",
  "protonmail.com",
]);

export type EnterpriseCustomerEmailKind = "free" | "enterprise" | "unknown";

export type EnterpriseCustomerAttributesV1 = {
  schemaVersion: typeof ENTERPRISE_CUSTOMER_ATTRIBUTES_SCHEMA_VERSION;
  generatedAt: string;
  enterprise: {
    id: string;
    name: string;
    slug: string;
    status: EnterpriseStatus;
    plan: string;
    createdSource: string;
    creationMode?: string;
    lifecycleStage?: string;
    billingStatus: string;
    seatQuota: number;
    seatUsed: number;
    trial: {
      startedAt?: string;
      endsAt?: string;
      expiredAt?: string;
      daysSnapshot?: number;
      /** Whole days remaining until trialEndsAt; null when not applicable. */
      daysRemaining: number | null;
      allowReadOnlyAfterExpiry?: boolean;
    };
    upgradeUrl?: string;
    contactAdvisorUrl?: string;
  };
  contact?: {
    email?: string;
    displayName?: string;
    membershipRole?: string;
    userStatus?: string;
    emailDomain?: string;
    emailKind?: EnterpriseCustomerEmailKind;
    activated?: boolean;
  };
  application?: {
    id: string;
    mode: PlatformTrialApplyMode;
    highIntentLead: boolean;
    reviewReasons: string[];
    expectedUsers: number;
    useCase: string;
    companySize?: string;
    industry?: string;
    needsDemo: boolean;
    status: string;
  };
  /**
   * Soft classification tags for agent consumption only.
   * Not a CRM assignment; agents may ignore or re-derive.
   */
  segmentHints: string[];
};

function emailDomain(email: string | undefined): string | undefined {
  if (!email || !isValidEmail(email)) {
    return undefined;
  }
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return undefined;
  }
  return email.slice(at + 1).toLowerCase();
}

export function classifyEmailKind(email: string | undefined): EnterpriseCustomerEmailKind {
  const domain = emailDomain(email);
  if (!domain) {
    return "unknown";
  }
  return FREE_EMAIL_DOMAINS.has(domain) ? "free" : "enterprise";
}

export function computeTrialDaysRemaining(
  enterprise: Pick<PlatformAuthEnterprise, "status" | "trialEndsAt">,
  nowMs = Date.now(),
): number | null {
  if (!enterprise.trialEndsAt) {
    return null;
  }
  const ends = Number(new Date(enterprise.trialEndsAt));
  if (!Number.isFinite(ends)) {
    return null;
  }
  return Math.ceil((ends - nowMs) / (24 * 60 * 60 * 1000));
}

/**
 * Derive non-binding segment hints from existing trial/enterprise fields.
 * Mirrors decideTrialApplyMode inputs without inventing an assignment system.
 */
export function deriveEnterpriseSegmentHints(params: {
  enterprise: PlatformAuthEnterprise;
  application?: PlatformAuthTrialApplication | null;
  contactEmail?: string;
  daysRemaining: number | null;
}): string[] {
  const hints = new Set<string>();
  const { enterprise, application, contactEmail, daysRemaining } = params;

  hints.add(`status:${enterprise.status}`);
  if (enterprise.createdSource) {
    hints.add(`source:${enterprise.createdSource}`);
  }
  if (enterprise.creationMode) {
    hints.add(`creation_mode:${enterprise.creationMode}`);
  }

  const emailKind = classifyEmailKind(contactEmail ?? application?.workEmail);
  if (emailKind !== "unknown") {
    hints.add(`email:${emailKind}`);
  }

  const expectedUsers = application?.expectedUsers;
  if (typeof expectedUsers === "number" && Number.isFinite(expectedUsers)) {
    if (expectedUsers <= 20) {
      hints.add("team:small");
    } else if (expectedUsers <= 50) {
      hints.add("team:mid");
    } else {
      hints.add("team:large");
    }
  } else if (enterprise.seatQuota > 0) {
    if (enterprise.seatQuota <= 5) {
      hints.add("team:small");
    } else if (enterprise.seatQuota <= 10) {
      hints.add("team:mid");
    } else {
      hints.add("team:large");
    }
  }

  if (application) {
    hints.add(`apply_mode:${application.mode}`);
    if (application.highIntentLead) {
      hints.add("intent:high");
    }
    if (application.needsDemo) {
      hints.add("needs_demo");
    }
    for (const reason of application.reviewReasons ?? []) {
      if (reason.trim()) {
        hints.add(`review:${reason.trim()}`);
      }
    }
    if (application.industry?.trim()) {
      hints.add(`industry:${application.industry.trim().toLowerCase()}`);
    }
  }

  if (enterprise.status === "trial" && daysRemaining !== null) {
    if (daysRemaining > 7) {
      hints.add("trial_window:early");
    } else if (daysRemaining > 3) {
      hints.add("trial_window:mid");
    } else if (daysRemaining > 0) {
      hints.add("trial_window:late");
    } else {
      hints.add("trial_window:due");
    }
  }
  if (enterprise.status === "expired") {
    hints.add("trial_window:expired");
  }

  return [...hints].toSorted((a, b) => a.localeCompare(b));
}

export function findLinkedTrialApplication(
  store: PlatformAuthStore,
  enterpriseId: string,
): PlatformAuthTrialApplication | undefined {
  const matches = Object.values(store.trialApplications).filter(
    (entry) => entry.enterpriseId === enterpriseId,
  );
  if (matches.length === 0) {
    return undefined;
  }
  return matches.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function findPrimaryEnterpriseAdminContact(
  store: PlatformAuthStore,
  enterpriseId: string,
): {
  user?: PlatformAuthUser;
  membership?: PlatformAuthMembership;
  email?: string;
  displayName?: string;
  activated: boolean;
  updatedAt?: string;
  source?: "trial-application" | "admin-provision" | "platform-created" | "manual";
} {
  const memberships = Object.values(store.memberships).filter(
    (entry) => entry.enterpriseId === enterpriseId && entry.membershipRole === "enterprise-admin",
  );
  for (const membership of memberships) {
    const user = store.users[membership.userId];
    if (user) {
      return {
        user,
        membership,
        email: user.email,
        displayName: user.displayName,
        activated: true,
        updatedAt: user.updatedAt || membership.updatedAt,
        source: "manual",
      };
    }
  }
  const pending = Object.values(store.adminProvisions).find(
    (entry) => entry.enterpriseId === enterpriseId && entry.status === "pending_activation",
  );
  if (pending) {
    return {
      email: pending.adminEmail,
      displayName: pending.adminName,
      activated: false,
      updatedAt: pending.updatedAt,
      source: "admin-provision",
    };
  }
  const application = findLinkedTrialApplication(store, enterpriseId);
  if (application?.workEmail || application?.contactName) {
    return {
      email: application.workEmail,
      displayName: application.contactName,
      activated: false,
      updatedAt: application.updatedAt,
      source: "trial-application",
    };
  }
  return { activated: false };
}

/** Directory-facing contact projection for platform enterprise summaries. */
export function resolveEnterpriseDirectoryContact(
  store: PlatformAuthStore,
  enterpriseId: string,
):
  | {
      contactName?: string;
      contactEmail?: string;
      source?: "trial-application" | "admin-provision" | "platform-created" | "manual";
      status?: "pending_activation" | "activated";
      updatedAt?: string;
    }
  | undefined {
  const primary = findPrimaryEnterpriseAdminContact(store, enterpriseId);
  if (!primary.email && !primary.displayName) {
    return undefined;
  }
  return {
    ...(primary.displayName ? { contactName: primary.displayName } : {}),
    ...(primary.email ? { contactEmail: primary.email } : {}),
    ...(primary.source ? { source: primary.source } : {}),
    status: primary.activated ? "activated" : "pending_activation",
    ...(primary.updatedAt ? { updatedAt: primary.updatedAt } : {}),
  };
}

export function buildEnterpriseCustomerAttributes(params: {
  store: PlatformAuthStore;
  enterpriseId: string;
  nowMs?: number;
}): EnterpriseCustomerAttributesV1 | null {
  const enterprise = params.store.enterprises[params.enterpriseId];
  if (!enterprise) {
    return null;
  }
  const nowMs = params.nowMs ?? Date.now();
  const application = findLinkedTrialApplication(params.store, params.enterpriseId);
  const contact = findPrimaryEnterpriseAdminContact(params.store, params.enterpriseId);
  const contactEmail = contact.email ?? application?.workEmail;
  const daysRemaining = computeTrialDaysRemaining(enterprise, nowMs);
  const emailKind = classifyEmailKind(contactEmail);

  return {
    schemaVersion: ENTERPRISE_CUSTOMER_ATTRIBUTES_SCHEMA_VERSION,
    generatedAt: new Date(nowMs).toISOString(),
    enterprise: {
      id: enterprise.id,
      name: enterprise.name,
      slug: enterprise.slug,
      status: enterprise.status,
      plan: enterprise.plan,
      createdSource: enterprise.createdSource,
      ...(enterprise.creationMode ? { creationMode: enterprise.creationMode } : {}),
      ...(enterprise.lifecycleStage ? { lifecycleStage: enterprise.lifecycleStage } : {}),
      billingStatus: enterprise.billingStatus,
      seatQuota: enterprise.seatQuota,
      seatUsed: enterprise.seatUsed,
      trial: {
        ...(enterprise.trialStartedAt ? { startedAt: enterprise.trialStartedAt } : {}),
        ...(enterprise.trialEndsAt ? { endsAt: enterprise.trialEndsAt } : {}),
        ...(enterprise.trialExpiredAt ? { expiredAt: enterprise.trialExpiredAt } : {}),
        ...(enterprise.trialDaysSnapshot !== undefined
          ? { daysSnapshot: enterprise.trialDaysSnapshot }
          : {}),
        daysRemaining,
        ...(enterprise.allowReadOnlyAfterExpiry !== undefined
          ? { allowReadOnlyAfterExpiry: enterprise.allowReadOnlyAfterExpiry }
          : {}),
      },
      ...(enterprise.upgradeUrl ? { upgradeUrl: enterprise.upgradeUrl } : {}),
      ...(enterprise.contactAdvisorUrl ? { contactAdvisorUrl: enterprise.contactAdvisorUrl } : {}),
    },
    ...(contactEmail || contact.displayName
      ? {
          contact: {
            ...(contactEmail ? { email: contactEmail } : {}),
            ...(contact.displayName ? { displayName: contact.displayName } : {}),
            ...(contact.membership?.membershipRole
              ? { membershipRole: contact.membership.membershipRole }
              : {}),
            ...(contact.user?.status ? { userStatus: contact.user.status } : {}),
            ...(emailDomain(contactEmail) ? { emailDomain: emailDomain(contactEmail) } : {}),
            emailKind,
            activated: contact.activated,
          },
        }
      : {}),
    ...(application
      ? {
          application: {
            id: application.id,
            mode: application.mode,
            highIntentLead: application.highIntentLead,
            reviewReasons: [...application.reviewReasons],
            expectedUsers: application.expectedUsers,
            useCase: application.useCase,
            ...(application.companySize ? { companySize: application.companySize } : {}),
            ...(application.industry ? { industry: application.industry } : {}),
            needsDemo: application.needsDemo,
            status: application.status,
          },
        }
      : {}),
    segmentHints: deriveEnterpriseSegmentHints({
      enterprise,
      application,
      contactEmail,
      daysRemaining,
    }),
  };
}
