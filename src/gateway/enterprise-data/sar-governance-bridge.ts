/**
 * Governance gateway → controlled SAR bridge.
 *
 * Authorization stays in the governance gateway. This module runs only
 * after that grant, scope, and approval pass. It does not call the product
 * site tool, does not export cookies, and does not fall back to mock handlers.
 * The provider is injected by the host. A missing provider fails closed.
 * Write effects stay on the P4 path and are not stored as projection sources.
 */

import { randomUUID } from "node:crypto";
import type { SiteRunResult } from "../../site-capability/result.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataSource, listDataSources } from "./data-source-store.js";
import { evaluateSarExecutionHalt } from "./sar-execution-halt.js";
import { resolveConnectorAccessMethod } from "./source-account.js";
import {
  buildConnectorActionRefKey,
  type ConnectorActionRef,
  type EnterpriseDataInvokeContext,
  type EnterpriseDataStore,
  type EnterpriseSarExecutionBridge,
  type InvocationDenialReason,
  type SarGatewayCorrelation,
  type ScopeEvaluationResult,
} from "./types.js";

const SMUGGLED_INPUT_KEYS = [
  "bindingId",
  "tenantId",
  "userId",
  "credentialId",
  "apiKey",
  "cookie",
  "cookies",
  "cdpUrl",
] as const;

export type SarGovernanceProviderInput = {
  tenantId: string;
  userId: string;
  bindingId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  actionRef: ConnectorActionRef;
  scope: ScopeEvaluationResult;
  input?: Record<string, unknown>;
};

export type SarGovernanceProvider = {
  execute(input: SarGovernanceProviderInput): Promise<{
    result: SiteRunResult;
    /** True only when the scope was applied before any read. */
    scopeEnforcedBeforeRead: boolean;
  }>;
};

export type GovernedSarBridgeDecision =
  | {
      kind: "deny";
      code: InvocationDenialReason;
      message: string;
      details?: Record<string, unknown>;
    }
  | { kind: "preserved"; sar: SarGatewayCorrelation; message: string; data?: unknown }
  | { kind: "ordinary_failure"; sar: SarGatewayCorrelation; message: string }
  | { kind: "complete"; sar: SarGatewayCorrelation; data: unknown };

function bridgesOf(store: EnterpriseDataStore): Record<string, EnterpriseSarExecutionBridge> {
  return store.sarExecutionBridges ?? {};
}

export function listSarExecutionBridges(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId?: string;
}): EnterpriseSarExecutionBridge[] {
  return Object.values(bridgesOf(params.store)).filter((bridge) => {
    if (bridge.tenantId !== params.tenantId) {
      return false;
    }
    if (params.sourceId && bridge.sourceId !== params.sourceId) {
      return false;
    }
    return true;
  });
}

export function findSarExecutionBridge(
  store: EnterpriseDataStore,
  tenantId: string,
  sourceId: string,
  ref: ConnectorActionRef,
): EnterpriseSarExecutionBridge | null {
  const key = buildConnectorActionRefKey(ref);
  return (
    listSarExecutionBridges({ store, tenantId, sourceId }).find(
      (bridge) => buildConnectorActionRefKey(bridge.actionRef) === key,
    ) ?? null
  );
}

function assertExclusiveBinding(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  sourceId: string;
  bindingId: string;
}): void {
  const conflict = listDataSources({ store: params.store, tenantId: params.tenantId }).find(
    (source) =>
      source.sourceId !== params.sourceId &&
      source.connectorId === params.connectorId &&
      source.bindingId === params.bindingId,
  );
  if (conflict) {
    throw new EnterpriseDataStoreError(
      "DATA_SOURCE_BINDING_SHARED",
      `AccountBinding ${params.bindingId} is already used by source ${conflict.sourceId}.`,
    );
  }
}

export function upsertSarExecutionBridge(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  bridge: Omit<
    EnterpriseSarExecutionBridge,
    "bridgeId" | "tenantId" | "createdAt" | "updatedAt" | "effect"
  > & {
    bridgeId?: string;
    effect: string;
  };
  nowIso: string;
}): EnterpriseSarExecutionBridge {
  const source = findDataSource(params.store, params.tenantId, params.bridge.sourceId);
  if (!source) {
    throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
  }
  if (source.connectorId !== params.bridge.actionRef.connectorId) {
    throw new EnterpriseDataStoreError(
      "DATA_SOURCE_CONNECTOR_MISMATCH",
      "Bridge actionRef.connectorId must match the DataSource.",
    );
  }
  if (resolveConnectorAccessMethod(source.connectorId) !== "website_session") {
    throw new EnterpriseDataStoreError(
      "SAR_BRIDGE_ACCESS_METHOD",
      "SAR execution bridges are only for website_session connectors.",
    );
  }
  const bindingId = params.bridge.bindingId.trim();
  const userId = params.bridge.userId.trim();
  const capabilityId = params.bridge.capabilityId.trim();
  const version = params.bridge.version.trim();
  const artifactDigest = params.bridge.artifactDigest.trim();
  if (!bindingId || !userId) {
    throw new EnterpriseDataStoreError(
      "SAR_BINDING_REQUIRED",
      "Bridge requires AccountBinding.bindingId and userId.",
    );
  }
  if (source.bindingId && source.bindingId !== bindingId) {
    throw new EnterpriseDataStoreError(
      "SAR_BINDING_MISMATCH",
      "Bridge bindingId must match the DataSource binding reference.",
    );
  }
  if (!capabilityId || !version || !artifactDigest) {
    throw new EnterpriseDataStoreError(
      "SAR_ARTIFACT_REQUIRED",
      "Bridge requires capabilityId, version, and artifactDigest.",
    );
  }
  if (params.bridge.effect !== "read") {
    throw new EnterpriseDataStoreError(
      "SAR_WRITE_FORBIDDEN",
      "Write effects stay on the P4 path and cannot enter this bridge.",
    );
  }
  assertExclusiveBinding({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: source.connectorId,
    sourceId: source.sourceId,
    bindingId,
  });
  const existing = findSarExecutionBridge(
    params.store,
    params.tenantId,
    source.sourceId,
    params.bridge.actionRef,
  );
  const record: EnterpriseSarExecutionBridge = {
    bridgeId: existing?.bridgeId ?? params.bridge.bridgeId ?? randomUUID(),
    tenantId: params.tenantId,
    sourceId: source.sourceId,
    actionRef: { ...params.bridge.actionRef },
    capabilityId,
    version,
    artifactDigest,
    skillId: params.bridge.skillId?.trim() || undefined,
    bindingId,
    userId,
    verification: params.bridge.verification,
    ...(params.bridge.validator?.trim() ? { validator: params.bridge.validator.trim() } : {}),
    effect: "read",
    supportedScopeTypes: [...params.bridge.supportedScopeTypes],
    enforcedFilterFields: [...params.bridge.enforcedFilterFields],
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  const map = bridgesOf(params.store);
  map[record.bridgeId] = record;
  params.store.sarExecutionBridges = map;
  return record;
}

function smuggledInputKey(input: Record<string, unknown> | undefined): string | null {
  if (!input) {
    return null;
  }
  for (const key of SMUGGLED_INPUT_KEYS) {
    if (key in input) {
      return key;
    }
  }
  return null;
}

function resolveWebsiteSource(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  sourceId?: string;
}): { ok: true; sourceId: string } | { ok: false; code: InvocationDenialReason; message: string } {
  if (params.sourceId) {
    const source = findDataSource(params.store, params.tenantId, params.sourceId);
    if (!source || source.connectorId !== params.connectorId) {
      return {
        ok: false,
        code: "SOURCE_NOT_FOUND",
        message: `DataSource ${params.sourceId} is not an instance of ${params.connectorId}.`,
      };
    }
    return { ok: true, sourceId: source.sourceId };
  }
  const sources = listDataSources({ store: params.store, tenantId: params.tenantId }).filter(
    (source) => source.connectorId === params.connectorId,
  );
  if (sources.length === 1 && sources[0]) {
    return { ok: true, sourceId: sources[0].sourceId };
  }
  if (sources.length > 1) {
    return {
      ok: false,
      code: "SOURCE_ACCOUNT_AMBIGUOUS",
      message: `Connector ${params.connectorId} has multiple website sources. Pass sourceId.`,
    };
  }
  return {
    ok: false,
    code: "SOURCE_NOT_FOUND",
    message: `No website DataSource is registered for ${params.connectorId}.`,
  };
}

export function correlateSarRun(
  result: SiteRunResult,
  artifactDigest: string,
): SarGatewayCorrelation {
  const unknown = result.status === "unknown";
  return {
    status: result.status,
    verification: result.verification,
    completeness: result.completeness,
    runId: result.runId,
    evidenceRef: result.evidenceRef,
    capabilityId: result.capabilityId,
    version: result.version,
    artifactDigest,
    retry: unknown ? "not_ordinary" : (result.error?.retry ?? "none"),
    ordinaryFailure: unknown ? false : result.error?.ordinaryFailure === true,
    errorCode: result.error?.code,
  };
}

export function classifySarGatewayOutcome(
  result: SiteRunResult,
): "complete" | "ordinary_failure" | "preserved" {
  if (result.status === "unknown" || result.completeness === "partial") {
    return "preserved";
  }
  if (result.verification !== "passed") {
    return "preserved";
  }
  if (result.status === "failed") {
    return result.error?.ordinaryFailure === true ? "ordinary_failure" : "preserved";
  }
  if (
    result.status === "succeeded" &&
    result.completeness === "complete" &&
    result.verification === "passed" &&
    result.repair === "none" &&
    !result.error
  ) {
    return "complete";
  }
  return "preserved";
}

function scopeIsSupported(
  bridge: EnterpriseSarExecutionBridge,
  scope: ScopeEvaluationResult,
): boolean {
  if (!bridge.supportedScopeTypes.includes(scope.scopeType)) {
    return false;
  }
  return scope.appliedFilters.every((clause) => bridge.enforcedFilterFields.includes(clause.field));
}

export async function executeGovernedSarBridge(params: {
  store: EnterpriseDataStore;
  context: EnterpriseDataInvokeContext;
  ref: ConnectorActionRef;
  sourceId?: string;
  scope: ScopeEvaluationResult;
  input?: Record<string, unknown>;
  provider?: SarGovernanceProvider;
  actionReadOnly: boolean;
}): Promise<GovernedSarBridgeDecision> {
  const smuggled = smuggledInputKey(params.input);
  if (smuggled) {
    return {
      kind: "deny",
      code: "UNTRUSTED_CLIENT_CONTEXT",
      message: `Client input cannot supply ${smuggled}.`,
    };
  }
  if (!params.actionReadOnly) {
    return {
      kind: "deny",
      code: "SAR_WRITE_FORBIDDEN",
      message: "Write actions do not enter the SAR data bridge or knowledge projection.",
    };
  }
  const resolved = resolveWebsiteSource({
    store: params.store,
    tenantId: params.context.tenantId,
    connectorId: params.ref.connectorId,
    sourceId: params.sourceId,
  });
  if (!resolved.ok) {
    return { kind: "deny", code: resolved.code, message: resolved.message };
  }
  const source = findDataSource(params.store, params.context.tenantId, resolved.sourceId);
  if (!source?.bindingId) {
    return {
      kind: "deny",
      code: "SAR_BINDING_MISSING",
      message: "Website source has no AccountBinding.bindingId.",
    };
  }
  const bridge = findSarExecutionBridge(
    params.store,
    params.context.tenantId,
    source.sourceId,
    params.ref,
  );
  if (!bridge) {
    return {
      kind: "deny",
      code: "SAR_HANDLER_MISSING",
      message: "No SAR execution bridge is registered for this source and action.",
    };
  }
  if (!bridge.bindingId || bridge.bindingId !== source.bindingId) {
    return {
      kind: "deny",
      code: "SAR_BINDING_MISSING",
      message: "SAR bridge binding does not match the DataSource binding reference.",
    };
  }
  if (bridge.userId !== params.context.userId) {
    return {
      kind: "deny",
      code: "SAR_BINDING_PRIVATE",
      message: "Private AccountBinding is not shared with this user.",
    };
  }
  if (bridge.effect !== "read") {
    return {
      kind: "deny",
      code: "SAR_WRITE_FORBIDDEN",
      message: "Write effects stay on the P4 path.",
    };
  }
  if (bridge.verification !== "passed" || !bridge.artifactDigest.trim()) {
    return {
      kind: "deny",
      code: "SAR_VERIFICATION_MISSING",
      message: "SAR capability artifact is not verified for this bridge.",
    };
  }
  if (!scopeIsSupported(bridge, params.scope)) {
    return {
      kind: "deny",
      code: "SAR_SCOPE_UNSUPPORTED",
      message: `Scope ${params.scope.scopeType} is not enforced before read for this capability.`,
    };
  }
  if (!params.provider) {
    return {
      kind: "deny",
      code: "SAR_HANDLER_MISSING",
      message: "No controlled SAR provider is registered. Mock fallback is forbidden.",
    };
  }
  const halt = evaluateSarExecutionHalt({
    store: params.store,
    tenantId: params.context.tenantId,
    capabilityId: bridge.capabilityId,
    version: bridge.version,
  });
  if (halt.blocked) {
    return {
      kind: "deny",
      code: "SAR_EXECUTION_HALTED",
      message: "New SAR runs are halted. In-flight side effects are not withdrawn.",
      details: {
        haltId: halt.halt?.haltId,
        scope: halt.halt?.scope,
        capabilityId: bridge.capabilityId,
        version: bridge.version,
        inFlightSideEffectsWithdrawn: halt.inFlightSideEffectsWithdrawn,
        priorWriteMayBeReplayed: halt.priorWriteMayBeReplayed,
        blocksNewRun: halt.blocksNewRun,
      },
    };
  }
  let executed;
  try {
    executed = await params.provider.execute({
      tenantId: params.context.tenantId,
      userId: bridge.userId,
      bindingId: bridge.bindingId,
      capabilityId: bridge.capabilityId,
      version: bridge.version,
      artifactDigest: bridge.artifactDigest,
      actionRef: params.ref,
      scope: params.scope,
      input: params.input,
    });
  } catch {
    return { kind: "deny", code: "HANDLER_ERROR", message: "SAR provider failed." };
  }
  if (!executed.scopeEnforcedBeforeRead) {
    return {
      kind: "deny",
      code: "SAR_SCOPE_UNSUPPORTED",
      message: "SAR provider read without enforcing scope. Result filtering cannot repair that.",
    };
  }
  const result = executed.result;
  if (result.capabilityId !== bridge.capabilityId || result.version !== bridge.version) {
    return {
      kind: "deny",
      code: "SAR_VERIFICATION_MISSING",
      message: "SAR run capability or version does not match the verified bridge.",
    };
  }
  const sar = correlateSarRun(result, bridge.artifactDigest);
  const outcome = classifySarGatewayOutcome(result);
  if (outcome === "complete") {
    return { kind: "complete", sar, data: result.data };
  }
  if (outcome === "ordinary_failure") {
    const code = result.error?.code?.trim();
    return {
      kind: "ordinary_failure",
      sar,
      message: code ? `SAR run failed (${code}).` : "SAR run failed.",
    };
  }
  const partialData =
    result.status === "succeeded" &&
    result.verification === "passed" &&
    result.completeness === "partial" &&
    result.repair === "none" &&
    !result.error
      ? result.data
      : undefined;
  return {
    kind: "preserved",
    sar,
    message: `SAR run preserved status ${result.status} verification ${result.verification} completeness ${result.completeness}.`,
    ...(partialData !== undefined ? { data: partialData } : {}),
  };
}
