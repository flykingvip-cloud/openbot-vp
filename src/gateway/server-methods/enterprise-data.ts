import { listRegistry } from "../capability-governance-store.js";
import { fulfillGovernanceApprovalRequest } from "../enterprise-data/capability-access-request.js";
import {
  EnterpriseDataStoreError,
  findConnectorAction,
  listConnectorActions,
} from "../enterprise-data/connector-action-store.js";
import { daibaiRoleBindingFromSessionRole } from "../enterprise-data/daibai-mcp-scan-hints.js";
import {
  compileDataAccessPolicy,
  findDataAccessPolicy,
  listDataAccessPolicies,
  resolveCompiledActionRefs,
  upsertDataAccessPolicy,
} from "../enterprise-data/data-access-policy-store.js";
import {
  findDataCapability,
  listDataCapabilities,
} from "../enterprise-data/data-capability-store.js";
import { findDataSource, listDataSources } from "../enterprise-data/data-source-store.js";
import {
  requireResolvedEnterpriseAdminTenantId,
  resolveTrustedEnterpriseDataExecutionContext,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  findEnterpriseKnowledgeProjectionBinding,
  listEnterpriseKnowledgeProjectionBindings,
} from "../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "../enterprise-data/knowledge-feed-item-store.js";
import {
  classifyMcpCapabilityDiscovery,
  describeMcpDiscoveryForSeatFailure,
  listTenantDeclaredMcpTools,
  listTenantRemoteMcpTools,
  presentMcpDiscoveryForSeat,
} from "../enterprise-data/mcp-discovery.js";
import { upsertMcpToolMapping } from "../enterprise-data/mcp-mapping.js";
import { listMcpServerToolsForDiscovery } from "../enterprise-data/mcp-remote-tools-list.js";
import { resolveTenantSeatIdSet } from "../enterprise-data/org-targets-store.js";
import {
  findEnterpriseKnowledgeProjectionSpec,
  listEnterpriseKnowledgeProjectionSpecs,
} from "../enterprise-data/projection-spec-store.js";
import { listRuntimeRegistryEntries } from "../enterprise-data/runtime-registry.js";
import {
  listSeatActionGrants,
  revokeSeatActionGrant,
  upsertSeatActionGrant,
} from "../enterprise-data/seat-action-grant-store.js";
import { ensureEnterpriseDataCatalogSeeded } from "../enterprise-data/seeds.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "../enterprise-data/store.js";
import type { ConnectorActionRef } from "../enterprise-data/types.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { readMcpAssetMcporterServers } from "../executable-asset-binding/mcp-config.js";
import { grantDataCapabilityToSeat } from "../knowledge/seat-capability-access.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getSkillRuntimeDefinitionForBinding } from "../skill-lifecycle-store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE, TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import { createEnterpriseDataAssetHandlers } from "./enterprise-data-assets.js";
import { createEnterpriseDataEventHandlers } from "./enterprise-data-events.js";
import { createEnterpriseDataM1Handlers } from "./enterprise-data-m1.js";
import { createEnterpriseDataM2Handlers } from "./enterprise-data-m2.js";
import { createEnterpriseDataM3Handlers } from "./enterprise-data-m3.js";
import { createEnterpriseDataM4Handlers } from "./enterprise-data-m4.js";
import { createEnterpriseDataM5Handlers } from "./enterprise-data-m5.js";
import { createEnterpriseDataM6Handlers } from "./enterprise-data-m6.js";
import { createEnterpriseDataPlannerHandlers } from "./enterprise-data-planner.js";
import { createEnterpriseDataSarAdminHandlers } from "./enterprise-data-sar-admin.js";
import { createEnterpriseDataSemanticHandlers } from "./enterprise-data-semantic.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

function respondMcpDiscoveryForSeatFailure(respond: RespondFn, error: unknown): void {
  const described = describeMcpDiscoveryForSeatFailure(error);
  const code =
    described.code === "MCP_DISCOVERY_UNAVAILABLE"
      ? ErrorCodes.UNAVAILABLE
      : ErrorCodes.INVALID_REQUEST;
  respond(
    false,
    undefined,
    errorShape(code, described.message, { details: { code: described.code } }),
  );
}

function toEnterpriseDataErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Enterprise data operation failed.");
}

function parseActionRefs(value: unknown): ConnectorActionRef[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const refs: ConnectorActionRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const record = item as Record<string, unknown>;
    const connectorId = typeof record.connectorId === "string" ? record.connectorId : "";
    const actionKey = typeof record.actionKey === "string" ? record.actionKey : "";
    const version = typeof record.version === "string" ? record.version : "";
    if (!connectorId || !actionKey || !version) {
      return null;
    }
    refs.push({ connectorId, actionKey, version });
  }
  return refs;
}

async function withEnterpriseDataStore<T>(
  tenantId: string,
  client: GatewayClient | null | undefined,
  run: (store: Awaited<ReturnType<typeof loadEnterpriseDataStore>>) => Promise<T> | T,
): Promise<T> {
  const storePath = await resolveControlPlaneStorePathForClient(
    client ?? null,
    TENANT_ENTERPRISE_DATA_FILE,
  );
  const store = await loadEnterpriseDataStore(storePath);
  const nowIso = new Date().toISOString();
  ensureEnterpriseDataCatalogSeeded({ store, tenantId, nowIso });
  const result = await run(store);
  await saveEnterpriseDataStore(store, storePath);
  return result;
}

const enterpriseDataM1Handlers = createEnterpriseDataM1Handlers(withEnterpriseDataStore);
const enterpriseDataM2Handlers = createEnterpriseDataM2Handlers(withEnterpriseDataStore);
const enterpriseDataM3Handlers = createEnterpriseDataM3Handlers(withEnterpriseDataStore);
const enterpriseDataM4Handlers = createEnterpriseDataM4Handlers(withEnterpriseDataStore);
const enterpriseDataM5Handlers = createEnterpriseDataM5Handlers(withEnterpriseDataStore);
const enterpriseDataM6Handlers = createEnterpriseDataM6Handlers(withEnterpriseDataStore);
const enterpriseDataAssetHandlers = createEnterpriseDataAssetHandlers(withEnterpriseDataStore);
const enterpriseDataSarAdminHandlers =
  createEnterpriseDataSarAdminHandlers(withEnterpriseDataStore);
const enterpriseDataSemanticHandlers = createEnterpriseDataSemanticHandlers();
const enterpriseDataPlannerHandlers = createEnterpriseDataPlannerHandlers();
const enterpriseDataEventHandlers = createEnterpriseDataEventHandlers();

export const enterpriseDataHandlers: GatewayRequestHandlers = {
  ...enterpriseDataM1Handlers,
  ...enterpriseDataM2Handlers,
  ...enterpriseDataM3Handlers,
  ...enterpriseDataM4Handlers,
  ...enterpriseDataM5Handlers,
  ...enterpriseDataM6Handlers,
  ...enterpriseDataAssetHandlers,
  ...enterpriseDataSarAdminHandlers,
  ...enterpriseDataSemanticHandlers,
  ...enterpriseDataPlannerHandlers,
  ...enterpriseDataEventHandlers,
  "enterprise-data.sources.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const sources = await withEnterpriseDataStore(tenantId, client, (store) =>
        listDataSources({ store, tenantId }),
      );
      respond(true, { tenantId, sources });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.sources.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const sourceId = stringValue(params.sourceId);
    if (!sourceId) {
      respondInvalid(respond, "sourceId is required");
      return;
    }
    try {
      const source = await withEnterpriseDataStore(tenantId, client, (store) => {
        const found = findDataSource(store, tenantId, sourceId);
        if (!found) {
          throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
        }
        return found;
      });
      respond(true, { tenantId, source });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.capabilities.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const capabilities = await withEnterpriseDataStore(tenantId, client, (store) =>
        listDataCapabilities({
          store,
          tenantId,
          sourceId: stringValue(params.sourceId) || undefined,
        }),
      );
      respond(true, { tenantId, capabilities });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.capabilities.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const capabilityId = stringValue(params.capabilityId);
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    try {
      const capability = await withEnterpriseDataStore(tenantId, client, (store) => {
        const found = findDataCapability(store, tenantId, capabilityId);
        if (!found) {
          throw new EnterpriseDataStoreError(
            "DATA_CAPABILITY_NOT_FOUND",
            "DataCapability not found.",
          );
        }
        return found;
      });
      respond(true, { tenantId, capability });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.capabilities.grant-seat": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const seatId = stringValue(params.seatId);
    const capabilityId = stringValue(params.capabilityId);
    if (!seatId || !capabilityId) {
      respondInvalid(respond, "seatId and capabilityId are required");
      return;
    }
    // 护栏：席位必须是组织架构中真实存在的席位。
    {
      const seatStore = await loadEnterpriseSeatAssetsStore(
        await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
      );
      const seatIds = resolveTenantSeatIdSet({ seatStore, tenantId });
      if (!seatIds.has(seatId)) {
        respondInvalid(respond, `席位 ${seatId} 不在企业组织架构中，请从组织架构中选择。`);
        return;
      }
    }
    try {
      const result = await withEnterpriseDataStore(tenantId, client, (store) => {
        const grantCount = grantDataCapabilityToSeat({
          store,
          tenantId,
          seatId,
          capabilityId,
          nowIso: new Date().toISOString(),
        });
        const capability = findDataCapability(store, tenantId, capabilityId);
        return { grantCount, capability };
      });
      respond(true, {
        tenantId,
        seatId,
        capabilityId,
        grantCount: result.grantCount,
        capability: result.capability,
      });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.access-policies.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const policies = await withEnterpriseDataStore(tenantId, client, (store) =>
        listDataAccessPolicies({
          store,
          tenantId,
          targetKind:
            params.targetKind === "seat" ||
            params.targetKind === "department" ||
            params.targetKind === "role"
              ? params.targetKind
              : undefined,
          targetId: stringValue(params.targetId) || undefined,
          sourceId: stringValue(params.sourceId) || undefined,
        }),
      );
      respond(true, { tenantId, policies });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.access-policies.upsert": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const displayName = stringValue(params.displayName);
    const targetKind = params.targetKind;
    const targetId = stringValue(params.targetId);
    const actionRefs = parseActionRefs(params.actionRefs);
    if (!displayName || !targetId || !actionRefs?.length) {
      respondInvalid(respond, "displayName, targetId, and actionRefs are required");
      return;
    }
    if (targetKind !== "seat" && targetKind !== "department" && targetKind !== "role") {
      respondInvalid(respond, "targetKind must be seat, department, or role");
      return;
    }
    // 护栏：seat 目标必须是组织架构中真实存在的席位，杜绝手填幽灵 seatId。
    if (targetKind === "seat") {
      const seatStore = await loadEnterpriseSeatAssetsStore(
        await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
      );
      const seatIds = resolveTenantSeatIdSet({ seatStore, tenantId });
      if (!seatIds.has(targetId)) {
        respondInvalid(respond, `目标席位 ${targetId} 不在企业组织架构中，请从组织架构中选择。`);
        return;
      }
    }
    try {
      const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
        upsertDataAccessPolicy({
          store,
          tenantId,
          nowIso: new Date().toISOString(),
          policy: {
            policyId: stringValue(params.policyId) || undefined,
            displayName,
            targetKind,
            targetId,
            sourceId: stringValue(params.sourceId) || undefined,
            actionRefs,
            scopePolicyId: stringValue(params.scopePolicyId) || undefined,
            approvalPolicyId: stringValue(params.approvalPolicyId) || undefined,
            enabled: params.enabled !== false,
          },
        }),
      );
      respond(true, { tenantId, policy });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.access-policies.compile": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const policyId = stringValue(params.policyId);
    if (!policyId) {
      respondInvalid(respond, "policyId is required");
      return;
    }
    try {
      const seatStore = await loadEnterpriseSeatAssetsStore(
        await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
      );
      const seatIds = resolveTenantSeatIdSet({ seatStore, tenantId });
      const result = await withEnterpriseDataStore(tenantId, client, (store) => {
        // 护栏：编译为运行时席位授权前，确认目标席位仍存在于组织架构中。
        const policy = findDataAccessPolicy(store, tenantId, policyId);
        if (policy && policy.targetKind === "seat" && !seatIds.has(policy.targetId)) {
          throw new EnterpriseDataStoreError(
            "DATA_ACCESS_POLICY_SEAT_NOT_FOUND",
            `目标席位 ${policy.targetId} 不在企业组织架构中，无法编译；请重新选择席位。`,
          );
        }
        return compileDataAccessPolicy({
          store,
          tenantId,
          policyId,
          nowIso: new Date().toISOString(),
        });
      });
      respond(true, { tenantId, ...result });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.access-policies.resolve-actions": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const policyId = stringValue(params.policyId);
    if (!policyId) {
      respondInvalid(respond, "policyId is required");
      return;
    }
    try {
      const result = await withEnterpriseDataStore(tenantId, client, (store) => {
        const policy = findDataAccessPolicy(store, tenantId, policyId);
        if (!policy) {
          throw new EnterpriseDataStoreError(
            "DATA_ACCESS_POLICY_NOT_FOUND",
            "DataAccessPolicy not found.",
          );
        }
        return {
          actionRefs: resolveCompiledActionRefs(store, tenantId, policyId),
          compiledGrantIds: policy.compiledGrantIds,
        };
      });
      respond(true, { tenantId, policyId, ...result });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.actions.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const actions = await withEnterpriseDataStore(tenantId, client, (store) =>
        listConnectorActions({
          store,
          tenantId,
          connectorId: stringValue(params.connectorId) || undefined,
          lifecycle:
            typeof params.lifecycle === "string"
              ? (params.lifecycle as "draft" | "active" | "deprecated" | "frozen")
              : undefined,
        }),
      );
      respond(true, { tenantId, actions });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.actions.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    const connectorId = stringValue(params.connectorId);
    const actionKey = stringValue(params.actionKey);
    const version = stringValue(params.version);
    if (!tenantId || !connectorId || !actionKey || !version) {
      respondInvalid(respond, "connectorId, actionKey, and version are required");
      return;
    }
    try {
      const action = await withEnterpriseDataStore(tenantId, client, (store) => {
        const found = findConnectorAction(store, tenantId, { connectorId, actionKey, version });
        if (!found) {
          throw new EnterpriseDataStoreError(
            "CONNECTOR_ACTION_NOT_FOUND",
            `Action ${actionKey}@${version} not found.`,
          );
        }
        return found;
      });
      respond(true, { tenantId, action });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.registry.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const entries = await withEnterpriseDataStore(tenantId, client, (store) =>
        listRuntimeRegistryEntries({
          store,
          tenantId,
          connectorId: stringValue(params.connectorId) || undefined,
        }),
      );
      respond(true, { tenantId, entries });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.mcp-discovery": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const projected = await withEnterpriseDataStore(tenantId, client, (store) => {
        const declared = listTenantDeclaredMcpTools(tenantId, {
          listRegistry,
          readBinding: (skillId) => getSkillRuntimeDefinitionForBinding(skillId),
        });
        return {
          declared,
          registry: listRuntimeRegistryEntries({ store, tenantId }),
          actions: listConnectorActions({ store, tenantId }),
          capabilities: listDataCapabilities({ store, tenantId }),
          grants: listSeatActionGrants({ store, tenantId }),
        };
      });
      const materialized = readMcpAssetMcporterServers();
      const remote = listTenantRemoteMcpTools(tenantId, {
        listRegistry,
        readBinding: (skillId) => getSkillRuntimeDefinitionForBinding(skillId),
        isServerMaterialized: (serverName) => Boolean(materialized[serverName]),
        listRemoteTools: (serverName) => listMcpServerToolsForDiscovery({ serverName }),
      });
      const snapshot = classifyMcpCapabilityDiscovery({
        declaredTools: projected.declared.declaredTools,
        undeclaredServers: projected.declared.undeclaredServers,
        remoteTools: remote.tools,
        remoteToolsList: remote.status,
        registry: projected.registry,
        actions: projected.actions,
        capabilities: projected.capabilities,
        grants: projected.grants,
      });
      respond(true, { tenantId, ...snapshot });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.mcp-discovery.for-seat": async ({ client, params, respond }) => {
    // Session seat only. Client seatId / employeeId are ignored.
    // catalogId / templateId select the shared 大白 hint prefilter. When both
    // are absent, a known session role binding is used; otherwise the seat
    // projection stays unfiltered for the client ranker.
    let context: Awaited<ReturnType<typeof resolveTrustedEnterpriseDataExecutionContext>>;
    try {
      context = await resolveTrustedEnterpriseDataExecutionContext(client);
    } catch (error) {
      respondMcpDiscoveryForSeatFailure(respond, error);
      return;
    }
    const tenantId = context.tenantId.trim();
    const seatId = context.seatId.trim();
    if (!tenantId || !seatId) {
      respondMcpDiscoveryForSeatFailure(
        respond,
        new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found."),
      );
      return;
    }
    const requestedTenant = stringValue(params.tenantId);
    if (
      requestedTenant &&
      (canonicalizeTenantId(requestedTenant) ?? requestedTenant) !== tenantId
    ) {
      respondMcpDiscoveryForSeatFailure(
        respond,
        new EnterpriseDataStoreError(
          "TENANT_MISMATCH",
          "tenantId must match authenticated enterprise scope.",
        ),
      );
      return;
    }
    try {
      const projected = await withEnterpriseDataStore(tenantId, client, (store) => {
        const declared = listTenantDeclaredMcpTools(tenantId, {
          listRegistry,
          readBinding: (skillId) => getSkillRuntimeDefinitionForBinding(skillId),
        });
        return {
          declared,
          registry: listRuntimeRegistryEntries({ store, tenantId }),
          actions: listConnectorActions({ store, tenantId }),
          capabilities: listDataCapabilities({ store, tenantId }),
          grants: listSeatActionGrants({ store, tenantId, seatId }),
        };
      });
      const materialized = readMcpAssetMcporterServers();
      const remote = listTenantRemoteMcpTools(tenantId, {
        listRegistry,
        readBinding: (skillId) => getSkillRuntimeDefinitionForBinding(skillId),
        isServerMaterialized: (serverName) => Boolean(materialized[serverName]),
        listRemoteTools: (serverName) => listMcpServerToolsForDiscovery({ serverName }),
      });
      const snapshot = classifyMcpCapabilityDiscovery({
        declaredTools: projected.declared.declaredTools,
        undeclaredServers: projected.declared.undeclaredServers,
        remoteTools: remote.tools,
        remoteToolsList: remote.status,
        registry: projected.registry,
        actions: projected.actions,
        capabilities: projected.capabilities,
        grants: projected.grants,
        seatId,
      });
      const requestedCatalog = stringValue(params.catalogId);
      const requestedTemplate = stringValue(params.templateId);
      const sessionBinding =
        !requestedCatalog && !requestedTemplate
          ? daibaiRoleBindingFromSessionRole(context.roleCode)
          : null;
      respond(true, {
        tenantId,
        ...presentMcpDiscoveryForSeat({
          seatId,
          snapshot,
          catalogId: requestedCatalog || sessionBinding?.catalogId,
          templateId: requestedTemplate || sessionBinding?.templateId,
        }),
      });
    } catch (error) {
      respondMcpDiscoveryForSeatFailure(respond, error);
    }
  },

  "enterprise-data.mcp-mapping.upsert": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const mcpServer = stringValue(params.mcpServer);
    const mcpTool = stringValue(params.mcpTool);
    if (!mcpServer || !mcpTool) {
      respondInvalid(respond, "mcpServer and mcpTool are required");
      return;
    }
    try {
      const capabilityAccessRequestId =
        stringValue(params.capabilityAccessRequestId) || stringValue(params.requestId) || undefined;
      const nowIso = new Date().toISOString();
      const result = await withEnterpriseDataStore(tenantId, client, async (store) => {
        const mapped = upsertMcpToolMapping({
          store,
          tenantId,
          nowIso,
          input: {
            mcpServer,
            mcpTool,
            capabilityKey: stringValue(params.capabilityKey) || undefined,
            displayName: stringValue(params.displayName) || undefined,
            description: stringValue(params.description) || undefined,
            capabilityId: stringValue(params.capabilityId) || undefined,
          },
          createdBy: stringValue(params.createdBy) || undefined,
        });
        let fulfilledRequest = null;
        if (capabilityAccessRequestId) {
          // Admin Save after approve_intent_only — still explicit; never silent grant.
          const actor =
            stringValue(params.createdBy) || stringValue(params.fulfilledBy) || "enterprise-admin";
          fulfilledRequest = fulfillGovernanceApprovalRequest({
            store,
            tenantId,
            approvalId: capabilityAccessRequestId,
            fulfilledBy: actor,
            nowIso,
            provisionReceipt: {
              handlerRef: mapped.handlerRef,
              capabilityId: mapped.capability.capabilityId,
            },
          });
        }
        return { mapped, fulfilledRequest };
      });
      respond(true, {
        tenantId,
        handlerRef: result.mapped.handlerRef,
        action: result.mapped.action,
        registryEntry: result.mapped.registryEntry,
        source: result.mapped.source,
        capability: result.mapped.capability,
        ...(result.fulfilledRequest ? { capabilityAccessRequest: result.fulfilledRequest } : {}),
      });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.grants.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const grants = await withEnterpriseDataStore(tenantId, client, (store) =>
        listSeatActionGrants({
          store,
          tenantId,
          seatId: stringValue(params.seatId) || undefined,
        }),
      );
      respond(true, { tenantId, grants });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.grants.upsert": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const seatId = stringValue(params.seatId);
    const connectorId = stringValue(params.connectorId);
    const actionKey = stringValue(params.actionKey);
    const version = stringValue(params.version);
    if (!seatId || !connectorId || !actionKey || !version) {
      respondInvalid(respond, "seatId, connectorId, actionKey, and version are required");
      return;
    }
    try {
      const grant = await withEnterpriseDataStore(tenantId, client, (store) =>
        upsertSeatActionGrant({
          store,
          tenantId,
          seatId,
          connectorId,
          actionKey,
          version,
          scopePolicyId: stringValue(params.scopePolicyId) || undefined,
          approvalPolicyId: stringValue(params.approvalPolicyId) || undefined,
          nowIso: new Date().toISOString(),
        }),
      );
      respond(true, { tenantId, grant });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.grants.revoke": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const grantId = stringValue(params.grantId);
    if (!grantId) {
      respondInvalid(respond, "grantId is required");
      return;
    }
    try {
      const grant = await withEnterpriseDataStore(tenantId, client, (store) =>
        revokeSeatActionGrant({
          store,
          tenantId,
          grantId,
          nowIso: new Date().toISOString(),
        }),
      );
      respond(true, { tenantId, grant });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.projection-specs.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const specs = await withEnterpriseDataStore(tenantId, client, (store) =>
        listEnterpriseKnowledgeProjectionSpecs({
          store,
          tenantId,
          capabilityId: stringValue(params.capabilityId) || undefined,
          lifecycle:
            typeof params.lifecycle === "string"
              ? (params.lifecycle as "draft" | "active" | "deprecated" | "frozen")
              : undefined,
        }),
      );
      respond(true, { tenantId, specs });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.projection-specs.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const projectionId = stringValue(params.projectionId);
    if (!projectionId) {
      respondInvalid(respond, "projectionId is required");
      return;
    }
    try {
      const spec = await withEnterpriseDataStore(tenantId, client, (store) => {
        const found = findEnterpriseKnowledgeProjectionSpec(store, tenantId, projectionId);
        if (!found) {
          throw new EnterpriseDataStoreError("PROJECTION_NOT_FOUND", "Projection spec not found.");
        }
        return found;
      });
      respond(true, { tenantId, spec });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },

  "enterprise-data.projection-bindings.list": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const bindings = await withEnterpriseDataStore(tenantId, client, (store) =>
        listEnterpriseKnowledgeProjectionBindings({
          store,
          tenantId,
          projectionId: stringValue(params.projectionId) || undefined,
          capabilityId: stringValue(params.capabilityId) || undefined,
        }).map((binding) => ({
          ...binding,
          supplyRecordCount: listKnowledgeFeedItems({
            store,
            tenantId,
            projectionId: binding.projectionId,
          }).length,
        })),
      );
      respond(true, { tenantId, bindings });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },

  "enterprise-data.projection-bindings.get": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const bindingId = stringValue(params.bindingId);
    if (!bindingId) {
      respondInvalid(respond, "bindingId is required");
      return;
    }
    try {
      const binding = await withEnterpriseDataStore(tenantId, client, (store) => {
        const found = findEnterpriseKnowledgeProjectionBinding(store, tenantId, bindingId);
        if (!found) {
          throw new EnterpriseDataStoreError(
            "PROJECTION_BINDING_NOT_FOUND",
            "Projection binding not found.",
          );
        }
        return found;
      });
      respond(true, { tenantId, binding });
    } catch (error) {
      respond(false, undefined, toEnterpriseDataErrorShape(error));
    }
  },
};
