import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCatalogPersistPreservesV2,
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { supersedeCognitiveProvenanceRef, updateCognitiveGovernance } from "./cognitive-update.js";
import { validateGovernanceEnvelope } from "./envelope.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpCatalogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3a-r0-"));
  tempDirs.push(dir);
  return path.join(dir, "catalog.json");
}

function v1Workspace(resourceId = "ws-1"): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

function v2Memory(resourceId = "mem-1"): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 2,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 3,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-13T00:00:00Z",
      projection: {
        canonicalKind: "cogniweave",
        atomId: "a1",
        memoryTier: "working",
      },
      cognitiveTier: "C2",
      lastCognitiveMutationId: "mut-a",
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

function seedCatalog(
  storePath: string,
  records: Record<string, CatalogRecord>,
  revision = 1,
): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify({ schemaVersion: 1, revision, records }, null, 2)}\n`,
    "utf8",
  );
}

describe("P3-a R0 envelope v2 dual-read", () => {
  it("accepts v2 cognitive rows without failing sibling v1 rows", async () => {
    const storePath = tmpCatalogPath();
    seedCatalog(storePath, {
      "ws-1": v1Workspace(),
      "mem-1": v2Memory(),
      "bad-1": { envelope: { schemaVersion: 9 } as never, bindings: [] },
    });
    const store = createFileDataGovernanceCatalogStore({ storePath });
    const listed = await store.list();
    const ids = listed.map((r) => r.envelope.resourceId).toSorted();
    expect(ids).toEqual(["mem-1", "ws-1"]);
    const v2 = await store.get("mem-1");
    expect(v2?.envelope.schemaVersion).toBe(2);
    expect(v2?.envelope.cognitiveTier).toBe("C2");
    const v1 = await store.get("ws-1");
    expect(v1?.envelope.schemaVersion).toBe(1);
    expect(v1?.envelope.cognitiveTier).toBeUndefined();
  });

  it("rejects cognitive keys on v1 envelopes as unknown_field", () => {
    const result = validateGovernanceEnvelope({
      ...v1Workspace().envelope,
      cognitiveTier: "C1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.code === "unknown_field" && e.field === "cognitiveTier"),
      ).toBe(true);
    }
  });

  it("v1-only reader returns schema_unsupported for v2 rows", () => {
    const result = validateGovernanceEnvelope(v2Memory().envelope, { reader: "v1-only" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "schema_unsupported")).toBe(true);
    }
  });

  it("denies envelope schemaVersion 2→1", async () => {
    const storePath = tmpCatalogPath();
    seedCatalog(storePath, { "mem-1": v2Memory() });
    const store = createFileDataGovernanceCatalogStore({ storePath });
    const current = (await store.get("mem-1"))!;
    const downgraded: CatalogRecord = {
      ...current,
      envelope: {
        ...current.envelope,
        schemaVersion: 1,
        governanceVersion: current.envelope.governanceVersion + 1,
        updatedAt: "2026-08-13T01:00:00Z",
      },
    };
    delete (downgraded.envelope as { cognitiveTier?: string }).cognitiveTier;
    delete (downgraded.envelope as { lastCognitiveMutationId?: string }).lastCognitiveMutationId;
    await expect(
      store.compareAndPut({
        resourceId: "mem-1",
        expectedGovernanceVersion: current.envelope.governanceVersion,
        next: downgraded,
      }),
    ).rejects.toThrow(/schema_downgrade_denied/);
  });

  it("blocks v1-only persist that cannot round-trip v2 rows", () => {
    expect(() =>
      assertCatalogPersistPreservesV2({
        previousRecords: { "mem-1": v2Memory(), "ws-1": v1Workspace() },
        nextRecords: {
          "mem-1": v1Workspace("mem-1"),
          "ws-1": v1Workspace(),
        },
      }),
    ).toThrow(/catalog_schema_downgrade_blocked/);
  });

  it("preserves a v2 sibling when putting a new v1 row", async () => {
    const storePath = tmpCatalogPath();
    seedCatalog(storePath, { "mem-1": v2Memory() });
    const store = createFileDataGovernanceCatalogStore({ storePath });
    await store.put(v1Workspace("ws-2"));
    const v2 = await store.get("mem-1");
    expect(v2?.envelope.schemaVersion).toBe(2);
    expect(v2?.envelope.cognitiveTier).toBe("C2");
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
      records: Record<string, { envelope: { schemaVersion: number; cognitiveTier?: string } }>;
    };
    expect(raw.records["mem-1"]?.envelope.schemaVersion).toBe(2);
    expect(raw.records["mem-1"]?.envelope.cognitiveTier).toBe("C2");
  });

  it("rejects provenance arrays and projection cognitive keys", () => {
    expect(
      validateGovernanceEnvelope({
        ...v2Memory().envelope,
        sourceEventIds: ["evt-1"],
      }).ok,
    ).toBe(false);
    expect(
      validateGovernanceEnvelope({
        ...v1Workspace("memory:t1:atom:a1").envelope,
        resourceType: "memory",
        resourceId: "memory:t1:atom:a1",
        projection: {
          canonicalKind: "cogniweave",
          atomId: "a1",
          cognitiveTier: "C1",
        },
      }).ok,
    ).toBe(false);
  });
});

describe("P3-a R0 cognitive writes stay schema_write_locked", () => {
  it("updateCognitiveGovernance and supersedeCognitiveProvenanceRef return schema_write_locked", async () => {
    const actor = { kind: "operator" as const, operatorId: "op-1" };
    await expect(
      updateCognitiveGovernance({
        resourceId: "mem-1",
        expectedGovernanceVersion: 3,
        actor,
        patch: { cognitiveTier: "C3" },
        mutationId: "mut-r0-locked",
      }),
    ).resolves.toEqual({ ok: false, error: "schema_write_locked" });
    await expect(
      supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 3,
        actor,
        next: { version: 2 },
      }),
    ).resolves.toEqual({ ok: false, error: "schema_write_locked" });
  });

  it("catalog put of a new v2 cognitive row is schema_write_locked", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: tmpCatalogPath() });
    await expect(store.put(v2Memory())).rejects.toThrow(/schema_write_locked/);
  });

  it("ordinary compareAndPut cannot introduce cognitive fields or marker", async () => {
    const storePath = tmpCatalogPath();
    const v1 = {
      envelope: {
        resourceId: "mem-1",
        resourceType: "memory" as const,
        schemaVersion: 1 as const,
        tenantId: "t1",
        owner: { kind: "user" as const, userId: "u1" },
        scope: { kind: "user" as const, userId: "u1" },
        lifecycleState: "active" as const,
        classification: "confidential" as const,
        governanceVersion: 1,
        canonicalBindingId: "bind-mem-1",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
        projection: { canonicalKind: "cogniweave" as const, atomId: "a1", memoryTier: "working" },
      },
      bindings: [
        {
          bindingId: "bind-mem-1",
          resourceId: "mem-1",
          role: "canonical" as const,
          storageKind: "filesystem" as const,
          locator: "/data/mem-1",
          state: "active" as const,
          contentVersion: "v1",
        },
      ],
    };
    seedCatalog(storePath, { "mem-1": v1 });
    const store = createFileDataGovernanceCatalogStore({ storePath });
    const current = (await store.get("mem-1"))!;
    await expect(
      store.compareAndPut({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        next: {
          ...current,
          envelope: {
            ...current.envelope,
            schemaVersion: 2,
            governanceVersion: 2,
            updatedAt: "2026-08-13T05:00:00Z",
            cognitiveTier: "C2",
            lastCognitiveMutationId: "mut-bypass",
          },
        },
      }),
    ).rejects.toThrow(/schema_write_locked/);
    const after = await store.get("mem-1");
    expect(after?.envelope.schemaVersion).toBe(1);
    expect(after?.envelope.lastCognitiveMutationId).toBeUndefined();
  });
});
