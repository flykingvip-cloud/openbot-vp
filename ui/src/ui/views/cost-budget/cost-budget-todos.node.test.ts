import { describe, expect, it } from "vitest";
import { buildCostBudgetTodos } from "./cost-budget-todos.ts";

const baseInput = {
  subscription: null,
  allocation: null,
  seats: null,
  budget: null,
  forecast: null,
  dashboard: null,
};

describe("buildCostBudgetTodos", () => {
  it("prompts subscribe when no subscription", () => {
    const todos = buildCostBudgetTodos(baseInput);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.kind).toBe("subscribe");
    expect(todos[0]?.navigate).toEqual({ route: "plan-orders", planOrdersPanel: "catalog" });
  });

  it("uses pendingOrders only for pending payment todo", () => {
    const todos = buildCostBudgetTodos({
      ...baseInput,
      subscription: {
        subscription: { planId: "p1", status: "pending_payment" } as never,
        pendingOrders: [{ id: "ord-1", amountCents: 100, status: "pending_payment" } as never],
      } as never,
      allocation: { subscribed: true } as never,
      seats: { seats: [{ seatId: "s1" } as never], intervals: [] },
    });
    expect(todos.some((row) => row.kind === "pending_payment")).toBe(true);
    const pending = todos.find((row) => row.kind === "pending_payment");
    expect(pending?.orderId).toBe("ord-1");
    expect(pending?.navigate).toEqual({
      route: "plan-orders",
      planOrdersPanel: "orders",
      hash: "#orders",
    });
  });

  it("suggests seat assignment when subscribed with zero seats", () => {
    const todos = buildCostBudgetTodos({
      ...baseInput,
      subscription: {
        subscription: { planId: "p1", status: "active" } as never,
        pendingOrders: [],
      } as never,
      allocation: { subscribed: true } as never,
      seats: { seats: [], intervals: [] },
    });
    const assign = todos.find((row) => row.kind === "assign_seats");
    expect(assign).toBeTruthy();
    expect(assign?.navigate).toEqual({ route: "seats" });
  });

  it("adds budget alert from forecast threshold", () => {
    const todos = buildCostBudgetTodos({
      ...baseInput,
      subscription: {
        subscription: { planId: "p1", status: "active" } as never,
        pendingOrders: [],
      } as never,
      allocation: { subscribed: true } as never,
      seats: { seats: [{ seatId: "s1" } as never], intervals: [] },
      budget: {
        budget: { monthlyLimitCents: 10000, alertThreshold: 0.8, controls: {} as never } as never,
        history: [],
      },
      forecast: { forecastCostCents: 9500, monthlyCredits: 0 } as never,
    });
    const alert = todos.find((row) => row.kind === "budget_alert");
    expect(alert).toBeTruthy();
    expect(alert?.navigate).toEqual({
      route: "settings",
      settingsPanel: "budget",
      hash: "#budget",
    });
  });
});
