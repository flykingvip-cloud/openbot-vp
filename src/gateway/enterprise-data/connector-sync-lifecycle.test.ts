// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-connector-sync-lifecycle-${process.pid}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: vault.tmpDir,
  };
});
import { loadEnterpriseKnowledgeFeed } from "../knowledge/feed/enterprise-feed-adapter.js";
import {
  feedRecordObjectId,
  readEnterpriseFeedPage,
} from "../knowledge/feed/enterprise-feed-adapter.js";
import { grantDataCapabilityToSeat } from "../knowledge/seat-capability-access.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import {
  registerConnectorSyncDriver,
  resetConnectorSyncDriversForTests,
  syncConnectedSourceAndSupply,
} from "./connector-sync-lifecycle.js";
import { writeConnectorSyncSnapshot } from "./connector-sync-snapshot.js";
import { upsertDataSource } from "./data-source-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import {
  connectorSyncCursorKey,
  resetConnectorSyncTickInFlightForTests,
  runScheduledConnectorSyncForStore,
  setConnectorSyncCursorPathForTests,
  tickScheduledConnectorSync,
} from "./scheduled-connector-sync.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";

const vaultDir = vault.tmpDir;
const tenantId = "tenant-001";
const sourceId = "src-licheng";
const nowIso = "2026-11-08T13:00:00.000Z";

async function connectedSource() {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  const store = normalizeEnterpriseDataStore({});
  ensureConnectorPackage({
    store,
    tenantId,
    connectorId: "erp-yonyou-tplus",
    nowIso,
  });
  const credential = upsertDataConnectorCredential({
    store,
    tenantId,
    connectorId: "erp-yonyou-tplus",
    label: "利成和信",
    kind: "oauth2",
    nowIso,
  });
  await saveCredentialSecret(credential.credentialId, {
    oauthAccessToken: "simulated-yonyou-tplus-token-abc",
  });
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: "yonyou-tplus-licheng",
      displayName: "001-用友T+",
      category: "erp",
      status: "connected",
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    },
  });
  return store;
}

function inventoryRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    Code: `SKU-${index}`,
    Name: "扇子",
  }));
}

describe("connector sync lifecycle", () => {
  afterEach(() => {
    resetConnectorSyncDriversForTests();
    resetConnectorSyncTickInFlightForTests();
    setConnectorSyncCursorPathForTests(null);
  });

  it("syncs on connect and force-refreshes an existing feed from the snapshot", async () => {
    const store = await connectedSource();
    let pulls = 0;
    registerConnectorSyncDriver({
      connectorId: "erp-yonyou-tplus",
      sync: async (params) => {
        pulls += 1;
        writeConnectorSyncSnapshot({
          store: params.store,
          tenantId: params.tenantId,
          sourceId: params.sourceId,
          connectorId: "erp-yonyou-tplus",
          streamKey: "inventory",
          actionKey: "erp.inventory.query_page",
          rows: inventoryRows(pulls === 1 ? 150 : 151),
          mode: "replace",
          nowIso,
        });
        return {
          status: "success",
          summary: "用友 T+ 同步完成",
          streams: [
            {
              streamKey: "inventory",
              status: "success",
              pulled: true,
              actionKey: "erp.inventory.query_page",
            },
          ],
        };
      },
    });

    const first = await syncConnectedSourceAndSupply({
      store,
      tenantId,
      sourceId,
      now: new Date(nowIso),
    });
    expect(first.sync?.status).toBe("success");
    expect(first.supply?.materialized).toBe(1);
    expect(first.supply?.failed).toBe(0);
    const firstFeed = listKnowledgeFeedItems({ store, tenantId }).find((item) =>
      item.title.includes("存货"),
    );
    expect(firstFeed?.payload.count).toBe(150);

    const second = await syncConnectedSourceAndSupply({
      store,
      tenantId,
      sourceId,
      now: new Date(nowIso),
    });
    expect(second.supply?.materialized).toBe(1);
    const secondFeed = listKnowledgeFeedItems({ store, tenantId }).find((item) =>
      item.title.includes("存货"),
    );
    expect(secondFeed?.payload.count).toBe(151);
    const items = secondFeed?.payload.items as Array<{ Code?: string }>;
    expect(items[120]?.Code).toBe("SKU-120");

    const context = {
      tenantId,
      seatId: "seat-frontline",
      userId: "user-1",
      hasEnterpriseScope: true,
    };
    const before = loadEnterpriseKnowledgeFeed({ store, context });
    expect(before.accessible).toHaveLength(0);
    expect(before.restricted.length).toBeGreaterThan(0);
    const objectId = feedRecordObjectId(secondFeed!.objectId);
    expect(readEnterpriseFeedPage({ store, context, objectId, offset: 20, limit: 10 }).kind).toBe(
      "restricted",
    );

    const capabilityId = first.supply?.capabilityIds[0];
    expect(capabilityId).toBeTruthy();
    grantDataCapabilityToSeat({
      store,
      tenantId,
      seatId: "seat-frontline",
      capabilityId: capabilityId!,
      nowIso,
    });
    const page = readEnterpriseFeedPage({
      store,
      context,
      objectId,
      offset: 20,
      limit: 10,
    });
    expect(page.kind).toBe("granted");
    if (page.kind === "granted") {
      expect(page.total).toBe(151);
      expect(page.items).toHaveLength(10);
      expect((page.items[0] as { Code?: string }).Code).toBe("SKU-20");
    }
    expect(loadEnterpriseKnowledgeFeed({ store, context }).accessible).toHaveLength(1);
  });

  it("runs a due source on the schedule and skips it until the interval elapses", async () => {
    const store = await connectedSource();
    let pulls = 0;
    registerConnectorSyncDriver({
      connectorId: "erp-yonyou-tplus",
      sync: async (params) => {
        pulls += 1;
        writeConnectorSyncSnapshot({
          store: params.store,
          tenantId: params.tenantId,
          sourceId: params.sourceId,
          connectorId: "erp-yonyou-tplus",
          streamKey: "inventory",
          actionKey: "erp.inventory.query_page",
          rows: [{ Code: "SKU-0", Name: "扇子" }],
          mode: "replace",
          nowIso,
        });
        return {
          status: "success",
          summary: "ok",
          streams: [
            {
              streamKey: "inventory",
              status: "success",
              pulled: true,
              actionKey: "erp.inventory.query_page",
            },
          ],
        };
      },
    });
    const cursorPath = path.join(vaultDir, "sync-cursor.json");
    setConnectorSyncCursorPathForTests(cursorPath);
    const first = await runScheduledConnectorSyncForStore({
      store,
      tenantId,
      nowIso,
      cursor: {
        lastRunBySourceId: {},
        lastFailureBySourceId: {},
        failureCountBySourceId: {},
      },
    });
    expect(pulls).toBe(1);
    expect(first.succeeded).toBe(1);
    expect(first.cursor.lastRunBySourceId[connectorSyncCursorKey(tenantId, sourceId)]).toBe(nowIso);

    const second = await runScheduledConnectorSyncForStore({
      store,
      tenantId,
      nowIso,
      cursor: first.cursor,
    });
    expect(pulls).toBe(1);
    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("ticks a tenant store and does not sync a disconnected source", async () => {
    const tenantsRoot = path.join(os.tmpdir(), `connector-sync-tick-${process.pid}`);
    fs.rmSync(tenantsRoot, { recursive: true, force: true });
    const store = await connectedSource();
    const disconnectedId = "src-off";
    upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceId: disconnectedId,
        sourceKey: "yonyou-off",
        displayName: "未连接",
        category: "erp",
        status: "disconnected",
        connectorId: "erp-yonyou-tplus",
        credentialId: "cred-off",
      },
    });
    const synced: string[] = [];
    registerConnectorSyncDriver({
      connectorId: "erp-yonyou-tplus",
      sync: async (params) => {
        synced.push(params.sourceId);
        writeConnectorSyncSnapshot({
          store: params.store,
          tenantId: params.tenantId,
          sourceId: params.sourceId,
          connectorId: "erp-yonyou-tplus",
          streamKey: "inventory",
          actionKey: "erp.inventory.query_page",
          rows: [{ Code: "SKU-0", Name: "扇子" }],
          mode: "replace",
          nowIso,
        });
        return {
          status: "success",
          summary: "ok",
          streams: [
            {
              streamKey: "inventory",
              status: "success",
              pulled: true,
              actionKey: "erp.inventory.query_page",
            },
          ],
        };
      },
    });
    const controlPlane = path.join(tenantsRoot, tenantId, "control-plane");
    fs.mkdirSync(controlPlane, { recursive: true });
    const storePath = path.join(controlPlane, TENANT_ENTERPRISE_DATA_FILE);
    await saveEnterpriseDataStore(store, storePath);
    const cursorPath = path.join(tenantsRoot, "cursor.json");
    const result = await tickScheduledConnectorSync({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    expect(result.tenantsScanned).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(synced).toEqual([sourceId]);
    const reloaded = await loadEnterpriseDataStore(storePath);
    expect(reloaded.dataSources[sourceId]?.status).toBe("connected");
    fs.rmSync(tenantsRoot, { recursive: true, force: true });
  });
});
