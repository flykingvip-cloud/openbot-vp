import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import {
  inventoryMigrationCandidates,
  mustNotEnterCatalog,
  refuseMtimeAsInventoryTruth,
  type MigrationInventoryInput,
  type ObservedMigrationSource,
} from "./migration-inventory.js";
import type { CatalogRecord, GovernanceLifecycleReceipt } from "./types.js";

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

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureInput(): MigrationInventoryInput {
  return {
    callerTenantId: fixture.callerTenantId,
    catalogRecords: fixture.catalogRecords,
    receipts: fixture.receipts,
    sources: fixture.sources,
  };
}

function byId(report: ReturnType<typeof inventoryMigrationCandidates>, id: string) {
  return report.candidates.find((c) => c.candidateId === id);
}

describe("inventoryMigrationCandidates M0", () => {
  it("covers workspace/agent/conversation/knowledge/memory/OI plus catalog/binding/receipt/legal-hold", () => {
    const report = inventoryMigrationCandidates(fixtureInput());
    const types = new Set(report.candidates.map((c) => c.resourceType));
    expect(types.has("workspace")).toBe(true);
    expect(types.has("agent")).toBe(true);
    expect(types.has("conversation_archive")).toBe(true);
    expect(types.has("knowledge")).toBe(true);
    expect(types.has("memory")).toBe(true);
    expect(types.has("operational_identity")).toBe(true);
    expect(report.candidates.some((c) => c.candidateId.startsWith("catalog:"))).toBe(true);
    expect(types.has("binding")).toBe(true);
    expect(types.has("receipt")).toBe(true);
    expect(types.has("legal_hold")).toBe(true);
    expect(types.has("retention")).toBe(true);
    expect(report.writes).toBe(0);
    expect(report.generatedKind).toBe("read_only_dry_run");
    expect(report.schemaVersion).toBe(1);
  });

  it("classifies owned, already_governed, unknown, orphan, duplicate, tombstone, legal-hold, cross-tenant", () => {
    const report = inventoryMigrationCandidates(fixtureInput());
    expect(byId(report, "src-owned-ws")?.disposition).toBe("owned");
    expect(byId(report, "src-owned-ws")?.proposedResourceId).toMatch(/^mig:workspace:/);
    expect(byId(report, "src-already-ws")?.disposition).toBe("already_governed");
    expect(byId(report, "src-already-ws")?.proposedResourceId).toBe("ws-acme-root");
    expect(byId(report, "src-unknown")?.disposition).toBe("unknown");
    expect(byId(report, "src-orphan")?.disposition).toBe("orphan");
    expect(byId(report, "src-dup-a")?.disposition).toBe("duplicate");
    expect(byId(report, "src-dup-b")?.disposition).toBe("duplicate");
    expect(byId(report, "src-tombstone")?.disposition).toBe("tombstoned");
    expect(byId(report, "src-legal-hold")?.disposition).toBe("conflict");
    expect(byId(report, "src-legal-hold")?.conflictCode).toBe("legal_hold_active");
    expect(byId(report, "src-legal-hold")?.retention?.policyId).toBe("ret-7y");
    expect(byId(report, "src-cross-tenant")?.disposition).toBe("conflict");
    expect(byId(report, "src-cross-tenant")?.conflictCode).toBe("cross_tenant");
    expect(byId(report, "src-byos")?.conflictCode).toBe("later_wave_adapter_locked");
    expect(byId(report, "catalog:ws-other-tenant")?.conflictCode).toBe("cross_tenant");
    expect(byId(report, "receipt:rcpt-globex")?.conflictCode).toBe("cross_tenant");
    expect(byId(report, "legal_hold:hold-acme-1:ws-acme-hold")?.legalHold?.holdId).toBe(
      "hold-acme-1",
    );
  });

  it("never proposes Catalog insert for unknown/duplicate/conflict/orphan/tombstoned", () => {
    const report = inventoryMigrationCandidates(fixtureInput());
    const quarantined = report.candidates.filter((c) =>
      ["unknown", "duplicate", "conflict", "orphan", "tombstoned"].includes(c.disposition),
    );
    expect(quarantined.length).toBeGreaterThan(0);
    for (const candidate of quarantined) {
      expect(mustNotEnterCatalog(candidate)).toBe(true);
      expect(candidate.proposedResourceId).toBeNull();
      expect(candidate.proposedCanonicalBinding).toBeNull();
    }
  });

  it("is repeatable and does not write the Catalog store", async () => {
    const first = inventoryMigrationCandidates(fixtureInput());
    const second = inventoryMigrationCandidates(fixtureInput());
    expect(first.inventoryChecksum).toBe(second.inventoryChecksum);
    expect(first.candidates).toEqual(second.candidates);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-m0-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "catalog.json");
    const store = createFileDataGovernanceCatalogStore({ storePath });
    const before = await store.list();
    inventoryMigrationCandidates(fixtureInput());
    const after = await store.list();
    expect(after).toEqual(before);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("ignores mtime when classifying (mtime is not inventory truth)", () => {
    expect(refuseMtimeAsInventoryTruth()).toBe("mtime_not_inventory_truth");
    const base = fixtureInput();
    const withMtime: MigrationInventoryInput = {
      ...base,
      sources: (base.sources ?? []).map((source) => ({ ...source, mtimeMs: 1 })),
    };
    const withoutMtime: MigrationInventoryInput = {
      ...base,
      sources: (base.sources ?? []).map((source) => ({ ...source, mtimeMs: 9_999_999_999 })),
    };
    expect(inventoryMigrationCandidates(withMtime).inventoryChecksum).toBe(
      inventoryMigrationCandidates(withoutMtime).inventoryChecksum,
    );
  });

  it("fails closed without a caller tenant and refuses shared-agent shortcuts", () => {
    const missing = inventoryMigrationCandidates({
      callerTenantId: "   ",
      catalogRecords: [],
    });
    expect(missing.candidates[0]?.conflictCode).toBe("missing_caller_tenant");
    expect(missing.candidates[0]?.proposedResourceId).toBeNull();

    const shared = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-shared-agent",
          tenantId: "tenant-acme",
          resourceType: "agent",
          sourceLocator: "/tenants/tenant-acme/agents/shared",
          checksum: "sha256:shared",
          schemaVersion: 1,
          ownershipProof: {
            owner: { kind: "system", systemId: "shared-agent" },
            scope: { kind: "system" },
          },
        },
      ],
    });
    expect(byId(shared, "src-shared-agent")?.conflictCode).toBe("shared_agent_forbidden");
    expect(byId(shared, "src-shared-agent")?.proposedResourceId).toBeNull();
  });

  it("reuses an existing stable resourceId for owned sources when provided", () => {
    const report = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-reuse",
          tenantId: "tenant-acme",
          resourceType: "agent",
          sourceLocator: "/tenants/tenant-acme/agents/reuse",
          checksum: "sha256:reuse",
          schemaVersion: 1,
          existingResourceId: "agent-stable-1",
          proposedCanonicalBinding: "bind-stable-1",
          ownershipProof: {
            owner: { kind: "user", userId: "user-ada" },
            scope: { kind: "tenant", tenantId: "tenant-acme" },
          },
        },
      ],
    });
    expect(byId(report, "src-reuse")?.disposition).toBe("owned");
    expect(byId(report, "src-reuse")?.proposedResourceId).toBe("agent-stable-1");
    expect(byId(report, "src-reuse")?.proposedCanonicalBinding).toBe("bind-stable-1");
  });
});
