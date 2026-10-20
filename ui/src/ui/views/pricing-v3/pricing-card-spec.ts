import type { PricingPlanViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import type { IconName } from "../../icons.ts";

export type PricingSpecItem = {
  icon: IconName;
  label: string;
  value?: string;
};

/**
 * "custom" 在 view-model 中表示「非固定数字」。
 * - contactSales / 卓越版：展示「定制」
 * - 旗舰/专业等自助档的无限配额：展示「无限」（禁止误显示成定制版）
 */
function formatCount(
  value: number | "custom",
  unit: string,
  mode: "contact" | "self_serve",
): string {
  if (value === "custom") {
    return mode === "contact" ? `定制${unit}` : `无限${unit}`;
  }
  return `${value}${unit}`;
}

function formatMetric(
  value: number | "custom" | undefined,
  unit: string,
  mode: "contact" | "self_serve",
): string | undefined {
  if (value == null) {
    return undefined;
  }
  return formatCount(value, unit, mode);
}

function formatCredits(value: number | undefined): string | undefined {
  if (value == null || value <= 0) {
    return undefined;
  }
  return `${value.toLocaleString("zh-CN")} Credits`;
}

export function resolveSlotSubtitleBadge(plan: PricingPlanViewModel): string | undefined {
  // Prefer explicit recommended badge; strip emoji-only decoration for visual control
  if (plan.recommended) {
    const badge = plan.badge?.replace(/^[✨\s]+/, "").trim();
    return badge && badge.length > 0 ? badge : "推荐";
  }
  return plan.badge?.replace(/^[✨\s]+/, "").trim() || undefined;
}

/**
 * Card core specs — only runtime-enforced commercial capacity.
 * No SLA / support / isolation promises (not fulfillment-backed).
 */
export function buildPricingSpecItems(plan: PricingPlanViewModel): PricingSpecItem[] {
  const mode: "contact" | "self_serve" =
    plan.contactSales || plan.slot === "enterprise" ? "contact" : "self_serve";

  const seats = formatMetric(plan.metrics.seats, " 个", mode) ?? "—";
  const bots = formatMetric(plan.metrics.aiEmployees, " 个", mode) ?? "—";
  const authLabel = plan.aiAuthorizationLabel?.trim() || "—";
  const credits = formatCredits(plan.metrics.creditsMonthly) ?? "—";
  const concurrency = formatMetric(plan.metrics.concurrentRuns, " 路", mode) ?? "—";
  const overage =
    plan.cardFields?.overagePolicy === "custom"
      ? "按需配置"
      : plan.cardFields?.overagePolicy?.trim() || "超额阻断";

  // Fixed order & count → equal card geometry across tiers
  return [
    { icon: "users", label: "团队席位", value: seats },
    { icon: "sparkles", label: "AI 员工数", value: bots },
    { icon: "layers", label: "AI 授权", value: authLabel },
    { icon: "barChart", label: "月度 Credits", value: credits },
    { icon: "zap", label: "并发数", value: concurrency },
    { icon: "shield", label: "超额策略", value: overage },
  ];
}
