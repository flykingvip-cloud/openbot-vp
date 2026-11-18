import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import {
  persistClassifiedAuthorityRows,
  assertClassifiedCatalogWriteAllowed,
} from "./phase1b-classified-persist.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function storePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-phase1b-"));
  tempDirs.push(dir);
  return path.join(dir, "catalog.json");
}

void describe("persistClassifiedAuthorityRows", () => {
  void it("persists classified rows through put + compareAndPut and quarantines the rest", async () => {
    const catalogPath = storePath();
    const store = createFileDataGovernanceCatalogStore({ storePath: catalogPath });
    const result = await persistClassifiedAuthorityRows({
      store,
      candidates: [
        {
          resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
          classification: "classified",
          workspaceKind: "agent_primary",
          tenantId: "tenant-1",
          userId: "user-1",
          agentAssetId: "asset-1",
        },
        {
          resourceId: "ws:tenant-1:user:user-1:asset:steward:builtin",
          classification: "classified",
          workspaceKind: "employee_private",
          tenantId: "tenant-1",
          userId: "user-1",
        },
        {
          resourceId: "ws:tenant-1:unknown:conflict",
          classification: "conflict",
          workspaceKind: "agent_primary",
          tenantId: "tenant-1",
        },
      ],
      rejected: [{ reason: "agentId_is_not_agentAssetId" }],
    });

    assert.deepEqual(result.persisted.toSorted(), [
      "ws:tenant-1:user:user-1:asset:asset-1",
      "ws:tenant-1:user:user-1:asset:steward:builtin",
    ]);
    assert.deepEqual(result.compareAndPutConfirmed, result.persisted);
    assert.deepEqual(
      result.quarantined.map((row) => row.reason),
      ["agentId_is_not_agentAssetId", "conflict"],
    );

    const got = await store.get("ws:tenant-1:user:user-1:asset:asset-1");
    assert.equal(got?.envelope.governanceVersion, 2);
    assert.equal(got?.envelope.resourceType, "workspace");
    assert.equal(
      (await store.get("ws:tenant-1:user:user-1:asset:steward:builtin"))?.envelope.resourceId,
      "ws:tenant-1:user:user-1:asset:steward:builtin",
    );
    assert.equal(await store.get("ws:tenant-1:unknown:conflict"), null);
    assert.deepEqual(assertClassifiedCatalogWriteAllowed("conflict"), {
      ok: false,
      reason: "conflict",
    });
    assert.deepEqual(assertClassifiedCatalogWriteAllowed("unknown"), {
      ok: false,
      reason: "unknown",
    });
    assert.deepEqual(assertClassifiedCatalogWriteAllowed("classified"), { ok: true });
    assert.deepEqual(result.skippedExisting, []);
  });

  void it("skips existing classified rows when skipExisting is set", async () => {
    const catalogPath = storePath();
    const store = createFileDataGovernanceCatalogStore({ storePath: catalogPath });
    const row = {
      resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
      classification: "classified" as const,
      workspaceKind: "agent_primary",
      tenantId: "tenant-1",
      userId: "user-1",
      agentAssetId: "asset-1",
    };
    await persistClassifiedAuthorityRows({ store, candidates: [row] });
    const second = await persistClassifiedAuthorityRows({
      store,
      candidates: [row],
      skipExisting: true,
    });
    assert.deepEqual(second.persisted, []);
    assert.deepEqual(second.skippedExisting, [row.resourceId]);
    assert.equal((await store.get(row.resourceId))?.envelope.governanceVersion, 2);
  });

  void it("refuses to treat a missing Catalog row as compareAndPut success", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: storePath() });
    const missing = await store.compareAndPut({
      resourceId: "ws:missing",
      expectedGovernanceVersion: 0,
      next: {
        envelope: {
          resourceId: "ws:missing",
          resourceType: "workspace",
          schemaVersion: 1,
          tenantId: "tenant-1",
          owner: { kind: "user", userId: "user-1" },
          scope: { kind: "user", userId: "user-1" },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId: "bind:ws:missing",
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
        bindings: [
          {
            bindingId: "bind:ws:missing",
            resourceId: "ws:missing",
            role: "canonical",
            storageKind: "filesystem",
            locator: "unplaced://classified/ws:missing",
            state: "active",
            contentVersion: "v1",
          },
        ],
      },
    });
    assert.deepEqual(missing, { ok: false, conflict: "not_found" });
  });
});
