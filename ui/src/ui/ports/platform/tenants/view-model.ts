import type {
  ControlUiPlatformTrialApplicationStatus,
  ControlUiPlatformTrialApplicationSummary,
} from "../../../../../../src/gateway/control-ui-contract.js";

export type PlatformTenantMetricVM = {
  label: string;
  value: string;
  meta?: string;
  tone?: "ok" | "warn" | "danger" | "neutral";
};

export type PlatformTenantTone = "ok" | "warn" | "danger" | "neutral";

/** 统一列表中的管理对象类型（展示分类，非数据身份）。 */
export type PlatformTenantManagedObjectType =
  | "formal_tenant"
  | "trial_tenant"
  | "trial_application"
  | "suspended"
  | "expired";

export type PlatformTenantAttentionVM = {
  id: string;
  tenantId: string;
  tenantName: string;
  severity: "critical" | "warning" | "info";
  bucket: "cost" | "runtime" | "commercial" | "adoption" | "approval";
  timeLabel: string;
  title: string;
  description: string;
  impactLabel: string;
  reasonLabel: string;
  primaryActionLabel: string;
  primaryHref: string;
  secondaryActionLabel?: string;
  secondaryHref?: string;
};

export type PlatformTenantPendingItemVM = {
  id: string;
  title: string;
  reason: string;
  statusLabel: string;
  timeLabel?: string;
  tone: PlatformTenantTone;
  actionLabel: string;
  section?: "overview" | "usage" | "agents" | "runtime" | "billing" | "risks" | "controls" | "logs";
  href?: string;
};

export type PlatformTenantDirectoryItemVM = {
  /** 稳定列表键：`tenant:<id>` 或 `app:<applicationId>`，禁止为申请虚构 tenantId。 */
  objectKey: string;
  objectType: PlatformTenantManagedObjectType;
  objectTypeLabel: string;
  isApplication: boolean;
  /** 租户条目的真实 tenantId；申请条目为空。 */
  tenantId: string | null;
  /** 申请条目的真实 applicationId；租户条目可携带关联申请 ID。 */
  applicationId: string | null;
  linkedTenantId?: string;
  linkedApplicationId?: string;
  name: string;
  identityId: string;
  identityIdLabel: string;
  contactName?: string;
  contactEmail?: string;
  status: "trial" | "paid" | "suspended" | "expired" | "application";
  statusLabel: string;
  sourceLabel: string;
  planLabel: string;
  billingStatus: string;
  trialEndsLabel?: string;
  contact?: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    companySize?: string;
    industry?: string;
    status?: "pending_activation" | "activated";
  };
  lifecycleStatus:
    | "trial"
    | "converting"
    | "active"
    | "expanding"
    | "risk"
    | "suspended"
    | "pending_review"
    | "rejected";
  lifecycleStatusLabel: string;
  lifecycleTone: PlatformTenantTone;
  stageLabel: string;
  stageTone: PlatformTenantTone;
  seatUsageLabel: string;
  seatUsed?: number;
  seatQuota?: number;
  adoptionLabel: string;
  adoptionTone: PlatformTenantTone;
  aiActivityLabel: string;
  aiActivityMeta: string;
  usersLabel: string;
  agentsLabel: string;
  groupsLabel: string;
  runtimesLabel: string;
  calls7dLabel: string;
  cost7dLabel: string;
  revenue7dLabel: string;
  commercialMeta: string;
  usageSummaryLabel: string;
  usageSummaryMeta: string;
  topModelLabel: string;
  topAgentLabel: string;
  healthLabel: string;
  healthTone: PlatformTenantTone;
  healthScoreLabel: string;
  incidentLabel: string;
  lifecycleLabel: string;
  riskLabel: string;
  riskLevelLabel: string;
  riskTone: PlatformTenantTone;
  pendingTodoLabel: string;
  recentEventLabel: string;
  recentEventMeta: string;
  growthLabel: string;
  growthTone: PlatformTenantTone;
  isAnomalous: boolean;
  hasPendingAction: boolean;
  updatedAtLabel: string;
  updatedAtMs: number;
  sortPendingRank: number;
  sortRiskRank: number;
  dataSources: {
    usage: "current_usage" | "tenant_summary" | "derived" | "pending";
    adoption: "current_usage" | "tenant_summary" | "derived" | "pending";
    health: "current_usage" | "tenant_summary" | "derived" | "pending";
  };
  usageStats: {
    calls7d?: number;
    cost7d?: number;
    topModelLabel?: string;
    topAgentLabel?: string;
    activeAgentCount?: number;
    activeChannelCount?: number;
    activeRuntimeCount?: number;
  };
  adoptionStats: {
    aiActiveUsers?: number;
    automationTaskCount?: number;
    note?: string;
  };
  healthStats: {
    errorRate?: number;
    successRate?: number;
    fallbackRate?: number;
    avgLatencyMs?: number;
    incidentLabel?: string;
  };
  applicationStatus?: ControlUiPlatformTrialApplicationStatus;
  applicationSummary?: ControlUiPlatformTrialApplicationSummary;
  enterHref: string;
  usageHref: string;
  settingsHref: string;
  isCurrent?: boolean;
};

export type PlatformTenantDetailVM = {
  objectKey: string;
  isApplication: boolean;
  tenantId: string | null;
  applicationId: string | null;
  name: string;
  statusLabel: string;
  sourceLabel: string;
  planLabel: string;
  billingStatus: string;
  trialEndsLabel?: string;
  lifecycleStatusLabel: string;
  riskLevelLabel: string;
  contactName?: string;
  contactEmail?: string;
  /** Primary admin activation status from directory contact. */
  adminActivationStatus?: "pending_activation" | "activated" | "missing";
  createdAtLabel?: string;
  identityId: string;
  identityIdLabel: string;
  seatUsed?: number;
  seatQuota?: number;
  provisionStatusLabel: string;
  commercialStatusLabel: string;
  runtimeHealthLabel: string;
  runtimeHealthTone: PlatformTenantTone;
  riskTone: PlatformTenantTone;
  linkedTenantId?: string;
  linkedApplicationId?: string;
  summary: PlatformTenantMetricVM[];
  identityFields: PlatformTenantMetricVM[];
  pendingItems: PlatformTenantPendingItemVM[];
  metrics: {
    overview: PlatformTenantMetricVM[];
    usage: PlatformTenantMetricVM[];
    agents: PlatformTenantMetricVM[];
    runtime: PlatformTenantMetricVM[];
    billing: PlatformTenantMetricVM[];
    risks: PlatformTenantMetricVM[];
    controls: PlatformTenantMetricVM[];
    logs: PlatformTenantMetricVM[];
  };
  recommendations: PlatformTenantOperationItemVM[];
  alerts: PlatformTenantOperationItemVM[];
  notes: string[];
  applicationSummary?: ControlUiPlatformTrialApplicationSummary;
  actions: Array<{
    label: string;
    href?: string;
    section?:
      | "overview"
      | "usage"
      | "agents"
      | "runtime"
      | "billing"
      | "risks"
      | "controls"
      | "logs";
    kind?: "primary" | "secondary" | "danger";
    externalSettings?: boolean;
  }>;
};

export type PlatformTenantOperationItemVM = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  tone: PlatformTenantTone;
  href?: string;
  actionLabel?: string;
};

export type PlatformTenantsVM = {
  summary: PlatformTenantMetricVM[];
  chips: string[];
  overviewItems: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>;
  tenantItems: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>;
  coverageItems: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>;
  trialItems: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>;
  overview: {
    primary: PlatformTenantMetricVM[];
    secondary: PlatformTenantMetricVM[];
    quickActions: Array<{
      label: string;
      href: string;
      kind?: "primary" | "secondary";
    }>;
  };
  directory: {
    items: PlatformTenantDirectoryItemVM[];
    pendingApplicationCount: number;
    pendingActionCount: number;
    emptyTitle: string;
    emptyDescription: string;
  };
  attention: {
    items: PlatformTenantAttentionVM[];
    emptyTitle: string;
    emptyDescription: string;
  };
  detail: {
    selectedObjectKey: string | null;
    items: PlatformTenantDetailVM[];
  };
  notes: {
    usageData: string;
    adoptionData: string;
  };
  trends: Array<{
    id: string;
    label: string;
    value: string;
    delta: string;
    tone: "cost" | "usage" | "conversion";
  }>;
};
