/**
 * 企业数据能力中心 — 一级 Tab / 旧 section / hash 兼容路由（纯函数）。
 *
 * 旧 section：home | sources | authorization | capabilities | projections | approvals | memory
 * 新一级：overview | assets | products | governance
 */

export type LegacyDataCapabilitySection =
  | "home"
  | "sources"
  | "authorization"
  | "capabilities"
  | "projections"
  | "approvals"
  | "memory"
  | "audit";

export type DataCapabilityPrimaryTab = "overview" | "assets" | "products" | "governance";

/** 数据产品 Tab 内子区。 */
export type ProductsSubPanel = "catalog" | "outputs";

/** 权限与治理 Tab 内子区。 */
export type GovernanceSubPanel = "matrix" | "approvals" | "audit" | "memory";

export type DataCapabilityRouteTarget = {
  primary: DataCapabilityPrimaryTab;
  productsSubPanel: ProductsSubPanel;
  governanceSubPanel: GovernanceSubPanel;
  /** 仍用于既有 ensureSectionDataLoaded / 编辑器逻辑的兼容段。 */
  legacySection: LegacyDataCapabilitySection;
};

export const PRIMARY_TAB_NAV: ReadonlyArray<{ id: DataCapabilityPrimaryTab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "assets", label: "数据资产" },
  { id: "products", label: "数据产品" },
  { id: "governance", label: "权限与治理" },
];

const LEGACY_ALIASES: Record<string, LegacyDataCapabilitySection> = {
  home: "home",
  overview: "home",
  sources: "sources",
  assets: "sources",
  authorization: "authorization",
  auth: "authorization",
  capabilities: "capabilities",
  products: "capabilities",
  projections: "projections",
  outputs: "projections",
  approvals: "approvals",
  memory: "memory",
  scope: "memory",
  audit: "audit",
  lineage: "audit",
};

export function normalizeLegacySection(
  raw: string | null | undefined,
): LegacyDataCapabilitySection | null {
  if (typeof raw !== "string") {
    return null;
  }
  const key = raw.trim().replace(/^#/, "").toLowerCase();
  if (!key) {
    return null;
  }
  return LEGACY_ALIASES[key] ?? null;
}

export function resolveRouteFromLegacySection(
  section: LegacyDataCapabilitySection,
): DataCapabilityRouteTarget {
  switch (section) {
    case "home":
      return {
        primary: "overview",
        productsSubPanel: "catalog",
        governanceSubPanel: "matrix",
        legacySection: "home",
      };
    case "sources":
      return {
        primary: "assets",
        productsSubPanel: "catalog",
        governanceSubPanel: "matrix",
        legacySection: "sources",
      };
    case "capabilities":
      return {
        primary: "products",
        productsSubPanel: "catalog",
        governanceSubPanel: "matrix",
        legacySection: "capabilities",
      };
    case "projections":
      return {
        primary: "products",
        productsSubPanel: "outputs",
        governanceSubPanel: "matrix",
        legacySection: "projections",
      };
    case "authorization":
      return {
        primary: "governance",
        productsSubPanel: "catalog",
        governanceSubPanel: "matrix",
        legacySection: "authorization",
      };
    case "approvals":
      return {
        primary: "governance",
        productsSubPanel: "catalog",
        governanceSubPanel: "approvals",
        legacySection: "approvals",
      };
    case "memory":
      return {
        primary: "governance",
        productsSubPanel: "catalog",
        governanceSubPanel: "memory",
        legacySection: "memory",
      };
    case "audit":
      return {
        primary: "governance",
        productsSubPanel: "catalog",
        governanceSubPanel: "audit",
        legacySection: "audit",
      };
  }
}

/** 从 location.hash / search(`edc`) 解析路由；无效则回落总览。 */
export function resolveRouteFromLocation(params: {
  hash?: string | null;
  search?: string | null;
}): DataCapabilityRouteTarget {
  const fromHash = normalizeLegacySection(params.hash ?? null);
  if (fromHash) {
    return resolveRouteFromLegacySection(fromHash);
  }
  if (typeof params.search === "string" && params.search.length > 0) {
    try {
      const query = new URLSearchParams(
        params.search.startsWith("?") ? params.search.slice(1) : params.search,
      );
      const edc = normalizeLegacySection(query.get("edc"));
      if (edc) {
        return resolveRouteFromLegacySection(edc);
      }
    } catch {
      // ignore malformed search
    }
  }
  return resolveRouteFromLegacySection("home");
}

export function legacySectionForPrimary(
  primary: DataCapabilityPrimaryTab,
  opts?: {
    productsSubPanel?: ProductsSubPanel;
    governanceSubPanel?: GovernanceSubPanel;
  },
): LegacyDataCapabilitySection {
  switch (primary) {
    case "overview":
      return "home";
    case "assets":
      return "sources";
    case "products":
      return opts?.productsSubPanel === "outputs" ? "projections" : "capabilities";
    case "governance": {
      const sub = opts?.governanceSubPanel ?? "matrix";
      if (sub === "approvals") {
        return "approvals";
      }
      if (sub === "memory") {
        return "memory";
      }
      if (sub === "audit") {
        return "audit";
      }
      return "authorization";
    }
  }
}

/** 切一级 Tab 时需要预热的 legacy 数据段（可多个）。 */
export function dataSectionsForPrimary(
  primary: DataCapabilityPrimaryTab,
  opts?: {
    productsSubPanel?: ProductsSubPanel;
    governanceSubPanel?: GovernanceSubPanel;
  },
): LegacyDataCapabilitySection[] {
  switch (primary) {
    case "overview":
      return ["home"];
    case "assets":
      return ["sources"];
    case "products":
      // 子区隔离：目录只拉产品，输出与物化只拉投影。
      return opts?.productsSubPanel === "outputs" ? ["projections"] : ["capabilities"];
    case "governance": {
      const sub = opts?.governanceSubPanel ?? "matrix";
      if (sub === "approvals") {
        return ["approvals"];
      }
      if (sub === "memory") {
        return ["memory"];
      }
      if (sub === "audit") {
        return ["audit"];
      }
      return ["authorization"];
    }
  }
}
