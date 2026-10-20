/**
 * 学习资产回流（recall）—— 把已晋升的学习资产真正读回到系统提示词。
 *
 * 背景：`capsule → projection → asset` 的写入链路早已打通，但读回侧只提取
 * `abstractedContent.capabilities` / `metadata.skills`（能力名字符串），而写入侧从不
 * 产出这两个键，于是每一条经验都"写得进、读不出"——教训永远不会回到行为里。
 *
 * 本模块补上真正的读回：
 *  - 渲染 `lesson` 正文（不是能力名）进提示词；
 *  - 记录**复用次数**（被注入提示词才算复用），为复用阈值策展提供唯一可信口径。
 */

import type { AgentLearningAsset } from "@openbot/collaboration-core";
import {
  createWorkspaceCollaborationStores,
  resolveGroupStoreFilePath,
} from "../../gateway/collaboration-learning/shared.js";
import { logVerbose } from "../../globals.js";
import { withFileLock } from "../../infra/file-lock.js";
import { createAsyncLock } from "../../infra/json-files.js";

/** 单条可复述的经验。 */
export type LearningRecallEntry = {
  assetId: string;
  assetType: NonNullable<AgentLearningAsset["assetType"]>;
  /** 人类可读的一句话教训（已由晋升侧构造）。 */
  lesson: string;
  confidence: NonNullable<AgentLearningAsset["confidence"]>;
  reuseCount: number;
  isAntiPattern: boolean;
};

export type LearningRecall = {
  capabilities: string[];
  lessons: LearningRecallEntry[];
};

export const EMPTY_LEARNING_RECALL: LearningRecall = { capabilities: [], lessons: [] };

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

/** 排序：高置信 → 高复用 → 新在前。纯函数，便于单测。 */
export function rankLearningAssets(assets: AgentLearningAsset[]): AgentLearningAsset[] {
  return [...assets].toSorted((left, right) => {
    const confidence =
      (CONFIDENCE_RANK[right.confidence ?? "low"] ?? 0) -
      (CONFIDENCE_RANK[left.confidence ?? "low"] ?? 0);
    if (confidence !== 0) {
      return confidence;
    }
    const reuse = (right.reuseCount ?? 0) - (left.reuseCount ?? 0);
    if (reuse !== 0) {
      return reuse;
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
    lessons.push({
      assetId: asset.assetId,
      assetType: asset.assetType ?? "lesson",
      lesson,
      confidence: asset.confidence ?? "low",
      reuseCount: asset.reuseCount ?? 0,
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

/**
 * 记录复用：把注入过的资产 `reuseCount += 1`。
 *
 * 复用 = **真的进了提示词**，而不是被创建或被查看。这是阈值策展的计数口径。
 */
export async function recordLearningReuse(params: {
  scopeId: string;
  assetIds: string[];
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
      return {
        ...asset,
        reuseCount: (asset.reuseCount ?? 0) + 1,
        lastReusedAt: now,
        updatedAt: now,
      } satisfies AgentLearningAsset;
    });
    if (!changed) {
      return;
    }
    await learningStorage.writeLearningAssets(params.scopeId, next);
  });
}

/**
 * 永不 reject 的复用计数（提示词组装路径上不能因此失败）。
 *
 * `onRecorded` 在计数**落盘之后**触发，供复用阈值策展使用——必须在写盘后才查阈值，
 * 否则本次复用没算进去，会永远差一次才毕业。
 */
export function recordLearningReuseSafely(params: {
  scopeId: string;
  assetIds: string[];
  onRecorded?: () => void;
}): void {
  void recordLearningReuse({ scopeId: params.scopeId, assetIds: params.assetIds })
    .then(() => {
      params.onRecorded?.();
    })
    .catch((err) => {
      logVerbose(`learning reuse accounting failed: ${String(err)}`);
    });
}
