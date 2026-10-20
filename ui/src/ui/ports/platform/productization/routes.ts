/**
 * Productization routes belong to the SaaS platform port only (L-IA-4, 2026-10-10).
 * Employee and enterprise shells do not register them.
 * There is no second shell. This subdomain stays on the full platform port.
 */

import { normalizePath, pathForTab, type Tab } from "../../../navigation.ts";
import type { FrontendPort } from "../../../routing/cross-port-context.ts";
import { digestHex } from "./fixtures.ts";

export const PRODUCTIZATION_TAB = "platformProductization" as const satisfies Tab;

export type ProductizationPageCode =
  | "P-00"
  | "P-01"
  | "P-02"
  | "P-03"
  | "P-04"
  | "P-05"
  | "P-06"
  | "P-07"
  | "P-08";

export type ProductizationRouteId =
  | "overview"
  | "artifacts"
  | "artifactDetail"
  | "channels"
  | "reconcile"
  | "l1"
  | "surfaces"
  | "windows"
  | "audit";

export type ProductizationRouteRegistration = {
  id: ProductizationRouteId;
  page: ProductizationPageCode;
  priority: "P0" | "P1" | "P2";
  path: string;
  port: "platform";
  /** No route writes the artifact ledger or accepts a wild digest. */
  writesLedger: false;
};

export const PRODUCTIZATION_ROUTES = [
  {
    id: "overview",
    page: "P-00",
    priority: "P0",
    path: "/platform/productization",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "artifacts",
    page: "P-01",
    priority: "P0",
    path: "/platform/productization/artifacts",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "artifactDetail",
    page: "P-02",
    priority: "P0",
    path: "/platform/productization/artifacts/:digest",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "channels",
    page: "P-03",
    priority: "P0",
    path: "/platform/productization/channels",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "reconcile",
    page: "P-04",
    priority: "P0",
    path: "/platform/productization/reconcile",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "l1",
    page: "P-05",
    priority: "P1",
    path: "/platform/productization/l1",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "surfaces",
    page: "P-06",
    priority: "P1",
    path: "/platform/productization/surfaces",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "windows",
    page: "P-07",
    priority: "P2",
    path: "/platform/productization/windows",
    port: "platform",
    writesLedger: false,
  },
  {
    id: "audit",
    page: "P-08",
    priority: "P2",
    path: "/platform/productization/audit",
    port: "platform",
    writesLedger: false,
  },
] as const satisfies readonly ProductizationRouteRegistration[];

const ROUTE_BY_ID = new Map(PRODUCTIZATION_ROUTES.map((route) => [route.id, route]));

export function productizationRoutesForPort(
  port: FrontendPort,
): readonly ProductizationRouteRegistration[] {
  if (port !== "platform") {
    return [];
  }
  return PRODUCTIZATION_ROUTES;
}

export function productizationRoot(basePath = ""): string {
  return pathForTab(PRODUCTIZATION_TAB, basePath);
}

export type ProductizationViewId = ProductizationRouteId | "unknown";

export type ProductizationView = {
  id: ProductizationViewId;
  page: ProductizationPageCode | null;
  title: string;
  subtitle: string;
  digestHex: string | null;
};

const RELEASE_TRAIN_SUBTITLE = "发布与制品 · 版本列车";

const VIEW_COPY: Record<ProductizationRouteId, { title: string; subtitle: string }> = {
  overview: {
    title: "发布概览",
    subtitle: RELEASE_TRAIN_SUBTITLE,
  },
  artifacts: {
    title: "制品总览",
    subtitle: `${RELEASE_TRAIN_SUBTITLE} · 版本·通道·对账`,
  },
  artifactDetail: {
    title: "制品详情",
    subtitle: `${RELEASE_TRAIN_SUBTITLE} · 单列车元数据`,
  },
  channels: {
    title: "通道管理",
    subtitle: `${RELEASE_TRAIN_SUBTITLE} · 云侧通道 · Fleet 镜像非主路径`,
  },
  reconcile: {
    title: "digest 对账台",
    subtitle: `${RELEASE_TRAIN_SUBTITLE} · 列车 / 镜像 / releases`,
  },
  l1: {
    title: "L1 只读占位",
    subtitle: "平台端 / 产品化 · L1 非主路径只读",
  },
  surfaces: {
    title: "表面矩阵",
    subtitle: "平台端 / 产品化 · SaaS full 能力",
  },
  windows: {
    title: "发布窗口",
    subtitle: "平台端 / 产品化 · SaaS 云侧发布窗口",
  },
  audit: {
    title: "审计",
    subtitle: "平台端 / 产品化 · 域内审计只读",
  },
};

function viewFor(id: ProductizationRouteId, digestHex: string | null = null): ProductizationView {
  const route = ROUTE_BY_ID.get(id);
  const copy = VIEW_COPY[id];
  return {
    id,
    page: route?.page ?? null,
    title: copy.title,
    subtitle: copy.subtitle,
    digestHex,
  };
}

export function isProductizationPath(pathname: string, basePath = ""): boolean {
  const root = normalizePath(productizationRoot(basePath));
  const current = normalizePath(pathname);
  return current === root || current.startsWith(`${root}/`);
}

export function resolveProductizationRoute(
  pathname: string,
  basePath = "",
  _search = "",
): ProductizationView {
  if (!isProductizationPath(pathname, basePath)) {
    return {
      id: "unknown",
      page: null,
      title: "发布与制品",
      subtitle: RELEASE_TRAIN_SUBTITLE,
      digestHex: null,
    };
  }
  const root = normalizePath(productizationRoot(basePath));
  const current = normalizePath(pathname);
  const rest = current === root ? "" : current.slice(root.length + 1);
  const parts = rest
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length === 0) {
    return viewFor("overview");
  }
  if (parts.length === 1 && parts[0] === "artifacts") {
    return viewFor("artifacts");
  }
  if (parts[0] === "artifacts" && parts.length === 2 && parts[1]) {
    return viewFor("artifactDetail", parts[1].toLowerCase());
  }
  if (parts.length === 1) {
    switch (parts[0]) {
      case "channels":
        return viewFor("channels");
      case "reconcile":
        return viewFor("reconcile");
      case "l1":
        return viewFor("l1");
      case "surfaces":
        return viewFor("surfaces");
      case "windows":
        return viewFor("windows");
      case "audit":
        return viewFor("audit");
      default:
        break;
    }
  }
  return {
    id: "unknown",
    page: null,
    title: "未注册路径",
    subtitle: `${RELEASE_TRAIN_SUBTITLE} · 该路径不是发布页面`,
    digestHex: null,
  };
}

export function productizationHref(basePath: string, id: ProductizationRouteId): string {
  const root = productizationRoot(basePath);
  switch (id) {
    case "overview":
      return root;
    case "artifacts":
      return `${root}/artifacts`;
    case "artifactDetail":
      return `${root}/artifacts`;
    case "channels":
      return `${root}/channels`;
    case "reconcile":
      return `${root}/reconcile`;
    case "l1":
      return `${root}/l1`;
    case "surfaces":
      return `${root}/surfaces`;
    case "windows":
      return `${root}/windows`;
    case "audit":
      return `${root}/audit`;
  }
}

export function productizationArtifactHref(basePath: string, digest: string): string {
  return `${productizationRoot(basePath)}/artifacts/${encodeURIComponent(digestHex(digest))}`;
}

export function productizationReconcileHref(
  basePath: string,
  input: { trainSeq?: string; digest?: string; imageRef?: string },
): string {
  const params = new URLSearchParams();
  const trainSeq = input.trainSeq?.trim();
  const digest = input.digest?.trim();
  const imageRef = input.imageRef?.trim();
  if (trainSeq) {
    params.set("train", trainSeq);
  }
  if (digest) {
    params.set("digest", digest);
  }
  if (imageRef) {
    params.set("image", imageRef);
  }
  const query = params.toString();
  const path = productizationHref(basePath, "reconcile");
  return query ? `${path}?${query}` : path;
}
