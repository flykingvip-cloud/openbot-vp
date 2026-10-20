/**
 * Read-only production object inventory.
 * Scans injected controlled-store / BYOS / local-root ports. Never writes Catalog,
 * never moves or deletes objects, never guesses owner from directory names,
 * never treats repo-tree dry-run as production inventory, never opens a production object store
 * on the default path (productionScanExecuted stays false unless the caller
 * explicitly sets the flag after a real production scan).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  inventoryMigrationCandidates,
  mustNotEnterCatalog,
  refuseMtimeAsInventoryTruth,
  type MigrationCandidate,
  type MigrationConflictCode,
  type MigrationDisposition,
  type MigrationInventoryReport,
  type ObservedMigrationSource,
} from "./migration-inventory.js";
import type { CatalogRecord, GovernedResourceType } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION = 1 as const;

export type InventoryObjectKind = "controlled_store" | "byos" | "local_root";

export type ObservedProductionObject = {
  /** Store key or path used as locator. NEVER parsed for owner. */
  locator: string;
  kind: InventoryObjectKind;
  /** If present, contentHash is sha256 of these bytes. */
  bytes?: Uint8Array | null;
  byteCount: number;
  /** If bytes absent, store-provided sha256 hex is required. */
  contentHash?: string;
  sidecarProof?: GovernanceOwnershipProof | null;
};

export type InventoryObjectSource = {
  kind: InventoryObjectKind;
  id: string;
  list(): Promise<ObservedProductionObject[]>;
};

export type ProductionObjectInventoryInput = {
  /** Authenticated caller tenant. Required. Empty → missing_caller_tenant. */
  callerTenantId: string;
  /** Read-only Catalog match by locator / contentVersion hash. Never mutated. */
  catalogRecords: CatalogRecord[];
  sources: InventoryObjectSource[];
  /** Default false. BYOS sources stay fail-closed with zero invented objects. */
  byosAdapterAvailable?: boolean;
  /**
   * Default false. This slice does not execute a production store scan. Tests keep false.
   * The flag is a receipt of whether a production scan already happened;
   * it does not open a network path.
   */
  productionScanExecuted?: boolean;
};

export type InventoriedProductionObject = {
  locator: string;
  kind: InventoryObjectKind;
  byteCount: number;
  contentHash: string;
};

export type ProductionObjectInventoryReport = {
  schemaVersion: typeof PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION;
  callerTenantId: string;
  generatedKind: "read_only_production_object_inventory";
  fileCount: number;
  byteCount: number;
  inventoryChecksum: string;
  writes: 0;
  catalogMutation: false;
  catalogWrite: false;
  moved: 0;
  deleted: 0;
  productionScanExecuted: boolean;
  candidates: MigrationCandidate[];
  counts: Record<MigrationDisposition, number>;
  objects: InventoriedProductionObject[];
};

const SIDECAR_DIR_NAME = ".openbot-ownership.json";
const SIDECAR_SUFFIX = ".ownership.json";

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSidecarFileName(name: string): boolean {
  return name === SIDECAR_DIR_NAME || name.endsWith(SIDECAR_SUFFIX);
}

function proofTenantId(proof: GovernanceOwnershipProof | null | undefined): string | null {
  if (!proof) {
    return null;
  }
  if (proof.scope.kind === "tenant") {
    return proof.scope.tenantId;
  }
  return null;
}

/** Locator path segments are never ownership evidence. */
export function refuseOwnerFromDirectoryName(): "owner_not_guessed_from_dirname" {
  return "owner_not_guessed_from_dirname";
}

function catalogMatches(
  obj: { locator: string; contentHash: string },
  records: CatalogRecord[],
): CatalogRecord[] {
  const byLocator = records.filter((record) =>
    record.bindings.some((binding) => binding.locator === obj.locator),
  );
  if (byLocator.length > 0) {
    return byLocator;
  }
  return records.filter((record) =>
    record.bindings.some((binding) => binding.contentVersion === obj.contentHash),
  );
}

function tenantFromProofOrCatalog(
  obj: { locator: string; contentHash: string; sidecarProof?: GovernanceOwnershipProof | null },
  records: CatalogRecord[],
): string | null {
  const fromProof = proofTenantId(obj.sidecarProof);
  if (fromProof) {
    return fromProof;
  }
  const hits = catalogMatches(obj, records);
  if (hits.length === 1) {
    return hits[0]?.envelope.tenantId ?? null;
  }
  return null;
}

function resourceTypeFromCatalog(
  obj: { locator: string; contentHash: string },
  records: CatalogRecord[],
): GovernedResourceType {
  const hits = catalogMatches(obj, records);
  if (hits.length === 1 && hits[0]?.envelope.resourceType) {
    return hits[0].envelope.resourceType;
  }
  return "workspace";
}

function resolveObserved(obj: ObservedProductionObject): InventoriedProductionObject & {
  sidecarProof: GovernanceOwnershipProof | null;
} {
  refuseMtimeAsInventoryTruth();
  let contentHash: string;
  let byteCount = obj.byteCount;
  if (obj.bytes != null) {
    contentHash = sha256Bytes(obj.bytes);
    byteCount = obj.bytes.byteLength;
  } else if (obj.contentHash && /^[0-9a-f]{64}$/i.test(obj.contentHash.trim())) {
    contentHash = obj.contentHash.trim().toLowerCase();
  } else {
    contentHash = sha256Utf8(`missing_content_hash:${obj.locator}`);
  }
  return {
    locator: obj.locator,
    kind: obj.kind,
    byteCount,
    contentHash,
    sidecarProof: obj.sidecarProof ?? null,
  };
}

function toMigrationSource(params: {
  obj: InventoriedProductionObject & { sidecarProof: GovernanceOwnershipProof | null };
  index: number;
  catalogRecords: CatalogRecord[];
}): ObservedMigrationSource {
  const hits = catalogMatches(params.obj, params.catalogRecords);
  const hit = hits.length === 1 ? hits[0] : undefined;
  return {
    candidateId: `obj:${params.obj.kind}:${params.index}:${sha256Utf8(params.obj.locator).slice(0, 16)}`,
    tenantId: tenantFromProofOrCatalog(params.obj, params.catalogRecords),
    resourceType: resourceTypeFromCatalog(params.obj, params.catalogRecords),
    sourceLocator: params.obj.locator,
    checksum: params.obj.contentHash,
    schemaVersion: PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION,
    ownershipProof: params.obj.sidecarProof,
    existingResourceId: hit?.envelope.resourceId ?? null,
    proposedCanonicalBinding: hit?.envelope.canonicalBindingId ?? null,
    // Never set storageKind "byos" here: later-wave lock is handled by the
    // adapter-unavailable fail-closed candidate, not by inventing objects.
    storageKind: params.obj.kind === "controlled_store" ? "object-store" : "filesystem",
  };
}

function emptyCounts(): Record<MigrationDisposition, number> {
  return {
    owned: 0,
    unknown: 0,
    duplicate: 0,
    conflict: 0,
    orphan: 0,
    tombstoned: 0,
    already_governed: 0,
  };
}

function applyProductionConflicts(params: {
  candidates: MigrationCandidate[];
  objects: Array<InventoriedProductionObject & { sidecarProof: GovernanceOwnershipProof | null }>;
  catalogRecords: CatalogRecord[];
}): MigrationCandidate[] {
  const tenantsByLocator = new Map<string, Set<string>>();
  const tenantsByHash = new Map<string, Set<string>>();
  const bump = (map: Map<string, Set<string>>, key: string, tenant: string | null) => {
    if (!tenant) {
      return;
    }
    const set = map.get(key) ?? new Set<string>();
    set.add(tenant);
    map.set(key, set);
  };
  for (const obj of params.objects) {
    const tenant = tenantFromProofOrCatalog(obj, params.catalogRecords);
    bump(tenantsByLocator, obj.locator, tenant);
    bump(tenantsByHash, obj.contentHash, tenant);
  }
  const crossLocators = new Set(
    [...tenantsByLocator.entries()].filter(([, tenants]) => tenants.size > 1).map(([k]) => k),
  );
  const crossHashes = new Set(
    [...tenantsByHash.entries()].filter(([, tenants]) => tenants.size > 1).map(([k]) => k),
  );
  return params.candidates.map((candidate) => {
    if (!candidate.candidateId.startsWith("obj:")) {
      return candidate;
    }
    if (!crossLocators.has(candidate.sourceLocator) && !crossHashes.has(candidate.checksum)) {
      return candidate;
    }
    return {
      ...candidate,
      disposition: "conflict",
      conflictCode: "cross_tenant" satisfies MigrationConflictCode,
      proposedResourceId: null,
      proposedCanonicalBinding: null,
    };
  });
}

function finalizeProductionReport(params: {
  callerTenantId: string;
  objects: InventoriedProductionObject[];
  classified: MigrationInventoryReport;
  productionScanExecuted: boolean;
}): ProductionObjectInventoryReport {
  const candidates = params.classified.candidates.toSorted((a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  );
  const counts = emptyCounts();
  for (const candidate of candidates) {
    counts[candidate.disposition] += 1;
  }
  const objects = params.objects.toSorted((a, b) => a.locator.localeCompare(b.locator));
  const fileCount = objects.length;
  const byteCount = objects.reduce((sum, obj) => sum + obj.byteCount, 0);
  const inventoryChecksum = sha256Utf8(
    JSON.stringify({
      schemaVersion: PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION,
      callerTenantId: params.callerTenantId,
      fileCount,
      byteCount,
      productionScanExecuted: params.productionScanExecuted,
      writes: 0,
      catalogMutation: false,
      moved: 0,
      deleted: 0,
      objects,
      candidates,
    }),
  );
  return {
    schemaVersion: PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION,
    callerTenantId: params.callerTenantId,
    generatedKind: "read_only_production_object_inventory",
    fileCount,
    byteCount,
    inventoryChecksum,
    writes: 0,
    catalogMutation: false,
    catalogWrite: false,
    moved: 0,
    deleted: 0,
    productionScanExecuted: params.productionScanExecuted,
    candidates,
    counts,
    objects,
  };
}

function parseOwnershipSidecar(filePath: string): GovernanceOwnershipProof | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) {
      return null;
    }
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const proof = raw as GovernanceOwnershipProof;
    if (!proof.owner || !proof.scope) {
      return null;
    }
    return proof;
  } catch {
    return null;
  }
}

function sidecarProofForFile(filePath: string): GovernanceOwnershipProof | null {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const specific = path.join(dir, `${base}${SIDECAR_SUFFIX}`);
  const directory = path.join(dir, SIDECAR_DIR_NAME);
  return parseOwnershipSidecar(specific) ?? parseOwnershipSidecar(directory);
}

async function walkLocalFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkLocalFiles(full)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (isSidecarFileName(entry.name)) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Test/helper port: recursive files under rootDir as local_root objects.
 * Skips `.openbot-ownership.json` and `*.ownership.json`. Does not follow
 * symlinks. Does not read mtime. Never infers owner from directory names.
 */
export async function scanLocalRootToObjects(
  rootDir: string,
  opts?: { kind?: InventoryObjectKind },
): Promise<ObservedProductionObject[]> {
  refuseOwnerFromDirectoryName();
  refuseMtimeAsInventoryTruth();
  const kind = opts?.kind ?? "local_root";
  const resolved = path.resolve(rootDir);
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(resolved);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [];
  }
  const files = (await walkLocalFiles(resolved)).toSorted((a, b) => a.localeCompare(b));
  const objects: ObservedProductionObject[] = [];
  for (const filePath of files) {
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    objects.push({
      locator: filePath,
      kind,
      bytes,
      byteCount: bytes.byteLength,
      contentHash: sha256Bytes(bytes),
      sidecarProof: sidecarProofForFile(filePath),
    });
  }
  return objects;
}

/** Read-only production object inventory. Injected sources only; no LIVE I/O. */
export async function scanProductionObjects(
  input: ProductionObjectInventoryInput,
): Promise<ProductionObjectInventoryReport> {
  refuseOwnerFromDirectoryName();
  refuseMtimeAsInventoryTruth();
  const productionScanExecuted = input.productionScanExecuted === true;
  const byosAdapterAvailable = input.byosAdapterAvailable === true;
  const callerTenantId = input.callerTenantId.trim();
  const catalogRecords = input.catalogRecords ?? [];

  if (!callerTenantId) {
    const classified = inventoryMigrationCandidates({
      callerTenantId: input.callerTenantId,
      catalogRecords: [],
    });
    return finalizeProductionReport({
      callerTenantId: "",
      objects: [],
      classified,
      productionScanExecuted: false,
    });
  }

  const observed: ObservedProductionObject[] = [];
  const adapterLocked: ObservedMigrationSource[] = [];
  for (const source of input.sources ?? []) {
    if (source.kind === "byos" && !byosAdapterAvailable) {
      adapterLocked.push({
        candidateId: `byos-adapter-locked:${source.id}`,
        tenantId: callerTenantId,
        resourceType: "workspace",
        sourceLocator: `byos://${source.id}`,
        checksum: sha256Utf8(`later_wave_adapter_locked:${source.id}`),
        schemaVersion: PRODUCTION_OBJECT_INVENTORY_SCHEMA_VERSION,
        storageKind: "byos",
      });
      continue;
    }
    const listed = await source.list();
    observed.push(...listed);
  }

  const resolved = observed.map(resolveObserved);
  const sources: ObservedMigrationSource[] = [
    ...adapterLocked,
    ...resolved.map((obj, index) => toMigrationSource({ obj, index, catalogRecords })),
  ];
  const classified = inventoryMigrationCandidates({
    callerTenantId,
    catalogRecords,
    sources,
  });
  const candidates = applyProductionConflicts({
    candidates: classified.candidates,
    objects: resolved,
    catalogRecords,
  });
  return finalizeProductionReport({
    callerTenantId,
    objects: resolved.map(({ locator, kind, byteCount, contentHash }) => ({
      locator,
      kind,
      byteCount,
      contentHash,
    })),
    classified: { ...classified, candidates },
    productionScanExecuted,
  });
}

export { mustNotEnterCatalog, refuseMtimeAsInventoryTruth };
