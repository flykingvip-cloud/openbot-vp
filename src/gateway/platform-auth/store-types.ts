import type {
  ControlUiPlatformMembershipRole,
  ControlUiPlatformAuthMode,
  ControlUiPlatformRole,
  ControlUiPlatformTenantLifecycleStage,
} from "../control-ui-contract.js";
import type { GatewayRole } from "../role-policy.js";

export type PlatformMembershipRole = ControlUiPlatformMembershipRole;

export type PlatformAuthMode = ControlUiPlatformAuthMode;

export type PlatformAuthPlatformRole = ControlUiPlatformRole;

export type PlatformTenantCreationMode = "quick-trial" | "formal" | "advanced";

export type PlatformTenantLifecycleStage = ControlUiPlatformTenantLifecycleStage;

export type PlatformTenantApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export type EnterpriseStatus = "trial" | "paid" | "suspended" | "expired";

export type EnterpriseCreatedSource = "self-service" | "platform-created";

export type PlatformAuthTrialExpiryPolicy = "redirect_to_upgrade" | "redirect_to_sales" | "choose";

/**
 * What happens to a tenant when its trial reaches `trialEndsAt`.
 * - `auto_stop` (default): expire immediately and hard-stop access (read-only NOT allowed).
 * - `read_only`: expire but keep read-only access (`allowReadOnlyAfterExpiry` becomes true).
 * - `grace_period`: keep full trial access for `trialGraceDays` more days, then auto-stop.
 *
 * Set as a platform-wide default on `PlatformAuthPlatformPolicy.trialExpiryHandling`
 * and optionally overridden per tenant via `PlatformAuthEnterprise.expiryHandling`.
 */
export type PlatformAuthTrialExpiryHandling = "auto_stop" | "read_only" | "grace_period";

/**
 * Where an enterprise contact record was sourced from. Purely informational; it
 * lets the platform directory show whether contact details came from a trial
 * application, the admin-activation provision, an operator-typed form, or a
 * backfill derived from the existing admin membership.
 */
export type PlatformAuthEnterpriseContactSource =
  | "trial-application"
  | "admin-provision"
  | "platform-created"
  | "manual";

/**
 * Persistent tenant contact / registration profile stored on the enterprise
 * record so platform operators can always reach a tenant. Fields are optional
 * because different creation paths capture different amounts of detail; the
 * provisioning factory guarantees at least the admin contact is populated.
 */
export type PlatformAuthEnterpriseContact = {
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  companySize?: string;
  industry?: string;
  source?: PlatformAuthEnterpriseContactSource;
  updatedAt?: string;
};

export type PlatformAuthUserStatus = "active" | "suspended";

export type PlatformAuthUserSource =
  | "self-created"
  | "admin-activated"
  | "employee-activated"
  | "platform-created"
  | "platform-operator"
  | "legacy";

export type PlatformAuthActivationType =
  | "employeeActivation"
  | "enterpriseAdminActivation"
  /**
   * Enterprise-side co-admin invite: an existing tenant `member` is invited by an
   * enterprise admin to also hold `enterprise-admin` (dual identity). Accepting
   * never touches the password; it only adds the second membership.
   */
  | "enterpriseCoAdminInvite"
  | "passwordReset";

export type PlatformAuthActivationStatus = "active" | "claimed" | "revoked" | "expired";

export type PlatformAuthProvisionStatus = "pending_activation" | "activated" | "revoked";

export type PlatformAuthEnterprise = {
  id: string;
  name: string;
  slug: string;
  status: EnterpriseStatus;
  plan: string;
  createdSource: EnterpriseCreatedSource;
  creationMode?: PlatformTenantCreationMode;
  lifecycleStage?: PlatformTenantLifecycleStage;
  approvalStatus?: PlatformTenantApprovalStatus;
  defaultPolicyName?: string;
  createdByPlatformUserId?: string;
  billingStatus: string;
  createdAt: string;
  updatedAt: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  trialExpiredAt?: string;
  trialDaysSnapshot?: number;
  trialSeatQuotaSnapshot?: number;
  seatQuota: number;
  seatUsed: number;
  expiredHandledAt?: string;
  allowReadOnlyAfterExpiry?: boolean;
  /**
   * Per-tenant override of the platform trial-expiry handling. When unset the
   * platform default (`PlatformAuthPlatformPolicy.trialExpiryHandling`) applies.
   */
  expiryHandling?: PlatformAuthTrialExpiryHandling;
  /**
   * When in a `grace_period` after `trialEndsAt`, the ISO timestamp at which the
   * grace window closes and the tenant is hard-expired. Cleared on expiry/extend.
   */
  graceEndsAt?: string;
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
  salesOwnerId?: string;
  /** Persistent tenant contact / registration profile (see type docs). */
  contact?: PlatformAuthEnterpriseContact;
};

export type PlatformAuthUser = {
  id: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  passwordHash: string;
  passwordUpdatedAt: string;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  loginFailedCount: number;
  lockedUntil?: string;
  status: PlatformAuthUserStatus;
  source: PlatformAuthUserSource;
  platformAdmin?: boolean;
  platformRole?: PlatformAuthPlatformRole;
  role: GatewayRole;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuthSessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  sessionIssuedAt: string;
  /** Last cookie or gateway RPC that resolved this login session. Idle policy reads this, not updatedAt. */
  lastActivityAt?: string;
  expiresAt: string;
  domain?: "platform" | "enterprise" | "employee";
  /**
   * Effective session kind pinned at issuance time, derived from the *login
   * entry* (platform / enterprise / employee) rather than the user's intrinsic
   * role. This lets a platform super-admin act as a normal employee when they
   * sign in through the employee entry. Legacy records without this field fall
   * back to role-derived resolution on read.
   */
  sessionKind?: "platform-super-admin" | "platform-admin" | PlatformMembershipRole;
  /**
   * Exact, server-validated enterprise context for enterprise/employee sessions.
   * New scoped sessions always persist this together with `enterpriseId`.
   */
  membershipId?: string;
  /** Paired with `membershipId`; platform sessions intentionally omit both fields. */
  enterpriseId?: string;
  /**
   * True only when this platform session was issued after a successful
   * authenticator check. Absent on legacy sessions and on employee/enterprise
   * sessions. Readers must not reject a missing flag; new platform logins set it.
   */
  mfaVerified?: boolean;
};

export type PlatformAuthMembership = {
  id: string;
  userId: string;
  enterpriseId: string;
  membershipRole: PlatformMembershipRole;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuthEnterpriseAdminProvision = {
  id: string;
  enterpriseId: string;
  adminName: string;
  adminEmail: string;
  normalizedAdminEmail: string;
  status: PlatformAuthProvisionStatus;
  createdByUserId?: string;
  activatedUserId?: string;
  activatedAt?: string;
  revokedReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuthEmployeeProvision = {
  id: string;
  assignmentId?: string;
  assignmentType?: "new_hire" | "internal";
  enterpriseId: string;
  seatId: string;
  employeeName: string;
  employeeEmail: string;
  normalizedEmployeeEmail: string;
  status: PlatformAuthProvisionStatus;
  createdByUserId: string;
  activatedUserId?: string;
  activatedAt?: string;
  revokedReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuthActivationCode = {
  id: string;
  enterpriseId?: string;
  provisionId?: string;
  userId?: string;
  email: string;
  normalizedEmail: string;
  codeHash: string;
  displayCode: string;
  codeType: PlatformAuthActivationType;
  status: PlatformAuthActivationStatus;
  attemptCount: number;
  maxAttempts: number;
  issuedByUserId?: string;
  deliveryChannel: "email" | "manual";
  replacedByCodeId?: string;
  replacesCodeId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  claimedAt?: string;
  claimedByUserId?: string;
  revokedAt?: string;
};

export type PlatformAuthPlatformPolicy = {
  defaultTrialDays: number;
  allowedTrialDays: number[];
  defaultTrialSeatCount: number;
  trialSeatOptions: number[];
  allowCustomTrialSeatCount: boolean;
  trialExpiryPolicy: PlatformAuthTrialExpiryPolicy;
  /** What happens when a trial hits `trialEndsAt`. Platform-wide default; auto_stop unless changed. */
  trialExpiryHandling: PlatformAuthTrialExpiryHandling;
  /** Extra days of full access after `trialEndsAt` when handling is `grace_period` (0 = no grace). */
  trialGraceDays: number;
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
  updatedAt: string;
};

export type PlatformTrialApplyMode = "auto" | "auto_with_sales" | "manual";

export type PlatformTrialApplicationStatus = "pending" | "approved" | "rejected" | "converted";

export type PlatformAuthTrialApplication = {
  id: string;
  companyName: string;
  contactName: string;
  workEmail: string;
  normalizedWorkEmail: string;
  expectedUsers: number;
  useCase: string;
  companySize?: string;
  needsDemo: boolean;
  industry?: string;
  mode: PlatformTrialApplyMode;
  highIntentLead: boolean;
  reviewReasons: string[];
  status: PlatformTrialApplicationStatus;
  reviewedAt?: string;
  reviewedByPlatformUserId?: string;
  reviewNote?: string;
  rejectionReason?: string;
  enterpriseId?: string;
  provisionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuthLeadNotificationType =
  | "admin-activation-email"
  | "employee-activation-email"
  | "enterprise-co-admin-invite-email"
  | "password-reset-email"
  | "sales-follow-up"
  | "seat-assignment-offer-email"
  | "seat-assignment-offer-reminder-email";

export type PlatformAuthLeadNotification = {
  id: string;
  type: PlatformAuthLeadNotificationType;
  trialApplicationId?: string;
  email?: string;
  enterpriseId?: string;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "delivery_failed";
  deliveredAt?: string;
  deliveryMessageId?: string;
  deliveryReason?: string;
  deliveryError?: string;
  createdAt: string;
};

export type PlatformAuthTrustedProxySession = {
  provider: "trusted-proxy";
  user: string;
  displayName?: string;
  /** Exact server-validated membership; present only for scoped sessions. */
  membershipId?: string;
  /** Enterprise paired with `membershipId`; authoritative when both are present. */
  enterpriseId?: string;
  /** Compatibility tenant hint; it is not an authority source on its own. */
  tenantId?: string;
  role?: GatewayRole;
  scopes?: string[];
  domain?: "platform" | "enterprise" | "employee";
  sessionKind?: "platform-super-admin" | "platform-admin" | PlatformMembershipRole;
};

export type PlatformAuthSessionContext = {
  user: PlatformAuthUser;
  membership: PlatformAuthMembership | null;
  enterprise: PlatformAuthEnterprise | null;
  session: PlatformAuthTrustedProxySession;
  sessionKind: "platform-super-admin" | "platform-admin" | PlatformMembershipRole;
};

export type PlatformAuthSecurityPolicy = {
  /**
   * Runtime override for `requireMfaForPlatformAdmins`. When undefined, the
   * effective value falls back to the resolved config default. Persisted in the
   * platform-auth store so a super-admin can toggle it without a gateway restart.
   */
  requireMfaForPlatformAdmins?: boolean;
  updatedAt?: string;
  updatedByUserId?: string;
};

export type PlatformAuthStore = {
  version: number;
  secret: string;
  policy: PlatformAuthPlatformPolicy;
  securityPolicy?: PlatformAuthSecurityPolicy;
  enterprises: Record<string, PlatformAuthEnterprise>;
  users: Record<string, PlatformAuthUser>;
  sessions: Record<string, PlatformAuthSessionRecord>;
  memberships: Record<string, PlatformAuthMembership>;
  adminProvisions: Record<string, PlatformAuthEnterpriseAdminProvision>;
  employeeProvisions: Record<string, PlatformAuthEmployeeProvision>;
  activationCodes: Record<string, PlatformAuthActivationCode>;
  trialApplications: Record<string, PlatformAuthTrialApplication>;
  leadNotifications: Record<string, PlatformAuthLeadNotification>;
};

export type LegacyPlatformAuthTenant = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type LegacyPlatformAuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  tenantId: string;
  role: GatewayRole;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type LegacyPlatformAuthMembership = {
  id: string;
  userId: string;
  tenantId: string;
  membershipRole: PlatformMembershipRole;
  createdAt: string;
  updatedAt: string;
};

export type LegacyPlatformAuthSession = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type LegacyPlatformAuthStore = {
  version?: number;
  secret: string;
  tenants: Record<string, LegacyPlatformAuthTenant>;
  users: Record<string, LegacyPlatformAuthUser>;
  sessions: Record<string, LegacyPlatformAuthSession>;
  memberships?: Record<string, LegacyPlatformAuthMembership>;
};
