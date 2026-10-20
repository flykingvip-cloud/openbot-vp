import type { CommercialOrderDetail } from "../../capability/cost-budget-billing/index.ts";
import {
  formatCommercialOrderNo,
  resolveCommercialOrderPlanName,
} from "./cost-budget-order-display.ts";

export type CommercialOrderStatusFilter = "all" | "paid" | "pending_payment" | "canceled";

export type CommercialOrdersListFilter = {
  searchQuery: string;
  statusFilter: CommercialOrderStatusFilter;
  dateFrom: string;
  dateTo: string;
};

export const DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER: CommercialOrdersListFilter = {
  searchQuery: "",
  statusFilter: "all",
  dateFrom: "",
  dateTo: "",
};

function orderCreatedDay(iso?: string): string | null {
  if (!iso) {
    return null;
  }
  try {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

function matchesSearch(order: CommercialOrderDetail, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const displayNo = formatCommercialOrderNo(order.id, order.createdAt).toLowerCase();
  const planName = resolveCommercialOrderPlanName(order).toLowerCase();
  const haystack = [order.id, displayNo, planName, order.kind].join(" ").toLowerCase();
  return haystack.includes(normalized);
}

function matchesStatus(
  order: CommercialOrderDetail,
  statusFilter: CommercialOrderStatusFilter,
): boolean {
  if (statusFilter === "all") {
    return true;
  }
  return order.status === statusFilter;
}

function matchesDateRange(order: CommercialOrderDetail, dateFrom: string, dateTo: string): boolean {
  const createdDay = orderCreatedDay(order.createdAt);
  if (!createdDay) {
    return !dateFrom && !dateTo;
  }
  if (dateFrom && createdDay < dateFrom) {
    return false;
  }
  if (dateTo && createdDay > dateTo) {
    return false;
  }
  return true;
}

export function filterCommercialOrders(
  orders: CommercialOrderDetail[],
  filter: CommercialOrdersListFilter,
): CommercialOrderDetail[] {
  return orders.filter(
    (order) =>
      matchesSearch(order, filter.searchQuery) &&
      matchesStatus(order, filter.statusFilter) &&
      matchesDateRange(order, filter.dateFrom, filter.dateTo),
  );
}

export function hasActiveCommercialOrdersListFilter(filter: CommercialOrdersListFilter): boolean {
  return (
    filter.searchQuery.trim().length > 0 ||
    filter.statusFilter !== "all" ||
    filter.dateFrom.length > 0 ||
    filter.dateTo.length > 0
  );
}
