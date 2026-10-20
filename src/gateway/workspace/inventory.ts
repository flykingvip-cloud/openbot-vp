/**
 * P0-a read-only workspace inventory (bounds, containment, redaction).
 * Does not write, migrate, or infer ownership from mtime/filename equality.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { WorkspaceInventoryRecord } from "./types.js";

export type InventoryCandidate = {
  candidateId: string;
  absoluteRoot: string;
  normalizedRootClass: string;
  tenantRef?: string | null;
  ownerRef?: string | null;
  agentId?: string | null;
  agentAssetId?: string | null;
  groupId?: string | null;
  ownershipStatus?: WorkspaceInventoryRecord["ownershipStatus"];
  bindingRole?: WorkspaceInventoryRecord["bindingRole"];
};

export type InventoryLimits = {
  maxFiles: number;
  maxDepth: number;
  maxBytesRead: number;
};

export const DEFAULT_INVENTORY_LIMITS: InventoryLimits = {
  maxFiles: 20_000,
  maxDepth: 24,
  maxBytesRead: 256 * 1024 * 1024,
};

export function requireSafeSegment(name: string, value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`${name} must be one safe path segment`);
  }
  return trimmed;
}

export function resolveContained(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("path escapes containment root");
  }
  return resolved;
}

function walkFiles(
  root: string,
  limits: InventoryLimits,
): { files: string[]; byteCount: number; truncated: boolean; errors: string[] } {
  const files: string[] = [];
  let byteCount = 0;
  let truncated = false;
  const errors: string[] = [];

  const visit = (dir: string, depth: number) => {
    if (truncated || depth > limits.maxDepth) {
      if (depth > limits.maxDepth) {
        truncated = true;
      }
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      errors.push(`readdir_failed:${path.basename(dir)}`);
      return;
    }
    for (const entry of entries) {
      if (truncated) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push(`symlink_skipped:${entry.name}`);
        continue;
      }
      if (entry.isDirectory()) {
        visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      try {
        const stat = fs.statSync(full);
        byteCount += stat.size;
        if (byteCount > limits.maxBytesRead) {
          truncated = true;
          return;
        }
        files.push(full);
      } catch {
        errors.push(`stat_failed:${entry.name}`);
      }
    }
  };

  visit(root, 0);
  return { files, byteCount, truncated, errors };
}

function digestFiles(files: string[], maxHashBytes: number): string | null {
  if (files.length === 0) {
    return crypto.createHash("sha256").update("").digest("hex");
  }
  const hash = crypto.createHash("sha256");
  let hashed = 0;
  const sorted = [...files].toSorted();
  for (const file of sorted) {
    const rel = path.basename(file);
    hash.update(rel);
    hash.update("\0");
    try {
      const buf = fs.readFileSync(file);
      const slice = buf.subarray(0, Math.min(buf.length, maxHashBytes - hashed));
      hash.update(slice);
      hashed += slice.length;
      if (hashed >= maxHashBytes) {
        break;
      }
    } catch {
      hash.update("UNREADABLE");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function inventoryCandidate(
  candidate: InventoryCandidate,
  containmentRoot: string,
  limits: InventoryLimits = DEFAULT_INVENTORY_LIMITS,
): WorkspaceInventoryRecord {
  const errors: string[] = [];
  let absoluteRoot: string;
  try {
    absoluteRoot = resolveContained(containmentRoot, candidate.absoluteRoot);
  } catch {
    return {
      candidateId: candidate.candidateId,
      normalizedRootClass: candidate.normalizedRootClass,
      tenantRef: candidate.tenantRef ?? null,
      ownerRef: candidate.ownerRef ?? null,
      agentId: candidate.agentId ?? null,
      agentAssetId: candidate.agentAssetId ?? null,
      groupId: candidate.groupId ?? null,
      ownershipStatus: candidate.ownershipStatus ?? "unknown",
      bindingRole: candidate.bindingRole ?? "unknown",
      fileCount: 0,
      byteCount: 0,
      contentDigest: null,
      truncated: false,
      errors: ["containment_violation"],
    };
  }

  if (!fs.existsSync(absoluteRoot)) {
    return {
      candidateId: candidate.candidateId,
      normalizedRootClass: candidate.normalizedRootClass,
      tenantRef: candidate.tenantRef ?? null,
      ownerRef: candidate.ownerRef ?? null,
      agentId: candidate.agentId ?? null,
      agentAssetId: candidate.agentAssetId ?? null,
      groupId: candidate.groupId ?? null,
      ownershipStatus: candidate.ownershipStatus ?? "unknown",
      bindingRole: candidate.bindingRole ?? "unknown",
      fileCount: 0,
      byteCount: 0,
      contentDigest: null,
      truncated: false,
      errors: ["missing_root"],
    };
  }

  const walked = walkFiles(absoluteRoot, limits);
  errors.push(...walked.errors);
  const contentDigest = digestFiles(walked.files, limits.maxBytesRead);

  return {
    candidateId: candidate.candidateId,
    normalizedRootClass: candidate.normalizedRootClass,
    tenantRef: candidate.tenantRef ?? null,
    ownerRef: candidate.ownerRef ?? null,
    agentId: candidate.agentId ?? null,
    agentAssetId: candidate.agentAssetId ?? null,
    groupId: candidate.groupId ?? null,
    ownershipStatus: candidate.ownershipStatus ?? "unknown",
    bindingRole: candidate.bindingRole ?? "unknown",
    fileCount: walked.files.length,
    byteCount: walked.byteCount,
    contentDigest,
    truncated: walked.truncated,
    errors,
  };
}

export function redactInventoryRecord(record: WorkspaceInventoryRecord): WorkspaceInventoryRecord {
  const redact = (value: string | null): string | null => {
    if (!value) {
      return value;
    }
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
  };
  return {
    ...record,
    tenantRef: redact(record.tenantRef),
    ownerRef: redact(record.ownerRef),
    agentId: record.agentId ? `agent:${redact(record.agentId)}` : null,
    agentAssetId: record.agentAssetId ? `asset:${redact(record.agentAssetId)}` : null,
    groupId: record.groupId ? `group:${redact(record.groupId)}` : null,
  };
}

export function deriveInventorySummary(records: WorkspaceInventoryRecord[]): {
  schema: string;
  recordCount: number;
  unknownOwnership: number;
  conflictOwnership: number;
  duplicateDigests: number;
  summarySha256: string;
} {
  const unknownOwnership = records.filter((r) => r.ownershipStatus === "unknown").length;
  const conflictOwnership = records.filter((r) => r.ownershipStatus === "conflict").length;
  const digestCounts = new Map<string, number>();
  for (const record of records) {
    if (!record.contentDigest) {
      continue;
    }
    digestCounts.set(record.contentDigest, (digestCounts.get(record.contentDigest) ?? 0) + 1);
  }
  let duplicateDigests = 0;
  for (const count of digestCounts.values()) {
    if (count > 1) {
      duplicateDigests += 1;
    }
  }
  const payload = {
    schema: "workspace-inventory-summary/v1",
    recordCount: records.length,
    unknownOwnership,
    conflictOwnership,
    duplicateDigests,
    records: records.map((r) => ({
      candidateId: r.candidateId,
      normalizedRootClass: r.normalizedRootClass,
      ownershipStatus: r.ownershipStatus,
      bindingRole: r.bindingRole,
      fileCount: r.fileCount,
      byteCount: r.byteCount,
      contentDigest: r.contentDigest,
      truncated: r.truncated,
      errors: r.errors,
    })),
  };
  const summarySha256 = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    schema: payload.schema,
    recordCount: payload.recordCount,
    unknownOwnership,
    conflictOwnership,
    duplicateDigests,
    summarySha256,
  };
}

export function listUnknownOwnershipQuarantine(
  records: WorkspaceInventoryRecord[],
): WorkspaceInventoryRecord[] {
  return records.filter(
    (record) => record.ownershipStatus === "unknown" || record.ownershipStatus === "conflict",
  );
}
