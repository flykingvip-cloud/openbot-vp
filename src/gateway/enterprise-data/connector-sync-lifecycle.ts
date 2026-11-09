/**
 * Connector sync lifecycle shared by test-connection, manual sync, and the
 * maintenance tick. Packs opt in by registering a driver. Yonyou T+ is the
 * first driver. A finished sync refreshes that source's default products even
 * when a FeedItem already exists. Seat grants stay a separate human gate.
 */

import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import { findDataSource } from "./data-source-store.js";
import {
  supplyDefaultDataProductsSafely,
  type DefaultDataProductSupplyResult,
} from "./default-data-product-supply.js";
import type { ConnectorSyncLogStatus, DataSource, EnterpriseDataStore } from "./types.js";
import { syncYonyouTplusSource, yonyouTplusStreamActionKey } from "./yonyou-tplus-sync.js";

export type ConnectorSyncStreamReport = {
  streamKey: string;
  status: ConnectorSyncLogStatus;
  pulled: boolean;
  actionKey?: string;
};

export type ConnectorSyncRunResult = {
  status: ConnectorSyncLogStatus;
  summary: string;
  streams: ConnectorSyncStreamReport[];
};

export type ConnectorSyncDriver = {
  connectorId: string;
  sync: (params: {
    store: EnterpriseDataStore;
    tenantId: string;
    sourceId: string;
    now?: Date;
  }) => Promise<ConnectorSyncRunResult>;
};

const drivers = new Map<string, ConnectorSyncDriver>();
let builtinsReady = false;

export function registerConnectorSyncDriver(driver: ConnectorSyncDriver): void {
  drivers.set(driver.connectorId.trim().toLowerCase(), driver);
}

function registerBuiltinConnectorSyncDrivers(): void {
  if (builtinsReady) {
    return;
  }
  builtinsReady = true;
  if (!drivers.has(YONYOU_TPLUS_CONNECTOR_ID)) {
    registerConnectorSyncDriver({
      connectorId: YONYOU_TPLUS_CONNECTOR_ID,
      sync: async (params) => {
        const result = await syncYonyouTplusSource(params);
        return {
          status: result.status,
          summary: result.summary,
          streams: result.streams.map((stream) => ({
            streamKey: stream.streamKey,
            status: stream.status,
            pulled: stream.pulled,
            actionKey: yonyouTplusStreamActionKey(stream.streamKey),
          })),
        };
      },
    });
  }
}

/** Test hook: drop drivers and allow builtins to register again. */
export function resetConnectorSyncDriversForTests(): void {
  drivers.clear();
  builtinsReady = false;
}

export function getConnectorSyncDriver(connectorId: string): ConnectorSyncDriver | null {
  registerBuiltinConnectorSyncDrivers();
  return drivers.get(connectorId.trim().toLowerCase()) ?? null;
}

export function sourceEligibleForAutoSync(source: DataSource): boolean {
  if (!source.credentialId?.trim()) {
    return false;
  }
  if (source.status === "disconnected") {
    return false;
  }
  return getConnectorSyncDriver(source.connectorId) != null;
}

export type SyncConnectedSourceResult = {
  sync?: ConnectorSyncRunResult;
  supply?: DefaultDataProductSupplyResult;
};

/**
 * Run the source's sync driver when one is registered, then supply default
 * products. Successful or partial sync forces a Feed refresh for the streams
 * that returned rows or a finished window. Connect without a driver still
 * supplies products (previous behavior). Manual sync passes `requireDriver`.
 */
export async function syncConnectedSourceAndSupply(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  now?: Date;
  requireDriver?: boolean;
}): Promise<SyncConnectedSourceResult> {
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    throw new Error("DataSource not found.");
  }
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const driver = getConnectorSyncDriver(source.connectorId);
  if (!driver) {
    if (params.requireDriver) {
      throw new Error("该数据源未接入增量同步。");
    }
    const supply = await supplyDefaultDataProductsSafely({
      store: params.store,
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      nowIso,
    });
    return { supply };
  }

  let sync: ConnectorSyncRunResult;
  try {
    sync = await driver.sync({
      store: params.store,
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      now,
    });
  } catch (error) {
    const supply = await supplyDefaultDataProductsSafely({
      store: params.store,
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      nowIso,
    });
    const message = error instanceof Error ? error.message : "连接器同步失败";
    return {
      sync: {
        status: "failure",
        summary: message,
        streams: [],
      },
      supply,
    };
  }

  const actionKeys = sync.streams
    .filter((stream) => stream.status === "success" || stream.status === "warning")
    .map((stream) => stream.actionKey)
    .filter((actionKey): actionKey is string => Boolean(actionKey));
  const forceRefresh = sync.status !== "failure" && actionKeys.length > 0;
  const supply = await supplyDefaultDataProductsSafely({
    store: params.store,
    tenantId: params.tenantId,
    sourceId: params.sourceId,
    nowIso,
    ...(actionKeys.length > 0 ? { actionKeys } : {}),
    ...(forceRefresh ? { forceRefresh: true } : {}),
  });
  return { sync, supply };
}
