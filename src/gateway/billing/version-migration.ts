/**
 * 版本生命周期一次性迁移（纯函数核心，framework-free，可测试）。
 *
 * 兼容既有数据（R27.1 / R27.2）：
 * - PlanVersion 缺 `status`：匹配 Plan `currentVersionId` 的版本置 active，其余 deprecated。
 * - Subscription 缺 `planVersionId`：绑定其**创建时点**对应的版本；无法精确判定时
 *   绑定迁移时的 active 版本并标记 `migratedBinding=true`。
 *
 * 重要：运行时**不做隐式回退**（R27.3）。此处仅供一次性迁移脚本调用。
 * 历史账单不变量（R27.5）：迁移只补绑缺失字段，不改写已锁定 `planVersionId` 的订阅。
 */

import type { Plan, PlanVersion, Subscription } from "./types.js";

export type PlansStoreShape = {
  plans: Record<string, Plan>;
  planVersions: PlanVersion[];
};

export type SubscriptionsStoreShape = {
  subscriptions: Record<string, Subscription>;
};

export type VersionMigrationReport = {
  normalizedVersions: number;
  boundSubscriptions: number;
  migratedBindings: number;
  unresolvable: number;
};

/**
 * 归一化 PlanVersion 状态（R27.1）。返回是否有变更 + 变更计数。
 * 仅处理缺 `status` 的旧记录；已有 status 不触碰。
 */
export function normalizePlanVersionStatuses(store: PlansStoreShape): {
  changed: boolean;
  count: number;
} {
  let count = 0;
  for (const v of store.planVersions) {
    if (v.status === undefined) {
      const plan = store.plans[v.planId];
      v.status = plan?.currentVersionId === v.id ? "active" : "deprecated";
      count += 1;
    }
  }
  return { changed: count > 0, count };
}

/** 取某 Plan 在 `at` 时点（含）之前创建的、最接近的版本（按 createdAt 倒序首个）。 */
function resolveVersionAtTime(
  versions: readonly PlanVersion[],
  planId: string,
  at: string,
): PlanVersion | null {
  const candidates = versions
    .filter((v) => v.planId === planId && v.createdAt <= at)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return candidates[0] ?? null;
}

/** 取某 Plan 当前 active 版本（迁移兜底用）。 */
function resolveActiveVersion(
  versions: readonly PlanVersion[],
  planId: string,
): PlanVersion | null {
  return versions.find((v) => v.planId === planId && v.status === "active") ?? null;
}

/**
 * 为缺 `planVersionId` 的订阅补绑版本（R27.2）。
 * - 优先按订阅 `createdAt`/`startTime` 解析创建时点版本；
 * - 否则绑定 active 版本并标 `migratedBinding=true`；
 * - 完全无法解析（plan 无任何版本）→ 计入 unresolvable，不改动。
 */
export function bindSubscriptionVersions(
  subStore: SubscriptionsStoreShape,
  plansStore: PlansStoreShape,
): {
  changed: boolean;
  report: Pick<VersionMigrationReport, "boundSubscriptions" | "migratedBindings" | "unresolvable">;
} {
  let boundSubscriptions = 0;
  let migratedBindings = 0;
  let unresolvable = 0;
  for (const sub of Object.values(subStore.subscriptions)) {
    if (sub.planVersionId) {
      continue; // 已锁定，绝不改写（R27.5）
    }
    const at = sub.createdAt ?? sub.startTime;
    const atVersion = at ? resolveVersionAtTime(plansStore.planVersions, sub.planId, at) : null;
    if (atVersion) {
      sub.planVersionId = atVersion.id;
      boundSubscriptions += 1;
      continue;
    }
    const active = resolveActiveVersion(plansStore.planVersions, sub.planId);
    if (active) {
      sub.planVersionId = active.id;
      sub.migratedBinding = true;
      boundSubscriptions += 1;
      migratedBindings += 1;
      continue;
    }
    unresolvable += 1;
  }
  return {
    changed: boundSubscriptions > 0,
    report: { boundSubscriptions, migratedBindings, unresolvable },
  };
}

/** 应用全部迁移到内存中的 store 副本，返回报告。调用方负责持久化。 */
export function migrateVersionLifecycle(
  plansStore: PlansStoreShape,
  subStore: SubscriptionsStoreShape,
): VersionMigrationReport {
  const norm = normalizePlanVersionStatuses(plansStore);
  const bind = bindSubscriptionVersions(subStore, plansStore);
  return {
    normalizedVersions: norm.count,
    boundSubscriptions: bind.report.boundSubscriptions,
    migratedBindings: bind.report.migratedBindings,
    unresolvable: bind.report.unresolvable,
  };
}
