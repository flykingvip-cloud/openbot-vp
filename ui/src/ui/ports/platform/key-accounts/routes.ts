/**
 * Key-account routes belong to the SaaS platform port only (IA 2026-10-10).
 * Employee and enterprise shells do not register them.
 * The section is a sibling of productization, not a child route.
 */

import { normalizePath, pathForTab, type Tab } from "../../../navigation.ts";
import type { FrontendPort } from "../../../routing/cross-port-context.ts";

export const KEY_ACCOUNT_TAB = "platformKeyAccounts" as const satisfies Tab;

export type KeyAccountPageCode =
  | "K-00"
  | "K-01"
  | "K-02"
  | "K-03"
  | "K-04"
  | "K-05"
  | "K-06"
  | "K-07"
  | "K-08";

export type KeyAccountRouteId =
  | "delivery"
  | "ledger"
  | "detail"
  | "whiteLabel"
  | "preinstall"
  | "settlement"
  | "settlementReconcile"
  | "audit"
  | "terms"
  | "shipments";

export type KeyAccountRouteRegistration = {
  id: KeyAccountRouteId;
  page: KeyAccountPageCode;
  priority: "P0" | "P1" | "P2";
  path: string;
  port: "platform";
  /** This module never issues a bill. Audit, terms, reconcile, and shipments are read-only. */
  issuesBilling: false;
  readOnly: boolean;
};

export const KEY_ACCOUNT_ROUTES = [
  {
    id: "delivery",
    page: "K-00",
    priority: "P0",
    path: "/platform/key-accounts",
    port: "platform",
    issuesBilling: false,
    readOnly: true,
  },
  {
    id: "ledger",
    page: "K-01",
    priority: "P0",
    path: "/platform/key-accounts/partners",
    port: "platform",
    issuesBilling: false,
    readOnly: false,
  },
  {
    id: "detail",
    page: "K-02",
    priority: "P0",
    path: "/platform/key-accounts/partners/:code",
    port: "platform",
    issuesBilling: false,
    readOnly: false,
  },
  {
    id: "whiteLabel",
    page: "K-03",
    priority: "P0",
    path: "/platform/key-accounts/white-label",
    port: "platform",
    issuesBilling: false,
    readOnly: false,
  },
  {
    id: "preinstall",
    page: "K-04",
    priority: "P0",
    path: "/platform/key-accounts/preinstall",
    port: "platform",
    issuesBilling: false,
    readOnly: false,
  },
  {
    id: "settlement",
    page: "K-05",
    priority: "P0",
    path: "/platform/key-accounts/settlement",
    port: "platform",
    issuesBilling: false,
    readOnly: false,
  },
  {
    id: "settlementReconcile",
    page: "K-05",
    priority: "P2",
    path: "/platform/key-accounts/settlement/reconcile",
    port: "platform",
    issuesBilling: false,
    readOnly: true,
  },
  {
    id: "audit",
    page: "K-06",
    priority: "P1",
    path: "/platform/key-accounts/audit",
    port: "platform",
    issuesBilling: false,
    readOnly: true,
  },
  {
    id: "terms",
    page: "K-07",
    priority: "P1",
    path: "/platform/key-accounts/terms",
    port: "platform",
    issuesBilling: false,
    readOnly: true,
  },
  {
    id: "shipments",
    page: "K-08",
    priority: "P2",
    path: "/platform/key-accounts/shipments",
    port: "platform",
    issuesBilling: false,
    readOnly: true,
  },
] as const satisfies readonly KeyAccountRouteRegistration[];

const ROUTE_BY_ID = new Map(KEY_ACCOUNT_ROUTES.map((route) => [route.id, route]));

export function keyAccountRoutesForPort(
  port: FrontendPort,
): readonly KeyAccountRouteRegistration[] {
  if (port !== "platform") {
    return [];
  }
  return KEY_ACCOUNT_ROUTES;
}

export function keyAccountRoot(basePath = ""): string {
  return pathForTab(KEY_ACCOUNT_TAB, basePath);
}

export type KeyAccountViewId = KeyAccountRouteId | "unknown";

export type KeyAccountView = {
  id: KeyAccountViewId;
  page: KeyAccountPageCode | null;
  title: string;
  subtitle: string;
  partnerCode: string | null;
};

const DELIVERY_SUBTITLE = "白牌·预装·授权·安装";

const VIEW_COPY: Record<KeyAccountRouteId, { title: string; subtitle: string }> = {
  delivery: {
    title: "客户交付状态",
    subtitle: DELIVERY_SUBTITLE,
  },
  ledger: {
    title: "伙伴台账",
    subtitle: `${DELIVERY_SUBTITLE} · 伙伴台账`,
  },
  detail: {
    title: "伙伴详情",
    subtitle: "平台端 / 大客户管理 · 伙伴详情",
  },
  whiteLabel: {
    title: "白牌配置",
    subtitle: "平台端 / 大客户管理 · 白牌配置",
  },
  preinstall: {
    title: "预装包关联",
    subtitle: "平台端 / 大客户管理 · 预装包关联",
  },
  settlement: {
    title: "结算对账入口",
    subtitle: "平台端 / 大客户管理 · 结算对账入口",
  },
  settlementReconcile: {
    title: "结算对账视图",
    subtitle: "平台端 / 大客户管理 · 结算对账占位",
  },
  audit: {
    title: "域内审计",
    subtitle: "平台端 / 大客户管理 · 域内审计（只读）",
  },
  terms: {
    title: "合作条款摘要",
    subtitle: "平台端 / 大客户管理 · 合作条款摘要",
  },
  shipments: {
    title: "出货批次",
    subtitle: "平台端 / 大客户管理 · 出货批次（只读）",
  },
};

function viewFor(id: KeyAccountRouteId, partnerCode: string | null): KeyAccountView {
  const route = ROUTE_BY_ID.get(id);
  const copy = VIEW_COPY[id];
  return {
    id,
    page: route?.page ?? null,
    title: copy.title,
    subtitle: copy.subtitle,
    partnerCode,
  };
}

export function isKeyAccountPath(pathname: string, basePath = ""): boolean {
  const root = normalizePath(keyAccountRoot(basePath));
  const current = normalizePath(pathname);
  return current === root || current.startsWith(`${root}/`);
}

function normalizePartnerCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim() ?? "";
  return trimmed ? trimmed.toUpperCase() : null;
}

function partnerFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return normalizePartnerCode(params.get("partner"));
}

export function resolveKeyAccountRoute(
  pathname: string,
  basePath = "",
  search = "",
): KeyAccountView {
  if (!isKeyAccountPath(pathname, basePath)) {
    return {
      id: "unknown",
      page: null,
      title: "大客户管理",
      subtitle: "平台端 / 大客户管理",
      partnerCode: null,
    };
  }
  const root = normalizePath(keyAccountRoot(basePath));
  const current = normalizePath(pathname);
  const rest = current === root ? "" : current.slice(root.length + 1);
  const parts = rest
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const queryPartner = partnerFromSearch(search);
  if (parts.length === 0) {
    return viewFor("delivery", null);
  }
  if (parts.length === 1 && parts[0] === "partners") {
    return viewFor("ledger", null);
  }
  if (parts[0] === "partners" && parts.length === 2 && parts[1]) {
    return viewFor("detail", normalizePartnerCode(parts[1]));
  }
  if (parts[0] === "settlement" && parts.length === 2 && parts[1] === "reconcile") {
    return viewFor("settlementReconcile", queryPartner);
  }
  if (parts.length === 1) {
    switch (parts[0]) {
      case "white-label":
        return viewFor("whiteLabel", queryPartner);
      case "preinstall":
        return viewFor("preinstall", queryPartner);
      case "settlement":
        return viewFor("settlement", queryPartner);
      case "audit":
        return viewFor("audit", queryPartner);
      case "terms":
        return viewFor("terms", queryPartner);
      case "shipments":
        return viewFor("shipments", queryPartner);
      default:
        break;
    }
  }
  return {
    id: "unknown",
    page: null,
    title: "未注册路径",
    subtitle: "平台端 / 大客户管理 · 该路径不是大客户管理页面",
    partnerCode: null,
  };
}

export function keyAccountHref(
  basePath: string,
  id: KeyAccountRouteId,
  partnerCode?: string | null,
): string {
  const root = keyAccountRoot(basePath);
  const code = partnerCode?.trim() ?? "";
  switch (id) {
    case "delivery":
      return root;
    case "ledger":
      return `${root}/partners`;
    case "detail":
      return code ? `${root}/partners/${encodeURIComponent(code)}` : `${root}/partners`;
    case "whiteLabel":
      return code
        ? `${root}/white-label?partner=${encodeURIComponent(code)}`
        : `${root}/white-label`;
    case "preinstall":
      return code ? `${root}/preinstall?partner=${encodeURIComponent(code)}` : `${root}/preinstall`;
    case "settlement":
      return code ? `${root}/settlement?partner=${encodeURIComponent(code)}` : `${root}/settlement`;
    case "settlementReconcile":
      return code
        ? `${root}/settlement/reconcile?partner=${encodeURIComponent(code)}`
        : `${root}/settlement/reconcile`;
    case "audit":
      return code ? `${root}/audit?partner=${encodeURIComponent(code)}` : `${root}/audit`;
    case "terms":
      return code ? `${root}/terms?partner=${encodeURIComponent(code)}` : `${root}/terms`;
    case "shipments":
      return code ? `${root}/shipments?partner=${encodeURIComponent(code)}` : `${root}/shipments`;
  }
}
