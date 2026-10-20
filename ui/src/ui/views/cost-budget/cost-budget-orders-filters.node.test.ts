import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
  filterCommercialOrders,
  hasActiveCommercialOrdersListFilter,
} from "./cost-budget-orders-filters.ts";

const SAMPLE_ORDERS = [
  {
    id: "ord-paid-1",
    kind: "subscribe",
    status: "paid",
    amountCents: 9900,
    createdAt: "2026-06-22T04:59:54.000Z",
    lineItems: [{ label: "旗舰版 · monthly", amountCents: 9900 }],
  },
  {
    id: "ord-pending-1",
    kind: "change_plan",
    status: "pending_payment",
    amountCents: 1200,
    createdAt: "2026-06-19T08:00:00.000Z",
    lineItems: [{ label: "专业版 · monthly", amountCents: 1200 }],
  },
  {
    id: "ord-cancel-1",
    kind: "renew",
    status: "canceled",
    amountCents: 0,
    createdAt: "2026-06-10T08:00:00.000Z",
    lineItems: [{ label: "基础版 · monthly", amountCents: 0 }],
  },
];

describe("cost-budget-orders-filters", () => {
  it("filters by search query across order id and plan name", () => {
    const result = filterCommercialOrders([...SAMPLE_ORDERS], {
      ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
      searchQuery: "旗舰",
    });
    expect(result.map((order) => order.id)).toEqual(["ord-paid-1"]);
  });

  it("filters by status", () => {
    const result = filterCommercialOrders([...SAMPLE_ORDERS], {
      ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
      statusFilter: "pending_payment",
    });
    expect(result.map((order) => order.id)).toEqual(["ord-pending-1"]);
  });

  it("filters by created date range", () => {
    const result = filterCommercialOrders([...SAMPLE_ORDERS], {
      ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
      dateFrom: "2026-06-20",
      dateTo: "2026-06-30",
    });
    expect(result.map((order) => order.id)).toEqual(["ord-paid-1"]);
  });

  it("detects active filters", () => {
    expect(hasActiveCommercialOrdersListFilter(DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER)).toBe(false);
    expect(
      hasActiveCommercialOrdersListFilter({
        ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
        searchQuery: "OB",
      }),
    ).toBe(true);
  });
});
