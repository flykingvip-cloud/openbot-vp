/**
 * 企业数据能力中心 — Gateway 客户端（Phase 1 + Phase 2）。
 *
 * 仿 `ui/src/ui/controllers/enterprise-data-source-governance.ts` 的 request 模式。
 * 每个方法返回判别式 GatewayResult：成功（含合法空态）/ 失败，二者显式区分。
 *
 * @module enterprise-data-capability/gateway-client
 */

import type {
  AssetLandscapeGraph,
  AuditLineageOverview,
  AuthorizationSourceCard,
  CapabilityUsageRow,
  DataCapabilityDashboardSummary,
  DataSourceHealthRow,
  KnowledgeSupplyOverview,
  ManagedAccessPolicyDetail,
  ManagedAccessPolicyRecord,
  ManagedApprovalPolicyRecord,
  ManagedCapabilityGovernanceView,
  ManagedCapabilityRecord,
  ManagedConnectorActionRecord,
  ManagedConnectorActionRef,
  ManagedDataSourceRecord,
  ManagedDataSourceSyncLogEntry,
  ManagedGovernanceApprovalRequest,
  DataConnectorCredentialRecord,
  ManagedProjectionSpecRecord,
  ManagedProjectionBindingRecord,
  ManagedKnowledgeFeedItemRecord,
  ProjectionMaterializeResult,
  ProjectionSpecUpsertInput,
  ProjectionBindingUpsertInput,
  PendingApprovalItem,
  DataConnectorCatalogEntry,
  SourceConnectionProbeResult,
  HttpRestConnectorConfig,
  ManagedScopePolicyRecord,
  OrgTargets,
} from "../../capability/enterprise-data-capability/types.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { localizeEnterpriseGatewayThrown } from "../../ports/enterprise/enterprise-connection-copy.ts";
import { normalizeDataSourceHealthStatus } from "../../views/enterprise-data-capability/source-health-status.ts";

type SummaryResponse = {
  tenantId: string;
  summary: DataCapabilityDashboardSummary;
};

type CapabilityRowsResponse = {
  tenantId: string;
  rows: CapabilityUsageRow[];
};

type AuthorizationCardsResponse = {
  tenantId: string;
  cards: AuthorizationSourceCard[];
};

type AssetLandscapeResponse = {
  tenantId: string;
  graph: AssetLandscapeGraph;
};

type KnowledgeSupplyResponse = {
  tenantId: string;
  overview: KnowledgeSupplyOverview;
};

type AuditLineageResponse = {
  tenantId: string;
  overview: AuditLineageOverview;
};

type ApprovalsOverviewResponse = {
  tenantId: string;
  overview: {
    totalPending: number;
    pendingByCategory: Record<string, number>;
    recentPending: Array<{
      approvalId: string;
      category: string;
      displayName: string;
      requestedAt: string;
      status: string;
    }>;
  };
};

type SourceHealthResponse = {
  tenantId: string;
  rows: DataSourceHealthRow[];
};

type SourcesListResponse = {
  tenantId: string;
  sources: ManagedDataSourceRecord[];
};

type SourceResponse = {
  tenantId: string;
  source: ManagedDataSourceRecord;
};

type SourceSyncLogResponse = {
  tenantId: string;
  events: Array<{
    auditId: string;
    recordedAt: string;
    status: "success" | "warning" | "failure";
    projectionId: string;
    objectId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  connectorEntries?: Array<{
    entryId: string;
    recordedAt: string;
    status: "success" | "warning" | "failure";
    title: string;
    detail: string;
  }>;
};

type AccessPoliciesListResponse = {
  tenantId: string;
  policies: ManagedAccessPolicyRecord[];
};

type AccessPolicyDetailResponse = {
  tenantId: string;
  detail: ManagedAccessPolicyDetail;
};

type AccessPolicyMutationResponse = {
  tenantId: string;
  policy: ManagedAccessPolicyRecord;
};

type AccessPolicyCompileResponse = {
  tenantId: string;
  policy: ManagedAccessPolicyRecord;
  grants: Array<{
    grantId: string;
    seatId: string;
    connectorId: string;
    actionKey: string;
    version: string;
    revokedAt?: string;
  }>;
};

type ActionsListResponse = {
  tenantId: string;
  actions: ManagedConnectorActionRecord[];
};

type ScopePoliciesListResponse = {
  tenantId: string;
  policies: ManagedScopePolicyRecord[];
};

type ApprovalPoliciesListResponse = {
  tenantId: string;
  policies: ManagedApprovalPolicyRecord[];
};

type CapabilitiesListResponse = {
  tenantId: string;
  capabilities: ManagedCapabilityRecord[];
};

type CapabilityResponse = {
  tenantId: string;
  capability: ManagedCapabilityRecord;
};

type CapabilityGovernanceViewResponse = {
  tenantId: string;
  view: ManagedCapabilityGovernanceView;
};

type GovernanceApprovalsListResponse = {
  tenantId: string;
  requests: ManagedGovernanceApprovalRequest[];
};

type GovernanceApprovalResponse = {
  tenantId: string;
  request: ManagedGovernanceApprovalRequest;
};

type GrantsListResponse = {
  tenantId: string;
  grants: Array<{
    grantId: string;
    seatId: string;
    connectorId: string;
    actionKey: string;
    version: string;
    revokedAt?: string;
  }>;
};

type GrantResponse = {
  tenantId: string;
  grant: {
    grantId: string;
    seatId: string;
    connectorId: string;
    actionKey: string;
    version: string;
    revokedAt?: string;
  };
};

const APPROVAL_CATEGORIES = new Set([
  "source_onboarding",
  "data_access",
  "capability_exposure",
  "identity_binding",
  "seat_capability_access",
]);

/**
 * 显式区分三态的请求结果：
 * - `{ ok: true, data }`：成功（data 可能是合法空数组/合法 summary）。
 * - `{ ok: false, error }`：请求失败或响应非法。
 * 「未加载」由调用方（controller）用 `null` 表达，不与本结果混用。
 */
export type GatewayResult<T> = { ok: true; data: T } | { ok: false; error: string };

const REQUEST_FAILED = "加载失败，请重试。";

function readRpcString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type EnterpriseDataCapabilityGateway = {
  loadDashboardSummary(tenantId: string): Promise<GatewayResult<DataCapabilityDashboardSummary>>;
  loadPendingApprovals(tenantId: string): Promise<GatewayResult<PendingApprovalItem[]>>;
  loadSourceHealth(tenantId: string): Promise<GatewayResult<DataSourceHealthRow[]>>;
  loadOrgTargets(tenantId: string): Promise<GatewayResult<OrgTargets>>;
  loadCapabilityRows(
    tenantId: string,
    limit?: number,
  ): Promise<GatewayResult<CapabilityUsageRow[]>>;
  loadAuthorizationCards(tenantId: string): Promise<GatewayResult<AuthorizationSourceCard[]>>;
  loadAssetLandscape(tenantId: string): Promise<GatewayResult<AssetLandscapeGraph>>;
  loadKnowledgeSupply(tenantId: string): Promise<GatewayResult<KnowledgeSupplyOverview>>;
  loadLineageOverview(tenantId: string): Promise<GatewayResult<AuditLineageOverview>>;
  listSources(tenantId: string): Promise<GatewayResult<ManagedDataSourceRecord[]>>;
  loadConnectorCatalog(tenantId: string): Promise<GatewayResult<DataConnectorCatalogEntry[]>>;
  ensureConnectorDemoPackage(
    tenantId: string,
    connectorId: string,
  ): Promise<GatewayResult<{ installed: boolean; actionCount: number }>>;
  ensureConnectorPackage(
    tenantId: string,
    connectorId: string,
  ): Promise<GatewayResult<{ installed: boolean; actionCount: number }>>;
  startConnectorOAuth(
    tenantId: string,
    input: {
      connectorId: string;
      label: string;
      callbackOrigin?: string;
      basePath?: string;
      returnPath?: string;
      orgId?: string;
      appName?: string;
    },
  ): Promise<
    GatewayResult<{
      sessionId: string;
      authorizeUrl: string | null;
      simulateAllowed: boolean;
      expiresAt: string;
    }>
  >;
  getConnectorOAuthStatus(
    tenantId: string,
    sessionId: string,
  ): Promise<
    GatewayResult<{
      sessionId: string;
      connectorId: string;
      status: string;
      credentialId?: string;
    }>
  >;
  simulateCompleteConnectorOAuth(
    tenantId: string,
    sessionId: string,
    workspaceName?: string,
  ): Promise<GatewayResult<{ credentialId: string }>>;
  testSourceConnection(
    tenantId: string,
    connectorId: string,
    options?: {
      credentialId?: string;
      sourceId?: string;
      instanceUrl?: string;
      apiKey?: string;
    } & HttpRestConnectorConfig,
  ): Promise<GatewayResult<SourceConnectionProbeResult>>;
  listAssetLinkage(tenantId: string): Promise<GatewayResult<{ items: unknown[]; stats: unknown }>>;
  listWebsiteAccessCandidates(tenantId: string): Promise<
    GatewayResult<{
      outcome: "select_existing" | "owner_must_authorize";
      selectable: Array<{ bindingId: string }>;
    }>
  >;
  registerWebsiteAccess(
    tenantId: string,
    bindingId: string,
  ): Promise<GatewayResult<{ bindingId: string }>>;
  resolveOwnedAssetLinks(
    tenantId: string,
    capabilityId: string,
  ): Promise<
    GatewayResult<
      Array<{ sourceId: string; displayName: string; capabilityId: string; version?: string }>
    >
  >;
  loadCapabilityInstallFacts(
    tenantId: string,
    skillId: string,
    agentId?: string,
  ): Promise<GatewayResult<unknown>>;
  listConnectorCredentials(
    tenantId: string,
    connectorId?: string,
  ): Promise<GatewayResult<DataConnectorCredentialRecord[]>>;
  upsertConnectorCredential(
    tenantId: string,
    payload: {
      credentialId?: string;
      connectorId: string;
      label: string;
      instanceUrl?: string;
      apiKey?: string;
      kind?: "api_key" | "oauth2";
      openToken?: string;
      permanentCode?: string;
      orgPermanentAuthCode?: string;
      orgId?: string;
      appName?: string;
      refreshToken?: string;
      appKey?: string;
      appSecret?: string;
      sid?: string;
      idMarketingOrgan?: string;
    } & HttpRestConnectorConfig,
  ): Promise<GatewayResult<DataConnectorCredentialRecord>>;
  listProjectionSpecs(tenantId: string): Promise<GatewayResult<ManagedProjectionSpecRecord[]>>;
  listProjectionBindings(
    tenantId: string,
  ): Promise<GatewayResult<ManagedProjectionBindingRecord[]>>;
  upsertProjectionSpec(
    tenantId: string,
    payload: ProjectionSpecUpsertInput,
  ): Promise<GatewayResult<{ projectionId: string }>>;
  upsertProjectionBinding(
    tenantId: string,
    payload: ProjectionBindingUpsertInput,
  ): Promise<GatewayResult<{ bindingId: string }>>;
  runProjectionMaterializer(
    tenantId: string,
    bindingId: string,
  ): Promise<GatewayResult<ProjectionMaterializeResult>>;
  listFeedItems(
    tenantId: string,
    opts?: { projectionId?: string },
  ): Promise<GatewayResult<ManagedKnowledgeFeedItemRecord[]>>;
  deleteFeedItem(
    tenantId: string,
    objectId: string,
    opts?: { force?: boolean },
  ): Promise<GatewayResult<{ objectId: string; deletedAt?: string; forced: boolean }>>;
  upsertSource(
    tenantId: string,
    payload: {
      sourceId?: string;
      sourceKey: string;
      displayName: string;
      category: ManagedDataSourceRecord["category"];
      status: ManagedDataSourceRecord["status"];
      connectorId: string;
      credentialId?: string;
      bindingId?: string;
    },
  ): Promise<GatewayResult<ManagedDataSourceRecord>>;
  getSource(tenantId: string, sourceId: string): Promise<GatewayResult<ManagedDataSourceRecord>>;
  archiveSource(
    tenantId: string,
    sourceId: string,
  ): Promise<GatewayResult<ManagedDataSourceRecord>>;
  reconnectSource(
    tenantId: string,
    sourceId: string,
  ): Promise<GatewayResult<ManagedDataSourceRecord>>;
  getSourceSyncLog(
    tenantId: string,
    sourceId: string,
  ): Promise<GatewayResult<ManagedDataSourceSyncLogEntry[]>>;
  syncSource(
    tenantId: string,
    sourceId: string,
  ): Promise<GatewayResult<{ status: "success" | "warning" | "failure"; summary: string }>>;
  listAccessPolicies(tenantId: string): Promise<GatewayResult<ManagedAccessPolicyRecord[]>>;
  getAccessPolicy(
    tenantId: string,
    policyId: string,
  ): Promise<GatewayResult<ManagedAccessPolicyDetail>>;
  upsertAccessPolicy(
    tenantId: string,
    payload: {
      policyId?: string;
      displayName: string;
      targetKind: ManagedAccessPolicyRecord["targetKind"];
      targetId: string;
      sourceId?: string;
      actionRefs: ManagedConnectorActionRef[];
      scopePolicyId?: string;
      approvalPolicyId?: string;
      enabled: boolean;
    },
  ): Promise<GatewayResult<ManagedAccessPolicyRecord>>;
  archiveAccessPolicy(
    tenantId: string,
    policyId: string,
  ): Promise<GatewayResult<ManagedAccessPolicyRecord>>;
  compileAccessPolicy(
    tenantId: string,
    policyId: string,
  ): Promise<GatewayResult<AccessPolicyCompileResponse["grants"]>>;
  listConnectorActions(tenantId: string): Promise<GatewayResult<ManagedConnectorActionRecord[]>>;
  listScopePolicies(tenantId: string): Promise<GatewayResult<ManagedScopePolicyRecord[]>>;
  listApprovalPolicies(tenantId: string): Promise<GatewayResult<ManagedApprovalPolicyRecord[]>>;
  listCapabilities(tenantId: string): Promise<GatewayResult<ManagedCapabilityRecord[]>>;
  getCapability(
    tenantId: string,
    capabilityId: string,
  ): Promise<GatewayResult<ManagedCapabilityRecord>>;
  getCapabilityGovernanceView(
    tenantId: string,
    capabilityId: string,
  ): Promise<GatewayResult<ManagedCapabilityGovernanceView>>;
  upsertCapability(
    tenantId: string,
    payload: {
      capabilityId?: string;
      capabilityKey: string;
      displayName: string;
      description: string;
      sourceIds: string[];
      actionRefs: ManagedConnectorActionRef[];
      enabled: boolean;
    },
  ): Promise<GatewayResult<ManagedCapabilityRecord>>;
  upsertMcpMapping(
    tenantId: string,
    payload: {
      mcpServer: string;
      mcpTool: string;
      capabilityKey?: string;
      displayName?: string;
      description?: string;
      capabilityId?: string;
    },
  ): Promise<
    GatewayResult<{
      handlerRef: string;
      capability: ManagedCapabilityRecord;
    }>
  >;
  archiveCapability(
    tenantId: string,
    capabilityId: string,
  ): Promise<GatewayResult<ManagedCapabilityRecord>>;
  listGovernanceApprovals(
    tenantId: string,
  ): Promise<GatewayResult<ManagedGovernanceApprovalRequest[]>>;
  getGovernanceApproval(
    tenantId: string,
    approvalId: string,
  ): Promise<GatewayResult<ManagedGovernanceApprovalRequest>>;
  decideGovernanceApproval(
    tenantId: string,
    payload: {
      approvalId: string;
      decision: "approved" | "rejected";
      decisionNote?: string;
      fulfillmentMode?: "approve_intent_only" | "approve_and_provision";
    },
  ): Promise<GatewayResult<ManagedGovernanceApprovalRequest>>;
  /** Admin-only. Marks an approved pack_skill_review fulfilled. Does not install. */
  fulfillGovernanceApproval(
    tenantId: string,
    payload: {
      approvalId: string;
      provisionReceipt?: {
        handlerRef?: string;
        capabilityId?: string;
        packId?: string;
        skillKey?: string;
        targetRobotId?: string;
      };
    },
  ): Promise<GatewayResult<ManagedGovernanceApprovalRequest>>;
  listSeatActionGrants(
    tenantId: string,
    seatId?: string,
  ): Promise<GatewayResult<GrantsListResponse["grants"]>>;
  revokeSeatActionGrant(
    tenantId: string,
    grantId: string,
  ): Promise<GatewayResult<GrantResponse["grant"]>>;
  grantCapabilityToSeat(
    tenantId: string,
    payload: { seatId: string; capabilityId: string },
  ): Promise<GatewayResult<{ grantCount: number }>>;
};

export function createEnterpriseDataCapabilityGateway(
  client: GatewayBrowserClient,
): EnterpriseDataCapabilityGateway {
  return {
    async loadDashboardSummary(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SummaryResponse>("enterprise-data.dashboard.summary", {
          tenantId: normalized,
        });
        if (!result?.summary) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.summary };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadPendingApprovals(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<ApprovalsOverviewResponse>(
          "enterprise-data.governance-approvals.overview",
          { tenantId: normalized },
        );
        // 响应缺失 overview 视为失败；recentPending 为 [] 是合法空态。
        if (!result?.overview) {
          return { ok: false, error: REQUEST_FAILED };
        }
        const recent = result.overview.recentPending ?? [];
        const items = recent
          .filter((item) => APPROVAL_CATEGORIES.has(item.category))
          .map(
            (item): PendingApprovalItem => ({
              approvalId: item.approvalId,
              category: item.category as PendingApprovalItem["category"],
              displayName: item.displayName,
              requestedAt: item.requestedAt,
              status: item.status,
            }),
          );
        return { ok: true, data: items };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadSourceHealth(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourceHealthResponse>(
          "enterprise-data.dashboard.source-health",
          { tenantId: normalized },
        );
        // 响应缺失 rows 字段视为失败；空数组是合法空态。
        if (!result || !Array.isArray(result.rows)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        const rows = result.rows.map(
          (row): DataSourceHealthRow => ({
            sourceId: row.sourceId,
            displayName: row.displayName,
            category: row.category,
            status: normalizeDataSourceHealthStatus(row.status),
          }),
        );
        return { ok: true, data: rows };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadOrgTargets(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{ tenantId: string; targets: OrgTargets }>(
          "enterprise-data.org.targets",
          { tenantId: normalized },
        );
        const targets = result?.targets;
        if (
          !targets ||
          !Array.isArray(targets.seats) ||
          !Array.isArray(targets.departments) ||
          !Array.isArray(targets.roles)
        ) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: targets };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadCapabilityRows(tenantId, limit) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilityRowsResponse>(
          "enterprise-data.dashboard.capability-rows",
          limit ? { tenantId: normalized, limit } : { tenantId: normalized },
        );
        // 响应缺失 rows 字段视为失败；空数组是合法空态。
        if (!result || !Array.isArray(result.rows)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.rows };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadAuthorizationCards(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AuthorizationCardsResponse>(
          "enterprise-data.dashboard.authorization-cards",
          { tenantId: normalized },
        );
        // 响应缺失 cards 字段视为失败；空数组是合法空态。
        if (!result || !Array.isArray(result.cards)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.cards };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadAssetLandscape(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AssetLandscapeResponse>(
          "enterprise-data.asset-landscape.graph",
          { tenantId: normalized },
        );
        // 响应缺失 graph/nodes 视为失败；空 nodes 是合法空态。
        if (!result?.graph || !Array.isArray(result.graph.nodes)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.graph };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadKnowledgeSupply(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<KnowledgeSupplyResponse>(
          "enterprise-data.knowledge-supply.overview",
          { tenantId: normalized },
        );
        if (!result?.overview) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.overview };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadLineageOverview(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AuditLineageResponse>(
          "enterprise-data.audit-lineage.overview",
          { tenantId: normalized },
        );
        if (!result?.overview) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.overview };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async listSources(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourcesListResponse>("enterprise-data.sources.list", {
          tenantId: normalized,
        });
        if (!result || !Array.isArray(result.sources)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.sources };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async loadConnectorCatalog(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          connectors: DataConnectorCatalogEntry[];
        }>("enterprise-data.connectors.catalog", { tenantId: normalized });
        if (!result || !Array.isArray(result.connectors)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.connectors };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async ensureConnectorDemoPackage(tenantId, connectorId) {
      const normalizedTenant = tenantId.trim();
      const normalizedConnector = connectorId.trim();
      if (!normalizedTenant || !normalizedConnector) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          connectorId: string;
          installed: boolean;
          actionCount: number;
        }>("enterprise-data.connectors.ensure-demo-package", {
          tenantId: normalizedTenant,
          connectorId: normalizedConnector,
        });
        if (!result || typeof result.installed !== "boolean") {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: { installed: result.installed, actionCount: result.actionCount ?? 0 },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async ensureConnectorPackage(tenantId, connectorId) {
      const normalizedTenant = tenantId.trim();
      const normalizedConnector = connectorId.trim();
      if (!normalizedTenant || !normalizedConnector) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          connectorId: string;
          installed: boolean;
          actionCount: number;
        }>("enterprise-data.connectors.ensure-package", {
          tenantId: normalizedTenant,
          connectorId: normalizedConnector,
        });
        if (!result || typeof result.installed !== "boolean") {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: { installed: result.installed, actionCount: result.actionCount ?? 0 },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async startConnectorOAuth(tenantId, input) {
      const normalizedTenant = tenantId.trim();
      const connectorId = input.connectorId.trim();
      const label = input.label.trim();
      if (!normalizedTenant || !connectorId || !label) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          sessionId?: string;
          authorizeUrl?: string | null;
          simulateAllowed?: boolean;
          expiresAt?: string;
        }>("enterprise-data.connector-credentials.oauth.start", {
          tenantId: normalizedTenant,
          connectorId,
          label,
          callbackOrigin: input.callbackOrigin,
          basePath: input.basePath,
          returnPath: input.returnPath,
          orgId: input.orgId,
          appName: input.appName,
        });
        const sessionId = result?.sessionId?.trim();
        if (!sessionId) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: {
            sessionId,
            authorizeUrl: result.authorizeUrl ?? null,
            simulateAllowed: result.simulateAllowed === true,
            expiresAt: result.expiresAt ?? "",
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async getConnectorOAuthStatus(tenantId, sessionId) {
      const normalizedTenant = tenantId.trim();
      const normalizedSession = sessionId.trim();
      if (!normalizedTenant || !normalizedSession) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          session?: {
            sessionId?: string;
            connectorId?: string;
            status?: string;
            credentialId?: string;
          };
        }>("enterprise-data.connector-credentials.oauth.status", {
          tenantId: normalizedTenant,
          sessionId: normalizedSession,
        });
        const session = result?.session;
        if (!session?.sessionId || !session.connectorId || !session.status) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: {
            sessionId: session.sessionId,
            connectorId: session.connectorId,
            status: session.status,
            credentialId: session.credentialId,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async simulateCompleteConnectorOAuth(tenantId, sessionId, workspaceName) {
      const normalizedTenant = tenantId.trim();
      const normalizedSession = sessionId.trim();
      if (!normalizedTenant || !normalizedSession) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          credentialId?: string;
        }>("enterprise-data.connector-credentials.oauth.simulate-complete", {
          tenantId: normalizedTenant,
          sessionId: normalizedSession,
          workspaceName: workspaceName?.trim() || undefined,
        });
        const credentialId = result?.credentialId?.trim();
        if (!credentialId) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { credentialId } };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async testSourceConnection(tenantId, connectorId, options) {
      const normalizedTenant = tenantId.trim();
      const normalizedConnector = connectorId.trim();
      if (!normalizedTenant || !normalizedConnector) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          probe: SourceConnectionProbeResult;
        }>("enterprise-data.sources.test-connection", {
          tenantId: normalizedTenant,
          connectorId: normalizedConnector,
          credentialId: options?.credentialId,
          sourceId: options?.sourceId,
          instanceUrl: options?.instanceUrl,
          apiKey: options?.apiKey,
          authScheme: options?.authScheme,
          authHeaderName: options?.authHeaderName,
          authQueryParam: options?.authQueryParam,
          basicUsername: options?.basicUsername,
          probePath: options?.probePath,
        });
        if (!result?.probe) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.probe };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listAssetLinkage(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{ items?: unknown[]; stats?: unknown }>(
          "enterprise-data.assets.linkage",
          { tenantId: normalized },
        );
        if (!result || !Array.isArray(result.items)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { items: result.items, stats: result.stats ?? null } };
      } catch (error) {
        return { ok: false, error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED) };
      }
    },

    async listWebsiteAccessCandidates(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          outcome?: string;
          selectable?: Array<{ bindingId?: string }>;
        }>("enterprise-data.assets.website-access.candidates", { tenantId: normalized });
        const outcome =
          result?.outcome === "select_existing" ? "select_existing" : "owner_must_authorize";
        const selectable = Array.isArray(result?.selectable)
          ? result.selectable.flatMap((item) =>
              item?.bindingId ? [{ bindingId: item.bindingId }] : [],
            )
          : [];
        return { ok: true, data: { outcome, selectable } };
      } catch (error) {
        return { ok: false, error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED) };
      }
    },

    async registerWebsiteAccess(tenantId, bindingId) {
      const normalized = tenantId.trim();
      const normalizedBinding = bindingId.trim();
      if (!normalized || !normalizedBinding) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{ binding?: { bindingId?: string } }>(
          "enterprise-data.assets.website-access.register",
          { tenantId: normalized, bindingId: normalizedBinding },
        );
        const registered = result?.binding?.bindingId?.trim();
        if (!registered) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { bindingId: registered } };
      } catch (error) {
        return { ok: false, error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED) };
      }
    },

    async resolveOwnedAssetLinks(tenantId, capabilityId) {
      const normalized = tenantId.trim();
      const normalizedCapability = capabilityId.trim();
      if (!normalized || !normalizedCapability) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          links?: Array<{
            sourceId?: string;
            displayName?: string;
            capabilityId?: string;
            version?: string;
          }>;
        }>("enterprise-data.assets.owned-link", {
          tenantId: normalized,
          capabilityId: normalizedCapability,
        });
        const links = Array.isArray(result?.links)
          ? result.links.flatMap((link) => {
              if (!link?.sourceId || !link.capabilityId) {
                return [];
              }
              return [
                {
                  sourceId: link.sourceId,
                  displayName: link.displayName || link.sourceId,
                  capabilityId: link.capabilityId,
                  ...(link.version ? { version: link.version } : {}),
                },
              ];
            })
          : [];
        return { ok: true, data: links };
      } catch (error) {
        return { ok: false, error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED) };
      }
    },

    async loadCapabilityInstallFacts(tenantId, skillId, agentId) {
      const normalized = tenantId.trim();
      const normalizedSkill = skillId.trim();
      if (!normalized || !normalizedSkill) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{ facts?: unknown }>(
          "enterprise-data.assets.capability-install",
          {
            tenantId: normalized,
            skillId: normalizedSkill,
            ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
          },
        );
        if (!result || !("facts" in result)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.facts };
      } catch (error) {
        return { ok: false, error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED) };
      }
    },

    async listConnectorCredentials(tenantId, connectorId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          credentials: DataConnectorCredentialRecord[];
        }>("enterprise-data.connector-credentials.list", {
          tenantId: normalizedTenant,
          connectorId: connectorId?.trim() || undefined,
        });
        if (!result || !Array.isArray(result.credentials)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.credentials };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async upsertConnectorCredential(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant || !payload.connectorId.trim() || !payload.label.trim()) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          credential: DataConnectorCredentialRecord;
        }>("enterprise-data.connector-credentials.upsert", {
          tenantId: normalizedTenant,
          ...payload,
        });
        if (!result?.credential) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.credential };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listProjectionSpecs(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          specs: Array<Record<string, unknown>>;
        }>("enterprise-data.projection-specs.list", { tenantId: normalized });
        if (!result || !Array.isArray(result.specs)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        const specs = result.specs.map((spec) => ({
          projectionId: readRpcString(spec.projectionId),
          projectionKey: readRpcString(spec.projectionKey),
          displayName: readRpcString(spec.displayName),
          capabilityId: typeof spec.capabilityId === "string" ? spec.capabilityId : undefined,
          lifecycle: readRpcString(spec.lifecycle),
          objectKind: readRpcString(spec.objectKind),
          templateKey: readRpcString(spec.templateKey),
          sourceActionCount: Array.isArray(spec.sourceActions) ? spec.sourceActions.length : 0,
          updatedAt: readRpcString(spec.updatedAt),
        }));
        return { ok: true, data: specs };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async listProjectionBindings(tenantId) {
      const normalized = tenantId.trim();
      if (!normalized) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          bindings: Array<Record<string, unknown>>;
        }>("enterprise-data.projection-bindings.list", { tenantId: normalized });
        if (!result || !Array.isArray(result.bindings)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        const bindings = result.bindings.map((binding) => ({
          bindingId: readRpcString(binding.bindingId),
          projectionId: readRpcString(binding.projectionId),
          capabilityId: typeof binding.capabilityId === "string" ? binding.capabilityId : undefined,
          materializationMode: readRpcString(binding.materializationMode),
          enabled: Boolean(binding.enabled),
          materializationTeamLabel: readRpcString(binding.materializationTeamLabel),
          updatedAt: readRpcString(binding.updatedAt),
          supplyRecordCount:
            typeof binding.supplyRecordCount === "number" ? binding.supplyRecordCount : undefined,
        }));
        return { ok: true, data: bindings };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async upsertProjectionSpec(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          spec: { projectionId: string };
        }>("enterprise-data.projection-specs.upsert", {
          tenantId: normalizedTenant,
          ...payload,
        });
        if (!result?.spec?.projectionId) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { projectionId: result.spec.projectionId } };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async upsertProjectionBinding(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          binding: { bindingId: string };
        }>("enterprise-data.projection-bindings.upsert", {
          tenantId: normalizedTenant,
          ...payload,
        });
        if (!result?.binding?.bindingId) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { bindingId: result.binding.bindingId } };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async runProjectionMaterializer(tenantId, bindingId) {
      const normalizedTenant = tenantId.trim();
      const normalizedBinding = bindingId.trim();
      if (!normalizedTenant || !normalizedBinding) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          result: {
            bindingId: string;
            feedItem: { feedItemId: string; objectId: string; title: string };
          };
        }>("enterprise-data.projection-materializer.run", {
          tenantId: normalizedTenant,
          bindingId: normalizedBinding,
        });
        const materialized = result?.result;
        if (!materialized?.feedItem) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: {
            bindingId: materialized.bindingId,
            feedItemId: materialized.feedItem.feedItemId,
            objectId: materialized.feedItem.objectId,
            title: materialized.feedItem.title,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listFeedItems(tenantId, opts) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          items: Array<{
            objectId: string;
            projectionId: string;
            title: string;
            kind: string;
            category: string;
            sourceSystems?: string[];
            generatedAt: string;
            freshnessStatus: "fresh" | "stale" | "expired";
            isCurrentSupplied?: boolean;
          }>;
        }>("enterprise-data.feed-items.list", {
          tenantId: normalizedTenant,
          ...(opts?.projectionId ? { projectionId: opts.projectionId } : {}),
        });
        if (!result || !Array.isArray(result.items)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: result.items.map((item) => ({
            objectId: item.objectId,
            projectionId: item.projectionId,
            title: item.title,
            kind: item.kind,
            category: item.category,
            sourceSystems: Array.isArray(item.sourceSystems) ? item.sourceSystems : [],
            generatedAt: item.generatedAt,
            freshnessStatus: item.freshnessStatus,
            isCurrentSupplied: item.isCurrentSupplied === true,
          })),
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async deleteFeedItem(tenantId, objectId, opts) {
      const normalizedTenant = tenantId.trim();
      const normalizedObject = objectId.trim();
      if (!normalizedTenant || !normalizedObject) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          tenantId: string;
          item: { objectId: string; deletedAt?: string };
          deleted: boolean;
          forced: boolean;
        }>("enterprise-data.feed-items.delete", {
          tenantId: normalizedTenant,
          objectId: normalizedObject,
          ...(opts?.force ? { force: true } : {}),
        });
        if (!result?.item?.objectId) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: {
            objectId: result.item.objectId,
            deletedAt: result.item.deletedAt,
            forced: result.forced,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async getSource(tenantId, sourceId) {
      const normalizedTenant = tenantId.trim();
      const normalizedSource = sourceId.trim();
      if (!normalizedTenant || !normalizedSource) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourceResponse>("enterprise-data.sources.get", {
          tenantId: normalizedTenant,
          sourceId: normalizedSource,
        });
        if (!result?.source) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.source };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async upsertSource(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourceResponse>("enterprise-data.sources.upsert", {
          tenantId: normalizedTenant,
          ...payload,
        });
        if (!result?.source) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.source };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async archiveSource(tenantId, sourceId) {
      const normalizedTenant = tenantId.trim();
      const normalizedSource = sourceId.trim();
      if (!normalizedTenant || !normalizedSource) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourceResponse>("enterprise-data.sources.archive", {
          tenantId: normalizedTenant,
          sourceId: normalizedSource,
        });
        if (!result?.source) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.source };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async reconnectSource(tenantId, sourceId) {
      const source = await this.getSource(tenantId, sourceId);
      if (!source.ok) {
        return source;
      }
      return this.upsertSource(tenantId, {
        ...source.data,
        status: "connected",
      });
    },

    async syncSource(tenantId, sourceId) {
      const normalizedTenant = tenantId.trim();
      const normalizedSource = sourceId.trim();
      if (!normalizedTenant || !normalizedSource) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{
          status?: "success" | "warning" | "failure";
          summary?: string;
        }>("enterprise-data.sources.sync", {
          tenantId: normalizedTenant,
          sourceId: normalizedSource,
        });
        if (!result?.summary || !result.status) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { status: result.status, summary: result.summary } };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async getSourceSyncLog(tenantId, sourceId) {
      const normalizedTenant = tenantId.trim();
      const normalizedSource = sourceId.trim();
      if (!normalizedTenant || !normalizedSource) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<SourceSyncLogResponse>(
          "enterprise-data.sources.sync-log",
          { tenantId: normalizedTenant, sourceId: normalizedSource },
        );
        if (!result || !Array.isArray(result.events)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        const projectionEntries: ManagedDataSourceSyncLogEntry[] = result.events.map((event) => ({
          entryId: event.auditId,
          recordedAt: event.recordedAt,
          status:
            event.status === "failure"
              ? "failure"
              : event.status === "warning"
                ? "warning"
                : "success",
          title: event.objectId ? `对象 ${event.objectId}` : `投影 ${event.projectionId}`,
          detail:
            event.status === "failure"
              ? `${event.errorCode ?? "SYNC_FAILED"} · ${event.errorMessage ?? "同步失败"}`
              : event.status === "warning"
                ? `投影 ${event.projectionId} 同步有警告`
                : `投影 ${event.projectionId} 同步成功`,
          projectionId: event.projectionId,
        }));
        const connectorEntries: ManagedDataSourceSyncLogEntry[] = (
          result.connectorEntries ?? []
        ).map((entry) => ({
          entryId: entry.entryId,
          recordedAt: entry.recordedAt,
          status: entry.status,
          title: entry.title,
          detail: entry.detail,
        }));
        const entries = [...connectorEntries, ...projectionEntries].toSorted((left, right) =>
          right.recordedAt.localeCompare(left.recordedAt),
        );
        return { ok: true, data: entries };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listAccessPolicies(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AccessPoliciesListResponse>(
          "enterprise-data.access-policies.list",
          { tenantId: normalizedTenant },
        );
        if (!result || !Array.isArray(result.policies)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.policies };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async getAccessPolicy(tenantId, policyId) {
      const normalizedTenant = tenantId.trim();
      const normalizedPolicy = policyId.trim();
      if (!normalizedTenant || !normalizedPolicy) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AccessPolicyDetailResponse>(
          "enterprise-data.access-policies.get",
          { tenantId: normalizedTenant, policyId: normalizedPolicy },
        );
        if (!result?.detail) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.detail };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async upsertAccessPolicy(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AccessPolicyMutationResponse>(
          "enterprise-data.access-policies.upsert",
          { tenantId: normalizedTenant, ...payload },
        );
        if (!result?.policy) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.policy };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async archiveAccessPolicy(tenantId, policyId) {
      const normalizedTenant = tenantId.trim();
      const normalizedPolicy = policyId.trim();
      if (!normalizedTenant || !normalizedPolicy) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AccessPolicyMutationResponse>(
          "enterprise-data.access-policies.archive",
          { tenantId: normalizedTenant, policyId: normalizedPolicy },
        );
        if (!result?.policy) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.policy };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async compileAccessPolicy(tenantId, policyId) {
      const normalizedTenant = tenantId.trim();
      const normalizedPolicy = policyId.trim();
      if (!normalizedTenant || !normalizedPolicy) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<AccessPolicyCompileResponse>(
          "enterprise-data.access-policies.compile",
          { tenantId: normalizedTenant, policyId: normalizedPolicy },
        );
        if (!result?.grants) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.grants };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listConnectorActions(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<ActionsListResponse>("enterprise-data.actions.list", {
          tenantId: normalizedTenant,
          lifecycle: "active",
        });
        if (!result || !Array.isArray(result.actions)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.actions };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async listScopePolicies(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<ScopePoliciesListResponse>(
          "enterprise-data.scope.list",
          { tenantId: normalizedTenant },
        );
        if (!result || !Array.isArray(result.policies)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.policies };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async listApprovalPolicies(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<ApprovalPoliciesListResponse>(
          "enterprise-data.approval.policies.list",
          { tenantId: normalizedTenant },
        );
        if (!result || !Array.isArray(result.policies)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.policies };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async listCapabilities(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilitiesListResponse>(
          "enterprise-data.capabilities.list",
          { tenantId: normalizedTenant },
        );
        if (!result || !Array.isArray(result.capabilities)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.capabilities };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async getCapability(tenantId, capabilityId) {
      const normalizedTenant = tenantId.trim();
      const normalizedCapability = capabilityId.trim();
      if (!normalizedTenant || !normalizedCapability) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilityResponse>(
          "enterprise-data.capabilities.get",
          {
            tenantId: normalizedTenant,
            capabilityId: normalizedCapability,
          },
        );
        if (!result?.capability) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.capability };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async getCapabilityGovernanceView(tenantId, capabilityId) {
      const normalizedTenant = tenantId.trim();
      const normalizedCapability = capabilityId.trim();
      if (!normalizedTenant || !normalizedCapability) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilityGovernanceViewResponse>(
          "enterprise-data.capabilities.governance-view",
          { tenantId: normalizedTenant, capabilityId: normalizedCapability },
        );
        if (!result?.view) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.view };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async upsertCapability(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilityResponse>(
          "enterprise-data.capabilities.upsert",
          { tenantId: normalizedTenant, ...payload },
        );
        if (!result?.capability) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.capability };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async upsertMcpMapping(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      const mcpServer = payload.mcpServer.trim();
      const mcpTool = payload.mcpTool.trim();
      if (!mcpServer || !mcpTool) {
        return { ok: false, error: "mcpServer and mcpTool are required" };
      }
      try {
        const result = await client.request<{
          handlerRef?: string;
          capability?: ManagedCapabilityRecord;
        }>("enterprise-data.mcp-mapping.upsert", {
          tenantId: normalizedTenant,
          mcpServer,
          mcpTool,
          capabilityKey: payload.capabilityKey,
          displayName: payload.displayName,
          description: payload.description,
          capabilityId: payload.capabilityId,
        });
        if (!result?.capability || !result.handlerRef) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return {
          ok: true,
          data: { handlerRef: result.handlerRef, capability: result.capability },
        };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async archiveCapability(tenantId, capabilityId) {
      const normalizedTenant = tenantId.trim();
      const normalizedCapability = capabilityId.trim();
      if (!normalizedTenant || !normalizedCapability) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<CapabilityResponse>(
          "enterprise-data.capabilities.archive",
          { tenantId: normalizedTenant, capabilityId: normalizedCapability },
        );
        if (!result?.capability) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.capability };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listGovernanceApprovals(tenantId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GovernanceApprovalsListResponse>(
          "enterprise-data.governance-approvals.list",
          { tenantId: normalizedTenant },
        );
        if (!result || !Array.isArray(result.requests)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.requests };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async getGovernanceApproval(tenantId, approvalId) {
      const normalizedTenant = tenantId.trim();
      const normalizedApproval = approvalId.trim();
      if (!normalizedTenant || !normalizedApproval) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GovernanceApprovalResponse>(
          "enterprise-data.governance-approvals.get",
          { tenantId: normalizedTenant, approvalId: normalizedApproval },
        );
        if (!result?.request) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.request };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async decideGovernanceApproval(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GovernanceApprovalResponse>(
          "enterprise-data.governance-approvals.decide",
          { tenantId: normalizedTenant, ...payload },
        );
        if (!result?.request) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.request };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async fulfillGovernanceApproval(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      const approvalId = payload.approvalId.trim();
      if (!normalizedTenant || !approvalId) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GovernanceApprovalResponse>(
          "enterprise-data.governance-approvals.fulfill",
          {
            tenantId: normalizedTenant,
            approvalId,
            ...(payload.provisionReceipt ? { provisionReceipt: payload.provisionReceipt } : {}),
          },
        );
        if (!result?.request) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.request };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async listSeatActionGrants(tenantId, seatId) {
      const normalizedTenant = tenantId.trim();
      if (!normalizedTenant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GrantsListResponse>("enterprise-data.grants.list", {
          tenantId: normalizedTenant,
          ...(seatId ? { seatId } : {}),
        });
        if (!result || !Array.isArray(result.grants)) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.grants };
      } catch {
        return { ok: false, error: REQUEST_FAILED };
      }
    },

    async revokeSeatActionGrant(tenantId, grantId) {
      const normalizedTenant = tenantId.trim();
      const normalizedGrant = grantId.trim();
      if (!normalizedTenant || !normalizedGrant) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<GrantResponse>("enterprise-data.grants.revoke", {
          tenantId: normalizedTenant,
          grantId: normalizedGrant,
        });
        if (!result?.grant) {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: result.grant };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },

    async grantCapabilityToSeat(tenantId, payload) {
      const normalizedTenant = tenantId.trim();
      const seatId = payload.seatId.trim();
      const capabilityId = payload.capabilityId.trim();
      if (!normalizedTenant || !seatId || !capabilityId) {
        return { ok: false, error: REQUEST_FAILED };
      }
      try {
        const result = await client.request<{ grantCount: number }>(
          "enterprise-data.capabilities.grant-seat",
          { tenantId: normalizedTenant, seatId, capabilityId },
        );
        if (typeof result?.grantCount !== "number") {
          return { ok: false, error: REQUEST_FAILED };
        }
        return { ok: true, data: { grantCount: result.grantCount } };
      } catch (error) {
        return {
          ok: false,
          error: localizeEnterpriseGatewayThrown(error, REQUEST_FAILED),
        };
      }
    },
  };
}
