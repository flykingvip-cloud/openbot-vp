import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { diagnoseDuplicateCanonicals } from "./diagnostics.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function storePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-catalog-"));
  tempDirs.push(dir);
  return path.join(dir, "catalog.json");
}

function record(resourceId: string, locator: string): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace" as const,
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner: { kind: "user" as const, userId: "u1" },
      scope: { kind: "user" as const, userId: "u1" },
      lifecycleState: "active" as const,
      classification: "internal" as const,
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical" as const,
        storageKind: "filesystem" as const,
        locator,
        state: "active" as const,
        contentVersion: "v1",
      },
    ],
  };
}

describe("createFileDataGovernanceCatalogStore", () => {
  it("puts and gets metadata-only records", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: storePath() });
    await store.put(record("res-1", "/data/tenants/t1/users/u1/OpenBot/workspace"));
    const got = await store.get("res-1");
    expect(got?.envelope.resourceId).toBe("res-1");
    expect(got?.bindings[0]?.role).toBe("canonical");
  });

  it("rejects unknown fields instead of persisting content bodies", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: storePath() });
    const bad = {
      ...record("res-2", "/tmp/ws"),
      transcript: "secret chat",
    };
    await expect(store.put(bad as never)).rejects.toThrow(/unknown_record_field/);

    const withPayload = {
      ...record("res-2b", "/tmp/ws2"),
      bindings: [
        {
          ...record("res-2b", "/tmp/ws2").bindings[0],
          payload: { secret: true },
        },
      ],
    };
    await expect(store.put(withPayload as never)).rejects.toThrow(/unknown_binding_field/);
  });

  it("fail-closes put without canonical binding", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: storePath() });
    const bad = record("res-3", "/tmp/ws");
    bad.bindings[0].role = "replica";
    await expect(store.put(bad)).rejects.toThrow(/canonical_binding_missing/);
  });

  it("rejects multiple active canonicals and duplicate binding ids", async () => {
    const store = createFileDataGovernanceCatalogStore({ storePath: storePath() });
    const multi = record("res-4", "/tmp/a");
    multi.bindings.push({
      bindingId: "bind-extra",
      resourceId: "res-4",
      role: "canonical",
      storageKind: "filesystem",
      locator: "/tmp/b",
      state: "active",
      contentVersion: "v1",
    });
    await expect(store.put(multi)).rejects.toThrow(/multiple_active_canonicals/);

    const dup = record("res-5", "/tmp/c");
    dup.bindings.push({
      bindingId: `bind-res-5`,
      resourceId: "res-5",
      role: "derived",
      storageKind: "filesystem",
      locator: "/tmp/d",
      state: "active",
      contentVersion: "v1",
    });
    await expect(store.put(dup)).rejects.toThrow(/duplicate_binding_id/);
  });

  it("serializes concurrent puts without losing records", async () => {
    const pathToStore = storePath();
    const store = createFileDataGovernanceCatalogStore({ storePath: pathToStore });
    await Promise.all([
      store.put(record("a", "/data/a")),
      store.put(record("b", "/data/b")),
      store.put(record("c", "/data/c")),
    ]);
    const listed = await store.list();
    expect(listed.map((r) => r.envelope.resourceId).toSorted()).toEqual(["a", "b", "c"]);
    const raw = JSON.parse(fs.readFileSync(pathToStore, "utf8")) as { revision: number };
    expect(raw.revision).toBe(3);
  });

  it("preserves concurrent puts across separate store instances on same path", async () => {
    const pathToStore = storePath();
    const storeA = createFileDataGovernanceCatalogStore({ storePath: pathToStore });
    const storeB = createFileDataGovernanceCatalogStore({ storePath: pathToStore });
    await Promise.all([
      storeA.put(record("x", "/data/x")),
      storeB.put(record("y", "/data/y")),
      storeA.put(record("z", "/data/z")),
    ]);
    const listed = await storeB.list();
    expect(listed.map((r) => r.envelope.resourceId).toSorted()).toEqual(["x", "y", "z"]);
  });

  it("compareAndPut: concurrent same expectedGovernanceVersion → 1 success + 1 version_conflict", async () => {
    const pathToStore = storePath();
    const store = createFileDataGovernanceCatalogStore({ storePath: pathToStore });
    await store.put(record("r1", "/data/r1"));
    const base = (await store.get("r1"))!;
    expect(base.envelope.governanceVersion).toBe(1);

    const nextA: CatalogRecord = {
      ...base,
      envelope: {
        ...base.envelope,
        governanceVersion: 2,
        updatedAt: "2026-08-12T01:00:00Z",
        lifecycleState: "archived",
      },
    };
    const nextB: CatalogRecord = {
      ...base,
      envelope: {
        ...base.envelope,
        governanceVersion: 2,
        updatedAt: "2026-08-12T01:00:01Z",
        lifecycleState: "retired",
      },
    };

    const [a, b] = await Promise.all([
      store.compareAndPut({
        resourceId: "r1",
        expectedGovernanceVersion: 1,
        next: nextA,
      }),
      store.compareAndPut({
        resourceId: "r1",
        expectedGovernanceVersion: 1,
        next: nextB,
      }),
    ]);
    const ok = [a, b].filter((r) => r.ok);
    const conflict = [a, b].filter((r) => !r.ok && r.conflict === "version_conflict");
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(1);
    const final = (await store.get("r1"))!;
    expect(final.envelope.governanceVersion).toBe(2);
  });
});

describe("diagnoseDuplicateCanonicals", () => {
  it("flags two active canonicals on the same locator", () => {
    const a = record("a", "/shared/path");
    const b = record("b", "/shared/path");
    const dupes = diagnoseDuplicateCanonicals([a, b]);
    expect(dupes.some((d) => d.includes("duplicate_canonical:/shared/path"))).toBe(true);
  });
});
