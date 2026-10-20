import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createGovernanceTask } from "../chunk-governance-store.js";
import {
  assignClaimConflictGroup,
  insertClaimRelation,
  listClaimsByKb,
} from "../claims/claim-store.js";

export type ClaimConflictDetectionResult = {
  conflictGroups: number;
  relationsCreated: number;
  tasksCreated: number;
};

import { claimValuesConflict, normalizeClaimObjectValue } from "../claims/claim-value-normalize.js";

function hasOpenClaimConflictTask(db: DatabaseSync, kbId: string, claimIds: string[]): boolean {
  const rows = db
    .prepare(
      `SELECT proposed_resolution FROM governance_tasks
       WHERE kb_id = ? AND task_type = 'claim_conflict' AND status = 'open'`,
    )
    .all(kbId) as Array<{ proposed_resolution: string | null }>;
  const key = claimIds.toSorted().join(":");
  for (const row of rows) {
    if (!row.proposed_resolution) {
      continue;
    }
    try {
      const parsed = JSON.parse(row.proposed_resolution) as { claimIds?: string[] };
      const existing = Array.isArray(parsed.claimIds) ? parsed.claimIds.toSorted().join(":") : "";
      if (existing === key) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function runClaimConflictDetection(params: {
  db: DatabaseSync;
  kbId: string;
}): ClaimConflictDetectionResult {
  const claims = listClaimsByKb({ db: params.db, kbId: params.kbId, limit: 500 });
  const byKey = new Map<string, typeof claims>();
  for (const claim of claims) {
    if (claim.governanceStatus === "suppressed") {
      continue;
    }
    const bucket = byKey.get(claim.normalizedKey) ?? [];
    bucket.push(claim);
    byKey.set(claim.normalizedKey, bucket);
  }

  let conflictGroups = 0;
  let relationsCreated = 0;
  let tasksCreated = 0;
  const reported = new Set<string>();

  for (const group of byKey.values()) {
    if (group.length < 2) {
      continue;
    }
    const distinctValues = [
      ...new Set(group.map((claim) => normalizeClaimObjectValue(claim.objectValue))),
    ];
    if (distinctValues.length < 2) {
      continue;
    }
    const conflicting = group.filter((claim, index, arr) =>
      arr.some(
        (other) =>
          other.id !== claim.id && claimValuesConflict(claim.objectValue, other.objectValue),
      ),
    );
    if (conflicting.length < 2) {
      continue;
    }
    const claimIds = conflicting.map((claim) => claim.id).toSorted();
    const reportKey = claimIds.join(":");
    if (reported.has(reportKey)) {
      continue;
    }
    reported.add(reportKey);
    const groupId = randomUUID();
    assignClaimConflictGroup({
      db: params.db,
      kbId: params.kbId,
      claimIds,
      conflictGroupId: groupId,
    });
    if (!hasOpenClaimConflictTask(params.db, params.kbId, claimIds)) {
      createGovernanceTask({
        db: params.db,
        kbId: params.kbId,
        taskType: "claim_conflict",
        relatedChunkIds: [...new Set(conflicting.map((claim) => claim.chunkId))],
        priority: 25,
        proposedResolution: {
          action: "review_claim_conflict",
          claimIds,
          normalizedKey: conflicting[0]?.normalizedKey,
          subject: conflicting[0]?.subject,
          conflictGroupId: groupId,
          values: group.map((claim) => claim.objectValue),
          // Aligned candidate truth options (claimId ↔ value ↔ chunk) so the product
          // surface can render selectable canonical-truth choices instead of guessing
          // which sorted claim is correct.
          candidates: claimIds.map((id) => {
            const match = conflicting.find((claim) => claim.id === id);
            return {
              claimId: id,
              value: match?.objectValue ?? "",
              chunkId: match?.chunkId ?? "",
              claimText: match?.claimText ?? "",
            };
          }),
        },
      });
      tasksCreated += 1;
    }
    conflictGroups += 1;
    for (let i = 0; i < claimIds.length; i += 1) {
      for (let j = i + 1; j < claimIds.length; j += 1) {
        insertClaimRelation({
          db: params.db,
          kbId: params.kbId,
          fromClaim: claimIds[i],
          toClaim: claimIds[j],
          relationType: "conflict",
          weight: 0.9,
        });
        relationsCreated += 1;
      }
    }
  }

  return { conflictGroups, relationsCreated, tasksCreated };
}
