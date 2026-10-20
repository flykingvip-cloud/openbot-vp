import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { createDataGovernanceInventoryApi } from "./inventory-api.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-inv-"));
  tempDirs.push(dir);
  return createFileDataGovernanceCatalogStore({ storePath: path.join(dir, "catalog.json") });
}

describe("createDataGovernanceInventoryApi", () => {
  it("lists and gets first-wave resources", async () => {
    const store = makeStore();
    const api = createDataGovernanceInventoryApi({ store });
    await store.put({
      envelope: {
        resourceId: "agent-1",
        resourceType: "agent",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "user", userId: "u1" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-a",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-a",
          resourceId: "agent-1",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/agent",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });

    const list = await api.list({ resourceType: "agent", tenantId: "t1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.canonicalLocator).toBe("/data/agent");

    const got = await api.get("agent-1");
    expect(got?.record.envelope.resourceType).toBe("agent");
    expect(got?.bindingIssues).toEqual([]);
  });

  it("diagnose reports orphans against observed locators", async () => {
    const store = makeStore();
    const api = createDataGovernanceInventoryApi({ store });
    const report = await api.diagnose({
      observedLocators: ["/data/untracked-workspace"],
    });
    expect(report.orphans).toEqual([
      { locator: "/data/untracked-workspace", reason: "no_catalog_binding" },
    ]);
    expect(report.wrongOwnerScope).toEqual([]);
  });

  it("filters by lifecycleState and listRecoveryRequired", async () => {
    const store = makeStore();
    const api = createDataGovernanceInventoryApi({ store });
    await store.put({
      envelope: {
        resourceId: "agent-rr",
        resourceType: "agent",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "user", userId: "u1" },
        lifecycleState: "recovery_required",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-rr",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-rr",
          resourceId: "agent-rr",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/agent-rr",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });
    await store.put({
      envelope: {
        resourceId: "agent-ok",
        resourceType: "agent",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "user", userId: "u1" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-ok",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-ok",
          resourceId: "agent-ok",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/agent-ok",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });

    const filtered = await api.list({ lifecycleState: "recovery_required", tenantId: "t1" });
    expect(filtered.map((i) => i.resourceId)).toEqual(["agent-rr"]);
    const rr = await api.listRecoveryRequired({ tenantId: "t1" });
    expect(rr).toHaveLength(1);
    expect(rr[0]?.lifecycleState).toBe("recovery_required");
  });

  it("lists second-wave knowledge/memory/operational_identity with tenant isolation", async () => {
    const store = makeStore();
    const api = createDataGovernanceInventoryApi({ store });
    const now = "2026-08-11T00:00:00Z";
    for (const row of [
      {
        resourceId: "knowledge:t1:doc:d1:v1",
        resourceType: "knowledge" as const,
        tenantId: "t1",
        locator: "/data/k",
      },
      {
        resourceId: "memory:t1:atom:a1",
        resourceType: "memory" as const,
        tenantId: "t1",
        locator: "/data/m",
      },
      {
        resourceId: "operational_identity:t1:id-1",
        resourceType: "operational_identity" as const,
        tenantId: "t1",
        locator: "/data/oi",
      },
      {
        resourceId: "knowledge:t2:doc:d9:v1",
        resourceType: "knowledge" as const,
        tenantId: "t2",
        locator: "/data/k2",
      },
    ]) {
      await store.put({
        envelope: {
          resourceId: row.resourceId,
          resourceType: row.resourceType,
          schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
          tenantId: row.tenantId,
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "tenant", tenantId: row.tenantId },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId: `bind:${row.resourceId}`,
          createdAt: now,
          updatedAt: now,
        },
        bindings: [
          {
            bindingId: `bind:${row.resourceId}`,
            resourceId: row.resourceId,
            role: "canonical",
            storageKind: "filesystem",
            locator: row.locator,
            state: "active",
            contentVersion: "v1",
          },
        ],
      });
    }

    const knowledge = await api.list({ resourceType: "knowledge", tenantId: "t1" });
    expect(knowledge.map((i) => i.resourceId)).toEqual(["knowledge:t1:doc:d1:v1"]);
    const memory = await api.list({ resourceType: "memory", tenantId: "t1" });
    expect(memory).toHaveLength(1);
    const oi = await api.list({ resourceType: "operational_identity", tenantId: "t1" });
    expect(oi).toHaveLength(1);
    const t2 = await api.list({ tenantId: "t2" });
    expect(t2.map((i) => i.resourceId)).toEqual(["knowledge:t2:doc:d9:v1"]);
  });

  it("diagnose reports wrongOwnerScope against ownership proofs", async () => {
    const store = makeStore();
    const api = createDataGovernanceInventoryApi({ store });
    await store.put({
      envelope: {
        resourceId: "knowledge:t1:doc:d1:v1",
        resourceType: "knowledge",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "tenant", tenantId: "t1" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-k",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-k",
          resourceId: "knowledge:t1:doc:d1:v1",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/k",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });

    const report = await api.diagnose({
      ownershipProofs: [
        {
          resourceId: "knowledge:t1:doc:d1:v1",
          tenantId: "t1",
          owner: { kind: "user", userId: "u-other" },
          scope: { kind: "tenant", tenantId: "t1" },
        },
      ],
    });
    expect(report.wrongOwnerScope.some((i) => i.code === "owner_mismatch")).toBe(true);
  });
});
