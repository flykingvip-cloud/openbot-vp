import type {
  CapabilityEmployeeVisibilityMode,
  CapabilityGovernanceSnapshot,
  CapabilityLifecycleState,
  CapabilityRiskLevel,
  CapabilityProposalStatus,
  SecurityFindingSeverity,
} from "../../../capability/capability-governance/types.ts";
import type { AssetLeaderboardSectionVM } from "../../../views/asset-incubation-leaderboards.ts";
import type { ChannelsProps } from "../../../views/channels.types.ts";
import type { InstancesProps } from "../../../views/instances.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { SkillsProps } from "../../../views/skills.ts";

export type PlatformPage =
  | "dashboard"
  | "tenants"
  | "capabilities"
  | "models"
  | "agents"
  | "advanced"
  | "systemSettings";

export type PlatformStatVM = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "setup";
};

export type PlatformLinkVM = {
  label: string;
  path: string;
};

export type PlatformAnchorVM = {
  id: string;
  label: string;
  meta?: string;
};

export type PlatformListItemVM = {
  title: string;
  subtitle: string;
  meta?: string;
  href?: string;
};

export type PlatformModelPoolEntryVM = {
  providerId: string;
  modelId: string;
  name: string;
  api: string;
  baseUrl: string;
  baseUrlRaw: string;
  auth: string;
  reasoning: boolean | null;
  inputs: string[];
  contextWindow: string;
  contextWindowRaw: number | null;
  maxTokens: string;
  maxTokensRaw: number | null;
  costTier: "low" | "medium" | "high" | "unknown";
  supportsTools: boolean | null;
};

export type PlatformModelProviderEntryVM = {
  providerId: string;
  api: string;
  baseUrl: string;
  baseUrlRaw: string;
  auth: string;
  modelCount: number;
};

export type PlatformModelProviderHealthEntryVM = {
  providerId: string;
  authMode: string;
  authStatus: "ok" | "warn" | "external";
  authLabel: string;
  modelCount: number;
  catalogCount: number;
  issue: string;
};

export type PlatformModelCatalogEntryVM = {
  providerId: string;
  modelId: string;
  name: string;
  contextWindow: string;
  contextWindowRaw: number | null;
  inPool: boolean;
};

export type DashboardHealthTone = "ok" | "warn" | "danger" | "neutral" | "setup";

export type DashboardHealthIndicatorVM = {
  id: "runtime" | "providers" | "channels" | "errorRate" | "costAttribution" | "version";
  label: string;
  value: string;
  meta: string;
  tone: DashboardHealthTone;
  href?: string;
};

export type DashboardTrendDirection = "up" | "down" | "flat";

export type DashboardTrendVM = {
  direction: DashboardTrendDirection;
  label: string;
  tone: "ok" | "warn" | "danger" | "neutral";
};

export type DashboardMetricVM = {
  id: string;
  label: string;
  value: string;
  valueTone: "ok" | "warn" | "danger" | "neutral";
  icon:
    | "tenants"
    | "runtime"
    | "sessions"
    | "cost"
    | "models"
    | "capabilities"
    | "attention"
    | "version";
  meta: string;
  trend?: DashboardTrendVM;
  href: string;
};

export type DashboardAttentionSeverity = "critical" | "warning" | "info";
export type DashboardAttentionCategory =
  | "tenant"
  | "model"
  | "runtime"
  | "channel"
  | "cost"
  | "version"
  | "security";

export type DashboardAttentionActionKind = "primary" | "secondary";

export type DashboardAttentionAction = {
  label: string;
  href: string;
  kind: DashboardAttentionActionKind;
};

export type DashboardAttentionItemVM = {
  id: string;
  severity: DashboardAttentionSeverity;
  category: DashboardAttentionCategory;
  title: string;
  subtitle: string;
  meta?: string;
  actions: DashboardAttentionAction[];
};

export type DashboardQuickActionVM = {
  id: string;
  label: string;
  description: string;
  icon:
    | "tenants"
    | "models"
    | "capabilities"
    | "agents"
    | "advanced"
    | "systemSettings"
    | "creation"
    | "report"
    | "audit";
  href: string;
  emphasis: "primary" | "default";
};

export type DashboardSignalVM = {
  id: string;
  label: string;
  value: string;
  meta: string;
  tone: "ok" | "warn" | "danger" | "neutral";
};

export type DashboardVM = {
  updatedAtLabel: string | null;
  health: DashboardHealthIndicatorVM[];
  overallHealthTone: "ok" | "warn" | "danger" | "neutral" | "setup";
  overallHealthLabel: string;
  metrics: DashboardMetricVM[];
  attention: DashboardAttentionItemVM[];
  attentionCounts: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  quickActions: DashboardQuickActionVM[];
  signals: DashboardSignalVM[];
  contributionLeaderboards?: AssetLeaderboardSectionVM[];
};

export type TenantsVM = {
  summary: PlatformStatVM[];
  chips: string[];
  canManagePlatform: boolean;
  overviewItems: PlatformListItemVM[];
  tenantItems: PlatformListItemVM[];
  trialItems: PlatformListItemVM[];
  coverageItems: PlatformListItemVM[];
};

// Governance-facing shape for a discovered proposal (renders in the
// "发现池" tab).
export type CapabilityProposalItemVM = {
  proposalId: string;
  capabilityId: string;
  title: string;
  subtitle: string;
  status: CapabilityProposalStatus;
  statusLabel: string;
  sourceLabel: string;
  trustTier: "first-party" | "workspace" | "user" | "third-party" | "external";
  riskLevel: CapabilityRiskLevel;
  findingCount: number;
  highestFindingSeverity: SecurityFindingSeverity | null;
  submittedAt: string;
};

export type CapabilityRegistryItemVM = {
  capabilityId: string;
  manifestId: string;
  title: string;
  subtitle: string;
  lifecycleState: CapabilityLifecycleState;
  lifecycleLabel: string;
  sourceLabel: string;
  trustTier: "first-party" | "workspace" | "user" | "third-party" | "external";
  riskLevel: CapabilityRiskLevel;
  distributionSummary: string;
  defaultEnabled: boolean;
  employeeVisibilityMode: CapabilityEmployeeVisibilityMode;
};

export type CapabilityActiveItemVM = {
  capabilityId: string;
  title: string;
  subtitle: string;
  meta: string;
  sourceLabel: string;
  lifecycleState: CapabilityLifecycleState;
  riskLevel: CapabilityRiskLevel;
  missing: readonly string[];
};

export type CapabilityHealthItemVM = {
  capabilityId: string;
  title: string;
  subtitle: string;
  meta: string;
  severity: SecurityFindingSeverity | "setup" | "attention";
  kind: "missing-bin" | "missing-env" | "missing-config" | "blocked" | "platform";
};

export type CapabilityCategoryId =
  | "chat"
  | "vision"
  | "rag"
  | "ocr"
  | "search"
  | "workflow"
  | "automation"
  | "browser"
  | "code"
  | "integration"
  | "media"
  | "other";

export type CapabilityCategoryVM = {
  id: CapabilityCategoryId;
  label: string;
  description: string;
  icon:
    | "chat"
    | "vision"
    | "rag"
    | "ocr"
    | "search"
    | "workflow"
    | "automation"
    | "browser"
    | "code"
    | "integration"
    | "media"
    | "other";
  total: number;
  installed: number;
  highlight?: string;
};

export type CapabilityCatalogItemVM = {
  id: string;
  title: string;
  summary: string;
  categoryId: CapabilityCategoryId;
  categoryLabel: string;
  sourceLabel: string;
  sourceOrigin: string;
  version: string | null;
  trustTier: "first-party" | "workspace" | "user" | "third-party" | "external";
  trustLabel: string;
  status: "installed" | "available" | "needs-setup" | "blocked" | "disabled";
  statusLabel: string;
  statusTone: "ok" | "warn" | "danger" | "neutral";
  tenantsEnabled: number;
  calls7d: number;
  calls7dLabel: string;
  failureRate: number;
  failureRateLabel: string;
  readinessGap: readonly string[];
  installable: boolean;
  defaultEnabled?: boolean;
  employeeVisibilityMode?: CapabilityEmployeeVisibilityMode;
  skillKey?: string;
  homepage?: string;
};

export type CapabilityDistributionRowVM = {
  tenantId: string;
  tenantLabel: string;
  tenantStatus: "trial" | "paid" | "suspended" | "expired" | "unknown";
  tenantStatusLabel: string;
  enabledCount: number;
  totalCount: number;
  coverageLabel: string;
  coverageTone: "ok" | "warn" | "danger" | "neutral";
  defaultBundleLabel: string;
  lastChangedLabel: string;
  href?: string;
};

export type CapabilityHealthItemVM2 = {
  id: string;
  title: string;
  subtitle: string;
  category: CapabilityCategoryId;
  categoryLabel: string;
  severity: "critical" | "warning" | "info";
  issueKind: "missing-bin" | "missing-env" | "missing-config" | "blocked" | "stale" | "platform";
  meta: string;
  action?: { label: string; href: string };
};

export type CapabilitiesTab =
  | "catalog"
  | "installed"
  | "discovery"
  | "enterpriseSubmissions"
  | "distribution"
  | "health";

export type CapabilitiesSummaryVM = {
  totalInCatalog: number;
  totalInstalled: number;
  tenantsCovered: number;
  healthScoreLabel: string;
  healthTone: "ok" | "warn" | "danger" | "setup";
  attentionCount: number;
  criticalCount: number;
};

export type CapabilitiesVM = {
  summary: PlatformStatVM[];
  summaryMetrics: CapabilitiesSummaryVM;
  categories: CapabilityCategoryVM[];
  catalogItems: CapabilityCatalogItemVM[];
  installedItems: CapabilityCatalogItemVM[];
  distributionRows: CapabilityDistributionRowVM[];
  healthItemsV2: CapabilityHealthItemVM2[];
  setupNotes: string[];
  setupChecklist: PlatformListItemVM[];
  discoveredItems: CapabilityProposalItemVM[];
  discoveredCounts: {
    proposed: number;
    underReview: number;
    withFindings: number;
    rejected: number;
    total: number;
  };
  registeredItems: CapabilityRegistryItemVM[];
  activeItems: CapabilityActiveItemVM[];
  healthItems: CapabilityHealthItemVM[];
  skillsProps: SkillsProps | null;
  snapshot: CapabilityGovernanceSnapshot;
};

export type ModelsVM = {
  summary: PlatformStatVM[];
  sectionLinks: PlatformAnchorVM[];
  mode: "merge" | "replace" | null;
  modeLabel: string;
  canManage: boolean;
  configDirty: boolean;
  configSaving: boolean;
  providerEntries: PlatformModelProviderEntryVM[];
  providerHealthEntries: PlatformModelProviderHealthEntryVM[];
  standardModels: PlatformModelPoolEntryVM[];
  gatewayCatalogEntries: PlatformModelCatalogEntryVM[];
  gatewayCatalogItems: PlatformListItemVM[];
  routingPrimary: string | null;
  routingFallbacks: string[];
  routingImagePrimary: string | null;
  routingCandidates: string[];
  allowlistItems: string[];
  allowlistEntries: Array<{ modelRef: string; alias: string | null }>;
  aliasCount: number;
  modelItems: PlatformListItemVM[];
  policyItems: PlatformListItemVM[];
  matchingItems: PlatformListItemVM[];
  overrideItems: PlatformListItemVM[];
  issueItems: PlatformListItemVM[];
};

export type AgentsVM = {
  summary: PlatformStatVM[];
  actionItems: PlatformListItemVM[];
  fleetItems: PlatformListItemVM[];
  directoryItems: PlatformListItemVM[];
  workspaceItems: PlatformListItemVM[];
};

export type AdvancedVM = {
  summary: PlatformStatVM[];
  chips: string[];
  channelsProps: ChannelsProps;
  instancesProps: InstancesProps | null;
  usageItems: PlatformListItemVM[];
  domainItems: PlatformListItemVM[];
};

export type SystemSettingsVM = {
  summary: PlatformStatVM[];
  notes: string[];
  entryItems: PlatformListItemVM[];
  canManagePlatform: boolean;
  canManagePlatformAdmins: boolean;
  authPanelProps: PlatformAuthPanelProps | null;
};

export type PlatformPageViewModels = {
  dashboard: DashboardVM;
  tenants: TenantsVM;
  capabilities: CapabilitiesVM;
  models: ModelsVM;
  agents: AgentsVM;
  advanced: AdvancedVM;
  systemSettings: SystemSettingsVM;
};
