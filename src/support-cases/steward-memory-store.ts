/**
 * Steward Memory Store — 大白管家的长期记忆（偏好 / 已解决话题 / 能力使用 / 最近意图）。
 *
 * 设计要点（见 .kiro/specs/daibai-super-steward，决策 B + Phase 2 并发修正）：
 * - **隔离粒度**：按 `tenantId + userId` 复合键隔离，跨企业不串记忆。
 * - **并发安全**：管家记忆每轮 ask 都写，**不**沿用支持单的整文件 load-modify-save。
 *   改用「每 key 一文件 + 原子写（temp+rename）+ 进程内按 key 串行写队列」，避免高频写丢失/覆盖。
 * - **防膨胀**：各列表滚动窗口截断。
 * - **不存敏感数据**：偏好/提示均为短文本；密钥/PII 以引用名表示（遵守 content-safety）。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const STEWARD_MEMORY_DIR = "steward-memory";

/** 各滚动窗口上限，防止文件无限增长。 */
const MAX_RECENT_TOPICS = 20;
const MAX_CAPABILITY_HINTS = 20;
const MAX_RECENT_INTENTS = 30;

export type StewardIntentRecord = {
  /** 用户消息摘要（截断后的短文本，非原文全文）。 */
  summary: string;
  /** 命中的意图分级（self_serve / assisted_action / escalate）。 */
  tier?: string;
  /** 命中的能力域（如 knowledge / billing）。 */
  domain?: string;
  atMs: number;
};

export type StewardMemory = {
  tenantId: string | null;
  userId: string;
  /** 用户偏好（短文本键值，例如语言/简洁度）。 */
  preferences: Record<string, string>;
  /** 最近已解决的话题摘要。 */
  recentResolvedTopics: string[];
  /** 能力使用提示（最近用过/常用能力 id）。 */
  capabilityUsageHints: string[];
  /** 最近意图记录（滚动）。 */
  lastIntents: StewardIntentRecord[];
  updatedAtMs: number;
};

export type StewardMemoryKey = {
  userId: string;
  tenantId?: string | null;
};

function sanitizeKeyPart(value: string): string {
  // 仅保留文件名安全字符；其余折叠为 "_"，避免路径穿越。
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "_";
}

/** 复合键 → 文件名（`<tenant>__<user>.json`）。 */
export function resolveStewardMemoryFileName(key: StewardMemoryKey): string {
  const tenant = sanitizeKeyPart(key.tenantId?.trim() || "_");
  const user = sanitizeKeyPart(key.userId.trim());
  return `${tenant}__${user}.json`;
}

function resolveStewardMemoryFilePath(
  key: StewardMemoryKey,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), STEWARD_MEMORY_DIR, resolveStewardMemoryFileName(key));
}

function emptyMemory(key: StewardMemoryKey): StewardMemory {
  return {
    tenantId: key.tenantId?.trim() || null,
    userId: key.userId.trim(),
    preferences: {},
    recentResolvedTopics: [],
    capabilityUsageHints: [],
    lastIntents: [],
    updatedAtMs: 0,
  };
}

/** 进程内按 key 串行写队列：合并同 key 的高频写，杜绝并发丢写。 */
const writeChains = new Map<string, Promise<unknown>>();

function enqueueWrite<T>(fileName: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(fileName) ?? Promise.resolve();
  const next = prev.then(task, task);
  // 链尾清理：仅当当前 promise 仍是链尾时移除，避免泄漏。
  writeChains.set(
    fileName,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function readMemoryFile(filePath: string): Promise<StewardMemory | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StewardMemory>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as StewardMemory;
  } catch {
    return null;
  }
}

async function writeMemoryFile(filePath: string, memory: StewardMemory): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(memory, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

/** 加载管家记忆（不存在返回空记忆，永不抛出以免阻断主流程）。 */
export async function loadStewardMemory(
  key: StewardMemoryKey,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StewardMemory> {
  const filePath = resolveStewardMemoryFilePath(key, env);
  const loaded = await readMemoryFile(filePath);
  return loaded ? { ...emptyMemory(key), ...loaded } : emptyMemory(key);
}

function pushRolling<T>(list: T[], item: T, max: number): T[] {
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

function dedupePushRolling(list: string[], item: string, max: number): string[] {
  const filtered = list.filter((entry) => entry !== item);
  filtered.push(item);
  return filtered.length > max ? filtered.slice(filtered.length - max) : filtered;
}

/**
 * 追加一次大白交互到管家记忆（read-modify-write 经按 key 串行队列，原子落盘）。
 * 失败由调用方决定是否吞掉（建议在 ask 主流程 try/catch 降级，不阻断回复）。
 */
export async function appendStewardInteraction(
  params: StewardMemoryKey & {
    intent?: StewardIntentRecord;
    resolvedTopic?: string;
    capabilityHint?: string;
    preferences?: Record<string, string>;
    env?: NodeJS.ProcessEnv;
  },
): Promise<StewardMemory> {
  const key: StewardMemoryKey = { userId: params.userId, tenantId: params.tenantId };
  const env = params.env ?? process.env;
  const filePath = resolveStewardMemoryFilePath(key, env);
  const fileName = resolveStewardMemoryFileName(key);

  return enqueueWrite(fileName, async () => {
    const current = await loadStewardMemory(key, env);
    const updated: StewardMemory = {
      ...current,
      preferences: params.preferences
        ? { ...current.preferences, ...params.preferences }
        : current.preferences,
      recentResolvedTopics: params.resolvedTopic
        ? dedupePushRolling(current.recentResolvedTopics, params.resolvedTopic, MAX_RECENT_TOPICS)
        : current.recentResolvedTopics,
      capabilityUsageHints: params.capabilityHint
        ? dedupePushRolling(
            current.capabilityUsageHints,
            params.capabilityHint,
            MAX_CAPABILITY_HINTS,
          )
        : current.capabilityUsageHints,
      lastIntents: params.intent
        ? pushRolling(current.lastIntents, params.intent, MAX_RECENT_INTENTS)
        : current.lastIntents,
      updatedAtMs: Date.now(),
    };
    await writeMemoryFile(filePath, updated);
    return updated;
  });
}
