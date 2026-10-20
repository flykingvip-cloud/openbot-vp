import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mustNotEnterCatalog,
  refuseMtimeAsInventoryTruth,
  refuseOwnerFromDirectoryName,
  scanLocalRootToObjects,
  scanProductionObjects,
  type InventoryObjectSource,
  type ObservedProductionObject,
} from "./production-object-inventory.js";
import type { CatalogRecord } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const CALLER = "tenant-acme";

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s01-poi-"));
  tempDirs.push(dir);
  return dir;
}

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function callerProof(userId = "user-ada"): GovernanceOwnershipProof {
  return {
    owner: { kind: "user", userId },
    scope: { kind: "tenant", tenantId: CALLER },
  };
}

function foreignProof(tenantId: string, userId = "user-bob"): GovernanceOwnershipProof {
  return {
    owner: { kind: "user", userId },
    scope: { kind: "tenant", tenantId },
  };
}

function writeFile(root: string, rel: string, body: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

function writeSidecar(filePath: string, proof: GovernanceOwnershipProof): void {
  fs.writeFileSync(`${filePath}.ownership.json`, JSON.stringify(proof));
}

function memorySource(
  kind: InventoryObjectSource["kind"],
  id: string,
  objects: ObservedProductionObject[],
  onList?: () => void,
): InventoryObjectSource {
  return {
    kind,
    id,
    async list() {
      onList?.();
      return objects;
    },
  };
}

function catalogForLocator(params: {
  locator: string;
  contentVersion: string;
  resourceId?: string;
  tenantId?: string;
}): CatalogRecord {
  const resourceId = params.resourceId ?? "ws-acme-root";
  const tenantId = params.tenantId ?? CALLER;
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: 1,
      tenantId,
      owner: { kind: "user", userId: "user-ada" },
      scope: { kind: "tenant", tenantId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: "bind-acme-root",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: "bind-acme-root",
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params.locator,
        state: "active",
        contentVersion: params.contentVersion,
      },
    ],
  };
}

function objectCandidate(
  report: Awaited<ReturnType<typeof scanProductionObjects>>,
  locator: string,
) {
  return report.candidates.find(
    (c) => c.candidateId.startsWith("obj:") && c.sourceLocator === locator,
  );
}

describe("scanProductionObjects", () => {
  it("classifies a file with valid sidecar proof as owned and reports real fileCount/byteCount/hash", async () => {
    const root = tmpRoot();
    const body = "owned-workspace-bytes";
    const filePath = writeFile(root, "workspace/notes.md", body);
    writeSidecar(filePath, callerProof());

    const objects = await scanLocalRootToObjects(root);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.sidecarProof?.owner).toEqual({ kind: "user", userId: "user-ada" });
    expect(objects[0]?.locator).toBe(filePath);

    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", objects)],
      productionScanExecuted: false,
    });
    const candidate = objectCandidate(report, filePath);
    expect(candidate?.disposition).toBe("owned");
    expect(candidate?.conflictCode).toBeNull();
    expect(candidate?.ownershipEvidence.owner).toEqual({ kind: "user", userId: "user-ada" });
    expect(report.fileCount).toBe(1);
    expect(report.byteCount).toBe(Buffer.byteLength(body));
    expect(report.objects[0]?.contentHash).toBe(sha256Utf8(body));
    expect(candidate?.checksum).toBe(sha256Utf8(body));
    expect(report.productionScanExecuted).toBe(false);
  });

  it("classifies sidecar+catalog locator match as already_governed", async () => {
    const root = tmpRoot();
    const body = "already-governed-bytes";
    const filePath = writeFile(root, "workspace/governed.md", body);
    writeSidecar(filePath, callerProof());
    const objects = await scanLocalRootToObjects(root);
    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [catalogForLocator({ locator: filePath, contentVersion: sha256Utf8(body) })],
      sources: [memorySource("local_root", "fixture-root", objects)],
    });
    const candidate = objectCandidate(report, filePath);
    expect(candidate?.disposition).toBe("already_governed");
    expect(candidate?.proposedResourceId).toBe("ws-acme-root");
    expect(report.fileCount).toBe(1);
    expect(report.byteCount).toBe(Buffer.byteLength(body));
    expect(report.objects[0]?.contentHash).toBe(sha256Utf8(body));
  });

  it("quarantines unknown_owner for a path under a user-like directory with no sidecar", async () => {
    const root = tmpRoot();
    const body = "unguessable";
    const filePath = writeFile(root, "users/alice/notes.md", body);
    const objects = await scanLocalRootToObjects(root);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.sidecarProof).toBeNull();
    expect(objects[0]?.locator).toContain(`${path.sep}users${path.sep}alice${path.sep}`);

    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", objects)],
    });
    const candidate = objectCandidate(report, filePath);
    expect(candidate?.conflictCode).toBe("unknown_owner");
    expect(["unknown", "orphan"]).toContain(candidate?.disposition);
    expect(candidate?.ownershipEvidence.owner).toBeNull();
    expect(candidate?.ownershipEvidence.source).toBe("missing");
    expect(candidate?.proposedResourceId).toBeNull();
    expect(candidate?.proposedCanonicalBinding).toBeNull();
    expect(mustNotEnterCatalog(candidate!)).toBe(true);
    expect(refuseOwnerFromDirectoryName()).toBe("owner_not_guessed_from_dirname");
    expect(report.fileCount).toBe(1);
    expect(report.byteCount).toBe(Buffer.byteLength(body));
    expect(report.objects[0]?.contentHash).toBe(sha256Utf8(body));
  });

  it("flags two objects sharing a canonical locator under different tenants as cross_tenant", async () => {
    const body = "shared-canonical";
    const bytes = new TextEncoder().encode(body);
    const locator = "canonical://shared-workspace";
    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [
        memorySource("controlled_store", "store-a", [
          {
            locator,
            kind: "controlled_store",
            bytes,
            byteCount: bytes.byteLength,
            sidecarProof: callerProof("user-ada"),
          },
        ]),
        memorySource("controlled_store", "store-b", [
          {
            locator,
            kind: "controlled_store",
            bytes,
            byteCount: bytes.byteLength,
            sidecarProof: foreignProof("tenant-globex", "user-bob"),
          },
        ]),
      ],
    });
    const hits = report.candidates.filter(
      (c) => c.candidateId.startsWith("obj:") && c.sourceLocator === locator,
    );
    expect(hits.length).toBe(2);
    for (const hit of hits) {
      expect(hit.disposition).toBe("conflict");
      expect(hit.conflictCode).toBe("cross_tenant");
      expect(hit.proposedResourceId).toBeNull();
      expect(hit.proposedCanonicalBinding).toBeNull();
      expect(mustNotEnterCatalog(hit)).toBe(true);
    }
    expect(report.fileCount).toBe(2);
  });

  it("flags same contentHash at different locators for the same tenant as duplicate_checksum", async () => {
    const body = "duplicate-bytes";
    const bytes = new TextEncoder().encode(body);
    const proof = callerProof();
    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [
        memorySource("local_root", "dup-root", [
          {
            locator: "/tenants/T/workspace/a.md",
            kind: "local_root",
            bytes,
            byteCount: bytes.byteLength,
            sidecarProof: proof,
          },
          {
            locator: "/tenants/T/workspace/b.md",
            kind: "local_root",
            bytes,
            byteCount: bytes.byteLength,
            sidecarProof: proof,
          },
        ]),
      ],
    });
    const hits = report.candidates.filter((c) => c.candidateId.startsWith("obj:"));
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.disposition).toBe("duplicate");
      expect(hit.conflictCode).toBe("duplicate_checksum");
      expect(hit.proposedResourceId).toBeNull();
      expect(mustNotEnterCatalog(hit)).toBe(true);
    }
    expect(report.fileCount).toBe(2);
    expect(report.objects.every((o) => o.contentHash === sha256Utf8(body))).toBe(true);
  });

  it("fail-closes BYOS when adapter is unavailable and invents zero objects", async () => {
    let listed = 0;
    const fake: ObservedProductionObject = {
      locator: "oss://bucket/invented",
      kind: "byos",
      bytes: new TextEncoder().encode("should-not-appear"),
      byteCount: 17,
      sidecarProof: callerProof(),
    };
    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [
        memorySource("byos", "aliyun-oss", [fake], () => {
          listed += 1;
        }),
      ],
      byosAdapterAvailable: false,
    });
    expect(listed).toBe(0);
    expect(report.fileCount).toBe(0);
    expect(report.byteCount).toBe(0);
    expect(report.objects).toEqual([]);
    expect(report.writes).toBe(0);
    const locked = report.candidates.find(
      (c) => c.candidateId === "byos-adapter-locked:aliyun-oss",
    );
    expect(locked?.disposition).toBe("conflict");
    expect(locked?.conflictCode).toBe("later_wave_adapter_locked");
    expect(locked?.proposedResourceId).toBeNull();
    expect(mustNotEnterCatalog(locked!)).toBe(true);
  });

  it("keeps writes/moved/deleted/catalogMutation at zero even for owned objects", async () => {
    const root = tmpRoot();
    const filePath = writeFile(root, "workspace/owned.md", "keep-zero");
    writeSidecar(filePath, callerProof());
    const objects = await scanLocalRootToObjects(root);
    const report = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", objects)],
    });
    expect(objectCandidate(report, filePath)?.disposition).toBe("owned");
    expect(report.writes).toBe(0);
    expect(report.moved).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.catalogMutation).toBe(false);
    expect(report.catalogWrite).toBe(false);
    expect(report.productionScanExecuted).toBe(false);
  });

  it("ignores mtime when hashing and classifying", async () => {
    expect(refuseMtimeAsInventoryTruth()).toBe("mtime_not_inventory_truth");
    const root = tmpRoot();
    const body = "mtime-is-not-truth";
    const filePath = writeFile(root, "workspace/mtime.md", body);
    writeSidecar(filePath, callerProof());

    const firstObjects = await scanLocalRootToObjects(root);
    const first = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", firstObjects)],
    });

    const past = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2035-01-01T00:00:00Z");
    fs.utimesSync(filePath, past, past);
    const midObjects = await scanLocalRootToObjects(root);
    const mid = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", midObjects)],
    });
    fs.utimesSync(filePath, future, future);
    const lastObjects = await scanLocalRootToObjects(root);
    const last = await scanProductionObjects({
      callerTenantId: CALLER,
      catalogRecords: [],
      sources: [memorySource("local_root", "fixture-root", lastObjects)],
    });

    expect(first.inventoryChecksum).toBe(mid.inventoryChecksum);
    expect(mid.inventoryChecksum).toBe(last.inventoryChecksum);
    expect(objectCandidate(first, filePath)?.disposition).toBe(
      objectCandidate(last, filePath)?.disposition,
    );
    expect(first.objects[0]?.contentHash).toBe(sha256Utf8(body));
    expect(last.objects[0]?.contentHash).toBe(sha256Utf8(body));
  });
});

describe("scanLocalRootToObjects", () => {
  it("skips sidecar files and does not follow symlinks", async () => {
    const root = tmpRoot();
    const real = writeFile(root, "workspace/real.md", "real");
    writeSidecar(real, callerProof());
    fs.writeFileSync(path.join(root, "workspace", ".openbot-ownership.json"), "{}");
    const target = writeFile(root, "workspace/target.md", "target");
    const link = path.join(root, "workspace", "link.md");
    fs.symlinkSync(target, link);
    const objects = await scanLocalRootToObjects(root);
    const locators = objects.map((o) => o.locator).toSorted();
    expect(locators).toEqual([real, target].toSorted());
    expect(objects.every((o) => !o.locator.endsWith(".ownership.json"))).toBe(true);
    expect(objects.every((o) => !o.locator.endsWith(".openbot-ownership.json"))).toBe(true);
  });
});
