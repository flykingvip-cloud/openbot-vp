/**
 * Experience outcome_verified counts keyed by stable contributionKey.
 * Key registry is the source of truth; asset counts are reconciled from applied keys.
 * Lives under task-outcome (askOutcome stream) — not a second learning ledger.
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveOutcomeVerifiedCount,
  withLearningAssetLock,
} from "../auto-reply/reply/learning-recall.js";
import {
  createWorkspaceCollaborationStores,
  resolveGroupStoreFilePath,
} from "../gateway/collaboration-learning/shared.js";

/** Production omits this and createWorkspaceCollaborationStores() calls loadConfig(). */
export type OutcomeVerifiedCollaborationStores = Pick<
  ReturnType<typeof createWorkspaceCollaborationStores>,
  "groupRootDir" | "learningStorage"
>;

export const OUTCOME_VERIFIED_CONTRIBUTION_KEYS_FILENAME =
  "outcome-verified-contribution-keys.json";

export type OutcomeVerifiedContributionKeyStatus = "applied" | "revoked";

export type OutcomeVerifiedContributionKeyEntry = {
  status: OutcomeVerifiedContributionKeyStatus;
  assetIds: string[];
  updatedAt: number;
};

type OutcomeVerifiedContributionKeyRegistry = {
  keys: Record<string, OutcomeVerifiedContributionKeyEntry>;
};

function resolveStores(
  stores?: OutcomeVerifiedCollaborationStores,
): OutcomeVerifiedCollaborationStores {
  return stores ?? createWorkspaceCollaborationStores();
}

function contributionKeysPath(
  scopeId: string,
  stores?: OutcomeVerifiedCollaborationStores,
): string {
  const { groupRootDir } = resolveStores(stores);
  return resolveGroupStoreFilePath({
    groupRootDir,
    groupId: scopeId.trim(),
    filename: OUTCOME_VERIFIED_CONTRIBUTION_KEYS_FILENAME,
  });
}

function readContributionKeyRegistry(
  scopeId: string,
  stores?: OutcomeVerifiedCollaborationStores,
): OutcomeVerifiedContributionKeyRegistry {
  const filePath = contributionKeysPath(scopeId, stores);
  try {
    if (!fs.existsSync(filePath)) {
      return { keys: {} };
    }
    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<OutcomeVerifiedContributionKeyRegistry>;
    return { keys: raw.keys && typeof raw.keys === "object" ? raw.keys : {} };
  } catch {
    return { keys: {} };
  }
}

function writeContributionKeyRegistry(
  scopeId: string,
  registry: OutcomeVerifiedContributionKeyRegistry,
  stores?: OutcomeVerifiedCollaborationStores,
): void {
  const filePath = contributionKeysPath(scopeId, stores);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

async function reconcileOutcomeVerifiedCountsFromKeys(
  scopeId: string,
  registry: OutcomeVerifiedContributionKeyRegistry,
  atMs: number,
  stores?: OutcomeVerifiedCollaborationStores,
): Promise<string[]> {
  const { learningStorage } = resolveStores(stores);
  const assets = await learningStorage.readLearningAssets(scopeId);
  if (assets.length === 0) {
    return [];
  }
  const counts = new Map<string, number>();
  const mentioned = new Set<string>();
  for (const entry of Object.values(registry.keys)) {
    for (const assetId of entry.assetIds) {
      mentioned.add(assetId);
      if (entry.status === "applied") {
        counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
      }
    }
  }
  const touched: string[] = [];
  const next = assets.map((asset) => {
    if (!mentioned.has(asset.assetId)) {
      return asset;
    }
    const nextCount = counts.get(asset.assetId) ?? 0;
    if (resolveOutcomeVerifiedCount(asset) === nextCount) {
      return asset;
    }
    touched.push(asset.assetId);
    return {
      ...asset,
      outcomeVerifiedCount: nextCount,
      ...(nextCount > 0 ? { lastOutcomeVerifiedAt: atMs } : {}),
      updatedAt: atMs,
    };
  });
  await learningStorage.writeLearningAssets(scopeId, next);
  return touched;
}

/**
 * Idempotent outcome_verified bump keyed by stable contributionKey.
 * Replay / crash recovery yields exact counts (key registry is source of truth).
 */
export async function applyOutcomeVerifiedContributionKey(params: {
  contributionKey: string;
  scopeId: string;
  assetIds: string[];
  atMs?: number;
  stores?: OutcomeVerifiedCollaborationStores;
}): Promise<{ applied: boolean; verifiedAssetIds: string[] }> {
  const contributionKey = params.contributionKey.trim();
  const scopeId = params.scopeId.trim();
  const assetIds = [...new Set(params.assetIds.map((id) => id.trim()).filter(Boolean))];
  if (!contributionKey || !scopeId || assetIds.length === 0) {
    return { applied: false, verifiedAssetIds: [] };
  }
  return withLearningAssetLock(
    scopeId,
    async () => {
      const registry = readContributionKeyRegistry(scopeId, params.stores);
      const prev = registry.keys[contributionKey];
      const already = prev?.status === "applied";
      const now = params.atMs ?? Date.now();
      if (!already) {
        registry.keys[contributionKey] = {
          status: "applied",
          assetIds,
          updatedAt: now,
        };
        writeContributionKeyRegistry(scopeId, registry, params.stores);
      }
      await reconcileOutcomeVerifiedCountsFromKeys(scopeId, registry, now, params.stores);
      return {
        applied: !already,
        verifiedAssetIds: assetIds,
      };
    },
    params.stores?.groupRootDir,
  );
}

/**
 * Idempotent revoke for a prior contributionKey.
 * Marks key revoked then reconciles absolute counts from remaining applied keys.
 */
export async function revokeOutcomeVerifiedContributionKey(params: {
  contributionKey: string;
  scopeId: string;
  assetIds?: string[];
  atMs?: number;
  stores?: OutcomeVerifiedCollaborationStores;
}): Promise<{ revoked: boolean; assetIds: string[] }> {
  const contributionKey = params.contributionKey.trim();
  const scopeId = params.scopeId.trim();
  if (!contributionKey || !scopeId) {
    return { revoked: false, assetIds: [] };
  }
  return withLearningAssetLock(
    scopeId,
    async () => {
      const registry = readContributionKeyRegistry(scopeId, params.stores);
      const prev = registry.keys[contributionKey];
      const now = params.atMs ?? Date.now();
      if (!prev || prev.status !== "applied") {
        await reconcileOutcomeVerifiedCountsFromKeys(scopeId, registry, now, params.stores);
        return { revoked: false, assetIds: prev?.assetIds ?? [] };
      }
      const assetIds =
        params.assetIds && params.assetIds.length > 0
          ? [...new Set(params.assetIds.map((id) => id.trim()).filter(Boolean))]
          : [...prev.assetIds];
      registry.keys[contributionKey] = {
        status: "revoked",
        assetIds,
        updatedAt: now,
      };
      writeContributionKeyRegistry(scopeId, registry, params.stores);
      await reconcileOutcomeVerifiedCountsFromKeys(scopeId, registry, now, params.stores);
      return { revoked: true, assetIds };
    },
    params.stores?.groupRootDir,
  );
}
