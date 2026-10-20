import { discoverWorkspaceCandidates } from "./discover-candidates.js";
import { scanWorkspaceRoot } from "./scan-root.js";
import type {
  WorkspaceInventoryLimits,
  WorkspaceInventoryRecord,
  WorkspaceInventoryReport,
} from "./types.js";
import { WORKSPACE_INVENTORY_RAW_SCHEMA } from "./types.js";

export type RunWorkspaceInventoryParams = {
  containmentRoot: string;
  limits?: Partial<WorkspaceInventoryLimits>;
  inventoryUtc?: string;
};

const DEFAULT_LIMITS: WorkspaceInventoryLimits = {
  maxCandidates: 500,
  maxFiles: 20_000,
  maxDepth: 24,
  maxBytesRead: 256 * 1024 * 1024,
  maxFullHashBytes: 2 * 1024 * 1024,
};

function markDuplicateBindings(records: WorkspaceInventoryRecord[]): {
  duplicateContentGroups: Array<{ contentDigest: string; candidateIds: string[] }>;
} {
  const byDigest = new Map<string, WorkspaceInventoryRecord[]>();
  for (const record of records) {
    if (!record.contentDigest) {
      continue;
    }
    const list = byDigest.get(record.contentDigest) ?? [];
    list.push(record);
    byDigest.set(record.contentDigest, list);
  }
  const duplicateContentGroups: Array<{ contentDigest: string; candidateIds: string[] }> = [];
  for (const [digest, group] of byDigest.entries()) {
    if (group.length < 2) {
      continue;
    }
    group.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    duplicateContentGroups.push({
      contentDigest: digest,
      candidateIds: group.map((r) => r.candidateId),
    });
    for (let i = 1; i < group.length; i += 1) {
      group[i].bindingRole = "duplicate";
      if (group[i].ownershipStatus === "unknown") {
        group[i].ownershipStatus = "conflict";
      }
    }
  }
  duplicateContentGroups.sort((a, b) => a.contentDigest.localeCompare(b.contentDigest));
  return { duplicateContentGroups };
}

/**
 * Read-only workspace inventory over discovered candidate roots.
 * Ownership is never inferred from filesystem metadata — default unknown until P0-b classifier.
 */
export function runWorkspaceInventory(
  params: RunWorkspaceInventoryParams,
): WorkspaceInventoryReport {
  const limits: WorkspaceInventoryLimits = { ...DEFAULT_LIMITS, ...params.limits };
  const discovered = discoverWorkspaceCandidates({
    containmentRoot: params.containmentRoot,
    maxCandidates: limits.maxCandidates,
  });

  const truncationReasons: string[] = [];
  if (discovered.truncated) {
    truncationReasons.push("max_candidates");
  }

  let totalBytesRead = 0;
  let totalErrors = 0;
  let scanTruncated = false;

  const records: WorkspaceInventoryRecord[] = discovered.candidates.map((candidate) => {
    if (candidate.durabilityClass === "SECRET") {
      return {
        candidateId: candidate.candidateId,
        normalizedRootClass: candidate.normalizedRootClass,
        durabilityClass: candidate.durabilityClass,
        tenantRef: candidate.tenantRef,
        ownerRef: candidate.ownerRef,
        agentId: candidate.agentId,
        agentAssetId: candidate.agentAssetId,
        groupId: candidate.groupId,
        ownershipStatus: "unknown",
        bindingRole: candidate.bindingRole,
        fileCount: 0,
        byteCount: 0,
        contentDigest: null,
        truncated: false,
        errors: [],
      };
    }
    const scan = scanWorkspaceRoot({
      containmentRoot: params.containmentRoot,
      candidateRoot: candidate.absRoot,
      limits: {
        maxFiles: limits.maxFiles,
        maxDepth: limits.maxDepth,
        maxBytesRead: limits.maxBytesRead,
        maxFullHashBytes: limits.maxFullHashBytes,
      },
    });
    totalBytesRead += scan.bytesRead;
    totalErrors += scan.errors.length;
    if (scan.truncated) {
      scanTruncated = true;
    }
    return {
      candidateId: candidate.candidateId,
      normalizedRootClass: candidate.normalizedRootClass,
      durabilityClass: candidate.durabilityClass,
      tenantRef: candidate.tenantRef,
      ownerRef: candidate.ownerRef,
      agentId: candidate.agentId,
      agentAssetId: candidate.agentAssetId,
      groupId: candidate.groupId,
      ownershipStatus: "unknown",
      bindingRole: candidate.bindingRole,
      fileCount: scan.fileCount,
      byteCount: scan.byteCount,
      contentDigest: scan.contentDigest,
      truncated: scan.truncated,
      errors: scan.errors,
    };
  });

  if (scanTruncated) {
    truncationReasons.push("scan_limits");
  }

  const { duplicateContentGroups } = markDuplicateBindings(records);
  const unknownOwnershipCandidateIds = records
    .filter((r) => r.ownershipStatus === "unknown" || r.ownershipStatus === "conflict")
    .map((r) => r.candidateId);

  return {
    schema: WORKSPACE_INVENTORY_RAW_SCHEMA,
    mode: "inventory-raw",
    inventoryUtc: params.inventoryUtc ?? new Date().toISOString(),
    containmentRoot: params.containmentRoot,
    limits,
    stats: {
      candidateCount: records.length,
      bytesRead: totalBytesRead,
      errorCount: totalErrors,
      truncated: discovered.truncated || scanTruncated,
      truncationReasons: [...new Set(truncationReasons)],
    },
    records,
    quarantine: {
      unknownOwnershipCandidateIds,
      duplicateContentGroups,
    },
    notes: [
      "read-only-stdout-only",
      "ownershipStatus defaults to unknown — P0-b classifier required for proved ownership",
      "no ownership inference from mtime or filename equality",
    ],
  };
}
