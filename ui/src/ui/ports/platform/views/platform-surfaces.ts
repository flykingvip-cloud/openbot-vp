import { html, nothing } from "lit";
import { renderIcon } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { renderObservationWorkbench } from "../../../observation/workbench.ts";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import { renderPlatformAdvancedSurface } from "../advanced/page.ts";
import { renderPlatformAgentsSurface } from "../agents/page.ts";
import { renderPlatformCapabilitiesSurface } from "../capabilities/page.ts";
import { renderPlatformDashboardSurface } from "../dashboard/page.ts";
import { resolvePlatformDomainAccess } from "../domain-access.ts";
import "../diagnosis/platform-diagnosis-page.ts";
import "../monitor-task/page.ts";
import { renderKeyAccountSurface } from "../key-accounts/page.ts";
import { resolveKeyAccountRoute } from "../key-accounts/routes.ts";
import { renderPlatformModelsSurface } from "../models/page.ts";
import { renderPlatformPricingSurface } from "../pricing/page.ts";
import { platformPricingHref } from "../pricing/route.ts";
import { renderProductizationSurface } from "../productization/page.ts";
import { resolveProductizationRoute } from "../productization/routes.ts";
import { followPortHref } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { renderPlatformSystemSettingsSurface } from "../system-settings/page.ts";
import { renderPlatformTenantsSurface } from "../tenants/page.ts";

const PLATFORM_SURFACE_HEADERS: Record<
  PlatformSurfaceProps["tab"],
  {
    title: string;
    subtitle?: string;
    actions?: "report";
  }
> = {
  platformDashboard: {
    title: "平台总览",
    subtitle: "平台运营驾驶舱 · 发现问题并直接处理",
    actions: "report",
  },
  platformTenants: {
    title: "租户管理",
    subtitle: "企业生命周期运营中心 · 覆盖、活跃与健康",
    actions: "report",
  },
  platformPricing: {
    title: "套餐与定价",
    subtitle: "计费规则定义中心 · 套餐 / 席位价 / 用量价 / 超额价",
  },
  platformCapabilities: {
    title: "能力中心",
    subtitle: "AI 能力供给中心 · 目录 / 分发 / 健康",
  },
  platformModels: {
    title: "模型管理",
    subtitle: "AI 决策与模型治理中心",
  },
  platformAgents: {
    title: "资产管理",
    subtitle: "能力装载 / 策略控制 / 健康 / 生命周期",
  },
  platformObservation: {
    title: "运行观测",
    subtitle: "运行证据 · 覆盖缺口 · 原控制面验证",
  },
  platformDiagnosis: {
    title: "监测任务",
    subtitle: "先选租户 · 选择器 · 不监测岗位",
  },
  platformAdvanced: {
    title: "高级治理",
    subtitle: "平台运行治理中心",
  },
  platformSystemSettings: {
    title: "系统设置",
    subtitle: "平台规则控制中心",
    actions: "report",
  },
  platformProductization: {
    title: "发布与制品",
    subtitle: "发布与制品 · 版本列车",
  },
  platformKeyAccounts: {
    title: "大客户管理",
    subtitle: "白牌·预装·授权·安装",
  },
};

let isRefreshing = false;

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function tenantStatusLabel(status: string): string {
  switch (status) {
    case "trial":
      return "试用";
    case "paid":
      return "正式";
    case "suspended":
      return "暂停";
    case "expired":
      return "到期";
    default:
      return status || "-";
  }
}

function buildTenantsCsv(props: PlatformSurfaceProps): string {
  const directory = props.readModel.enterpriseDirectory ?? [];
  const stripIdSuffix = (id: string) => id.replace(/-[0-9a-f]{8}$/i, "");
  const headers = [
    "租户ID",
    "租户名称",
    "状态",
    "套餐",
    "计费状态",
    "席位使用",
    "席位配额",
    "试用结束时间",
    "7天调用",
    "7天成本",
    "Top 模型",
    "Top Agent",
    "活跃 Agent",
    "活跃 Channel",
    "活跃 Runtime",
    "创建来源",
  ];
  const rows = directory.map((entry) => [
    entry.tenantId,
    entry.label || stripIdSuffix(entry.tenantId),
    tenantStatusLabel(entry.status),
    entry.plan ?? "",
    entry.billingStatus ?? "",
    entry.seatUsed ?? 0,
    entry.seatQuota ?? 0,
    entry.trialEndsAt ?? "",
    entry.usageSummary?.calls7d ?? "",
    entry.usageSummary?.cost7d ?? "",
    entry.usageSummary?.topModelLabel ?? "",
    entry.usageSummary?.topAgentLabel ?? "",
    entry.usageSummary?.activeAgentCount ?? "",
    entry.usageSummary?.activeChannelCount ?? "",
    entry.usageSummary?.activeRuntimeCount ?? "",
    entry.createdSource ?? "",
  ]);
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  // Add UTF-8 BOM so Excel renders Chinese correctly.
  return `\ufeff${lines.join("\r\n")}`;
}

function downloadCsv(filename: string, csv: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke to allow download to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayDateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function handleRefresh(props: PlatformSurfaceProps) {
  if (isRefreshing) {
    return;
  }
  const action =
    props.tab === "platformTenants"
      ? props.actions.tenants.onRefresh
      : props.tab === "platformSystemSettings"
        ? props.actions.systemSettings.onRefresh
        : props.actions.dashboard.onRefresh;
  if (!action) {
    return;
  }
  isRefreshing = true;
  requestOpenBotAppRerender();
  try {
    await Promise.resolve(action());
  } finally {
    // Module flag is not Lit state. A render already queued by the payload
    // update can paint 「刷新中…」 and then drop the follow-up requestUpdate.
    isRefreshing = false;
    requestOpenBotAppRerender();
    queueMicrotask(() => requestOpenBotAppRerender());
    setTimeout(() => requestOpenBotAppRerender(), 0);
  }
}

function handleExport(props: PlatformSurfaceProps) {
  const csv = buildTenantsCsv(props);
  downloadCsv(`tenants-${todayDateStamp()}.csv`, csv);
}

function surfaceHeader(props: PlatformSurfaceProps): {
  title: string;
  subtitle?: string;
  actions?: "report";
} {
  if (props.tab === "platformProductization") {
    if (!resolvePlatformDomainAccess(props.scopes).productization) {
      return { title: "发布与制品", subtitle: "路由已拒绝" };
    }
    const pathname =
      typeof window !== "undefined"
        ? window.location.pathname
        : pathForTab("platformProductization", props.basePath);
    const search = typeof window !== "undefined" ? window.location.search : "";
    const route = resolveProductizationRoute(pathname, props.basePath, search);
    return { title: route.title, subtitle: route.subtitle };
  }
  if (props.tab === "platformKeyAccounts") {
    if (!resolvePlatformDomainAccess(props.scopes).keyAccounts) {
      return { title: "大客户管理", subtitle: "路由已拒绝" };
    }
    const pathname =
      typeof window !== "undefined"
        ? window.location.pathname
        : pathForTab("platformKeyAccounts", props.basePath);
    const search = typeof window !== "undefined" ? window.location.search : "";
    const route = resolveKeyAccountRoute(pathname, props.basePath, search);
    return { title: route.title, subtitle: route.subtitle };
  }
  return PLATFORM_SURFACE_HEADERS[props.tab];
}

function renderProductizationCatalogLink(props: PlatformSurfaceProps) {
  if (props.tab !== "platformProductization") {
    return nothing;
  }
  if (!resolvePlatformDomainAccess(props.scopes).productization) {
    return nothing;
  }
  const href = platformPricingHref(props.basePath);
  return html`
    <a
      class="platform-surface-header__catalog"
      data-pz-catalog-link
      href=${href}
      @click=${(event: MouseEvent) => followPortHref(event, href)}
      >套餐与定价（授权目录）</a
    >
  `;
}

function renderPlatformSurfaceHeader(props: PlatformSurfaceProps) {
  const header = surfaceHeader(props);
  const directoryCount = props.readModel.enterpriseDirectory?.length ?? 0;
  return html`
    <header class="platform-surface-header">
      <div class="platform-surface-header__copy">
        <h1 class="platform-surface-header__title">${header.title}</h1>
        ${header.subtitle ? html`<p class="platform-surface-header__subtitle">${header.subtitle}</p>` : nothing}
        ${renderProductizationCatalogLink(props)}
      </div>
      ${
        header.actions === "report"
          ? html`
              <div class="platform-surface-header__actions">
                <button
                  class="btn btn--sm platform-surface-header__button"
                  type="button"
                  title="重新拉取最新平台数据"
                  ?disabled=${isRefreshing}
                  @click=${() => handleRefresh(props)}
                >
                  ${renderIcon("refreshCw", "platform-surface-header__button-icon")}
                  ${isRefreshing ? "刷新中…" : "刷新数据"}
                </button>
                ${
                  props.tab === "platformTenants"
                    ? html`
                        <button
                          class="btn btn--sm platform-surface-header__button"
                          type="button"
                          title=${`导出当前 ${directoryCount} 条租户数据为 CSV`}
                          ?disabled=${directoryCount === 0}
                          @click=${() => handleExport(props)}
                        >
                          ${renderIcon("download", "platform-surface-header__button-icon")}
                          导出报表
                        </button>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </header>
  `;
}

export function renderPlatformSurface(props: PlatformSurfaceProps) {
  let surface;
  switch (props.tab) {
    case "platformDashboard":
      surface = renderPlatformDashboardSurface(props);
      break;
    case "platformTenants":
      surface = renderPlatformTenantsSurface(props);
      break;
    case "platformPricing":
      surface = renderPlatformPricingSurface(props);
      break;
    case "platformCapabilities":
      surface = renderPlatformCapabilitiesSurface(props);
      break;
    case "platformModels":
      surface = renderPlatformModelsSurface(props);
      break;
    case "platformAgents":
      surface = renderPlatformAgentsSurface(props);
      break;
    case "platformObservation":
      surface = renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: null,
        connected: props.connected === true,
        observationHost: props.observationHost ?? null,
        basePath: props.basePath,
      });
      break;
    case "platformDiagnosis":
      surface = html`
        <openbot-platform-monitor-task
          .client=${props.client ?? null}
          .tenants=${(props.readModel.enterpriseDirectory ?? []).map((entry) => ({
            tenantId: entry.tenantId,
            label: entry.label || entry.tenantId,
          }))}
        ></openbot-platform-monitor-task>
        <section class="platform-monitor__diagnose" data-testid="platform-diagnose-isolated">
          <h2 class="platform-monitor__title">立即诊断</h2>
          <p class="platform-monitor__footnote">
            立即诊断不等于立即跑。这一次只读诊断，不修改监测任务的 cadence，也不创建监测 Run。
          </p>
          <openbot-diagnosis-panel
            .client=${props.client ?? null}
            role="platform"
            .scopes=${props.scopes ?? null}
            .sessionKind=${props.sessionKind ?? null}
            .gatewayMethods=${props.gatewayMethods ?? null}
            .connected=${props.connected === true}
          ></openbot-diagnosis-panel>
        </section>
      `;
      break;
    case "platformAdvanced":
      surface = renderPlatformAdvancedSurface(props);
      break;
    case "platformSystemSettings":
      surface = renderPlatformSystemSettingsSurface(props);
      break;
    case "platformProductization":
      surface = renderProductizationSurface({ basePath: props.basePath, scopes: props.scopes });
      break;
    case "platformKeyAccounts":
      surface = renderKeyAccountSurface({ basePath: props.basePath, scopes: props.scopes });
      break;
  }
  return html`
    <section class="platform-surface">
      ${renderPlatformSurfaceHeader(props)}
      <div class="platform-surface__body">${surface}</div>
    </section>
  `;
}
