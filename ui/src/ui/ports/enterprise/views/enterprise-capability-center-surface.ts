import { html, nothing, type TemplateResult } from "lit";
import { createEnterpriseCapabilityGateway } from "../../../capability/enterprise-capability/gateway-client.ts";
import type {
  CapabilityDomain,
  CredibilityIndicators,
  ContributionPerformanceItem,
  DomainDistribution,
  EnterpriseAssetListItem,
  CapabilityMaturity,
  StatisticsDashboardData,
} from "../../../capability/enterprise-capability/types.ts";
import {
  changeTrendRange,
  clearAssetDetail,
  createInitialAssetDetailState,
  loadAssetDetail,
} from "../../../controllers/enterprise-asset-library/asset-detail.ts";
import {
  changePage as changeAssetListPage,
  changePageSize as changeAssetListPageSize,
  changeSort,
  createCapabilityCenterSkillsListState,
  createCapabilityCenterMcpListState,
  loadAssetList,
  updateFilter,
} from "../../../controllers/enterprise-asset-library/asset-list.ts";
import {
  changeLeaderboardView,
  createInitialContributionPerformanceState,
  exportToCsv,
  loadContributionPerformance,
  setTimeRange,
  updatePerformanceFilter,
} from "../../../controllers/enterprise-asset-library/contribution-performance.ts";
import {
  changeContributionPage,
  changeContributionPageSize,
  changeContributionSorting,
  createInitialContributionRecordsState,
  loadContributionRecords,
  updateContributionFilter,
} from "../../../controllers/enterprise-asset-library/contribution-records.ts";
import {
  beginUninstall,
  cancelUninstall,
  changeInstallPage,
  changeInstallViewMode,
  confirmUninstall,
  createInitialInstallManagementState,
  loadInstallManagement,
  updateInstallFilter,
} from "../../../controllers/enterprise-asset-library/install-management.ts";
import {
  approveReview,
  changeReviewPage,
  createInitialReviewQueueState,
  loadReviewQueue,
  rejectReview,
  requestModification,
  updateReviewFilter,
} from "../../../controllers/enterprise-asset-library/review-queue.ts";
import { createEnterpriseDataCapabilityGateway } from "../../../controllers/enterprise-data-capability/gateway-client.ts";
import type { IncubationScore } from "../../../controllers/enterprise-incubation/incubation-score.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { renderCron } from "../../../views/cron.ts";
import { renderAssetDetailPage } from "../../../views/enterprise-asset-library/asset-detail-page.ts";
import {
  buildAnalyticsPanel,
  buildGovernancePanel,
  buildRobotsPanel,
  prepareUsagePanels,
} from "../../../views/enterprise-asset-library/capability-center-usage-panels.ts";
import { renderContributionPerformancePage } from "../../../views/enterprise-asset-library/contribution-performance-page.ts";
import { renderContributionRecordsPage } from "../../../views/enterprise-asset-library/contribution-records-page.ts";
import {
  renderEnterpriseCapabilityCenterPage,
  type CapabilityCenterMainTab,
} from "../../../views/enterprise-asset-library/enterprise-capability-center-page.ts";
import type { CapabilityCenterSkillsTabProps } from "../../../views/enterprise-asset-library/enterprise-capability-center-skills-tab.ts";
import { renderInstallManagementPage } from "../../../views/enterprise-asset-library/install-management-page.ts";
import {
  buildOrganizationPushTargets,
  renderInstallToRobotDialog,
  resolveSelectedPositionIds,
  type InstallResult,
  type PositionOption,
} from "../../../views/enterprise-asset-library/install-to-robot-dialog.ts";
import type { McpDiscoveryListItem } from "../../../views/enterprise-asset-library/mcp-discovery-panel.ts";
import { renderReviewQueuePage } from "../../../views/enterprise-asset-library/review-queue-page.ts";
import { renderCandidateCard } from "../../../views/enterprise-incubation/candidate-card.ts";
import {
  renderCandidatePoolSection,
  type CandidatePoolStats,
} from "../../../views/enterprise-incubation/candidate-pool-section.ts";
import {
  renderUpstreamReportList,
  type UpstreamReportListItem,
} from "../../../views/enterprise-incubation/upstream-report-list.ts";
import {
  normalizeCapabilityInstallFacts,
  renderCapabilityInstallFacts,
  type CapabilityInstallFactsView,
} from "./enterprise-data-capability/capability-install-facts.ts";
import { renderOwnedDataAssetLinks } from "./enterprise-data-capability/owned-asset-links.ts";
import {
  followDelegatedPortHref,
  renderEnterpriseDataNotice,
  shouldProceed,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

type CapabilityCenterSurfaceState = {
  key: string | null;
  client: EnterpriseSurfaceProps["client"];
  activeTab: CapabilityCenterMainTab;
  stats: StatisticsDashboardData | null;
  statsLoaded: boolean;
  statsLoading: boolean;
  statsError: string | null;
  domains: DomainDistribution[];
  domainsLoaded: boolean;
  domainsLoading: boolean;
  domainsError: string | null;
  highValueCapabilities: Array<
    EnterpriseAssetListItem & { credibilityIndicators?: CredibilityIndicators }
  >;
  highValueLoaded: boolean;
  highValueLoading: boolean;
  highValueError: string | null;
  monthlyTopContributors: ContributionPerformanceItem[];
  contributorsLoaded: boolean;
  contributorsLoading: boolean;
  contributorsError: string | null;
  lastSuccessfulLoadAt: number | null;
};

type ManagedControllerState<T> = {
  key: string | null;
  state: T;
  hasLoaded: boolean;
};

type InstallDialogState = {
  visible: boolean;
  capabilityId: string | null;
  capabilityName: string;
  selectedTargetIds: string[];
  expandedTargetIds: string[];
  installing: boolean;
  installError: string | null;
  lastResult: InstallResult | null;
};

type IncubationCandidate = {
  capabilityId: string;
  name: string;
  maturity: CapabilityMaturity;
  calls30d: number;
  departmentCount: number;
  successRate: number;
  domain: CapabilityDomain;
  score: IncubationScore | null;
};

type IncubationCenterState = {
  key: string | null;
  client: GatewayBrowserClient | null;
  loading: boolean;
  error: string | null;
  stats: CandidatePoolStats | null;
  candidates: IncubationCandidate[];
  domainFilter: CapabilityDomain | null;
  sortBy: "calls30d" | "compositeScore";
  reportsLoading: boolean;
  reportsLoaded: boolean;
  reportsError: string | null;
  reports: UpstreamReportListItem[];
  promotionByCapabilityId: Record<
    string,
    { state: "submitting" | "submitted" | "error"; message: string | null }
  >;
  hasLoaded: boolean;
};

type CapabilityCenterRoute =
  | { kind: "overview" }
  | { kind: "all" }
  | { kind: "contribution-records" }
  | { kind: "contribution-performance" }
  | { kind: "install-management" }
  | { kind: "robots" }
  | { kind: "jobs" }
  | { kind: "analytics" }
  | { kind: "governance" }
  | { kind: "review-queue" }
  | { kind: "incubation" }
  | { kind: "detail"; capabilityId: string };

const EMPLOYEE_ASSET_STATUS_CHANGED_EVENT = "openbot:employee-asset-status-changed";

const EMPTY_STATE: CapabilityCenterSurfaceState = {
  key: null,
  client: null,
  activeTab: "skills",
  stats: null,
  statsLoaded: false,
  statsLoading: false,
  statsError: null,
  domains: [],
  domainsLoaded: false,
  domainsLoading: false,
  domainsError: null,
  highValueCapabilities: [],
  highValueLoaded: false,
  highValueLoading: false,
  highValueError: null,
  monthlyTopContributors: [],
  contributorsLoaded: false,
  contributorsLoading: false,
  contributorsError: null,
  lastSuccessfulLoadAt: null,
};

let surfaceState: CapabilityCenterSurfaceState = { ...EMPTY_STATE };
/** 贡献绩效页二级子视图：绩效明细 / 贡献流水。 */
let contributionPerformanceSubView: "performance" | "records" = "performance";
const clientRequestIds = new WeakMap<object, number>();
let nextClientRequestId = 1;

const assetListSurfaceState: ManagedControllerState<
  ReturnType<typeof createCapabilityCenterSkillsListState>
> = {
  key: null,
  state: createCapabilityCenterSkillsListState(),
  hasLoaded: false,
};
const mcpListSurfaceState: ManagedControllerState<
  ReturnType<typeof createCapabilityCenterMcpListState>
> = {
  key: null,
  state: createCapabilityCenterMcpListState(),
  hasLoaded: false,
};

type McpDiscoverySurfaceState = {
  key: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  remoteToolsList: "ok" | "unavailable" | "partial" | null;
  gap: "none" | "remote_tools_list_unavailable" | "no_candidates" | null;
  items: McpDiscoveryListItem[];
};

const EMPTY_MCP_DISCOVERY: McpDiscoverySurfaceState = {
  key: null,
  loading: false,
  loaded: false,
  error: null,
  remoteToolsList: null,
  gap: null,
  items: [],
};

let mcpDiscoveryState: McpDiscoverySurfaceState = { ...EMPTY_MCP_DISCOVERY };
const contributionRecordsSurfaceState: ManagedControllerState<
  ReturnType<typeof createInitialContributionRecordsState>
> = {
  key: null,
  state: createInitialContributionRecordsState(),
  hasLoaded: false,
};
const contributionPerformanceSurfaceState: ManagedControllerState<
  ReturnType<typeof createInitialContributionPerformanceState>
> = {
  key: null,
  state: createInitialContributionPerformanceState(),
  hasLoaded: false,
};
const installManagementSurfaceState: ManagedControllerState<
  ReturnType<typeof createInitialInstallManagementState>
> = {
  key: null,
  state: createInitialInstallManagementState(),
  hasLoaded: false,
};
const reviewQueueSurfaceState: ManagedControllerState<
  ReturnType<typeof createInitialReviewQueueState>
> = {
  key: null,
  state: createInitialReviewQueueState(),
  hasLoaded: false,
};
const assetDetailSurfaceState: ManagedControllerState<
  ReturnType<typeof createInitialAssetDetailState>
> = {
  key: null,
  state: createInitialAssetDetailState(),
  hasLoaded: false,
};

const incubationCenterState: IncubationCenterState = {
  key: null,
  client: null,
  loading: false,
  error: null,
  stats: null,
  candidates: [],
  domainFilter: null,
  sortBy: "calls30d",
  reportsLoading: false,
  reportsLoaded: false,
  reportsError: null,
  reports: [],
  promotionByCapabilityId: {},
  hasLoaded: false,
};

const installDialogState: InstallDialogState = {
  visible: false,
  capabilityId: null,
  capabilityName: "",
  selectedTargetIds: [],
  expandedTargetIds: ["all"],
  installing: false,
  installError: null,
  lastResult: null,
};

function refreshEnterpriseSurface(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function notifyEmployeeAssetStatusChanged(detail: {
  reviewTaskId: string;
  result: "通过" | "拒绝" | "需修改";
}): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(EMPLOYEE_ASSET_STATUS_CHANGED_EVENT, {
      detail,
    }),
  );
}

function followEnterprisePath(path: string): void {
  if (typeof window === "undefined") {
    return;
  }
  // Same-top-level-tab child routes do not change @state tab; must use the
  // shared helper so Lit re-renders (raw pushState+popstate alone can stick).
  pushAppHistoryState(path);
}

function normalizeBasePath(basePath: string): string {
  return basePath.replace(/\/$/, "");
}

function buildCapabilityCenterRootPath(props: EnterpriseSurfaceProps, basePath: string): string {
  return pathForTab("enterpriseCapabilityCenter", basePath, {
    tenantId: props.readModel.currentTenantId,
  });
}

function buildCapabilityCenterChildPath(
  props: EnterpriseSurfaceProps,
  basePath: string,
  suffix: string,
): string {
  return `${buildCapabilityCenterRootPath(props, basePath).replace(/\/$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function parseCapabilityCenterRoute(basePath: string): CapabilityCenterRoute {
  if (typeof window === "undefined") {
    return { kind: "overview" };
  }
  const normalizedBasePath = normalizeBasePath(basePath);
  let pathname = window.location.pathname;
  if (normalizedBasePath && pathname.startsWith(normalizedBasePath)) {
    pathname = pathname.slice(normalizedBasePath.length) || "/";
  }
  const segments = pathname.split("/").filter(Boolean);
  const capabilitiesIndex = segments.findIndex((segment) => segment === "capabilities");
  if (capabilitiesIndex < 0) {
    return { kind: "overview" };
  }
  const tail = segments.slice(capabilitiesIndex + 1);
  if (tail.length === 0) {
    return { kind: "overview" };
  }
  const [head] = tail;
  switch (head) {
    case "all":
      return { kind: "all" };
    case "contribution-records":
      return { kind: "contribution-records" };
    case "contribution-performance":
      return { kind: "contribution-performance" };
    case "install-management":
      return { kind: "install-management" };
    case "robots":
      return { kind: "robots" };
    case "jobs":
      return { kind: "jobs" };
    case "analytics":
      return { kind: "analytics" };
    case "governance":
      return { kind: "governance" };
    case "review-queue":
      return { kind: "review-queue" };
    case "incubation":
      return { kind: "incubation" };
    default:
      return { kind: "detail", capabilityId: decodeURIComponent(head) };
  }
}

function parseMainTabFromLocation(): CapabilityCenterMainTab {
  if (typeof window === "undefined") {
    return "skills";
  }
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (
    tab === "leaderboard" ||
    tab === "mcp" ||
    tab === "install" ||
    tab === "robots" ||
    tab === "jobs" ||
    tab === "analytics" ||
    tab === "governance" ||
    tab === "incubation"
  ) {
    return tab;
  }
  return "skills";
}

function syncCapabilityCenterHomeTab(
  props: EnterpriseSurfaceProps,
  basePath: string,
  tab: CapabilityCenterMainTab,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const root = buildCapabilityCenterRootPath(props, basePath).replace(/\/$/, "");
  const pathname = window.location.pathname;
  const onLegacyChild =
    pathname.endsWith("/all") ||
    pathname.endsWith("/incubation") ||
    pathname.includes("/capabilities/all") ||
    pathname.includes("/capabilities/incubation");
  const params = new URLSearchParams(window.location.search);
  params.delete("view");
  if (tab === "skills") {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }
  const target = `${root}${params.toString() ? `?${params.toString()}` : ""}`;
  const current = `${pathname}${window.location.search}`;
  if (onLegacyChild || current !== target) {
    surfaceState = {
      ...surfaceState,
      activeTab: tab,
    };
    window.history.replaceState({}, "", target);
  }
}

function applyLegacyCapabilityCenterViewFilters(): void {
  if (typeof window === "undefined") {
    return;
  }
  const view = new URLSearchParams(window.location.search).get("view");
  if (view !== "high-value") {
    return;
  }
  const state = assetListSurfaceState.state;
  if (state.filters.maturity === null) {
    updateFilter(state, "maturity", "企业认证");
  }
}

function buildSurfaceKey(props: EnterpriseSurfaceProps): string {
  const clientRef = props.client;
  if (!clientRef) {
    return `${props.readModel.currentTenantId ?? "root"}::offline`;
  }
  const existing = clientRequestIds.get(clientRef);
  if (existing !== undefined) {
    return `${props.readModel.currentTenantId ?? "root"}::client:${existing}`;
  }
  const next = nextClientRequestId;
  nextClientRequestId += 1;
  clientRequestIds.set(clientRef, next);
  return `${props.readModel.currentTenantId ?? "root"}::client:${next}`;
}

function createGateway(props: EnterpriseSurfaceProps) {
  return props.client ? createEnterpriseCapabilityGateway(props.client) : null;
}

function resetManagedState<T>(
  holder: ManagedControllerState<T>,
  key: string,
  factory: () => T,
): void {
  holder.key = key;
  holder.state = factory();
  holder.hasLoaded = false;
}

function resetIncubationState(key: string, client: GatewayBrowserClient | null): void {
  incubationCenterState.key = key;
  incubationCenterState.client = client;
  incubationCenterState.loading = false;
  incubationCenterState.error = null;
  incubationCenterState.stats = null;
  incubationCenterState.candidates = [];
  incubationCenterState.domainFilter = null;
  incubationCenterState.sortBy = "calls30d";
  incubationCenterState.reportsLoading = false;
  incubationCenterState.reportsLoaded = false;
  incubationCenterState.reportsError = null;
  incubationCenterState.reports = [];
  incubationCenterState.promotionByCapabilityId = {};
  incubationCenterState.hasLoaded = false;
}

function changeMainTab(tab: CapabilityCenterMainTab): void {
  surfaceState = {
    ...surfaceState,
    activeTab: tab,
  };
  if (typeof window !== "undefined") {
    const search = new URLSearchParams(window.location.search);
    search.delete("view");
    if (tab === "skills") {
      search.delete("tab");
    } else {
      search.set("tab", tab);
    }
    const nextSearch = search.toString();
    window.history.pushState(
      {},
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }
  refreshEnterpriseSurface();
}

function deriveAvailableScenarios(items: readonly EnterpriseAssetListItem[]): string[] {
  return Array.from(
    new Set(
      items.flatMap((item) => item.usageScenarios).filter((entry) => entry.trim().length > 0),
    ),
  ).toSorted((left, right) => left.localeCompare(right, "zh-CN"));
}

function currentCapabilityPool(): EnterpriseAssetListItem[] {
  const skills = assetListSurfaceState.state.items;
  const mcp = mcpListSurfaceState.state.items;
  if (skills.length > 0 || mcp.length > 0) {
    return [...skills, ...mcp];
  }
  return surfaceState.highValueCapabilities;
}

function bindAssetListTab(
  props: EnterpriseSurfaceProps,
  basePath: string,
  state: ReturnType<typeof createCapabilityCenterSkillsListState>,
  tab: "skills" | "mcp",
): CapabilityCenterSkillsTabProps {
  return {
    filters: state.filters,
    domains: surfaceState.domains,
    availableScenarios: deriveAvailableScenarios(state.items),
    onDomainSelect: (domain) => {
      updateFilter(state, "domain", domain);
      changeMainTab(tab);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onSearchChange: (query) => {
      updateFilter(state, "searchQuery", query);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onScenarioSelect: (scenario) => {
      updateFilter(state, "usageScenario", scenario);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    sorting: state.sorting,
    onSortChange: (sort) => {
      changeSort(state, sort);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    items: state.items,
    loading: state.loading,
    error: state.error,
    pagination: state.pagination,
    onInstallToRobot: (capabilityId) => openInstallDialog(capabilityId),
    onViewDetail: (capabilityId) =>
      followEnterprisePath(
        pathForTab("enterpriseCapabilityCenter", basePath, {
          tenantId: props.readModel.currentTenantId,
          context: { capabilityId },
        }),
      ),
    onPageChange: (page) => {
      changeAssetListPage(state, page);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onPageSizeChange: (size) => {
      changeAssetListPageSize(state, size);
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onRetry: () => {
      state.error = null;
      void loadAssetList(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    variant: tab,
  };
}

function lookupCapabilityName(capabilityId: string): string {
  const capability =
    currentCapabilityPool().find((item) => item.id === capabilityId) ??
    (assetDetailSurfaceState.state.capability &&
    assetDetailSurfaceState.state.capability.id === capabilityId
      ? ({
          id: assetDetailSurfaceState.state.capability.id,
          name: assetDetailSurfaceState.state.capability.name,
        } as const)
      : null);
  return capability?.name ?? capabilityId;
}

function createPositionOptions(
  props: EnterpriseSurfaceProps,
  capabilityId: string,
): PositionOption[] {
  const installedRobotIds = new Set(
    installManagementSurfaceState.state.items
      .filter((item) => item.capabilityId === capabilityId)
      .map((item) => item.robotId),
  );
  return props.readModel.seatSummaries.map((seat) => ({
    id: seat.seatId,
    title: seat.title,
    teamLabel: seat.teamLabel,
    employeeLabel: seat.currentEmployeeLabel,
    roleCode: seat.roleCode,
    robotCount: seat.agentIds.length,
    alreadyPushed: seat.agentIds.some((agentId) => installedRobotIds.has(agentId)),
  }));
}

function resetInstallDialog(): void {
  installDialogState.visible = false;
  installDialogState.capabilityId = null;
  installDialogState.capabilityName = "";
  installDialogState.selectedTargetIds = [];
  installDialogState.expandedTargetIds = ["all"];
  installDialogState.installing = false;
  installDialogState.installError = null;
  installDialogState.lastResult = null;
}

function openInstallDialog(capabilityId: string): void {
  installDialogState.visible = true;
  installDialogState.capabilityId = capabilityId;
  installDialogState.capabilityName = lookupCapabilityName(capabilityId);
  installDialogState.selectedTargetIds = [];
  installDialogState.expandedTargetIds = ["all"];
  installDialogState.installing = false;
  installDialogState.installError = null;
  installDialogState.lastResult = null;
  refreshEnterpriseSurface();
}

function exportContributionPerformanceCsv(props: EnterpriseSurfaceProps): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const csv = exportToCsv(contributionPerformanceSurfaceState.state);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const tenantLabel =
    props.readModel.currentTenantLabel ?? props.readModel.currentTenantId ?? "enterprise";
  anchor.href = url;
  anchor.download = `${tenantLabel}-contribution-performance.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ensureOverviewState(props: EnterpriseSurfaceProps): void {
  const key = buildSurfaceKey(props);
  if (surfaceState.key !== key) {
    surfaceState = {
      ...EMPTY_STATE,
      key,
      client: props.client,
      activeTab: parseMainTabFromLocation(),
    };
    return;
  }
  surfaceState = {
    ...surfaceState,
    activeTab: parseMainTabFromLocation(),
  };
}

function withCapabilityRequestTimeout<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`enterprise capability request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let capabilityStatsRequestGeneration = 0;

function loadCapabilityCenterStats(props: EnterpriseSurfaceProps, force = false): void {
  if (!props.client) {
    return;
  }
  if (!force && (surfaceState.statsLoading || surfaceState.statsLoaded)) {
    return;
  }
  const key = buildSurfaceKey(props);
  const generation = ++capabilityStatsRequestGeneration;
  const client = props.client;
  const gateway = createEnterpriseCapabilityGateway(client);
  surfaceState = {
    ...surfaceState,
    key,
    client,
    statsLoading: true,
    statsError: null,
  };
  void withCapabilityRequestTimeout(gateway.stats({})).then(
    (statsResponse) => {
      if (generation !== capabilityStatsRequestGeneration) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        key,
        statsLoaded: true,
        statsLoading: false,
        statsError: null,
        stats: statsResponse.stats,
        lastSuccessfulLoadAt: Date.now(),
      };
      refreshEnterpriseSurface();
    },
    (error) => {
      if (generation !== capabilityStatsRequestGeneration) {
        return;
      }
      const disconnected =
        isGatewayDisconnectedError(error) ||
        (error instanceof Error && /gateway rebinding/i.test(error.message));
      surfaceState = {
        ...surfaceState,
        key,
        // Keep loaded so a render does not immediately retry; explicit refresh uses force.
        statsLoaded: true,
        statsLoading: false,
        statsError: disconnected ? null : "企业能力统计数据加载失败，请稍后重试",
      };
      refreshEnterpriseSurface();
    },
  );
}

function loadCapabilityCenterDomains(props: EnterpriseSurfaceProps): void {
  if (!props.client || surfaceState.domainsLoading || surfaceState.domainsLoaded) {
    return;
  }
  const key = buildSurfaceKey(props);
  const client = props.client;
  const gateway = createEnterpriseCapabilityGateway(client);
  surfaceState = {
    ...surfaceState,
    key,
    client,
    domainsLoading: true,
    domainsError: null,
  };
  void withCapabilityRequestTimeout(gateway.domainDistribution({ domain: null })).then(
    (domainResponse) => {
      if (surfaceState.key !== key) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        domainsLoaded: true,
        domainsLoading: false,
        domainsError: null,
        domains: domainResponse.domains,
      };
      refreshEnterpriseSurface();
    },
    () => {
      if (surfaceState.key !== key) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        domainsLoaded: true,
        domainsLoading: false,
        domainsError: "企业能力领域分布加载失败，请稍后重试",
      };
      refreshEnterpriseSurface();
    },
  );
}

function _loadCapabilityCenterHighValue(props: EnterpriseSurfaceProps): void {
  if (!props.client || surfaceState.highValueLoading || surfaceState.highValueLoaded) {
    return;
  }
  const key = buildSurfaceKey(props);
  const client = props.client;
  const gateway = createEnterpriseCapabilityGateway(client);
  surfaceState = {
    ...surfaceState,
    key,
    client,
    highValueLoading: true,
    highValueError: null,
  };
  void withCapabilityRequestTimeout(
    gateway.list({
      filters: {
        searchQuery: "",
        usageScenario: null,
        applicableTarget: null,
        domain: null,
        maturity: null,
        healthStatus: null,
        onlyInstallable: false,
      },
      pagination: { page: 1, pageSize: 50 },
      sorting: { field: "reuseValue", direction: "desc" },
      sidebarEntry: "all",
    }),
  ).then(
    async (listResponse) => {
      if (surfaceState.key !== key) {
        return;
      }
      const filteredItems = listResponse.items.filter(
        (item) =>
          item.maturity === "企业认证" ||
          item.maturity === "企业标准" ||
          item.maturity === "核心资产",
      );
      const detailedCapabilities = await Promise.all(
        filteredItems.slice(0, 10).map(async (item) => {
          try {
            const detailResponse = await gateway.detail({ capabilityId: item.id });
            return {
              ...item,
              credibilityIndicators: detailResponse.capability.credibilityIndicators,
            };
          } catch {
            return item;
          }
        }),
      );
      if (surfaceState.key !== key) {
        return;
      }
      const highValueCapabilities = detailedCapabilities
        .filter(
          (item) =>
            item.maturity === "企业认证" ||
            item.maturity === "企业标准" ||
            item.maturity === "核心资产",
        )
        .slice(0, 10);
      surfaceState = {
        ...surfaceState,
        highValueLoaded: true,
        highValueLoading: false,
        highValueError: null,
        highValueCapabilities,
      };
      refreshEnterpriseSurface();
    },
    () => {
      if (surfaceState.key !== key) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        highValueLoaded: true,
        highValueLoading: false,
        highValueError: "高价值能力加载失败，请稍后重试",
      };
      refreshEnterpriseSurface();
    },
  );
}

function loadCapabilityCenterContributors(props: EnterpriseSurfaceProps): void {
  if (!props.client || surfaceState.contributorsLoading || surfaceState.contributorsLoaded) {
    return;
  }
  const key = buildSurfaceKey(props);
  const client = props.client;
  const gateway = createEnterpriseCapabilityGateway(client);
  surfaceState = {
    ...surfaceState,
    key,
    client,
    contributorsLoading: true,
    contributorsError: null,
  };
  void withCapabilityRequestTimeout(
    gateway.contributionPerformance({
      filters: {
        department: null,
        rangeStart: null,
        rangeEnd: null,
        sortField: "totalContributions",
        sortDirection: "desc",
      },
    }),
  ).then(
    (contributionResponse) => {
      if (surfaceState.key !== key) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        contributorsLoaded: true,
        contributorsLoading: false,
        contributorsError: null,
        monthlyTopContributors: contributionResponse.items.slice(0, 5),
      };
      refreshEnterpriseSurface();
    },
    () => {
      if (surfaceState.key !== key) {
        return;
      }
      surfaceState = {
        ...surfaceState,
        contributorsLoaded: true,
        contributorsLoading: false,
        contributorsError: "贡献绩效数据加载失败，请稍后重试",
      };
      refreshEnterpriseSurface();
    },
  );
}

function ensureControllerStates(props: EnterpriseSurfaceProps): void {
  const key = buildSurfaceKey(props);
  const gateway = createGateway(props);
  if (assetListSurfaceState.key !== key) {
    resetManagedState(assetListSurfaceState, key, createCapabilityCenterSkillsListState);
  }
  if (mcpListSurfaceState.key !== key) {
    resetManagedState(mcpListSurfaceState, key, createCapabilityCenterMcpListState);
  }
  if (mcpDiscoveryState.key !== key) {
    mcpDiscoveryState = { ...EMPTY_MCP_DISCOVERY, key };
  }
  if (contributionRecordsSurfaceState.key !== key) {
    resetManagedState(contributionRecordsSurfaceState, key, createInitialContributionRecordsState);
  }
  if (contributionPerformanceSurfaceState.key !== key) {
    resetManagedState(
      contributionPerformanceSurfaceState,
      key,
      createInitialContributionPerformanceState,
    );
  }
  if (installManagementSurfaceState.key !== key) {
    resetManagedState(installManagementSurfaceState, key, createInitialInstallManagementState);
  }
  if (reviewQueueSurfaceState.key !== key) {
    resetManagedState(reviewQueueSurfaceState, key, createInitialReviewQueueState);
  }
  if (assetDetailSurfaceState.key !== key) {
    resetManagedState(assetDetailSurfaceState, key, createInitialAssetDetailState);
  }
  if (incubationCenterState.key !== key) {
    resetIncubationState(key, props.client ?? null);
  }

  assetListSurfaceState.state.gateway = gateway;
  mcpListSurfaceState.state.gateway = gateway;
  contributionRecordsSurfaceState.state.gateway = gateway;
  contributionPerformanceSurfaceState.state.gateway = gateway;
  installManagementSurfaceState.state.gateway = gateway;
  reviewQueueSurfaceState.state.gateway = gateway;
  assetDetailSurfaceState.state.gateway = gateway;
}

function scoreFromSnapshot(snapshot: {
  reuseBreath: number;
  effectStability: number;
  businessCoverage: number;
  employeeSatisfaction: number | null;
  compositeScore: number;
}): IncubationScore {
  return {
    reuseBreath: { value: snapshot.reuseBreath, available: true },
    effectStability: { value: snapshot.effectStability, available: true },
    businessCoverage: { value: snapshot.businessCoverage, available: true },
    employeeSatisfaction: {
      value: snapshot.employeeSatisfaction ?? 0,
      available: snapshot.employeeSatisfaction !== null,
    },
    compositeScore: snapshot.compositeScore,
  };
}

function isGatewayDisconnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("gateway not connected") || message.startsWith("gateway closed");
}

function isGatewayMethodUnavailableError(error: unknown, method: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`unknown method: ${method}`);
}

function loadIncubationCandidates(): void {
  const client = incubationCenterState.client;
  if (!client || !client.connected || incubationCenterState.loading) {
    return;
  }
  incubationCenterState.loading = true;
  incubationCenterState.error = null;
  const key = incubationCenterState.key;
  void withCapabilityRequestTimeout(
    client.request<{
      candidates: Array<
        Omit<IncubationCandidate, "score"> & {
          score: {
            reuseBreath: number;
            effectStability: number;
            businessCoverage: number;
            employeeSatisfaction: number | null;
            compositeScore: number;
          };
        }
      >;
      stats: CandidatePoolStats;
    }>("incubation.candidate-pool", {
      domainFilter: incubationCenterState.domainFilter,
      sortBy: incubationCenterState.sortBy,
    }),
    10000,
  ).then(
    (response) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      incubationCenterState.loading = false;
      incubationCenterState.error = null;
      incubationCenterState.hasLoaded = true;
      incubationCenterState.stats = response.stats;
      incubationCenterState.candidates = (response.candidates ?? []).map((candidate) => ({
        ...candidate,
        score: scoreFromSnapshot(candidate.score),
      }));
      refreshEnterpriseSurface();
    },
    (error) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      incubationCenterState.loading = false;
      if (isGatewayDisconnectedError(error)) {
        incubationCenterState.error = null;
        incubationCenterState.hasLoaded = false;
        refreshEnterpriseSurface();
        return;
      }
      incubationCenterState.error = "候选能力加载失败，请稍后重试";
      incubationCenterState.hasLoaded = true;
      refreshEnterpriseSurface();
    },
  );
}

function loadIncubationReports(): void {
  const client = incubationCenterState.client;
  if (!client || !client.connected || incubationCenterState.reportsLoading) {
    return;
  }
  incubationCenterState.reportsLoading = true;
  incubationCenterState.reportsError = null;
  const key = incubationCenterState.key;
  void withCapabilityRequestTimeout(
    client.request<{ reports: UpstreamReportListItem[] }>(
      "enterprise-capability.platform-submissions",
      {},
    ),
    10000,
  ).then(
    (response) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      incubationCenterState.reportsLoading = false;
      incubationCenterState.reportsLoaded = true;
      incubationCenterState.reportsError = null;
      incubationCenterState.reports = response.reports;
      refreshEnterpriseSurface();
    },
    (error) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      incubationCenterState.reportsLoading = false;
      if (isGatewayDisconnectedError(error)) {
        incubationCenterState.reportsLoaded = false;
        incubationCenterState.reportsError = null;
        refreshEnterpriseSurface();
        return;
      }
      if (isGatewayMethodUnavailableError(error, "enterprise-capability.platform-submissions")) {
        incubationCenterState.reportsLoaded = true;
        incubationCenterState.reportsError = null;
        incubationCenterState.reports = [];
        refreshEnterpriseSurface();
        return;
      }
      incubationCenterState.reportsLoaded = true;
      const message = error instanceof Error ? error.message : String(error);
      incubationCenterState.reportsError = message
        ? `上报记录加载失败：${message}`
        : "上报记录加载失败，请稍后重试";
      refreshEnterpriseSurface();
    },
  );
}

function ensureIncubationLoaded(): void {
  if (!incubationCenterState.hasLoaded && !incubationCenterState.loading) {
    loadIncubationCandidates();
  }
  if (
    !incubationCenterState.reportsLoaded &&
    !incubationCenterState.reportsLoading &&
    !incubationCenterState.reportsError
  ) {
    loadIncubationReports();
  }
}

function recommendCandidateUpload(
  candidate: IncubationCandidate,
  _props: EnterpriseSurfaceProps,
): void {
  const client = incubationCenterState.client;
  if (!client) {
    incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
      state: "error",
      message: "正在连接企业能力数据，请稍后重试",
    };
    refreshEnterpriseSurface();
    return;
  }
  if (
    incubationCenterState.promotionByCapabilityId[candidate.capabilityId]?.state === "submitting"
  ) {
    return;
  }
  if (
    !shouldProceed(
      `确认把「${candidate.name}」脱敏后上报平台？上报会提交到平台审核，不能在这里撤回。`,
    )
  ) {
    return;
  }

  incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
    state: "submitting",
    message: "正在进行脱敏检查…",
  };
  refreshEnterpriseSurface();

  const key = incubationCenterState.key;
  const capabilityId = candidate.capabilityId;

  // P0 能力安装治理：脱敏预览 → 脱敏确认 → 提交平台审核
  void withCapabilityRequestTimeout(
    client.request<{
      capabilityId: string;
      overallCompleteness: number;
      totalFindings: number;
      unresolvedFindings: number;
      findings: Array<{
        id: string;
        category: string;
        severity: string;
        description: string;
        count: number;
        resolved: boolean;
        originalValue?: string;
      }>;
      canProceed: boolean;
    }>("enterprise-capability.sanitization-preview", { capabilityId }),
    10000,
  )
    .then((preview) => {
      if (incubationCenterState.key !== key) {
        throw new Error("state changed");
      }

      // 自动为每个 finding 生成 resolution（使用 redact 策略）
      const resolutions = preview.findings.map((f) => ({
        findingId: f.id,
        replacement: "[REDACTED]",
        replacementType: "redact" as const,
      }));

      incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
        state: "submitting",
        message: `发现 ${preview.totalFindings} 个脱敏项，正在逐项处理…`,
      };
      refreshEnterpriseSurface();

      // 脱敏确认：逐项处理
      return withCapabilityRequestTimeout(
        client.request<{
          capabilityId: string;
          sanitizationState: string;
          sanitizedPackageId: string;
          appliedReplacements: number;
          artifactHash: string;
          canSubmitToPlatform: boolean;
        }>("enterprise-capability.sanitization-confirm", {
          capabilityId,
          replacements: resolutions,
        }),
        10000,
      );
    })
    .then((confirm) => {
      if (incubationCenterState.key !== key) {
        throw new Error("state changed");
      }

      if (!confirm.canSubmitToPlatform) {
        throw new Error("脱敏未完成，无法提交平台");
      }

      incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
        state: "submitting",
        message: `脱敏完成（${confirm.appliedReplacements} 项替换），正在提交平台审核…`,
      };
      refreshEnterpriseSurface();

      // 提交平台审核（携带 sanitized package provenance）
      return withCapabilityRequestTimeout(
        client.request<{
          capabilityId: string;
          submissionId: string;
          sanitizedPackageId: string;
          artifactHash: string;
          status: string;
          submittedAt: number;
          message: string;
        }>("enterprise-capability.submit-to-platform", {
          capabilityId,
          capabilityName: candidate.name,
          enterpriseId: "default",
          enterpriseName: "企业",
        }),
        10000,
      );
    })
    .then((submit) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
        state: "submitted",
        message: `已提交平台审核（提交ID: ${submit.submissionId}, 脱敏产物: ${submit.artifactHash.slice(0, 8)}…）`,
      };
      incubationCenterState.hasLoaded = false;
      incubationCenterState.reportsLoaded = false;
      loadIncubationCandidates();
      loadIncubationReports();
      refreshEnterpriseSurface();
    })
    .catch((error) => {
      if (incubationCenterState.key !== key) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      incubationCenterState.promotionByCapabilityId[candidate.capabilityId] = {
        state: "error",
        message: message || "上报失败，请稍后重试",
      };
      refreshEnterpriseSurface();
    });
}

function ensureAssetListLoaded(): void {
  const state = assetListSurfaceState.state;
  if (assetListSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  assetListSurfaceState.hasLoaded = true;
  void loadAssetList(state).then(refreshEnterpriseSurface, () => {
    assetListSurfaceState.hasLoaded = false;
  });
}

function ensureMcpListLoaded(): void {
  const state = mcpListSurfaceState.state;
  if (mcpListSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  mcpListSurfaceState.hasLoaded = true;
  void loadAssetList(state).then(refreshEnterpriseSurface, () => {
    mcpListSurfaceState.hasLoaded = false;
  });
}

function dataGovernanceHref(
  props: EnterpriseSurfaceProps,
  basePath: string,
  edc: "capabilities" | "authorization",
): string {
  const path = pathForTab("enterpriseDataGovernanceCenter", basePath, {
    tenantId: props.readModel.currentTenantId,
  });
  return `${path}?edc=${edc}`;
}

function ensureMcpDiscoveryLoaded(props: EnterpriseSurfaceProps): void {
  const client = props.client;
  if (!client || mcpDiscoveryState.loaded || mcpDiscoveryState.loading) {
    return;
  }
  const key = mcpDiscoveryState.key;
  mcpDiscoveryState = { ...mcpDiscoveryState, loading: true, error: null };
  const tenantId = props.readModel.currentTenantId ?? undefined;
  void client
    .request<{
      remoteToolsList: "ok" | "unavailable" | "partial";
      gap: "none" | "remote_tools_list_unavailable" | "no_candidates";
      items: McpDiscoveryListItem[];
    }>("enterprise-data.mcp-discovery", tenantId ? { tenantId } : {})
    .then(
      (result) => {
        if (mcpDiscoveryState.key !== key) {
          return;
        }
        mcpDiscoveryState = {
          ...mcpDiscoveryState,
          loading: false,
          loaded: true,
          error: null,
          remoteToolsList: result.remoteToolsList ?? "unavailable",
          gap: result.gap ?? "remote_tools_list_unavailable",
          items: Array.isArray(result.items) ? result.items : [],
        };
        refreshEnterpriseSurface();
      },
      () => {
        if (mcpDiscoveryState.key !== key) {
          return;
        }
        mcpDiscoveryState = {
          ...mcpDiscoveryState,
          loading: false,
          loaded: true,
          error: "MCP 发现列表加载失败，请稍后重试",
          items: [],
        };
        refreshEnterpriseSurface();
      },
    );
}

function ensureContributionRecordsLoaded(): void {
  const state = contributionRecordsSurfaceState.state;
  if (contributionRecordsSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  contributionRecordsSurfaceState.hasLoaded = true;
  void loadContributionRecords(state).then(refreshEnterpriseSurface, () => {
    contributionRecordsSurfaceState.hasLoaded = false;
  });
}

function ensureContributionPerformanceLoaded(): void {
  const state = contributionPerformanceSurfaceState.state;
  if (contributionPerformanceSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  contributionPerformanceSurfaceState.hasLoaded = true;
  void loadContributionPerformance(state).then(refreshEnterpriseSurface, () => {
    contributionPerformanceSurfaceState.hasLoaded = false;
  });
}

function ensureInstallManagementLoaded(): void {
  const state = installManagementSurfaceState.state;
  if (installManagementSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  installManagementSurfaceState.hasLoaded = true;
  void loadInstallManagement(state).then(refreshEnterpriseSurface, () => {
    installManagementSurfaceState.hasLoaded = false;
  });
}

function ensureReviewQueueLoaded(): void {
  const state = reviewQueueSurfaceState.state;
  if (reviewQueueSurfaceState.hasLoaded || state.loading || state.error) {
    return;
  }
  reviewQueueSurfaceState.hasLoaded = true;
  void loadReviewQueue(state).then(refreshEnterpriseSurface, () => {
    reviewQueueSurfaceState.hasLoaded = false;
  });
}

function ensureAssetDetailLoaded(capabilityId: string): void {
  const state = assetDetailSurfaceState.state;
  if (
    (assetDetailSurfaceState.hasLoaded && state.capability?.id === capabilityId) ||
    state.loading
  ) {
    return;
  }
  clearAssetDetail(state);
  assetDetailSurfaceState.hasLoaded = true;
  void loadAssetDetail(state, capabilityId).then(refreshEnterpriseSurface, () => {
    assetDetailSurfaceState.hasLoaded = false;
  });
}

function buildIncubationTabPanel(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  const dataConnected = Boolean(props.client?.connected);
  return html`
    <div class="enterprise-capability-center-page__incubation-embedded">
      ${renderCandidatePoolSection({
        stats: incubationCenterState.stats,
        candidates: incubationCenterState.candidates,
        loading: dataConnected && incubationCenterState.loading,
        error: dataConnected ? incubationCenterState.error : "正在连接企业能力数据",
        domainFilter: incubationCenterState.domainFilter,
        sortBy: incubationCenterState.sortBy,
        onDomainFilterChange: (domain) => {
          incubationCenterState.domainFilter = domain;
          incubationCenterState.hasLoaded = false;
          loadIncubationCandidates();
          refreshEnterpriseSurface();
        },
        onSortChange: (sortBy) => {
          incubationCenterState.sortBy = sortBy;
          incubationCenterState.hasLoaded = false;
          loadIncubationCandidates();
          refreshEnterpriseSurface();
        },
        onRetry: () => {
          incubationCenterState.hasLoaded = false;
          loadIncubationCandidates();
          refreshEnterpriseSurface();
        },
      })}
      ${
        incubationCenterState.loading && incubationCenterState.candidates.length === 0
          ? html`
              <div class="enterprise-card enterprise-card--flat">候选能力正在加载…</div>
            `
          : html`
              <div class="enterprise-incubation-candidate-grid" role="list">
                ${incubationCenterState.candidates.map((candidate) =>
                  renderCandidateCard({
                    candidate,
                    promotionState:
                      incubationCenterState.promotionByCapabilityId[candidate.capabilityId]?.state,
                    promotionMessage:
                      incubationCenterState.promotionByCapabilityId[candidate.capabilityId]
                        ?.message ?? null,
                    onNavigateToDetail: (capabilityId) =>
                      followEnterprisePath(
                        pathForTab("enterpriseCapabilityCenter", basePath, {
                          tenantId: props.readModel.currentTenantId,
                          context: { capabilityId },
                        }),
                      ),
                    onRecommendUpload: () => recommendCandidateUpload(candidate, props),
                  }),
                )}
              </div>
            `
      }
      ${
        !dataConnected
          ? html`
              <div class="callout info">正在连接企业能力数据，连接后将自动加载上报记录。</div>
            `
          : ""
      }
      ${
        dataConnected && incubationCenterState.reportsError
          ? html`<div class="callout danger">${incubationCenterState.reportsError}</div>`
          : ""
      }
      ${renderUpstreamReportList({
        reports: incubationCenterState.reports,
        onNavigateToCapability: (capabilityId) =>
          followEnterprisePath(
            pathForTab("enterpriseCapabilityCenter", basePath, {
              tenantId: props.readModel.currentTenantId,
              context: { capabilityId },
            }),
          ),
      })}
    </div>
  `;
}

function renderOverviewRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  const disconnected = !props.client;
  applyLegacyCapabilityCenterViewFilters();

  if (surfaceState.activeTab === "skills") {
    ensureAssetListLoaded();
    loadCapabilityCenterDomains(props);
  }
  if (surfaceState.activeTab === "mcp") {
    ensureMcpListLoaded();
    ensureMcpDiscoveryLoaded(props);
  }
  if (surfaceState.activeTab === "incubation") {
    ensureIncubationLoaded();
  }
  if (surfaceState.activeTab === "leaderboard") {
    loadCapabilityCenterContributors(props);
  }
  // 「安装与运行」合并 Tab：install / robots 两个子视图可即时切换，故两者数据都需就绪。
  if (surfaceState.activeTab === "install" || surfaceState.activeTab === "robots") {
    ensureInstallManagementLoaded();
    prepareUsagePanels(
      {
        client: props.client ?? null,
        basePath,
        tenantId: props.readModel.currentTenantId ?? "default",
        rerender: refreshEnterpriseSurface,
      },
      "robots",
    );
  }
  if (surfaceState.activeTab === "analytics" || surfaceState.activeTab === "governance") {
    prepareUsagePanels(
      {
        client: props.client ?? null,
        basePath,
        tenantId: props.readModel.currentTenantId ?? "default",
        rerender: refreshEnterpriseSurface,
      },
      surfaceState.activeTab,
    );
  }

  const assetState = assetListSurfaceState.state;
  const mcpState = mcpListSurfaceState.state;
  const installCoverageLabel = installManagementSurfaceState.hasLoaded
    ? `${installManagementSurfaceState.state.summary.coveredRobotCount} 个机器人`
    : surfaceState.stats
      ? `${surfaceState.stats.coveredRobots} 个机器人`
      : null;
  const incubationCandidateCount = incubationCenterState.stats
    ? incubationCenterState.stats.totalCandidates
    : incubationCenterState.hasLoaded
      ? incubationCenterState.candidates.length
      : null;

  return renderEnterpriseCapabilityCenterPage({
    stats: surfaceState.stats,
    statsLoading: Boolean(props.client) && surfaceState.statsLoading,
    statsError: disconnected ? null : surfaceState.statsError,
    lastSuccessfulLoadAt: surfaceState.lastSuccessfulLoadAt,
    onRefreshStats: () => {
      surfaceState = {
        ...surfaceState,
        statsLoaded: false,
        statsLoading: false,
        statsError: null,
      };
      loadCapabilityCenterStats(props, true);
      refreshEnterpriseSurface();
    },
    onNavigateReviewQueue: () =>
      followEnterprisePath(buildCapabilityCenterChildPath(props, basePath, "review-queue")),
    reviewQueueHref: buildCapabilityCenterChildPath(props, basePath, "review-queue"),
    skillsHref: buildCapabilityCenterRootPath(props, basePath).replace(/\/$/, ""),
    installHref: `${buildCapabilityCenterRootPath(props, basePath).replace(/\/$/, "")}?tab=install`,
    incubationHref: `${buildCapabilityCenterRootPath(props, basePath).replace(/\/$/, "")}?tab=incubation`,
    pendingReviewCount: reviewQueueSurfaceState.hasLoaded
      ? reviewQueueSurfaceState.state.pagination.totalItems
      : null,
    incubationCandidateCount,
    installCoverageLabel,
    activeTab: surfaceState.activeTab,
    onTabChange: changeMainTab,
    monthlyTopContributors: surfaceState.monthlyTopContributors,
    contributorsError: surfaceState.contributorsError,
    onRetryContributors: () => {
      surfaceState = {
        ...surfaceState,
        contributorsLoaded: false,
        contributorsLoading: false,
        contributorsError: null,
      };
      loadCapabilityCenterContributors(props);
      refreshEnterpriseSurface();
    },
    onViewContributionPerformance: () =>
      followEnterprisePath(
        buildCapabilityCenterChildPath(props, basePath, "contribution-performance"),
      ),
    incubationPanel:
      surfaceState.activeTab === "incubation" ? buildIncubationTabPanel(props, basePath) : nothing,
    robotsPanel: surfaceState.activeTab === "robots" ? buildRobotsPanel() : nothing,
    jobsPanel:
      surfaceState.activeTab === "jobs"
        ? props.cronProps
          ? renderCron(props.cronProps)
          : html`
              <div class="muted">定时任务视图不可用。</div>
            `
        : nothing,
    analyticsPanel:
      surfaceState.activeTab === "analytics"
        ? buildAnalyticsPanel({
            client: props.client ?? null,
            basePath,
            tenantId: props.readModel.currentTenantId ?? "default",
            rerender: refreshEnterpriseSurface,
          })
        : nothing,
    governancePanel:
      surfaceState.activeTab === "governance"
        ? buildGovernancePanel({
            client: props.client ?? null,
            basePath,
            tenantId: props.readModel.currentTenantId ?? "default",
            rerender: refreshEnterpriseSurface,
          })
        : nothing,
    installManagementPanel:
      surfaceState.activeTab === "install" ? buildInstallManagementPanel(props, basePath) : nothing,
    skillsTab: bindAssetListTab(props, basePath, assetState, "skills"),
    mcpTab: bindAssetListTab(props, basePath, mcpState, "mcp"),
    mcpDiscovery: {
      loading: Boolean(props.client) && mcpDiscoveryState.loading,
      error: mcpDiscoveryState.error,
      disconnected: !props.client,
      remoteToolsList: mcpDiscoveryState.remoteToolsList ?? "unavailable",
      gap: mcpDiscoveryState.gap,
      items: mcpDiscoveryState.items,
      mapHref: dataGovernanceHref(props, basePath, "capabilities"),
      authorizeHref: dataGovernanceHref(props, basePath, "authorization"),
      onRetry: () => {
        mcpDiscoveryState = {
          ...mcpDiscoveryState,
          loaded: false,
          loading: false,
          error: null,
        };
        ensureMcpDiscoveryLoaded(props);
      },
    },
  });
}

function renderAllCapabilitiesRoute(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "skills");
  return renderOverviewRoute(props, basePath);
}

function buildContributionRecordsPanel(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  ensureContributionRecordsLoaded();
  const state = contributionRecordsSurfaceState.state;
  return renderContributionRecordsPage({
    embedded: true,
    items: state.items,
    loading: state.loading,
    error: state.error,
    pagination: state.pagination,
    filters: state.filters,
    sorting: state.sorting,
    onFilterChange: (key, value) => {
      updateContributionFilter(state, key, value);
      void loadContributionRecords(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onSortChange: (field) => {
      changeContributionSorting(state, field);
      void loadContributionRecords(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onPageChange: (page) => {
      changeContributionPage(state, page);
      void loadContributionRecords(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onPageSizeChange: (size) => {
      changeContributionPageSize(state, size);
      void loadContributionRecords(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onViewDetail: (capabilityId) =>
      followEnterprisePath(
        pathForTab("enterpriseCapabilityCenter", basePath, {
          tenantId: props.readModel.currentTenantId,
          context: { capabilityId },
        }),
      ),
    onNavigateReviewQueue: () =>
      followEnterprisePath(buildCapabilityCenterChildPath(props, basePath, "review-queue")),
    onBack: () => followEnterprisePath(buildCapabilityCenterRootPath(props, basePath)),
  });
}

function buildInstallManagementPanel(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  const state = installManagementSurfaceState.state;
  return renderInstallManagementPage({
    items: state.items,
    loading: state.loading,
    error: state.error,
    pagination: state.pagination,
    filters: state.filters,
    summary: state.summary,
    viewMode: state.viewMode,
    pendingUninstallId: state.pendingUninstallId,
    uninstalling: state.uninstalling,
    uninstallError: state.uninstallError,
    onFilterChange: (key, value) => {
      updateInstallFilter(state, key, value);
      void loadInstallManagement(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onViewModeChange: (mode) => {
      changeInstallViewMode(state, mode);
      refreshEnterpriseSurface();
    },
    onPageChange: (page) => {
      changeInstallPage(state, page);
      void loadInstallManagement(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onBeginUninstall: (id) => {
      beginUninstall(state, id);
      refreshEnterpriseSurface();
    },
    onConfirmUninstall: async () => {
      await confirmUninstall(state);
      refreshEnterpriseSurface();
    },
    onCancelUninstall: () => {
      cancelUninstall(state);
      refreshEnterpriseSurface();
    },
    onBack: () => followEnterprisePath(buildCapabilityCenterRootPath(props, basePath)),
  });
}

function renderContributionRecordsRoute(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  // 贡献记录已整合为「贡献绩效」页的「贡献流水」子视图；旧深链规范化到该页并选中该子视图。
  contributionPerformanceSubView = "records";
  if (typeof window !== "undefined") {
    const target = buildCapabilityCenterChildPath(props, basePath, "contribution-performance");
    const targetPath = new URL(target, window.location.origin).pathname;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState({}, "", target);
    }
  }
  return renderContributionPerformanceRoute(props, basePath);
}

function renderContributionPerformanceRoute(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  ensureContributionPerformanceLoaded();
  if (contributionPerformanceSubView === "records") {
    ensureContributionRecordsLoaded();
  }
  const state = contributionPerformanceSurfaceState.state;
  return renderContributionPerformancePage({
    items: state.items,
    loading: state.loading,
    error: state.error,
    leaderboardView: state.leaderboardView,
    subView: contributionPerformanceSubView,
    onSubViewChange: (view) => {
      contributionPerformanceSubView = view;
      if (view === "records") {
        ensureContributionRecordsLoaded();
      }
      refreshEnterpriseSurface();
    },
    recordsPanel: buildContributionRecordsPanel(props, basePath),
    filters: {
      department: state.filters.department,
      rangeStart: state.filters.rangeStart,
      rangeEnd: state.filters.rangeEnd,
    },
    onFilterDepartment: (department) => {
      updatePerformanceFilter(state, "department", department);
      void loadContributionPerformance(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onSetTimeRange: (range) => {
      setTimeRange(state, range);
      void loadContributionPerformance(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onChangeLeaderboardView: (view) => {
      changeLeaderboardView(state, view);
      refreshEnterpriseSurface();
    },
    onExportCsv: () => exportContributionPerformanceCsv(props),
    onBack: () => followEnterprisePath(buildCapabilityCenterRootPath(props, basePath)),
  });
}

function renderInstallManagementRoute(
  props: EnterpriseSurfaceProps,
  basePath: string,
): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "install");
  return renderOverviewRoute(props, basePath);
}

function renderRobotsRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "robots");
  return renderOverviewRoute(props, basePath);
}

function renderJobsRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "jobs");
  return renderOverviewRoute(props, basePath);
}

function renderAnalyticsRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "analytics");
  return renderOverviewRoute(props, basePath);
}

function renderGovernanceRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "governance");
  return renderOverviewRoute(props, basePath);
}

function renderReviewQueueRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  ensureReviewQueueLoaded();
  const state = reviewQueueSurfaceState.state;
  return renderReviewQueuePage({
    items: state.items,
    loading: state.loading,
    error: state.error,
    pagination: state.pagination,
    filters: state.filters,
    submitting: state.submitting,
    submitError: state.submitError,
    lastReviewRecord: state.lastReviewRecord,
    lastEmployeeFeedbackNotice: state.lastEmployeeFeedbackNotice,
    onFilterChange: (key, value) => {
      updateReviewFilter(
        state,
        key,
        key === "status" ? (value as "待审核" | "审核中" | null) : (value ?? ""),
      );
      void loadReviewQueue(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onPageChange: (page) => {
      changeReviewPage(state, page);
      void loadReviewQueue(state).then(refreshEnterpriseSurface);
      refreshEnterpriseSurface();
    },
    onApprove: async (reviewTaskId, opinion, approval) => {
      const ok = await approveReview(state, reviewTaskId, opinion, approval);
      if (ok) {
        notifyEmployeeAssetStatusChanged({ reviewTaskId, result: "通过" });
      }
      refreshEnterpriseSurface();
    },
    onReject: async (reviewTaskId, opinion) => {
      const ok = await rejectReview(state, reviewTaskId, opinion);
      if (ok) {
        notifyEmployeeAssetStatusChanged({ reviewTaskId, result: "拒绝" });
      }
      refreshEnterpriseSurface();
    },
    onRequestModification: async (reviewTaskId, opinion) => {
      const ok = await requestModification(state, reviewTaskId, opinion);
      if (ok) {
        notifyEmployeeAssetStatusChanged({ reviewTaskId, result: "需修改" });
      }
      refreshEnterpriseSurface();
    },
    onBack: () => followEnterprisePath(buildCapabilityCenterRootPath(props, basePath)),
  });
}

type OwnedAssetLinkSurfaceState = {
  key: string | null;
  loading: boolean;
  links: Array<{ sourceId: string; displayName: string; capabilityId: string; version?: string }>;
};

let ownedAssetLinkState: OwnedAssetLinkSurfaceState = { key: null, loading: false, links: [] };

type CapabilityInstallSurfaceState = {
  key: string | null;
  loading: boolean;
  facts: CapabilityInstallFactsView | null;
};

let capabilityInstallState: CapabilityInstallSurfaceState = {
  key: null,
  loading: false,
  facts: null,
};

function ensureOwnedAssetLinks(props: EnterpriseSurfaceProps, capabilityId: string): void {
  const tenantId = props.readModel.currentTenantId;
  const key = `${tenantId ?? ""}:${capabilityId}`;
  if (!props.client || !tenantId || ownedAssetLinkState.key === key) {
    return;
  }
  ownedAssetLinkState = { key, loading: true, links: [] };
  const gateway = createEnterpriseDataCapabilityGateway(props.client);
  void gateway.resolveOwnedAssetLinks(tenantId, capabilityId).then((result) => {
    if (ownedAssetLinkState.key !== key) {
      return;
    }
    ownedAssetLinkState = { key, loading: false, links: result.ok ? result.data : [] };
    refreshEnterpriseSurface();
  });
}

function ensureCapabilityInstallFacts(props: EnterpriseSurfaceProps, capabilityId: string): void {
  const tenantId = props.readModel.currentTenantId;
  const key = `${tenantId ?? ""}:${capabilityId}`;
  if (!props.client || !tenantId || capabilityInstallState.key === key) {
    return;
  }
  capabilityInstallState = { key, loading: true, facts: null };
  const gateway = createEnterpriseDataCapabilityGateway(props.client);
  void gateway.loadCapabilityInstallFacts(tenantId, capabilityId).then((result) => {
    if (capabilityInstallState.key !== key) {
      return;
    }
    capabilityInstallState = {
      key,
      loading: false,
      facts: result.ok ? normalizeCapabilityInstallFacts(result.data) : null,
    };
    refreshEnterpriseSurface();
  });
}

function renderDetailRoute(props: EnterpriseSurfaceProps, basePath: string, capabilityId: string) {
  ensureAssetDetailLoaded(capabilityId);
  ensureInstallManagementLoaded();
  ensureOwnedAssetLinks(props, capabilityId);
  ensureCapabilityInstallFacts(props, capabilityId);
  const state = assetDetailSurfaceState.state;
  const installRelations = installManagementSurfaceState.state.items.filter(
    (relation) => relation.capabilityId === capabilityId,
  );
  const dataGovernanceHref = pathForTab("enterpriseDataGovernanceCenter", basePath, {
    tenantId: props.readModel.currentTenantId,
  });
  return html`
    ${renderOwnedDataAssetLinks({
      links: ownedAssetLinkState.key?.endsWith(`:${capabilityId}`) ? ownedAssetLinkState.links : [],
      loading:
        ownedAssetLinkState.loading &&
        ownedAssetLinkState.key?.endsWith(`:${capabilityId}`) === true,
      hrefForSource: (sourceId) =>
        `${dataGovernanceHref}?edc=sources&sourceId=${encodeURIComponent(sourceId)}`,
    })}
    ${renderCapabilityInstallFacts({
      facts: capabilityInstallState.key?.endsWith(`:${capabilityId}`)
        ? normalizeCapabilityInstallFacts(
            capabilityInstallState.facts,
            state.capability?.maturity ?? null,
          )
        : null,
      loading:
        capabilityInstallState.loading &&
        capabilityInstallState.key?.endsWith(`:${capabilityId}`) === true,
    })}
    ${renderAssetDetailPage({
      capability: state.capability,
      installRelations,
      loading: state.loading,
      error: state.error,
      trendRange: state.trendRange,
      onChangeTrendRange: (range) => {
        changeTrendRange(state, range);
        refreshEnterpriseSurface();
      },
      onBack: () => followEnterprisePath(buildCapabilityCenterRootPath(props, basePath)),
      onInstallToRobot: (id) => openInstallDialog(id),
    })}
  `;
}

/**
 * 渲染孵化中心路由（Requirement 14.1）。
 * 展示企业能力孵化中心主页面，包含候选池概览、候选能力列表和已上报能力追踪。
 */
function renderIncubationRoute(props: EnterpriseSurfaceProps, basePath: string): TemplateResult {
  syncCapabilityCenterHomeTab(props, basePath, "incubation");
  return renderOverviewRoute(props, basePath);
}

function renderInstallDialog(props: EnterpriseSurfaceProps): TemplateResult | typeof nothing {
  if (!installDialogState.visible || !installDialogState.capabilityId) {
    return nothing;
  }
  const targets = buildOrganizationPushTargets(
    createPositionOptions(props, installDialogState.capabilityId),
  );

  return renderInstallToRobotDialog({
    visible: installDialogState.visible,
    capabilityName: installDialogState.capabilityName,
    targets,
    selectedTargetIds: installDialogState.selectedTargetIds,
    expandedTargetIds: installDialogState.expandedTargetIds,
    installing: installDialogState.installing,
    installError: installDialogState.installError,
    lastResult: installDialogState.lastResult,
    onToggleTarget: (targetId) => {
      if (installDialogState.selectedTargetIds.includes(targetId)) {
        installDialogState.selectedTargetIds = installDialogState.selectedTargetIds.filter(
          (entry) => entry !== targetId,
        );
      } else {
        installDialogState.selectedTargetIds = [...installDialogState.selectedTargetIds, targetId];
      }
      refreshEnterpriseSurface();
    },
    onToggleExpand: (targetId) => {
      if (installDialogState.expandedTargetIds.includes(targetId)) {
        installDialogState.expandedTargetIds = installDialogState.expandedTargetIds.filter(
          (entry) => entry !== targetId,
        );
      } else {
        installDialogState.expandedTargetIds = [...installDialogState.expandedTargetIds, targetId];
      }
      refreshEnterpriseSurface();
    },
    onConfirm: async () => {
      if (!installDialogState.capabilityId || !props.client) {
        installDialogState.installError = "正在连接企业能力数据";
        refreshEnterpriseSurface();
        return;
      }
      installDialogState.installing = true;
      installDialogState.installError = null;
      refreshEnterpriseSurface();
      try {
        const gateway = createEnterpriseCapabilityGateway(props.client);
        const positionIds = resolveSelectedPositionIds(
          targets,
          installDialogState.selectedTargetIds,
        );
        const response = await gateway.pushToPositions({
          capabilityId: installDialogState.capabilityId,
          positionIds,
        });
        const positionTitleById = new Map(
          props.readModel.seatSummaries.map((seat) => [seat.seatId, seat.title]),
        );
        installDialogState.lastResult = {
          successCount: response.successfulPositionIds.length,
          failureCount: response.failures.length,
          failures: response.failures.map((failure) => ({
            positionId: failure.positionId,
            positionTitle: positionTitleById.get(failure.positionId) ?? failure.positionId,
            reason: failure.reason,
          })),
          ...(response.mcpMount
            ? { mcpMountedCount: response.mcpMount.mountedRobotIds.length }
            : {}),
        };
        installDialogState.selectedTargetIds = [];
      } catch {
        installDialogState.installError = "推送失败，请稍后再试";
      } finally {
        installDialogState.installing = false;
        refreshEnterpriseSurface();
      }
    },
    onClose: () => {
      resetInstallDialog();
      refreshEnterpriseSurface();
    },
  });
}

/**
 * 渲染企业能力中心 surface。
 * 数据来源为 enterprise-capability.* gateway 端点，不再使用 mock 资产。
 */
export function renderEnterpriseCapabilityCenterSurface(
  props: EnterpriseSurfaceProps,
  basePath: string,
) {
  ensureOverviewState(props);
  ensureControllerStates(props);
  loadCapabilityCenterStats(props);

  const route = parseCapabilityCenterRoute(basePath);
  const body = (() => {
    switch (route.kind) {
      case "all":
        return renderAllCapabilitiesRoute(props, basePath);
      case "contribution-records":
        return renderContributionRecordsRoute(props, basePath);
      case "contribution-performance":
        return renderContributionPerformanceRoute(props, basePath);
      case "install-management":
        return renderInstallManagementRoute(props, basePath);
      case "robots":
        return renderRobotsRoute(props, basePath);
      case "jobs":
        return renderJobsRoute(props, basePath);
      case "analytics":
        return renderAnalyticsRoute(props, basePath);
      case "governance":
        return renderGovernanceRoute(props, basePath);
      case "review-queue":
        return renderReviewQueueRoute(props, basePath);
      case "incubation":
        return renderIncubationRoute(props, basePath);
      case "detail":
        return renderDetailRoute(props, basePath, route.capabilityId);
      case "overview":
      default:
        return renderOverviewRoute(props, basePath);
    }
  })();

  return html`
    <div class="enterprise-capability-center-shell" @click=${followDelegatedPortHref}>
      ${renderEnterpriseDataNotice(props.readModel)}
      ${body}
      ${renderInstallDialog(props)}
    </div>
  `;
}
