import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan } from "../../../capability/cost-budget-billing/endpoints.ts";
import { resolveAssignedSeatCount } from "../../cost-budget/assigned-seat-count.ts";
import { parseSubscriptionEntitlement } from "../../cost-budget/parse-subscription-entitlement.ts";
import {
  buildPlanCapacitySummary,
  type PlanCapacityEntitlement,
} from "../../cost-budget/plan-capacity-display.ts";
import {
  buildSubscribedCapacityUsageRows,
  renderPlanCapacityUsagePanel,
  type CapacityUsageRow,
} from "../../cost-budget/plan-capacity-usage-panel.ts";
import type { CostBudgetV2NavigateTarget } from "../shell/cost-budget-v2-routes.ts";
import type { OperationsStoreState } from "../stores/operations-store.ts";
import { getSubscriptionStoreState } from "../stores/subscription-store.ts";

export type OverviewPlanContext = {
  plan: Plan | null;
  entitlementSnapshot?: unknown;
  allowedTiers?: readonly string[];
  assignedSeats: number;
  entitledModelCount: number;
  seats: ReadonlyArray<{ grantedModelCount: number }>;
  usedBots: number;
  botQuota: number;
  concurrencyUsed: number;
  concurrencyLimit: number;
  creditsConsumed: number | null;
  creditsLimit: number | null;
  contractStart?: string | null;
  contractEnd?: string | null;
};

export type OverviewSubscribedSnapshotOptions = {
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
};

function fmtContractDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

export function buildOverviewPlanContext(ops: OperationsStoreState): OverviewPlanContext | null {
  const subscription = getSubscriptionStoreState().data;
  if (!subscription?.subscription || !subscription.planView) {
    return null;
  }
  const allocation = ops.allocation;
  const resources = ops.resources;
  return {
    plan: subscription.planView,
    entitlementSnapshot: subscription.entitlementSnapshot,
    allowedTiers: allocation?.ceiling.allowedTiers ?? [],
    assignedSeats: resolveAssignedSeatCount({
      allocationSeats: allocation?.seats,
      rosterSeats: ops.seats?.seats,
    }),
    entitledModelCount: allocation?.ceiling.entitledModelCount ?? 0,
    seats: allocation?.seats ?? [],
    usedBots: resources?.usedBots ?? 0,
    botQuota: resources?.quota ?? subscription.planView.botQuota,
    concurrencyUsed: resources?.concurrencyUsed ?? 0,
    concurrencyLimit: resources?.concurrencyLimit ?? 0,
    creditsConsumed: subscription.creditsStatus?.creditsConsumed ?? null,
    creditsLimit:
      subscription.creditsStatus?.monthlyCredits ?? allocation?.ceiling.monthlyCredits ?? null,
    contractStart: subscription.subscription.commercialContract?.contractStart ?? null,
    contractEnd: subscription.subscription.commercialContract?.contractEnd ?? null,
  };
}

export function buildOverviewUsageRows(input: OverviewPlanContext): CapacityUsageRow[] {
  if (!input.plan) {
    return [];
  }
  const entitlement = parseSubscriptionEntitlement(input.entitlementSnapshot) ?? {};
  const mergedEntitlement: PlanCapacityEntitlement = {
    ...entitlement,
    allowedTiers:
      entitlement.allowedTiers && entitlement.allowedTiers.length > 0
        ? entitlement.allowedTiers
        : input.allowedTiers
          ? [...input.allowedTiers]
          : undefined,
  };
  const capacity = buildPlanCapacitySummary({ plan: input.plan, entitlement: mergedEntitlement });
  const seatLimit = capacity.teamMembers;
  const botLimit = input.botQuota > 0 ? input.botQuota : capacity.aiEmployees;
  const concurrencyLimit =
    input.concurrencyLimit > 0 ? input.concurrencyLimit : capacity.concurrentRuns;
  return buildSubscribedCapacityUsageRows({
    assignedSeats: input.assignedSeats,
    seatLimit,
    usedBots: input.usedBots,
    botLimit,
    concurrencyUsed: input.concurrencyUsed,
    concurrencyLimit,
    creditsConsumed: input.creditsConsumed,
    creditsLimit: input.creditsLimit ?? capacity.monthlyCredits,
  });
}

export function resolveOverviewPlanName(input: OverviewPlanContext): string {
  if (!input.plan) {
    return "—";
  }
  const entitlement = parseSubscriptionEntitlement(input.entitlementSnapshot) ?? {};
  const mergedEntitlement: PlanCapacityEntitlement = {
    ...entitlement,
    allowedTiers:
      entitlement.allowedTiers && entitlement.allowedTiers.length > 0
        ? entitlement.allowedTiers
        : input.allowedTiers
          ? [...input.allowedTiers]
          : undefined,
  };
  return buildPlanCapacitySummary({ plan: input.plan, entitlement: mergedEntitlement }).planName;
}

export function renderOverviewPlanPanel(
  input: OverviewPlanContext,
  options: OverviewSubscribedSnapshotOptions,
): TemplateResult {
  if (!input.plan) {
    return html``;
  }
  const planName = resolveOverviewPlanName(input);
  const entitlement = parseSubscriptionEntitlement(input.entitlementSnapshot) ?? {};
  const mergedEntitlement: PlanCapacityEntitlement = {
    ...entitlement,
    allowedTiers:
      entitlement.allowedTiers && entitlement.allowedTiers.length > 0
        ? entitlement.allowedTiers
        : input.allowedTiers
          ? [...input.allowedTiers]
          : undefined,
  };
  const capacity = buildPlanCapacitySummary({ plan: input.plan, entitlement: mergedEntitlement });
  const seatLimit = capacity.teamMembers;
  const navigate = options.onNavigate;

  const chips: TemplateResult[] = [];
  if (seatLimit > 0) {
    chips.push(html`
      <span class="cost-budget-v2-overview-chip">
        ${t("costBudget.v2.overviewSnapshot.seatsSummary", {
          used: input.assignedSeats,
          total: seatLimit,
        })}
      </span>
    `);
  }
  if (input.creditsLimit != null && input.creditsLimit > 0) {
    chips.push(html`
      <span class="cost-budget-v2-overview-chip">
        ${t("costBudget.v2.overviewSnapshot.creditsSummary", {
          remaining: Math.max(0, input.creditsLimit - (input.creditsConsumed ?? 0)),
          total: input.creditsLimit,
        })}
      </span>
    `);
  }
  if (input.contractEnd) {
    chips.push(html`
      <span class="cost-budget-v2-overview-chip cost-budget-v2-overview-chip--muted">
        ${t("costBudget.renew.contractWindow")} ${fmtContractDate(input.contractEnd)}
      </span>
    `);
  }

  return html`
    <div class="cost-budget-v2-overview-plan" data-testid="cost-budget-v2-overview-plan">
      <div class="cost-budget-v2-overview-plan__identity">
        <span class="cost-budget-v2-overview-plan__badge">${t("costBudget.v2.overviewSnapshot.planBadge")}</span>
        <h4 class="cost-budget-v2-overview-plan__name">${planName}</h4>
        ${
          chips.length > 0
            ? html`<div class="cost-budget-v2-overview-chip-row">${chips}</div>`
            : nothing
        }
      </div>
      <div class="cost-budget-v2-overview-plan__actions">
        <button
          type="button"
          class="btn btn--sm"
          data-testid="overview-open-plan-detail"
          @click=${() => navigate({ route: "plan-orders", planOrdersPanel: "plan", hash: "#plan" })}
        >
          ${t("costBudget.v2.overviewSnapshot.planDetail")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="overview-change-plan"
          @click=${() => navigate({ route: "plan-orders", planOrdersPanel: "catalog" })}
        >
          ${t("costBudget.v2.planOrders.changePlan")}
        </button>
      </div>
    </div>
  `;
}

export function renderOverviewUsagePanel(rows: readonly CapacityUsageRow[]): TemplateResult {
  if (rows.length === 0) {
    return html`
      <div class="enterprise-hint">${t("costBudget.v2.overviewSnapshot.usageEmpty")}</div>
    `;
  }
  return html`
    <div class="cost-budget-v2-overview-usage" data-testid="cost-budget-v2-overview-usage">
      ${renderPlanCapacityUsagePanel(rows)}
    </div>
  `;
}
