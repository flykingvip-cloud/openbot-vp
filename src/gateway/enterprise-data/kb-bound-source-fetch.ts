/**
 * Enterprise-data plane bridge for KB-bound `external` sources.
 *
 * Parses `enterprise-data://tenant/{tenantId}/source/{sourceId}?connectorId=…`
 * (UI dual of buildEnterpriseDataSourceBindEndpoint) and fetches a governed
 * snapshot via `invokeDataCapabilityWithContext`. That gate does not request
 * ConnectorAction; knowledge ingest must consume materialized FeedItems.
 */
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import {
  invokeDataCapabilityWithContext,
  type CapabilityDataInvocationOutcome,
} from "./capability-agent-invoke-runtime.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "./enterprise-data-seat-context.js";
import { ensureEnterpriseDataCatalogSeeded } from "./seeds.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";

export type EnterpriseDataSourceLocator = {
  tenantId: string;
  sourceId: string;
  connectorId?: string;
};

const ENTERPRISE_DATA_ENDPOINT_RE =
  /^enterprise-data:\/\/tenant\/([^/?#]+)\/source\/([^/?#]+)(?:\?([^#]*))?$/i;

export function parseEnterpriseDataSourceLocator(
  endpoint: string | undefined | null,
): EnterpriseDataSourceLocator | null {
  const raw = endpoint?.trim();
  if (!raw) {
    return null;
  }
  const match = ENTERPRISE_DATA_ENDPOINT_RE.exec(raw);
  if (!match) {
    return null;
  }
  let tenantId: string;
  let sourceId: string;
  try {
    tenantId = decodeURIComponent(match[1] ?? "").trim();
    sourceId = decodeURIComponent(match[2] ?? "").trim();
  } catch {
    return null;
  }
  if (!tenantId || !sourceId) {
    return null;
  }
  let connectorId: string | undefined;
  const query = match[3];
  if (query) {
    const params = new URLSearchParams(query);
    const rawConnector = params.get("connectorId")?.trim();
    if (rawConnector) {
      try {
        connectorId = decodeURIComponent(rawConnector).trim() || undefined;
      } catch {
        connectorId = rawConnector;
      }
    }
  }
  return { tenantId, sourceId, ...(connectorId ? { connectorId } : {}) };
}

export type KbBoundExternalSourceFetchResult = {
  ok: boolean;
  sourceId: string;
  capabilityId?: string;
  connectorId?: string;
  payload?: unknown;
  reason?: string;
  outcome?: CapabilityDataInvocationOutcome;
};

/**
 * Resolve the first enabled capability for a KB-bound enterprise-data source
 * and invoke it under the signed-in seat. Persists store mutations (audit).
 */
export async function fetchKbBoundExternalSourcePayload(params: {
  client: GatewayClient | null;
  endpoint: string;
  input?: Record<string, unknown>;
}): Promise<KbBoundExternalSourceFetchResult> {
  const locator = parseEnterpriseDataSourceLocator(params.endpoint);
  if (!locator) {
    return {
      ok: false,
      sourceId: "",
      reason: "invalid enterprise-data endpoint",
    };
  }

  let context;
  try {
    context = await resolveTrustedEnterpriseDataExecutionContext(params.client);
  } catch {
    return { ok: false, sourceId: locator.sourceId, reason: "no-seat" };
  }
  if (context.tenantId && context.tenantId !== locator.tenantId) {
    return {
      ok: false,
      sourceId: locator.sourceId,
      reason: "tenant mismatch for enterprise-data source",
    };
  }

  const storePath = await resolveControlPlaneStorePathForClient(
    params.client,
    TENANT_ENTERPRISE_DATA_FILE,
  );
  const store = await loadEnterpriseDataStore(storePath);
  const nowIso = new Date().toISOString();
  ensureEnterpriseDataCatalogSeeded({ store, tenantId: context.tenantId, nowIso });

  const capabilities = listDataCapabilities({
    store,
    tenantId: context.tenantId,
    sourceId: locator.sourceId,
    enabled: true,
  });
  const capability = capabilities[0];
  if (!capability) {
    return {
      ok: false,
      sourceId: locator.sourceId,
      ...(locator.connectorId ? { connectorId: locator.connectorId } : {}),
      reason: "no enabled capability for bound source",
    };
  }

  const outcome = await invokeDataCapabilityWithContext({
    store,
    context,
    capabilityId: capability.capabilityId,
    input: params.input,
    nowIso,
  });
  await saveEnterpriseDataStore(store, storePath);

  if (!outcome.ok) {
    return {
      ok: false,
      sourceId: locator.sourceId,
      capabilityId: capability.capabilityId,
      ...(locator.connectorId ? { connectorId: locator.connectorId } : {}),
      reason: outcome.reason ?? "capability invoke failed",
      outcome,
    };
  }

  const payload =
    outcome.results?.length === 1
      ? (outcome.results[0]?.data ?? outcome.results)
      : (outcome.results?.map((row) => ({
          connectorId: row.connectorId,
          actionKey: row.actionKey,
          ok: row.ok,
          data: row.data,
          recordCount: row.recordCount,
        })) ?? null);

  return {
    ok: true,
    sourceId: locator.sourceId,
    capabilityId: capability.capabilityId,
    ...(locator.connectorId ? { connectorId: locator.connectorId } : {}),
    payload,
    outcome,
  };
}
