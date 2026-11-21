import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { BanditFeedbackStore, type BanditPersistedState } from "@openbot/aor-core";
/**
 * AOR 运行反馈回写（P3，任务 14）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§6.3）。
 *
 * `aor_enhanced` 下某次模型调用完成后，把「该 model×taskType 的完成反馈」写入持久化
 * bandit 状态文件（`gateway.platform.models.aor.banditStatePath`）。`platform-models-aor-projection.ts`
 * 的 `loadBanditArms` 直接读取同一文件，因此**无需改投影代码**——bandit 学习状态/路由解释
 * 会随回写自然反映到平台模型状态面。
 *
 * 用量计费：模型用量沿用既有 usage 事件计入 cost-budget-billing（`runWithModelFallback`
 * 执行链路已产生 usage 记录），本模块**不**重复计费，仅回写选路学习信号。
 *
 * 反馈强度：Stage 当前以「运行完成」为成功信号（score=1），完整 evaluator/LLM-judge
 * 评分为后续增强；接口保留 `score`/`costUsd` 以便平滑升级。
 */
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { writeJsonAtomicSync } from "../../infra/json-files.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("model-entitlement");

export type AorRunFeedbackInput = {
  /** bandit 持久化状态文件路径（与投影读取路径一致）。 */
  banditStatePath: string;
  /** 实际执行的 provider / model（来自 runWithModelFallback 结果）。 */
  provider: string;
  model: string;
  /** 套餐 aorExecution 的任务类型。 */
  taskTypeId: string;
  /** 0..1 完成质量；默认 1（运行完成即成功）。 */
  score?: number;
  /** 本次调用的 USD 成本（如已知）。 */
  costUsd?: number;
};

/**
 * 回写一次 AOR 运行反馈到持久化 bandit 状态。失败仅告警，不影响主链路。
 */
export function recordAorRunFeedback(input: AorRunFeedbackInput): void {
  const provider = input.provider.trim();
  const model = input.model.trim();
  const taskTypeId = input.taskTypeId.trim();
  if (!input.banditStatePath.trim() || !provider || !model || !taskTypeId) {
    return;
  }
  try {
    recordAorRunFeedbackStrict(input);
  } catch (err) {
    log.warn(`AOR 反馈回写失败（已忽略）：${err instanceof Error ? err.message : String(err)}`);
  }
}

export type AorRoutingExplanationInput = {
  /** 路由解释审计日志路径（与 `platform-models-aor-projection.loadAuditExplanations` 读取一致）。 */
  auditLogPath: string;
  /** 本次运行的唯一标识（runId / requestId）。 */
  runId: string;
  /** 套餐 aorExecution 的任务类型。 */
  taskTypeId: string;
  /** 生效的选路策略（cheapest / best_quality / balanced / bandit）。 */
  strategy: string;
  /** 实际执行的 provider / model（来自 runWithModelFallback 结果）。 */
  provider: string;
  model: string;
  /** AOR 对该选中模型的选路理由（来自 rankModels）。 */
  reason?: string;
  /** AOR 对该选中模型的策略评分。 */
  score?: number;
  /** 运行评估分（如已知）。 */
  evaluationScore?: number;
  /** 可选目标描述。 */
  goal?: string;
};

/**
 * 回写一次 AOR 路由解释到审计日志（P3 收口：填补「选路解释写入链路」）。
 *
 * 以 JSONL 追加一行，字段形态与 `platform-models-aor-projection.ts` 的 `loadAuditExplanations`
 * 读取格式严格对齐（`runId` / `taskType` / `strategy` / `selection{model,reason,score}` /
 * `evaluationScore` / `occurredAt`），因此**无需改投影代码**——路由解释会随写入自然反映到
 * 平台模型状态面（`gateway.platform.models.aor.routingExplanations`）。失败仅告警，不影响主链路。
 */
export function recordAorRoutingExplanation(input: AorRoutingExplanationInput): void {
  const auditLogPath = input.auditLogPath.trim();
  const runId = input.runId.trim();
  const model = `${input.provider.trim()}/${input.model.trim()}`;
  const taskType = input.taskTypeId.trim();
  if (!auditLogPath || !runId || !input.provider.trim() || !input.model.trim() || !taskType) {
    return;
  }
  try {
    const record = {
      runId,
      occurredAt: new Date().toISOString(),
      taskType,
      goal: input.goal ?? "",
      strategy: input.strategy,
      selection: {
        model,
        reason: input.reason ?? input.strategy,
        ...(typeof input.score === "number" ? { score: input.score } : {}),
      },
      ...(typeof input.evaluationScore === "number"
        ? { evaluationScore: input.evaluationScore }
        : {}),
    };
    appendFileSync(auditLogPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    log.warn(`AOR 路由解释写入失败（已忽略）：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Strict projection port for replay consumers: failures propagate to Outbox, no silent ack. */
export function recordAorRunFeedbackStrict(input: AorRunFeedbackInput): void {
  const provider = input.provider.trim();
  const model = input.model.trim();
  const taskTypeId = input.taskTypeId.trim();
  if (!input.banditStatePath.trim() || !provider || !model || !taskTypeId) {
    throw new Error("AOR feedback projection requires canonical identity and target");
  }
  // Compatibility calls are distinct observations; preserve receipts through the same writer.
  recordAorFeedbackEvent({ ...input, eventId: `legacy:${randomUUID()}` });
}

/** Receipt and learning mutation publish as one snapshot; repeated event never learns twice. */
export function recordAorFeedbackEvent(
  input: AorRunFeedbackInput & { eventId: string },
): "applied" | "duplicate" {
  if (
    !input.eventId.trim() ||
    !input.banditStatePath.trim() ||
    !input.provider.trim() ||
    !input.model.trim() ||
    !input.taskTypeId.trim()
  ) {
    throw new Error("AOR event requires identity and target");
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.provider.trim(),
        input.model.trim(),
        input.taskTypeId.trim(),
        input.score ?? 1,
        input.costUsd ?? null,
      ]),
    )
    .digest("hex");
  return withFileLockSync(input.banditStatePath, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    let prior: (BanditPersistedState & { eventReceipts?: Record<string, string> }) | undefined;
    try {
      prior = JSON.parse(readFileSync(input.banditStatePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if (prior && (prior.version !== 1 || !prior.arms || typeof prior.arms !== "object")) {
      throw new Error("Invalid AOR projection state");
    }
    const receipts = prior?.eventReceipts ?? {};
    if (Object.hasOwn(receipts, input.eventId)) {
      if (receipts[input.eventId] !== digest) {
        throw new Error("AOR event payload conflict");
      }
      return "duplicate";
    }
    const store = new BanditFeedbackStore();
    if (prior) {
      store.importPersistedState(prior);
    }
    store.record(
      { provider: input.provider.trim(), id: input.model.trim() },
      input.taskTypeId.trim(),
      {
        taskType: input.taskTypeId.trim(),
        score: input.score ?? 1,
        signals: {},
        ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
      },
    );
    writeJsonAtomicSync(input.banditStatePath, {
      ...store.exportPersistedState(),
      eventReceipts: { ...receipts, [input.eventId]: digest },
    });
    return "applied";
  });
}
