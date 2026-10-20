import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import {
  planMigrationIdentities,
  planMustNotAssignId,
  verifyMigrationPlan,
  type SignedMigrationPlan,
} from "./migration-identity-plan.js";
import {
  computeInventoryChecksum,
  inventoryMigrationCandidates,
  type MigrationCandidate,
  type MigrationInventoryInput,
  type MigrationInventoryReport,
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

const SIGNING_KEY = "m1-dry-run-hmac-key";

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

function byId(plan: SignedMigrationPlan, id: string) {
  return plan.entries.find((e) => e.candidateId === id);
}

describe("planMigrationIdentities M1", () => {
  it("assigns a new id only after proof, and reuses stable Catalog identities", () => {
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.writes).toBe(0);
    expect(result.plan.kind).toBe("m1_identity_dry_run");
    expect(result.plan.inventoryChecksum).toBe(inventory.inventoryChecksum);
    expect(byId(result.plan, "src-owned-ws")?.action).toBe("assign_identity");
    expect(byId(result.plan, "src-owned-ws")?.resourceId).toMatch(/^mig:workspace:/);
    expect(byId(result.plan, "src-owned-ws")?.ownerScope).toBe("user_owned");
    expect(byId(result.plan, "src-already-ws")?.action).toBe("reuse_identity");
    expect(byId(result.plan, "src-already-ws")?.resourceId).toBe("ws-acme-root");
    expect(byId(result.plan, "catalog:ws-acme-root")?.action).toBe("reuse_identity");
    expect(byId(result.plan, "catalog:ws-acme-root")?.resourceId).toBe("ws-acme-root");
    expect(byId(result.plan, "catalog:oi-acme-ada")?.ownerScope).toBe("system");
    expect(verifyMigrationPlan({ plan: result.plan, signingKey: SIGNING_KEY })).toEqual({
      ok: true,
    });
  });

  it("never emits resourceId for quarantine, missing proof, cross-tenant, or auxiliary rows", () => {
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(byId(result.plan, "src-unknown")?.action).toBe("quarantine");
    expect(byId(result.plan, "src-orphan")?.reasonCode).toBe("missing_candidate_tenant");
    expect(byId(result.plan, "src-orphan")?.resourceId).toBeNull();
    expect(byId(result.plan, "src-dup-a")?.action).toBe("quarantine");
    expect(byId(result.plan, "src-tombstone")?.action).toBe("quarantine");
    expect(byId(result.plan, "src-legal-hold")?.action).toBe("quarantine");
    expect(byId(result.plan, "src-cross-tenant")?.reasonCode).toBe("cross_tenant");
    expect(byId(result.plan, "src-byos")?.reasonCode).toBe("later_wave_adapter_locked");
    expect(byId(result.plan, "binding:bind-ws-acme")?.reasonCode).toBe("not_identity_subject");
    expect(byId(result.plan, "receipt:rcpt-acme-archive")?.reasonCode).toBe("not_identity_subject");
    expect(byId(result.plan, "catalog:ws-acme-retired")?.action).toBe("quarantine");
    for (const entry of result.plan.entries) {
      if (entry.action === "quarantine" || entry.action === "block") {
        expect(planMustNotAssignId(entry)).toBe(true);
      }
    }
  });

  it("blocks owned candidates when the live proof is omitted or mismatches", () => {
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const missing = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: {},
      signingKey: SIGNING_KEY,
    });
    expect(missing.ok).toBe(true);
    if (!missing.ok) {
      return;
    }
    expect(byId(missing.plan, "src-owned-ws")?.reasonCode).toBe("proof_required");
    expect(byId(missing.plan, "src-owned-ws")?.resourceId).toBeNull();
    expect(byId(missing.plan, "catalog:ws-acme-root")?.resourceId).toBeNull();

    const mismatch = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: {
        "src-owned-ws": {
          owner: { kind: "user", userId: "user-eve" },
          scope: { kind: "tenant", tenantId: "tenant-acme" },
        },
      },
      signingKey: SIGNING_KEY,
    });
    expect(mismatch.ok).toBe(true);
    if (!mismatch.ok) {
      return;
    }
    expect(byId(mismatch.plan, "src-owned-ws")?.reasonCode).toBe("proof_owner_mismatch");
    expect(byId(mismatch.plan, "src-owned-ws")?.resourceId).toBeNull();
  });

  it("allows position/group scopes and refuses shared-agent shortcuts", () => {
    const inventory = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-seat",
          tenantId: "tenant-acme",
          resourceType: "agent",
          sourceLocator: "/tenants/tenant-acme/agents/seat",
          checksum: "sha256:seat",
          schemaVersion: 1,
          existingResourceId: "agent-seat-1",
          ownershipProof: {
            owner: { kind: "position", seatId: "seat-1" },
            scope: { kind: "tenant", tenantId: "tenant-acme" },
          },
        },
        {
          candidateId: "src-group",
          tenantId: "tenant-acme",
          resourceType: "workspace",
          sourceLocator: "/tenants/tenant-acme/workspaces/eng",
          checksum: "sha256:group",
          schemaVersion: 1,
          existingResourceId: "ws-group-1",
          ownershipProof: {
            owner: { kind: "group", groupId: "eng" },
            scope: { kind: "tenant", tenantId: "tenant-acme" },
          },
        },
        {
          candidateId: "src-shared",
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
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: {
        "src-seat": {
          owner: { kind: "position", seatId: "seat-1" },
          scope: { kind: "tenant", tenantId: "tenant-acme" },
        },
        "src-group": {
          owner: { kind: "group", groupId: "eng" },
          scope: { kind: "tenant", tenantId: "tenant-acme" },
        },
        "src-shared": {
          owner: { kind: "system", systemId: "shared-agent" },
          scope: { kind: "system" },
        },
      },
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(byId(result.plan, "src-seat")?.action).toBe("assign_identity");
    expect(byId(result.plan, "src-seat")?.ownerScope).toBe("position_owned");
    expect(byId(result.plan, "src-seat")?.resourceId).toBe("agent-seat-1");
    expect(byId(result.plan, "src-group")?.ownerScope).toBe("group_owned");
    expect(byId(result.plan, "src-shared")?.reasonCode).toBe("shared_agent_forbidden");
    expect(byId(result.plan, "src-shared")?.resourceId).toBeNull();
  });

  it("rejects same groupId bound to a different tenant", () => {
    const inventory = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-group-foreign",
          tenantId: "tenant-acme",
          resourceType: "workspace",
          sourceLocator: "/tenants/tenant-acme/workspaces/eng-foreign",
          checksum: "sha256:group-foreign",
          schemaVersion: 1,
          existingResourceId: "ws-group-foreign",
          ownershipProof: {
            owner: { kind: "group", groupId: "eng" },
            scope: { kind: "tenant", tenantId: "tenant-acme" },
          },
        },
      ],
    });
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: {
        "src-group-foreign": {
          owner: { kind: "group", groupId: "eng" },
          scope: { kind: "tenant", tenantId: "tenant-globex" },
        },
      },
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(byId(result.plan, "src-group-foreign")?.reasonCode).toBe("proof_tenant_mismatch");
    expect(byId(result.plan, "src-group-foreign")?.resourceId).toBeNull();
    expect(byId(result.plan, "src-group-foreign")?.action).toBe("block");
  });

  it("rejects a group proof that omits tenant (group scope only)", () => {
    const inventory = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-group-no-tenant",
          tenantId: "tenant-acme",
          resourceType: "workspace",
          sourceLocator: "/tenants/tenant-acme/workspaces/eng-bare",
          checksum: "sha256:group-bare",
          schemaVersion: 1,
          existingResourceId: "ws-group-bare",
          ownershipProof: {
            owner: { kind: "group", groupId: "eng" },
            scope: { kind: "tenant", tenantId: "tenant-acme" },
          },
        },
      ],
    });
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: {
        "src-group-no-tenant": {
          owner: { kind: "group", groupId: "eng" },
          scope: { kind: "group", groupId: "eng" },
        },
      },
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(byId(result.plan, "src-group-no-tenant")?.reasonCode).toBe("proof_tenant_mismatch");
    expect(byId(result.plan, "src-group-no-tenant")?.resourceId).toBeNull();
  });

  it("does not assign a resourceId when candidate.tenantId is null even with a valid proof", () => {
    const candidate: MigrationCandidate = {
      candidateId: "src-null-tenant",
      tenantId: null,
      resourceType: "workspace",
      sourceLocator: "/unbound/null-tenant-ws",
      ownershipEvidence: {
        proofPresent: true,
        owner: { kind: "user", userId: "user-ada" },
        ownerScope: "user_owned",
        source: "auth_proof",
      },
      classificationEvidence: { classification: "internal", source: "hint" },
      checksum: "sha256:null-tenant",
      schemaVersion: 1,
      proposedResourceId: "ws-must-not-assign",
      proposedCanonicalBinding: "bind-must-not-assign",
      conflictCode: null,
      retention: null,
      legalHold: null,
      disposition: "owned",
    };
    const inventory: MigrationInventoryReport = {
      schemaVersion: 1,
      callerTenantId: "tenant-acme",
      generatedKind: "read_only_dry_run",
      writes: 0,
      inventoryChecksum: computeInventoryChecksum({
        callerTenantId: "tenant-acme",
        candidates: [candidate],
      }),
      candidates: [candidate],
      counts: {
        owned: 1,
        unknown: 0,
        duplicate: 0,
        conflict: 0,
        orphan: 0,
        tombstoned: 0,
        already_governed: 0,
      },
    };
    const result = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: { "src-null-tenant": adaProof },
      signingKey: SIGNING_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(byId(result.plan, "src-null-tenant")?.reasonCode).toBe("missing_candidate_tenant");
    expect(byId(result.plan, "src-null-tenant")?.resourceId).toBeNull();
    expect(byId(result.plan, "src-null-tenant")?.action).toBe("block");
  });

  it("is repeatable, signed, and does not write Catalog", async () => {
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const first = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    const second = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.plan.planChecksum).toBe(second.plan.planChecksum);
    expect(first.plan.signature).toBe(second.plan.signature);
    expect(
      verifyMigrationPlan({
        plan: { ...first.plan, signature: "forged" },
        signingKey: SIGNING_KEY,
      }),
    ).toEqual({ ok: false, reasonCode: "signature_invalid" });
    expect(
      planMigrationIdentities({
        inventory: { ...inventory, inventoryChecksum: "deadbeef" },
        callerTenantId: "tenant-acme",
        proofs: fixtureProofs(),
        signingKey: SIGNING_KEY,
      }),
    ).toEqual({ ok: false, reasonCode: "inventory_checksum_mismatch" });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-m1-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "catalog.json");
    const store = createFileDataGovernanceCatalogStore({ storePath });
    const before = await store.list();
    planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(await store.list()).toEqual(before);
    expect(fs.existsSync(storePath)).toBe(false);
  });
});
