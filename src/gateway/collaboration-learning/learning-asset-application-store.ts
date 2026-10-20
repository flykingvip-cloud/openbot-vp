/**
 * 学习资产「实际应用次数」计数（更强的复用信号）。
 *
 * `AgentLearningAsset` 被促成(promote)后会在协作会话构建提示词时被「应用」（读入 bot 运行时，
 * 见 collaboration-capability-context.ts）。本存储在每次应用时对相关资产计数，得到「实际被复用」
 * 的真实强度——比"已批准 deliverable 计数"更能反映知识是否真的被反复使用。
 *
 * 存于组 runtime 目录（`{groupDir}/runtime/learning-asset-applications.json`），locked + 原子写，
 * 供并发协作回复安全增量（尽力计数：极端并发下丢失个别增量可接受）。
 */

import path from "node:path";
import type { AgentLearningAsset, GroupMemoryCapsule } from "@openbot/collaboration-core";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { resolveGroupCollaborationPaths } from "./collaboration-paths.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export const LEARNING_ASSET_APPLICATIONS_FILENAME = "runtime/learning-asset-applications.json";

export type LearningAssetApplicationCounts = {
  counts: Record<string, number>;
  updatedAtMs: number;
};

function resolveApplicationsPath(groupId: string): string {
  const paths = resolveGroupCollaborationPaths(groupId);
  return path.join(paths.groupDir, "runtime", "learning-asset-applications.json");
}

const lock = createAsyncLock();

/** 纯函数：应用次数表中的最大值 = 复用强度信号。 */
export function maxApplicationCount(counts: Record<string, number>): number {
  let max = 0;
  for (const value of Object.values(counts)) {
    if (typeof value === "number" && Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
}

/** 读取某组的资产应用次数表。 */
export async function readLearningAssetApplicationCounts(
  groupId: string,
): Promise<Record<string, number>> {
  const stored = await readJsonFile<LearningAssetApplicationCounts>(
    resolveApplicationsPath(groupId),
  );
  return stored?.counts ?? {};
}

/** 增量记录一批资产被应用一次（locked read-modify-write）。 */
export async function recordLearningAssetApplications(
  groupId: string,
  assetIds: string[],
): Promise<void> {
  const ids = [...new Set(assetIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length === 0) {
    return;
  }
  const filePath = resolveApplicationsPath(groupId);
  await lock(async () => {
    const stored = (await readJsonFile<LearningAssetApplicationCounts>(filePath)) ?? {
      counts: {},
      updatedAtMs: 0,
    };
    for (const id of ids) {
      stored.counts[id] = (stored.counts[id] ?? 0) + 1;
    }
    stored.updatedAtMs = Date.now();
    await writeJsonAtomic(filePath, stored);
  });
}

/** 读取某 bot 的活跃学习资产 id 并记录一次应用（在协作提示词构建时调用）。 */
export async function recordLearningAssetApplicationsForBot(
  groupId: string,
  botId: string,
): Promise<void> {
  const g = groupId.trim();
  const b = botId.trim();
  if (!g || !b) {
    return;
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const assets = await learningStorage.readLearningAssets(g, b);
  const activeIds = assets
    .filter((asset) => asset.status === undefined || asset.status === "active")
    .map((asset) => asset.assetId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  await recordLearningAssetApplications(g, activeIds);
}

/** Fire-and-forget 包裹（协作提示词热路径调用，绝不抛出/阻塞）。 */
export async function recordLearningAssetApplicationsForBotSafely(
  groupId: string,
  botId: string,
): Promise<void> {
  try {
    await recordLearningAssetApplicationsForBot(groupId, botId);
  } catch {
    // 尽力计数：失败静默忽略。
  }
}

/** 群组学习复用强度：活跃资产被实际应用的最大次数（供 pattern 策展作为更强 reuse 信号）。 */
export async function resolveGroupLearningReuse(groupId: string): Promise<number> {
  const g = groupId.trim();
  if (!g) {
    return 0;
  }
  return maxApplicationCount(await readLearningAssetApplicationCounts(g));
}

/**
 * 把复用信号细化到 pattern 的具体来源：选出与给定 deliverable 相关的学习资产 id。
 * 链路：capsule.sourceIds ∩ deliverableIds → 相关 capsuleId；asset.sourceCapsuleId ∈ 那些 capsuleId → assetId。
 * 纯函数，便于单测。
 */
export function selectAssetIdsForDeliverables(
  capsules: GroupMemoryCapsule[],
  assets: AgentLearningAsset[],
  deliverableIds: Iterable<string>,
): string[] {
  const targets = new Set([...deliverableIds].map((id) => id.trim()).filter((id) => id.length > 0));
  if (targets.size === 0) {
    return [];
  }
  const relatedCapsuleIds = new Set<string>();
  for (const capsule of capsules) {
    if ((capsule.sourceIds ?? []).some((id) => typeof id === "string" && targets.has(id.trim()))) {
      relatedCapsuleIds.add(capsule.capsuleId);
    }
  }
  if (relatedCapsuleIds.size === 0) {
    return [];
  }
  const assetIds = new Set<string>();
  for (const asset of assets) {
    if (asset.sourceCapsuleId && relatedCapsuleIds.has(asset.sourceCapsuleId)) {
      assetIds.add(asset.assetId);
    }
  }
  return [...assetIds];
}

/** 给定资产 id 集合，返回其应用次数最大值（pure）。 */
export function maxApplicationCountFor(counts: Record<string, number>, assetIds: string[]): number {
  let max = 0;
  for (const id of assetIds) {
    const value = counts[id];
    if (typeof value === "number" && Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
}

/**
 * 针对特定 deliverable（同 lineage）相关学习资产的应用强度：把 pattern 策展的复用信号细化到具体来源，
 * 而非全组最大值。用于评审收尾对 approve→pattern 的 reuseCount 判定。
 */
export async function resolveLearningReuseForDeliverables(
  groupId: string,
  deliverableIds: string[],
): Promise<number> {
  const g = groupId.trim();
  if (!g || deliverableIds.length === 0) {
    return 0;
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const [capsules, assets, counts] = await Promise.all([
    learningStorage.readCapsules(g),
    learningStorage.readLearningAssets(g),
    readLearningAssetApplicationCounts(g),
  ]);
  const assetIds = selectAssetIdsForDeliverables(capsules, assets, deliverableIds);
  return maxApplicationCountFor(counts, assetIds);
}
