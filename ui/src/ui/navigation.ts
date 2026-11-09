import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";
import {
  normalizeCrossPortContext,
  type CrossPortContext,
  type FrontendPort,
} from "./routing/cross-port-context.ts";
import { resolvePortFromSubdomain } from "./routing/subdomain-resolver.ts";

export const CONSOLE_TABS = [
  "opsIncidents",
  "opsRuntime",
  "opsLogs",
  "opsDiagnostics",
  "opsRecovery",
] as const;

const OPS_REDIRECT_TAB_BY_CANONICAL: Record<(typeof CONSOLE_TABS)[number], Tab> = {
  opsIncidents: "platformDashboard",
  opsRuntime: "platformAdvanced",
  opsLogs: "platformAdvanced",
  opsDiagnostics: "platformAdvanced",
  opsRecovery: "platformSystemSettings",
};

const LEGACY_OPS_REDIRECT_BY_TAB: Partial<Record<Tab, Tab>> = {
  opsIncidents: "platformDashboard",
  opsRuntime: "platformAdvanced",
  opsLogs: "platformAdvanced",
  opsDiagnostics: "platformAdvanced",
  opsRecovery: "platformSystemSettings",
  control: "platformDashboard",
  overview: "platformDashboard",
  sessions: "platformAdvanced",
  nodes: "platformAdvanced",
  logs: "platformAdvanced",
  debug: "platformAdvanced",
  cron: "platformSystemSettings",
  config: "platformSystemSettings",
};

export const CONTROL_SECTION_TABS = [
  "opsIncidents",
  "channels",
  "sessions",
  "platformAgents",
  "enterpriseAgents",
] as const;

export const PLATFORM_SURFACE_TABS = [
  "platformDashboard",
  "platformTenants",
  "platformPricing",
  "platformCapabilities",
  "platformModels",
  "platformAgents",
  "platformObservation",
  "platformDiagnosis",
  "platformAdvanced",
  "platformSystemSettings",
  "platformProductization",
  "platformKeyAccounts",
] as const;

export const LEGACY_BUILDER_REDIRECT_TABS = [
  "skills",
  "agents",
  "tools",
  "models",
  "releases",
] as const;

const BUILDER_REDIRECT_TAB_BY_LEGACY: Record<(typeof LEGACY_BUILDER_REDIRECT_TABS)[number], Tab> = {
  skills: "platformCapabilities",
  agents: "platformAgents",
  tools: "platformAdvanced",
  models: "platformModels",
  releases: "platformSystemSettings",
};

const LEGACY_BUILDER_REDIRECT_BY_TAB: Partial<Record<Tab, Tab>> = BUILDER_REDIRECT_TAB_BY_LEGACY;

export const ENTERPRISE_SURFACE_TABS = [
  "enterpriseOverview",
  "enterpriseOrganization",
  "enterpriseDataGovernanceCenter",
  "enterpriseCapabilityCenter",
  "enterpriseMesh",
  "enterpriseDiagnosis",
  "enterpriseUsage",
  "enterpriseSettings",
] as const;

/**
 * 「能力使用管理」子路由集合。对应 `/enterprise/{tenantId}/usage-management/{sub}` 的尾段。
 * 默认子页为 `robots`（机器人能力视图）。
 */
export const USAGE_MANAGEMENT_SUB_ROUTES = [
  "robots",
  "installs",
  "analytics",
  "governance",
] as const;

export type UsageManagementSubRoute = (typeof USAGE_MANAGEMENT_SUB_ROUTES)[number];

/**
 * 「成本与预算」可解析子路由（canonical + legacy 深链，供 URL 归一化到 v2）。
 */
export const LEGACY_COST_BUDGET_SUB_ROUTES = [
  "orders",
  "invoices",
  "resources",
  "analytics",
  "billing",
] as const;

export type LegacyCostBudgetSubRoute = (typeof LEGACY_COST_BUDGET_SUB_ROUTES)[number];

export const COST_BUDGET_CANONICAL_SUB_ROUTES = [
  "overview",
  "subscription",
  "seats",
  "control",
] as const;

export type CostBudgetCanonicalSubRoute = (typeof COST_BUDGET_CANONICAL_SUB_ROUTES)[number];

export type CostBudgetSubRoute = CostBudgetCanonicalSubRoute | LegacyCostBudgetSubRoute;

export const ALL_COST_BUDGET_SUB_ROUTES = [
  ...COST_BUDGET_CANONICAL_SUB_ROUTES,
  ...LEGACY_COST_BUDGET_SUB_ROUTES,
] as const satisfies readonly CostBudgetSubRoute[];

/** @deprecated 请使用 `ALL_COST_BUDGET_SUB_ROUTES`。 */
export const COST_BUDGET_SUB_ROUTES = ALL_COST_BUDGET_SUB_ROUTES;

/** v2 canonical URL 尾段（与 `COST_BUDGET_V2_ROUTES` 对齐；避免 navigation ↔ v2 循环依赖）。 */
const COST_BUDGET_V2_URL_SEGMENTS = ["overview", "plan-orders", "seats", "settings"] as const;

/** 从 pathname 解析「成本与预算」子页尾段；无效或缺失时返回 null。 */
export function parseCostBudgetSubRouteFromPath(pathname: string): CostBudgetSubRoute | null {
  const [, leaf] = pathname.match(/\/usage\/([^/?#]+)/) ?? [];
  const head = leaf?.split("/")[0];
  return head && (ALL_COST_BUDGET_SUB_ROUTES as readonly string[]).includes(head)
    ? (head as CostBudgetSubRoute)
    : null;
}

/** pathname 是否带有可保留的「成本与预算」子路径（legacy 或 v2）。 */
export function hasCostBudgetUsageSubRoute(pathname: string): boolean {
  const [, leaf] = pathname.match(/\/usage\/([^/?#]+)/) ?? [];
  const head = leaf?.split("/")[0];
  if (!head || head === "v2") {
    return false;
  }
  if ((ALL_COST_BUDGET_SUB_ROUTES as readonly string[]).includes(head)) {
    return true;
  }
  return (COST_BUDGET_V2_URL_SEGMENTS as readonly string[]).includes(head);
}

/** 平台「套餐与定价」嵌套路由（plans / plan detail / create）是否在 pathname 上。 */
export function hasPlatformPricingSubRoute(pathname: string, basePath = ""): boolean {
  const root = normalizePath(pathForTab("platformPricing", basePath));
  const current = normalizePath(pathname);
  return current !== root && current.startsWith(`${root}/`);
}

const LEGACY_PLATFORM_TABS = [
  "platformMarketplace",
  "platformLab",
  "platformDomains",
  "channels",
  "instances",
  "usage",
] as const;

const LEGACY_ENTERPRISE_TABS = [
  "enterpriseDashboard",
  "enterpriseAgents",
  "enterpriseUsageManagement",
  "enterpriseCollaboration",
  "enterpriseBudget",
  "enterpriseDomains",
  "enterpriseModels",
  /** @deprecated R1 mis-add; deep links redirect to enterpriseSettings. */
  "enterpriseModelPool",
  "enterpriseAccounts",
  "enterpriseSessions",
  "enterpriseInstances",
  // Scheme A: first-level 渠道凭证 retired; deep-link tab still builds /settings/channels
  "enterpriseChannels",
] as const;

const LEGACY_OPS_TABS = [
  "control",
  "overview",
  "sessions",
  "cron",
  "nodes",
  "config",
  "debug",
  "logs",
  "domains",
] as const;

export const TAB_GROUPS = [
  {
    label: "frontstage",
    tabs: [
      "me",
      "personas",
      "contacts",
      "groups",
      "enterpriseOverview",
      "platformDashboard",
      "opsIncidents",
    ],
  },
  {
    label: "enterprise",
    tabs: [...ENTERPRISE_SURFACE_TABS],
  },
  {
    label: "platform",
    tabs: [...PLATFORM_SURFACE_TABS],
  },
  {
    label: "console",
    tabs: [...CONSOLE_TABS],
  },
] as const;

export type Tab =
  | "agents"
  | "trialApply"
  | "pricing"
  | "features"
  | "skillMcp"
  | "partnerEcosystem"
  | "privacy"
  | "help"
  | "enterpriseLogin"
  | "platformLogin"
  | "platformDashboard"
  | "platformTenants"
  | "platformPricing"
  | "platformCapabilities"
  | "platformModels"
  | "platformAgents"
  | "platformObservation"
  | "platformDiagnosis"
  | "platformAdvanced"
  | "platformSystemSettings"
  | "platformProductization"
  | "platformKeyAccounts"
  | "enterpriseOverview"
  | "enterpriseOrganization"
  | "enterpriseDataGovernanceCenter"
  /** @deprecated 已整合进「企业能力中心」(`enterpriseCapabilityCenter`)；保留 ≥ 1 个发布周期用于路径与权限兼容。 */
  | "enterpriseUsageManagement"
  /** @deprecated 由 `enterpriseCapabilityCenter` 取代，保留 ≥ 1 个发布周期用于路径与权限兼容。 */
  | "enterpriseAgents"
  | "enterpriseCapabilityCenter"
  | "enterpriseMesh"
  | "enterpriseDiagnosis"
  | "enterpriseUsage"
  | "enterpriseChannels"
  | "enterpriseSettings"
  | "opsIncidents"
  | "opsRuntime"
  | "opsLogs"
  | "opsDiagnostics"
  | "opsRecovery"
  | "skills"
  | "tools"
  | "models"
  | "releases"
  | "chat"
  | "me"
  | "personas"
  | "contacts"
  | "groups"
  | (typeof LEGACY_PLATFORM_TABS)[number]
  | (typeof LEGACY_ENTERPRISE_TABS)[number]
  | (typeof LEGACY_OPS_TABS)[number];

export type ConsoleTab = (typeof CONSOLE_TABS)[number];
export type ControlSectionTab = (typeof CONTROL_SECTION_TABS)[number];
type RoutePath = `/${string}`;

export type TabRouteOptions = {
  tenantId?: string | null;
  context?: CrossPortContext | null;
};

export type TabRouteMatch = {
  tab: Tab;
  context: CrossPortContext | null;
  canonicalPath: RoutePath;
  requestedPath: RoutePath;
  usedLegacyAlias: boolean;
};

const OPS_ROOT_PATH = "/ops";
const EMBED_ROOT_PATH = "/embed";
const ENTERPRISE_ROOT_PATH = "/enterprise";
const BUILDER_ROOT_PATH = "/builder";
const RESERVED_ROUTE_ROOTS = new Set([
  "trial",
  "ops",
  "ope",
  "embed",
  "control",
  "control-ui",
  "platform",
  "enterprise",
  "builder",
  "agents",
  "skills",
  "tools",
  "models",
  "releases",
  "overview",
  "channels",
  "instances",
  "sessions",
  "usage",
  "cron",
  "nodes",
  "config",
  "debug",
  "logs",
]);

const TAB_PATHS: Record<Tab, string> = {
  agents: "/platform/agents",
  trialApply: "/trial/apply",
  pricing: "/pricing",
  features: "/features",
  skillMcp: "/skills-mcp",
  partnerEcosystem: "/partner-ecosystem",
  privacy: "/privacy",
  help: "/help",
  enterpriseLogin: "/enterprise/login",
  platformLogin: "/platform/login",
  platformDashboard: "/platform",
  platformTenants: "/platform/tenants",
  platformPricing: "/platform/pricing",
  platformCapabilities: "/platform/capabilities",
  platformModels: "/platform/models",
  platformAgents: "/platform/agents",
  platformObservation: "/platform/observation",
  platformDiagnosis: "/platform/diagnosis",
  platformAdvanced: "/platform/advanced",
  platformSystemSettings: "/platform/system-settings",
  platformProductization: "/platform/productization",
  platformKeyAccounts: "/platform/key-accounts",
  enterpriseOverview: ENTERPRISE_ROOT_PATH,
  enterpriseOrganization: ENTERPRISE_ROOT_PATH,
  enterpriseDataGovernanceCenter: ENTERPRISE_ROOT_PATH,
  enterpriseUsageManagement: ENTERPRISE_ROOT_PATH,
  enterpriseAgents: ENTERPRISE_ROOT_PATH,
  enterpriseCapabilityCenter: ENTERPRISE_ROOT_PATH,
  enterpriseMesh: ENTERPRISE_ROOT_PATH,
  enterpriseDiagnosis: ENTERPRISE_ROOT_PATH,
  enterpriseModelPool: ENTERPRISE_ROOT_PATH,
  enterpriseUsage: ENTERPRISE_ROOT_PATH,
  enterpriseChannels: ENTERPRISE_ROOT_PATH,
  enterpriseSettings: ENTERPRISE_ROOT_PATH,
  opsIncidents: `${OPS_ROOT_PATH}/incidents`,
  opsRuntime: `${OPS_ROOT_PATH}/runtime`,
  opsLogs: `${OPS_ROOT_PATH}/logs`,
  opsDiagnostics: `${OPS_ROOT_PATH}/diagnostics`,
  opsRecovery: `${OPS_ROOT_PATH}/recovery`,
  skills: "/platform/capabilities",
  tools: "/platform/advanced",
  models: "/platform/models",
  releases: "/platform/system-settings",
  chat: "/chat",
  me: "/",
  personas: "/personas",
  contacts: "/contacts",
  groups: "/groups",
  platformMarketplace: "/platform/marketplace",
  platformLab: "/platform/lab",
  platformDomains: "/platform/domains",
  channels: "/platform/channels",
  instances: "/platform/instances",
  usage: "/platform/usage",
  enterpriseDashboard: ENTERPRISE_ROOT_PATH,
  enterpriseCollaboration: ENTERPRISE_ROOT_PATH,
  enterpriseBudget: ENTERPRISE_ROOT_PATH,
  enterpriseDomains: ENTERPRISE_ROOT_PATH,
  enterpriseModels: ENTERPRISE_ROOT_PATH,
  enterpriseAccounts: ENTERPRISE_ROOT_PATH,
  enterpriseSessions: ENTERPRISE_ROOT_PATH,
  enterpriseInstances: ENTERPRISE_ROOT_PATH,
  control: OPS_ROOT_PATH,
  overview: `${OPS_ROOT_PATH}/overview`,
  sessions: `${OPS_ROOT_PATH}/sessions`,
  cron: `${OPS_ROOT_PATH}/cron`,
  nodes: `${OPS_ROOT_PATH}/nodes`,
  config: `${OPS_ROOT_PATH}/config`,
  debug: `${OPS_ROOT_PATH}/debug`,
  logs: `${OPS_ROOT_PATH}/logs`,
  domains: `${OPS_ROOT_PATH}/domains`,
};

const CANONICAL_ROUTE_TABS: readonly Tab[] = [
  "me",
  "trialApply",
  "pricing",
  "features",
  "skillMcp",
  "partnerEcosystem",
  "privacy",
  "help",
  "enterpriseLogin",
  "platformLogin",
  "personas",
  "contacts",
  "groups",
  ...PLATFORM_SURFACE_TABS,
  ...ENTERPRISE_SURFACE_TABS,
] as const;

const PATH_TO_TAB = new Map<RoutePath, Tab>(
  CANONICAL_ROUTE_TABS.map((tab) => [TAB_PATHS[tab] as RoutePath, tab]),
);

const LEGACY_PATH_TO_TAB = new Map<RoutePath, Tab>([
  ["/ops", "opsIncidents"],
  ["/ope", "opsIncidents"],
  ["/domains", "platformAdvanced"],
  ["/ops/domains", "platformAdvanced"],
  ["/platform/dashboard", "platformDashboard"],
  ["/platform/marketplace", "platformCapabilities"],
  ["/platform/lab", "platformModels"],
  ["/platform/domains", "platformAdvanced"],
  ["/platform/channels", "platformAdvanced"],
  ["/platform/instances", "platformAdvanced"],
  ["/platform/usage", "platformAdvanced"],
  ["/channels", "platformAdvanced"],
  ["/instances", "platformAdvanced"],
  ["/usage", "platformAdvanced"],
  ["/enterprise/dashboard", "enterpriseOverview"],
  ["/enterprise/organization", "enterpriseOrganization"],
  ["/enterprise/collaboration", "enterpriseMesh"],
  ["/enterprise/budget", "enterpriseUsage"],
  ["/enterprise/settings", "enterpriseSettings"],
  ["/enterprise/domains", "enterpriseSettings"],
  ["/enterprise/models", "enterpriseSettings"],
  ["/enterprise/accounts", "enterpriseOrganization"],
  ["/enterprise/sessions", "enterpriseMesh"],
  ["/enterprise/instances", "enterpriseMesh"],
]);

const TAB_PORTS: Record<Tab, FrontendPort> = {
  me: "employee",
  trialApply: "employee",
  pricing: "employee",
  features: "employee",
  skillMcp: "employee",
  partnerEcosystem: "employee",
  privacy: "employee",
  help: "employee",
  enterpriseLogin: "enterprise",
  platformLogin: "platform",
  chat: "employee",
  personas: "employee",
  contacts: "employee",
  groups: "employee",
  platformDashboard: "platform",
  platformTenants: "platform",
  platformPricing: "platform",
  platformCapabilities: "platform",
  platformModels: "platform",
  platformAgents: "platform",
  platformObservation: "platform",
  platformDiagnosis: "platform",
  platformAdvanced: "platform",
  platformSystemSettings: "platform",
  platformProductization: "platform",
  platformKeyAccounts: "platform",
  enterpriseOverview: "enterprise",
  enterpriseOrganization: "enterprise",
  enterpriseDataGovernanceCenter: "enterprise",
  enterpriseUsageManagement: "enterprise",
  enterpriseAgents: "enterprise",
  enterpriseCapabilityCenter: "enterprise",
  enterpriseMesh: "enterprise",
  enterpriseDiagnosis: "enterprise",
  enterpriseModelPool: "enterprise",
  enterpriseUsage: "enterprise",
  enterpriseChannels: "enterprise",
  enterpriseSettings: "enterprise",
  opsIncidents: "platform",
  opsRuntime: "platform",
  opsLogs: "platform",
  opsDiagnostics: "platform",
  opsRecovery: "platform",
  // Legacy builder tab ids — portForTab resolves via canonicalizeTab(); entries satisfy Record<Tab, FrontendPort>.
  agents: "platform",
  skills: "platform",
  tools: "platform",
  models: "platform",
  releases: "platform",
  platformMarketplace: "platform",
  platformLab: "platform",
  platformDomains: "platform",
  channels: "platform",
  instances: "platform",
  usage: "platform",
  enterpriseDashboard: "enterprise",
  enterpriseCollaboration: "enterprise",
  enterpriseBudget: "enterprise",
  enterpriseDomains: "enterprise",
  enterpriseModels: "enterprise",
  enterpriseAccounts: "enterprise",
  enterpriseSessions: "enterprise",
  enterpriseInstances: "enterprise",
  control: "platform",
  overview: "platform",
  sessions: "platform",
  cron: "platform",
  nodes: "platform",
  config: "platform",
  debug: "platform",
  logs: "platform",
  domains: "platform",
};

const ENTERPRISE_CAPABILITY_SUB_ROUTES = new Set([
  "all",
  "contribution-records",
  "contribution-performance",
  "install-management",
  "review-queue",
  "incubation",
  // 整合自原「能力应用管理」的运行态子页（机器人视图 / 效果分析 / 应用治理）。
  "robots",
  "analytics",
  "governance",
]);

/**
 * 旧「能力应用管理」(`/usage-management/{sub}`) 子路由 → 「企业能力中心」
 * (`/capabilities/{route}`) 路由段的映射。用于把已撤销模块的链接重定向到
 * 整合后的能力中心对应 Tab。
 */
function translateUsageSubRouteToCapabilityRoute(leaf: string): string | null {
  const normalized = leaf.replace(/^\/+|\/+$/g, "").toLowerCase();
  const [head, ...rest] = normalized.split("/");
  switch (head) {
    case "":
    case "robots":
      // `/usage-management/robots/{robotId}` 旧深链没有对应资产路由，统一回机器人视图。
      return "robots";
    case "installs":
      // 安装关系并入能力中心「能力安装管理」；带 capabilityId 时落到资产详情。
      return rest.length > 0 ? rest.join("/") : "install-management";
    case "analytics":
      return "analytics";
    case "governance":
      return "governance";
    default:
      return "robots";
  }
}

/**
 * Path segments that look like downloaded/attached files (e.g. `report.pdf`).
 * When the SPA is opened under such a pathname (relative navigation, download
 * link, or history pollution), they must not become Control UI `basePath` —
 * otherwise `/__openbot/*` resolves to `report.pdf/__openbot/...` and 404s.
 */
function isFileLikePathSegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep raw segment
  }
  // Ignore query/hash debris; require a short alphanumeric extension.
  const base = decoded.split(/[?#]/, 1)[0] ?? "";
  return /\.[a-z0-9]{1,16}$/i.test(base);
}

function stripTrailingFileLikeSegments(segments: string[]): string[] {
  const out = [...segments];
  while (out.length > 0 && isFileLikePathSegment(out[out.length - 1] ?? "")) {
    out.pop();
  }
  return out;
}

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  // Drop accidental file tails (e.g. `/ui/report.pdf` → `/ui`, `/a.pdf` → ``)
  // so bootstrap/auth URLs never become `….pdf/__openbot/…`.
  const segments = stripTrailingFileLikeSegments(base.split("/").filter(Boolean));
  if (segments.length === 0) {
    return "";
  }
  return `/${segments.join("/")}`;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function toRoutePath(path: string): RoutePath {
  return normalizePath(path).toLowerCase() as RoutePath;
}

function buildEnterpriseTabPath(tab: Tab, tenantId?: string | null): RoutePath {
  const normalizedTenantId = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!normalizedTenantId) {
    switch (tab) {
      case "enterpriseOverview":
      case "enterpriseDashboard":
        return ENTERPRISE_ROOT_PATH;
      case "enterpriseOrganization":
      case "enterpriseAccounts":
        return `${ENTERPRISE_ROOT_PATH}/organization`;
      case "enterpriseDataGovernanceCenter":
        return `${ENTERPRISE_ROOT_PATH}/data-governance`;
      // @deprecated 已整合进「企业能力中心」。
      case "enterpriseUsageManagement":
      case "enterpriseAgents":
        return `${ENTERPRISE_ROOT_PATH}/capabilities`;
      case "enterpriseCapabilityCenter":
        return `${ENTERPRISE_ROOT_PATH}/capabilities`;
      case "enterpriseMesh":
      case "enterpriseCollaboration":
      case "enterpriseSessions":
      case "enterpriseInstances":
        return `${ENTERPRISE_ROOT_PATH}/mesh`;
      case "enterpriseDiagnosis":
        return `${ENTERPRISE_ROOT_PATH}/diagnosis`;
      case "enterpriseModelPool":
      case "enterpriseModels":
        // Retired enterprise「模型池」; deep links land on 系统设置 → 模型管理.
        return `${ENTERPRISE_ROOT_PATH}/settings`;
      case "enterpriseUsage":
      case "enterpriseBudget":
        return `${ENTERPRISE_ROOT_PATH}/usage`;
      case "enterpriseChannels":
        // Nested under 系统设置 (scheme A); keep path for deep links.
        return `${ENTERPRISE_ROOT_PATH}/settings/channels`;
      case "enterpriseSettings":
      case "enterpriseDomains":
        return `${ENTERPRISE_ROOT_PATH}/settings`;
      default:
        return ENTERPRISE_ROOT_PATH;
    }
  }
  const encodedTenantId = encodeURIComponent(normalizedTenantId);
  switch (tab) {
    case "enterpriseOverview":
    case "enterpriseDashboard":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/overview`;
    case "enterpriseOrganization":
    case "enterpriseAccounts":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/organization/users`;
    case "enterpriseDataGovernanceCenter":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/data-governance/overview`;
    // @deprecated 已整合进「企业能力中心」。
    case "enterpriseUsageManagement":
    case "enterpriseAgents":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/capabilities`;
    case "enterpriseCapabilityCenter":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/capabilities`;
    case "enterpriseMesh":
    case "enterpriseCollaboration":
    case "enterpriseSessions":
    case "enterpriseInstances":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/mesh/overview`;
    case "enterpriseDiagnosis":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/diagnosis`;
    case "enterpriseModelPool":
    case "enterpriseModels":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/settings`;
    case "enterpriseUsage":
    case "enterpriseBudget":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/usage/overview`;
    // Legacy top-level /channels → 系统设置 /settings/channels
    case "enterpriseChannels":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/settings/channels`;
    case "enterpriseSettings":
    case "enterpriseDomains":
      return `${ENTERPRISE_ROOT_PATH}/${encodedTenantId}/settings`;
    default:
      return ENTERPRISE_ROOT_PATH;
  }
}

function stripBasePath(pathname: string, basePath: string): RoutePath {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = toRoutePath(path);
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  return normalized;
}

function matchEnterpriseRoute(path: RoutePath): TabRouteMatch | null {
  if (path === "/enterprise/login") {
    return {
      tab: "enterpriseLogin",
      context: null,
      canonicalPath: "/enterprise/login",
      requestedPath: path,
      usedLegacyAlias: false,
    };
  }
  if (path === ENTERPRISE_ROOT_PATH) {
    return {
      tab: "enterpriseOverview",
      context: null,
      canonicalPath: ENTERPRISE_ROOT_PATH,
      requestedPath: path,
      usedLegacyAlias: false,
    };
  }
  const resolverLeafMap = new Map<RoutePath, Tab>([
    ["/enterprise/organization", "enterpriseOrganization"],
    ["/enterprise/data-governance", "enterpriseDataGovernanceCenter"],
    ["/enterprise/agents", "enterpriseCapabilityCenter"],
    ["/enterprise/usage-management", "enterpriseCapabilityCenter"],
    ["/enterprise/capabilities", "enterpriseCapabilityCenter"],
    ["/enterprise/mesh", "enterpriseMesh"],
    ["/enterprise/diagnosis", "enterpriseDiagnosis"],
    ["/enterprise/model-pool", "enterpriseSettings"],
    ["/enterprise/usage", "enterpriseUsage"],
    ["/enterprise/settings", "enterpriseSettings"],
  ]);
  const resolverLeafTab = resolverLeafMap.get(path);
  if (resolverLeafTab) {
    const isLegacyModelPool = path === "/enterprise/model-pool";
    return {
      tab: resolverLeafTab,
      context: null,
      canonicalPath:
        resolverLeafTab === "enterpriseCapabilityCenter"
          ? ("/enterprise/capabilities" as RoutePath)
          : isLegacyModelPool
            ? ("/enterprise/settings" as RoutePath)
            : path,
      requestedPath: path,
      usedLegacyAlias:
        (path !== "/enterprise/capabilities" && resolverLeafTab === "enterpriseCapabilityCenter") ||
        isLegacyModelPool,
    };
  }
  const resolverNestedMatch = path.match(
    /^\/enterprise\/(organization|data-governance|agents|usage-management|capabilities|mesh|model-pool|usage|settings)\/(.+)$/,
  );
  if (path === "/enterprise/budget" || path.startsWith("/enterprise/budget/")) {
    return {
      tab: "enterpriseUsage",
      context: null,
      canonicalPath: "/enterprise/usage" as RoutePath,
      requestedPath: path,
      usedLegacyAlias: true,
    };
  }
  if (resolverNestedMatch) {
    const section = resolverNestedMatch[1] ?? "";
    const leaf = (resolverNestedMatch[2] ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
    // 旧「能力应用管理」/「企业代理」整段并入能力中心。
    if (section === "usage-management" || section === "agents") {
      const capabilityRoute =
        section === "usage-management"
          ? translateUsageSubRouteToCapabilityRoute(leaf)
          : leaf === "templates"
            ? "install-management"
            : "robots";
      return {
        tab: "enterpriseCapabilityCenter",
        context: extractContextFromRoute(
          path,
          capabilityRoute ? { enterpriseCapabilityRoute: capabilityRoute } : {},
        ),
        canonicalPath: "/enterprise/capabilities" as RoutePath,
        requestedPath: path,
        usedLegacyAlias: true,
      };
    }
    const tab = resolverLeafMap.get(`/enterprise/${section}` as RoutePath);
    if (tab) {
      const isLegacyModelPoolSection = section === "model-pool";
      return {
        tab,
        context: extractContextFromRoute(path, {
          ...buildEnterpriseResolverContext(section, leaf),
        }),
        canonicalPath: isLegacyModelPoolSection
          ? ("/enterprise/settings" as RoutePath)
          : (`/enterprise/${section}` as RoutePath),
        requestedPath: path,
        usedLegacyAlias: true,
      };
    }
  }
  const tenantMatch = path.match(/^\/enterprise\/([^/]+)(?:\/(.*))?$/);
  if (!tenantMatch) {
    return null;
  }
  const tenantId = decodeURIComponent(tenantMatch[1] ?? "").trim();
  if (!tenantId) {
    return null;
  }
  const leaf = (tenantMatch[2] ?? "overview").replace(/^\/+|\/+$/g, "").toLowerCase();
  let tab: Tab;
  if (!leaf || leaf === "overview") {
    tab = "enterpriseOverview";
  } else if (leaf === "organization" || leaf.startsWith("organization/")) {
    tab = "enterpriseOrganization";
  } else if (leaf === "data-governance" || leaf.startsWith("data-governance/")) {
    tab = "enterpriseDataGovernanceCenter";
  } else if (leaf === "agents" || leaf.startsWith("agents/")) {
    // 旧「企业代理」并入能力中心。
    tab = "enterpriseCapabilityCenter";
  } else if (leaf === "usage-management" || leaf.startsWith("usage-management/")) {
    // 旧「能力应用管理」并入能力中心。
    tab = "enterpriseCapabilityCenter";
  } else if (leaf === "capabilities" || leaf.startsWith("capabilities/")) {
    tab = "enterpriseCapabilityCenter";
  } else if (leaf === "mesh" || leaf.startsWith("mesh/")) {
    tab = "enterpriseMesh";
  } else if (leaf === "diagnosis" || leaf.startsWith("diagnosis/")) {
    tab = "enterpriseDiagnosis";
  } else if (leaf === "model-pool" || leaf.startsWith("model-pool/")) {
    // Retired enterprise「模型池」→ 系统设置
    tab = "enterpriseSettings";
  } else if (leaf === "usage" || leaf.startsWith("usage/")) {
    tab = "enterpriseUsage";
  } else if (leaf === "budget" || leaf.startsWith("budget/")) {
    // Legacy /enterprise/{tid}/budget → 成本与预算
    tab = "enterpriseUsage";
  } else if (leaf === "channels" || leaf.startsWith("channels/")) {
    // Legacy top-level /channels → 系统设置 · 渠道凭证 (scheme A)
    tab = "enterpriseSettings";
  } else if (leaf === "settings" || leaf.startsWith("settings/")) {
    tab = "enterpriseSettings";
  } else {
    return null;
  }
  const isLegacyChannelsLeaf = leaf === "channels" || leaf.startsWith("channels/");
  const isLegacyModelPoolLeaf = leaf === "model-pool" || leaf.startsWith("model-pool/");
  const isLegacyBudgetLeaf = leaf === "budget" || leaf.startsWith("budget/");
  const canonicalPath = isLegacyChannelsLeaf
    ? (`${ENTERPRISE_ROOT_PATH}/${encodeURIComponent(tenantId)}/settings/channels` as RoutePath)
    : isLegacyModelPoolLeaf
      ? (`${ENTERPRISE_ROOT_PATH}/${encodeURIComponent(tenantId)}/settings` as RoutePath)
      : isLegacyBudgetLeaf
        ? buildEnterpriseTabPath("enterpriseUsage", tenantId)
        : tab === "enterpriseSettings" && leaf.startsWith("settings/")
          ? path
          : buildEnterpriseTabPath(tab, tenantId);
  return {
    tab,
    context: extractContextFromRoute(path, {
      tenantId,
      ...buildTenantEnterpriseResolverContext(leaf),
    }),
    canonicalPath,
    requestedPath: path,
    usedLegacyAlias: isLegacyChannelsLeaf || isLegacyModelPoolLeaf || isLegacyBudgetLeaf,
  };
}

function buildEnterpriseResolverContext(section: string, leaf: string): Partial<CrossPortContext> {
  if (section === "capabilities") {
    const [head] = leaf.split("/");
    if (!head || !ENTERPRISE_CAPABILITY_SUB_ROUTES.has(head)) {
      return {};
    }
    return { enterpriseCapabilityRoute: leaf };
  }
  if (section === "usage-management") {
    // 旧「能力应用管理」子路由翻译为能力中心路由段（整合后归并）。
    const capabilityRoute = translateUsageSubRouteToCapabilityRoute(leaf);
    return capabilityRoute ? { enterpriseCapabilityRoute: capabilityRoute } : {};
  }
  return {};
}

function buildTenantEnterpriseResolverContext(leaf: string): Partial<CrossPortContext> {
  if (leaf.startsWith("capabilities/")) {
    return buildEnterpriseResolverContext("capabilities", leaf.slice("capabilities/".length));
  }
  if (leaf === "usage-management") {
    return { enterpriseCapabilityRoute: "robots" };
  }
  if (leaf.startsWith("usage-management/")) {
    return buildEnterpriseResolverContext(
      "usage-management",
      leaf.slice("usage-management/".length),
    );
  }
  if (leaf === "agents" || leaf === "agents/templates") {
    return {
      enterpriseCapabilityRoute: leaf === "agents/templates" ? "install-management" : "robots",
    };
  }
  if (leaf.startsWith("agents/")) {
    return { enterpriseCapabilityRoute: "robots" };
  }
  return {};
}

function matchCanonicalNestedRoute(path: RoutePath): TabRouteMatch | null {
  const legacyOpsPrefixes: Array<{ prefix: RoutePath; tab: ConsoleTab }> = [
    { prefix: "/ops/incidents", tab: "opsIncidents" },
    { prefix: "/ops/runtime", tab: "opsRuntime" },
    { prefix: "/ops/logs", tab: "opsLogs" },
    { prefix: "/ops/diagnostics", tab: "opsDiagnostics" },
    { prefix: "/ops/recovery", tab: "opsRecovery" },
  ];
  for (const entry of legacyOpsPrefixes) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      const redirectedTab = OPS_REDIRECT_TAB_BY_CANONICAL[entry.tab];
      const context = extractContextFromRoute(
        path,
        entry.tab === "opsRuntime"
          ? { sourcePort: "platform", sourcePage: "platformAdvanced" }
          : {},
      );
      return {
        tab: redirectedTab,
        context,
        canonicalPath: normalizePath(pathForTab(redirectedTab, "", { context })) as RoutePath,
        requestedPath: path,
        usedLegacyAlias: true,
      };
    }
  }
  const builderLegacyPrefixes: Array<{
    prefix: RoutePath;
    tab: (typeof LEGACY_BUILDER_REDIRECT_TABS)[number];
  }> = [
    { prefix: "/builder/agents", tab: "agents" },
    { prefix: "/builder/skills", tab: "skills" },
    { prefix: "/builder/tools", tab: "tools" },
    { prefix: "/builder/models", tab: "models" },
    { prefix: "/builder/releases", tab: "releases" },
  ];
  for (const entry of builderLegacyPrefixes) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      const redirectedTab = BUILDER_REDIRECT_TAB_BY_LEGACY[entry.tab];
      const context = extractContextFromRoute(path);
      return {
        tab: redirectedTab,
        context,
        canonicalPath: normalizePath(pathForTab(redirectedTab, "", { context })) as RoutePath,
        requestedPath: path,
        usedLegacyAlias: true,
      };
    }
  }
  // Help guide deep-links (/help/wecom) must stay on the requested path.
  // Do not mark usedLegacyAlias — syncUrlWithTab preserves /help/* separately.
  if (path === "/help" || path.startsWith("/help/")) {
    return {
      tab: "help",
      context: null,
      canonicalPath: toRoutePath("/help"),
      requestedPath: path,
      usedLegacyAlias: false,
    };
  }
  // Keep the full productization path. Marking these as legacy aliases would
  // collapse /platform/productization/artifacts/:digest back to the tab root.
  if (path === "/platform/productization" || path.startsWith("/platform/productization/")) {
    return {
      tab: "platformProductization",
      context: null,
      canonicalPath: path,
      requestedPath: path,
      usedLegacyAlias: false,
    };
  }
  // Keep the full key-account path so partner detail does not collapse to the tab root.
  if (path === "/platform/key-accounts" || path.startsWith("/platform/key-accounts/")) {
    return {
      tab: "platformKeyAccounts",
      context: null,
      canonicalPath: path,
      requestedPath: path,
      usedLegacyAlias: false,
    };
  }
  const nestedPrefixes: Array<{ prefix: RoutePath; tab: Tab }> = [
    { prefix: "/platform/login", tab: "platformLogin" },
    { prefix: "/platform/pricing", tab: "platformPricing" },
    { prefix: "/platform/capabilities", tab: "platformCapabilities" },
    { prefix: "/platform/models", tab: "platformModels" },
    { prefix: "/platform/agents", tab: "platformAgents" },
    { prefix: "/platform/observation", tab: "platformObservation" },
    { prefix: "/platform/diagnosis", tab: "platformDiagnosis" },
    { prefix: "/platform/advanced", tab: "platformAdvanced" },
    { prefix: "/platform/system-settings", tab: "platformSystemSettings" },
  ];
  for (const entry of nestedPrefixes) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return {
        tab: entry.tab,
        context: extractContextFromRoute(path),
        canonicalPath: entry.prefix,
        requestedPath: path,
        usedLegacyAlias: path !== entry.prefix,
      };
    }
  }
  return null;
}

function extractContextFromRoute(
  path: RoutePath,
  seed: Partial<CrossPortContext> = {},
): CrossPortContext | null {
  const context: CrossPortContext = { ...seed };
  const incidentMatch = path.match(/\/incidents\/([^/]+)/);
  if (incidentMatch?.[1]) {
    context.incidentId = decodeURIComponent(incidentMatch[1]);
  }
  const runtimeMatch = path.match(/\/runtime\/([^/]+)/);
  if (runtimeMatch?.[1]) {
    context.runtimeId = decodeURIComponent(runtimeMatch[1]);
  }
  const executionMatch = path.match(/\/(?:executions|sessions)\/([^/]+)/);
  if (executionMatch?.[1]) {
    context.executionId = decodeURIComponent(executionMatch[1]);
  }
  const agentMatch = path.match(/\/agents\/([^/]+)/);
  if (agentMatch?.[1]) {
    const agentId = decodeURIComponent(agentMatch[1]);
    if (agentId !== "my-agents" && agentId !== "team-agents" && agentId !== "templates") {
      context.agentId = agentId;
    }
  }
  const capabilityMatch = path.match(/\/capabilities\/([^/]+)/);
  if (capabilityMatch?.[1] && !context.enterpriseCapabilityRoute) {
    context.capabilityId = decodeURIComponent(capabilityMatch[1]);
  }
  const builderAssetMatch = path.match(/\/(?:tools|models|releases)\/([^/]+)/);
  if (builderAssetMatch?.[1]) {
    context.capabilityId = decodeURIComponent(builderAssetMatch[1]);
  }
  const userMatch = path.match(/\/(?:people|users)\/([^/]+)/);
  if (userMatch?.[1]) {
    context.userId = decodeURIComponent(userMatch[1]);
  }
  const handoverMatch = path.match(/\/handover\/([^/]+)/);
  if (handoverMatch?.[1]) {
    context.handoverCaseId = decodeURIComponent(handoverMatch[1]);
  }
  const groupMatch = path.match(/\/groups\/([^/]+)/);
  if (groupMatch?.[1]) {
    context.groupId = decodeURIComponent(groupMatch[1]);
  }
  const values = Object.values(context).filter(Boolean);
  return values.length > 0 ? context : null;
}

function appendContextToTabPath(
  tab: Tab,
  basePath: RoutePath,
  context: CrossPortContext | null | undefined,
): RoutePath {
  const normalized = normalizeCrossPortContext(context);
  if (!normalized) {
    return basePath;
  }
  const canonicalTab = canonicalizeTab(tab);
  switch (canonicalTab) {
    case "platformCapabilities":
    case "enterpriseCapabilityCenter":
      if (canonicalTab === "enterpriseCapabilityCenter" && normalized.enterpriseCapabilityRoute) {
        return `${basePath}/${normalized.enterpriseCapabilityRoute}` as RoutePath;
      }
      if (normalized.capabilityId) {
        return `${basePath}/${encodeURIComponent(normalized.capabilityId)}` as RoutePath;
      }
      return basePath;
    case "platformAgents":
    case "agents":
      if (normalized.agentId) {
        if (basePath.endsWith(`/${encodeURIComponent(normalized.agentId)}`)) {
          return basePath;
        }
        return `${basePath}/${encodeURIComponent(normalized.agentId)}` as RoutePath;
      }
      return basePath;
    case "platformAdvanced":
      if (normalized.runtimeId) {
        return `${basePath}/runtime/${encodeURIComponent(normalized.runtimeId)}` as RoutePath;
      }
      if (normalized.incidentId) {
        return `${basePath}/incidents/${encodeURIComponent(normalized.incidentId)}` as RoutePath;
      }
      if (normalized.executionId) {
        return `${basePath}/executions/${encodeURIComponent(normalized.executionId)}` as RoutePath;
      }
      return basePath;
    case "enterpriseMesh":
      if (normalized.groupId) {
        return `${basePath}/groups/${encodeURIComponent(normalized.groupId)}` as RoutePath;
      }
      if (normalized.userId) {
        return `${basePath}/people/${encodeURIComponent(normalized.userId)}` as RoutePath;
      }
      if (normalized.agentId) {
        return `${basePath}/agents/${encodeURIComponent(normalized.agentId)}` as RoutePath;
      }
      if (normalized.runtimeId) {
        return `${basePath}/runtime/${encodeURIComponent(normalized.runtimeId)}` as RoutePath;
      }
      if (normalized.incidentId) {
        return `${basePath}/incidents/${encodeURIComponent(normalized.incidentId)}` as RoutePath;
      }
      if (normalized.executionId) {
        return `${basePath}/executions/${encodeURIComponent(normalized.executionId)}` as RoutePath;
      }
      return basePath;
    case "enterpriseOrganization":
      if (normalized.handoverCaseId) {
        const organizationRoot = basePath.endsWith("/users")
          ? (basePath.slice(0, -"/users".length) as RoutePath)
          : basePath;
        return `${organizationRoot}/handover/${encodeURIComponent(normalized.handoverCaseId)}` as RoutePath;
      }
      if (normalized.userId) {
        return `${basePath}/users/${encodeURIComponent(normalized.userId)}` as RoutePath;
      }
      return basePath;
    case "enterpriseUsage":
      if (normalized.groupId) {
        return `${basePath}/groups/${encodeURIComponent(normalized.groupId)}` as RoutePath;
      }
      if (normalized.userId) {
        return `${basePath}/people/${encodeURIComponent(normalized.userId)}` as RoutePath;
      }
      if (normalized.agentId) {
        return `${basePath}/agents/${encodeURIComponent(normalized.agentId)}` as RoutePath;
      }
      if (normalized.runtimeId) {
        return `${basePath}/runtime/${encodeURIComponent(normalized.runtimeId)}` as RoutePath;
      }
      if (normalized.executionId) {
        return `${basePath}/executions/${encodeURIComponent(normalized.executionId)}` as RoutePath;
      }
      return basePath;
    case "tools":
    case "models":
    case "releases":
      if (normalized.capabilityId) {
        return `${basePath}/${encodeURIComponent(normalized.capabilityId)}` as RoutePath;
      }
      return basePath;
    case "opsIncidents":
      if (normalized.incidentId) {
        return `${basePath}/${encodeURIComponent(normalized.incidentId)}` as RoutePath;
      }
      return basePath;
    case "opsRuntime":
      if (normalized.runtimeId) {
        return `${basePath}/${encodeURIComponent(normalized.runtimeId)}` as RoutePath;
      }
      if (normalized.executionId) {
        return `${basePath}/executions/${encodeURIComponent(normalized.executionId)}` as RoutePath;
      }
      return basePath;
    case "opsLogs":
      if (normalized.executionId) {
        return `${basePath}/executions/${encodeURIComponent(normalized.executionId)}` as RoutePath;
      }
      if (normalized.runtimeId) {
        return `${basePath}/runtime/${encodeURIComponent(normalized.runtimeId)}` as RoutePath;
      }
      return basePath;
    default:
      return basePath;
  }
}

export function matchTabRoute(pathname: string, basePath = ""): TabRouteMatch | null {
  const normalized = stripBasePath(pathname, basePath);
  if (normalized === "/") {
    return {
      tab: "me",
      context: null,
      canonicalPath: "/",
      requestedPath: normalized,
      usedLegacyAlias: false,
    };
  }
  if (normalized === "/me") {
    return {
      tab: "me",
      context: null,
      canonicalPath: "/",
      requestedPath: normalized,
      usedLegacyAlias: true,
    };
  }
  if (normalized === "/chat") {
    return {
      tab: "me",
      context: null,
      canonicalPath: "/",
      requestedPath: normalized,
      usedLegacyAlias: true,
    };
  }
  if (normalized === BUILDER_ROOT_PATH) {
    return {
      tab: "platformCapabilities",
      context: null,
      canonicalPath: TAB_PATHS.platformCapabilities as RoutePath,
      requestedPath: normalized,
      usedLegacyAlias: true,
    };
  }
  const enterpriseMatch = matchEnterpriseRoute(normalized);
  if (enterpriseMatch) {
    return enterpriseMatch;
  }
  const canonicalNestedMatch = matchCanonicalNestedRoute(normalized);
  if (canonicalNestedMatch) {
    return canonicalNestedMatch;
  }
  const directTab = PATH_TO_TAB.get(normalized);
  if (directTab) {
    return {
      tab: directTab,
      context: extractContextFromRoute(normalized),
      canonicalPath: toRoutePath(TAB_PATHS[directTab]),
      requestedPath: normalized,
      usedLegacyAlias: false,
    };
  }
  const legacyTab = LEGACY_PATH_TO_TAB.get(normalized);
  if (!legacyTab) {
    return null;
  }
  const redirectedTab =
    LEGACY_OPS_REDIRECT_BY_TAB[legacyTab] ?? LEGACY_BUILDER_REDIRECT_BY_TAB[legacyTab] ?? legacyTab;
  const redirectedContext: CrossPortContext | null =
    (legacyTab === "opsRuntime" || legacyTab === "sessions" || legacyTab === "nodes") &&
    normalized.includes("/ops/runtime")
      ? ({
          ...extractContextFromRoute(normalized),
          sourcePort: "platform",
          sourcePage: "platformAdvanced",
        } as CrossPortContext)
      : extractContextFromRoute(normalized);
  return {
    tab: redirectedTab,
    context: redirectedContext,
    canonicalPath: isEnterpriseTab(redirectedTab)
      ? buildEnterpriseTabPath(redirectedTab, undefined)
      : toRoutePath(TAB_PATHS[redirectedTab]),
    requestedPath: normalized,
    usedLegacyAlias: true,
  };
}

export function routeContextFromPath(pathname: string, basePath = ""): CrossPortContext | null {
  return matchTabRoute(pathname, basePath)?.context ?? null;
}

export function isEnterpriseResolverPath(pathname: string, basePath = ""): boolean {
  const normalized = stripBasePath(pathname, basePath);
  return (
    normalized === ENTERPRISE_ROOT_PATH ||
    normalized === "/enterprise/organization" ||
    normalized === "/enterprise/agents" ||
    normalized === "/enterprise/usage-management" ||
    normalized === "/enterprise/capabilities" ||
    normalized === "/enterprise/data-governance" ||
    normalized === "/enterprise/mesh" ||
    normalized === "/enterprise/diagnosis" ||
    normalized === "/enterprise/model-pool" ||
    normalized === "/enterprise/usage" ||
    normalized === "/enterprise/budget" ||
    normalized === "/enterprise/settings"
  );
}

export function pathForTab(tab: Tab, basePath = "", options?: TabRouteOptions): string {
  const base = normalizeBasePath(basePath);
  const canonicalTab = canonicalizeTab(tab);
  const baseRoute = isEnterpriseTab(canonicalTab)
    ? buildEnterpriseTabPath(canonicalTab, options?.tenantId)
    : TAB_PATHS[canonicalTab];
  const path = appendContextToTabPath(canonicalTab, baseRoute as RoutePath, options?.context);
  if (path === "/") {
    return base || "/";
  }
  return base ? `${base}${path}` : path;
}

export function portForTab(tab: Tab): FrontendPort {
  return TAB_PORTS[canonicalizeTab(tab)];
}

/**
 * 根据子域解析确定当前域应落入的默认 Tab。
 *
 * 子域路由规则：
 *   - `www.openbot.love`    → "me"（员工端首页）
 *   - `gw.openbot.love`     → "me"（旧域名，加载时跳转到 www）
 *   - `biz.openbot.love`   → "enterpriseOverview"（企业端首页）
 *   - `admin.openbot.love` → "platformDashboard"（平台端首页）
 *   - 其他域/公共首页       → null（不锁定，走原有 path-based 逻辑）
 *
 * @param host - window.location.host
 */
export function defaultTabForSubdomain(host: string): Tab | null {
  const resolution = resolvePortFromSubdomain(host);
  if (!resolution.port) {
    return null;
  }
  return defaultTabForPort(resolution.port);
}

/** 每个 port 的默认落地 Tab。 */
export function defaultTabForPort(port: FrontendPort): Tab {
  switch (port) {
    case "employee":
      return "me";
    case "enterprise":
      return "enterpriseOverview";
    case "platform":
    case "ops":
      return "platformDashboard";
  }
}

/**
 * 判断给定 Tab 是否被当前子域所允许。
 * 当子域锁定了特定 port 时，只允许属于该 port 的 Tab。
 * 非 OpenBot 域或公共首页域返回 true（不限制）。
 *
 * @param tab - 待检查的 Tab
 * @param host - window.location.host
 */
export function isTabAllowedBySubdomain(tab: Tab, host: string): boolean {
  const resolution = resolvePortFromSubdomain(host);
  if (!resolution.port) {
    // 公共首页或非 OpenBot 域：不限制
    return true;
  }
  return portForTab(tab) === resolution.port;
}

export function canonicalizeTab(tab: Tab): Tab {
  switch (tab) {
    case "opsIncidents":
    case "control":
    case "overview":
      return "platformDashboard";
    case "opsRuntime":
    case "opsLogs":
    case "opsDiagnostics":
    case "sessions":
    case "nodes":
    case "logs":
    case "debug":
      return "platformAdvanced";
    case "opsRecovery":
    case "cron":
    case "config":
      return "platformSystemSettings";
    case "platformMarketplace":
      return "platformCapabilities";
    case "platformLab":
      return "platformModels";
    case "skills":
      return "platformCapabilities";
    case "agents":
      return "platformAgents";
    case "tools":
      return "platformAdvanced";
    case "models":
      return "platformModels";
    case "releases":
      return "platformSystemSettings";
    case "platformDomains":
    case "channels":
    case "instances":
    case "usage":
    case "domains":
      return "platformAdvanced";
    case "enterpriseDashboard":
      return "enterpriseOverview";
    case "enterpriseCollaboration":
    case "enterpriseSessions":
    case "enterpriseInstances":
      return "enterpriseMesh";
    case "enterpriseBudget":
      return "enterpriseUsage";
    case "enterpriseDomains":
      return "enterpriseSettings";
    case "enterpriseModels":
    case "enterpriseModelPool":
      return "enterpriseSettings";
    case "enterpriseAccounts":
      return "enterpriseOrganization";
    // @deprecated 已整合进「企业能力中心」。
    case "enterpriseAgents":
    case "enterpriseUsageManagement":
      return "enterpriseCapabilityCenter";
    case "chat":
      return "me";
    default:
      return tab;
  }
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  return matchTabRoute(pathname, basePath)?.tab ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  if (normalized === OPS_ROOT_PATH || normalized.startsWith(`${OPS_ROOT_PATH}/`)) {
    return "";
  }
  if (normalized === EMBED_ROOT_PATH || normalized.startsWith(`${EMBED_ROOT_PATH}/`)) {
    return "";
  }
  const segments = stripTrailingFileLikeSegments(normalized.split("/").filter(Boolean));
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const controlCandidate = toRoutePath(segments.slice(i).join("/"));
    if (controlCandidate === OPS_ROOT_PATH || controlCandidate.startsWith(`${OPS_ROOT_PATH}/`)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
    if (
      controlCandidate === EMBED_ROOT_PATH ||
      controlCandidate.startsWith(`${EMBED_ROOT_PATH}/`)
    ) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
    const candidate = toRoutePath(segments.slice(i).join("/"));
    if (matchTabRoute(candidate)) {
      const prefix = segments.slice(0, i);
      if (prefix.length > 0 && RESERVED_ROUTE_ROOTS.has(prefix[0] ?? "")) {
        continue;
      }
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  if (segments.length > 0 && RESERVED_ROUTE_ROOTS.has(segments[0] ?? "")) {
    return "";
  }
  // Never treat a file-like path as an install prefix.
  if (segments.every((segment) => isFileLikePathSegment(segment))) {
    return "";
  }
  return `/${segments.join("/")}`;
}

export function tabGroupsForPort(port: FrontendPort) {
  switch (port) {
    case "enterprise":
      return TAB_GROUPS.filter((group) => group.label === "enterprise");
    case "platform":
      return TAB_GROUPS.filter((group) => group.label === "platform");
    case "ops":
      return TAB_GROUPS.filter((group) => group.label === "console");
    case "employee":
    default:
      return TAB_GROUPS.filter((group) => group.label === "frontstage");
  }
}

export function navShellTitleForPort(port: FrontendPort) {
  switch (port) {
    case "platform":
      return t("nav.shell.platform.title");
    case "enterprise":
      return t("nav.shell.enterprise.title");
    case "ops":
      return t("nav.shell.ops.title");
    case "employee":
    default:
      return t("nav.shell.employee.title");
  }
}

export function navShellDescriptionForPort(port: FrontendPort) {
  switch (port) {
    case "platform":
      return t("nav.shell.platform.description");
    case "enterprise":
      return t("nav.shell.enterprise.description");
    case "ops":
      return t("nav.shell.ops.description");
    case "employee":
    default:
      return t("nav.shell.employee.description");
  }
}

export function navGroupDescription(label: (typeof TAB_GROUPS)[number]["label"]) {
  switch (label) {
    case "platform":
      return t("nav.descriptions.platform");
    case "enterprise":
      return t("nav.descriptions.enterprise");
    case "console":
      return t("nav.descriptions.console");
    case "frontstage":
    default:
      return t("nav.descriptions.frontstage");
  }
}

export function navItemDescriptionForTab(tab: Tab) {
  switch (tab) {
    case "trialApply":
      return t("nav.items.trialApply");
    case "pricing":
      return t("tabs.pricing");
    case "features":
      return t("tabs.features");
    case "privacy":
      return t("tabs.privacy");
    case "help":
      return t("tabs.help");
    case "enterpriseLogin":
      return "企业管理员登录";
    case "platformLogin":
      return "平台管理员登录";
    case "enterpriseOverview":
      return t("nav.items.enterpriseOverview");
    case "enterpriseOrganization":
      return t("nav.items.enterpriseOrganization");
    case "enterpriseDataGovernanceCenter":
      return t("nav.items.enterpriseDataGovernanceCenter");
    case "enterpriseAgents":
      return t("nav.items.enterpriseAgents");
    case "enterpriseCapabilityCenter":
      return t("nav.items.enterpriseCapabilityCenter");
    case "enterpriseMesh":
      return t("nav.items.enterpriseMesh");
    case "enterpriseDiagnosis":
      return t("nav.items.enterpriseDiagnosis");
    case "enterpriseModelPool":
    case "enterpriseModels":
      return t("nav.items.enterpriseSettings");
    case "enterpriseUsage":
      return t("nav.items.enterpriseUsage");
    case "enterpriseChannels":
      return t("nav.items.enterpriseChannels");
    case "enterpriseSettings":
      return t("nav.items.enterpriseSettings");
    case "platformDashboard":
      return t("nav.items.platformDashboard");
    case "platformTenants":
      return t("nav.items.platformTenants");
    case "platformPricing":
      return t("nav.items.platformPricing");
    case "platformCapabilities":
      return t("nav.items.platformCapabilities");
    case "platformModels":
      return t("nav.items.platformModels");
    case "platformAgents":
      return t("nav.items.platformAgents");
    case "platformObservation":
      return "运行观测";
    case "platformDiagnosis":
      return t("nav.items.platformDiagnosis");
    case "platformAdvanced":
      return t("nav.items.platformAdvanced");
    case "platformSystemSettings":
      return t("nav.items.platformSystemSettings");
    case "platformProductization":
      return t("nav.items.platformProductization");
    case "platformKeyAccounts":
      return t("nav.items.platformKeyAccounts");
    case "opsIncidents":
      return t("nav.items.opsIncidents");
    case "opsRuntime":
      return t("nav.items.opsRuntime");
    case "opsLogs":
      return t("nav.items.opsLogs");
    case "opsDiagnostics":
      return t("nav.items.opsDiagnostics");
    case "opsRecovery":
      return t("nav.items.opsRecovery");
    case "skills":
      return t("nav.items.skills");
    case "agents":
      return t("nav.items.agents");
    case "tools":
      return t("nav.items.tools");
    case "models":
      return t("nav.items.models");
    case "releases":
      return t("nav.items.releases");
    case "chat":
      return t("nav.items.chat");
    case "contacts":
      return t("nav.items.contacts");
    case "groups":
      return t("nav.items.groups");
    case "personas":
      return t("nav.items.personas");
    case "me":
      return t("nav.items.me");
    default:
      return subtitleForTab(tab);
  }
}

export function isEnterpriseTab(tab: Tab) {
  return (
    ENTERPRISE_SURFACE_TABS.includes(tab as (typeof ENTERPRISE_SURFACE_TABS)[number]) ||
    LEGACY_ENTERPRISE_TABS.includes(tab as (typeof LEGACY_ENTERPRISE_TABS)[number])
  );
}

export function isPlatformTab(tab: Tab) {
  return (
    PLATFORM_SURFACE_TABS.includes(tab as (typeof PLATFORM_SURFACE_TABS)[number]) ||
    LEGACY_PLATFORM_TABS.includes(tab as (typeof LEGACY_PLATFORM_TABS)[number])
  );
}

/** 当前 pathname 是否落在平台端模块路由下（用于模块级 popstate/hash 监听越界防护）。 */
export function isPlatformModulePath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  return /(?:^|\/)platform(?:\/|$)/.test(normalized);
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "trialApply":
      return "zap";
    case "pricing":
      return "barChart";
    case "features":
      return "zap";
    case "privacy":
      return "settings";
    case "help":
      return "messageSquare";
    case "enterpriseLogin":
    case "platformLogin":
      return "user";
    case "chat":
      return "messageSquare";
    case "me":
      return "user";
    case "personas":
      return "brain";
    case "contacts":
      return "users";
    case "groups":
      return "messagesSquare";
    case "platformDashboard":
    case "enterpriseOverview":
    case "enterpriseDashboard":
    case "platformTenants":
    case "enterpriseUsage":
    case "opsIncidents":
    case "overview":
    case "usage":
      return "barChart";
    case "platformCapabilities":
    case "skills":
    case "platformMarketplace":
      return "zap";
    case "platformModels":
    case "models":
    case "platformLab":
    case "enterpriseModelPool":
    case "enterpriseModels":
      return "brain";
    case "platformAgents":
    case "agents":
    case "enterpriseAgents":
      return "folder";
    case "enterpriseDataGovernanceCenter":
      return "database";
    case "enterpriseCapabilityCenter":
      return "zap";
    case "platformAdvanced":
    case "platformSystemSettings":
    case "platformDomains":
    case "enterpriseSettings":
    case "config":
    case "tools":
    case "control":
      return "settings";
    case "enterpriseOrganization":
    case "enterpriseAccounts":
      return "users";
    case "enterpriseMesh":
    case "enterpriseCollaboration":
    case "enterpriseChannels":
      return "messagesSquare";
    case "enterpriseDiagnosis":
    case "platformDiagnosis":
    case "opsDiagnostics":
      return "bug";
    case "enterpriseDomains":
    case "domains":
      return "folder";
    case "enterpriseSessions":
    case "sessions":
      return "fileText";
    case "enterpriseInstances":
    case "instances":
    case "opsRuntime":
      return "radio";
    case "channels":
      return "link";
    case "cron":
    case "opsRecovery":
      return "loader";
    case "nodes":
      return "monitor";
    case "debug":
      return "bug";
    case "opsLogs":
    case "logs":
      return "scrollText";
    case "releases":
      return "clipboardCheck";
    case "platformProductization":
      return "layers";
    case "platformKeyAccounts":
      return "building";
    default:
      return "folder";
  }
}

export function isConsoleTab(tab: Tab): tab is ConsoleTab {
  return (
    CONSOLE_TABS.includes(tab as ConsoleTab) ||
    LEGACY_OPS_TABS.includes(tab as (typeof LEGACY_OPS_TABS)[number])
  );
}

export function isControlSectionTab(tab: Tab): tab is ControlSectionTab {
  return CONTROL_SECTION_TABS.includes(tab as ControlSectionTab);
}

export function titleForTab(tab: Tab) {
  return t(`tabs.${tab}`);
}

export function subtitleForTab(tab: Tab) {
  return t(`subtitles.${tab}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 将已废弃的企业能力相关 tab 规范化为 `enterpriseCapabilityCenter`。
 *
 * `enterpriseAgents`（旧「企业代理」）与 `enterpriseUsageManagement`（旧「能力应用管理」）
 * 均已整合进「企业能力中心」。兼容窗口期（≥ 1 个发布周期）内，外部调用方可能仍传入旧 tab 值；
 * 本函数确保 surface 分发、路由构建等入口统一收敛到新 tab。窗口期结束后可移除此函数。
 */
export function normalizeLegacyTab(tab: Tab): Tab {
  if (tab === "enterpriseAgents" || tab === "enterpriseUsageManagement") {
    return "enterpriseCapabilityCenter";
  }
  return tab;
}

/**
 * 旧「企业代理」「能力应用管理」路径到「企业能力中心」路径的重定向映射表。
 *
 * 两个旧模块均已整合进能力中心。用于 `route-redirect.ts` 的 `resolveLegacyAgentsUrl`
 * 解析器，实现 301 永久重定向（Property 7: 幂等）。匹配顺序：从上到下，首个命中即返回。
 */
export const LEGACY_AGENTS_REDIRECTS = [
  // 旧「企业代理」→ 能力中心
  {
    pattern: /^\/enterprise\/([^/]+)\/agents\/templates\/?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/install-management`,
  },
  {
    pattern: /^\/enterprise\/([^/]+)\/agents(?:\/.*)?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/robots`,
  },
  {
    pattern: /^\/enterprise\/agents\/?$/,
    target: () => `/enterprise/capabilities`,
  },
  // 旧「能力应用管理」→ 能力中心
  {
    pattern: /^\/enterprise\/([^/]+)\/usage-management\/installs\/([^/]+)\/?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/${m[2]}`,
  },
  {
    pattern: /^\/enterprise\/([^/]+)\/usage-management\/installs\/?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/install-management`,
  },
  {
    pattern: /^\/enterprise\/([^/]+)\/usage-management\/(analytics|governance)\/?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/${m[2]}`,
  },
  {
    pattern: /^\/enterprise\/([^/]+)\/usage-management(?:\/.*)?$/,
    target: (m: RegExpMatchArray) => `/enterprise/${m[1]}/capabilities/robots`,
  },
  {
    pattern: /^\/enterprise\/usage-management\/?$/,
    target: () => `/enterprise/capabilities`,
  },
] as const;
