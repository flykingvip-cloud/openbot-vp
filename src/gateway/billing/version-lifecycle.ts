/**
 * PlanVersion 生命周期纯函数（framework-free，可属性测试）。
 *
 * 控制平面核心：把版本状态机抽成确定性纯函数，供 store / handler / UI 复用一致逻辑。
 * - 状态机单向不可逆：`draft → active → deprecated`（R24 / Property 14）。
 * - 单一 active 不变量：激活某版本时原 active 原子降级 deprecated（R25 / Property 15）。
 * - 定价 diff：后端计算，UI 不自行 diff（R 建议）。
 *
 * 注意：幂等（requestId）语义不在纯函数内，由 store 层「同 requestId 事件已存在则短路」兜底。
 */

import type {
  PlanPricing,
  PlanVersion,
  PlanVersionStatus,
  PricingDiff,
  PricingDiffEntry,
} from "./types.js";

/** 非法状态流转。 */
export class InvalidVersionTransitionError extends Error {
  constructor(
    public readonly from: PlanVersionStatus,
    public readonly to: PlanVersionStatus,
  ) {
    super(`invalid plan version transition: ${from} → ${to}`);
    this.name = "InvalidVersionTransitionError";
  }
}

/** 合法流转集合：draft→active、active→deprecated（其余/自反/逆向均非法）。 */
const VALID_TRANSITIONS: ReadonlyArray<[PlanVersionStatus, PlanVersionStatus]> = [
  ["draft", "active"],
  ["active", "deprecated"],
];

/** 判定一个状态流转是否合法（纯函数，确定性）。 */
export function isValidTransition(from: PlanVersionStatus, to: PlanVersionStatus): boolean {
  return VALID_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** 校验流转合法，否则抛 {@link InvalidVersionTransitionError}（R24.2 / Property 14）。 */
export function assertValidTransition(from: PlanVersionStatus, to: PlanVersionStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidVersionTransitionError(from, to);
  }
}

export type VersionStatusOp =
  | { kind: "activate"; versionId: string }
  | { kind: "deprecate"; versionId: string };

export type ReduceResult = {
  /** 归约后的版本集合（仅 status/时间线字段可能变化，pricing/不可变字段保持）。 */
  versions: PlanVersion[];
  /** 本次产生的状态流转（供 store 写 append-only 事件）。 */
  transitions: Array<{ versionId: string; from: PlanVersionStatus; to: PlanVersionStatus }>;
};

/**
 * 对某 Plan 的全部版本应用一次状态操作，返回归约后的整体版本集合（整体读-归约-写回）。
 *
 * - activate(v)：把该 Plan 既有 active 版本降级为 deprecated，目标 v（须为 draft）置为 active；
 *   保证操作后至多一个 active（Single_Active_Invariant，R25.1/25.2 / Property 15）。
 * - deprecate(v)：把 active 版本 v 置为 deprecated。
 *
 * 纯函数：不修改入参，不含 IO/幂等/锁语义。所有流转经 `assertValidTransition` 校验，
 * 非法流转抛错。`occurredAt` 由调用方注入以保持确定性。
 */
export function reduceVersionStatuses(
  versions: readonly PlanVersion[],
  op: VersionStatusOp,
  occurredAt: string,
): ReduceResult {
  const target = versions.find((v) => v.id === op.versionId);
  if (!target) {
    throw new Error(`plan version not found: ${op.versionId}`);
  }
  const transitions: ReduceResult["transitions"] = [];

  if (op.kind === "activate") {
    // 目标必须从 draft 流转到 active（assertValidTransition 会拒绝 active/deprecated 再激活）。
    assertValidTransition(target.status, "active");
    const next = versions.map((v) => {
      if (v.id === target.id) {
        transitions.push({ versionId: v.id, from: v.status, to: "active" });
        return { ...v, status: "active" as const, activatedAt: occurredAt };
      }
      // 同 Plan 的既有 active → deprecated（原子降级）。
      if (v.planId === target.planId && v.status === "active") {
        assertValidTransition(v.status, "deprecated");
        transitions.push({ versionId: v.id, from: v.status, to: "deprecated" });
        return { ...v, status: "deprecated" as const, deprecatedAt: occurredAt };
      }
      return v;
    });
    return { versions: next, transitions };
  }

  // deprecate
  assertValidTransition(target.status, "deprecated");
  const next = versions.map((v) => {
    if (v.id === target.id) {
      transitions.push({ versionId: v.id, from: v.status, to: "deprecated" });
      return { ...v, status: "deprecated" as const, deprecatedAt: occurredAt };
    }
    return v;
  });
  return { versions: next, transitions };
}

/** 统计某 Plan 的 active 版本数（不变量校验用）。 */
export function countActiveVersions(versions: readonly PlanVersion[], planId: string): number {
  return versions.filter((v) => v.planId === planId && v.status === "active").length;
}

// ─────────────────────────────────────────────────────────────────────────
// 定价差异（后端计算，UI 只展示）
// ─────────────────────────────────────────────────────────────────────────

function pricingKey(p: Pick<PlanPricing, "type" | "key">): string {
  return `${p.type}/${p.key}`;
}

/**
 * 比较两个版本的定价快照，产出差异（added/removed/changed/unchanged）。
 * 纯函数；entries 按 `type/key` 稳定排序，保证确定性。
 */
export function comparePlanVersions(from: PlanVersion, to: PlanVersion): PricingDiff {
  const fromMap = new Map(from.snapshot.pricing.map((p) => [pricingKey(p), p.priceCents]));
  const toMap = new Map(to.snapshot.pricing.map((p) => [pricingKey(p), p.priceCents]));
  const allKeys = [...new Set([...fromMap.keys(), ...toMap.keys()])].toSorted();
  const entries: PricingDiffEntry[] = allKeys.map((k) => {
    const [type, key] = k.split("/") as [PricingDiffEntry["type"], string];
    const oldPriceCents = fromMap.has(k) ? (fromMap.get(k) as number) : null;
    const newPriceCents = toMap.has(k) ? (toMap.get(k) as number) : null;
    let change: PricingDiffEntry["change"];
    if (oldPriceCents === null) {
      change = "added";
    } else if (newPriceCents === null) {
      change = "removed";
    } else if (oldPriceCents !== newPriceCents) {
      change = "changed";
    } else {
      change = "unchanged";
    }
    return { type, key, oldPriceCents, newPriceCents, change };
  });
  return { fromVersionId: from.id, toVersionId: to.id, entries };
}
