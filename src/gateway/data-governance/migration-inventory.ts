/**
 * M0 read-only legacy-migration inventory (architecture §15.1).
 * Zero writes. Unknown / duplicate / conflict / orphan never propose Catalog insert.
 * Later-wave adapters stay fail-closed. mtime is never inventory truth.
 */
import { createHash } from "node:crypto";
import type { LaterWaveAdapterKind } from "./cognitive-promotion-adapters.js";
import type {
  CatalogRecord,
  DataClassification,
  GovernanceLifecycleReceipt,
  GovernedResourceType,
  LegalHold,
  OwnershipPrincipal,
  StorageBinding,
} from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const MIGRATION_INVENTORY_SCHEMA_VERSION = 1 as const;

export const MIGRATION_DISPOSITIONS = [
  "owned",
  "unknown",
  "duplicate",
  "conflict",
  "orphan",
  "tombstoned",
  "already_governed",
] as const;

export type MigrationDisposition = (typeof MIGRATION_DISPOSITIONS)[number];

export type MigrationInventoryResourceType =
  | GovernedResourceType
  | "catalog"
  | "binding"
  | "receipt"
  | "legal_hold"
  | "retention";

export type MigrationConflictCode =
  | "cross_tenant"
  | "unknown_owner"
  | "duplicate_checksum"
  | "ownership_conflict"
  | "tombstoned"
  | "legal_hold_active"
  | "dual_writable_canonical"
  | "later_wave_adapter_locked"
  | "missing_caller_tenant"
  | "shared_agent_forbidden";

export type MigrationOwnerScope = "user_owned" | "position_owned" | "group_owned" | "system";

export type OwnershipEvidence = {
  proofPresent: boolean;
  owner: OwnershipPrincipal | null;
  ownerScope: MigrationOwnerScope | null;
  source: "auth_proof" | "catalog_envelope" | "missing";
};

export type ClassificationEvidence = {
  classification: DataClassification | null;
  source: "envelope" | "hint" | "missing";
};

export type RetentionEvidence = {
  policyId: string;
  retainUntil: string | null;
};

export type MigrationCandidate = {
  candidateId: string;
  tenantId: string | null;
  resourceType: MigrationInventoryResourceType;
  sourceLocator: string;
  ownershipEvidence: OwnershipEvidence;
  classificationEvidence: ClassificationEvidence;
  checksum: string;
  schemaVersion: number;
  proposedResourceId: string | null;
  proposedCanonicalBinding: string | null;
  conflictCode: MigrationConflictCode | null;
  retention: RetentionEvidence | null;
  legalHold: LegalHold | null;
  disposition: MigrationDisposition;
};

export type ObservedMigrationSource = {
  candidateId: string;
  tenantId: string | null;
  resourceType: GovernedResourceType;
  sourceLocator: string;
  checksum: string;
  schemaVersion: number;
  ownershipProof?: GovernanceOwnershipProof | null;
  classificationHint?: DataClassification | null;
  existingResourceId?: string | null;
  proposedCanonicalBinding?: string | null;
  storageKind?: StorageBinding["storageKind"];
  laterWaveAdapter?: LaterWaveAdapterKind;
  legalHold?: LegalHold | null;
  retention?: RetentionEvidence | null;
  tombstoned?: boolean;
  /**
   * Ignored. Filesystem mtime is never inventory truth (P5 L2 / M0 iron rule).
   * Accepted only so callers cannot smuggle it into disposition.
   */
  mtimeMs?: number;
};

export type MigrationInventoryInput = {
  /** Authenticated caller tenant. Required. Never enumerate all tenants. */
  callerTenantId: string;
  catalogRecords: CatalogRecord[];
  receipts?: GovernanceLifecycleReceipt[];
  sources?: ObservedMigrationSource[];
};

export type MigrationInventoryReport = {
  schemaVersion: typeof MIGRATION_INVENTORY_SCHEMA_VERSION;
  callerTenantId: string;
  generatedKind: "read_only_dry_run";
  writes: 0;
  inventoryChecksum: string;
  candidates: MigrationCandidate[];
  counts: Record<MigrationDisposition, number>;
};

const TOMBSTONE_STATES = new Set(["purged", "deletion_pending", "retired"]);

const APPROVED_SYSTEM_SCOPES = new Set(["enterprise-oi"]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ownerScopeFromPrincipal(owner: OwnershipPrincipal | null): MigrationOwnerScope | null {
  if (!owner) {
    return null;
  }
  switch (owner.kind) {
    case "user":
      return "user_owned";
    case "position":
      return "position_owned";
    case "group":
      return "group_owned";
    case "system":
      return "system";
  }
}

function ownerKey(owner: OwnershipPrincipal): string {
  switch (owner.kind) {
    case "user":
      return `user:${owner.userId}`;
    case "position":
      return `position:${owner.seatId}`;
    case "group":
      return `group:${owner.groupId}`;
    case "system":
      return `system:${owner.systemId}`;
  }
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

function isSharedAgentShortcut(proof: GovernanceOwnershipProof | null | undefined): boolean {
  if (!proof) {
    return false;
  }
  if (proof.owner.kind === "system" && !APPROVED_SYSTEM_SCOPES.has(proof.owner.systemId)) {
    return true;
  }
  if (proof.owner.kind === "system" && proof.scope.kind !== "tenant") {
    return true;
  }
  return false;
}

function catalogByLocator(records: CatalogRecord[]): Map<string, CatalogRecord[]> {
  const map = new Map<string, CatalogRecord[]>();
  for (const record of records) {
    for (const binding of record.bindings) {
      const list = map.get(binding.locator) ?? [];
      list.push(record);
      map.set(binding.locator, list);
    }
  }
  return map;
}

function catalogByChecksum(records: CatalogRecord[]): Map<string, CatalogRecord[]> {
  const map = new Map<string, CatalogRecord[]>();
  for (const record of records) {
    for (const binding of record.bindings) {
      const key = `${record.envelope.tenantId ?? ""}:${binding.contentVersion}`;
      const list = map.get(key) ?? [];
      list.push(record);
      map.set(key, list);
    }
  }
  return map;
}

function emptyOwnership(): OwnershipEvidence {
  return { proofPresent: false, owner: null, ownerScope: null, source: "missing" };
}

function evidenceFromProof(proof: GovernanceOwnershipProof): OwnershipEvidence {
  return {
    proofPresent: true,
    owner: proof.owner,
    ownerScope: ownerScopeFromPrincipal(proof.owner),
    source: "auth_proof",
  };
}

function evidenceFromEnvelope(record: CatalogRecord): OwnershipEvidence {
  return {
    proofPresent: true,
    owner: record.envelope.owner,
    ownerScope: ownerScopeFromPrincipal(record.envelope.owner),
    source: "catalog_envelope",
  };
}

function classificationFrom(
  classification: DataClassification | null | undefined,
  source: ClassificationEvidence["source"],
): ClassificationEvidence {
  if (!classification) {
    return { classification: null, source: "missing" };
  }
  return { classification, source };
}

function laterWaveLocked(source: ObservedMigrationSource): boolean {
  if (source.laterWaveAdapter) {
    return true;
  }
  return source.storageKind === "byos";
}

function activeCanonicalCount(record: CatalogRecord): number {
  return record.bindings.filter((b) => b.role === "canonical" && b.state === "active").length;
}

function proposeOwned(params: {
  existingResourceId?: string | null;
  resourceType: GovernedResourceType;
  callerTenantId: string;
  checksum: string;
  locator: string;
  proposedCanonicalBinding?: string | null;
}): { proposedResourceId: string; proposedCanonicalBinding: string } {
  const proposedResourceId =
    params.existingResourceId?.trim() ||
    `mig:${params.resourceType}:${sha256Hex(`${params.callerTenantId}:${params.checksum}:${params.locator}`).slice(0, 24)}`;
  const proposedCanonicalBinding =
    params.proposedCanonicalBinding?.trim() || `bind:${sha256Hex(params.locator).slice(0, 24)}`;
  return { proposedResourceId, proposedCanonicalBinding };
}

function quarantine(params: {
  candidateId: string;
  tenantId: string | null;
  resourceType: MigrationInventoryResourceType;
  sourceLocator: string;
  ownershipEvidence: OwnershipEvidence;
  classificationEvidence: ClassificationEvidence;
  checksum: string;
  schemaVersion: number;
  disposition: Exclude<MigrationDisposition, "owned" | "already_governed">;
  conflictCode: MigrationConflictCode | null;
  retention: RetentionEvidence | null;
  legalHold: LegalHold | null;
}): MigrationCandidate {
  return {
    candidateId: params.candidateId,
    tenantId: params.tenantId,
    resourceType: params.resourceType,
    sourceLocator: params.sourceLocator,
    ownershipEvidence: params.ownershipEvidence,
    classificationEvidence: params.classificationEvidence,
    checksum: params.checksum,
    schemaVersion: params.schemaVersion,
    proposedResourceId: null,
    proposedCanonicalBinding: null,
    conflictCode: params.conflictCode,
    retention: params.retention,
    legalHold: params.legalHold,
    disposition: params.disposition,
  };
}

function classifySource(
  source: ObservedMigrationSource,
  params: {
    callerTenantId: string;
    byLocator: Map<string, CatalogRecord[]>;
    byChecksum: Map<string, CatalogRecord[]>;
    sourceChecksumCounts: Map<string, number>;
  },
): MigrationCandidate {
  const ownership = source.ownershipProof
    ? evidenceFromProof(source.ownershipProof)
    : emptyOwnership();
  const classification = classificationFrom(source.classificationHint, "hint");
  const base = {
    candidateId: source.candidateId,
    tenantId: source.tenantId,
    resourceType: source.resourceType,
    sourceLocator: source.sourceLocator,
    ownershipEvidence: ownership,
    classificationEvidence: classification,
    checksum: source.checksum,
    schemaVersion: source.schemaVersion,
    retention: source.retention ?? null,
    legalHold: source.legalHold ?? null,
  };

  if (laterWaveLocked(source)) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "later_wave_adapter_locked",
    });
  }

  if (source.tenantId && source.tenantId !== params.callerTenantId) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "cross_tenant",
    });
  }

  const proofTenant = proofTenantId(source.ownershipProof);
  if (proofTenant && proofTenant !== params.callerTenantId) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "cross_tenant",
    });
  }

  if (isSharedAgentShortcut(source.ownershipProof)) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "shared_agent_forbidden",
    });
  }

  const matched = params.byLocator.get(source.sourceLocator) ?? [];
  const sameTenantMatched = matched.filter((r) => r.envelope.tenantId === params.callerTenantId);
  const foreignMatched = matched.filter(
    (r) => r.envelope.tenantId && r.envelope.tenantId !== params.callerTenantId,
  );
  if (foreignMatched.length > 0) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "cross_tenant",
    });
  }

  if (sameTenantMatched.length > 1) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "ownership_conflict",
    });
  }

  const catalogHit = sameTenantMatched[0];
  if (catalogHit) {
    if (activeCanonicalCount(catalogHit) > 1) {
      return quarantine({
        ...base,
        ownershipEvidence: evidenceFromEnvelope(catalogHit),
        classificationEvidence: classificationFrom(catalogHit.envelope.classification, "envelope"),
        disposition: "conflict",
        conflictCode: "dual_writable_canonical",
        legalHold: catalogHit.envelope.legalHold ?? source.legalHold ?? null,
      });
    }
    if (source.tombstoned || TOMBSTONE_STATES.has(catalogHit.envelope.lifecycleState)) {
      return quarantine({
        ...base,
        ownershipEvidence: evidenceFromEnvelope(catalogHit),
        classificationEvidence: classificationFrom(catalogHit.envelope.classification, "envelope"),
        disposition: "tombstoned",
        conflictCode: "tombstoned",
        legalHold: catalogHit.envelope.legalHold ?? source.legalHold ?? null,
      });
    }
    if (
      source.ownershipProof &&
      ownerKey(source.ownershipProof.owner) !== ownerKey(catalogHit.envelope.owner)
    ) {
      return quarantine({
        ...base,
        disposition: "conflict",
        conflictCode: "ownership_conflict",
        legalHold: catalogHit.envelope.legalHold ?? source.legalHold ?? null,
      });
    }
    return {
      ...base,
      tenantId: catalogHit.envelope.tenantId,
      ownershipEvidence: evidenceFromEnvelope(catalogHit),
      classificationEvidence: classificationFrom(catalogHit.envelope.classification, "envelope"),
      proposedResourceId: catalogHit.envelope.resourceId,
      proposedCanonicalBinding: catalogHit.envelope.canonicalBindingId,
      conflictCode: null,
      legalHold: catalogHit.envelope.legalHold ?? source.legalHold ?? null,
      disposition: "already_governed",
    };
  }

  if (source.tombstoned) {
    return quarantine({
      ...base,
      disposition: "tombstoned",
      conflictCode: "tombstoned",
    });
  }

  const checksumHits = params.byChecksum.get(`${params.callerTenantId}:${source.checksum}`) ?? [];
  const sourceDupes =
    params.sourceChecksumCounts.get(`${params.callerTenantId}:${source.checksum}`) ?? 0;
  if (checksumHits.length > 0 || sourceDupes > 1) {
    return quarantine({
      ...base,
      disposition: "duplicate",
      conflictCode: "duplicate_checksum",
    });
  }

  if (!source.ownershipProof) {
    if (!source.tenantId) {
      return quarantine({
        ...base,
        disposition: "orphan",
        conflictCode: "unknown_owner",
      });
    }
    return quarantine({
      ...base,
      disposition: "unknown",
      conflictCode: "unknown_owner",
    });
  }

  if (source.legalHold && !source.legalHold.releasedAt) {
    return quarantine({
      ...base,
      disposition: "conflict",
      conflictCode: "legal_hold_active",
    });
  }

  const proposed = proposeOwned({
    existingResourceId: source.existingResourceId,
    resourceType: source.resourceType,
    callerTenantId: params.callerTenantId,
    checksum: source.checksum,
    locator: source.sourceLocator,
    proposedCanonicalBinding: source.proposedCanonicalBinding,
  });
  return {
    ...base,
    tenantId: params.callerTenantId,
    proposedResourceId: proposed.proposedResourceId,
    proposedCanonicalBinding: proposed.proposedCanonicalBinding,
    conflictCode: null,
    disposition: "owned",
  };
}

function catalogRecordCandidates(
  record: CatalogRecord,
  callerTenantId: string,
): MigrationCandidate[] {
  const foreign = Boolean(record.envelope.tenantId && record.envelope.tenantId !== callerTenantId);
  const tombstoned = TOMBSTONE_STATES.has(record.envelope.lifecycleState);
  const dual = activeCanonicalCount(record) > 1;
  const canonical =
    record.bindings.find((b) => b.bindingId === record.envelope.canonicalBindingId) ??
    record.bindings[0];
  const checksum = canonical?.contentVersion ?? sha256Hex(record.envelope.resourceId);
  const legalHold = record.envelope.legalHold ?? null;

  const catalogCandidate = ((): MigrationCandidate => {
    if (foreign) {
      return quarantine({
        candidateId: `catalog:${record.envelope.resourceId}`,
        tenantId: record.envelope.tenantId,
        resourceType: record.envelope.resourceType,
        sourceLocator: canonical?.locator ?? `catalog:${record.envelope.resourceId}`,
        ownershipEvidence: evidenceFromEnvelope(record),
        classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
        checksum,
        schemaVersion: record.envelope.schemaVersion,
        disposition: "conflict",
        conflictCode: "cross_tenant",
        retention: null,
        legalHold,
      });
    }
    if (dual) {
      return quarantine({
        candidateId: `catalog:${record.envelope.resourceId}`,
        tenantId: record.envelope.tenantId,
        resourceType: record.envelope.resourceType,
        sourceLocator: canonical?.locator ?? `catalog:${record.envelope.resourceId}`,
        ownershipEvidence: evidenceFromEnvelope(record),
        classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
        checksum,
        schemaVersion: record.envelope.schemaVersion,
        disposition: "conflict",
        conflictCode: "dual_writable_canonical",
        retention: null,
        legalHold,
      });
    }
    if (tombstoned) {
      return quarantine({
        candidateId: `catalog:${record.envelope.resourceId}`,
        tenantId: record.envelope.tenantId,
        resourceType: record.envelope.resourceType,
        sourceLocator: canonical?.locator ?? `catalog:${record.envelope.resourceId}`,
        ownershipEvidence: evidenceFromEnvelope(record),
        classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
        checksum,
        schemaVersion: record.envelope.schemaVersion,
        disposition: "tombstoned",
        conflictCode: "tombstoned",
        retention: null,
        legalHold,
      });
    }
    return {
      candidateId: `catalog:${record.envelope.resourceId}`,
      tenantId: record.envelope.tenantId,
      resourceType: record.envelope.resourceType,
      sourceLocator: canonical?.locator ?? `catalog:${record.envelope.resourceId}`,
      ownershipEvidence: evidenceFromEnvelope(record),
      classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
      checksum,
      schemaVersion: record.envelope.schemaVersion,
      proposedResourceId: record.envelope.resourceId,
      proposedCanonicalBinding: record.envelope.canonicalBindingId,
      conflictCode: null,
      retention: null,
      legalHold,
      disposition: "already_governed",
    };
  })();

  const bindings = record.bindings.map((binding) => {
    const foreignBinding = foreign;
    if (foreignBinding) {
      return quarantine({
        candidateId: `binding:${binding.bindingId}`,
        tenantId: record.envelope.tenantId,
        resourceType: "binding",
        sourceLocator: binding.locator,
        ownershipEvidence: evidenceFromEnvelope(record),
        classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
        checksum: binding.contentVersion,
        schemaVersion: record.envelope.schemaVersion,
        disposition: "conflict",
        conflictCode: "cross_tenant",
        retention: null,
        legalHold,
      });
    }
    if (tombstoned) {
      return quarantine({
        candidateId: `binding:${binding.bindingId}`,
        tenantId: record.envelope.tenantId,
        resourceType: "binding",
        sourceLocator: binding.locator,
        ownershipEvidence: evidenceFromEnvelope(record),
        classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
        checksum: binding.contentVersion,
        schemaVersion: record.envelope.schemaVersion,
        disposition: "tombstoned",
        conflictCode: "tombstoned",
        retention: null,
        legalHold,
      });
    }
    return {
      candidateId: `binding:${binding.bindingId}`,
      tenantId: record.envelope.tenantId,
      resourceType: "binding" as const,
      sourceLocator: binding.locator,
      ownershipEvidence: evidenceFromEnvelope(record),
      classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
      checksum: binding.contentVersion,
      schemaVersion: record.envelope.schemaVersion,
      proposedResourceId: record.envelope.resourceId,
      proposedCanonicalBinding: record.envelope.canonicalBindingId,
      conflictCode: null,
      retention: null,
      legalHold,
      disposition: "already_governed" as const,
    };
  });

  const holds: MigrationCandidate[] = [];
  if (legalHold) {
    holds.push({
      candidateId: `legal_hold:${legalHold.holdId}:${record.envelope.resourceId}`,
      tenantId: record.envelope.tenantId,
      resourceType: "legal_hold",
      sourceLocator: canonical?.locator ?? `catalog:${record.envelope.resourceId}`,
      ownershipEvidence: evidenceFromEnvelope(record),
      classificationEvidence: classificationFrom(record.envelope.classification, "envelope"),
      checksum: sha256Hex(legalHold.holdId),
      schemaVersion: record.envelope.schemaVersion,
      proposedResourceId: foreign || tombstoned ? null : record.envelope.resourceId,
      proposedCanonicalBinding: foreign || tombstoned ? null : record.envelope.canonicalBindingId,
      conflictCode: foreign ? "cross_tenant" : legalHold.releasedAt ? null : "legal_hold_active",
      retention: null,
      legalHold,
      disposition: foreign ? "conflict" : tombstoned ? "tombstoned" : "already_governed",
    });
  }

  return [catalogCandidate, ...bindings, ...holds];
}

function receiptCandidate(
  receipt: GovernanceLifecycleReceipt,
  callerTenantId: string,
): MigrationCandidate {
  const foreign = Boolean(receipt.tenantId && receipt.tenantId !== callerTenantId);
  const locator = `receipt:${receipt.receiptId}`;
  if (foreign) {
    return quarantine({
      candidateId: `receipt:${receipt.receiptId}`,
      tenantId: receipt.tenantId,
      resourceType: "receipt",
      sourceLocator: locator,
      ownershipEvidence: emptyOwnership(),
      classificationEvidence: classificationFrom(null, "missing"),
      checksum: sha256Hex(receipt.requestFingerprint),
      schemaVersion: MIGRATION_INVENTORY_SCHEMA_VERSION,
      disposition: "conflict",
      conflictCode: "cross_tenant",
      retention: null,
      legalHold: receipt.legalHoldSnapshot ?? null,
    });
  }
  return {
    candidateId: `receipt:${receipt.receiptId}`,
    tenantId: receipt.tenantId,
    resourceType: "receipt",
    sourceLocator: locator,
    ownershipEvidence: emptyOwnership(),
    classificationEvidence: classificationFrom(null, "missing"),
    checksum: sha256Hex(receipt.requestFingerprint),
    schemaVersion: MIGRATION_INVENTORY_SCHEMA_VERSION,
    proposedResourceId: receipt.resourceId,
    proposedCanonicalBinding: null,
    conflictCode: null,
    retention: null,
    legalHold: receipt.legalHoldSnapshot ?? null,
    disposition: "already_governed",
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

/** Read-only, repeatable inventory. Does not write Catalog, receipts, or paths. */
export function inventoryMigrationCandidates(
  input: MigrationInventoryInput,
): MigrationInventoryReport {
  const callerTenantId = input.callerTenantId.trim();
  if (!callerTenantId) {
    const denied = quarantine({
      candidateId: "inventory:missing_caller_tenant",
      tenantId: null,
      resourceType: "catalog",
      sourceLocator: "inventory://caller",
      ownershipEvidence: emptyOwnership(),
      classificationEvidence: classificationFrom(null, "missing"),
      checksum: sha256Hex("missing_caller_tenant"),
      schemaVersion: MIGRATION_INVENTORY_SCHEMA_VERSION,
      disposition: "conflict",
      conflictCode: "missing_caller_tenant",
      retention: null,
      legalHold: null,
    });
    return finalizeReport("", [denied]);
  }

  const records = input.catalogRecords;
  const byLocator = catalogByLocator(records);
  const byChecksum = catalogByChecksum(records);
  const sources = input.sources ?? [];
  const sourceChecksumCounts = new Map<string, number>();
  for (const source of sources) {
    const tenant = source.tenantId ?? callerTenantId;
    const key = `${tenant}:${source.checksum}`;
    sourceChecksumCounts.set(key, (sourceChecksumCounts.get(key) ?? 0) + 1);
  }

  const candidates: MigrationCandidate[] = [];
  for (const record of records) {
    candidates.push(...catalogRecordCandidates(record, callerTenantId));
  }
  for (const receipt of input.receipts ?? []) {
    candidates.push(receiptCandidate(receipt, callerTenantId));
  }
  for (const source of sources) {
    const classified = classifySource(source, {
      callerTenantId,
      byLocator,
      byChecksum,
      sourceChecksumCounts,
    });
    candidates.push(classified);
    if (source.retention) {
      candidates.push({
        ...classified,
        candidateId: `retention:${source.retention.policyId}:${source.candidateId}`,
        resourceType: "retention",
        proposedResourceId:
          classified.disposition === "owned" || classified.disposition === "already_governed"
            ? classified.proposedResourceId
            : null,
        proposedCanonicalBinding:
          classified.disposition === "owned" || classified.disposition === "already_governed"
            ? classified.proposedCanonicalBinding
            : null,
      });
    }
  }

  return finalizeReport(callerTenantId, candidates);
}

export function computeInventoryChecksum(params: {
  callerTenantId: string;
  candidates: MigrationCandidate[];
}): string {
  const sorted = params.candidates.toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));
  return sha256Hex(
    JSON.stringify({
      schemaVersion: MIGRATION_INVENTORY_SCHEMA_VERSION,
      callerTenantId: params.callerTenantId,
      candidates: sorted,
    }),
  );
}

function finalizeReport(
  callerTenantId: string,
  candidates: MigrationCandidate[],
): MigrationInventoryReport {
  const sorted = candidates.toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));
  const counts = emptyCounts();
  for (const candidate of sorted) {
    counts[candidate.disposition] += 1;
  }
  return {
    schemaVersion: MIGRATION_INVENTORY_SCHEMA_VERSION,
    callerTenantId,
    generatedKind: "read_only_dry_run",
    writes: 0,
    inventoryChecksum: computeInventoryChecksum({ callerTenantId, candidates: sorted }),
    candidates: sorted,
    counts,
  };
}

export function refuseMtimeAsInventoryTruth(): "mtime_not_inventory_truth" {
  return "mtime_not_inventory_truth";
}

/** Unknown / duplicate / conflict / orphan / tombstoned must not propose Catalog insert. */
export function mustNotEnterCatalog(candidate: MigrationCandidate): boolean {
  if (candidate.disposition === "owned" || candidate.disposition === "already_governed") {
    return false;
  }
  return candidate.proposedResourceId === null && candidate.proposedCanonicalBinding === null;
}
