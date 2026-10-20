export type EnterpriseIdentityStatus = "active" | "expired" | "reauth_required";

export type EnterpriseOperationalIdentityProvider =
  | "wechat-official"
  | "wechat-channels"
  | "github-org"
  | "notion"
  | "weibo"
  | "douyin"
  | "bilibili"
  | "x-twitter"
  | "xiaohongshu"
  | "zhihu"
  | "kuaishou"
  | "tencent-meeting";

/** 已从运营身份目录移除、仅兼容历史数据的 Provider（不可新注册）。 */
export type LegacyOperationalIdentityProvider =
  | "feishu"
  | "wecom"
  | "dingtalk"
  | "enterprise-email"
  | "jira";

export type EnterpriseIdentity = {
  identityId: string;
  tenantId: string;
  provider: EnterpriseOperationalIdentityProvider | LegacyOperationalIdentityProvider;
  displayName: string;
  credentialBindingId: string;
  connectorProfileId?: string;
  externalAccountId?: string;
  status: EnterpriseIdentityStatus;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  configReadiness?: {
    items: Array<{
      key: string;
      label: string;
      satisfied: boolean;
      scope: "field" | "verify" | "identity";
      detail?: string;
    }>;
    probedAt?: string;
  };
  /** 能力发现：verify 后 Agent 实际可用的运营动作白名单候选。 */
  capabilities?: string[];
  capabilityMissing?: string[];
  capabilityDiscoveredAt?: string;
  providerMetadata?: Record<string, string>;
  /** 编辑凭证弹窗：非敏感字段预填 + 已配置 secret 字段 key 列表（不含明文）。 */
  credentialEditPreview?: {
    fields: Record<string, string>;
    secretsConfigured: string[];
  };
  lastVerifyResult?: {
    result: "SUCCESS" | "FAILED";
    errorCode?: string;
    detail?: string;
    verifiedAt: string;
  };
};

export type IdentityUsagePolicy = {
  policyId: string;
  tenantId: string;
  identityId: string;
  seatIds: string[];
  allowedAgentIds: string[];
  allowedActions: string[];
  enabled: boolean;
  /** Monotonic string version; bumped on material policy updates. Used with policyVersionAtGrant. */
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type DataSourceIdentityBindingPurpose =
  | "source_authentication"
  | "source_collection"
  | "source_sync";

export type DataSourceIdentityBinding = {
  bindingId: string;
  tenantId: string;
  identityId: string;
  dataSourceId: string;
  purpose: DataSourceIdentityBindingPurpose;
  createdAt: string;
  updatedAt: string;
};

/**
 * Tenant-level grant mode for enterprise operational identity (PDP input; admin API only).
 * Default remains seat_inherit_until_curated (P0 low-risk zero-enrollment compat).
 * explicit_owner_grant exits implicit inheritance for the whole tenant.
 */
export type OperationalIdentityTenantGrantMode =
  | "seat_inherit_until_curated"
  | "explicit_owner_grant";

export type OperationalIdentityTenantSettings = {
  tenantId: string;
  /** How zero-enrollment agents inherit seat policy. */
  grantMode: OperationalIdentityTenantGrantMode;
  updatedAt: string;
  updatedByEmployeeId?: string;
};

/** Grant/enrollment lifecycle status. Only `active` participates in PDP. */
export type EmployeeEnterpriseIdentityGrantStatus = "active" | "suspended" | "revoked";

/**
 * How this Grant row was produced. PDP reads grantMode for audit/meta; tenant switch
 * controls zero-enrollment inheritance separately via OperationalIdentityTenantSettings.
 */
export type EmployeeEnterpriseIdentityGrantMode = "explicit_owner_grant" | "seat_inherit_snapshot";

/**
 * 员工域企业身份授权（enrollment → Grant 语义）。
 *
 * 表示「某员工把企业身份库中的某个身份，启用给自己名下的某个机器人（agent）使用」。
 * 该记录受企业策略边界约束：仅当企业 `IdentityUsagePolicy` 已对该员工席位 + agent 放行该身份时
 * 才允许写入；员工只能在企业放行范围内做更细粒度的「按机器人启停」，不能越权扩权。
 * 读路径仍唯一进入 PDP（无平行 grant 表）。
 */
export type EmployeeEnterpriseIdentityEnrollment = {
  enrollmentId: string;
  tenantId: string;
  employeeId: string;
  agentId: string;
  identityId: string;
  allowedActions: string[];
  status: EmployeeEnterpriseIdentityGrantStatus;
  grantMode: EmployeeEnterpriseIdentityGrantMode;
  /** Policy version stamped at grant/enroll time; compared in PDP meta / mismatch Deny. */
  policyVersionAtGrant?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Three-phase OI authorization model — audit / admin API only; never LLM projection.
 *
 * | stage                  | product meaning                         | layer        |
 * |------------------------|-----------------------------------------|--------------|
 * | enterprise_admission   | 企业身份准入：策略上限、风险可开放范围   | write + PDP input |
 * | owner_delegation       | Owner 授权委托：enrollment / CollaborationIdentityDelegation | write + PDP input |
 * | runtime_decision       | 运行时执行裁决：Allow\|Deny             | PDP+PEP only |
 *
 * usage / usage_denied audit meta from enforce/execute uses `runtime_decision`.
 */
export type OperationalIdentityAccessStage =
  | "enterprise_admission"
  | "owner_delegation"
  | "runtime_decision";

export type CollaborationIdentityDelegationStatus = "active" | "suspended" | "revoked";

/**
 * Optional collaboration-group narrowing when group actions must be stricter than the
 * owner's own EffectiveAccess. Zero active rows → no effect (no regress).
 * Read path enters the same PDP as enrollment (intersect allowedActions); list/prompt
 * project the narrowed set. Do not invent a parallel intersection.
 */
export type CollaborationIdentityDelegation = {
  delegationId: string;
  tenantId: string;
  collaborationGroupId: string;
  ownerEmployeeId: string;
  agentId: string;
  identityId: string;
  allowedActions: string[];
  status: CollaborationIdentityDelegationStatus;
  createdAt: string;
  updatedAt: string;
};
