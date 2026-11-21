import { createHash } from "node:crypto";
/**
 * Agent Growth OS — 持久化（spec: agent-growth-lifecycle, P0A 任务 1.2）。
 *
 * 机器人：`{agentDir}/growth-status.json`（agentDir 由 resolveAgentDir 解析）。
 * 权威存储：**JSON 文档**（class=D），非 SQL；与 `ai-workforce-governance/shared/db-schema.ts`
 * 的逻辑表模型分离——后者为分析投影目标，见 openbot-persistence-engine-matrix-2026-07-13。
 * 小组：存于 collaboration operating-state.json 的 `growthStatus` 字段，由 spaces 层
 *       （readGroupOperatingState / writeGroupOperatingState）读写——见 server-methods/spaces。
 *
 * 本模块仅负责机器人侧落盘 + 低层文件读写，保持无 collaboration 依赖，便于单测。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { type AgentGrowthPathOpts, resolveGrowthAgentDir } from "./tenant-agent-dir.js";
import type { GrowthStatus } from "./types.js";

export const GROWTH_STATUS_FILENAME = "growth-status.json";

/** 解析机器人 growth-status.json 路径。 */
export function resolveRobotGrowthStatusPath(
  cfg: OpenBotConfig,
  agentId: string,
  opts?: AgentGrowthPathOpts,
): string {
  return path.join(resolveGrowthAgentDir(cfg, agentId, opts), GROWTH_STATUS_FILENAME);
}

// 串行化同一进程内的读改写，避免并发 recompute 互相覆盖。
const lock = createAsyncLock();

/** 读取机器人 GrowthStatus；不存在返回 null。 */
export async function readRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  opts?: AgentGrowthPathOpts,
): Promise<GrowthStatus | null> {
  return await readJsonFile<GrowthStatus>(resolveRobotGrowthStatusPath(cfg, agentId, opts));
}

/** 原子写入机器人 GrowthStatus。 */
export async function writeRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  status: GrowthStatus,
  opts?: AgentGrowthPathOpts,
): Promise<void> {
  const file = resolveRobotGrowthStatusPath(cfg, agentId, opts);
  await lock(() =>
    withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
      const prior = await readStoredGrowthStrict(file);
      await writeJsonAtomic(file, {
        ...status,
        _growthPersistence: {
          revision: (prior?._growthPersistence?.revision ?? 0) + 1,
          receipts: prior?._growthPersistence?.receipts ?? {},
        },
      });
    }),
  );
}

/** 在锁内对机器人 GrowthStatus 做读改写（updater 返回 null 表示不写）。 */
export async function updateRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  updater: (current: GrowthStatus | null) => GrowthStatus | null,
  opts?: AgentGrowthPathOpts,
): Promise<GrowthStatus | null> {
  const file = resolveRobotGrowthStatusPath(cfg, agentId, opts);
  return await lock(() =>
    withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
      const current = await readStoredGrowthStrict(file);
      const next = updater(current);
      if (next === null) {
        return current;
      }
      const stored = current;
      await writeJsonAtomic(file, {
        ...next,
        _growthPersistence: {
          revision: (stored?._growthPersistence?.revision ?? 0) + 1,
          receipts: stored?._growthPersistence?.receipts ?? {},
        },
      });
      return next;
    }),
  );
}

type StoredGrowthStatus = GrowthStatus & {
  _growthPersistence?: { revision: number; receipts: Record<string, string> };
};

/** Single aggregate event boundary: receipt and GrowthStatus publish atomically. */
export async function applyRobotGrowthEvent(input: {
  cfg: OpenBotConfig;
  agentId: string;
  eventId: string;
  payload: unknown;
  update: (current: GrowthStatus | null) => GrowthStatus;
  opts?: AgentGrowthPathOpts;
}): Promise<GrowthStatus> {
  if (!input.eventId.trim()) {
    throw new Error("Growth event requires identity");
  }
  const digest = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  const file = resolveRobotGrowthStatusPath(input.cfg, input.agentId, input.opts);
  return lock(() =>
    withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
      const current = await readStoredGrowthStrict(file);
      const receipts = current?._growthPersistence?.receipts ?? {};
      if (Object.hasOwn(receipts, input.eventId)) {
        if (receipts[input.eventId] !== digest) {
          throw new Error("Growth event payload conflict");
        }
        return current!;
      }
      const next = input.update(current);
      const stored: StoredGrowthStatus = {
        ...next,
        _growthPersistence: {
          revision: (current?._growthPersistence?.revision ?? 0) + 1,
          receipts: { ...receipts, [input.eventId]: digest },
        },
      };
      await writeJsonAtomic(file, stored);
      return stored;
    }),
  );
}

async function readStoredGrowthStrict(file: string): Promise<StoredGrowthStatus | null> {
  try {
    const state = JSON.parse(await fs.readFile(file, "utf8")) as StoredGrowthStatus;
    if (
      !state ||
      !state.dimensions ||
      !state.milestones ||
      typeof state.lifecycleState !== "string"
    ) {
      throw new Error("Invalid persisted GrowthStatus");
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
