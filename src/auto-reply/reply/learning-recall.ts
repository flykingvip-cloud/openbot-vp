/**
 * 学习资产回流（recall）—— 把已晋升的学习资产真正读回到系统提示词。
 *
 * 背景：`capsule → projection → asset` 的写入链路早已打通，但读回侧只提取
 * `abstractedContent.capabilities` / `metadata.skills`（能力名字符串），而写入侧从不
 * 产出这两个键，于是每一条经验都"写得进、读不出"——教训永远不会回到行为里。
 *
 * 本模块补上真正的读回，并（W4）分离经验有效性四段指标：
 *  - retrieved：从存储读出
 *  - injected：真正进入系统提示词（曝光；≠ 有效复用）
 *  - adopted：有明确采用信号（注入 alone 不算）
 *  - outcome_verified：closed+eligible **且**有采用证据的资产才计（共现≠有效）
 * 策展阈值只认 outcome_verified，不认提示词曝光，也不认「成功任务中的曝光」。
 */

import type { AgentLearningAsset } from "@openbot/collaboration-core";
import {
  createWorkspaceCollaborationStores,
  resolveGroupStoreFilePath,
} from "../../gateway/collaboration-learning/shared.js";
import { logVerbose } from "../../globals.js";
import { withFileLock } from "../../infra/file-lock.js";
import { createAsyncLock } from "../../infra/json-files.js";

/** W4: experience validity stages (exposure ≠ verified). */
export type LearningExperienceStage = "retrieved" | "injected" | "adopted" | "outcome_verified";

/** 单条可复述的经验。 */
export type LearningRecallEntry = {
  assetId: string;
  assetType: NonNullable<AgentLearningAsset["assetType"]>;
  /** 人类可读的一句话教训（已由晋升侧构造）。 */
  lesson: string;
  confidence: NonNullable<AgentLearningAsset["confidence"]>;
  /**
   * @deprecated W4: legacy exposure alias (= injectedCount ?? reuseCount).
   * Prompt copy should say 曝光, not 复用.
   */
  reuseCount: number;
  /** W4: prompt-injection exposure count. */
  injectedCount: number;
  /** W4: TaskOutcome-verified effective reuse count. */
  outcomeVerifiedCount: number;
  isAntiPattern: boolean;
};

export type LearningRecall = {
  capabilities: string[];
  lessons: LearningRecallEntry[];
};

export const EMPTY_LEARNING_RECALL: LearningRecall = { capabilities: [], lessons: [] };

/** Exposure count: prefer injectedCount, fall back to legacy reuseCount. */
export function resolveInjectedCount(asset: AgentLearningAsset): number {
  if (typeof asset.injectedCount === "number" && Number.isFinite(asset.injectedCount)) {
    return Math.max(0, Math.floor(asset.injectedCount));
  }
  return Math.max(0, Math.floor(asset.reuseCount ?? 0));
}

export function resolveOutcomeVerifiedCount(asset: AgentLearningAsset): number {
  return Math.max(0, Math.floor(asset.outcomeVerifiedCount ?? 0));
}

export function resolveRetrievedCount(asset: AgentLearningAsset): number {
  return Math.max(0, Math.floor(asset.retrievedCount ?? 0));
}

export function resolveAdoptedCount(asset: AgentLearningAsset): number {
  return Math.max(0, Math.floor(asset.adoptedCount ?? 0));
}

/** 单次注入的教训条数上限（控制提示词膨胀）。 */
export const LEARNING_RECALL_LIMIT = 5;

export const LEARNING_ASSETS_FILENAME = "learning-assets.json";

/**
 * 学习资产文件锁的重试/失效参数（对齐仓库既有 store 的写锁惯例）。
 * 复用记账与策展都是毫秒级小写，退避窗口取得比 auth/pairing 更短。
 */
const LEARNING_ASSET_LOCK_OPTIONS = {
  retries: {
    retries: 8,
    factor: 2,
    minTimeout: 25,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 15_000,
} as const;

/** 进程内串行锁，按作用域隔离（不同作用域是不同文件，互不影响）。 */
const inProcessLocks = new Map<string, ReturnType<typeof createAsyncLock>>();

function resolveInProcessLock(scopeId: string): ReturnType<typeof createAsyncLock> {
  const existing = inProcessLocks.get(scopeId);
  if (existing) {
    return existing;
  }
  const created = createAsyncLock();
  inProcessLocks.set(scopeId, created);
  return created;
}

/**
 * 学习资产文件的写序列化锁（**进程内 + 跨进程双层**）。
 *
 * `learning-assets.json` 的更新都是「读 → 改 → 整体写回」，底层适配器只保证单次写
 * 原子，不保证读改写原子。未加锁会丢复用计数，更糟的是策展的 `curatedSkillId` 幂等
 * 标记会被覆盖，导致同一簇重复生成技能草稿。复用记账与策展共用同一把锁，否则两者
 * 之间仍会交错。
 *
 * 为什么必须两层：`withFileLock` 在同一进程内是**可重入**的（按路径引用计数，第二个
 * 并发调用会直接放行），所以它只解决跨进程互斥；进程内互斥仍要靠 `createAsyncLock`。
 * 多个 gateway 实例共享同一 workspace 时，外层文件锁保证互斥；锁文件带 pid + 时间戳，
 * 持有者进程消失或超时即判定为 stale 自动接管，不会因崩溃留下死锁。
 */
export function withLearningAssetLock<T>(scopeId: string, fn: () => Promise<T>): Promise<T> {
  const normalizedScope = scopeId.trim();
  return resolveInProcessLock(normalizedScope)(async () => {
    const { groupRootDir } = createWorkspaceCollaborationStores();
    const filePath = resolveGroupStoreFilePath({
      groupRootDir,
      groupId: normalizedScope,
      filename: LEARNING_ASSETS_FILENAME,
    });
    return await withFileLock(filePath, LEARNING_ASSET_LOCK_OPTIONS, fn);
  });
}

/**
 * 非协作会话（单聊）的伪群作用域。
 *
 * 学习存储是按 groupId 分片的；单聊没有 groupId，若不给个稳定作用域，单聊里的
 * 失败经验就完全无处落盘，也永远回不来。
 */
export function resolvePersonalLearningScopeId(agentId: string): string {
  return `agent:${agentId.trim()}`;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractCapabilitiesFromAsset(asset: AgentLearningAsset): string[] {
  return [
    ...new Set([
      ...readStringList(asset.abstractedContent?.capabilities),
      ...readStringList(asset.metadata?.skills),
    ]),
  ];
}

/** 提取教训正文；兼容 lesson 缺失的历史资产（回落 title/summary）。 */
export function extractLessonFromAsset(asset: AgentLearningAsset): string | null {
  const content = asset.abstractedContent ?? {};
  const lesson = readText(content.lesson);
  if (lesson) {
    return lesson;
  }
  const title = readText(content.title);
  const summary = readText(content.summary);
  const parts = [...new Set([title, summary].filter((part): part is string => Boolean(part)))];
  return parts.length > 0 ? parts.join(" — ") : null;
}

function isActive(asset: AgentLearningAsset): boolean {
  return asset.status === undefined || asset.status === "active";
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** 排序：高置信 → 高曝光(injected) → 新在前。纯函数，便于单测。 */
export function rankLearningAssets(assets: AgentLearningAsset[]): AgentLearningAsset[] {
  return [...assets].toSorted((left, right) => {
    const confidence =
      (CONFIDENCE_RANK[right.confidence ?? "low"] ?? 0) -
      (CONFIDENCE_RANK[left.confidence ?? "low"] ?? 0);
    if (confidence !== 0) {
      return confidence;
    }
    const exposure = resolveInjectedCount(right) - resolveInjectedCount(left);
    if (exposure !== 0) {
      return exposure;
    }
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });
}

/** 由资产列表构造 recall 载荷（纯函数）。 */
export function buildLearningRecall(
  assets: AgentLearningAsset[],
  limit = LEARNING_RECALL_LIMIT,
): LearningRecall {
  const active = assets.filter(isActive);
  const capabilities = [...new Set(active.flatMap(extractCapabilitiesFromAsset))];
  const lessons: LearningRecallEntry[] = [];
  const seenLessons = new Set<string>();
  for (const asset of rankLearningAssets(active)) {
    const lesson = extractLessonFromAsset(asset);
    if (!lesson || seenLessons.has(lesson)) {
      continue;
    }
    seenLessons.add(lesson);
    const injectedCount = resolveInjectedCount(asset);
    lessons.push({
      assetId: asset.assetId,
      assetType: asset.assetType ?? "lesson",
      lesson,
      confidence: asset.confidence ?? "low",
      reuseCount: injectedCount,
      injectedCount,
      outcomeVerifiedCount: resolveOutcomeVerifiedCount(asset),
      isAntiPattern: asset.abstractedContent?.capsuleType === "anti_pattern",
    });
    if (lessons.length >= limit) {
      break;
    }
  }
  return { capabilities, lessons };
}

/** 读取某个 bot 在某个作用域下可复用的学习资产。 */
export async function readLearningRecall(params: {
  scopeId: string;
  botId: string;
  limit?: number;
}): Promise<LearningRecall> {
  const scopeId = params.scopeId.trim();
  const botId = params.botId.trim();
  if (!scopeId || !botId) {
    return EMPTY_LEARNING_RECALL;
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const assets = await learningStorage.readLearningAssets(scopeId, botId);
  return buildLearningRecall(assets, params.limit ?? LEARNING_RECALL_LIMIT);
}

function bumpStageFields(
  asset: AgentLearningAsset,
  stage: LearningExperienceStage,
  now: number,
): AgentLearningAsset {
  switch (stage) {
    case "retrieved":
      return {
        ...asset,
        retrievedCount: resolveRetrievedCount(asset) + 1,
        lastRetrievedAt: now,
        updatedAt: now,
      };
    case "injected": {
      const injectedCount = resolveInjectedCount(asset) + 1;
      return {
        ...asset,
        injectedCount,
        lastInjectedAt: now,
        // Legacy alias stays in sync so old readers still see exposure.
        reuseCount: injectedCount,
        lastReusedAt: now,
        updatedAt: now,
      };
    }
    case "adopted":
      return {
        ...asset,
        adoptedCount: resolveAdoptedCount(asset) + 1,
        lastAdoptedAt: now,
        updatedAt: now,
      };
    case "outcome_verified":
      return {
        ...asset,
        outcomeVerifiedCount: resolveOutcomeVerifiedCount(asset) + 1,
        lastOutcomeVerifiedAt: now,
        updatedAt: now,
      };
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/**
 * W4: record one experience-validity stage for the given assets.
 * Injection/exposure must not be treated as outcome_verified.
 */
export async function recordLearningExperienceStage(params: {
  scopeId: string;
  assetIds: string[];
  stage: LearningExperienceStage;
  atMs?: number;
}): Promise<void> {
  const targets = new Set(params.assetIds.map((id) => id.trim()).filter(Boolean));
  if (targets.size === 0) {
    return;
  }
  await withLearningAssetLock(params.scopeId, async () => {
    const { learningStorage } = createWorkspaceCollaborationStores();
    const assets = await learningStorage.readLearningAssets(params.scopeId);
    if (assets.length === 0) {
      return;
    }
    const now = params.atMs ?? Date.now();
    let changed = false;
    const next = assets.map((asset) => {
      if (!targets.has(asset.assetId)) {
        return asset;
      }
      changed = true;
      return bumpStageFields(asset, params.stage, now);
    });
    if (!changed) {
      return;
    }
    await learningStorage.writeLearningAssets(params.scopeId, next);
  });
}

/**
 * @deprecated W4: alias for stage=`injected` (exposure). Does not mean outcome_verified.
 * Prefer `recordLearningExperienceStage({ stage: "injected" })`.
 */
export async function recordLearningReuse(params: {
  scopeId: string;
  assetIds: string[];
  atMs?: number;
}): Promise<void> {
  await recordLearningExperienceStage({
    scopeId: params.scopeId,
    assetIds: params.assetIds,
    stage: "injected",
    atMs: params.atMs,
  });
}

/**
 * Adjust a stage counter by delta (e.g. -1 to revoke a prior outcome_verified
 * after task.corrected). Propagates failures — for business paths only.
 */
export async function adjustLearningExperienceStage(params: {
  scopeId: string;
  assetIds: string[];
  stage: LearningExperienceStage;
  delta: number;
  atMs?: number;
}): Promise<void> {
  const delta = Math.trunc(params.delta);
  if (delta === 0) {
    return;
  }
  const targets = new Set(params.assetIds.map((id) => id.trim()).filter(Boolean));
  if (targets.size === 0) {
    return;
  }
  await withLearningAssetLock(params.scopeId, async () => {
    const { learningStorage } = createWorkspaceCollaborationStores();
    const assets = await learningStorage.readLearningAssets(params.scopeId);
    if (assets.length === 0) {
      return;
    }
    const now = params.atMs ?? Date.now();
    let changed = false;
    const next = assets.map((asset) => {
      if (!targets.has(asset.assetId)) {
        return asset;
      }
      changed = true;
      if (delta > 0) {
        let bumped = asset;
        for (let i = 0; i < delta; i += 1) {
          bumped = bumpStageFields(bumped, params.stage, now);
        }
        return bumped;
      }
      // decrement
      const steps = -delta;
      if (params.stage === "outcome_verified") {
        const cur = resolveOutcomeVerifiedCount(asset);
        return {
          ...asset,
          outcomeVerifiedCount: Math.max(0, cur - steps),
          updatedAt: now,
        };
      }
      if (params.stage === "adopted") {
        const cur = resolveAdoptedCount(asset);
        return {
          ...asset,
          adoptedCount: Math.max(0, cur - steps),
          updatedAt: now,
        };
      }
      if (params.stage === "injected") {
        const cur = resolveInjectedCount(asset);
        const injectedCount = Math.max(0, cur - steps);
        return {
          ...asset,
          injectedCount,
          reuseCount: injectedCount,
          updatedAt: now,
        };
      }
      if (params.stage === "retrieved") {
        const cur = resolveRetrievedCount(asset);
        return {
          ...asset,
          retrievedCount: Math.max(0, cur - steps),
          updatedAt: now,
        };
      }
      return asset;
    });
    if (!changed) {
      return;
    }
    await learningStorage.writeLearningAssets(params.scopeId, next);
  });
}

/**
 * 永不 reject 的阶段计数（提示词组装路径上不能因此失败）。
 *
 * W4: `onRecorded` is optional bookkeeping only — **do not** use it to trigger
 * skill curation on injection. Curation must wait for `outcome_verified`.
 */
export function recordLearningExperienceStageSafely(params: {
  scopeId: string;
  assetIds: string[];
  stage: LearningExperienceStage;
  onRecorded?: () => void;
}): void {
  void recordLearningExperienceStage({
    scopeId: params.scopeId,
    assetIds: params.assetIds,
    stage: params.stage,
  })
    .then(() => {
      params.onRecorded?.();
    })
    .catch((err) => {
      logVerbose(`learning experience stage accounting failed (${params.stage}): ${String(err)}`);
    });
}

/**
 * @deprecated W4: alias for injected stage. Curation must not be hooked here.
 */
export function recordLearningReuseSafely(params: {
  scopeId: string;
  assetIds: string[];
  onRecorded?: () => void;
}): void {
  recordLearningExperienceStageSafely({
    scopeId: params.scopeId,
    assetIds: params.assetIds,
    stage: "injected",
    onRecorded: params.onRecorded,
  });
}
