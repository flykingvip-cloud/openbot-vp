import { html, nothing } from "lit";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import {
  normalizeAppHistoryHref,
  pushAppHistoryState,
  replaceAppHistoryState,
  requestOpenBotAppRerender,
} from "../../../request-app-rerender.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import { followPortHref } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { closePlatformCreateTenantDrawer } from "../system-settings/create-tenant-drawer.ts";
import {
  renderPlatformCreateTenantWorkspace,
  resolvePlatformCreateTenantInviteCode,
} from "../system-settings/page.ts";
import { platformCreateTenantHref } from "../system-settings/route.ts";
import type { PlatformPortTenantsActions } from "../view-types.ts";
import {
  buildPlatformTenantsVM,
  isTenantDetailSection,
  normalizeTenantDetailSection,
  parseTenantSelectionHash,
  PLATFORM_TENANT_PRIMARY_SECTIONS,
  PLATFORM_TENANTS_HASH_PREFIX,
  platformTenantSectionHref,
  type PlatformTenantDetailSectionId,
} from "./adapter.ts";
import {
  __resetTenantAdminContactForTest,
  closeTenantAdminContactDialog,
  openTenantAdminContactDialog,
  renderTenantAdminContactDialog,
} from "./sections/TenantAdminContactSection.ts";
import {
  __resetTenantSeatSettingsForTest,
  closeTenantSeatSettingsDialog,
  openTenantSeatSettingsDialog,
  renderTenantSeatSettingsDialog,
} from "./sections/TenantSeatSettingsSection.ts";
import {
  formatTrialApplicationDateTime,
  formatTrialReviewReasons,
  renderTrialApplicationDetailActions,
  TRIAL_APPLICATION_STATUS_LABEL,
} from "./sections/TenantTrialApplicationsSection.ts";
import {
  __resetTenantTrialExtendForTest,
  closeTenantTrialExtendDialog,
  openTenantTrialExtendDialog,
  renderPlatformAuthFeedback,
  renderTenantTrialExtendDialog,
} from "./sections/TenantTrialExtensionSection.ts";
import {
  requestTenantOperationalStatus,
  tenantOperationalGate,
  tenantOperationalMethod,
  type TenantOperationalIntent,
} from "./tenant-operational-status.ts";
import type {
  PlatformTenantDetailVM,
  PlatformTenantDirectoryItemVM,
  PlatformTenantMetricVM,
  PlatformTenantTone,
} from "./view-model.ts";

let selectedObjectKey: string | null = null;
let selectedTenantSection: PlatformTenantDetailSectionId = "overview";
let tenantSearch = "";
let tenantStatusFilter = "all";
let tenantPlanFilter = "all";
let tenantSourceFilter = "all";
type TenantFocusMode = "all" | "formal" | "trial" | "application" | "pending" | "suspended_expired";
let tenantFocusMode: TenantFocusMode = "all";
let tenantCurrentPage = 1;
let tenantPageSize = 10;
let riskPolicySubtab: "risks" | "controls" = "risks";
type TenantLifecycleHost = {
  scopes: readonly string[] | null;
  connected: boolean;
  canManagePlatform: boolean;
  request: ((method: string, params: unknown) => Promise<unknown>) | null;
};
let tenantLifecycleHost: TenantLifecycleHost = {
  scopes: null,
  connected: false,
  canManagePlatform: false,
  request: null,
};
let tenantLifecycleNotice: string | null = null;
let tenantLifecycleBusy = false;
let tenantLifecycleDialog: { tenantId: string; intent: TenantOperationalIntent } | null = null;
let tenantLifecycleReason = "";

function requestRerender() {
  requestOpenBotAppRerender();
}

/**
 * 租户详情内的 section/hash 切换：只改 history + 强制重绘，不派发合成 popstate。
 * 否则 onPopState → refreshActiveTab → loadOverview 会把同页 Tab 切换打成全量刷新，
 * 表现为「概览等 Tab 点了没反应 / 弹层刚开就被刷掉」。
 */
function pushTenantLocalHistory(href: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.pushState({}, "", normalizeAppHistoryHref(href));
  requestOpenBotAppRerender();
}

function replaceTenantLocalHistory(href: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState({}, "", normalizeAppHistoryHref(href));
  requestOpenBotAppRerender();
}

function syncTenantSelectionFromLocation() {
  if (typeof window === "undefined") {
    return;
  }
  const selection = parseTenantSelectionHash(window.location.hash);
  selectedObjectKey = selection?.objectKey ?? null;
  selectedTenantSection = selection?.section ?? "overview";
  if (selection?.section === "controls") {
    riskPolicySubtab = "controls";
  } else if (selection?.section === "risks") {
    riskPolicySubtab = "risks";
  }
}

function setSelectedObject(
  objectKey: string | null,
  section: PlatformTenantDetailSectionId = "overview",
) {
  selectedObjectKey = objectKey;
  selectedTenantSection = section;
  if (section === "controls") {
    riskPolicySubtab = "controls";
  } else if (section === "risks") {
    riskPolicySubtab = "risks";
  }
}

function navigateTenantSection(
  objectKey: string,
  section: PlatformTenantDetailSectionId,
  basePath: string,
) {
  setSelectedObject(objectKey, section);
  pushTenantLocalHistory(platformTenantSectionHref(basePath, objectKey, section));
}

function closeTenantDetail(basePath: string) {
  setSelectedObject(null);
  replaceTenantLocalHistory(pathForTab("platformTenants", basePath));
}

function handleTenantSectionLink(
  event: MouseEvent,
  objectKey: string,
  section: PlatformTenantDetailSectionId,
  href: string,
) {
  event.stopPropagation();
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  setSelectedObject(objectKey, section);
  pushTenantLocalHistory(href);
}

/** @internal vitest reset */
export function __resetPlatformTenantsForTest() {
  selectedObjectKey = null;
  selectedTenantSection = "overview";
  tenantSearch = "";
  tenantStatusFilter = "all";
  tenantPlanFilter = "all";
  tenantSourceFilter = "all";
  tenantFocusMode = "all";
  tenantCurrentPage = 1;
  tenantPageSize = 10;
  riskPolicySubtab = "risks";
  tenantLifecycleHost = {
    scopes: null,
    connected: false,
    canManagePlatform: false,
    request: null,
  };
  tenantLifecycleNotice = null;
  tenantLifecycleBusy = false;
  tenantLifecycleDialog = null;
  tenantLifecycleReason = "";
  __resetTenantTrialExtendForTest();
  __resetTenantAdminContactForTest();
  __resetTenantSeatSettingsForTest();
}

function updateTenantSearch(value: string) {
  tenantSearch = value;
  tenantCurrentPage = 1;
  requestRerender();
}

function updateTenantStatusFilter(value: string) {
  tenantStatusFilter = value;
  tenantCurrentPage = 1;
  requestRerender();
}

function updateTenantPlanFilter(value: string) {
  tenantPlanFilter = value;
  tenantCurrentPage = 1;
  requestRerender();
}

function updateTenantSourceFilter(value: string) {
  tenantSourceFilter = value;
  tenantCurrentPage = 1;
  requestRerender();
}

function resetTenantFilters() {
  tenantSearch = "";
  tenantStatusFilter = "all";
  tenantPlanFilter = "all";
  tenantSourceFilter = "all";
  tenantFocusMode = "all";
  tenantCurrentPage = 1;
  requestRerender();
}

function setTenantPage(page: number) {
  tenantCurrentPage = Math.max(1, page);
  requestRerender();
}

function setTenantPageSize(size: number) {
  tenantPageSize = size;
  tenantCurrentPage = 1;
  requestRerender();
}

function paginateItems<T>(items: T[]): { paged: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / tenantPageSize));
  if (tenantCurrentPage > totalPages) {
    tenantCurrentPage = totalPages;
  }
  const start = (tenantCurrentPage - 1) * tenantPageSize;
  return { paged: items.slice(start, start + tenantPageSize), totalPages };
}

function focusDirectory(mode: TenantFocusMode) {
  tenantFocusMode = mode;
  tenantCurrentPage = 1;
  if (mode === "formal" || mode === "trial" || mode === "application" || mode === "pending") {
    tenantStatusFilter = "all";
  }
  const panel = document.querySelector(".platform-tenants__directory-panel");
  if (panel && typeof panel.scrollIntoView === "function") {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  requestRerender();
}

function overviewMetricMode(label: string): TenantFocusMode | null {
  if (label.includes("活跃租户")) {
    return "formal";
  }
  if (label.includes("试用转化") || label.includes("试用租户")) {
    return "trial";
  }
  if (label.includes("异常租户")) {
    return "pending";
  }
  return null;
}

function metricIconForLabel(label: string): IconName {
  if (label.includes("异常")) {
    return "alertTriangle";
  }
  if (label.includes("收入") || label.includes("成本")) {
    return "dollarSign";
  }
  if (label.includes("转化")) {
    return "trendingUp";
  }
  if (label.includes("席位")) {
    return "users";
  }
  if (label.includes("租户") || label.includes("申请")) {
    return "building";
  }
  if (label.includes("调用")) {
    return "activity";
  }
  if (label.includes("Agent") || label.includes("智能体")) {
    return "brain";
  }
  if (label.includes("协作组")) {
    return "users";
  }
  if (label.includes("Runtime") || label.includes("运行")) {
    return "server";
  }
  return "barChart";
}

function renderMetricGrid(items: PlatformTenantMetricVM[], classes = "") {
  return html`
    <div class="platform-tenants__metric-grid ${classes}">
      ${items.map(
        (item) => html`
          <section class="card platform-tenants__metric-card ${item.tone ?? "neutral"}">
            <span class="platform-tenants__metric-icon ${item.tone ?? ""}">
              ${renderIcon(metricIconForLabel(item.label), "platform-tenants__metric-icon-svg")}
            </span>
            <div class="platform-tenants__metric-content">
              <div class="platform-tenants__metric-label">${item.label}</div>
              <div class="platform-tenants__metric-value ${item.tone ?? ""}">${item.value}</div>
              ${item.meta ? html`<div class="platform-tenants__metric-meta">${item.meta}</div>` : nothing}
            </div>
          </section>
        `,
      )}
    </div>
  `;
}

function renderOverviewMetricGrid(items: PlatformTenantMetricVM[]) {
  return html`
    <div class="platform-tenants__metric-grid platform-tenants__metric-grid--overview">
      ${items.map((item) => {
        const mode = overviewMetricMode(item.label);
        const clickable = mode !== null;
        return html`
          <section
            class="card platform-tenants__metric-card ${item.tone ?? "neutral"} ${clickable ? "is-clickable" : ""}"
            ?data-active=${clickable && tenantFocusMode === mode}
            tabindex=${clickable ? "0" : nothing}
            @click=${clickable ? () => focusDirectory(mode) : nothing}
            @keydown=${
              clickable
                ? (event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }
                    event.preventDefault();
                    focusDirectory(mode);
                  }
                : nothing
            }
          >
            <span class="platform-tenants__metric-icon ${item.tone ?? ""}">
              ${renderIcon(metricIconForLabel(item.label), "platform-tenants__metric-icon-svg")}
            </span>
            <div class="platform-tenants__metric-content">
              <div class="platform-tenants__metric-label">${item.label}</div>
              <div class="platform-tenants__metric-value ${item.tone ?? ""}">${item.value}</div>
              ${item.meta ? html`<div class="platform-tenants__metric-meta">${item.meta}</div>` : nothing}
            </div>
          </section>
        `;
      })}
    </div>
  `;
}

function toneChipClass(tone: PlatformTenantTone) {
  if (tone === "ok") {
    return "chip chip-ok";
  }
  if (tone === "warn") {
    return "chip chip-warn";
  }
  if (tone === "danger") {
    return "chip chip-danger";
  }
  return "chip chip-neutral";
}

function filteredDirectoryItems(items: PlatformTenantDirectoryItemVM[]) {
  const search = tenantSearch.trim().toLowerCase();
  let filtered = items.filter((item) => {
    if (tenantFocusMode === "formal" && item.objectType !== "formal_tenant") {
      return false;
    }
    if (tenantFocusMode === "trial" && item.objectType !== "trial_tenant") {
      return false;
    }
    if (tenantFocusMode === "application" && item.objectType !== "trial_application") {
      return false;
    }
    if (tenantFocusMode === "pending" && !item.hasPendingAction) {
      return false;
    }
    if (
      tenantFocusMode === "suspended_expired" &&
      item.objectType !== "suspended" &&
      item.objectType !== "expired"
    ) {
      return false;
    }
    if (tenantStatusFilter === "trial" && item.status !== "trial") {
      return false;
    }
    if (tenantStatusFilter === "paid" && item.status !== "paid") {
      return false;
    }
    if (tenantStatusFilter === "suspended" && item.status !== "suspended") {
      return false;
    }
    if (tenantStatusFilter === "expired" && item.status !== "expired") {
      return false;
    }
    if (tenantPlanFilter !== "all" && item.planLabel !== tenantPlanFilter) {
      return false;
    }
    if (tenantSourceFilter !== "all" && item.sourceLabel !== tenantSourceFilter) {
      return false;
    }
    if (!search) {
      return true;
    }
    return [
      item.name,
      item.identityId,
      item.contactEmail,
      item.contactName,
      item.applicationId,
      item.tenantId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
  if (tenantFocusMode === "application") {
    filtered = filtered.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs);
  }
  return filtered;
}

function renderOverview(vm: ReturnType<typeof buildPlatformTenantsVM>) {
  return html`
    <section class="platform-tenants__kpi-section" aria-label="租户业务核心指标">
      ${renderOverviewMetricGrid(vm.overview.primary)}
    </section>
    <section class="platform-tenants__kpi-section" aria-label="平台资源与资产指标">
      ${renderMetricGrid(vm.overview.secondary, "platform-tenants__metric-grid--assets")}
    </section>
  `;
}

function renderTenantRow(item: PlatformTenantDirectoryItemVM, basePath: string) {
  const avatar = item.name.slice(0, 1).toUpperCase();
  const detailHref = platformTenantSectionHref(basePath, item.objectKey, "overview");
  return html`
    <tr
      class=${`platform-tenants__table-row ${selectedObjectKey === item.objectKey ? "is-selected" : ""}`}
      tabindex="0"
      @click=${() => navigateTenantSection(item.objectKey, "overview", basePath)}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        navigateTenantSection(item.objectKey, "overview", basePath);
      }}
    >
      <td>
        <div class="platform-tenants__table-tenant">
          <div class="platform-tenants__avatar">${avatar}</div>
          <div class="platform-tenants__tenant-body">
            <div class="platform-tenants__table-primary">${item.name}</div>
            <div class="platform-tenants__table-sub">${item.identityIdLabel} ${item.identityId}</div>
            ${
              item.contactEmail || item.contactName
                ? html`<div class="platform-tenants__table-sub">${item.contactName ? `${item.contactName} · ` : ""}${item.contactEmail ?? ""}</div>`
                : nothing
            }
            ${
              item.isCurrent
                ? html`
                    <div class="platform-tenants__tenant-meta">
                      <span class="platform-tenants__tenant-current">当前租户</span>
                    </div>
                  `
                : nothing
            }
            ${
              item.linkedApplicationId && !item.isApplication
                ? html`<div class="platform-tenants__table-sub">关联申请 ${item.linkedApplicationId}</div>`
                : nothing
            }
          </div>
        </div>
      </td>
      <td>
        <div class="platform-tenants__status-block">
          <div class="platform-tenants__status-chip-row">
            <span class=${toneChipClass(item.lifecycleTone)}>${item.objectTypeLabel}</span>
            <span class=${toneChipClass(item.stageTone)}>${item.stageLabel}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="platform-tenants__status-block">
          <div class="platform-tenants__table-primary">${item.usageSummaryLabel}</div>
          <div class="platform-tenants__table-sub">${item.usageSummaryMeta}</div>
        </div>
      </td>
      <td>
        <div class="platform-tenants__status-block">
          <div class="platform-tenants__status-chip-row">
            <span class=${toneChipClass(item.healthTone)}>${item.healthLabel}</span>
          </div>
          ${
            item.incidentLabel &&
            item.incidentLabel !== "无事件" &&
            item.incidentLabel !== "无运行数据"
              ? html`<div class="platform-tenants__table-sub">${item.incidentLabel}</div>`
              : nothing
          }
        </div>
      </td>
      <td>
        <div class="platform-tenants__status-block">
          <div class="platform-tenants__status-chip-row">
            <span class=${toneChipClass(item.riskTone)}>${item.riskLevelLabel}</span>
          </div>
          <div class="platform-tenants__table-sub ${item.riskTone}">${item.pendingTodoLabel}</div>
        </div>
      </td>
      <td>
        <div class="platform-tenants__table-primary">${item.updatedAtLabel}</div>
      </td>
      <td>
        <div class="platform-tenants__table-actions">
          <a
            class="btn btn--sm"
            href=${detailHref}
            title=${`查看详情 — ${item.name}`}
            aria-label=${`查看详情 — ${item.name}`}
            @click=${(event: MouseEvent) =>
              handleTenantSectionLink(event, item.objectKey, "overview", detailHref)}
          >
            查看详情
          </a>
        </div>
      </td>
    </tr>
  `;
}

function countByFocus(items: PlatformTenantDirectoryItemVM[], mode: TenantFocusMode) {
  if (mode === "all") {
    return items.length;
  }
  if (mode === "formal") {
    return items.filter((item) => item.objectType === "formal_tenant").length;
  }
  if (mode === "trial") {
    return items.filter((item) => item.objectType === "trial_tenant").length;
  }
  if (mode === "application") {
    return items.filter((item) => item.objectType === "trial_application").length;
  }
  if (mode === "pending") {
    return items.filter((item) => item.hasPendingAction).length;
  }
  return items.filter((item) => item.objectType === "suspended" || item.objectType === "expired")
    .length;
}

function renderDirectoryTabs(items: PlatformTenantDirectoryItemVM[]) {
  const tabs: Array<{ mode: TenantFocusMode; label: string }> = [
    { mode: "all", label: "全部" },
    { mode: "formal", label: "正式租户" },
    { mode: "trial", label: "试用租户" },
    { mode: "application", label: "试用申请" },
    { mode: "pending", label: "待处理" },
    { mode: "suspended_expired", label: "已暂停/到期" },
  ];
  return html`
    <div class="platform-tenants__segment-tabs" role="tablist" aria-label="租户管理视图">
      ${tabs.map(
        (tab) => html`
          <button
            class="platform-tenants__segment-tab ${tenantFocusMode === tab.mode ? "is-active" : ""}"
            type="button"
            role="tab"
            aria-selected=${tenantFocusMode === tab.mode ? "true" : "false"}
            @click=${() => focusDirectory(tab.mode)}
          >
            <span>${tab.label}</span>
            <strong>${countByFocus(items, tab.mode)}</strong>
          </button>
        `,
      )}
    </div>
  `;
}

function renderPendingBanner(vm: ReturnType<typeof buildPlatformTenantsVM>) {
  const count = vm.directory.pendingApplicationCount;
  if (count <= 0) {
    return nothing;
  }
  return html`
    <div class="platform-tenants__todo-banner" role="status">
      <div>
        <strong>${count} 个试用申请待处理</strong>
        <span class="platform-tenants__table-sub">点击后过滤统一列表，不打开独立审批面板。</span>
      </div>
      <button class="btn btn--sm" type="button" @click=${() => focusDirectory("application")}>
        筛选试用申请
      </button>
    </div>
  `;
}

function renderDirectory(
  vm: ReturnType<typeof buildPlatformTenantsVM>,
  props: PlatformSurfaceProps,
) {
  const items = filteredDirectoryItems(vm.directory.items);
  const page = paginateItems(items);
  const planOptions = Array.from(
    new Set(
      vm.directory.items
        .filter((item) => !item.isApplication)
        .map((item) => item.planLabel)
        .filter((label) => label && label !== "尚未开通"),
    ),
  );
  const sourceOptions = Array.from(
    new Set(vm.directory.items.map((item) => item.sourceLabel).filter(Boolean)),
  );
  return html`
    <section class="card platform-tenants__directory-panel">
      <div class="platform-tenants__panel-header">
        <div class="platform-tenants__title-row"><div class="card-title">租户目录</div></div>
        <div class="platform-tenants__panel-actions">
          <a
            class="btn btn--primary"
            href=${platformCreateTenantHref(props.basePath)}
            @click=${(event: MouseEvent) => navigateToFullCreate(event, props.basePath)}
          >创建租户</a>
        </div>
      </div>
      ${renderPendingBanner(vm)}
      <div class="platform-tenants__filterbar">
        <div class="platform-tenants__filterbar-tabs">${renderDirectoryTabs(vm.directory.items)}</div>
        <div class="platform-tenants__filterbar-controls">
          <label class="platform-tenants__search">
            <input
              type="search"
              placeholder="搜索名称 / 租户 ID / 申请编号 / 邮箱"
              .value=${tenantSearch}
              @input=${(event: Event) => updateTenantSearch((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="platform-tenants__select">
            <select title="状态筛选" .value=${tenantStatusFilter} @change=${(event: Event) => updateTenantStatusFilter((event.currentTarget as HTMLSelectElement).value)}>
              <option value="all">全部状态</option>
              <option value="trial">试用</option>
              <option value="paid">正式</option>
              <option value="suspended">暂停</option>
              <option value="expired">到期</option>
            </select>
          </label>
          <label class="platform-tenants__select">
            <select title="套餐筛选" .value=${tenantPlanFilter} @change=${(event: Event) => updateTenantPlanFilter((event.currentTarget as HTMLSelectElement).value)}>
              <option value="all">全部套餐</option>
              ${planOptions.map((plan) => html`<option value=${plan}>${plan}</option>`)}
            </select>
          </label>
          <label class="platform-tenants__select">
            <select title="来源筛选" .value=${tenantSourceFilter} @change=${(event: Event) => updateTenantSourceFilter((event.currentTarget as HTMLSelectElement).value)}>
              <option value="all">全部来源</option>
              ${sourceOptions.map((source) => html`<option value=${source}>${source}</option>`)}
            </select>
          </label>
          ${
            tenantFocusMode !== "all" ||
            tenantStatusFilter !== "all" ||
            tenantPlanFilter !== "all" ||
            tenantSourceFilter !== "all" ||
            tenantSearch.trim()
              ? html`<button class="btn btn--sm platform-tenants__filterbar-reset" type="button" @click=${() => resetTenantFilters()}>清除筛选</button>`
              : nothing
          }
        </div>
      </div>
      ${
        items.length > 0
          ? html`
              <div class="platform-tenants__table-wrap">
                <table class="platform-tenants__table">
                  <thead>
                    <tr>
                      <th>租户 / 申请</th>
                      <th>类型与阶段</th>
                      <th>使用情况</th>
                      <th>运行状态</th>
                      <th>风险与待办</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${page.paged.map((item) => renderTenantRow(item, props.basePath))}
                  </tbody>
                </table>
              </div>
              <div class="platform-tenants__table-footer">
                <div class="platform-tenants__table-footer-total">共 ${items.length} 条</div>
                <div class="platform-tenants__table-pagination">
                  <button class="btn btn--sm platform-tenants__page-btn" type="button" ?disabled=${tenantCurrentPage <= 1} @click=${() => setTenantPage(tenantCurrentPage - 1)}>‹</button>
                  <span class="platform-tenants__page-indicator">${tenantCurrentPage} / ${page.totalPages}</span>
                  <button class="btn btn--sm platform-tenants__page-btn" type="button" ?disabled=${tenantCurrentPage >= page.totalPages} @click=${() => setTenantPage(tenantCurrentPage + 1)}>›</button>
                  <select class="btn btn--sm platform-tenants__page-size" title="每页条数" .value=${String(tenantPageSize)} @change=${(event: Event) => setTenantPageSize(Number((event.currentTarget as HTMLSelectElement).value))}>
                    <option value="10">10 条/页</option>
                    <option value="20">20 条/页</option>
                    <option value="50">50 条/页</option>
                  </select>
                </div>
              </div>
            `
          : html`
              <section class="platform-tenants__empty">
                <div class="card-title">${vm.directory.emptyTitle}</div>
                <div class="card-sub">${vm.directory.emptyDescription}</div>
              </section>
            `
      }
    </section>
  `;
}

type TenantDetailAction = PlatformTenantDetailVM["actions"][number];

function detailActionClass(action: TenantDetailAction, compact = false) {
  const toneClass =
    action.kind === "primary" ? "primary" : action.kind === "danger" ? "danger" : "";
  return `btn ${compact ? "btn--sm" : ""} ${toneClass} platform-tenants__detail-action`;
}

function renderDetailAction(
  action: TenantDetailAction,
  detail: PlatformTenantDetailVM,
  basePath: string,
  compact = false,
) {
  const sectionHref =
    action.section && detail.objectKey
      ? platformTenantSectionHref(basePath, detail.objectKey, action.section)
      : null;
  const href = sectionHref ?? action.href;
  const label = action.label;
  return href
    ? html`
        <a
          class=${detailActionClass(action, compact)}
          href=${href}
          title=${label}
          aria-label=${label}
          @click=${(event: MouseEvent) =>
            action.section
              ? handleTenantSectionLink(event, detail.objectKey, action.section, href)
              : followPortHref(event, href)}
        >
          ${label}
        </a>
      `
    : nothing;
}

function renderTenantLifecycleButtons(detail: PlatformTenantDetailVM) {
  const gate = tenantOperationalGate({
    scopes: tenantLifecycleHost.scopes,
    clientConnected: tenantLifecycleHost.connected && tenantLifecycleHost.request !== null,
    canManagePlatform: tenantLifecycleHost.canManagePlatform,
  });
  const disabled = !gate.allowed || tenantLifecycleBusy || !detail.tenantId;
  const title = !detail.tenantId
    ? "缺少 tenantId"
    : gate.allowed
      ? "确认原因后调用平台租户状态方法。不会排空正在运行的机器人。"
      : gate.reason;
  return html`
    ${
      tenantLifecycleNotice
        ? html`<p class="muted" role="status" data-testid="tenant-lifecycle-notice">
            ${tenantLifecycleNotice}
          </p>`
        : nothing
    }
    <button
      class="btn btn--sm danger"
      type="button"
      data-testid="tenant-pause"
      ?disabled=${disabled}
      title=${title}
      @click=${() => openTenantLifecycleDialog(detail, "suspended")}
    >
      暂停
    </button>
    <button
      class="btn btn--sm"
      type="button"
      data-testid="tenant-resume"
      ?disabled=${disabled}
      title=${title}
      @click=${() => openTenantLifecycleDialog(detail, "active")}
    >
      恢复
    </button>
  `;
}

function openTenantLifecycleDialog(
  detail: PlatformTenantDetailVM,
  intent: TenantOperationalIntent,
) {
  if (!detail.tenantId || tenantLifecycleBusy) {
    return;
  }
  tenantLifecycleDialog = { tenantId: detail.tenantId, intent };
  tenantLifecycleReason = "";
  requestRerender();
}

function renderTenantLifecycleDialog() {
  const dialog = tenantLifecycleDialog;
  if (!dialog) {
    return nothing;
  }
  const method = tenantOperationalMethod(dialog.intent);
  const verb = dialog.intent === "suspended" ? "暂停" : "恢复";
  return html`
    <div class="platform-tenants__detail-panel" data-testid="tenant-lifecycle-dialog" role="dialog">
      <div class="platform-tenants__detail-section-title">${verb}租户</div>
      <p class="muted">
        将调用 ${method}。原因会写入审计。返回的 status 必须是 ${dialog.intent} 才记为成功。不会排空正在运行的机器人。
      </p>
      <label>
        原因
        <textarea
          data-testid="tenant-lifecycle-reason"
          .value=${tenantLifecycleReason}
          @input=${(event: Event) => {
            tenantLifecycleReason = (event.target as HTMLTextAreaElement).value;
          }}
        ></textarea>
      </label>
      <div>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="tenant-lifecycle-cancel"
          @click=${() => {
            tenantLifecycleDialog = null;
            tenantLifecycleReason = "";
            requestRerender();
          }}
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn--sm danger"
          data-testid="tenant-lifecycle-confirm"
          ?disabled=${tenantLifecycleBusy}
          @click=${() => void confirmTenantLifecycle()}
        >
          确认${verb}
        </button>
      </div>
    </div>
  `;
}

async function confirmTenantLifecycle(): Promise<void> {
  const dialog = tenantLifecycleDialog;
  const reason = tenantLifecycleReason.trim();
  if (!dialog) {
    return;
  }
  if (!reason) {
    tenantLifecycleNotice = "请填写原因";
    requestRerender();
    return;
  }
  const request = tenantLifecycleHost.request;
  if (!request) {
    tenantLifecycleNotice = "网关未连接，暂停与恢复当前不可执行";
    requestRerender();
    return;
  }
  tenantLifecycleBusy = true;
  tenantLifecycleNotice = null;
  requestRerender();
  const result = await requestTenantOperationalStatus(request, {
    tenantId: dialog.tenantId,
    reason,
    intent: dialog.intent,
  });
  tenantLifecycleBusy = false;
  if (!result.ok) {
    tenantLifecycleNotice = result.error;
    requestRerender();
    return;
  }
  tenantLifecycleDialog = null;
  tenantLifecycleReason = "";
  tenantLifecycleNotice = `租户 ${result.tenantId} 状态已记为 ${result.status}（之前为 ${result.previousStatus}）。未排空正在运行的机器人。`;
  requestRerender();
}

function canExtendTrial(detail: PlatformTenantDetailVM) {
  return Boolean(
    detail.tenantId &&
    !detail.isApplication &&
    (detail.trialEndsLabel ||
      detail.billingStatus.includes("试用") ||
      detail.statusLabel.includes("试用") ||
      detail.statusLabel.includes("到期") ||
      detail.commercialStatusLabel.includes("试用") ||
      detail.commercialStatusLabel.includes("到期")),
  );
}

function canEditTrialSeats(detail: PlatformTenantDetailVM) {
  return Boolean(
    detail.tenantId &&
    !detail.isApplication &&
    (detail.trialEndsLabel ||
      detail.billingStatus.includes("试用") ||
      detail.statusLabel.includes("试用") ||
      detail.planLabel.includes("试用") ||
      detail.commercialStatusLabel.includes("试用")),
  );
}

function openExtendTrialForDetail(
  detail: PlatformTenantDetailVM,
  authPanelProps?: PlatformAuthPanelProps | null,
) {
  if (!detail.tenantId) {
    return;
  }
  const enterprise = authPanelProps?.state?.platformEnterprises?.find(
    (item) => item.id === detail.tenantId,
  );
  openTenantTrialExtendDialog({
    enterpriseId: detail.tenantId,
    tenantName: detail.name,
    trialEndsLabel: detail.trialEndsLabel,
    seatQuota: enterprise?.seatQuota,
  });
}

function openAdminContactForDetail(detail: PlatformTenantDetailVM) {
  if (!detail.tenantId) {
    return;
  }
  openTenantAdminContactDialog({
    enterpriseId: detail.tenantId,
    tenantName: detail.name,
    contactName: detail.contactName,
    contactEmail: detail.contactEmail,
    adminActivationStatus: detail.adminActivationStatus,
  });
}

function openSeatSettingsForDetail(
  detail: PlatformTenantDetailVM,
  authPanelProps?: PlatformAuthPanelProps | null,
) {
  if (!detail.tenantId) {
    return;
  }
  const enterprise = authPanelProps?.state?.platformEnterprises?.find(
    (item) => item.id === detail.tenantId,
  );
  openTenantSeatSettingsDialog({
    enterpriseId: detail.tenantId,
    tenantName: detail.name,
    seatQuota: enterprise?.seatQuota ?? detail.seatQuota ?? 5,
    seatUsed: enterprise?.seatUsed ?? detail.seatUsed ?? 0,
  });
}

/** 申请/租户详情顶栏待办条；缺失会导致试用申请详情渲染抛错、列表点击无反应。 */
function renderPendingBlock(
  detail: PlatformTenantDetailVM,
  basePath: string,
  _authPanelProps?: PlatformAuthPanelProps | null,
) {
  if (detail.pendingItems.length === 0) {
    return nothing;
  }
  return html`
    <section
      class="platform-tenants__pending-block platform-tenants__pending-block--flat"
      aria-label="需要处理"
    >
      ${detail.pendingItems.map(
        (item) => html`
          <div class="platform-tenants__pending-item ${item.tone === "danger" ? "is-danger" : ""}">
            <div class="platform-tenants__pending-item-main">
              <div class="platform-tenants__pending-title-row">
                <strong>${item.title}</strong>
                <span class=${toneChipClass(item.tone)}>${item.statusLabel}</span>
                ${
                  item.timeLabel
                    ? html`<span class="platform-tenants__table-sub">${item.timeLabel}</span>`
                    : nothing
                }
              </div>
              <div class="platform-tenants__table-sub">${item.reason}</div>
            </div>
            ${
              // 申请详情页顶栏已有批准/拒绝；同页 overview 自链无意义。
              detail.isApplication || (!item.href && !item.section)
                ? nothing
                : html`
                    <a
                      class="btn btn--sm"
                      href=${
                        item.href ??
                        platformTenantSectionHref(basePath, detail.objectKey, item.section)
                      }
                      @click=${(event: MouseEvent) => {
                        const href =
                          item.href ??
                          platformTenantSectionHref(basePath, detail.objectKey, item.section);
                        if (item.section) {
                          handleTenantSectionLink(event, detail.objectKey, item.section, href);
                        } else {
                          followPortHref(event, href);
                        }
                      }}
                    >
                      ${item.actionLabel}
                    </a>
                  `
            }
          </div>
        `,
      )}
    </section>
  `;
}

function detailSectionActions(
  section: PlatformTenantDetailSectionId,
  detail: PlatformTenantDetailVM,
  basePath: string,
): TenantDetailAction[] {
  if (detail.isApplication) {
    return [];
  }
  const advancedHref = pathForTab("platformAdvanced", basePath);
  switch (section) {
    case "overview":
    case "usage":
    case "agents":
    case "runtime":
    case "billing":
    case "logs":
      // 分区切换靠 Tab；延期/计费入口收敛页头，避免与 Tab 重复的「查看风险/配置策略」等旁路按钮。
      return [];
    case "risks":
    case "controls":
      return [{ label: "高级控制", href: advancedHref, externalSettings: true }];
  }
}

function renderIdentityStack(
  detail: PlatformTenantDetailVM,
  options?: { onExtendTrial?: () => void; onEditAdmin?: () => void; onEditSeats?: () => void },
) {
  return html`
    <dl class="platform-tenants__detail-stack">
      ${detail.identityFields.map((field) => {
        const isTrialEnd = field.label.includes("试用截止");
        const isAdmin = field.label === "管理员";
        const isSeats = field.label === "席位";
        const showExtend = Boolean(isTrialEnd && options?.onExtendTrial);
        const showAdminEdit = Boolean(isAdmin && options?.onEditAdmin);
        const showSeatSettings = Boolean(isSeats && options?.onEditSeats);
        return html`
          <div class="platform-tenants__detail-stack-row">
            <dt>${field.label}</dt>
            <dd>
              <div class="platform-tenants__detail-stack-value">
                <span
                  class="${field.tone ? `is-${field.tone}` : ""} ${
                    field.label.includes("ID") ? "mono" : ""
                  }"
                >
                  ${field.value}
                </span>
                ${
                  showExtend
                    ? html`
                        <button
                          type="button"
                          class="platform-tenants__inline-action"
                          data-testid="tenant-extend-trial"
                          @click=${options!.onExtendTrial}
                        >
                          延长试用
                        </button>
                      `
                    : nothing
                }
                ${
                  showAdminEdit
                    ? html`
                        <button
                          type="button"
                          class="platform-tenants__inline-action"
                          data-testid="tenant-edit-admin"
                          @click=${options!.onEditAdmin}
                        >
                          ${
                            detail.adminActivationStatus === "missing" ? "添加管理员" : "编辑管理员"
                          }
                        </button>
                      `
                    : nothing
                }
                ${
                  showSeatSettings
                    ? html`
                        <button
                          type="button"
                          class="platform-tenants__inline-action"
                          data-testid="tenant-seat-settings"
                          @click=${options!.onEditSeats}
                        >
                          席位设置
                        </button>
                      `
                    : nothing
                }
              </div>
              ${
                field.meta
                  ? html`<span class="platform-tenants__detail-stack-meta">${field.meta}</span>`
                  : nothing
              }
            </dd>
          </div>
        `;
      })}
    </dl>
  `;
}

function renderDetailMetricStack(items: PlatformTenantMetricVM[]) {
  if (items.length === 0) {
    return html`
      <div class="muted">该分区暂无数据。</div>
    `;
  }
  return html`
    <dl class="platform-tenants__detail-stack platform-tenants__detail-stack--metrics">
      ${items.map(
        (item) => html`
          <div class="platform-tenants__detail-stack-row">
            <dt>${item.label}</dt>
            <dd>
              <span class=${item.tone ? `is-${item.tone}` : ""}>${item.value}</span>
              ${item.meta ? html`<span class="platform-tenants__detail-stack-meta">${item.meta}</span>` : nothing}
            </dd>
          </div>
        `,
      )}
    </dl>
  `;
}

function renderDetailWorkspaceSection(
  detail: PlatformTenantDetailVM,
  basePath: string,
  section: PlatformTenantDetailSectionId,
) {
  const primarySection = section === "controls" ? "risks" : normalizeTenantDetailSection(section);
  const actions = detailSectionActions(section, detail, basePath);
  const metrics =
    primarySection === "usage"
      ? [...detail.metrics.usage, ...detail.metrics.agents, ...detail.metrics.runtime]
      : primarySection === "risks"
        ? riskPolicySubtab === "controls"
          ? detail.metrics.controls
          : detail.metrics.risks
        : detail.metrics[primarySection];
  return html`
    <section class="platform-tenants__detail-workspace platform-tenants__detail-workspace--flat">
      <div class="platform-tenants__detail-tabs platform-tenants__detail-tabs--line" role="tablist" aria-label="租户详情分区">
        ${PLATFORM_TENANT_PRIMARY_SECTIONS.map(([id, label]) => {
          const active =
            primarySection === id ||
            (id === "risks" && (section === "risks" || section === "controls"));
          return html`
            <button
              type="button"
              class="platform-tenants__detail-tab ${active ? "is-active" : ""}"
              role="tab"
              aria-selected=${active ? "true" : "false"}
              data-testid=${`tenant-detail-tab-${id}`}
              @click=${() => navigateTenantSection(detail.objectKey, id, basePath)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
      ${
        primarySection === "risks"
          ? html`
              <div
                class="platform-tenants__detail-subtabs platform-tenants__detail-tabs--line"
                role="tablist"
                aria-label="风险与策略"
              >
                <button
                  type="button"
                  class="platform-tenants__detail-tab ${riskPolicySubtab === "risks" ? "is-active" : ""}"
                  data-testid="tenant-detail-subtab-risks"
                  @click=${() => {
                    riskPolicySubtab = "risks";
                    navigateTenantSection(detail.objectKey, "risks", basePath);
                  }}
                >风险</button>
                <button
                  type="button"
                  class="platform-tenants__detail-tab ${riskPolicySubtab === "controls" ? "is-active" : ""}"
                  data-testid="tenant-detail-subtab-controls"
                  @click=${() => {
                    riskPolicySubtab = "controls";
                    navigateTenantSection(detail.objectKey, "controls", basePath);
                  }}
                >策略</button>
              </div>
            `
          : nothing
      }
      ${
        actions.length > 0
          ? html`
              <div class="platform-tenants__detail-section-heading">
                <div class="platform-tenants__detail-section-actions">
                  ${actions.map((action) => renderDetailAction(action, detail, basePath, true))}
                  ${
                    primarySection === "risks"
                      ? html`
                          ${renderTenantLifecycleButtons(detail)}
                        `
                      : nothing
                  }
                </div>
              </div>
            `
          : nothing
      }
      ${renderDetailMetricStack(metrics)}
    </section>
  `;
}

function renderApplicationDetailPage(
  detail: PlatformTenantDetailVM,
  basePath: string,
  actions: PlatformPortTenantsActions,
  authPanelProps?: PlatformAuthPanelProps | null,
) {
  const app = detail.applicationSummary;
  const canManagePlatform = Boolean(authPanelProps?.state?.canManagePlatform);
  return html`
    <section class="platform-tenants platform-tenants__detail-page platform-tenants__detail-page--flat">
      <header class="platform-tenants__detail-page-header">
        <nav class="platform-tenants__detail-crumb" aria-label="面包屑">
          <button type="button" class="btn btn--sm btn--ghost" @click=${() => closeTenantDetail(basePath)}>
            ← 租户管理
          </button>
          <span class="platform-tenants__detail-crumb-sep">/</span>
          <span>${detail.name}</span>
        </nav>
        <div class="platform-tenants__detail-identity-head">
          <div class="platform-tenants__detail-page-headline">
            <div class="platform-tenants__detail-kicker">试用申请</div>
            <h2 class="platform-tenants__detail-page-title">${detail.name}</h2>
            <div class="platform-tenants__detail-status-row">
              <span class=${toneChipClass(detail.riskTone)}>${detail.statusLabel}</span>
              ${app ? html`<span class="chip">${TRIAL_APPLICATION_STATUS_LABEL[app.status]}</span>` : nothing}
            </div>
          </div>
          ${
            app
              ? renderTrialApplicationDetailActions({
                  application: app,
                  actions,
                  canManagePlatform,
                  busy: authPanelProps?.busy,
                })
              : nothing
          }
        </div>
      </header>
      <div class="platform-tenants__detail-page-body">
        ${renderPlatformAuthFeedback({
          error: authPanelProps?.error,
          notice: authPanelProps?.notice,
          busy: authPanelProps?.busy,
        })}
        ${renderPendingBlock(detail, basePath, authPanelProps)}
        <section class="platform-tenants__detail-panel">
          <div class="platform-tenants__detail-section-title">申请信息</div>
          ${renderIdentityStack(detail)}
        </section>
        ${
          app
            ? html`
                <section class="platform-tenants__detail-panel">
                  <div class="platform-tenants__detail-section-title">处理记录</div>
                  <dl class="platform-tenants__detail-stack">
                    <div class="platform-tenants__detail-stack-row">
                      <dt>触发原因</dt>
                      <dd>${formatTrialReviewReasons(app.reviewReasons)}</dd>
                    </div>
                    <div class="platform-tenants__detail-stack-row">
                      <dt>提交时间</dt>
                      <dd>${formatTrialApplicationDateTime(app.createdAt)}</dd>
                    </div>
                    ${
                      app.reviewedAt
                        ? html`<div class="platform-tenants__detail-stack-row">
                            <dt>处理时间</dt>
                            <dd>${formatTrialApplicationDateTime(app.reviewedAt)}</dd>
                          </div>`
                        : nothing
                    }
                    ${
                      app.reviewedBy
                        ? html`<div class="platform-tenants__detail-stack-row">
                            <dt>处理人</dt>
                            <dd>${app.reviewedBy}</dd>
                          </div>`
                        : nothing
                    }
                    ${
                      app.reviewNote
                        ? html`<div class="platform-tenants__detail-stack-row">
                            <dt>备注</dt>
                            <dd>${app.reviewNote}</dd>
                          </div>`
                        : nothing
                    }
                    ${
                      app.rejectionReason
                        ? html`<div class="platform-tenants__detail-stack-row">
                            <dt>拒绝原因</dt>
                            <dd>${app.rejectionReason}</dd>
                          </div>`
                        : nothing
                    }
                    ${
                      app.enterpriseId
                        ? html`<div class="platform-tenants__detail-stack-row">
                            <dt>关联租户</dt>
                            <dd><span class="mono">${app.enterpriseId}</span></dd>
                          </div>`
                        : nothing
                    }
                  </dl>
                </section>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

function renderTenantDetailPage(
  vm: ReturnType<typeof buildPlatformTenantsVM>,
  basePath: string,
  actions: PlatformPortTenantsActions,
  authPanelProps?: PlatformAuthPanelProps | null,
) {
  const detail = vm.detail.items[0] ?? null;
  if (!detail || !selectedObjectKey) {
    return nothing;
  }
  if (detail.isApplication) {
    return renderApplicationDetailPage(detail, basePath, actions, authPanelProps);
  }
  const extendable = canExtendTrial(detail);
  return html`
    <section
      class="platform-tenants platform-tenants__detail-page platform-tenants__detail-page--flat platform-tenants__detail-page--composed"
    >
      <header class="platform-tenants__detail-page-header">
        <nav class="platform-tenants__detail-crumb" aria-label="面包屑">
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            @click=${() => {
              closeTenantTrialExtendDialog();
              closeTenantAdminContactDialog();
              closeTenantSeatSettingsDialog();
              closeTenantDetail(basePath);
            }}
          >
            ← 租户管理
          </button>
          <span class="platform-tenants__detail-crumb-sep">/</span>
          <span>${detail.name}</span>
        </nav>
        <div class="platform-tenants__detail-identity-head">
          <div class="platform-tenants__detail-page-headline">
            <h2 class="platform-tenants__detail-page-title">${detail.name}</h2>
            <div class="platform-tenants__detail-status-row">
              <span class=${toneChipClass(detail.riskTone)}>${detail.commercialStatusLabel}</span>
              <span class=${toneChipClass(detail.runtimeHealthTone)}>${detail.runtimeHealthLabel}</span>
              <span class=${toneChipClass(detail.riskTone)}>风险 ${detail.riskLevelLabel}</span>
            </div>
          </div>
        </div>
      </header>
      <div class="platform-tenants__detail-page-body">
        ${renderPlatformAuthFeedback({
          error: authPanelProps?.error,
          notice: authPanelProps?.notice,
          busy: authPanelProps?.busy,
        })}
        <div class="platform-tenants__detail-board" data-testid="tenant-detail-split">
          <aside class="platform-tenants__detail-panel platform-tenants__detail-panel--identity">
            <div class="platform-tenants__detail-section-title">基本信息</div>
            ${renderIdentityStack(detail, {
              ...(extendable
                ? {
                    onExtendTrial: () => openExtendTrialForDetail(detail, authPanelProps),
                  }
                : {}),
              ...(detail.tenantId && authPanelProps?.state?.canManagePlatform
                ? { onEditAdmin: () => openAdminContactForDetail(detail) }
                : {}),
              ...(canEditTrialSeats(detail) && authPanelProps?.state?.canManagePlatform
                ? { onEditSeats: () => openSeatSettingsForDetail(detail, authPanelProps) }
                : {}),
            })}
          </aside>
          ${renderDetailWorkspaceSection(detail, basePath, selectedTenantSection)}
        </div>
      </div>
      ${renderTenantLifecycleDialog()}
      ${renderTenantTrialExtendDialog({ authPanelProps, actions })}
      ${renderTenantAdminContactDialog({ authPanelProps, actions })}
      ${renderTenantSeatSettingsDialog({ authPanelProps, actions })}
    </section>
  `;
}

export const PLATFORM_TENANT_FULL_CREATE_HASH = "#create-formal-advanced";
const PLATFORM_TENANT_LEGACY_CREATE_DRAWER_HASH = "#open-create-tenant";

export function platformTenantFullCreateHref(basePath: string) {
  return `${pathForTab("platformTenants", basePath)}${PLATFORM_TENANT_FULL_CREATE_HASH}`;
}

function isFullCreateRouteActive(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.location.hash === PLATFORM_TENANT_LEGACY_CREATE_DRAWER_HASH) {
    const { pathname, search } = window.location;
    replaceAppHistoryState(`${pathname}${search}${PLATFORM_TENANT_FULL_CREATE_HASH}`);
    return true;
  }
  return window.location.hash === PLATFORM_TENANT_FULL_CREATE_HASH;
}

function navigateToFullCreate(event: MouseEvent | undefined, basePath: string) {
  if (event) {
    event.preventDefault();
  }
  closePlatformCreateTenantDrawer();
  pushAppHistoryState(platformTenantFullCreateHref(basePath));
}

function navigateBackToTenantsList(basePath: string) {
  pushAppHistoryState(pathForTab("platformTenants", basePath));
}

function renderFullCreatePage(props: PlatformSurfaceProps) {
  const createSuccess = Boolean(resolvePlatformCreateTenantInviteCode(props.authPanelProps));
  return html`
    <section class="platform-tenant-full-create ${createSuccess ? "platform-tenant-full-create--success" : ""}">
      ${
        createSuccess
          ? nothing
          : html`
              <header class="platform-tenant-full-create__header">
                <div>
                  <button class="btn btn--sm" type="button" @click=${() => navigateBackToTenantsList(props.basePath)}>
                    ← 返回租户管理
                  </button>
                </div>
                <div class="platform-tenant-full-create__head-copy">
                  <h2 class="platform-tenant-full-create__title">创建租户 · 完整模式</h2>
                </div>
              </header>
            `
      }
      <div class="platform-tenant-full-create__body">${renderPlatformCreateTenantWorkspace(props)}</div>
    </section>
  `;
}

export function renderPlatformTenantsSurface(props: PlatformSurfaceProps) {
  const client = props.client ?? null;
  tenantLifecycleHost = {
    scopes: props.scopes ?? null,
    connected: Boolean(client?.connected),
    canManagePlatform: Boolean(props.authPanelProps?.state?.canManagePlatform),
    request: client ? (method, params) => client.request(method, params) : null,
  };
  if (isFullCreateRouteActive()) {
    return renderFullCreatePage(props);
  }
  syncTenantSelectionFromLocation();
  const trialApplications = props.authPanelProps?.state?.trialApplications ?? [];
  const pendingAdminActivations = props.authPanelProps?.state?.pendingAdminActivations ?? [];
  if (selectedObjectKey) {
    const detailVm = buildPlatformTenantsVM(
      {
        readModel: props.readModel,
        basePath: props.basePath,
        trialApplications,
        pendingAdminActivations,
      },
      selectedObjectKey,
      { detailOnly: true },
    );
    if (detailVm.detail.items[0]) {
      return renderTenantDetailPage(
        detailVm,
        props.basePath,
        props.actions.tenants,
        props.authPanelProps,
      );
    }
  }
  const vm = buildPlatformTenantsVM(
    {
      readModel: props.readModel,
      basePath: props.basePath,
      trialApplications,
      pendingAdminActivations,
    },
    null,
  );
  return html`
    <div class="platform-tenants">
      ${renderOverview(vm)}
      <div class="platform-tenants__shell">
        <div class="platform-tenants__main">${renderDirectory(vm, props)}</div>
      </div>
    </div>
  `;
}

void PLATFORM_TENANTS_HASH_PREFIX;
void isTenantDetailSection;
