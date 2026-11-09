// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_SYNC_SNAPSHOT_ROW_CAP,
  readConnectorSyncSnapshotForAction,
  stripSensitiveSyncRow,
  writeConnectorSyncSnapshot,
} from "./connector-sync-snapshot.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-001";
const sourceId = "src-1";

describe("connector sync snapshot", () => {
  it("merges incremental rows by code and drops secret keys", () => {
    const store = normalizeEnterpriseDataStore({});
    writeConnectorSyncSnapshot({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      streamKey: "inventory",
      actionKey: "erp.inventory.query_page",
      rows: [
        { Code: "A", Name: "旧", openToken: "should-drop" },
        { Code: "B", Name: "保留" },
      ],
      mode: "replace",
      nowIso: "2026-11-05T00:00:00.000Z",
    });
    const merged = writeConnectorSyncSnapshot({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      streamKey: "inventory",
      actionKey: "erp.inventory.query_page",
      rows: [
        { Code: "A", Name: "新" },
        { Code: "C", Name: "追加" },
      ],
      mode: "merge",
      nowIso: "2026-11-08T00:00:00.000Z",
    });
    expect(merged.recordCount).toBe(3);
    expect(merged.rows).toEqual([
      { Code: "A", Name: "新" },
      { Code: "B", Name: "保留" },
      { Code: "C", Name: "追加" },
    ]);
    expect(JSON.stringify(merged.rows)).not.toContain("should-drop");
    expect(
      readConnectorSyncSnapshotForAction({
        store,
        tenantId,
        sourceId,
        connectorId: "erp-yonyou-tplus",
        actionKey: "erp.inventory.query_page",
      })?.syncedAt,
    ).toBe("2026-11-08T00:00:00.000Z");
  });

  it("caps a full replace and marks the snapshot truncated", () => {
    const store = normalizeEnterpriseDataStore({});
    const snapshot = writeConnectorSyncSnapshot({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      streamKey: "inventory",
      actionKey: "erp.inventory.query_page",
      rows: Array.from({ length: CONNECTOR_SYNC_SNAPSHOT_ROW_CAP + 5 }, (_, index) => ({
        Code: `SKU-${index}`,
      })),
      mode: "replace",
      nowIso: "2026-11-08T00:00:00.000Z",
    });
    expect(snapshot.recordCount).toBe(CONNECTOR_SYNC_SNAPSHOT_ROW_CAP);
    expect(snapshot.truncated).toBe(true);
    expect(stripSensitiveSyncRow({ Name: "扇子", appSecret: "x" })).toEqual({ Name: "扇子" });
  });

  it("keeps the previous snapshot when an incremental window is empty", () => {
    const store = normalizeEnterpriseDataStore({});
    writeConnectorSyncSnapshot({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      streamKey: "sale_delivery",
      actionKey: "erp.sale_delivery.query_list",
      rows: [{ Code: "SA-1", Name: "旧单" }],
      mode: "replace",
      nowIso: "2026-11-05T00:00:00.000Z",
    });
    const kept = writeConnectorSyncSnapshot({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      streamKey: "sale_delivery",
      actionKey: "erp.sale_delivery.query_list",
      rows: [],
      mode: "merge",
      nowIso: "2026-11-08T00:00:00.000Z",
    });
    expect(kept.rows).toEqual([{ Code: "SA-1", Name: "旧单" }]);
    expect(kept.syncedAt).toBe("2026-11-08T00:00:00.000Z");
  });
});
