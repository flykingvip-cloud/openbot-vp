export type OperationalIdentityOwnerType = "tenant" | "user";

export type UserOperationalIdentityStatus = "active" | "expired" | "reauth_required" | "revoked";

export type UserOperationalIdentityProvider =
  | "github-personal"
  | "personal-email"
  | "wechat-official"
  | "feishu-personal"
  | "wechat-personal"
  | "weibo"
  | "zhihu"
  | "douyin"
  | "xiaohongshu"
  | "kuaishou"
  | "bilibili"
  | "x-twitter";

export type UserOperationalIdentityAuthMode = "oauth" | "manual" | "qr_channel";

export type UserOperationalIdentityManualKind = "wechat_oa" | "social_account" | "smtp";

export type UserOperationalIdentityAgentScope = "owned" | "shared" | "group";

export type UserOperationalIdentityGrantMode = "auto" | "explicit";

export type UserOperationalIdentity = {
  identityId: string;
  ownerType: "user";
  ownerId: string;
  /**
   * Tenant that authorized this identity when bound under a managed seat/membership.
   * Absent for local/personal (unmanaged) identities. Used by governance write sessions
   * and inventory scope — never inferred solely from ownerId.
   */
  tenantId?: string;
  provider: UserOperationalIdentityProvider;
  displayName: string;
  externalAccountId?: string;
  credentialHandleId: string;
  status: UserOperationalIdentityStatus;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  /**
   * Child of an 企业通道 connection. Slice 1b Feishu only.
   * Tokens stay in the credential secret store, not here.
   */
  enterpriseIm?: {
    channel: "feishu";
    accountId: string;
    /** Feishu tenant_key copied from the token exchange. Not an employee-posted id. */
    platformEnterpriseId: string;
    platformUserId: string;
    userGrantedScopes: string[];
    authorizationLevel: "identity_only" | "authorized";
    localCredentialsDeleted?: boolean;
    platformRevokeRecorded?: boolean;
  };
};

export type UserOperationalIdentityGrant = {
  grantId: string;
  identityId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  agentId: string;
  agentScope: UserOperationalIdentityAgentScope;
  allowedActions: string[];
  grantMode: UserOperationalIdentityGrantMode;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  revokedAt?: string;
  /** Explicit confirm version for enterprise IM. Auto grants do not count. */
  grantVersion?: number;
  expiresAt?: string;
};

export type UserOperationalIdentityBindingRequestStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "expired";

export type UserOperationalIdentityBindingRequest = {
  requestId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
  agentId: string;
  agentScope: UserOperationalIdentityAgentScope;
  provider: UserOperationalIdentityProvider;
  requestedAction: string;
  status: UserOperationalIdentityBindingRequestStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

export type UserOperationalIdentityUsageResult = "allowed" | "denied" | "reauth_required";

export type UserOperationalIdentityUsageSummary = {
  headline: string;
  excerpt?: string;
  recipients?: string[];
  subject?: string;
  wordCount?: number;
  attachmentCount?: number;
  repository?: string;
  issueNumber?: number;
  publishKind?: "draft" | "publish" | "broadcast";
  tags?: string[];
  externalId?: string;
};

export type UserOperationalIdentityUsageMetrics = {
  readCount?: number;
  shareCount?: number;
  commentCount?: number;
  likeCount?: number;
  followerCount?: number;
  refreshedAt?: string;
};

export type UserOperationalIdentityUsageEvent = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  agentId: string;
  identityId: string;
  provider: UserOperationalIdentityProvider;
  action: string;
  result: UserOperationalIdentityUsageResult;
  denialCode?: string;
  sessionKey?: string | null;
  createdAt: string;
  summary?: UserOperationalIdentityUsageSummary;
  metrics?: UserOperationalIdentityUsageMetrics;
};

/**
 * Lifecycle audit (Task 2.5 / R6 6B). Distinct from usage/deny events: records
 * create / reauthorize / revoke transitions for a user-owned operational
 * identity. Append-only; surfaced in the governance overview under the same
 * visible-scope filtering as usage events.
 */
export type UserOperationalIdentityLifecycleAction = "created" | "reauthorized" | "revoked";

export type UserOperationalIdentityLifecycleEvent = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  identityId: string;
  provider: UserOperationalIdentityProvider;
  action: UserOperationalIdentityLifecycleAction;
  createdAt: string;
};

export type UserOperationalIdentityStore = {
  version: number;
  identities: Record<string, UserOperationalIdentity>;
  grants: Record<string, UserOperationalIdentityGrant>;
  bindingRequests: Record<string, UserOperationalIdentityBindingRequest>;
  usageEvents: Record<string, UserOperationalIdentityUsageEvent>;
  lifecycleEvents: Record<string, UserOperationalIdentityLifecycleEvent>;
  continuations: Record<string, UserOperationalIdentityContinuation>;
  credentialHandles: Record<string, UserOperationalIdentityCredentialHandle>;
  oauthSessions: Record<string, UserOperationalIdentityOAuthSession>;
};

export type UserOperationalIdentityCredentialHandleStatus = "active" | "revoked";

export type UserOperationalIdentityCredentialHandle = {
  handleId: string;
  ownerId: string;
  provider: UserOperationalIdentityProvider;
  label?: string;
  status: UserOperationalIdentityCredentialHandleStatus;
  oauthSessionId?: string;
  secretVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
};

export type UserOperationalIdentityOAuthMode =
  | "simulated"
  | "github_authorization_code"
  | "adapter_authorization_code";

export type UserOperationalIdentityOAuthSessionStatus =
  | "pending"
  | "completed"
  | "expired"
  | "cancelled";

export type UserOperationalIdentityOAuthSessionPurpose = "bind" | "reauthorize";

export type UserOperationalIdentityOAuthSession = {
  sessionId: string;
  state: string;
  ownerId: string;
  /**
   * Tenant scope captured at OAuth start (call-entry / membership). Required for
   * shared-tenant store location and managed governance writes on callback.
   */
  tenantId?: string;
  provider: UserOperationalIdentityProvider;
  displayName?: string;
  continuationToken?: string;
  bindingRequestId?: string;
  returnPath?: string;
  purpose?: UserOperationalIdentityOAuthSessionPurpose;
  mode: UserOperationalIdentityOAuthMode;
  /** PKCE code_verifier for adapter_authorization_code (e.g. X). Never project to UI. */
  codeVerifier?: string;
  status: UserOperationalIdentityOAuthSessionStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  credentialHandleId?: string;
  identityId?: string;
  externalAccountId?: string;
};

export type UserOperationalIdentityCredentialSecretKind =
  | "simulated"
  | "github_token"
  | "oauth_token"
  | "smtp"
  | "wechat_oa"
  | "social_account";

export type UserOperationalIdentityCredentialSecret = {
  handleId: string;
  ownerId: string;
  provider: UserOperationalIdentityProvider;
  kind: UserOperationalIdentityCredentialSecretKind;
  accessToken?: string;
  refreshToken?: string;
  accountLabel?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type UserOperationalIdentityCredentialSecretStore = {
  version: number;
  secrets: Record<string, UserOperationalIdentityCredentialSecret>;
};

export type UserOperationalIdentityContinuationStatus =
  | "pending_binding"
  | "pending_oauth"
  | "ready_to_resume"
  | "resumed"
  | "expired"
  | "cancelled";

export type UserOperationalIdentityContinuation = {
  continuationId: string;
  continuationToken: string;
  ownerId: string;
  bindingRequestId?: string;
  sessionKey?: string | null;
  workbenchModule?: string | null;
  agentId: string;
  agentScope: UserOperationalIdentityAgentScope;
  provider: UserOperationalIdentityProvider;
  requestedAction: string;
  resumeMessage?: string;
  resumeIntentId?: string;
  executionPayload?: Record<string, unknown>;
  requiredProviders: UserOperationalIdentityProvider[];
  completedProviders: UserOperationalIdentityProvider[];
  oauthCompletedProviders: UserOperationalIdentityProvider[];
  status: UserOperationalIdentityContinuationStatus;
  autoResume: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  resumedAt?: string;
  oauthCompletedAt?: string;
};

export type UserOperationalIdentityContinuationResumePayload = {
  continuationId: string;
  continuationToken: string;
  sessionKey?: string | null;
  workbenchModule?: string | null;
  agentId: string;
  resumeMessage: string;
  autoResume: boolean;
  resumeIntentId?: string;
  executionPayload?: Record<string, unknown>;
  publishIntent?: {
    intentId: string;
    provider: string;
    operationalAction: string;
    objectTitle: string;
    objectSummary?: string;
  };
};

export const USER_OPERATIONAL_IDENTITY_STORE_VERSION = 5;
export const USER_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION = 1;
