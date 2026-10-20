import { describe, expect, it } from "vitest";
import {
  countBindingsByRole,
  diagnoseBindingRoles,
  diagnoseDuplicateCanonicals,
  diagnoseOrphanLocators,
  diagnoseWrongOwnerScope,
} from "./diagnostics.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";
import type { CatalogRecord } from "./types.js";

function baseRecord(overrides?: Partial<CatalogRecord>): CatalogRecord {
  return {
    envelope: {
      resourceId: "res-1",
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: "bind-c",
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: "bind-c",
        resourceId: "res-1",
        role: "canonical",
        storageKind: "filesystem",
        locator: "/data/ws",
        state: "active",
        contentVersion: "v1",
      },
      {
        bindingId: "bind-d",
        resourceId: "res-1",
        role: "derived",
        storageKind: "filesystem",
        locator: "/data/ws-derived",
        state: "active",
        contentVersion: "v1",
      },
    ],
    ...overrides,
  };
}

function secondWaveRecord(params: {
  resourceId: string;
  resourceType: "knowledge" | "memory" | "operational_identity";
  locator: string;
  tenantId?: string | null;
  ownerUserId?: string;
  projection?: Record<string, string | null>;
  objectKey?: string | null;
}): CatalogRecord {
  const tenantId = params.tenantId === undefined ? "t1" : params.tenantId;
  const userId = params.ownerUserId ?? "u1";
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId,
      owner: { kind: "user", userId },
      scope: tenantId ? { kind: "tenant", tenantId } : { kind: "user", userId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind:${params.resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: params.projection,
    },
    bindings: [
      {
        bindingId: `bind:${params.resourceId}`,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params.locator,
        state: "active",
        contentVersion: "v1",
        ...(params.objectKey !== undefined ? { objectKey: params.objectKey } : {}),
      },
    ],
  };
}

describe("diagnoseBindingRoles", () => {
  it("accepts one canonical plus derived roles", () => {
    expect(diagnoseBindingRoles(baseRecord())).toEqual([]);
    expect(countBindingsByRole(baseRecord().bindings).derived).toBe(1);
  });

  it("flags missing active canonical", () => {
    const record = baseRecord({
      bindings: [
        {
          bindingId: "bind-c",
          resourceId: "res-1",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/ws",
          state: "retired",
          contentVersion: "v1",
        },
      ],
    });
    expect(diagnoseBindingRoles(record).some((i) => i.code === "missing_active_canonical")).toBe(
      true,
    );
  });
});

describe("diagnoseOrphanLocators", () => {
  it("reports locators with no catalog binding", () => {
    const orphans = diagnoseOrphanLocators({
      observedLocators: ["/data/ws", "/data/orphan"],
      records: [baseRecord()],
    });
    expect(orphans).toEqual([{ locator: "/data/orphan", reason: "no_catalog_binding" }]);
  });

  it("reports retired-only bindings as orphans", () => {
    const record = baseRecord({
      bindings: [
        {
          bindingId: "bind-c",
          resourceId: "res-1",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/old",
          state: "retired",
          contentVersion: "v0",
        },
      ],
    });
    const orphans = diagnoseOrphanLocators({
      observedLocators: ["/data/old"],
      records: [record],
    });
    expect(orphans[0]?.reason).toBe("binding_retired_only");
  });

  it("tags Knowledge/Memory/OI orphan locators with resourceTypeHint", () => {
    const knowledge = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d1:v1",
      resourceType: "knowledge",
      locator: "/data/k-canonical",
    });
    const orphans = diagnoseOrphanLocators({
      observedLocators: ["/data/k-canonical", "/data/k-orphan", "/data/m-orphan"],
      records: [knowledge],
      resourceTypeHints: {
        "/data/k-orphan": "knowledge",
        "/data/m-orphan": "memory",
      },
    });
    expect(orphans).toEqual([
      { locator: "/data/k-orphan", reason: "no_catalog_binding", resourceTypeHint: "knowledge" },
      { locator: "/data/m-orphan", reason: "no_catalog_binding", resourceTypeHint: "memory" },
    ]);
  });
});

describe("diagnoseDuplicateCanonicals (second wave)", () => {
  it("flags two Knowledge assets sharing one active canonical locator without objectKey", () => {
    const a = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d1:v1",
      resourceType: "knowledge",
      locator: "/data/shared-k",
    });
    const b = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d2:v1",
      resourceType: "knowledge",
      locator: "/data/shared-k",
    });
    const dupes = diagnoseDuplicateCanonicals([a, b]);
    expect(
      dupes.some((d) => d.includes("/data/shared-k") && d.includes("d1") && d.includes("d2")),
    ).toBe(true);
  });

  it("allows shared locator when objectKeys differ (KB / CogniWeave / OI aggregates)", () => {
    const a = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d1:v1",
      resourceType: "knowledge",
      locator: "/data/shared-k.sqlite",
      objectKey: "knowledge:t1:doc:d1:v1",
    });
    const b = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d1:v2",
      resourceType: "knowledge",
      locator: "/data/shared-k.sqlite",
      objectKey: "knowledge:t1:doc:d1:v2",
    });
    expect(diagnoseDuplicateCanonicals([a, b])).toEqual([]);
  });
});

describe("diagnoseWrongOwnerScope", () => {
  it("flags envelope self-inconsistency", () => {
    const bad = secondWaveRecord({
      resourceId: "memory:t1:atom:a1",
      resourceType: "memory",
      locator: "/data/m",
      tenantId: "t1",
    });
    bad.envelope.scope = { kind: "tenant", tenantId: "t-other" };
    const issues = diagnoseWrongOwnerScope({ records: [bad], proofs: [] });
    expect(issues.some((i) => i.code === "envelope_scope_inconsistent")).toBe(true);
  });

  it("compares Catalog vs authoritative seat/membership proof", () => {
    const record = secondWaveRecord({
      resourceId: "knowledge:t1:doc:d1:v1",
      resourceType: "knowledge",
      locator: "/data/k",
      ownerUserId: "u1",
    });
    const issues = diagnoseWrongOwnerScope({
      records: [record],
      proofs: [
        {
          resourceId: record.envelope.resourceId,
          tenantId: "t1",
          owner: { kind: "user", userId: "u-other" },
          scope: { kind: "tenant", tenantId: "t1" },
        },
      ],
    });
    expect(issues.some((i) => i.code === "owner_mismatch")).toBe(true);
  });

  it("flags OI AgentAsset continuity mismatch and missing required proof", () => {
    const oi = secondWaveRecord({
      resourceId: "operational_identity:t1:id-1",
      resourceType: "operational_identity",
      locator: "/data/oi",
      projection: { identityId: "id-1", agentAssetId: "asset-a" },
    });
    const mismatch = diagnoseWrongOwnerScope({
      records: [oi],
      proofs: [
        {
          resourceId: oi.envelope.resourceId,
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "tenant", tenantId: "t1" },
          agentAssetId: "asset-b",
        },
      ],
    });
    expect(mismatch.some((i) => i.code === "agent_asset_mismatch")).toBe(true);

    const missing = diagnoseWrongOwnerScope({
      records: [oi],
      proofs: [],
      requireProofForTypes: ["operational_identity"],
    });
    expect(missing.some((i) => i.code === "missing_proof")).toBe(true);
  });
});
