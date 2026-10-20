/**
 * 总览「需要处理」队列 — 纯聚合（可单测）。
 */

import type {
  CapabilityUsageRow,
  DataSourceHealthRow,
  PendingApprovalItem,
} from "../../../../capability/enterprise-data-capability/types.ts";
import type {
  DataCapabilityPrimaryTab,
  GovernanceSubPanel,
  ProductsSubPanel,
} from "./section-routing.ts";

export type OverviewActionKind =
  | "source_health"
  | "projection_failure"
  | "pending_approval"
  | "capability_disabled"
  | "unmatched";

const SOURCE_HEALTH_DETAIL: Record<string, string> = {
  error: "异常",
  disconnected: "已断开",
  token_expiring: "Token 即将过期",
};

function sourceHealthDetail(status: string): string {
  return SOURCE_HEALTH_DETAIL[status] ?? status;
}

export type OverviewActionItem = {
  id: string;
  kind: OverviewActionKind;
  title: string;
  detail: string;
  primary: DataCapabilityPrimaryTab;
  productsSubPanel?: ProductsSubPanel;
  governanceSubPanel?: GovernanceSubPanel;
};

type OverviewSummarySlice = {
  pendingApprovals: number;
};

export function buildOverviewActionQueue(params: {
  summary: OverviewSummarySlice | null;
  sourceHealth: DataSourceHealthRow[] | null;
  pendingApprovals: PendingApprovalItem[] | null;
  capabilityRows: CapabilityUsageRow[] | null;
  materializationFailureCount: number | null;
}): OverviewActionItem[] {
  const items: OverviewActionItem[] = [];

  for (const row of params.sourceHealth ?? []) {
    if (
      row.status === "error" ||
      row.status === "disconnected" ||
      row.status === "token_expiring"
    ) {
      items.push({
        id: `source:${row.sourceId}`,
        kind: "source_health",
        title: `连接异常：${row.displayName}`,
        detail: sourceHealthDetail(row.status),
        primary: "assets",
      });
    }
  }

  if ((params.materializationFailureCount ?? 0) > 0) {
    items.push({
      id: "projection-failures",
      kind: "projection_failure",
      title: "投影物化失败",
      detail: `${params.materializationFailureCount} 条近期失败`,
      primary: "products",
      productsSubPanel: "outputs",
    });
  }

  const pending = params.pendingApprovals ?? [];
  if (pending.length > 0 || (params.summary?.pendingApprovals ?? 0) > 0) {
    const count = Math.max(pending.length, params.summary?.pendingApprovals ?? 0);
    items.push({
      id: "pending-approvals",
      kind: "pending_approval",
      title: "待审批",
      detail: `${count} 项待处理`,
      primary: "governance",
      governanceSubPanel: "approvals",
    });
  }

  for (const row of params.capabilityRows ?? []) {
    if (!row.enabled) {
      items.push({
        id: `cap-disabled:${row.capabilityId}`,
        kind: "capability_disabled",
        title: `已停用产品：${row.displayName}`,
        detail: "需复核开放范围或重新启用",
        primary: "products",
        productsSubPanel: "catalog",
      });
    }
  }

  return items.slice(0, 12);
}
