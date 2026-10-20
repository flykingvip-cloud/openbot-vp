import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { applyMigrationBatch, type ConstrainedMigrationHandle } from "./migration-apply.js";
import { planMigrationIdentities } from "./migration-identity-plan.js";
import {
  inventoryMigrationCandidates,
  type MigrationInventoryInput,
  type ObservedMigrationSource,
} from "./migration-inventory.js";
import type { CatalogRecord, GovernanceLifecycleReceipt } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.kiro/specs/data-governance-v2-migration/fixtures/tenant-m0-dry-run.json",
);

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  callerTenantId: string;
  catalogRecords: CatalogRecord[];
  receipts: GovernanceLifecycleReceipt[];
  sources: ObservedMigrationSource[];
};

const SIGNING_KEY = "m2-apply-hmac-key";

const adaProof: GovernanceOwnershipProof = {
  owner: { kind: "user", userId: "user-ada" },
  scope: { kind: "tenant", tenantId: "tenant-acme" },
};

const oiProof: GovernanceOwnershipProof = {
  owner: { kind: "system", systemId: "enterprise-oi" },
  scope: { kind: "tenant", tenantId: "tenant-acme" },
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-m2-"));
  tempDirs.push(dir);
  return dir;
}

function fixtureInput(): MigrationInventoryInput {
  return {
    callerTenantId: fixture.callerTenantId,
    catalogRecords: fixture.catalogRecords,
    receipts: fixture.receipts,
    sources: fixture.sources,
  };
}

function fixtureProofs(): Record<string, GovernanceOwnershipProof> {
  return {
    "src-owned-ws": adaProof,
    "src-already-ws": adaProof,
    "catalog:ws-acme-root": adaProof,
    "catalog:agent-acme-ada": adaProof,
    "catalog:conv-acme-1": adaProof,
    "catalog:kb-acme-policy": adaProof,
    "catalog:mem-acme-1": adaProof,
    "catalog:oi-acme-ada": oiProof,
    "catalog:ws-acme-hold": adaProof,
  };
}

function adoptingHandle(root: string): ConstrainedMigrationHandle & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async write(params) {
      writes.push(params.resourceId);
      const dest = path.join(root, "canonical", params.resourceId);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, params.expectedChecksum, "utf8");
      return { checksum: params.expectedChecksum, bindingLocator: dest, storageKind: "filesystem" };
    },
  };
}

describe("applyMigrationBatch M2", () => {
  it("assigns a new canonical via pending → handle → CAS and keeps the old locator read-only", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const source = "/tenants/tenant-acme/workspaces/new";
    fs.mkdirSync(path.dirname(path.join(root, "src-copy")), { recursive: true });
    fs.writeFileSync(path.join(root, "old-src.txt"), "keep-me");
    const handle = adoptingHandle(root);
    const result = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-assign-1",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle,
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe("migrated");
    const resourceId = result.items[0]?.resourceId;
    expect(resourceId).toMatch(/^mig:workspace:/);
    const record = await store.get(resourceId!);
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.tenantId).toBe("tenant-acme");
    const writers = record?.bindings.filter((b) => b.role === "canonical" && b.state === "active");
    expect(writers).toHaveLength(1);
    expect(writers?.[0]?.locator).not.toBe(source);
    const observation = record?.bindings.find((b) => b.role === "replica");
    expect(observation?.state).toBe("read_only");
    expect(observation?.locator).toBe(source);
    expect(fs.existsSync(path.join(root, "old-src.txt"))).toBe(true);
    expect(
      fs.existsSync(path.join(root, "receipts", `${result.items[0]?.receipt.receiptId}.json`)),
    ).toBe(true);
    expect(handle.writes).toEqual([resourceId]);
  });

  it("reuses an already-governed identity without a second writable canonical", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const governed = fixture.catalogRecords.find((r) => r.envelope.resourceId === "ws-acme-root");
    expect(governed).toBeDefined();
    await store.put(governed!);
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const before = await store.get("ws-acme-root");
    const result = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-reuse-1",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: adoptingHandle(root),
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-already-ws", "catalog:ws-acme-root"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.items.every((item) => item.status === "migrated")).toBe(true);
    expect(result.items.every((item) => item.resourceId === "ws-acme-root")).toBe(true);
    const after = await store.get("ws-acme-root");
    expect(after?.envelope.governanceVersion).toBe(before?.envelope.governanceVersion);
    expect(
      after?.bindings.filter((b) => b.role === "canonical" && b.state === "active"),
    ).toHaveLength(1);
  });

  it("quarantines/block rows without Catalog insert and refuses cross-tenant authorization", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const denied = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-globex",
      batchId: "batch-denied",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: adoptingHandle(root),
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
    });
    expect(denied).toEqual({ ok: false, reasonCode: "tenant_not_authorized", items: [] });
    expect(await store.list()).toEqual([]);

    const result = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-q",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: adoptingHandle(root),
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-unknown", "src-orphan", "src-byos", "src-cross-tenant"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.items.map((item) => item.status).every((s) => s === "quarantined" || s === "blocked"),
    ).toBe(true);
    expect(
      result.items.every((item) => item.resourceId === null || item.status !== "migrated"),
    ).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("marks recovery_required when the constrained handle checksum fails, without a second writer", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const result = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-fail",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: {
        async write() {
          return { checksum: "wrong", bindingLocator: "/tmp/wrong", storageKind: "filesystem" };
        },
      },
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.items[0]?.status).toBe("recovery_required");
    const resourceId = result.items[0]?.resourceId;
    const record = await store.get(resourceId!);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(
      record?.bindings.filter((b) => b.role === "canonical" && b.state === "active"),
    ).toHaveLength(1);
  });

  it("applies identity subjects in Workspace/Agent → conversation → knowledge → memory → OI order", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "z-oi",
          tenantId: "tenant-acme",
          resourceType: "operational_identity",
          sourceLocator: "/t/oi",
          checksum: "c-oi",
          schemaVersion: 1,
          existingResourceId: "oi-new",
          ownershipProof: oiProof,
        },
        {
          candidateId: "a-mem",
          tenantId: "tenant-acme",
          resourceType: "memory",
          sourceLocator: "/t/mem",
          checksum: "c-mem",
          schemaVersion: 1,
          existingResourceId: "mem-new",
          ownershipProof: adaProof,
        },
        {
          candidateId: "m-ws",
          tenantId: "tenant-acme",
          resourceType: "workspace",
          sourceLocator: "/t/ws",
          checksum: "c-ws",
          schemaVersion: 1,
          existingResourceId: "ws-new",
          ownershipProof: adaProof,
        },
        {
          candidateId: "k-kb",
          tenantId: "tenant-acme",
          resourceType: "knowledge",
          sourceLocator: "/t/kb",
          checksum: "c-kb",
          schemaVersion: 1,
          existingResourceId: "kb-new",
          ownershipProof: adaProof,
        },
      ],
    });
    const proofs = {
      "z-oi": oiProof,
      "a-mem": adaProof,
      "m-ws": adaProof,
      "k-kb": adaProof,
    };
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs,
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const handle = adoptingHandle(root);
    const result = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-order",
      inventory,
      plan: planned.plan,
      proofs,
      signingKey: SIGNING_KEY,
      store,
      handle,
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(handle.writes).toEqual(["ws-new", "kb-new", "mem-new", "oi-new"]);
    expect(result.items.map((item) => item.receipt.resourceType)).toEqual([
      "workspace",
      "knowledge",
      "memory",
      "operational_identity",
    ]);
  });
});
