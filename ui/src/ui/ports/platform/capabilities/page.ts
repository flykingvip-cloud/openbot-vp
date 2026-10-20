import JSZip from "jszip";
import { html, nothing } from "lit";
import YAML from "yaml";
import type { DiscoveredCapability } from "../../../capability/capability-governance/discovery/types.ts";
import type {
  CapabilityEmployeeVisibilityMode,
  CapabilityManifest,
} from "../../../capability/capability-governance/types.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import type { SkillStatusEntry } from "../../../types.ts";
import {
  renderAssetDetailListItemsOrEmpty,
  renderAssetDetailTimeline,
} from "../../../views/asset-detail-sections.ts";
import {
  renderStandardAssetDetailEmptyState,
  renderStandardAssetDetailTabs,
  type StandardAssetDetailTabId,
} from "../../../views/asset-detail-tabs.ts";
import { buildPlatformAssetDetailVM } from "../../../views/asset-detail-vm.ts";
import { computeSkillMissing } from "../../../views/skills-shared.ts";
import { isPlatformShellPending, renderPlatformSummaryPending } from "../shared/summary-pending.ts";
import { followPortHref } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { isPendingCapabilityReviewStatus } from "../view-models/builders.ts";
import type {
  CapabilitiesTab,
  CapabilityCatalogItemVM,
  CapabilityCategoryId,
  CapabilityCategoryVM,
  CapabilityDistributionRowVM,
  CapabilityHealthItemVM2,
  CapabilityProposalItemVM,
  CapabilitiesVM,
} from "../view-models/types.ts";
import { selectPlatformCapabilitiesVM } from "./adapter.ts";
import {
  enterpriseSubmissionsTabCount,
  renderEnterpriseSubmissionsSection,
} from "./enterprise-submissions-section.ts";
import { searchPresetCatalog, type PresetCapability } from "./preset-catalog.ts";
import { resolveRemoteCapabilityCandidates as resolveRemoteCapabilityFallbackCandidates } from "./remote-import.ts";
const TAB_ORDER: CapabilitiesTab[] = [
  "catalog",
  "installed",
  "discovery",
  "enterpriseSubmissions",
  "distribution",
  "health",
];

const TAB_LABELS: Record<CapabilitiesTab, string> = {
  catalog: "全部能力",
  installed: "已安装",
  discovery: "待审阅",
  enterpriseSubmissions: "企业提交",
  distribution: "租户分发",
  health: "健康问题",
};

const CATEGORY_ICON_MAP: Record<CapabilityCategoryId, IconName> = {
  chat: "messageSquare",
  vision: "image",
  rag: "book",
  ocr: "fileText",
  search: "search",
  workflow: "layers",
  automation: "zap",
  browser: "globe",
  code: "fileCode",
  integration: "link",
  media: "radio",
  other: "puzzle",
};

const CAPABILITY_COPY_OVERRIDES: Record<string, string> = {
  "1password": "通过 1Password CLI 读取、查询和管理密码与凭据，适用于本地安全配置与密钥协作。",
  "apple-reminders": "管理 Apple 提醒事项，可用于读取、创建、完成和整理个人或团队提醒。",
  "bear-notes": "连接 Bear 笔记，支持创建、搜索和管理笔记内容。",
  blogwatcher: "监控博客、RSS 或 Atom 更新，自动收集新的内容变更。",
  blucli: "连接 BluOS CLI，支持发现、播放、分组与音量控制。",
  bluebubbles: "连接 BlueBubbles，可发送、读取和管理 iMessage 消息。",
  camsnap: "抓取 RTSP/ONVIF 摄像头画面，用于截图与片段采集。",
  clawhub: "OpenBot 技能库 CLI：搜索、安装、更新和发布机器人技能。",
  github: "通过 GitHub CLI 执行 issue、PR、CI、代码审阅和仓库操作。",
  "gh-issues": "聚焦 GitHub issue 处理，可查询问题、创建修复任务并联动子智能体。",
  gemini: "提供 Gemini 对话、总结和生成能力，适用于问答与内容产出。",
  healthcheck: "执行主机与服务健康检查，用于风险扫描与稳定性巡检。",
  "coding-agent": "用于代码生成、修改、审阅和执行的工程能力代理。",
  "skill-creator": "帮助创建、编辑与优化新技能定义及其说明文档。",
  weather: "获取天气与预报信息，用于行程、出行与环境感知场景。",
  "web-research": "围绕问题规划检索、阅读来源、交叉核验并输出可追溯的网页调研报告。",
  "browser-scan-proxy": "用户只扫码或点确认，数字人在隔离浏览器里代为完成控制台操作。",
};

const HASH_PREFIX = "#platform-capabilities:";
const DETAIL_HASH_PREFIX = "#platform-capability:";
const CATEGORY_FILTER_VALUES: ReadonlySet<CapabilityCategoryId | "all"> = new Set([
  "all",
  "chat",
  "vision",
  "rag",
  "ocr",
  "search",
  "workflow",
  "automation",
  "browser",
  "code",
  "integration",
  "media",
  "other",
]);
const ACTIVE_SEGMENT_VALUES: ReadonlySet<PageState["activeSegment"]> = new Set([
  "recommended",
  "skillhub",
  "suite",
]);
const HEALTH_SEVERITY_VALUES: ReadonlySet<PageState["healthSeverityFilter"]> = new Set([
  "all",
  "critical",
  "warning",
  "info",
]);
const DETAIL_TAB_VALUES: ReadonlySet<StandardAssetDetailTabId> = new Set([
  "overview",
  "definition",
  "files",
  "versions",
  "runtime",
  "install",
]);

type PageState = {
  activeTab: CapabilitiesTab;
  categoryFilter: CapabilityCategoryId | "all";
  search: string;
  activeSegment: "recommended" | "skillhub" | "suite";
  healthSeverityFilter: "all" | "critical" | "warning" | "info";
  selectedCapabilityId: string | null;
  detailTab: StandardAssetDetailTabId;
  detailMenuOpenForId: string | null;
  distributionEditorCapabilityId: string | null;
  distributionDraftTenantIds: string[];
  distributionDraftDefaultEnabled: boolean;
  distributionDraftEmployeeVisibilityMode: CapabilityEmployeeVisibilityMode;
  addCapabilityOpen: boolean;
  addCapabilityTab: "market" | "local" | "remote";
  addCapabilityBusy: boolean;
  addCapabilityMessage: { kind: "success" | "error"; text: string } | null;
  addCapabilitySearch: string;
  addCapabilityImportInput: string;
  localImportFileName: string | null;
  selectedMarketItemId: string | null;
  marketDiscoveryResults: DiscoveredCapability[];
  marketDiscoveryLoaded: boolean;
  remoteDiscoveryResults: DiscoveredCapability[];
  remoteDiscoveryLoaded: boolean;
  actionMessage: { kind: "success" | "error"; text: string } | null;
  descriptionDraftById: Record<string, string>;
  // Unified review state
  pendingCapability: CapabilityManifest | null;
  pendingCapabilitySource: string | null;
  pendingValidation: Array<{ status: "pass" | "warn" | "fail"; label: string }>;
  pendingEdits: { name: string; description: string; category: string };
  pendingResources: Array<{ path: string; content: string }>;
};

type ParsedHashState = {
  tab: CapabilitiesTab;
  capabilityId: string | null;
  detailTab: StandardAssetDetailTabId;
  categoryFilter: CapabilityCategoryId | "all";
  activeSegment: PageState["activeSegment"];
  healthSeverityFilter: PageState["healthSeverityFilter"];
};

const pageState: PageState = {
  activeTab: "catalog",
  categoryFilter: "all",
  search: "",
  activeSegment: "recommended",
  healthSeverityFilter: "all",
  selectedCapabilityId: null,
  detailTab: "overview",
  detailMenuOpenForId: null,
  distributionEditorCapabilityId: null,
  distributionDraftTenantIds: [],
  distributionDraftDefaultEnabled: true,
  distributionDraftEmployeeVisibilityMode: "enterprise_review_required",
  addCapabilityOpen: false,
  addCapabilityTab: "market",
  addCapabilityBusy: false,
  addCapabilityMessage: null,
  addCapabilitySearch: "",
  addCapabilityImportInput: "",
  localImportFileName: null,
  selectedMarketItemId: null,
  marketDiscoveryResults: [],
  marketDiscoveryLoaded: false,
  remoteDiscoveryResults: [],
  remoteDiscoveryLoaded: false,
  actionMessage: null,
  descriptionDraftById: {},
  pendingCapability: null,
  pendingCapabilitySource: null,
  pendingValidation: [],
  pendingEdits: { name: "", description: "", category: "" },
  pendingResources: [],
};

function defaultHashState(): ParsedHashState {
  return {
    tab: "catalog",
    capabilityId: null,
    detailTab: "overview",
    categoryFilter: "all",
    activeSegment: "recommended",
    healthSeverityFilter: "all",
  };
}

function parseTab(value: string | null): CapabilitiesTab | null {
  if (!value) {
    return null;
  }
  return TAB_ORDER.includes(value as CapabilitiesTab) ? (value as CapabilitiesTab) : null;
}

function parseCategoryFilter(value: string | null): CapabilityCategoryId | "all" | null {
  if (!value) {
    return null;
  }
  return CATEGORY_FILTER_VALUES.has(value as CapabilityCategoryId | "all")
    ? (value as CapabilityCategoryId | "all")
    : null;
}

function parseActiveSegment(value: string | null): PageState["activeSegment"] | null {
  if (!value) {
    return null;
  }
  return ACTIVE_SEGMENT_VALUES.has(value as PageState["activeSegment"])
    ? (value as PageState["activeSegment"])
    : null;
}

function parseHealthSeverityFilter(value: string | null): PageState["healthSeverityFilter"] | null {
  if (!value) {
    return null;
  }
  return HEALTH_SEVERITY_VALUES.has(value as PageState["healthSeverityFilter"])
    ? (value as PageState["healthSeverityFilter"])
    : null;
}

function parseDetailTab(value: string | null): StandardAssetDetailTabId | null {
  if (!value) {
    return null;
  }
  return DETAIL_TAB_VALUES.has(value as StandardAssetDetailTabId)
    ? (value as StandardAssetDetailTabId)
    : null;
}

function resolveHashStateFromQuery(
  query: URLSearchParams,
  fallbackTab: CapabilitiesTab,
): ParsedHashState {
  return {
    tab: parseTab(query.get("tab")) ?? fallbackTab,
    capabilityId: null,
    detailTab: parseDetailTab(query.get("detail")) ?? "overview",
    categoryFilter: parseCategoryFilter(query.get("category")) ?? "all",
    activeSegment: parseActiveSegment(query.get("segment")) ?? "recommended",
    healthSeverityFilter: parseHealthSeverityFilter(query.get("severity")) ?? "all",
  };
}

function buildPageHashParams(
  tab: CapabilitiesTab,
  options?: { includeTab?: boolean },
): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.includeTab && tab !== "catalog") {
    params.set("tab", tab);
  }
  if (tab === "catalog") {
    if (pageState.activeSegment !== "recommended") {
      params.set("segment", pageState.activeSegment);
    }
    if (pageState.categoryFilter !== "all") {
      params.set("category", pageState.categoryFilter);
    }
    return params;
  }
  if (tab === "installed" && pageState.categoryFilter !== "all") {
    params.set("category", pageState.categoryFilter);
  }
  if (tab === "health" && pageState.healthSeverityFilter !== "all") {
    params.set("severity", pageState.healthSeverityFilter);
  }
  return params;
}

function parseHashState(): ParsedHashState {
  const defaults = defaultHashState();
  if (typeof window === "undefined") {
    return defaults;
  }
  const raw = window.location.hash.trim();
  if (raw.startsWith(DETAIL_HASH_PREFIX)) {
    const [encodedCapabilityId, rawQuery = ""] = raw.slice(DETAIL_HASH_PREFIX.length).split("?");
    return {
      ...resolveHashStateFromQuery(new URLSearchParams(rawQuery), "catalog"),
      capabilityId: decodeURIComponent(encodedCapabilityId),
    };
  }
  if (!raw.startsWith(HASH_PREFIX)) {
    return defaults;
  }
  const [tabToken, rawQuery = ""] = raw.slice(HASH_PREFIX.length).split("?");
  return resolveHashStateFromQuery(new URLSearchParams(rawQuery), parseTab(tabToken) ?? "catalog");
}

function writePageHash() {
  if (typeof window === "undefined") {
    return;
  }
  const { pathname, search } = window.location;
  const params = buildPageHashParams(pageState.activeTab);
  const suffix = params.toString();
  window.history.replaceState(
    {},
    "",
    `${pathname}${search}${HASH_PREFIX}${pageState.activeTab}${suffix ? `?${suffix}` : ""}`,
  );
}

function writeDetailHash(capabilityId: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!capabilityId) {
    writePageHash();
    return;
  }
  const { pathname, search } = window.location;
  const params = buildPageHashParams(pageState.activeTab, { includeTab: true });
  if (pageState.detailTab !== "overview") {
    params.set("detail", pageState.detailTab);
  }
  const suffix = params.toString();
  window.history.replaceState(
    {},
    "",
    `${pathname}${search}${DETAIL_HASH_PREFIX}${encodeURIComponent(capabilityId)}${
      suffix ? `?${suffix}` : ""
    }`,
  );
}

function requestRerender() {
  // 筛选、页签和详情都走模块状态。合成 popstate 会让能力中心每次点击都 loadOverview。
  requestOpenBotAppRerender();
}

function showActionMessage(kind: "success" | "error", text: string) {
  pageState.actionMessage = { kind, text };
  requestRerender();
}

function reviewActionError(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) {
    return null;
  }
  const record = result as { ok?: boolean; message?: string };
  if (record.ok !== false) {
    return null;
  }
  return record.message?.trim() || "操作失败，提案状态未改变。";
}

async function runReviewAction(action: () => Promise<unknown>, successText: string) {
  try {
    const error = reviewActionError(await action());
    if (error) {
      showActionMessage("error", error);
      return;
    }
    showActionMessage("success", successText);
  } catch (error) {
    showActionMessage(
      "error",
      error instanceof Error && error.message.trim() ? error.message : "操作失败，提案状态未改变。",
    );
  }
}

function enterpriseSubmissionsHost(props: PlatformSurfaceProps) {
  return {
    props,
    requestRerender,
    onShowActionMessage: showActionMessage,
    onOpenCapabilityDistribution: (capabilityId: string) => {
      openCapabilityDetail(capabilityId);
      openDistributionEditor(capabilityId, [], true, "direct_employee_visible");
      showActionMessage("success", "已打开发布能力的分发配置。留空租户范围表示全平台可见。");
    },
  };
}

function clearActionMessage() {
  pageState.actionMessage = null;
  requestRerender();
}

export function clearPlatformCapabilitiesActionMessageForTest() {
  pageState.actionMessage = null;
}

function syncStateFromHash() {
  const parsed = parseHashState();
  pageState.activeTab = parsed.tab;
  pageState.selectedCapabilityId = parsed.capabilityId;
  pageState.detailTab = parsed.detailTab;
  pageState.categoryFilter = parsed.categoryFilter;
  pageState.activeSegment = parsed.activeSegment;
  pageState.healthSeverityFilter = parsed.healthSeverityFilter;
}

function setActiveTab(tab: CapabilitiesTab) {
  pageState.activeTab = tab;
  pageState.selectedCapabilityId = null;
  if (tab !== "health") {
    pageState.healthSeverityFilter = "all";
  }
  writePageHash();
  requestRerender();
}

function setCategoryFilter(filter: CapabilityCategoryId | "all") {
  pageState.categoryFilter = filter;
  writePageHash();
  requestRerender();
}

function setSearch(value: string) {
  pageState.search = value;
  requestRerender();
}

function setActiveSegment(value: PageState["activeSegment"]) {
  pageState.activeSegment = value;
  writePageHash();
  requestRerender();
}

function setHealthSeverityFilter(value: PageState["healthSeverityFilter"]) {
  pageState.healthSeverityFilter = value;
  writePageHash();
  requestRerender();
}

function openCapabilityDetail(capabilityId: string) {
  pageState.selectedCapabilityId = capabilityId;
  pageState.detailTab = "overview";
  pageState.detailMenuOpenForId = null;
  writeDetailHash(capabilityId);
  requestRerender();
}

function closeCapabilityDetail() {
  pageState.selectedCapabilityId = null;
  pageState.detailTab = "overview";
  pageState.detailMenuOpenForId = null;
  pageState.distributionEditorCapabilityId = null;
  writeDetailHash(null);
  requestRerender();
}

function setCapabilityDetailTab(tab: StandardAssetDetailTabId) {
  pageState.detailTab = tab;
  writeDetailHash(pageState.selectedCapabilityId);
  requestRerender();
}

function openAddCapabilityPanel() {
  pageState.addCapabilityOpen = true;
  pageState.addCapabilityTab = "market";
  pageState.addCapabilityMessage = null;
  pageState.addCapabilitySearch = "";
  pageState.addCapabilityImportInput = "";
  pageState.localImportFileName = null;
  pageState.marketDiscoveryLoaded = false;
  pageState.marketDiscoveryResults = [];
  pageState.remoteDiscoveryLoaded = false;
  pageState.remoteDiscoveryResults = [];
  pageState.selectedMarketItemId = null;
  requestRerender();
}

function closeAddCapabilityPanel() {
  pageState.addCapabilityOpen = false;
  pageState.addCapabilityBusy = false;
  pageState.addCapabilityMessage = null;
  pageState.addCapabilitySearch = "";
  pageState.addCapabilityImportInput = "";
  pageState.addCapabilityTab = "market";
  pageState.localImportFileName = null;
  pageState.selectedMarketItemId = null;
  requestRerender();
}

function openDistributionEditor(
  capabilityId: string,
  tenantIds: string[],
  defaultEnabled: boolean,
  employeeVisibilityMode: CapabilityEmployeeVisibilityMode,
) {
  pageState.distributionEditorCapabilityId = capabilityId;
  pageState.distributionDraftTenantIds = [...tenantIds];
  pageState.distributionDraftDefaultEnabled = defaultEnabled;
  pageState.distributionDraftEmployeeVisibilityMode = employeeVisibilityMode;
  pageState.detailMenuOpenForId = null;
  requestRerender();
}

function closeDistributionEditor() {
  pageState.distributionEditorCapabilityId = null;
  pageState.distributionDraftTenantIds = [];
  pageState.distributionDraftEmployeeVisibilityMode = "enterprise_review_required";
  requestRerender();
}

function toggleDistributionTenant(tenantId: string) {
  const next = new Set(pageState.distributionDraftTenantIds);
  if (next.has(tenantId)) {
    next.delete(tenantId);
  } else {
    next.add(tenantId);
  }
  pageState.distributionDraftTenantIds = [...next];
  requestRerender();
}

function setAddCapabilityTab(tab: PageState["addCapabilityTab"]) {
  pageState.addCapabilityTab = tab;
  pageState.addCapabilityMessage = null;
  if (tab !== "market") {
    pageState.selectedMarketItemId = null;
  }
  requestRerender();
}

function isMarketplaceItem(item: DiscoveredCapability) {
  const keywords = [
    item.manifest.name,
    item.manifest.description,
    item.manifest.skillKey,
    item.sourceId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    /market|package|bundle|template|install|marketplace|registry/.test(keywords) ||
    item.sourceId === "npm" ||
    item.sourceId === "github-topic"
  );
}

function setAddCapabilityMessage(kind: "success" | "error", text: string) {
  pageState.addCapabilityMessage = { kind, text };
  requestRerender();
}

function deriveRemoteImportKeyword(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const segments = url.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      const packageIndex = segments.indexOf("package");
      if (packageIndex >= 0 && segments[packageIndex + 1]) {
        return decodeURIComponent(segments[packageIndex + 1]);
      }
      if (url.hostname.includes("github.com")) {
        const owner = segments[0];
        const repo = segments[1];
        if (owner && repo) {
          return `${owner}/${repo.replace(/\.git$/i, "")}`;
        }
      }
      const repo = segments[1] ?? segments[0];
      return repo?.replace(/\.git$/i, "").replace(/^skill-/i, "") || null;
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^skill-/i, "");
}

function parseLocalCapabilityText(raw: string, fileName: string): CapabilityManifest {
  const trimmed = raw.trim();
  let parsed: Record<string, unknown> | null = null;

  // Parse based on file extension
  const isMarkdown = /\.md$/i.test(fileName);
  const isJson = /\.json$/i.test(fileName);

  if (isMarkdown) {
    // Extract frontmatter from Markdown (SKILL.md format)
    const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      try {
        parsed = YAML.parse(fmMatch[1]) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
    }
    // If no frontmatter, try to extract name from first heading
    if (!parsed) {
      const headingMatch = trimmed.match(/^#\s+(.+)$/m);
      const descMatch = trimmed.match(/^#[^\n]*\n+([^\n#]+)/);
      parsed = {
        name: headingMatch?.[1]?.trim() ?? null,
        description: descMatch?.[1]?.trim() ?? null,
      };
    }
  } else {
    try {
      parsed = isJson
        ? (JSON.parse(trimmed) as Record<string, unknown>)
        : (YAML.parse(trimmed) as Record<string, unknown>);
    } catch {
      parsed = null;
    }
  }

  const baseName = fileName
    .replace(/\.(json|ya?ml|md|txt)$/i, "")
    .replace(/^skill-/i, "")
    .replace(/^SKILL$/i, "imported-skill");
  const skillKey =
    (typeof parsed?.skillKey === "string" && parsed.skillKey.trim()) ||
    (typeof parsed?.name === "string" && parsed.name.trim()) ||
    baseName ||
    "imported-skill";
  const description =
    (typeof parsed?.description === "string" && parsed.description.trim()) ||
    "Imported from local file";
  return {
    id: `urn:openclaw:skill:${skillKey}@0.0.0`,
    kind: "skill",
    version: "0.0.0",
    skillKey,
    name: skillKey.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    description,
    source: {
      kind: "upload",
      origin: fileName,
      trustTier: "user",
    },
    interface: { inputs: [], outputs: [] },
    contracts: {
      sideEffects: ["read_only"],
      idempotent: true,
      requiresConfirmation: false,
    },
    behavior: { costModel: "free" },
    requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
    install: [],
    risk: {
      level: "medium",
      network: false,
      filesystem: false,
      subprocess: false,
      secrets: false,
      notes: "Imported from local file and awaiting governance review.",
    },
  };
}

function manifestFromPresetCapability(item: PresetCapability): CapabilityManifest {
  const sourceKind =
    item.source === "github" ? "github" : item.source === "npm" ? "npm" : "managed";
  return {
    id: `urn:openclaw:skill:${item.id}@0.0.0`,
    kind: "skill",
    version: "0.0.0",
    skillKey: item.id,
    name: item.name,
    description: item.description,
    source: {
      kind: sourceKind,
      origin: item.sourceUrl ?? item.id,
      trustTier: "first-party",
    },
    interface: { inputs: [], outputs: [] },
    contracts: {
      sideEffects: ["read_only"],
      idempotent: true,
      requiresConfirmation: false,
    },
    behavior: { costModel: "free" },
    requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
    install: [],
    risk: {
      level: "low",
      network: false,
      filesystem: false,
      subprocess: false,
      secrets: false,
    },
  };
}

async function submitPresetCatalogCapability(_props: PlatformSurfaceProps, item: PresetCapability) {
  const manifest = manifestFromPresetCapability(item);
  enterReviewMode(manifest, "preset-catalog");
}

function renderPresetCatalogResults(searchQuery: string, props: PlatformSurfaceProps) {
  const results = searchPresetCatalog(searchQuery);
  const label = searchQuery.trim() ? `找到 ${results.length} 个匹配能力` : "推荐能力";
  if (results.length === 0 && searchQuery.trim()) {
    return html`
      <div class="platform-capabilities__detail-copy card-follow--sm">
        本地目录未匹配到"${searchQuery}"相关能力，点击"搜索"尝试从外部源查找。
      </div>
    `;
  }
  return html`
    <div
      class="platform-capabilities__detail-copy platform-capabilities__detail-copy--label card-follow--sm"
    >
      ${label}
    </div>
    <div class="platform-capabilities__market-grid card-follow--xs">
      ${results.map(
        (item) => html`
          <button
            class="platform-capabilities__market-card"
            type="button"
            @click=${async () => submitPresetCatalogCapability(props, item)}
          >
            <div class="platform-capabilities__market-card-head">
              <strong>${item.name}</strong>
              <span class="platform-capabilities__chip">${item.category}</span>
            </div>
            <div class="platform-capabilities__market-card-sub">${item.description}</div>
            <div class="platform-capabilities__market-card-meta">
              ${item.tags.map((tag) => html`<span>${tag}</span>`)}
              <span>${item.author ?? ""}</span>
            </div>
          </button>
        `,
      )}
    </div>
  `;
}

// --- Unified review flow ---

function validateCapability(manifest: CapabilityManifest): PageState["pendingValidation"] {
  const checks: PageState["pendingValidation"] = [];
  // Name check
  checks.push({
    status: manifest.name?.trim() ? "pass" : "fail",
    label: manifest.name?.trim() ? `名称：${manifest.name}` : "缺少能力名称",
  });
  // Description check
  checks.push({
    status: manifest.description?.trim() ? "pass" : "warn",
    label: manifest.description?.trim() ? "描述已填写" : "缺少描述（建议补充）",
  });
  // Requirements check
  const bins = manifest.requirements?.bins ?? [];
  const env = manifest.requirements?.env ?? [];
  if (bins.length > 0) {
    checks.push({ status: "warn", label: `需要依赖：${bins.join(", ")}` });
  }
  if (env.length > 0) {
    checks.push({ status: "warn", label: `需要环境变量：${env.join(", ")}` });
  }
  if (bins.length === 0 && env.length === 0) {
    checks.push({ status: "pass", label: "无外部依赖" });
  }
  // Risk check
  const risk = manifest.risk;
  if (risk?.level === "high") {
    checks.push({ status: "fail", label: "高风险：需要仔细审阅" });
  } else if (risk?.level === "medium") {
    checks.push({ status: "warn", label: "中等风险" });
  } else {
    checks.push({ status: "pass", label: "低风险" });
  }
  // Source check
  checks.push({
    status: manifest.source?.trustTier === "first-party" ? "pass" : "warn",
    label: manifest.source?.trustTier === "first-party" ? "官方来源" : "第三方来源",
  });
  return checks;
}

function enterReviewMode(
  manifest: CapabilityManifest,
  source: string,
  resources: Array<{ path: string; content: string }> = [],
) {
  pageState.pendingCapability = manifest;
  pageState.pendingCapabilitySource = source;
  pageState.pendingResources = resources;
  pageState.pendingEdits = {
    name: manifest.name ?? "",
    description: manifest.description ?? "",
    category: manifest.skillKey ?? "",
  };
  pageState.pendingValidation = validateCapability(manifest);
  requestRerender();
}

function exitReviewMode() {
  pageState.pendingCapability = null;
  pageState.pendingCapabilitySource = null;
  pageState.pendingValidation = [];
  pageState.pendingEdits = { name: "", description: "", category: "" };
  pageState.pendingResources = [];
  pageState.addCapabilityMessage = null;
  requestRerender();
}

async function confirmImport(props: PlatformSurfaceProps) {
  const manifest = pageState.pendingCapability;
  if (!manifest) {
    return;
  }
  // Apply edits
  const finalManifest: CapabilityManifest = {
    ...manifest,
    name: pageState.pendingEdits.name || manifest.name,
    description: pageState.pendingEdits.description || manifest.description,
  };
  pageState.addCapabilityBusy = true;
  requestRerender();
  try {
    await props.actions.capabilities.onSubmitExternalProposal?.({
      sourceId: pageState.pendingCapabilitySource ?? "unknown",
      externalId: finalManifest.skillKey ?? finalManifest.id,
      version: finalManifest.version ?? "0.0.0",
      manifest: finalManifest,
      findings: [],
      provenance: {
        url: finalManifest.source?.origin ?? "",
        fetchedAt: new Date().toISOString(),
        registryName: pageState.pendingCapabilitySource ?? "local",
      },
    });
    setAddCapabilityMessage("success", `"${finalManifest.name}" 导入成功，已进入待审阅池。`);
    // Stay on review panel to show success, don't exit
    await props.actions.capabilities.onRefresh();
  } catch (error) {
    setAddCapabilityMessage("error", error instanceof Error ? error.message : "导入失败。");
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

function renderReviewPanel(props: PlatformSurfaceProps) {
  const manifest = pageState.pendingCapability;
  if (!manifest) {
    return nothing;
  }
  const checks = pageState.pendingValidation;
  const hasFailure = checks.some((c) => c.status === "fail");
  const imported = pageState.addCapabilityMessage?.kind === "success";
  return html`
    <section class="platform-capabilities__review-panel">
      <div class="platform-capabilities__review-header">
        <h4>${imported ? "导入完成" : "审阅与校验"}</h4>
        <button class="btn btn--sm" type="button" @click=${exitReviewMode}>
          ${imported ? "关闭" : "返回"}
        </button>
      </div>

      ${
        pageState.addCapabilityMessage
          ? html`<div
              class="callout ${pageState.addCapabilityMessage.kind === "success" ? "success" : "danger"}"
            >
              ${pageState.addCapabilityMessage.text}
            </div>`
          : nothing
      }
      ${
        imported
          ? nothing
          : html`
              <div class="platform-capabilities__review-form">
                <label class="field">
                  <span>能力名称</span>
                  <input
                    type="text"
                    .value=${pageState.pendingEdits.name}
                    @input=${(e: Event) => {
                      pageState.pendingEdits.name = (e.currentTarget as HTMLInputElement).value;
                      requestRerender();
                    }}
                  />
                </label>
                <label class="field">
                  <span>描述</span>
                  <textarea
                    rows="3"
                    class="platform-capabilities__review-notes"
                    .value=${pageState.pendingEdits.description}
                    @input=${(e: Event) => {
                      pageState.pendingEdits.description = (
                        e.currentTarget as HTMLTextAreaElement
                      ).value;
                      requestRerender();
                    }}
                  ></textarea>
                </label>
                <div class="platform-capabilities__review-meta">
                  <span class="chip">来源：${pageState.pendingCapabilitySource ?? "未知"}</span>
                  <span class="chip">版本：${manifest.version ?? "0.0.0"}</span>
                  <span class="chip">风险：${manifest.risk?.level ?? "未知"}</span>
                </div>
              </div>

              <details class="platform-capabilities__review-content">
                <summary>技能内容预览与编辑</summary>
                <textarea
                  class="platform-capabilities__review-raw"
                  rows="12"
                  .value=${JSON.stringify(manifest, null, 2)}
                  @input=${(e: Event) => {
                    try {
                      const edited = JSON.parse(
                        (e.currentTarget as HTMLTextAreaElement).value,
                      ) as CapabilityManifest;
                      pageState.pendingCapability = edited;
                      pageState.pendingEdits.name = edited.name ?? pageState.pendingEdits.name;
                      pageState.pendingEdits.description =
                        edited.description ?? pageState.pendingEdits.description;
                    } catch {
                      /* ignore parse errors while typing */
                    }
                  }}
                ></textarea>
              </details>

              ${
                pageState.pendingResources.length > 0
                  ? html`
                      <details class="platform-capabilities__review-content">
                        <summary>附属文件（${pageState.pendingResources.length} 个）</summary>
                        <div class="platform-capabilities__review-resources">
                          ${pageState.pendingResources.map(
                            (res) => html`
                              <details class="platform-capabilities__review-resource-item">
                                <summary>${res.path}</summary>
                                <pre class="platform-capabilities__review-resource-content">
${res.content.slice(0, 2000)}${res.content.length > 2000 ? "\n... (已截断)" : ""}</pre>
                              </details>
                            `,
                          )}
                        </div>
                      </details>
                    `
                  : nothing
              }

              <div class="platform-capabilities__review-checks">
                <strong>校验结果</strong>
                ${checks.map(
                  (check) => html`
                    <div class="platform-capabilities__review-check" data-status=${check.status}>
                      ${renderIcon(
                        check.status === "pass"
                          ? "checkCircle"
                          : check.status === "warn"
                            ? "alertCircle"
                            : "alertTriangle",
                        "platform-capabilities__review-check-icon",
                      )}
                      <span>${check.label}</span>
                    </div>
                  `,
                )}
              </div>

              <div class="platform-capabilities__review-actions">
                <button
                  class="btn btn--sm"
                  type="button"
                  @click=${() => {
                    pageState.pendingValidation = validateCapability({
                      ...manifest,
                      name: pageState.pendingEdits.name,
                      description: pageState.pendingEdits.description,
                    });
                    requestRerender();
                  }}
                >
                  重新校验
                </button>
                <button
                  class="btn btn--primary"
                  type="button"
                  ?disabled=${hasFailure || pageState.addCapabilityBusy}
                  @click=${() => confirmImport(props)}
                >
                  ${pageState.addCapabilityBusy ? "导入中…" : "导入到平台"}
                </button>
              </div>
            `
      }
    </section>
  `;
}

// --- End unified review flow ---

async function importLocalCapabilityFile(_props: PlatformSurfaceProps, file: File) {
  pageState.addCapabilityBusy = true;
  pageState.addCapabilityMessage = null;
  pageState.localImportFileName = file.name;
  requestRerender();
  try {
    if (file.name.endsWith(".zip")) {
      // Handle zip skill bundle
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.keys(zip.files);

      // Find SKILL.md (could be at root or inside a folder)
      const skillMdPath = entries.find(
        (path) => path.endsWith("SKILL.md") || path.endsWith("skill.md"),
      );
      if (!skillMdPath) {
        setAddCapabilityMessage("error", "ZIP 文件中未找到 SKILL.md，无法识别技能入口。");
        return;
      }

      // Read SKILL.md content
      const skillMdContent = await zip.files[skillMdPath].async("string");
      const manifest = parseLocalCapabilityText(skillMdContent, "SKILL.md");

      // Read all other text files as resources
      const basePath = skillMdPath.includes("/")
        ? skillMdPath.substring(0, skillMdPath.lastIndexOf("/") + 1)
        : "";
      const resources: Array<{ path: string; content: string }> = [];

      for (const entryPath of entries) {
        if (entryPath === skillMdPath) {
          continue;
        }
        if (zip.files[entryPath].dir) {
          continue;
        }
        // Only include text files
        if (!/\.(md|txt|json|ya?ml|ts|js|py)$/i.test(entryPath)) {
          continue;
        }
        try {
          const content = await zip.files[entryPath].async("string");
          const relativePath = entryPath.startsWith(basePath)
            ? entryPath.substring(basePath.length)
            : entryPath;
          resources.push({ path: relativePath, content });
        } catch {
          // Skip binary files
        }
      }

      enterReviewMode(manifest, "local-zip", resources);
    } else {
      // Handle single file
      const raw = await file.text();
      const manifest = parseLocalCapabilityText(raw, file.name);
      enterReviewMode(manifest, "local-upload");
    }
  } catch (error) {
    setAddCapabilityMessage("error", error instanceof Error ? error.message : "文件解析失败。");
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

function renderAddCapabilityWorkspace(params: {
  title: string;
  description: string;
  eyebrow?: string | null;
  headerSlot?: unknown;
  body: unknown;
}) {
  return html`
    ${
      params.eyebrow
        ? html`<div class="platform-capabilities__workspace-eyebrow">${params.eyebrow}</div>`
        : nothing
    }
    <div class="platform-capabilities__workspace-header">
      <div class="platform-capabilities__workspace-heading">
        <div class="card-title">${params.title}</div>
        <div class="platform-capabilities__detail-copy">${params.description}</div>
      </div>
      ${params.headerSlot ?? nothing}
    </div>
    ${params.body}
  `;
}

async function resolveCapabilityCandidates(
  props: PlatformSurfaceProps,
  input: string,
): Promise<DiscoveredCapability[]> {
  const gatewayMatches = (await props.actions.capabilities.onResolveRemoteImport?.(input)) ?? [];
  if (gatewayMatches.length > 0) {
    return gatewayMatches;
  }
  return resolveRemoteCapabilityFallbackCandidates(input);
}

async function importRemoteCapability(props: PlatformSurfaceProps) {
  const rawInput = pageState.addCapabilityImportInput.trim();
  if (!rawInput) {
    setAddCapabilityMessage("error", "请输入 GitHub 仓库地址、npm 地址或能力关键词。");
    return;
  }
  pageState.addCapabilityBusy = true;
  pageState.addCapabilityMessage = null;
  pageState.addCapabilityTab = "remote";
  requestRerender();
  try {
    const exactMatches = await resolveCapabilityCandidates(props, rawInput);
    if (exactMatches.length > 0) {
      pageState.remoteDiscoveryResults = exactMatches;
      pageState.remoteDiscoveryLoaded = true;
      pageState.selectedMarketItemId = exactMatches[0]?.externalId ?? null;
      setAddCapabilityMessage("success", `已解析到 ${exactMatches.length} 个精确候选能力。`);
      return;
    }

    const keyword = deriveRemoteImportKeyword(rawInput);
    if (!keyword) {
      setAddCapabilityMessage("error", "无法从该地址解析能力，请检查输入格式。");
      return;
    }
    pageState.addCapabilityImportInput = keyword;
    await refreshRemoteDiscoveryResults(props, keyword);
  } catch (error) {
    setAddCapabilityMessage("error", error instanceof Error ? error.message : "远程能力解析失败。");
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

async function refreshExternalDiscoveryResults(props: PlatformSurfaceProps) {
  pageState.addCapabilityBusy = true;
  pageState.addCapabilityMessage = null;
  requestRerender();
  try {
    const keyword = pageState.addCapabilitySearch.trim();
    const discovered = keyword ? await resolveCapabilityCandidates(props, keyword) : [];
    pageState.marketDiscoveryResults = discovered;
    pageState.marketDiscoveryLoaded = true;
    pageState.selectedMarketItemId = discovered[0]?.externalId ?? null;
    setAddCapabilityMessage(
      "success",
      discovered.length > 0
        ? `已发现 ${discovered.length} 个市场候选能力。`
        : "当前没有新的市场能力候选。",
    );
  } catch (error) {
    setAddCapabilityMessage("error", error instanceof Error ? error.message : "外部能力发现失败。");
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

async function refreshRemoteDiscoveryResults(
  props: PlatformSurfaceProps,
  keywordOverride?: string,
) {
  pageState.addCapabilityBusy = true;
  pageState.addCapabilityMessage = null;
  requestRerender();
  try {
    const keyword = (keywordOverride ?? pageState.addCapabilityImportInput).trim();
    const discovered = keyword ? await resolveCapabilityCandidates(props, keyword) : [];
    pageState.remoteDiscoveryResults = discovered;
    pageState.remoteDiscoveryLoaded = true;
    pageState.selectedMarketItemId = discovered[0]?.externalId ?? null;
    setAddCapabilityMessage(
      "success",
      discovered.length > 0
        ? `已发现 ${discovered.length} 个远程候选能力。`
        : "当前没有可解析的远程能力候选。",
    );
  } catch (error) {
    setAddCapabilityMessage("error", error instanceof Error ? error.message : "远程能力解析失败。");
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

async function submitExternalDiscoveryProposal(
  props: PlatformSurfaceProps,
  item: DiscoveredCapability,
) {
  pageState.addCapabilityBusy = true;
  pageState.addCapabilityMessage = null;
  requestRerender();
  try {
    await props.actions.capabilities.onSubmitExternalProposal?.(item);
    setAddCapabilityMessage("success", `已提交外部能力候选：${item.manifest.name}`);
    const matchesCandidate = (candidate: DiscoveredCapability) =>
      !(
        candidate.sourceId === item.sourceId &&
        candidate.externalId === item.externalId &&
        candidate.version === item.version
      );
    pageState.marketDiscoveryResults = pageState.marketDiscoveryResults.filter(matchesCandidate);
    pageState.remoteDiscoveryResults = pageState.remoteDiscoveryResults.filter(matchesCandidate);
    pageState.selectedMarketItemId =
      pageState.marketDiscoveryResults[0]?.externalId ??
      pageState.remoteDiscoveryResults[0]?.externalId ??
      null;
    await props.actions.capabilities.onRefresh();
  } catch (error) {
    setAddCapabilityMessage(
      "error",
      error instanceof Error ? error.message : "提交外部能力候选失败。",
    );
  } finally {
    pageState.addCapabilityBusy = false;
    requestRerender();
  }
}

function resolveCapabilitySummary(item: CapabilityCatalogItemVM): string {
  return CAPABILITY_COPY_OVERRIDES[item.skillKey ?? item.title] ?? item.summary;
}

function resolveEditableSummary(item: CapabilityCatalogItemVM): string {
  return pageState.descriptionDraftById[item.id] ?? resolveCapabilitySummary(item);
}

function resolveCapabilityEntryLabel(item: CapabilityCatalogItemVM): string {
  if (item.statusTone === "warn") {
    return "去配置";
  }
  if (item.statusTone === "danger") {
    return "查看问题";
  }
  return item.statusLabel;
}

function filterCatalog(items: CapabilityCatalogItemVM[]) {
  return filterCatalogBySearch(items).filter(
    (item) => pageState.categoryFilter === "all" || item.categoryId === pageState.categoryFilter,
  );
}

function filterCatalogBySearch(items: CapabilityCatalogItemVM[]) {
  const search = pageState.search.trim().toLowerCase();
  if (!search) {
    return items;
  }
  return items.filter((item) =>
    [item.title, item.summary, item.sourceOrigin, item.categoryLabel]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
}

function segmentItems(vm: CapabilitiesVM) {
  const all = vm.catalogItems;
  switch (pageState.activeSegment) {
    case "skillhub":
      return all.filter((item) => item.trustTier === "first-party");
    case "suite":
      return all.filter(
        (item) =>
          item.categoryId === "integration" ||
          item.categoryId === "workflow" ||
          item.categoryId === "automation",
      );
    case "recommended":
    default:
      return all
        .slice()
        .toSorted(
          (left, right) => right.calls7d - left.calls7d || left.title.localeCompare(right.title),
        )
        .slice(0, 8);
  }
}

function findCapability(
  vm: CapabilitiesVM,
  capabilityId: string | null,
): CapabilityCatalogItemVM | null {
  if (!capabilityId) {
    return null;
  }
  return vm.catalogItems.find((item) => item.id === capabilityId) ?? null;
}

function renderSearchBar() {
  return html`
    <label class="platform-capabilities__search platform-capabilities__search--hero">
      ${renderIcon("search", "platform-capabilities__search-icon")}
      <input
        type="search"
        placeholder="搜索能力名称、描述或提供方…"
        .value=${pageState.search}
        @input=${(event: Event) => setSearch((event.currentTarget as HTMLInputElement).value)}
      />
      ${
        pageState.search
          ? html`
              <button
                class="platform-capabilities__search-clear"
                type="button"
                aria-label="清除搜索"
                @click=${() => setSearch("")}
              >
                ${renderIcon("x")}
              </button>
            `
          : nothing
      }
    </label>
  `;
}

function renderHeroToolbar() {
  return html`
    <div class="platform-capabilities__hero-actions">
      ${renderSearchBar()}
      <button
        class="platform-capabilities__hero-button"
        type="button"
        @click=${openAddCapabilityPanel}
      >
        ${renderIcon("plus", "platform-capabilities__hero-button-icon")}
        <span>添加能力</span>
      </button>
    </div>
  `;
}

function renderSegmentBar() {
  const segments: Array<{ id: PageState["activeSegment"]; label: string }> = [
    { id: "recommended", label: "推荐" },
    { id: "skillhub", label: "SkillHub" },
    { id: "suite", label: "套件" },
  ];
  return html`
    <div class="platform-capabilities__segment-bar" role="tablist" aria-label="能力来源与分组">
      ${segments.map(
        (segment) => html`
          <button
            class="platform-capabilities__segment ${
              pageState.activeSegment === segment.id ? "is-active" : ""
            }"
            type="button"
            role="tab"
            aria-selected=${String(pageState.activeSegment === segment.id)}
            @click=${() => setActiveSegment(segment.id)}
          >
            ${segment.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderCategoryFilter(
  items: CapabilityCatalogItemVM[],
  categories: CapabilityCategoryVM[],
) {
  const searchedItems = filterCatalogBySearch(items);
  if (categories.length === 0 || searchedItems.length === 0) {
    return nothing;
  }
  const countByCategory = new Map<CapabilityCategoryId, number>();
  for (const item of searchedItems) {
    countByCategory.set(item.categoryId, (countByCategory.get(item.categoryId) ?? 0) + 1);
  }
  return html`
    <div class="platform-capabilities__category-strip" role="tablist" aria-label="能力类型">
      <button
        class="platform-capabilities__category-chip ${
          pageState.categoryFilter === "all" ? "is-active" : ""
        }"
        type="button"
        role="tab"
        aria-selected=${String(pageState.categoryFilter === "all")}
        @click=${() => setCategoryFilter("all")}
      >
        <span class="platform-capabilities__category-chip-label">全部</span>
        <span class="platform-capabilities__category-chip-count">${searchedItems.length}</span>
      </button>
      ${categories
        .filter((cat) => (countByCategory.get(cat.id) ?? 0) > 0)
        .map(
          (cat) => html`
            <button
              class="platform-capabilities__category-chip ${
                pageState.categoryFilter === cat.id ? "is-active" : ""
              }"
              type="button"
              role="tab"
              aria-selected=${String(pageState.categoryFilter === cat.id)}
              @click=${() => setCategoryFilter(cat.id)}
              title=${cat.description}
            >
              <span class="platform-capabilities__category-chip-icon">
                ${renderIcon(CATEGORY_ICON_MAP[cat.id], "platform-capabilities__category-chip-icon-svg")}
              </span>
              <span class="platform-capabilities__category-chip-label">${cat.label}</span>
              <span class="platform-capabilities__category-chip-count"
                >${countByCategory.get(cat.id) ?? 0}</span
              >
            </button>
          `,
        )}
    </div>
  `;
}

function renderCapabilityCard(
  item: CapabilityCatalogItemVM,
  _props: PlatformSurfaceProps,
  _options?: { compact?: boolean },
) {
  return html`
    <article class="platform-capabilities__card is-${item.statusTone}">
      <header class="platform-capabilities__card-head">
        <span class="platform-capabilities__card-icon">
          ${renderIcon(CATEGORY_ICON_MAP[item.categoryId], "platform-capabilities__card-icon-svg")}
        </span>
        <div class="platform-capabilities__card-head-copy">
          <div class="platform-capabilities__card-title-row">
            <button
              class="platform-capabilities__card-title-action"
              type="button"
              @click=${() => openCapabilityDetail(item.id)}
            >
              <h4 class="platform-capabilities__card-title">${item.title}</h4>
            </button>
          </div>
        </div>
        <div class="platform-capabilities__card-controls">
          <button
            class="platform-capabilities__card-status is-${item.statusTone}"
            type="button"
            @click=${() => openCapabilityDetail(item.id)}
          >
            ${resolveCapabilityEntryLabel(item)}
          </button>
        </div>
      </header>
      <p class="platform-capabilities__card-summary">${resolveEditableSummary(item)}</p>
      <footer class="platform-capabilities__card-foot">
        <div class="platform-capabilities__card-metric">
          <span class="platform-capabilities__card-metric-label">启用租户</span>
          <span class="platform-capabilities__card-metric-value">${item.tenantsEnabled}</span>
        </div>
        <div class="platform-capabilities__card-metric">
          <span class="platform-capabilities__card-metric-label">7 日调用</span>
          <span class="platform-capabilities__card-metric-value">${item.calls7dLabel}</span>
        </div>
        <div class="platform-capabilities__card-metric">
          <span class="platform-capabilities__card-metric-label">失败率</span>
          <span class="platform-capabilities__card-metric-value">${item.failureRateLabel}</span>
        </div>
      </footer>
    </article>
  `;
}

function renderCapabilityDirectory(vm: CapabilitiesVM, props: PlatformSurfaceProps) {
  if (vm.catalogItems.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("search", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">尚无能力目录数据</div>
          <div class="platform-capabilities__empty-sub">
            接通 Skill 目录、能力治理快照或 Runtime 绑定后，这里会显示真实能力目录。
          </div>
        </div>
      </div>
    `;
  }
  const items = filterCatalog(segmentItems(vm));
  if (items.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("search", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">没有匹配的能力</div>
          <div class="platform-capabilities__empty-sub">请尝试调整搜索或类型筛选。</div>
        </div>
      </div>
    `;
  }
  return html`
    <div class="platform-capabilities__card-grid">
      ${items.map((item) => renderCapabilityCard(item, props))}
    </div>
  `;
}

function renderDistributionTable(rows: CapabilityDistributionRowVM[]) {
  if (rows.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("building", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">尚无租户分发数据</div>
          <div class="platform-capabilities__empty-sub">
            创建租户或配置通道后，这里会呈现每个租户的能力覆盖矩阵。
          </div>
        </div>
      </div>
    `;
  }
  return html`
    <div class="platform-capabilities__distribution-grid">
      ${rows.map((row) => {
        const ratio = row.totalCount === 0 ? 0 : row.enabledCount / row.totalCount;
        return html`
          <article class="platform-capabilities__distribution-card">
            <div class="platform-capabilities__distribution-card-head">
              <div class="platform-capabilities__distribution-tenant">
                <span class="platform-capabilities__distribution-avatar">
                  ${row.tenantLabel.slice(0, 1).toUpperCase()}
                </span>
                <div class="platform-capabilities__distribution-tenant-copy">
                  <div class="platform-capabilities__distribution-tenant-name">
                    ${row.tenantLabel}
                  </div>
                  <div class="platform-capabilities__distribution-tenant-id">${row.tenantId}</div>
                </div>
              </div>
              <span
                class="platform-capabilities__chip is-${
                  row.tenantStatus === "suspended" || row.tenantStatus === "expired"
                    ? "danger"
                    : "neutral"
                }"
              >
                ${row.tenantStatusLabel}
              </span>
            </div>
            <div class="platform-capabilities__distribution-coverage">
              <div class="platform-capabilities__distribution-coverage-row">
                <div class="platform-capabilities__distribution-coverage-value">
                  ${row.coverageLabel}
                </div>
                <span class="platform-capabilities__card-meta-text">${row.defaultBundleLabel}</span>
              </div>
              <div class="platform-capabilities__distribution-progress">
                <div
                  class="platform-capabilities__distribution-progress-fill is-${row.coverageTone}"
                  style="width: ${Math.round(ratio * 100)}%"
                ></div>
              </div>
            </div>
            <div class="platform-capabilities__distribution-card-foot">
              <span class="platform-capabilities__distribution-updated"
                >${row.lastChangedLabel}</span
              >
              ${
                row.href
                  ? html`
                      <a
                        class="platform-capabilities__distribution-action"
                        href=${row.href}
                        @click=${(event: MouseEvent) => followPortHref(event, row.href!)}
                      >
                        ${renderIcon(
                          "arrowUpRight",
                          "platform-capabilities__distribution-action-icon",
                        )}
                        <span>管理</span>
                      </a>
                    `
                  : nothing
              }
            </div>
          </article>
        `;
      })}
    </div>
  `;
}

function renderHealthList(items: CapabilityHealthItemVM2[]) {
  if (items.length === 0) {
    return html`
      <div class="platform-capabilities__empty is-ok">
        ${renderIcon("checkCircle", "platform-capabilities__empty-icon is-ok")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">部署健康良好</div>
          <div class="platform-capabilities__empty-sub">当前没有影响能力可用性的问题。</div>
        </div>
      </div>
    `;
  }
  const groups = {
    critical: items.filter((item) => item.severity === "critical"),
    warning: items.filter((item) => item.severity === "warning"),
    info: items.filter((item) => item.severity === "info"),
  } as const;
  const tabs = [
    { id: "all", label: "全部", count: items.length },
    { id: "critical", label: "严重", count: groups.critical.length },
    { id: "warning", label: "预警", count: groups.warning.length },
    { id: "info", label: "提示", count: groups.info.length },
  ] as const;
  const activeItems =
    pageState.healthSeverityFilter === "all"
      ? items
      : items.filter((item) => item.severity === pageState.healthSeverityFilter);
  return html`
    <div class="platform-capabilities__health-list">
      <div
        class="platform-capabilities__health-filter"
        role="tablist"
        aria-label="健康问题严重度筛选"
      >
        ${tabs.map(
          (tab) => html`
            <button
              class="platform-capabilities__health-filter-tab ${
                pageState.healthSeverityFilter === tab.id ? "is-active" : ""
              }"
              role="tab"
              type="button"
              aria-selected=${String(pageState.healthSeverityFilter === tab.id)}
              @click=${() => setHealthSeverityFilter(tab.id)}
            >
              <span class="platform-capabilities__health-filter-label">${tab.label}</span>
              <span class="platform-capabilities__health-filter-count">${tab.count}</span>
            </button>
          `,
        )}
      </div>
      <div class="platform-capabilities__health-group-items">
        ${activeItems.map(
          (item) => html`
            <article class="platform-capabilities__health-item is-${item.severity}">
              <span class="platform-capabilities__health-item-icon is-${item.severity}">
                ${renderIcon(
                  CATEGORY_ICON_MAP[item.category],
                  "platform-capabilities__health-item-icon-svg",
                )}
              </span>
              <div class="platform-capabilities__health-item-body">
                <div class="platform-capabilities__health-item-row">
                  <div class="platform-capabilities__health-item-title">${item.title}</div>
                  <span class="platform-capabilities__health-item-category">
                    ${item.categoryLabel}
                  </span>
                </div>
                <div class="platform-capabilities__health-item-sub">${item.subtitle}</div>
                <div class="platform-capabilities__health-item-meta">${item.meta}</div>
              </div>
            </article>
          `,
        )}
      </div>
    </div>
  `;
}

function renderDiscoveryWorkbench(vm: CapabilitiesVM, props: PlatformSurfaceProps) {
  const items = vm.discoveredItems.filter((proposal) =>
    isPendingCapabilityReviewStatus(proposal.status),
  );
  if (items.length === 0) {
    return html`
      <div class="platform-capabilities__empty is-ok">
        ${renderIcon("checkCircle", "platform-capabilities__empty-icon is-ok")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">发现池为空</div>
          <div class="platform-capabilities__empty-sub">当前没有等待审阅的能力提案。</div>
        </div>
      </div>
    `;
  }
  return html`
    <div class="platform-capabilities__discovery-list">
      ${items.map((proposal) => {
        const syntheticItem = vm.catalogItems.find((item) => item.id === proposal.capabilityId);
        return html`
          <article class="platform-capabilities__discovery-item">
            <span class="platform-capabilities__discovery-icon">
              ${renderIcon("compass", "platform-capabilities__discovery-icon-svg")}
            </span>
            <div class="platform-capabilities__discovery-copy">
              <div class="platform-capabilities__discovery-title-row">
                <span class="platform-capabilities__discovery-title">${proposal.title}</span>
                <span class="platform-capabilities__chip is-warn">${proposal.statusLabel}</span>
              </div>
              <div class="platform-capabilities__discovery-sub">${proposal.subtitle}</div>
              <div class="platform-capabilities__discovery-meta">
                <span class="platform-capabilities__chip">${proposal.sourceLabel}</span>
                <span class="platform-capabilities__chip"
                  >${formatTrustTierLabel(proposal.trustTier)}</span
                >
                <span class="platform-capabilities__chip is-${formatRiskTone(proposal.riskLevel)}">
                  ${formatRiskLevelLabel(proposal.riskLevel)}
                </span>
                ${
                  proposal.findingCount > 0
                    ? html`
                        <span class="platform-capabilities__chip is-danger">
                          ${proposal.findingCount} 项安全项
                        </span>
                      `
                    : nothing
                }
              </div>
            </div>
            <div class="platform-capabilities__discovery-actions">
              <button
                class="platform-capabilities__inline-action is-primary"
                type="button"
                @click=${() =>
                  runReviewAction(
                    () =>
                      props.actions.capabilities.onApproveProposal(
                        proposal.proposalId,
                        "platform-ui",
                      ),
                    `已批准能力提案：${proposal.title}`,
                  )}
              >
                批准
              </button>
              <button
                class="platform-capabilities__inline-action is-muted"
                type="button"
                @click=${() =>
                  runReviewAction(
                    () =>
                      props.actions.capabilities.onRejectProposal(
                        proposal.proposalId,
                        "platform-ui",
                        "不纳入当前平台目录",
                      ),
                    `已拒绝能力提案：${proposal.title}`,
                  )}
              >
                拒绝
              </button>
              ${
                syntheticItem
                  ? html`
                      <button
                        class="platform-capabilities__inline-action is-muted"
                        type="button"
                        @click=${() => openCapabilityDetail(syntheticItem.id)}
                      >
                        查看详情
                      </button>
                    `
                  : nothing
              }
            </div>
          </article>
        `;
      })}
    </div>
  `;
}

function formatTrustTierLabel(trustTier: CapabilityProposalItemVM["trustTier"]) {
  switch (trustTier) {
    case "first-party":
      return "平台内置";
    case "workspace":
      return "工作区";
    case "user":
      return "个人";
    case "third-party":
      return "第三方";
    case "external":
      return "外部";
  }
}

function formatRiskLevelLabel(level: CapabilityProposalItemVM["riskLevel"]) {
  switch (level) {
    case "low":
      return "低风险";
    case "medium":
      return "中风险";
    case "high":
      return "高风险";
    case "critical":
      return "严重风险";
  }
}

function formatRiskTone(level: CapabilityProposalItemVM["riskLevel"]) {
  switch (level) {
    case "low":
      return "ok";
    case "medium":
      return "warn";
    case "high":
    case "critical":
      return "danger";
  }
}

function renderHero(_vm: CapabilitiesVM) {
  return html` <section class="platform-capabilities__hero">${renderHeroToolbar()}</section> `;
}

function renderActionNotice() {
  if (!pageState.actionMessage) {
    return nothing;
  }
  return html`
    <div class="platform-capabilities__notice is-${pageState.actionMessage.kind}">
      <div>${pageState.actionMessage.text}</div>
      <button class="btn btn--ghost btn--sm" type="button" @click=${clearActionMessage}>
        ${renderIcon("x")}
      </button>
    </div>
  `;
}

function renderRuntimeCoverageNotice(props: PlatformSurfaceProps) {
  const hasRuntimeData =
    (props.readModel.runtimeAgents?.length ?? 0) > 0 ||
    (props.readModel.runtimeBindings?.length ?? 0) > 0;
  if (hasRuntimeData) {
    return nothing;
  }
  return html`
    <div class="platform-capabilities__notice">
      <div>
        当前已接通能力资产与企业目录，但尚未发现 Runtime 实例或绑定数据。 本页当前展示的是治理策略口径与
        Skill 缺项口径，还不是完整运行实况。
      </div>
    </div>
  `;
}

function renderCapabilityDetailFactList(
  items: Array<{ label: string; value: string }>,
  options?: { emptyTitle?: string; emptyDescription?: string },
) {
  return renderAssetDetailListItemsOrEmpty({
    items,
    containerClass: "platform-capabilities__detail-list",
    itemClass: "platform-capabilities__detail-list-item",
    emptyTitle: options?.emptyTitle ?? "信息待接通",
    emptyDescription: options?.emptyDescription ?? "当前还没有可展示的资产详情。",
  });
}

function renderCapabilityDetailHealthSection(healthIssues: CapabilityHealthItemVM2[]) {
  if (healthIssues.length === 0) {
    return nothing;
  }
  return html`
    <section class="model-assets-drawer__section">
      <div class="card-title">健康提醒</div>
      <div class="platform-capabilities__detail-health">
        ${healthIssues.map(
          (item) => html`
            <div class="platform-capabilities__detail-health-item is-${item.severity}">
              <strong>${item.subtitle}</strong>
              <span>${item.meta}</span>
            </div>
          `,
        )}
      </div>
      <div class="platform-capabilities__detail-copy card-follow--xs">
        平台端只展示提醒；安装动作由<strong>员工端运行节点</strong>承担。
      </div>
    </section>
  `;
}

function renderCapabilityRuntimeTab(params: {
  selected: CapabilityCatalogItemVM;
  linkedSkill: SkillStatusEntry | null;
  missing: string[];
  vm: ReturnType<typeof buildPlatformAssetDetailVM>;
  props: PlatformSurfaceProps;
}) {
  const { selected, linkedSkill, missing, vm, props } = params;
  if (!linkedSkill) {
    return renderStandardAssetDetailEmptyState({
      title: "运行时未接通",
      description: "当前能力还没有关联到运行时技能配置，暂时无法展示依赖与启停状态。",
    });
  }

  const hasMissing =
    linkedSkill.missing.bins.length > 0 ||
    linkedSkill.missing.env.length > 0 ||
    linkedSkill.missing.config.length > 0;

  return html`
    <section class="model-assets-drawer__section">
      <div class="row row--split row--wrap">
        <div class="stack stack--tight">
          <strong class="text-sm">${linkedSkill.name}</strong>
          <span
            class="chip ${linkedSkill.disabled ? "chip-danger" : hasMissing ? "chip-warn" : "chip-ok"}"
          >
            ${linkedSkill.disabled ? "已禁用" : hasMissing ? "缺失依赖" : "可用"}
          </span>
        </div>
        <div class="platform-capabilities__detail-actions">
          ${
            linkedSkill.disabled
              ? html`
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => props.skillsProps?.onToggle(linkedSkill.skillKey, true)}
                  >
                    启用
                  </button>
                `
              : html`
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => props.skillsProps?.onToggle(linkedSkill.skillKey, false)}
                  >
                    禁用
                  </button>
                `
          }
        </div>
      </div>
    </section>

    <section class="model-assets-drawer__section">
      <div class="card-title">运行要求</div>
      ${renderCapabilityDetailFactList(vm.runtimeFacts, {
        emptyTitle: "运行要求待接通",
        emptyDescription: "当前还没有接通运行环境要求信息。",
      })}
    </section>

    ${
      missing.length > 0
        ? html`
            <section class="model-assets-drawer__section">
              <div class="card-title">待补齐项</div>
              <div class="platform-capabilities__detail-config-list">
                ${missing.map((entry) => {
                  // 平台端只做"治理提醒"，不直接安装；安装动作下沉到员工端运行节点。
                  const guidance = entry.startsWith("bin:")
                    ? "需在员工端运行节点安装本地命令行工具"
                    : entry.startsWith("env:")
                      ? "需在员工端运行节点填写环境变量或 API Key"
                      : entry.startsWith("config:")
                        ? "需在员工端运行节点补齐配置路径"
                        : "需在员工端运行节点满足运行环境要求";
                  return html`
                    <div class="platform-capabilities__detail-config-item">
                      <strong>${entry}</strong>
                      <span>${guidance}</span>
                      <span class="platform-capabilities__detail-config-state">仅提醒</span>
                    </div>
                  `;
                })}
              </div>
            </section>
          `
        : html`
            <section class="model-assets-drawer__section">
              ${renderStandardAssetDetailEmptyState({
                title: "运行时已就绪",
                description: `${selected.title} 当前没有发现额外依赖缺口，可直接纳入后续运行治理。`,
              })}
            </section>
          `
    }
    ${
      linkedSkill.primaryEnv
        ? html`
            <section class="model-assets-drawer__section">
              <div class="card-title">主配置项</div>
              <div class="field platform-capabilities__detail-inline-field">
                <span>${linkedSkill.primaryEnv}</span>
                <input
                  type="password"
                  .value=${props.skillsProps?.edits?.[linkedSkill.skillKey] ?? ""}
                  @input=${(event: Event) =>
                    props.skillsProps?.onEdit(
                      linkedSkill.skillKey,
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </div>
              <div class="platform-capabilities__detail-actions">
                <button
                  class="platform-capabilities__hero-button"
                  type="button"
                  @click=${() => props.skillsProps?.onSaveKey(linkedSkill.skillKey)}
                >
                  保存配置
                </button>
              </div>
            </section>
          `
        : nothing
    }

    <section class="model-assets-drawer__section">
      <div class="card-title">运行事件</div>
      ${renderAssetDetailTimeline({
        items: vm.runtimeTimeline,
        itemClass: "asset-detail-page__timeline-item",
        timeClass: "asset-detail-page__timeline-time",
        primaryClass: "asset-detail-page__timeline-author",
        secondaryClass: "asset-detail-page__timeline-summary",
        statusClassBase: "enterprise-status-badge",
        statusTonePrefix: "enterprise-status-badge--",
        emptyTitle: "暂无运行事件",
        emptyDescription: "当前还没有运行事件时间线记录。",
      })}
    </section>
  `;
}

function renderCapabilityDetailTabBody(params: {
  selected: CapabilityCatalogItemVM;
  linkedSkill: SkillStatusEntry | null;
  linkedDistributionRows: CapabilityDistributionRowVM[];
  healthIssues: CapabilityHealthItemVM2[];
  missing: string[];
  canInstall: boolean;
  vm: ReturnType<typeof buildPlatformAssetDetailVM>;
  props: PlatformSurfaceProps;
}) {
  const {
    selected,
    linkedSkill,
    linkedDistributionRows,
    healthIssues,
    missing,
    canInstall,
    vm,
    props,
  } = params;

  switch (pageState.detailTab) {
    case "overview":
      return html`
        <section class="model-assets-drawer__section row row--wrap">
          <div class="platform-capabilities__detail-metrics">
            <div class="platform-capabilities__detail-metric">
              <div class="platform-capabilities__card-metric-label">租户</div>
              <div class="platform-capabilities__card-metric-value">${selected.tenantsEnabled}</div>
            </div>
            <div class="platform-capabilities__detail-metric">
              <div class="platform-capabilities__card-metric-label">7日调用</div>
              <div class="platform-capabilities__card-metric-value">${selected.calls7dLabel}</div>
            </div>
            <div class="platform-capabilities__detail-metric">
              <div class="platform-capabilities__card-metric-label">失败率</div>
              <div class="platform-capabilities__card-metric-value">
                ${selected.failureRateLabel}
              </div>
            </div>
          </div>
        </section>

        <section class="model-assets-drawer__section">
          <div class="card-title">业务摘要</div>
          <div class="platform-capabilities__detail-copy">${selected.summary}</div>
        </section>

        ${
          selected.readinessGap.length > 0
            ? html`
                <section class="model-assets-drawer__section">
                  <div class="card-title">待补齐概览</div>
                  ${renderCapabilityDetailFactList(
                    selected.readinessGap.map((gap) => ({
                      label: "待补齐",
                      value: gap,
                    })),
                  )}
                </section>
              `
            : nothing
        }
        ${renderCapabilityDetailHealthSection(healthIssues)}
      `;
    case "definition":
      return html`
        <section class="model-assets-drawer__section">
          <div class="row row--split card-lead">
            <strong class="text-sm">介绍</strong>
            <button
              class="btn btn--sm"
              type="button"
              @click=${async () => {
                if (!props.actions.capabilities.onUpdateManifest) {
                  return;
                }
                await props.actions.capabilities.onUpdateManifest(selected.id, {
                  descriptionZh: resolveEditableSummary(selected),
                });
                showActionMessage("success", `已保存：${selected.title}`);
              }}
            >
              保存
            </button>
          </div>
          <textarea
            class="platform-capabilities__detail-textarea"
            rows="3"
            .value=${resolveEditableSummary(selected)}
            @input=${(event: Event) => {
              pageState.descriptionDraftById = {
                ...pageState.descriptionDraftById,
                [selected.id]: (event.currentTarget as HTMLTextAreaElement).value,
              };
              requestRerender();
            }}
          ></textarea>
        </section>

        <section class="model-assets-drawer__section">
          <div class="card-title">定义快照</div>
          ${renderCapabilityDetailFactList(vm.definitionFacts, {
            emptyTitle: "定义快照待接通",
            emptyDescription: "当前还没有可展示的定义快照信息。",
          })}
        </section>

        ${
          selected.homepage || linkedSkill?.homepage
            ? html`
                <section class="model-assets-drawer__section">
                  <div class="card-title">参考链接</div>
                  <div class="platform-capabilities__detail-actions">
                    <a
                      class="btn btn--sm"
                      href=${linkedSkill?.homepage ?? selected.homepage ?? "#"}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      打开主页
                    </a>
                  </div>
                </section>
              `
            : nothing
        }
      `;
    case "files":
      return linkedSkill
        ? html`
            <section class="model-assets-drawer__section">
              <div class="card-title">已接通文件</div>
              ${renderCapabilityDetailFactList([
                { label: "技能入口", value: linkedSkill.filePath },
                { label: "技能目录", value: linkedSkill.baseDir },
                { label: "来源类型", value: linkedSkill.source },
              ])}
            </section>

            <section class="model-assets-drawer__section">
              <div class="card-title">配置文件检查</div>
              ${
                linkedSkill.configChecks.length > 0
                  ? renderCapabilityDetailFactList(
                      linkedSkill.configChecks.map((check) => ({
                        label: check.satisfied ? "已满足" : "待补齐",
                        value: check.path,
                      })),
                    )
                  : renderStandardAssetDetailEmptyState({
                      title: "附属文件待扩展",
                      description: "当前已接通技能入口和目录，但更细的附属文件清单仍待接通。",
                    })
              }
            </section>
          `
        : renderStandardAssetDetailEmptyState({
            title: "文件清单待接通",
            description: "当前只接通了治理摘要，还没有关联到技能入口文件与目录。",
          });
    case "versions":
      return html`
        <section class="model-assets-drawer__section">
          <div class="card-title">当前版本口径</div>
          ${renderCapabilityDetailFactList(vm.versionFacts)}
        </section>

        <section class="model-assets-drawer__section">
          ${renderStandardAssetDetailEmptyState({
            title: "版本时间线待接通",
            description:
              "平台端已经接通当前版本号，但完整的历史版本、发布时间和变更记录还没有进入统一资产详情模型。",
          })}
        </section>
      `;
    case "runtime":
      return renderCapabilityRuntimeTab({
        selected,
        linkedSkill,
        missing,
        vm,
        props,
      });
    case "install":
      return html`
        <section class="model-assets-drawer__section">
          <div class="card-title">安装口径</div>
          ${renderCapabilityDetailFactList(vm.installFacts)}
        </section>

        <section class="model-assets-drawer__section">
          <div class="row row--split">
            <strong class="text-sm">租户覆盖快照</strong>
            <button
              class="btn btn--sm"
              type="button"
              @click=${() => {
                const selectedTenantIds = linkedDistributionRows.map((row) => row.tenantId);
                openDistributionEditor(
                  selected.id,
                  selectedTenantIds,
                  selected.defaultEnabled ?? false,
                  selected.employeeVisibilityMode ?? "enterprise_review_required",
                );
              }}
            >
              配置分发
            </button>
          </div>
          ${
            linkedDistributionRows.length > 0
              ? html`
                  <div class="row row--wrap row--tight card-follow--xs">
                    ${linkedDistributionRows.slice(0, 6).map(
                      (row) => html`
                        <div class="platform-capabilities__coverage-chip">
                          <strong class="platform-capabilities__coverage-chip-name"
                            >${row.tenantLabel}</strong
                          >
                          <span class="platform-capabilities__coverage-chip-meta"
                            >${row.coverageLabel}</span
                          >
                        </div>
                      `,
                    )}
                  </div>
                `
              : renderStandardAssetDetailEmptyState({
                  title: "暂未配置租户覆盖",
                  description: "当前还没有发现已启用的租户覆盖快照，可在这里继续配置分发范围。",
                })
          }
        </section>

        ${
          canInstall
            ? html`
                <section class="model-assets-drawer__section">
                  <div class="card-title">依赖提醒</div>
                  <div class="platform-capabilities__detail-copy">
                    该能力当前缺失运行依赖。平台端不直接安装；安装动作由
                    <strong>员工端运行节点</strong>承担——员工在工作台触发该技能时会看到“一键安装”横幅。
                  </div>
                </section>
              `
            : nothing
        }
      `;
  }
}

function renderCapabilityDetailDrawer(
  vm: CapabilitiesVM,
  selected: CapabilityCatalogItemVM,
  props: PlatformSurfaceProps,
) {
  const linkedDistributionRows = vm.distributionRows.filter((row) => row.enabledCount > 0);
  const healthIssues = vm.healthItemsV2.filter((item) => item.title === selected.title);
  const linkedSkill =
    props.skillsProps?.report?.skills.find((skill) => skill.skillKey === selected.skillKey) ?? null;
  const missing = linkedSkill ? computeSkillMissing(linkedSkill) : [];
  const canInstall = Boolean(
    linkedSkill &&
    (linkedSkill.install?.length ?? 0) > 0 &&
    (linkedSkill.missing?.bins?.length ?? 0) > 0,
  );
  const detailVm = buildPlatformAssetDetailVM({
    selected,
    linkedSkill,
    linkedDistributionRows,
    healthIssues,
    missing,
  });
  const detailTabs = detailVm.tabs;
  return html`
    <div
      class="model-assets-drawer-overlay platform-capabilities__detail-overlay"
      role="dialog"
      aria-modal="true"
      @click=${closeCapabilityDetail}
    >
      <aside
        class="model-assets-drawer platform-capabilities__detail-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <button
            class="btn btn--ghost btn--sm btn--bare"
            type="button"
            @click=${closeCapabilityDetail}
          >
            ${renderIcon("chevronLeft")} 返回
          </button>
          <button
            class="btn btn--ghost btn--sm btn--bare"
            type="button"
            @click=${closeCapabilityDetail}
          >
            ${renderIcon("x")}
          </button>
        </div>
        <div class="model-assets-drawer__hero">
          <div class="model-assets-drawer__hero-main">
            <span class="platform-capabilities__detail-avatar">
              ${renderIcon(CATEGORY_ICON_MAP[selected.categoryId], "platform-capabilities__card-icon-svg")}
            </span>
            <div class="model-assets-drawer__hero-copy">
              <div class="model-assets-drawer__title model-assets-drawer__title--lg">
                ${selected.title}
              </div>
              <div class="model-assets-drawer__hero-tags">
                <span class="platform-capabilities__chip">${selected.categoryLabel}</span>
                <span class="platform-capabilities__chip">${selected.trustLabel}</span>
                <span class="platform-capabilities__card-status is-${selected.statusTone}"
                  >${selected.statusLabel}</span
                >
              </div>
            </div>
            <div class="model-assets-drawer__hero-side">
              <button
                class="btn btn--sm"
                type="button"
                @click=${async () => {
                  await props.actions.capabilities.onDeprecate(selected.id);
                  showActionMessage("success", `已标记弃用：${selected.title}`);
                }}
              >
                弃用
              </button>
              <button
                class="btn btn--sm btn--danger"
                type="button"
                @click=${async () => {
                  await props.actions.capabilities.onRetire(selected.id);
                  showActionMessage("success", `已退役：${selected.title}`);
                }}
              >
                退役
              </button>
            </div>
          </div>
        </div>
        <div class="model-assets-drawer__body">
          <section class="model-assets-drawer__section model-assets-drawer__section--full">
            ${renderStandardAssetDetailTabs({
              activeTab: pageState.detailTab,
              onChange: setCapabilityDetailTab,
              tabs: detailTabs,
            })}
          </section>
          ${renderCapabilityDetailTabBody({
            selected,
            linkedSkill,
            linkedDistributionRows,
            healthIssues,
            missing,
            canInstall,
            vm: detailVm,
            props,
          })}
        </div>
      </aside>
    </div>
  `;
}

function renderDistributionEditor(
  props: PlatformSurfaceProps,
  selectedCapability: CapabilityCatalogItemVM | null,
) {
  if (!pageState.distributionEditorCapabilityId || !selectedCapability) {
    return nothing;
  }

  const tenants =
    props.readModel.enterpriseDirectory.length > 0
      ? props.readModel.enterpriseDirectory
      : props.readModel.tenantDirectory.length > 0
        ? props.readModel.tenantDirectory.map((entry) => ({
            tenantId: entry.tenantId,
            label: entry.label,
            status: "unknown" as const,
          }))
        : props.readModel.knownTenantIds.map((id) => ({
            tenantId: id,
            label: id,
            status: "unknown" as const,
          }));

  return html`
    <div
      class="model-assets-drawer-overlay platform-capabilities__detail-overlay"
      role="dialog"
      aria-modal="true"
      @click=${closeDistributionEditor}
    >
      <aside
        class="model-assets-drawer platform-capabilities__detail-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div class="model-assets-drawer__title">配置分发</div>
          <button class="btn btn--ghost btn--sm" type="button" @click=${closeDistributionEditor}>
            ${renderIcon("x")}
          </button>
        </div>
        <div class="model-assets-drawer__body">
          <section class="model-assets-drawer__section">
            <div class="card-title">${selectedCapability.title}</div>
            <div class="platform-capabilities__detail-copy">
              选择要默认覆盖的租户范围，并决定该能力是否默认启用。
            </div>
          </section>

          <section class="model-assets-drawer__section">
            <label class="platform-capabilities__distribution-switch">
              <input
                type="checkbox"
                .checked=${pageState.distributionDraftDefaultEnabled}
                @change=${(event: Event) => {
                  pageState.distributionDraftDefaultEnabled = (
                    event.currentTarget as HTMLInputElement
                  ).checked;
                  requestRerender();
                }}
              />
              <span>默认启用该能力</span>
            </label>
          </section>

          <section class="model-assets-drawer__section">
            <div class="card-title">员工可见性</div>
            <div class="platform-capabilities__detail-copy">
              控制平台推送到企业后，员工是否可直接在能力市场中看到该能力。
            </div>
            <div class="platform-capabilities__distribution-editor-grid card-follow--sm">
              <label class="platform-capabilities__distribution-editor-card">
                <input
                  type="radio"
                  name="employee-visibility-mode"
                  .checked=${
                    pageState.distributionDraftEmployeeVisibilityMode ===
                    "enterprise_review_required"
                  }
                  @change=${() => {
                    pageState.distributionDraftEmployeeVisibilityMode =
                      "enterprise_review_required";
                    requestRerender();
                  }}
                />
                <div class="platform-capabilities__distribution-editor-copy">
                  <strong>企业筛选后可见</strong>
                  <span>员工需等待企业二次推送到岗位后才可见</span>
                </div>
              </label>
              <label class="platform-capabilities__distribution-editor-card">
                <input
                  type="radio"
                  name="employee-visibility-mode"
                  .checked=${
                    pageState.distributionDraftEmployeeVisibilityMode === "direct_employee_visible"
                  }
                  @change=${() => {
                    pageState.distributionDraftEmployeeVisibilityMode = "direct_employee_visible";
                    requestRerender();
                  }}
                />
                <div class="platform-capabilities__distribution-editor-copy">
                  <strong>员工直达可见</strong>
                  <span>匹配租户内员工可直接在能力市场看到并安装</span>
                </div>
              </label>
            </div>
          </section>

          <section class="model-assets-drawer__section">
            <div class="card-title">选择租户</div>
            <div class="platform-capabilities__distribution-editor-grid">
              ${tenants.map(
                (tenant) => html`
                  <label class="platform-capabilities__distribution-editor-card">
                    <input
                      type="checkbox"
                      .checked=${pageState.distributionDraftTenantIds.includes(tenant.tenantId)}
                      @change=${() => toggleDistributionTenant(tenant.tenantId)}
                    />
                    <div class="platform-capabilities__distribution-editor-copy">
                      <strong>${tenant.label}</strong>
                      <span>${tenant.tenantId}</span>
                    </div>
                  </label>
                `,
              )}
            </div>
          </section>

          <section class="model-assets-drawer__section">
            <div class="platform-capabilities__detail-actions">
              <button
                class="platform-capabilities__hero-button"
                type="button"
                @click=${async () => {
                  await props.actions.capabilities.onPromoteDistribution(
                    selectedCapability.id,
                    {
                      tenantIds:
                        pageState.distributionDraftTenantIds.length > 0
                          ? [...pageState.distributionDraftTenantIds]
                          : undefined,
                    },
                    pageState.distributionDraftEmployeeVisibilityMode,
                    "platform-ui",
                  );
                  closeDistributionEditor();
                }}
              >
                保存分发配置
              </button>
              <button
                class="platform-capabilities__hero-button"
                type="button"
                @click=${async () => {
                  await props.actions.capabilities.onRevokeDistribution(
                    selectedCapability.id,
                    "platform-ui",
                  );
                  closeDistributionEditor();
                }}
              >
                清空分发范围
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  `;
}

function renderAddCapabilityPanel(props: PlatformSurfaceProps) {
  if (!pageState.addCapabilityOpen) {
    return nothing;
  }

  const marketplaceItems = pageState.marketDiscoveryResults.filter(isMarketplaceItem);
  const selectedMarketItem =
    pageState.addCapabilityTab === "market"
      ? (marketplaceItems.find((item) => item.externalId === pageState.selectedMarketItemId) ??
        marketplaceItems[0] ??
        null)
      : null;
  const remoteResultsLoaded =
    pageState.addCapabilityTab === "remote" && pageState.remoteDiscoveryLoaded;
  let workspaceContent: unknown;

  switch (pageState.addCapabilityTab) {
    case "market":
      workspaceContent = renderAddCapabilityWorkspace({
        eyebrow: "精选来源",
        title: "能力市场",
        description: "搜索并选择可安装能力。",
        headerSlot: html`
          <button
            class="platform-capabilities__hero-button platform-capabilities__workspace-toolbar-action"
            type="button"
            ?disabled=${pageState.addCapabilityBusy}
            @click=${async () => refreshExternalDiscoveryResults(props)}
          >
            ${pageState.addCapabilityBusy ? "加载中…" : "搜索"}
          </button>
        `,
        body: html`
          <div class="platform-capabilities__workspace-toolbar">
            <label class="platform-capabilities__search platform-capabilities__search--workspace">
              ${renderIcon("search", "platform-capabilities__search-icon")}
              <input
                type="search"
                placeholder="搜索能力，例如 ppt / 翻译 / github / 知识库"
                .value=${pageState.addCapabilitySearch}
                @input=${(event: Event) => {
                  pageState.addCapabilitySearch = (event.currentTarget as HTMLInputElement).value;
                  requestRerender();
                }}
              />
            </label>
          </div>
          ${renderPresetCatalogResults(pageState.addCapabilitySearch, props)}
          ${
            pageState.marketDiscoveryLoaded
              ? marketplaceItems.length === 0
                ? html``
                : html`
                    <div
                      class="platform-capabilities__detail-copy platform-capabilities__detail-copy--label card-follow"
                    >
                      外部源结果
                    </div>
                    <div class="platform-capabilities__market-grid">
                      ${marketplaceItems.map(
                        (item) => html`
                          <button
                            class="platform-capabilities__market-card ${
                              pageState.selectedMarketItemId === item.externalId ? "is-active" : ""
                            }"
                            type="button"
                            @click=${() => {
                              pageState.selectedMarketItemId = item.externalId;
                              requestRerender();
                            }}
                          >
                            <div class="platform-capabilities__market-card-head">
                              <strong>${item.manifest.name}</strong>
                              <span class="platform-capabilities__chip"> ${item.sourceId} </span>
                            </div>
                            <div class="platform-capabilities__market-card-sub">
                              ${item.manifest.description || "暂无描述"}
                            </div>
                            <div class="platform-capabilities__market-card-meta">
                              <span>版本 ${item.manifest.version}</span>
                              <span>${item.findings.length} 项风险</span>
                            </div>
                          </button>
                        `,
                      )}
                    </div>
                    ${
                      selectedMarketItem
                        ? html`
                            <div class="platform-capabilities__detail-list">
                              <div class="platform-capabilities__detail-list-item">
                                <div>
                                  <strong>${selectedMarketItem.manifest.name}</strong>
                                  <span>
                                    ${selectedMarketItem.sourceId} ·
                                    ${selectedMarketItem.manifest.version}
                                  </span>
                                </div>
                                <div class="platform-capabilities__detail-actions">
                                  <button
                                    class="platform-capabilities__hero-button platform-capabilities__hero-button--compact"
                                    type="button"
                                    ?disabled=${pageState.addCapabilityBusy}
                                    @click=${async () =>
                                      submitExternalDiscoveryProposal(props, selectedMarketItem)}
                                  >
                                    ${pageState.addCapabilityBusy ? "提交中…" : "提交到发现池"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          `
                        : nothing
                    }
                  `
              : html`
                  <div class="platform-capabilities__detail-copy">输入关键词后开始搜索。</div>
                `
          }
        `,
      });
      break;
    case "local":
      workspaceContent = renderAddCapabilityWorkspace({
        eyebrow: "本地文件",
        title: "本地导入",
        description: "从电脑导入能力文件，支持 SKILL.md / JSON / YAML / TXT / ZIP 技能包格式。",
        body: html`
          <div class="platform-capabilities__detail-list">
            <div class="platform-capabilities__detail-list-item">
              <div>
                <strong>📁 本地文件</strong>
                <span>${pageState.localImportFileName ?? "选择一个本地能力文件后提交待审阅"}</span>
              </div>
              <div class="platform-capabilities__detail-actions">
                <label
                  class="platform-capabilities__hero-button platform-capabilities__hero-button--compact"
                >
                  选择文件
                  <input
                    type="file"
                    accept=".json,.yaml,.yml,.md,.txt,.zip"
                    hidden
                    @change=${async (event: Event) => {
                      const input = event.currentTarget as HTMLInputElement;
                      const file = input.files?.[0] ?? null;
                      if (!file) {
                        return;
                      }
                      await importLocalCapabilityFile(props, file);
                      input.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
            <div class="platform-capabilities__workspace-hint">
              工作区识别结果在能力中心统一治理；此处仅负责从本地文件导入待验收能力。
            </div>
          </div>
        `,
      });
      break;
    case "remote":
      workspaceContent = renderAddCapabilityWorkspace({
        eyebrow: "远程来源",
        title: "GitHub / URL 导入",
        description: "粘贴仓库、URL 或 npm 包地址。",
        headerSlot: html`
          <button
            class="platform-capabilities__hero-button platform-capabilities__workspace-toolbar-action"
            type="button"
            ?disabled=${pageState.addCapabilityBusy}
            @click=${async () => importRemoteCapability(props)}
          >
            ${pageState.addCapabilityBusy ? "解析中…" : "解析"}
          </button>
        `,
        body: html`
          <div class="platform-capabilities__workspace-toolbar">
            <label class="platform-capabilities__search platform-capabilities__search--workspace">
              ${renderIcon("search", "platform-capabilities__search-icon")}
              <input
                type="search"
                placeholder="GitHub 仓库 / URL / npm"
                .value=${pageState.addCapabilityImportInput}
                @input=${(event: Event) => {
                  pageState.addCapabilityImportInput = (
                    event.currentTarget as HTMLInputElement
                  ).value;
                  requestRerender();
                }}
              />
            </label>
          </div>
          ${
            remoteResultsLoaded && pageState.remoteDiscoveryResults.length > 0
              ? html`
                  <div class="platform-capabilities__detail-list">
                    ${pageState.remoteDiscoveryResults.map(
                      (item) => html`
                        <div class="platform-capabilities__detail-list-item">
                          <div>
                            <strong>${item.manifest.name}</strong>
                            <span>
                              ${item.sourceId} · ${item.manifest.version}
                              ${item.findings.length > 0 ? ` · ${item.findings.length} 项风险` : ""}
                            </span>
                          </div>
                          <button
                            class="platform-capabilities__hero-button platform-capabilities__hero-button--compact"
                            type="button"
                            ?disabled=${pageState.addCapabilityBusy}
                            @click=${async () => submitExternalDiscoveryProposal(props, item)}
                          >
                            ${pageState.addCapabilityBusy ? "提交中…" : "提交到发现池"}
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `
              : html`
                  <div class="platform-capabilities__workspace-hint">
                    支持 GitHub、SkillHub、OpenClaw Skill、Claude Skill
                  </div>
                `
          }
        `,
      });
      break;
  }

  return html`
    <div
      class="model-assets-drawer-overlay platform-capabilities__detail-overlay"
      role="dialog"
      aria-modal="true"
      @click=${closeAddCapabilityPanel}
    >
      <aside
        class="model-assets-drawer platform-capabilities__detail-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div class="model-assets-drawer__title">添加能力</div>
          <button class="btn btn--ghost btn--sm" type="button" @click=${closeAddCapabilityPanel}>
            ${renderIcon("x")}
          </button>
        </div>
        <div class="model-assets-drawer__body">
          <section class="model-assets-drawer__section">
            <div
              class="platform-capabilities__segment-bar"
              role="tablist"
              aria-label="添加能力入口"
            >
              ${(
                [
                  { id: "market", label: "能力市场" },
                  { id: "local", label: "本地导入" },
                  { id: "remote", label: "GitHub / URL" },
                ] as const
              ).map(
                (source) => html`
                  <button
                    class="platform-capabilities__segment ${
                      pageState.addCapabilityTab === source.id ? "is-active" : ""
                    }"
                    type="button"
                    @click=${() => setAddCapabilityTab(source.id)}
                  >
                    ${source.label}
                  </button>
                `,
              )}
            </div>
          </section>

          <section class="model-assets-drawer__section">
            ${pageState.pendingCapability ? renderReviewPanel(props) : workspaceContent}
          </section>
        </div>
      </aside>
    </div>
  `;
}

function renderLegacyFallback(props: PlatformSurfaceProps) {
  const { readModel, basePath } = props;
  return html`
    <section class="platform-capabilities">
      <div class="platform-capabilities__summary">
        <article class="platform-capabilities__summary-card">
          <div class="platform-capabilities__summary-body">
            <div class="platform-capabilities__summary-label">能力目录</div>
            <div class="platform-capabilities__summary-value">${readModel.featureMethodCount}</div>
            <div class="platform-capabilities__summary-meta">
              ${readModel.providerIds.length} 个提供方
            </div>
          </div>
        </article>
        <article class="platform-capabilities__summary-card">
          <div class="platform-capabilities__summary-body">
            <div class="platform-capabilities__summary-label">已安装</div>
            <div class="platform-capabilities__summary-value">
              ${readModel.installedCapabilityCount}
            </div>
            <div class="platform-capabilities__summary-meta">
              ${readModel.channelIds.length} 个通道
            </div>
          </div>
        </article>
      </div>
      <p class="platform-capabilities__fallback-note">
        当前 Capability Governance 视图模型未接入，显示简化摘要。
        <a href=${pathForTab("platformAdvanced", basePath)}>前往高级控制</a>
      </p>
    </section>
  `;
}

export function renderPlatformCapabilitiesSurface(props: PlatformSurfaceProps) {
  syncStateFromHash();
  if (isPlatformShellPending(props.readModel)) {
    return html`
      <section class="platform-capabilities">${renderPlatformSummaryPending("能力中心")}</section>
    `;
  }
  if (!props.pageViewModels) {
    return renderLegacyFallback(props);
  }

  const vm = selectPlatformCapabilitiesVM(props.pageViewModels);
  const selectedCapability = findCapability(vm, pageState.selectedCapabilityId);
  const segmentedCatalogItems = segmentItems(vm);
  const visibleInstalledItems = filterCatalog(vm.installedItems);
  const tabCounts: Record<CapabilitiesTab, number> = {
    catalog: vm.summaryMetrics.totalInCatalog,
    installed: vm.summaryMetrics.totalInstalled,
    discovery: vm.discoveredItems.filter((proposal) =>
      isPendingCapabilityReviewStatus(proposal.status),
    ).length,
    enterpriseSubmissions: enterpriseSubmissionsTabCount(),
    distribution: vm.distributionRows.length,
    health: vm.summaryMetrics.attentionCount,
  };
  let body;

  switch (pageState.activeTab) {
    case "catalog":
      body = html`
        <section class="platform-capabilities__directory">
          ${renderSegmentBar()} ${renderCategoryFilter(segmentedCatalogItems, vm.categories)}
          ${renderCapabilityDirectory(vm, props)}
        </section>
      `;
      break;
    case "installed":
      body = html`
        <section class="platform-capabilities__directory">
          ${renderCategoryFilter(vm.installedItems, vm.categories)}
          <div class="platform-capabilities__card-grid">
            ${visibleInstalledItems.map((item) => renderCapabilityCard(item, props))}
          </div>
        </section>
      `;
      break;
    case "discovery":
      body = html`
        <section class="platform-capabilities__directory">
          ${renderDiscoveryWorkbench(vm, props)}
        </section>
      `;
      break;
    case "enterpriseSubmissions":
      body = renderEnterpriseSubmissionsSection(enterpriseSubmissionsHost(props));
      break;
    case "distribution":
      body = html`
        <section class="platform-capabilities__directory">
          ${renderRuntimeCoverageNotice(props)} ${renderDistributionTable(vm.distributionRows)}
        </section>
      `;
      break;
    case "health":
      body = html`
        <section class="platform-capabilities__directory">
          ${renderRuntimeCoverageNotice(props)} ${renderHealthList(vm.healthItemsV2)}
        </section>
      `;
      break;
  }

  return html`
    <section class="platform-capabilities">
      ${renderHero(vm)} ${renderActionNotice()}
      <div class="platform-capabilities__chrome">
        <div class="platform-capabilities__tabs" role="tablist" aria-label="能力模块视图">
          ${TAB_ORDER.map(
            (tab) => html`
              <button
                class="platform-capabilities__tab ${pageState.activeTab === tab ? "is-active" : ""}"
                role="tab"
                type="button"
                aria-selected=${String(pageState.activeTab === tab)}
                @click=${() => setActiveTab(tab)}
              >
                <span class="platform-capabilities__tab-label">${TAB_LABELS[tab]}</span>
                <span class="platform-capabilities__tab-count">${tabCounts[tab]}</span>
              </button>
            `,
          )}
        </div>
      </div>
      <div class="platform-capabilities__body">${body}</div>
      ${selectedCapability ? renderCapabilityDetailDrawer(vm, selectedCapability, props) : nothing}
      ${renderDistributionEditor(props, selectedCapability)} ${renderAddCapabilityPanel(props)}
    </section>
  `;
}
