import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { AgentsListResult, CollaborationSpacesListResult } from "../../../types.ts";
import type { OperationalIdentityGovernancePanelProps } from "../../../views/operational-identity-governance-panel.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { EnterprisePortRenderModel } from "../view-types.ts";

export type EnterpriseSurfaceTab =
  | "enterpriseOverview"
  | "enterpriseOrganization"
  | "enterpriseDataGovernanceCenter"
  | "enterpriseAgents"
  | "enterpriseUsageManagement"
  | "enterpriseCapabilityCenter"
  | "enterpriseMesh"
  | "enterpriseDiagnosis"
  | "enterpriseUsage"
  | "enterpriseChannels"
  | "enterpriseSettings";

export type EnterpriseSurfaceProps = {
  tab: EnterpriseSurfaceTab;
  basePath: string;
  client?: GatewayBrowserClient | null;
  agentsList?: AgentsListResult | null;
  collaborationSpacesResult?: CollaborationSpacesListResult | null;
  readModel: EnterprisePortReadModel;
  /** 组织页独立月度用量（员工账号归因）。 */
  organizationMonthlyUsageLoading?: boolean;
  organizationMonthlyUsageError?: string | null;
  organizationMonthlyUsage?: {
    tenantId: string;
    startDate: string;
    endDate: string;
    agents: Array<{
      agentId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
    users?: Array<{
      userId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
    seats: Array<{
      seatId: string;
      agentIds: string[];
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
      unmatchedAgentIds: string[];
    }>;
    unmatchedAgentIds: string[];
  } | null;
  operationalIdentityGovernancePanel?: OperationalIdentityGovernancePanelProps;
  actions: EnterprisePortRenderModel["surfaceActions"];
  authPanelProps: PlatformAuthPanelProps | null;
  accessControlEditor?: NonNullable<EnterprisePortRenderModel["accessControlEditor"]>;
  createPositionEditor?: EnterprisePortRenderModel["createPositionEditor"];
  seatOfferEditor: EnterprisePortRenderModel["seatOfferEditor"];
  identityManagementEditor: EnterprisePortRenderModel["identityManagementEditor"];
  handoverEditor: EnterprisePortRenderModel["handoverEditor"];
  ownershipTransferEditor: EnterprisePortRenderModel["ownershipTransferEditor"];
  cronProps?: EnterprisePortRenderModel["cronProps"];
  /** Tenant-scoped IM/channel credentials editor (wecom/feishu/dingtalk/…). */
  channelCredentialsEditor?: EnterprisePortRenderModel["channelCredentialsEditor"];
};

export type SurfaceStat = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger";
  href?: string;
  onAction?: () => unknown;
};

export type SurfaceTone = "overview" | "organization" | "agents" | "mesh" | "usage" | "settings";

export type WorkspaceItemAction = {
  label: string;
  onAction: () => unknown;
  tone?: "danger" | "primary";
};

export type AccessPolicyItem = {
  policyId: string;
  resourceType: string;
  resourceId: string;
  action: string;
};

export type MeshQueueFilter = "restrict" | "owner" | "attribution" | "review";
export type MeshRankView = "governance" | "user" | "agent" | "group";
export type MeshUserRankMode = "impact" | "efficiency" | "stability";
export type MeshAgentRankMode = "impact" | "efficiency" | "stability";
export type MeshGroupRankMode = "impact" | "efficiency" | "stability";

export type AccessView = "roles" | "users" | "matrix";
export type AccessMatrixFilter = "all" | "risk";
export type AccessRoleKey = "admin" | "operator" | "viewer";
export type AccessPermissionDefinition = {
  id: string;
  module: string;
  label: string;
  highRisk?: boolean;
  description?: string;
};

export function isEnterpriseSurfaceTab(tab: string): tab is EnterpriseSurfaceTab {
  return (
    tab === "enterpriseOverview" ||
    tab === "enterpriseOrganization" ||
    tab === "enterpriseDataGovernanceCenter" ||
    tab === "enterpriseAgents" ||
    tab === "enterpriseUsageManagement" ||
    tab === "enterpriseCapabilityCenter" ||
    tab === "enterpriseMesh" ||
    tab === "enterpriseDiagnosis" ||
    tab === "enterpriseUsage" ||
    tab === "enterpriseChannels" ||
    tab === "enterpriseSettings"
  );
}
