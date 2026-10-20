import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  listAgentAssetManifests,
  listManifestMutations,
  readAgentAssetManifestPointer,
} from "./agent-asset-manifest-store.js";
import {
  listAnchorMutations,
  listHumanVerifiedAnchors,
  readAnchorPointer,
} from "./cognitive-anchor-store.js";
import { writeJsonDurable } from "./cognitive-file-lock.js";
import { resolveCognitiveRecoveryRecordRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type { PointerMutationReceipt } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type PointerOrphanReclamationResult = {
  annotated: string[];
  skipped: string[];
};

function isTerminal(status: PointerMutationReceipt["status"]): boolean {
  return status === "applied" || status === "conflicted" || status === "failed";
}

function appendOrphanRecord(params: {
  stateDir: string;
  partition: string;
  historyRowId: string;
  resourceKey: string;
  kindScope: string;
  now: Date;
}): void {
  const recoveryId = assertSafeRecoveryReceiptToken(`rec-${randomUUID()}`, "operationId");
  const dest = path.resolve(
    resolveCognitiveRecoveryRecordRoot(params.stateDir),
    params.partition,
    `${recoveryId}.json`,
  );
  writeJsonDurable(dest, {
    kind: "cognitive_recovery_record",
    outcome: "orphaned_unreferenced",
    historyRowId: params.historyRowId,
    resourceKey: params.resourceKey,
    kindScope: params.kindScope,
    createdAt: params.now.toISOString(),
  });
}

/**
 * §3.6.2: annotate unreferenced manifest history rows. Never mutates or deletes the row.
 * prepared receipts are never reclaimed. No fencing token is consulted (B37).
 */
export async function reclaimManifestPointerOrphans(params: {
  agentAssetId: string;
  stateDir: string;
  now?: Date;
  ttlMs?: number;
}): Promise<PointerOrphanReclamationResult> {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  const pointer = readAgentAssetManifestPointer({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
  });
  const mutations = listManifestMutations({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
  });
  const byHistory = new Map<string, PointerMutationReceipt[]>();
  for (const receipt of mutations) {
    const list = byHistory.get(receipt.historyRowId) ?? [];
    list.push(receipt);
    byHistory.set(receipt.historyRowId, list);
  }
  const annotated: string[] = [];
  const skipped: string[] = [];
  const manifests = listAgentAssetManifests({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
  });
  for (const manifest of manifests) {
    const receipts = byHistory.get(manifest.manifestId) ?? [];
    if (receipts.some((item) => item.status === "prepared")) {
      skipped.push(manifest.manifestId);
      continue;
    }
    const terminal = receipts.filter((item) => isTerminal(item.status));
    if (terminal.length === 0) {
      skipped.push(manifest.manifestId);
      continue;
    }
    const reclaimable = terminal.some((receipt) => {
      if (Date.parse(receipt.createdAt) > now.getTime() - ttlMs) {
        return false;
      }
      if (pointer) {
        if (pointer.lastMutationId === receipt.mutationId) {
          return false;
        }
        if (pointer.pointerVersion < receipt.expectedPointerVersion) {
          return false;
        }
        if (pointer.activeManifestId === receipt.historyRowId) {
          return false;
        }
      }
      return true;
    });
    if (!reclaimable || pointer?.activeManifestId === manifest.manifestId) {
      skipped.push(manifest.manifestId);
      continue;
    }
    appendOrphanRecord({
      stateDir: params.stateDir,
      partition: params.agentAssetId,
      historyRowId: manifest.manifestId,
      resourceKey: params.agentAssetId,
      kindScope: "agent_asset_manifest",
      now,
    });
    annotated.push(manifest.manifestId);
  }
  return { annotated, skipped };
}

/**
 * §3.6.2 for anchors. A tombstone references both revokedAnchorId and revocationRowId,
 * so neither is an orphan (B41).
 */
export async function reclaimAnchorPointerOrphans(params: {
  resourceId: string;
  stateDir: string;
  now?: Date;
  ttlMs?: number;
}): Promise<PointerOrphanReclamationResult> {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  const pointer = readAnchorPointer({
    resourceId: params.resourceId,
    stateDir: params.stateDir,
  });
  const protectedIds = new Set<string>();
  if (pointer?.activeAnchorId) {
    protectedIds.add(pointer.activeAnchorId);
  }
  if (pointer?.revokedAnchorId) {
    protectedIds.add(pointer.revokedAnchorId);
  }
  if (pointer?.revocationRowId) {
    protectedIds.add(pointer.revocationRowId);
  }
  const mutations = listAnchorMutations({
    resourceId: params.resourceId,
    stateDir: params.stateDir,
  });
  const byHistory = new Map<string, PointerMutationReceipt[]>();
  for (const receipt of mutations) {
    const list = byHistory.get(receipt.historyRowId) ?? [];
    list.push(receipt);
    byHistory.set(receipt.historyRowId, list);
  }
  const annotated: string[] = [];
  const skipped: string[] = [];
  for (const row of listHumanVerifiedAnchors({
    resourceId: params.resourceId,
    stateDir: params.stateDir,
  })) {
    if (protectedIds.has(row.anchorId)) {
      skipped.push(row.anchorId);
      continue;
    }
    const receipts = byHistory.get(row.anchorId) ?? [];
    if (receipts.some((item) => item.status === "prepared")) {
      skipped.push(row.anchorId);
      continue;
    }
    const terminal = receipts.filter((item) => isTerminal(item.status));
    if (terminal.length === 0) {
      skipped.push(row.anchorId);
      continue;
    }
    const reclaimable = terminal.some((receipt) => {
      if (Date.parse(receipt.createdAt) > now.getTime() - ttlMs) {
        return false;
      }
      if (pointer) {
        if (pointer.lastMutationId === receipt.mutationId) {
          return false;
        }
        if (pointer.pointerVersion < receipt.expectedPointerVersion) {
          return false;
        }
      }
      return true;
    });
    if (!reclaimable) {
      skipped.push(row.anchorId);
      continue;
    }
    appendOrphanRecord({
      stateDir: params.stateDir,
      partition: params.resourceId,
      historyRowId: row.anchorId,
      resourceKey: params.resourceId,
      kindScope: "human_verified_anchor",
      now,
    });
    annotated.push(row.anchorId);
  }
  return { annotated, skipped };
}
