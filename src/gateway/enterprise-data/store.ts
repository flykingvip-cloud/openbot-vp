import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  ENTERPRISE_DATA_STORE_VERSION,
  DataConnectorCredential,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ClassificationRuntimeConfig,
  type ConnectorAction,
  type ConnectorRuntimeRegistryEntry,
  type DataAccessPolicy,
  type DataAuditEvent,
  type DataCapability,
  type DataSource,
  type EnterpriseDataStore,
  type EnterpriseKnowledgeObjectFeedItem,
  type EnterpriseKnowledgeProjectionSpec,
  type FieldClassification,
  type InvocationAuditEvent,
  type KnowledgeLineageRecord,
  type ConnectorSyncCursor,
  type ConnectorSyncLogEntry,
  type KnowledgeSupplyAuditEvent,
  type GovernanceApprovalRequest,
  type AccountBinding,
  type EnterpriseSarExecutionBridge,
  type EnterpriseKnowledgeProjectionBinding,
  type KnowledgeVisibilityPolicy,
  type MaskingPolicy,
  type ScopePolicy,
  type SeatActionGrant,
  type SarExecutionHalt,
  type SarTraceCorrelation,
  type EnterpriseSarValidationRecord,
  type SarAdminAuditEvent,
} from "./types.js";

const DEFAULT_STORE_FILENAME = "openbot-enterprise-data.json";

function withTenantId<T extends { tenantId: string }>(record: T): T {
  return {
    ...record,
    tenantId: canonicalizeTenantId(record.tenantId) ?? record.tenantId,
  };
}

function normalizeRecordMap<T extends { tenantId: string }>(
  records: Record<string, T> | undefined,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records ?? {}).map(([id, record]) => [id, withTenantId(record)]),
  );
}

export function resolveDefaultEnterpriseDataStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

export function normalizeEnterpriseDataStore(
  parsed: Partial<EnterpriseDataStore> | null | undefined,
): EnterpriseDataStore {
  return {
    version: parsed?.version ?? ENTERPRISE_DATA_STORE_VERSION,
    connectorActions: normalizeRecordMap<ConnectorAction>(parsed?.connectorActions),
    connectorRuntimeRegistry: normalizeRecordMap<ConnectorRuntimeRegistryEntry>(
      parsed?.connectorRuntimeRegistry,
    ),
    seatActionGrants: normalizeRecordMap<SeatActionGrant>(parsed?.seatActionGrants),
    scopePolicies: normalizeRecordMap<ScopePolicy>(parsed?.scopePolicies),
    fieldClassifications: normalizeRecordMap<FieldClassification>(parsed?.fieldClassifications),
    maskingPolicies: normalizeRecordMap<MaskingPolicy>(parsed?.maskingPolicies),
    classificationRuntimeConfigs: normalizeRecordMap<ClassificationRuntimeConfig>(
      parsed?.classificationRuntimeConfigs,
    ),
    approvalPolicies: normalizeRecordMap<ApprovalPolicy>(parsed?.approvalPolicies),
    approvalRequests: normalizeRecordMap<ApprovalRequest>(parsed?.approvalRequests),
    invocationAuditEvents: normalizeRecordMap<InvocationAuditEvent>(parsed?.invocationAuditEvents),
    dataAuditEvents: normalizeRecordMap<DataAuditEvent>(parsed?.dataAuditEvents),
    dataSources: normalizeRecordMap<DataSource>(parsed?.dataSources),
    dataCapabilities: normalizeRecordMap<DataCapability>(parsed?.dataCapabilities),
    dataAccessPolicies: normalizeRecordMap<DataAccessPolicy>(parsed?.dataAccessPolicies),
    enterpriseKnowledgeProjectionSpecs: normalizeRecordMap<EnterpriseKnowledgeProjectionSpec>(
      parsed?.enterpriseKnowledgeProjectionSpecs,
    ),
    enterpriseKnowledgeProjectionBindings: normalizeRecordMap<EnterpriseKnowledgeProjectionBinding>(
      parsed?.enterpriseKnowledgeProjectionBindings ??
        (
          parsed as {
            knowledgeProjectionBindings?: Record<string, EnterpriseKnowledgeProjectionBinding>;
          }
        )?.knowledgeProjectionBindings,
    ),
    knowledgeVisibilityPolicies: normalizeRecordMap<KnowledgeVisibilityPolicy>(
      parsed?.knowledgeVisibilityPolicies,
    ),
    knowledgeFeedItems: normalizeRecordMap<EnterpriseKnowledgeObjectFeedItem>(
      parsed?.knowledgeFeedItems,
    ),
    knowledgeLineageRecords: normalizeRecordMap<KnowledgeLineageRecord>(
      parsed?.knowledgeLineageRecords,
    ),
    knowledgeSupplyAuditEvents: normalizeRecordMap<KnowledgeSupplyAuditEvent>(
      parsed?.knowledgeSupplyAuditEvents,
    ),
    connectorSyncCursors: normalizeRecordMap<ConnectorSyncCursor>(parsed?.connectorSyncCursors),
    connectorSyncLogEntries: normalizeRecordMap<ConnectorSyncLogEntry>(
      parsed?.connectorSyncLogEntries,
    ),
    governanceApprovalRequests: normalizeRecordMap<GovernanceApprovalRequest>(
      parsed?.governanceApprovalRequests,
    ),
    dataConnectorCredentials: normalizeRecordMap<DataConnectorCredential>(
      parsed?.dataConnectorCredentials,
    ),
    sarExecutionBridges: normalizeRecordMap<EnterpriseSarExecutionBridge>(
      parsed?.sarExecutionBridges,
    ),
    accountBindings: normalizeAccountBindings(parsed?.accountBindings),
    sarTraceCorrelations: normalizeRecordMap<SarTraceCorrelation>(parsed?.sarTraceCorrelations),
    sarExecutionHalts: normalizeRecordMap<SarExecutionHalt>(parsed?.sarExecutionHalts),
    sarValidationRecords: normalizeRecordMap<EnterpriseSarValidationRecord>(
      parsed?.sarValidationRecords,
    ),
    sarAdminAuditEvents: normalizeRecordMap<SarAdminAuditEvent>(parsed?.sarAdminAuditEvents),
  };
}

function normalizeAccountBindings(
  records: Record<string, AccountBinding> | undefined,
): Record<string, AccountBinding> {
  const normalized: Record<string, AccountBinding> = {};
  for (const record of Object.values(records ?? {})) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const bindingId = typeof record.bindingId === "string" ? record.bindingId.trim() : "";
    const rawTenant = typeof record.tenantId === "string" ? record.tenantId : "";
    const tenantId = canonicalizeTenantId(rawTenant) ?? rawTenant.trim();
    const userId = typeof record.userId === "string" ? record.userId.trim() : "";
    if (!bindingId || !tenantId || !userId) {
      continue;
    }
    normalized[bindingId] = { bindingId, tenantId, userId };
  }
  return normalized;
}

export async function loadEnterpriseDataStore(storePath?: string): Promise<EnterpriseDataStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseDataStorePath(),
  );
  const parsed = await readJsonFile<Partial<EnterpriseDataStore>>(resolvedPath);
  return normalizeEnterpriseDataStore(parsed);
}

export async function saveEnterpriseDataStore(
  store: EnterpriseDataStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseDataStorePath(),
  );
  const normalized = normalizeEnterpriseDataStore({
    ...store,
    version: ENTERPRISE_DATA_STORE_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}
