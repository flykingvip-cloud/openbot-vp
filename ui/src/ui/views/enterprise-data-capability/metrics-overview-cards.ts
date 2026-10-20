/**
 * 企业数据能力中心 — 指标概览（总览仅 5 个核心 KPI）。
 */

import { type TemplateResult } from "lit";
import type { DataCapabilityDashboardSummary } from "../../capability/enterprise-data-capability/types.ts";
import { type EnterpriseKpiItem, renderEnterpriseKpiGrid } from "../enterprise-kpi-card.ts";

export type DataCapabilityKpiDrilldown = "sources" | "capabilities" | "authorization" | "approvals";

export type MetricsOverviewCardsProps = {
  summary: DataCapabilityDashboardSummary | null;
  loading: boolean;
  error: string | null;
  /** 同页切换一级/子区。不传时仍保留 hash href，供直接打开深链。 */
  onDrilldown?: (target: DataCapabilityKpiDrilldown) => void;
  /** @deprecated 总览不再合并投影/血缘指标；保留字段以免破坏调用方编译。 */
  knowledgeSupply?: unknown;
  knowledgeSupplyLoading?: boolean;
  lineageOverview?: unknown;
  lineageOverviewLoading?: boolean;
};

function metricValue(loading: boolean, value: number | null): string {
  if (value !== null) {
    return String(value);
  }
  return loading ? "…" : "—";
}

function drilldownHandlers(
  target: DataCapabilityKpiDrilldown,
  onDrilldown: MetricsOverviewCardsProps["onDrilldown"],
): Pick<EnterpriseKpiItem, "onSelect"> {
  if (!onDrilldown) {
    return {};
  }
  return {
    onSelect: () => onDrilldown(target),
  };
}

export function renderMetricsOverviewCards(props: MetricsOverviewCardsProps): TemplateResult {
  const s = props.summary;
  const items: EnterpriseKpiItem[] = [
    {
      label: "数据源",
      value: metricValue(props.loading, s?.totalDataSources ?? null),
      href: "#sources",
      drilldown: "前往数据资产",
      ...drilldownHandlers("sources", props.onDrilldown),
    },
    {
      label: "可用数据产品",
      value: metricValue(props.loading, s?.totalCapabilities ?? null),
      href: "#capabilities",
      drilldown: "前往数据产品",
      ...drilldownHandlers("capabilities", props.onDrilldown),
    },
    {
      // summary 当前仅权威提供开放部门数；岗位级开放在授权矩阵查看。
      label: "开放部门",
      value: metricValue(props.loading, s?.totalDepartments ?? null),
      href: "#authorization",
      drilldown: "前往权限与治理",
      ...drilldownHandlers("authorization", props.onDrilldown),
    },
    {
      label: "知识对象",
      value: metricValue(props.loading, s?.knowledgeObjectCount ?? null),
      href: "#capabilities",
      drilldown: "查看数据产品产出",
      ...drilldownHandlers("capabilities", props.onDrilldown),
    },
    {
      label: "待审批",
      value: metricValue(props.loading, s?.pendingApprovals ?? null),
      href: "#approvals",
      drilldown: "前往待审批",
      tone: (s?.pendingApprovals ?? 0) > 0 ? "warn" : "neutral",
      ...drilldownHandlers("approvals", props.onDrilldown),
    },
  ];

  return renderEnterpriseKpiGrid(items);
}
