import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalogCacheKey, createCachedDataGovernanceCatalog } from "./catalog-cache.js";
import {
  createFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRecord(id = "res-1", gov = 1): CatalogRecord {
  return {
    envelope: {
      resourceId: id,
      resourceType: "conversation_archive" as const,
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner: { kind: "user" as const, userId: "u1" },
      scope: { kind: "user" as const, userId: "u1" },
      lifecycleState: "active" as const,
      classification: "confidential" as const,
      governanceVersion: gov,
      canonicalBindingId: `bind-${id}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: `bind-${id}`,
        resourceId: id,
        role: "canonical" as const,
        storageKind: "filesystem" as const,
        locator: `/data/${id}`,
        state: "active" as const,
        contentVersion: "v1",
      },
    ],
  };
}

describe("createCachedDataGovernanceCatalog", () => {
  it("caches gets and invalidates on put with epoch bump", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-cache-"));
    tempDirs.push(dir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(dir, "catalog.json"),
    });
    let clock = 1_000;
    const cached = createCachedDataGovernanceCatalog({
      store,
      ttlMs: 10_000,
      now: () => clock,
    });
    const epoch0 = cached.currentEpoch();
    await cached.put(makeRecord());
    expect(cached.currentEpoch()).toBeGreaterThan(epoch0);
    await cached.get("res-1");
    await cached.get("res-1");
    expect(cached.stats().hits).toBeGreaterThanOrEqual(1);

    await cached.put({
      ...makeRecord(),
      envelope: { ...makeRecord().envelope, governanceVersion: 2 },
    });
    expect(cached.stats().invalidations).toBeGreaterThanOrEqual(1);
    const got = await cached.get("res-1");
    expect(got?.envelope.governanceVersion).toBe(2);
  });

  it("uses composite cache keys per §7.4", () => {
    expect(
      buildCatalogCacheKey({
        tenantId: "t1",
        principalId: "u1",
        resourceId: "res-1",
        governanceVersion: 3,
      }),
    ).toBe("t1:u1:res-1:3");
  });

  it("degrades to snapshot when live store throws, then fails closed when stale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-cache-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "catalog.json");
    const store = createFileDataGovernanceCatalogStore({ storePath });
    let clock = 10_000;
    const cached = createCachedDataGovernanceCatalog({
      store,
      degradedSnapshotMaxAgeMs: 1_000,
      now: () => clock,
    });
    await cached.put(makeRecord());
    await cached.captureSnapshot();

    fs.writeFileSync(storePath, "{not-json", "utf8");
    const degraded = await cached.getDegraded("res-1", clock);
    expect(degraded.mode).toBe("snapshot");
    if (degraded.mode === "snapshot") {
      expect(degraded.record?.envelope.resourceId).toBe("res-1");
      expect(degraded.epoch).toBeGreaterThanOrEqual(1);
    }

    clock += 5_000;
    const stale = await cached.getDegraded("res-1", clock);
    expect(stale).toEqual({ mode: "unavailable", reason: "snapshot_stale" });
  });

  it("refreshWithBackoff retries with bounded backoff and reports budget", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    let failLeft = 2;
    const record = makeRecord();
    const records = new Map<string, CatalogRecord>([[record.envelope.resourceId, record]]);
    const store: DataGovernanceCatalogStore = {
      async get(resourceId) {
        return records.get(resourceId) ?? null;
      },
      async put(next) {
        records.set(next.envelope.resourceId, next);
      },
      async compareAndPut(params) {
        if (params.next.envelope.resourceId !== params.resourceId) {
          return { ok: false, conflict: "resource_id_mismatch" };
        }
        const current = records.get(params.resourceId);
        if (!current) {
          return { ok: false, conflict: "not_found" };
        }
        if (current.envelope.governanceVersion !== params.expectedGovernanceVersion) {
          return { ok: false, conflict: "version_conflict" };
        }
        if (params.next.envelope.governanceVersion !== params.expectedGovernanceVersion + 1) {
          return { ok: false, conflict: "version_conflict" };
        }
        records.set(params.resourceId, params.next);
        return { ok: true, record: params.next };
      },
      async remove(resourceId) {
        return records.delete(resourceId);
      },
      async list() {
        if (failLeft > 0) {
          failLeft -= 1;
          throw new Error("refresh_fail");
        }
        return [...records.values()];
      },
    };
    const cached = createCachedDataGovernanceCatalog({
      store,
      refreshBackoffMs: [10, 20],
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    const result = await cached.refreshWithBackoff();
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
    expect(cached.getLastSnapshot()?.records[0]?.envelope.resourceId).toBe("res-1");
    expect(result.withinBudget).toBe(true);
  });
});
