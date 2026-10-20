/**
 * Phase 1B item 2 Stage B: persist authority-classified workspace rows
 * through the existing Catalog store. First insert uses put (compareAndPut
 * is update-only and returns not_found). Admission is then confirmed with
 * compareAndPut. Unknown / conflict / pending_authority never enter Catalog.
 *
 * This writes a non-LIVE evidence catalog only. It does not open the
 * resolver write switch or production miss=deny.
 */
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

export type AuthorityCandidateRow = {
  resourceId?: string;
  classification?: string;
  workspaceKind?: string;
  tenantId?: string;
  userId?: string;
  seatId?: string;
  groupId?: string;
  agentAssetId?: string;
  ownerType?: string;
};

export type PersistClassifiedResult = {
  persisted: string[];
  skippedExisting: string[];
  quarantined: Array<{ resourceId?: string; reason: string; workspaceKind?: string }>;
  compareAndPutConfirmed: string[];
};

const QUARANTINE_REASONS = new Set(["unknown", "conflict", "pending_authority", "unclassified"]);

/** Production write-block: conflict / unknown / pending_authority never enter Catalog. Not miss=deny. */
export function assertClassifiedCatalogWriteAllowed(
  classification: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (classification === "classified") {
    return { ok: true };
  }
  const reason = QUARANTINE_REASONS.has(String(classification))
    ? String(classification)
    : "unclassified";
  return { ok: false, reason };
}

export const CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED = true;

function isClassified(row: AuthorityCandidateRow): boolean {
  return (
    row.classification === "classified" &&
    typeof row.resourceId === "string" &&
    row.resourceId.length > 0
  );
}

function ownerAndScope(
  row: AuthorityCandidateRow,
): Pick<CatalogRecord["envelope"], "owner" | "scope"> {
  if (row.workspaceKind === "group_shared" && row.groupId) {
    return {
      owner: { kind: "group", groupId: row.groupId },
      scope: { kind: "group", groupId: row.groupId },
    };
  }
  if (row.ownerType === "seat" && row.seatId) {
    return {
      owner: { kind: "position", seatId: row.seatId },
      scope: { kind: "tenant", tenantId: row.tenantId ?? "" },
    };
  }
  if (!row.userId) {
    throw new Error("classified_row_missing_owner");
  }
  return {
    owner: { kind: "user", userId: row.userId },
    scope: { kind: "user", userId: row.userId },
  };
}

export function buildClassifiedCatalogRecord(
  row: AuthorityCandidateRow,
  now: string,
): CatalogRecord {
  if (!isClassified(row) || !row.resourceId || !row.tenantId) {
    throw new Error("classified_row_required");
  }
  const bindingId = `bind:${row.resourceId}`;
  const { owner, scope } = ownerAndScope(row);
  return {
    envelope: {
      resourceId: row.resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: row.tenantId,
      owner,
      scope,
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: bindingId,
      createdAt: now,
      updatedAt: now,
    },
    bindings: [
      {
        bindingId,
        resourceId: row.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        // Locator is placement metadata, not identity. Identity is resourceId.
        locator: `unplaced://classified/${row.resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

export async function persistClassifiedAuthorityRows(params: {
  store: DataGovernanceCatalogStore;
  candidates: AuthorityCandidateRow[];
  rejected?: Array<{ reason?: string; resourceId?: string; workspaceKind?: string }>;
  now?: string;
  skipExisting?: boolean;
}): Promise<PersistClassifiedResult> {
  const now = params.now ?? "2026-08-17T00:00:00.000Z";
  const persisted: string[] = [];
  const skippedExisting: string[] = [];
  const compareAndPutConfirmed: string[] = [];
  const quarantined: PersistClassifiedResult["quarantined"] = [];

  for (const row of params.rejected ?? []) {
    quarantined.push({
      resourceId: row.resourceId,
      reason: row.reason ?? "rejected",
      workspaceKind: row.workspaceKind,
    });
  }

  for (const row of params.candidates) {
    const allowed = assertClassifiedCatalogWriteAllowed(row.classification);
    if (!allowed.ok || !isClassified(row)) {
      quarantined.push({
        resourceId: row.resourceId,
        reason: allowed.ok ? "unclassified" : allowed.reason,
        workspaceKind: row.workspaceKind,
      });
      continue;
    }
    if (params.skipExisting && row.resourceId) {
      const existing = await params.store.get(row.resourceId);
      if (existing) {
        skippedExisting.push(row.resourceId);
        continue;
      }
    }
    const created = buildClassifiedCatalogRecord(row, now);
    // compareAndPut is update-only (missing → not_found). Create uses put, then
    // compareAndPut confirms the classified admission. Conflict/unknown never reach either.
    await params.store.put(created);
    const next: CatalogRecord = {
      ...created,
      envelope: {
        ...created.envelope,
        governanceVersion: 2,
        updatedAt: now,
      },
    };
    const cas = await params.store.compareAndPut({
      resourceId: created.envelope.resourceId,
      expectedGovernanceVersion: 1,
      next,
    });
    if (!cas.ok) {
      throw new Error(`classified_compare_and_put_failed:${cas.conflict}`);
    }
    persisted.push(created.envelope.resourceId);
    compareAndPutConfirmed.push(created.envelope.resourceId);
  }

  return { persisted, skippedExisting, quarantined, compareAndPutConfirmed };
}
