/**
 * AgentGenome Working DNA 持久化（件事三：把 workingStyle 接成「行为改变」的实际写入）。
 *
 * 机器人：`{agentDir}/working-style.json`（agentDir 由 resolveAgentDir 解析），
 * 与 growth-status.json 同级、同套低层读写（readJsonFile / writeJsonAtomic / 锁），保持无 collaboration 依赖。
 *
 * 写入触发：运营信号(operationalScore 的原始信号)经 deriveWorkingStyleDelta 确定性派生变更后落盘。
 * 这是 Phase 2「任务→反馈→行为改变」闭环的行为端落点（读取/施加到实际提示词为后续步骤）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import {
  applyWorkingStyleDelta,
  DEFAULT_WORKING_STYLE,
  deriveWorkingStyleDelta,
  evaluateWorkingStyleEffect,
  type OperationalSignalsForStyle,
  renderWorkingStyleInstructions,
  sameWorkingStyleDelta,
  type WorkingStyle,
  type WorkingStyleEffectStatus,
} from "./genome.js";

export const WORKING_STYLE_FILENAME = "working-style.json";
export const WORKING_STYLE_CHANGE_FILENAME = "working-style-change.json";
export const WORKING_STYLE_SUPPRESSION_FILENAME = "working-style-suppression.json";
export const WORKING_STYLE_EFFECT_STATS_FILENAME = "working-style-effect-stats.json";

/**
 * 行为改变有效性的累计统计（三阶自调用）。每次二阶评估得出结论(improved/regressed)时累加。
 * 供 computeAdaptivityAdjustment 反哺 operationalScore。
 */
export type WorkingStyleEffectStats = {
  improvedCount: number;
  regressedCount: number;
  assessedCount: number;
  sumDeltaScore: number;
  updatedAtMs: number;
};

/**
 * 最近一次 Working DNA 变更记录（二阶反馈用）。记录变更时的基线实战分与被覆盖的旧值(previousValues)，
 * 供后续 recompute 对比评估、并在判定回归时自动回滚。
 * assessedAtMs 为 null 表示尚未评估；一旦得出结论即写入 effectStatus/deltaScore 并置 assessedAtMs。
 */
export type WorkingStyleChangeRecord = {
  changedAtMs: number;
  baselineOperationalScore: number | null;
  appliedDelta: Partial<WorkingStyle>;
  /** 变更前被覆盖字段的旧值（回滚目标）。 */
  previousValues?: Partial<WorkingStyle>;
  assessedAtMs: number | null;
  effectStatus?: WorkingStyleEffectStatus;
  deltaScore?: number | null;
  /** 是否因判定回归而已自动回滚。 */
  rolledBack?: boolean;
};

/**
 * 振荡抑制：记录最近一次因回归被回滚的 delta。相同 delta 在被抑制期间不再重复应用
 * （避免"应用→回归→回滚→再应用"死循环）。当信号产出不同的 delta 时自动解除。
 */
export type WorkingStyleSuppression = {
  suppressedDelta: Partial<WorkingStyle>;
  suppressedAtMs: number;
};

/** 解析机器人 working-style.json 路径。 */
export function resolveRobotWorkingStylePath(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), WORKING_STYLE_FILENAME);
}

const styleLocks = new Map<string, { gate: ReturnType<typeof createAsyncLock>; users: number }>();
async function withStyleLock<T>(
  cfg: OpenBotConfig,
  agentId: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const resolved = resolveRobotWorkingStylePath(cfg, agentId);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const file = path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
  let entry = styleLocks.get(file);
  if (!entry) {
    entry = { gate: createAsyncLock(), users: 0 };
    styleLocks.set(file, entry);
  }
  entry.users++;
  try {
    return await entry.gate(() =>
      withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, () => fn(file)),
    );
  } finally {
    entry.users--;
    if (entry.users === 0 && styleLocks.get(file) === entry) {
      styleLocks.delete(file);
    }
  }
}
/** Content version retains the existing format. ABA and multi-file transactions are out of scope. */
export function workingStyleVersion(style: WorkingStyle): string {
  return (
    "style:" +
    [
      style.outputFormat,
      style.reportingCadence,
      style.decisionPreference,
      style.riskPreference,
      style.communicationTone,
    ].join(":")
  );
}
async function readStyleForWrite(file: string): Promise<WorkingStyle> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_WORKING_STYLE };
    }
    throw error;
  }
  return validatedWorkingStyle(JSON.parse(text));
}
function validatedWorkingStyle(value: unknown): WorkingStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_working_style");
  }
  const result = { ...DEFAULT_WORKING_STYLE, ...value } as WorkingStyle;
  const allowed: Record<keyof WorkingStyle, readonly string[]> = {
    outputFormat: ["concise", "detailed", "structured", "conversational"],
    reportingCadence: ["on_completion", "milestone", "periodic", "on_request"],
    decisionPreference: ["autonomous", "confirm_first", "escalate"],
    riskPreference: ["conservative", "balanced", "aggressive"],
    communicationTone: ["formal", "neutral", "friendly"],
  };
  for (const field of Object.keys(allowed) as (keyof WorkingStyle)[]) {
    if (!allowed[field].includes(result[field])) {
      throw new Error("invalid_working_style");
    }
  }
  return {
    outputFormat: result.outputFormat,
    reportingCadence: result.reportingCadence,
    decisionPreference: result.decisionPreference,
    riskPreference: result.riskPreference,
    communicationTone: result.communicationTone,
  };
}
export async function compareAndSwapRobotWorkingStyle(
  cfg: OpenBotConfig,
  agentId: string,
  expectedVersion: string,
  updater: (current: WorkingStyle) => WorkingStyle,
): Promise<
  | {
      ok: true;
      before: WorkingStyle;
      after: WorkingStyle;
      beforeVersion: string;
      afterVersion: string;
    }
  | { ok: false; code: "version_conflict"; actualVersion: string }
> {
  return withStyleLock(cfg, agentId, async (file) => {
    const before = await readStyleForWrite(file);
    const beforeVersion = workingStyleVersion(before);
    if (beforeVersion !== expectedVersion) {
      return {
        ok: false as const,
        code: "version_conflict" as const,
        actualVersion: beforeVersion,
      };
    }
    const after = validatedWorkingStyle(updater({ ...before }));
    await writeJsonAtomic(file, after);
    return {
      ok: true as const,
      before,
      after,
      beforeVersion,
      afterVersion: workingStyleVersion(after),
    };
  });
}

/** 读取机器人 WorkingStyle；不存在返回 null。 */
export async function readRobotWorkingStyle(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<WorkingStyle | null> {
  return await readJsonFile<WorkingStyle>(resolveRobotWorkingStylePath(cfg, agentId));
}

/** 读取机器人 WorkingStyle；不存在返回默认 DNA（补齐缺失字段，兼容旧文件）。 */
export async function readRobotWorkingStyleOrDefault(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<WorkingStyle> {
  const stored = await readRobotWorkingStyle(cfg, agentId);
  return stored ? { ...DEFAULT_WORKING_STYLE, ...stored } : { ...DEFAULT_WORKING_STYLE };
}

/** 原子写入机器人 WorkingStyle。 */
export async function writeRobotWorkingStyle(
  cfg: OpenBotConfig,
  agentId: string,
  style: WorkingStyle,
): Promise<void> {
  await withStyleLock(cfg, agentId, async (file) => {
    await readStyleForWrite(file);
    await writeJsonAtomic(file, validatedWorkingStyle(style));
  });
}

/** 在锁内对机器人 WorkingStyle 做读改写（updater 返回 null 表示不写）。 */
export async function updateRobotWorkingStyle(
  cfg: OpenBotConfig,
  agentId: string,
  updater: (current: WorkingStyle) => WorkingStyle | null,
): Promise<WorkingStyle | null> {
  return await withStyleLock(cfg, agentId, async (file) => {
    const current = await readStyleForWrite(file);
    const next = updater(current);
    if (next === null) {
      return current;
    }
    await writeJsonAtomic(file, validatedWorkingStyle(next));
    return next;
  });
}

/** 解析机器人 working-style-change.json 路径。 */
export function resolveRobotWorkingStyleChangePath(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), WORKING_STYLE_CHANGE_FILENAME);
}

/** 解析机器人 working-style-suppression.json 路径。 */
export function resolveRobotWorkingStyleSuppressionPath(
  cfg: OpenBotConfig,
  agentId: string,
): string {
  return path.join(resolveAgentDir(cfg, agentId), WORKING_STYLE_SUPPRESSION_FILENAME);
}

/** 解析机器人 working-style-effect-stats.json 路径。 */
export function resolveRobotWorkingStyleEffectStatsPath(
  cfg: OpenBotConfig,
  agentId: string,
): string {
  return path.join(resolveAgentDir(cfg, agentId), WORKING_STYLE_EFFECT_STATS_FILENAME);
}

/** 读取机器人行为改变有效性统计；无则 null。 */
export async function readWorkingStyleEffectStats(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<WorkingStyleEffectStats | null> {
  return await readJsonFile<WorkingStyleEffectStats>(
    resolveRobotWorkingStyleEffectStatsPath(cfg, agentId),
  );
}

const changeLock = createAsyncLock();

async function clearSuppression(cfg: OpenBotConfig, agentId: string): Promise<void> {
  await fs.rm(resolveRobotWorkingStyleSuppressionPath(cfg, agentId), { force: true });
}

/** 读取最近一次 Working DNA 变更记录；无则 null。 */
export async function readWorkingStyleChange(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<WorkingStyleChangeRecord | null> {
  return await readJsonFile<WorkingStyleChangeRecord>(
    resolveRobotWorkingStyleChangePath(cfg, agentId),
  );
}

/**
 * 从运营信号确定性派生 Working DNA 变更并落盘（行为改变写入）。
 * 无变更（空 delta）→ 不写，返回 null；有变更 → 合并写入，并记录一条变更记录（含基线实战分）供二阶反馈评估。
 */
export async function applyOperationalSignalsToWorkingStyle(
  cfg: OpenBotConfig,
  agentId: string,
  signals: OperationalSignalsForStyle,
  baselineOperationalScore?: number | null,
): Promise<WorkingStyle | null> {
  const delta = deriveWorkingStyleDelta(signals);
  if (Object.keys(delta).length === 0) {
    return null;
  }
  // 振荡抑制：与上次因回归被回滚的 delta 相同 → 跳过（已知有害；等信号变化产出不同 delta 再试）。
  const suppression = await readJsonFile<WorkingStyleSuppression>(
    resolveRobotWorkingStyleSuppressionPath(cfg, agentId),
  );
  if (suppression && sameWorkingStyleDelta(suppression.suppressedDelta, delta)) {
    return null;
  }
  let didChange = false;
  let previousValues: Partial<WorkingStyle> = {};
  const result = await updateRobotWorkingStyle(cfg, agentId, (current) => {
    const next = applyWorkingStyleDelta(current, delta);
    // 仅在有实际变化时写（避免无谓落盘），并记录被覆盖字段的旧值供回滚。
    const changedKeys = (Object.keys(delta) as Array<keyof WorkingStyle>).filter(
      (key) => current[key] !== next[key],
    );
    didChange = changedKeys.length > 0;
    if (didChange) {
      previousValues = Object.fromEntries(
        changedKeys.map((key) => [key, current[key]]),
      ) as Partial<WorkingStyle>;
    }
    return didChange ? next : null;
  });
  if (didChange) {
    // 记录变更 + 基线实战分 + 旧值（下次 recompute 据此评估效果；回归则回滚）。
    await changeLock(async () => {
      await writeJsonAtomic(resolveRobotWorkingStyleChangePath(cfg, agentId), {
        changedAtMs: Date.now(),
        baselineOperationalScore:
          typeof baselineOperationalScore === "number" ? baselineOperationalScore : null,
        appliedDelta: delta,
        previousValues,
        assessedAtMs: null,
      } satisfies WorkingStyleChangeRecord);
      // 应用了不同于被抑制的 delta → 解除抑制。
      await clearSuppression(cfg, agentId);
    });
    return result;
  }
  return null;
}

/**
 * 二阶反馈：评估上一次 Working DNA 变更的效果（基线实战分 vs 当前实战分）。
 * 仅在存在未评估的变更记录、且能得出结论(improved/regressed)时标记为已评估并返回 `newlyAssessed:true`；
 * 结论不明（inconclusive）则保留记录待后续评估。locked，避免与写入竞争。
 */
export async function assessAndMarkWorkingStyleEffect(
  cfg: OpenBotConfig,
  agentId: string,
  currentOperationalScore: number | null,
): Promise<{
  status: WorkingStyleEffectStatus;
  deltaScore: number | null;
  newlyAssessed: boolean;
  rolledBack: boolean;
} | null> {
  return await changeLock(async () => {
    const filePath = resolveRobotWorkingStyleChangePath(cfg, agentId);
    const record = await readJsonFile<WorkingStyleChangeRecord>(filePath);
    if (!record || record.assessedAtMs !== null) {
      return null;
    }
    const effect = evaluateWorkingStyleEffect(
      record.baselineOperationalScore,
      currentOperationalScore,
    );
    if (effect.status === "inconclusive") {
      // 保留未评估状态，等待后续 recompute 有更充分的实战数据。
      return {
        status: effect.status,
        deltaScore: effect.deltaScore,
        newlyAssessed: false,
        rolledBack: false,
      };
    }
    let rolledBack = false;
    if (
      effect.status === "regressed" &&
      record.previousValues &&
      Object.keys(record.previousValues).length > 0
    ) {
      // 自动回滚：恢复变更前的值（此前表现更好），并抑制重复应用同一 delta（防振荡）。
      // improved → 保留变更（即"强化"：已应用的更优行为得以保留，无需额外动作）。
      await updateRobotWorkingStyle(cfg, agentId, (current) =>
        applyWorkingStyleDelta(current, record.previousValues ?? {}),
      );
      await writeJsonAtomic(resolveRobotWorkingStyleSuppressionPath(cfg, agentId), {
        suppressedDelta: record.appliedDelta,
        suppressedAtMs: Date.now(),
      } satisfies WorkingStyleSuppression);
      rolledBack = true;
    }
    await writeJsonAtomic(filePath, {
      ...record,
      assessedAtMs: Date.now(),
      effectStatus: effect.status,
      deltaScore: effect.deltaScore,
      rolledBack,
    } satisfies WorkingStyleChangeRecord);
    // 三阶自调：累计有效性统计（供 computeAdaptivityAdjustment 反哺 operationalScore）。
    const statsPath = resolveRobotWorkingStyleEffectStatsPath(cfg, agentId);
    const stats = (await readJsonFile<WorkingStyleEffectStats>(statsPath)) ?? {
      improvedCount: 0,
      regressedCount: 0,
      assessedCount: 0,
      sumDeltaScore: 0,
      updatedAtMs: 0,
    };
    stats.assessedCount += 1;
    if (effect.status === "improved") {
      stats.improvedCount += 1;
    } else if (effect.status === "regressed") {
      stats.regressedCount += 1;
    }
    stats.sumDeltaScore += effect.deltaScore ?? 0;
    stats.updatedAtMs = Date.now();
    await writeJsonAtomic(statsPath, stats satisfies WorkingStyleEffectStats);
    return {
      status: effect.status,
      deltaScore: effect.deltaScore,
      newlyAssessed: true,
      rolledBack,
    };
  });
}

/**
 * 读取机器人已学习的 Working DNA 并渲染为系统提示词指令。
 * 仅当已持久化 `working-style.json`（即真的发生过行为改变）时返回文本；否则返回 undefined，
 * 调用方据此跳过注入 —— 未学习过的 agent 保持原有行为（向后兼容）。
 */
export async function resolveWorkingStyleInstructions(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<string | undefined> {
  const id = agentId.trim();
  if (!id) {
    return undefined;
  }
  const stored = await readRobotWorkingStyle(cfg, id);
  if (!stored) {
    return undefined;
  }
  const rendered = renderWorkingStyleInstructions({ ...DEFAULT_WORKING_STYLE, ...stored }).trim();
  return rendered.length > 0 ? rendered : undefined;
}
