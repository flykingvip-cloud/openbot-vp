export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openbot/control-ui-config.json";
export const CONTROL_UI_PLATFORM_AUTH_BASE_PATH = "/__openbot/platform-auth";
export const CONTROL_UI_ENTERPRISE_BASE_PATH = "/__openbot/enterprise";
export const CONTROL_UI_ENTERPRISE_DATA_BASE_PATH = "/__openbot/enterprise-data";
export const CONTROL_UI_USER_OPERATIONAL_IDENTITY_BASE_PATH =
  "/__openbot/user-operational-identity";
export const CONTROL_UI_WECHAT_COMPONENT_WEBHOOK_PATH = "/__openbot/wechat-component-webhook";

function withControlUiBasePath(basePath: string | undefined, suffix: string): string {
  const normalizedBasePath = basePath?.trim() || "";
  return normalizedBasePath ? `${normalizedBasePath}${suffix}` : suffix;
}

export function resolveControlUiBootstrapConfigPath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_BOOTSTRAP_CONFIG_PATH);
}

export function resolveControlUiPlatformAuthBasePath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_PLATFORM_AUTH_BASE_PATH);
}

export function resolveControlUiEnterpriseBasePath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_ENTERPRISE_BASE_PATH);
}

export function resolveControlUiEnterpriseDataBasePath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_ENTERPRISE_DATA_BASE_PATH);
}

export function resolveControlUiUserOperationalIdentityBasePath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_USER_OPERATIONAL_IDENTITY_BASE_PATH);
}

export function resolveControlUiWechatComponentWebhookPath(basePath?: string): string {
  return withControlUiBasePath(basePath, CONTROL_UI_WECHAT_COMPONENT_WEBHOOK_PATH);
}

export type ControlUiAuthMode = "none" | "token" | "password" | "trusted-proxy";

export type ControlUiTrustedProxySession = {
  provider: "trusted-proxy";
  user: string;
  email?: string;
  displayName?: string;
  tenantId?: string;
  role?: string;
  scopes?: string[];
};

export type ControlUiPlatformMembershipRole = "enterprise-admin" | "member";

export type ControlUiPlatformRole = "super-admin" | "admin";

export type ControlUiPlatformAuthMode =
  | "platform-bootstrap"
  | "platform-super-admin-login"
  | "platform-admin-login"
  | "enterprise-create"
  | "employee-register"
  | "enterprise-activate"
  | "login"
  | "forgot-password"
  | "password-reset"
  | "platform-enterprise-create";

export type ControlUiPlatformSessionKind =
  | "platform-super-admin"
  | "platform-admin"
  | "enterprise-admin"
  | "member";

export type ControlUiPlatformMember = {
  user: string;
  /** Platform auth user id (employeeId in credential steward bindings). */
  userId?: string;
  displayName?: string;
  membershipRole: ControlUiPlatformMembershipRole;
  status?: "active" | "suspended";
  seatTitle?: string;
  seatStatus?: "vacant" | "assigned" | "occupied" | "handover_pending" | "frozen";
  seatTeamLabel?: string;
  joinedAt?: string;
  isCurrentUser?: boolean;
  /**
   * Every membership role this user holds in the enterprise. A dual-identity
   * account (employee promoted to co-admin) lists both `member` and
   * `enterprise-admin`; `membershipRole` stays the highest role.
   */
  membershipRoles?: ControlUiPlatformMembershipRole[];
  /** Expiry of a pending enterprise co-admin invite sent to this member. */
  adminInvitePendingExpiresAt?: string;
};

export type ControlUiPlatformPendingCode = {
  kind: "employee-activation" | "enterprise-admin-activation" | "password-reset";
  assignmentId?: string;
  email: string;
  code: string;
  expiresAt: string;
  enterpriseName?: string;
  /** Enterprise id for admin-activation resend / success-page wiring. */
  enterpriseId?: string;
  /** Absolute deep-link for admin/employee activation (biz/www origin). */
  activationUrl?: string;
};

export type ControlUiPlatformSeatSummary = {
  seatId: string;
  title: string;
  teamLabel?: string;
  responsibility?: string;
  roleCode?: string;
  status: "vacant" | "assigned" | "occupied" | "handover_pending" | "frozen";
  currentEmployeeUser?: string;
  currentEmployeeDisplayName?: string;
  pendingEmployeeUser?: string;
  pendingEmployeeDisplayName?: string;
  pendingAssignmentId?: string;
  pendingActivationExpiresAt?: string;
  defaultAgentId?: string;
  agentIds?: string[];
  defaultSpaceIds?: string[];
  memoryScopeIds?: string[];
  memoryScopes?: Array<{
    scopeId: string;
    transferClass: "inheritable" | "review_required" | "private";
  }>;
  connectorIds?: string[];
  connectorProfiles?: Array<{
    profileId: string;
    credentialReauthorizationRequired: boolean;
  }>;
  activeBindingStatus?: "active" | "suspended" | "revoked" | "completed";
};

export type ControlUiPlatformHandoverSummary = {
  handoverCaseId: string;
  seatId: string;
  seatTitle: string;
  status: "draft" | "asset_review" | "pending_approval" | "frozen" | "rebound" | "completed";
  outgoingEmployeeUser?: string;
  incomingEmployeeUser?: string;
  createdAt: string;
  completedAt?: string;
};

export type ControlUiPlatformSeatAssignmentOfferSummary = {
  assignmentId?: string;
  assignmentType?: "new_hire" | "internal";
  offerId: string;
  seatId: string;
  seatTitle: string;
  targetEmployeeUser: string;
  status: "pending" | "accepted" | "declined" | "canceled" | "expired" | "superseded";
  defaultAgentId?: string | null;
  agentIds?: string[];
  defaultSpaceIds?: string[];
  memoryScopeIds?: string[];
  memoryScopes?: Array<{
    scopeId: string;
    transferClass: "inheritable" | "review_required" | "private";
  }>;
  connectorIds?: string[];
  connectorProfileIds?: string[];
  connectorProfiles?: Array<{
    profileId: string;
    credentialReauthorizationRequired: boolean;
  }>;
  connectorCredentialReauthorizationRequired?: boolean;
  reauthorizationRequired?: boolean;
  offeredAt: string;
  expiresAt?: string;
  handoverCaseId?: string;
};

export type ControlUiPlatformOrganizationSnapshot = {
  seatCount: number;
  occupiedSeatCount: number;
  assignedSeatCount?: number;
  vacantSeatCount: number;
  handoverSeatCount: number;
  frozenSeatCount: number;
  pendingOfferCount: number;
  departmentPaths?: string[];
  childOrders?: Record<string, string[]>;
  seats: ControlUiPlatformSeatSummary[];
  handovers: ControlUiPlatformHandoverSummary[];
  offers: ControlUiPlatformSeatAssignmentOfferSummary[];
};

export type ControlUiPlatformEmployeeAccessSnapshot = {
  currentSeat?: {
    seatId: string;
    title: string;
    status: "vacant" | "assigned" | "occupied" | "handover_pending" | "frozen";
    bindingStatus: "active" | "suspended" | "revoked" | "completed";
  } | null;
  defaultAgentId?: string | null;
  agentIds?: string[];
  /** User-owned agent ids from the ownership store (independent of seat grants). */
  ownedAgentIds?: string[];
  /** Platform user id (UUID) for the signed-in employee; session.user is email only. */
  employeeUserId?: string;
  defaultSpaceIds?: string[];
  memoryScopeIds?: string[];
  connectorIds?: string[];
  pendingOffer?: {
    assignmentId?: string;
    assignmentType?: "new_hire" | "internal";
    offerId: string;
    seatId: string;
    seatTitle: string;
    defaultAgentId?: string | null;
    agentIds?: string[];
    omittedAgentIds?: string[];
    defaultSpaceIds?: string[];
    memoryScopeIds?: string[];
    memoryScopes?: Array<{
      scopeId: string;
      transferClass: "inheritable" | "review_required" | "private";
    }>;
    connectorIds?: string[];
    connectorProfileIds?: string[];
    connectorProfiles?: Array<{
      profileId: string;
      credentialReauthorizationRequired: boolean;
    }>;
    connectorCredentialReauthorizationRequired?: boolean;
    reauthorizationRequired?: boolean;
    offeredAt: string;
    expiresAt?: string;
    handoverCaseId?: string;
  } | null;
  notice?: string | null;
};

export type ControlUiPlatformTrialPolicy = {
  defaultTrialDays: number;
  allowedTrialDays: number[];
  defaultTrialSeatCount: number;
  trialSeatOptions: number[];
  allowCustomTrialSeatCount: boolean;
  trialExpiryPolicy: "redirect_to_upgrade" | "redirect_to_sales" | "choose";
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
};

export type ControlUiPlatformTenantCreationMode = "quick-trial" | "formal" | "advanced";

export type ControlUiPlatformTenantLifecycleStage =
  | "trial_onboarding"
  | "active_onboarding"
  | "governance_review"
  | "active"
  | "risk";

export type ControlUiPlatformTenantApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";

export type ControlUiPlatformEnterpriseContact = {
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  companySize?: string;
  industry?: string;
  source?: "trial-application" | "admin-provision" | "platform-created" | "manual";
  /** Whether the primary enterprise admin has completed activation. */
  status?: "pending_activation" | "activated";
  updatedAt?: string;
};

export type ControlUiPlatformEnterpriseSummary = {
  id: string;
  name: string;
  /**
   * Server-confirmed observation tenant authorization for platform display.
   * Only `granted` / `none` are results; omit or use `unknown` until confirmed.
   */
  tenantGrant?: "granted" | "none" | "unknown";
  status: "trial" | "paid" | "suspended" | "expired";
  plan: string;
  billingStatus: string;
  createdSource: "self-service" | "platform-created";
  creationMode?: ControlUiPlatformTenantCreationMode;
  lifecycleStage?: ControlUiPlatformTenantLifecycleStage;
  approvalStatus?: ControlUiPlatformTenantApprovalStatus;
  defaultPolicyName?: string;
  trialDaysSnapshot?: number;
  seatQuota: number;
  seatUsed: number;
  seatsRemaining: number;
  trialEndsAt?: string;
  /** Active subscription commercial contract window (reminder-only; does not auto-suspend). */
  contractStart?: string;
  contractEnd?: string;
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
  allowReadOnlyAfterExpiry?: boolean;
  expiryHandling?: "auto_stop" | "read_only" | "grace_period";
  graceEndsAt?: string;
  /** Primary enterprise-admin contact resolved from membership / pending provision / trial app. */
  contact?: ControlUiPlatformEnterpriseContact;
  usageSummary?: {
    calls7d?: number;
    cost7d?: number;
    topModelLabel?: string;
    topAgentLabel?: string;
    activeAgentCount?: number;
    activeChannelCount?: number;
    activeRuntimeCount?: number;
    dailyCalls?: number[];
    dailyCost?: number[];
    updatedAt?: number;
  };
  adoptionSummary?: {
    label?: string;
    tone?: "ok" | "warn" | "danger" | "neutral";
    aiActiveUsers?: number;
    automationTaskCount?: number;
    note?: string;
    updatedAt?: number;
  };
  contributionSummary?: {
    submittedAssetPackages?: number;
    approvedAssets?: number;
    incubationCandidates?: number;
    platformCandidates?: number;
    crossTenantReuseCount?: number;
    publishedSharedAssets?: number;
    updatedAt?: number;
  };
  healthSummary?: {
    label?: string;
    tone?: "ok" | "warn" | "danger" | "neutral";
    incidentLabel?: string;
    errorRate?: number;
    successRate?: number;
    fallbackRate?: number;
    avgLatencyMs?: number;
    updatedAt?: number;
  };
};

export type ControlUiPlatformInvite = {
  code: string;
  expiresAt: string;
  tenantId?: string;
  tenantName?: string;
};

export type ControlUiPlatformAdminSummary = {
  user: string;
  displayName?: string;
  platformRole: ControlUiPlatformRole;
  status?: "active" | "suspended";
  scopes?: string[];
  joinedAt?: string;
  isCurrentUser?: boolean;
};

export type ControlUiPlatformAuthState = {
  enabled: boolean;
  hasUsers: boolean;
  hasPlatformAdmins?: boolean;
  allowRegistration?: boolean;
  requiresInvite?: boolean;
  requiresPlatformBootstrap?: boolean;
  /** True when Gateway process can resolve platform SMTP (OPENBOT_SMTP_* / ~/.openbot/.env). */
  smtpConfigured?: boolean;
  availableModes?: ControlUiPlatformAuthMode[];
  sessionKind?: ControlUiPlatformSessionKind;
  /** Surface the server bound this session to. Landing must follow this, not the form intent. */
  sessionDomain?: "platform" | "enterprise" | "employee";
  platformRole?: ControlUiPlatformRole;
  tenantName?: string;
  membershipRole?: ControlUiPlatformMembershipRole;
  canManageInvites?: boolean;
  canManagePlatform?: boolean;
  canManagePlatformAdmins?: boolean;
  latestInvite?: ControlUiPlatformInvite;
  enterprise?: ControlUiPlatformEnterpriseSummary;
  platformPolicy?: ControlUiPlatformTrialPolicy;
  platformEnterprises?: ControlUiPlatformEnterpriseSummary[];
  platformAdmins?: ControlUiPlatformAdminSummary[];
  pendingActivation?: ControlUiPlatformPendingCode;
  pendingPasswordReset?: ControlUiPlatformPendingCode;
  session?: ControlUiTrustedProxySession;
  members?: ControlUiPlatformMember[];
  organization?: ControlUiPlatformOrganizationSnapshot;
  employeeAccess?: ControlUiPlatformEmployeeAccessSnapshot;
  trialApplications?: ControlUiPlatformTrialApplicationSummary[];
  pendingAdminActivations?: ControlUiPlatformPendingAdminActivationSummary[];
  /** Effective MFA policy for platform admins (store override → config default). */
  requireMfaForPlatformAdmins?: boolean;
};

export type ControlUiPlatformTrialApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "converted";

export type ControlUiPlatformTrialApplicationSummary = {
  id: string;
  companyName: string;
  contactName: string;
  workEmail: string;
  expectedUsers: number;
  useCase: string;
  companySize?: string;
  industry?: string;
  needsDemo: boolean;
  mode: "auto" | "auto_with_sales" | "manual";
  highIntentLead: boolean;
  reviewReasons: string[];
  status: ControlUiPlatformTrialApplicationStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  rejectionReason?: string;
  enterpriseId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ControlUiPlatformPendingAdminActivationSummary = {
  provisionId: string;
  enterpriseId: string;
  enterpriseName: string;
  enterpriseStatus: "trial" | "paid" | "suspended" | "expired";
  adminEmail: string;
  adminName: string;
  provisionCreatedAt: string;
  /** Latest activation code status for this provision (if any). */
  latestCodeStatus?: "active" | "expired" | "claimed" | "revoked";
  latestCodeExpiresAt?: string;
  /** True when the latest code is missing, expired, revoked, or near expiry — resend recommended. */
  needsResend: boolean;
};

export type ControlUiPlatformTrialApplicationResult = {
  mode: "auto" | "auto_with_sales" | "manual";
  message: string;
};

export type ControlUiEmailDeliveryResult = {
  status: "sent" | "queued" | "failed";
  reason?: "smtp_not_configured" | "unsupported_notification" | "missing_recipient";
  messageId?: string;
  error?: string;
};

export type ControlUiEmailDeliverySummary = {
  total: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
  queuedReason?: "smtp_not_configured" | "unsupported_notification" | "missing_recipient";
  errors?: string[];
};

export type ControlUiPlatformAuthSuccess = {
  ok: true;
  session?: ControlUiTrustedProxySession;
  platformAuth: ControlUiPlatformAuthState;
  invite?: ControlUiPlatformInvite;
  trialApplication?: ControlUiPlatformTrialApplicationResult;
  emailDelivery?: ControlUiEmailDeliveryResult;
  activationDelivery?: ControlUiEmailDeliverySummary;
  /**
   * Password reset invalidates sessions and does not issue a new one.
   * loginPath is one of the controlled surface login routes.
   */
  passwordReset?: {
    sessionIssued: false;
    returnSurface: "employee" | "enterprise" | "platform" | null;
    loginPath: "/" | "/enterprise/login" | "/platform/login";
  };
};

export type ControlUiMembershipChoice = {
  membershipId: string;
  enterpriseId: string;
  enterpriseName: string;
  role: "member" | "enterprise-admin";
};

export type ControlUiLoginSurface = "employee" | "enterprise" | "platform";

export type ControlUiPlatformAuthError = {
  ok: false;
  code: string;
  error: string;
  membershipChoices?: ControlUiMembershipChoice[];
  loginPath?: "/" | "/enterprise/login" | "/platform/login";
  /** Absolute portal URL for targetSurface. The login itself stays rejected. */
  loginUrl?: string;
  /** Host the request arrived on. */
  requestSurface?: ControlUiLoginSurface;
  /** Surface the login body asked to enter. */
  targetSurface?: ControlUiLoginSurface;
};

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  serverVersion?: string;
  authMode?: ControlUiAuthMode;
  authSession?: ControlUiTrustedProxySession;
  platformAuth?: ControlUiPlatformAuthState;
  platformModels?: {
    mode?: "native" | "aor_enhanced";
  };
  workspaceHost?: {
    platform: string;
    homedir: string;
    supportsNativeDirectoryChooser: boolean;
  };
  dataSpace?: {
    mode: "local" | "managed";
    displayRoot?: string;
  };
};
