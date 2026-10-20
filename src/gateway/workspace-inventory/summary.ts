import crypto from "node:crypto";
import type {
  WorkspaceInventoryRecord,
  WorkspaceInventoryReport,
  WorkspaceInventorySummary,
} from "./types.js";
import { WORKSPACE_INVENTORY_SUMMARY_SCHEMA } from "./types.js";

export const SUMMARY_SHA256_ALGORITHM =
  "UTF-8 bytes of JSON.stringify(summaryWithoutSha, null, 2) + '\\n' where summaryWithoutSha omits summarySha256; Node JSON key insertion order as produced by this module.";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function redactRef(value: string | null, placeholder: string): string | null {
  if (!value) {
    return null;
  }
  return placeholder;
}

function redactCandidateId(candidateId: string): string {
  const [rootClass, ...rest] = candidateId.split(":");
  if (rest.length === 0) {
    return rootClass;
  }
  return `${rootClass}:${rest.map((part) => sha256Hex(part).slice(0, 8)).join(":")}`;
}

export function redactInventoryRecord(
  record: WorkspaceInventoryRecord,
): WorkspaceInventorySummary["records"][number] {
  return {
    candidateId: redactCandidateId(record.candidateId),
    normalizedRootClass: record.normalizedRootClass,
    durabilityClass: record.durabilityClass,
    tenantRef: redactRef(record.tenantRef, "<tenant>"),
    ownerRef: redactRef(record.ownerRef, "<user>"),
    agentId: record.agentId ? "<agent>" : null,
    agentAssetId: record.agentAssetId ? "<agent-asset>" : null,
    groupId: record.groupId ? "<group>" : null,
    ownershipStatus: record.ownershipStatus,
    bindingRole: record.bindingRole,
    fileCount: record.fileCount,
    byteCount: record.byteCount,
    contentDigest: record.contentDigest,
    truncated: record.truncated,
    errors: record.errors.map((e) => e.replace(/\/[^\s]+/g, "{path}")),
  };
}

export function stripSummarySha(
  summary: WorkspaceInventorySummary,
): Omit<WorkspaceInventorySummary, "summarySha256"> {
  const clone = { ...summary };
  delete (clone as { summarySha256?: string }).summarySha256;
  return clone;
}

export function toRedactedInventorySummary(
  report: WorkspaceInventoryReport,
  evidenceId: string,
): WorkspaceInventorySummary {
  const summaryWithoutRecords = {
    schema: WORKSPACE_INVENTORY_SUMMARY_SCHEMA,
    evidenceId,
    inventoryUtc: report.inventoryUtc,
    classification: "controlled-audit-desensitized" as const,
    limits: report.limits,
    stats: report.stats,
    quarantine: {
      unknownOwnershipCandidateIds:
        report.quarantine.unknownOwnershipCandidateIds.map(redactCandidateId),
      duplicateContentGroups: report.quarantine.duplicateContentGroups.map((group) => ({
        contentDigest: group.contentDigest,
        candidateIds: group.candidateIds.map(redactCandidateId),
      })),
    },
    summarySha256Algorithm: SUMMARY_SHA256_ALGORITHM,
  };

  const records = report.records.map(redactInventoryRecord);
  const bodyObj = { ...summaryWithoutRecords, records };
  const body = `${JSON.stringify(bodyObj, null, 2)}\n`;
  return {
    ...bodyObj,
    summarySha256: sha256Hex(body),
  };
}

export function verifySummarySha256(summary: WorkspaceInventorySummary): boolean {
  const stripped = stripSummarySha(summary);
  const body = `${JSON.stringify(stripped, null, 2)}\n`;
  return summary.summarySha256 === sha256Hex(body);
}
