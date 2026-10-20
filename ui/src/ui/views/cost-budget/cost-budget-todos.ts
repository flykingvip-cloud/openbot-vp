/**
 * 总览待办区 — 纯前端规则推导（不扩 loadAll / 不新增 RPC）。
 */

import type {
  AllocationOverviewResponse,
  BudgetGetResponse,
  ConsumptionForecast,
  DashboardResponse,
  SeatListResponse,
  SubscriptionGetResponse,
} from "../../capability/cost-budget-billing/index.ts";
import type { CostBudgetV2NavigateTarget } from "../cost-budget-v2/shell/cost-budget-v2-routes.ts";

export type CostBudgetTodoKind = "subscribe" | "pending_payment" | "assign_seats" | "budget_alert";

export type CostBudgetTodo = {
  kind: CostBudgetTodoKind;
  /** i18n key under costBudget.todos.* */
  messageKey: string;
  navigate: CostBudgetV2NavigateTarget;
  /** pending_payment 时跳转 orders 并预选订单。 */
  orderId?: string;
};

export type CostBudgetTodoInput = {
  subscription: SubscriptionGetResponse | null;
  allocation: AllocationOverviewResponse | null;
  seats: SeatListResponse | null;
  budget: BudgetGetResponse | null;
  forecast: ConsumptionForecast | null;
  dashboard: DashboardResponse | null;
};

function hasBudgetAlert(input: CostBudgetTodoInput): boolean {
  const budget = input.budget?.budget;
  const forecast = input.forecast;
  if (budget && forecast?.forecastCostCents != null && budget.monthlyLimitCents > 0) {
    if (forecast.forecastCostCents >= budget.monthlyLimitCents * 0.9) {
      return true;
    }
  }
  const level = input.dashboard?.budgetStatus.level;
  return level === "alert" || level === "exceeded";
}

function needsSeatAssignment(input: CostBudgetTodoInput): boolean {
  if (!input.allocation?.subscribed) {
    return false;
  }
  if (!input.subscription?.subscription) {
    return false;
  }
  return (input.seats?.seats?.length ?? 0) === 0;
}

/** 待支付订单仅消费 subscription.pendingOrders。 */
export function buildCostBudgetTodos(input: CostBudgetTodoInput): CostBudgetTodo[] {
  const todos: CostBudgetTodo[] = [];

  if (!input.subscription?.subscription) {
    todos.push({
      kind: "subscribe",
      messageKey: "subscribe",
      navigate: { route: "plan-orders", planOrdersPanel: "catalog" },
    });
    return todos;
  }

  const pending = input.subscription.pendingOrders ?? [];
  if (pending.length > 0) {
    todos.push({
      kind: "pending_payment",
      messageKey: "pendingPayment",
      navigate: { route: "plan-orders", planOrdersPanel: "orders", hash: "#orders" },
      orderId: pending[0]?.id,
    });
  }

  if (needsSeatAssignment(input)) {
    todos.push({
      kind: "assign_seats",
      messageKey: "assignSeats",
      navigate: { route: "seats" },
    });
  }

  if (hasBudgetAlert(input)) {
    todos.push({
      kind: "budget_alert",
      messageKey: "budgetAlert",
      navigate: { route: "settings", settingsPanel: "budget", hash: "#budget" },
    });
  }

  return todos;
}
