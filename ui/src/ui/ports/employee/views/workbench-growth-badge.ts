/**
 * Agent Growth OS — 员工端最小成长 badge（spec: agent-growth-lifecycle, P0B 8.3 / P1 10.2）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GrowthStatusView } from "../semantic/view-controller-facade.ts";

export type GrowthBadgeModel = {
  label: string;
  /** 语义状态，用于 CSS 着色与测试断言。 */
  tone: "growing" | "mission_ready" | "activated" | "evolution";
};

/** 由 GrowthStatusView 推导 badge 文案/语义（纯函数，便于单测）。 */
export function detectFalseReadyFromGrowthView(view: GrowthStatusView | null): boolean {
  if (!view || view.operationalScore === null) {
    return false;
  }
  return view.activationScore >= 90 && view.operationalScore < 30;
}

/** 由 GrowthStatusView 推导 badge 文案/语义（纯函数，便于单测）。 */
export function deriveGrowthBadgeModel(view: GrowthStatusView | null): GrowthBadgeModel | null {
  if (!view) {
    return null;
  }
  if (detectFalseReadyFromGrowthView(view)) {
    return {
      label: t("frontstage.workbench.growth.badge.falseReady"),
      tone: "mission_ready",
    };
  }
  switch (view.lifecycleState) {
    case "activated":
      return { label: t("frontstage.workbench.growth.badge.activated"), tone: "activated" };
    case "evolution":
      return { label: t("frontstage.workbench.growth.badge.evolution"), tone: "evolution" };
    case "mission_ready":
      return { label: t("frontstage.workbench.growth.badge.missionReady"), tone: "mission_ready" };
    case "birth":
    case "growing":
    default: {
      const pct = Math.max(0, Math.min(100, Math.round(view.activationScore)));
      return {
        label: t("frontstage.workbench.growth.badge.growing", { pct }),
        tone: "growing",
      };
    }
  }
}

/** 渲染只读成长 badge；无状态时渲染 nothing。 */
export function renderGrowthBadge(view: GrowthStatusView | null): TemplateResult | typeof nothing {
  const model = deriveGrowthBadgeModel(view);
  if (!model) {
    return nothing;
  }
  return html`<span
    class="workbench-growth-badge workbench-growth-badge--${model.tone}"
    data-growth-tone=${model.tone}
    title=${model.label}
    >${model.label}</span
  >`;
}
