/**
 * 跨 agent 行为改变有效性聚合分析 + A/B 分组（纯函数，便于单测）。
 *
 * 输入：各 agent 最近一次 Working DNA 变更的效果（appliedDelta + status + deltaScore + rolledBack）。
 * 输出：
 *  - overall：整体 improved/regressed/inconclusive/rolledBack 计数、improvedRate、平均 deltaScore。
 *  - bySignature：按 delta 签名（哪种行为改变）聚合的有效性——回答"哪种行为改变最有效"（观察性 A/B：
 *    同一"处理"(签名)下 improved vs regressed 的对比即处理效应）。
 *  - byCohort：按稳定 cohort（treatment/control）拆分的有效性——为随机留出(holdout)式 A/B 提供分析骨架。
 *
 * 说明：真正的随机留出（control 组跳过自适应）会使 control 组暂时不受益，属产品/安全决策，默认不启用；
 * `resolveWorkingStyleCohort` 提供稳定分组原语，启用留出后 byCohort 对比才成为真正的随机 A/B。
 */

export type WorkingStyleEffectStatus = "improved" | "regressed" | "inconclusive";

export type WorkingStyleEffectivenessInput = {
  agentId: string;
  appliedDelta: Record<string, unknown>;
  status: WorkingStyleEffectStatus | null;
  deltaScore: number | null;
  rolledBack: boolean;
};

export type WorkingStyleEffectivenessBucket = {
  total: number;
  improved: number;
  regressed: number;
  inconclusive: number;
  rolledBack: number;
  /** improved / (improved + regressed)；无结论样本 → null。 */
  improvedRate: number | null;
  /** 已评估样本的平均 deltaScore；无则 null。 */
  avgDeltaScore: number | null;
};

export type WorkingStyleSignatureStats = WorkingStyleEffectivenessBucket & {
  signature: string;
  /** (improved - regressed) / total ∈ [-1, 1]。 */
  netEffectiveness: number;
};

export type WorkingStyleCohort = "treatment" | "control";

export type WorkingStyleEffectivenessAggregate = {
  overall: WorkingStyleEffectivenessBucket;
  bySignature: WorkingStyleSignatureStats[];
  byCohort: Record<WorkingStyleCohort, WorkingStyleEffectivenessBucket>;
};

/** delta 的规范签名（键排序 + key=value 拼接），作为"哪种行为改变"的聚合键。 */
export function workingStyleDeltaSignature(delta: Record<string, unknown>): string {
  const keys = Object.keys(delta)
    .filter((key) => delta[key] !== undefined && delta[key] !== null)
    .toSorted();
  if (keys.length === 0) {
    return "(none)";
  }
  return keys.map((key) => `${key}=${String(delta[key])}`).join(";");
}

/**
 * 稳定 cohort 分配（FNV-1a 哈希 agentId → [0,1)）：< controlFraction 归 control，否则 treatment。
 * 稳定 = 同一 agent 始终同组，便于长期 A/B。controlFraction≤0 时全部 treatment。
 */
export function resolveWorkingStyleCohort(
  agentId: string,
  controlFraction = 0.1,
): WorkingStyleCohort {
  const fraction = Math.max(0, Math.min(1, controlFraction));
  if (fraction <= 0) {
    return "treatment";
  }
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i += 1) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = ((hash >>> 0) % 10000) / 10000;
  return normalized < fraction ? "control" : "treatment";
}

/** 累加一条记录到可变累加器（内部用；improvedRate/avgDeltaScore 在 finalize 时算）。 */
type BucketAccumulator = {
  total: number;
  improved: number;
  regressed: number;
  inconclusive: number;
  rolledBack: number;
  deltaSum: number;
  deltaCount: number;
};

function newAccumulator(): BucketAccumulator {
  return {
    total: 0,
    improved: 0,
    regressed: 0,
    inconclusive: 0,
    rolledBack: 0,
    deltaSum: 0,
    deltaCount: 0,
  };
}

function accumulate(acc: BucketAccumulator, item: WorkingStyleEffectivenessInput): void {
  acc.total += 1;
  if (item.status === "improved") {
    acc.improved += 1;
  } else if (item.status === "regressed") {
    acc.regressed += 1;
  } else if (item.status === "inconclusive") {
    acc.inconclusive += 1;
  }
  if (item.rolledBack) {
    acc.rolledBack += 1;
  }
  if (typeof item.deltaScore === "number" && Number.isFinite(item.deltaScore)) {
    acc.deltaSum += item.deltaScore;
    acc.deltaCount += 1;
  }
}

function finalizeBucket(acc: BucketAccumulator): WorkingStyleEffectivenessBucket {
  const conclusive = acc.improved + acc.regressed;
  return {
    total: acc.total,
    improved: acc.improved,
    regressed: acc.regressed,
    inconclusive: acc.inconclusive,
    rolledBack: acc.rolledBack,
    improvedRate: conclusive > 0 ? acc.improved / conclusive : null,
    avgDeltaScore: acc.deltaCount > 0 ? acc.deltaSum / acc.deltaCount : null,
  };
}

/** 聚合跨 agent 的行为改变有效性。 */
export function aggregateWorkingStyleEffectiveness(
  items: WorkingStyleEffectivenessInput[],
  opts?: { controlFraction?: number },
): WorkingStyleEffectivenessAggregate {
  const overall = newAccumulator();
  const bySignature = new Map<string, BucketAccumulator>();
  const treatment = newAccumulator();
  const control = newAccumulator();

  for (const item of items) {
    accumulate(overall, item);

    const signature = workingStyleDeltaSignature(item.appliedDelta);
    const sigAcc = bySignature.get(signature) ?? newAccumulator();
    accumulate(sigAcc, item);
    bySignature.set(signature, sigAcc);

    const cohort = resolveWorkingStyleCohort(item.agentId, opts?.controlFraction);
    accumulate(cohort === "control" ? control : treatment, item);
  }

  const signatureStats: WorkingStyleSignatureStats[] = [...bySignature.entries()]
    .map(([signature, acc]) => ({
      signature,
      ...finalizeBucket(acc),
      netEffectiveness: acc.total > 0 ? (acc.improved - acc.regressed) / acc.total : 0,
    }))
    // 有效性高者在前；并列则样本多者在前。
    .toSorted((left, right) =>
      right.netEffectiveness !== left.netEffectiveness
        ? right.netEffectiveness - left.netEffectiveness
        : right.total - left.total,
    );

  return {
    overall: finalizeBucket(overall),
    bySignature: signatureStats,
    byCohort: { treatment: finalizeBucket(treatment), control: finalizeBucket(control) },
  };
}
