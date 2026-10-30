/**
 * AOR 选路（P3，任务 13）——在 EffectiveModelSet **之内**按套餐策略给候选排序。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§6.2 / §6.3 / §7.1, Property 4 / 7）。
 *
 * 关键不变量：
 * - **Property 4（双模式候选一致）**：`native` 与 `aor_enhanced` 产出的候选**集合相同**，
 *   仅排序不同。本函数对输入 `effectiveModelIds` 做「保集合的重排」，绝不增删成员。
 * - **Property 7（hard-deny）**：输出 `orderedModelIds ⊆ effectiveModelIds`，AOR 不引入集合外模型。
 *
 * 接入方式按 design §10 采用**进程内** `@openbot/aor-core`（无网络跳转）。AOR 只做
 * 选路 + 评估，**不做授权**——授权边界由上游 Entitlement Gate 的 EffectiveModelSet 决定。
 */

import {
  rankModels,
  type CostProfile,
  type ModelProfile,
  type ModelRef,
  type SelectionStrategy,
} from "@openbot/aor-core";
import type { PlatformModelsMode } from "../models/platform-models-types.js";

/** 套餐携带的 AOR 执行策略（与 platform-models-aor-projection 的 aorExecution 对齐）。 */
export type AorExecutionSpec = {
  taskTypeId: string;
  selectorStrategy: SelectionStrategy;
  evaluatorMode: string;
};

export type AorSelectionInput = {
  mode: PlatformModelsMode;
  /** 上游 Entitlement Gate 已解析的授权集合（modelRef `provider/id`）。 */
  effectiveModelIds: readonly string[];
  /** 套餐 AOR 策略；缺省（native 或无绑定）则按原序返回。 */
  aorExecution?: AorExecutionSpec | undefined;
  /**
   * 模型档案目录（成本/质量）。生产应传入平台资源目录适配结果。
   * 缺省为空数组：未知成本走中性合成档案，**不**静默套用 SEED_MODEL_CATALOG。
   */
  catalog?: readonly ModelProfile[];
  /** 成本估算用 token 预期；默认 1k/1k（仅用于排序的相对比较）。 */
  costProfile?: CostProfile;
};

export type AorRoutingExplanation = {
  modelId: string;
  score: number;
  qualityScore: number;
  estimatedCostUsd: number;
  reason: string;
};

/** Whether ranked candidates used real catalog costs/scores or synthetic neutrals. */
export type AorCatalogCoverage = "full" | "partial" | "synthetic_only";

export type AorSelectionResult = {
  /** 保集合重排后的候选顺序（primary 在前）；集合恒等于 effectiveModelIds 去重后的集合。 */
  orderedModelIds: string[];
  /** 实际生效的策略；native / 无 aorExecution / 全合成中性档案时为 "native"。 */
  strategy: SelectionStrategy | "native";
  /** aor_enhanced 下的路由解释（可观测 / 回写投影用）。全合成时不产出，避免冒充已验证优化。 */
  routingExplanation?: AorRoutingExplanation[];
  /** Catalog evidence quality for this ranking. */
  catalogCoverage?: AorCatalogCoverage;
  /** Model ids ranked via synthetic neutral profiles (subset of ordered). */
  syntheticModelIds?: string[];
};

const DEFAULT_COST_PROFILE: CostProfile = {
  expectedInputTokens: 1000,
  expectedOutputTokens: 1000,
};

/** 解析 modelRef 字符串（`provider/id`）；非法返回 null。 */
function parseModelId(modelId: string): ModelRef | null {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

function refToModelId(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return (
    a.provider.toLowerCase() === b.provider.toLowerCase() &&
    a.id.toLowerCase() === b.id.toLowerCase()
  );
}

type ProfileResolution = {
  profile: ModelProfile;
  /** True when the profile was invented with neutral cost/scores (not from catalog). */
  synthetic: boolean;
};

/**
 * 为某 modelRef 构造候选档案：优先取目录里的真实档案，否则合成一个中性默认档案
 * （保证集合内每个授权模型都可参与排序，从而不破坏 Property 4）。
 * 调用方必须区分 synthetic：全合成时不得把结果标成经效果验证的智能优化。
 */
function profileForRef(ref: ModelRef, catalog: readonly ModelProfile[]): ProfileResolution {
  const found = catalog.find((profile) => sameRef(profile.ref, ref));
  if (found) {
    return { profile: found, synthetic: false };
  }
  return {
    profile: {
      ref,
      cost: { inputPerMtok: 1, outputPerMtok: 1 },
      taskTypeScores: {},
    },
    synthetic: true,
  };
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}

/**
 * 在 EffectiveModelSet 内按策略给候选排序（保集合重排）。
 *
 * - `native` 或无 `aorExecution`：原序返回（去重），`strategy="native"`。
 * - `aor_enhanced` + `aorExecution`：用 aor-core `rankModels` 在授权集合内排序；
 *   不可解析的 modelId 退回到末尾，确保集合恒等。
 */
export function selectModelOrderWithinEffectiveSet(input: AorSelectionInput): AorSelectionResult {
  const effective = dedupe(input.effectiveModelIds);

  if (input.mode !== "aor_enhanced" || !input.aorExecution || effective.length === 0) {
    return { orderedModelIds: effective, strategy: "native" };
  }

  const catalog = input.catalog ?? [];
  const costProfile = input.costProfile ?? DEFAULT_COST_PROFILE;

  // 把授权集合切分为「可解析为 ModelRef」与「不可解析」两部分。
  const parsed: Array<{ modelId: string; ref: ModelRef }> = [];
  const unparsable: string[] = [];
  for (const modelId of effective) {
    const ref = parseModelId(modelId);
    if (ref) {
      parsed.push({ modelId, ref });
    } else {
      unparsable.push(modelId);
    }
  }

  if (parsed.length === 0) {
    // Nothing rankable with real refs — keep set, do not claim selectorStrategy as verified.
    return {
      orderedModelIds: effective,
      strategy: "native",
      catalogCoverage: "synthetic_only",
    };
  }

  const resolved = parsed.map(({ modelId, ref }) => {
    const { profile, synthetic } = profileForRef(ref, catalog);
    return { modelId, ref, profile, synthetic };
  });
  const syntheticModelIds = resolved.filter((row) => row.synthetic).map((row) => row.modelId);
  const catalogCoverage: AorCatalogCoverage =
    syntheticModelIds.length === 0
      ? "full"
      : syntheticModelIds.length === resolved.length
        ? "synthetic_only"
        : "partial";

  // All-neutral synthetic ranking is not effect-verified smart mode: fall back to original
  // order and omit explanations that would claim "lowest estimated cost" etc.
  if (catalogCoverage === "synthetic_only") {
    return {
      orderedModelIds: effective,
      strategy: "native",
      catalogCoverage,
      syntheticModelIds,
    };
  }

  const candidates = resolved.map((row) => row.profile);
  const allowedModels = resolved.map((row) => row.ref);

  let ranked;
  try {
    ranked = rankModels({
      taskType: input.aorExecution.taskTypeId,
      strategy: input.aorExecution.selectorStrategy,
      candidates,
      costProfile,
      constraints: { allowedModels },
    });
  } catch {
    // 选路异常（无满足约束的候选等）→ 退回原序，绝不缩减集合；不冒充已验证策略。
    return {
      orderedModelIds: effective,
      strategy: "native",
      catalogCoverage,
      ...(syntheticModelIds.length > 0 ? { syntheticModelIds } : {}),
    };
  }

  const orderedModelIds: string[] = [];
  const seen = new Set<string>();
  const explanation: AorRoutingExplanation[] = [];
  for (const entry of ranked) {
    const modelId = refToModelId(entry.model);
    // rankModels 的 ref 大小写源自候选档案；用原始授权 id 归一以保持集合恒等。
    const original = parsed.find(({ ref }) => sameRef(ref, entry.model))?.modelId ?? modelId;
    if (seen.has(original)) {
      continue;
    }
    seen.add(original);
    orderedModelIds.push(original);
    explanation.push({
      modelId: original,
      score: entry.score,
      qualityScore: entry.qualityScore,
      estimatedCostUsd: entry.estimatedCostUsd,
      reason: entry.reason,
    });
  }
  // 兜底：任何未被 rank 覆盖的授权模型按原序补齐（保集合）。
  for (const modelId of effective) {
    if (!seen.has(modelId)) {
      seen.add(modelId);
      orderedModelIds.push(modelId);
    }
  }

  return {
    orderedModelIds,
    strategy: input.aorExecution.selectorStrategy,
    routingExplanation: explanation,
    catalogCoverage,
    ...(syntheticModelIds.length > 0 ? { syntheticModelIds } : {}),
  };
}
