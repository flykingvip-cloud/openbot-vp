import { html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { channelFaultMessage } from "../../../channel-fault-scope.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { formatNextRun } from "../../../presenter.ts";
import {
  normalizeAppHistoryHref,
  requestOpenBotAppRerender,
} from "../../../request-app-rerender.ts";
import { renderInstances } from "../../../views/instances.ts";
import { renderLogs } from "../../../views/logs.ts";
import { renderNodes } from "../../../views/nodes.ts";
import { renderSessions } from "../../../views/sessions.ts";
import { formatCost, formatTokens } from "../../../views/usage-metrics.ts";
import { isPlatformShellPending, renderPlatformSummaryPending } from "../shared/summary-pending.ts";
import { followPortHref, requestPlatformSurfaceRerender } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { PLATFORM_ADVANCED_HASH_PREFIX } from "./constants.ts";
import "./fabric-panel.ts";
import "./cli-backend-panel.ts";
import "./supervisor-panel.ts";
import "./management-governance-panel.ts";

export { PLATFORM_ADVANCED_HASH_PREFIX };

// ---- Types & state -------------------------------------------------------

type AdvancedTab =
  | "channels"
  | "devices"
  | "sessions"
  | "logs"
  | "instances"
  | "usage"
  | "routing"
  | "fabric"
  | "cliBackend"
  | "supervisor"
  | "governance";

const ADVANCED_TABS: Array<{ id: AdvancedTab; label: string; icon: string }> = [
  { id: "channels", label: "通道", icon: "cable" },
  { id: "devices", label: "设备", icon: "smartphone" },
  { id: "sessions", label: "会话", icon: "messagesSquare" },
  { id: "logs", label: "日志", icon: "fileText" },
  { id: "instances", label: "实例", icon: "server" },
  { id: "usage", label: "使用", icon: "activity" },
  { id: "routing", label: "路由", icon: "compass" },
  { id: "fabric", label: "执行治理", icon: "shield" },
  { id: "cliBackend", label: "协作工具", icon: "wrench" },
  { id: "supervisor", label: "开发监督", icon: "cpu" },
  { id: "governance", label: "权限与审计", icon: "shieldCheck" },
];

const ADVANCED_HASH_PREFIX = PLATFORM_ADVANCED_HASH_PREFIX;
let activeAdvancedTab: AdvancedTab = "channels";

export function platformAdvancedTabHref(tab: AdvancedTab): string {
  if (typeof window === "undefined") {
    return `${ADVANCED_HASH_PREFIX}${tab}`;
  }
  const { pathname, search } = window.location;
  return `${pathname}${search}${ADVANCED_HASH_PREFIX}${tab}`;
}

function isAdvancedTabId(value: string | null | undefined): value is AdvancedTab {
  return Boolean(value && ADVANCED_TABS.some((tab) => tab.id === value));
}

function followPlatformAdvancedTab(event: MouseEvent, tab: AdvancedTab) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  activateAdvancedTab(tab);
}

function handlePlatformAdvancedSurfaceClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const trigger = target.closest("[data-advanced-tab-id]");
  if (!(trigger instanceof HTMLElement)) {
    return;
  }
  const tab = trigger.dataset.advancedTabId;
  if (!isAdvancedTabId(tab)) {
    return;
  }
  followPlatformAdvancedTab(event, tab);
}

function resolveAdvancedTab(): AdvancedTab {
  if (typeof window === "undefined") {
    return "channels";
  }
  const raw = window.location.hash.trim();
  if (!raw.startsWith(ADVANCED_HASH_PREFIX)) {
    return "channels";
  }
  const value = raw.slice(ADVANCED_HASH_PREFIX.length);
  return ADVANCED_TABS.some((tab) => tab.id === value) ? (value as AdvancedTab) : "channels";
}

const ADVANCED_PANEL_TAGS = [
  "cli-backend-admin-section",
  "supervisor-governance-section",
  "fabric-governance-section",
  "management-governance-section",
] as const;

function advancedPanelTagForTab(tab: AdvancedTab): (typeof ADVANCED_PANEL_TAGS)[number] | null {
  switch (tab) {
    case "fabric":
      return "fabric-governance-section";
    case "cliBackend":
      return "cli-backend-admin-section";
    case "supervisor":
      return "supervisor-governance-section";
    case "governance":
      return "management-governance-section";
    default:
      return null;
  }
}

function purgeStaleAdvancedPanels(activeTab: AdvancedTab) {
  if (typeof document === "undefined") {
    return;
  }
  const activeTag = advancedPanelTagForTab(activeTab);
  for (const tag of ADVANCED_PANEL_TAGS) {
    if (tag !== activeTag) {
      for (const el of document.querySelectorAll(tag)) {
        el.remove();
      }
    }
  }
}

/** Drop inactive Lit custom-element panels that fail to unmount on hash tab swaps. */
export function syncPlatformAdvancedPanelVisibility(activeTab: AdvancedTab = resolveAdvancedTab()) {
  purgeStaleAdvancedPanels(activeTab);
}

function activateAdvancedTab(tab: AdvancedTab) {
  if (typeof window === "undefined") {
    return;
  }
  activeAdvancedTab = tab;
  // 同页 hash 不能走 replaceAppHistoryState。合成 popstate 会进入
  // onPopState → refreshActiveTab，高级治理会 loadOverview 并重拉通道、会话、节点和日志。
  window.history.replaceState({}, "", normalizeAppHistoryHref(platformAdvancedTabHref(tab)));
  requestOpenBotAppRerender();
  queueMicrotask(() => purgeStaleAdvancedPanels(tab));
  setTimeout(() => purgeStaleAdvancedPanels(tab), 0);
}

// ---- Summary bar ---------------------------------------------------------

function renderAdvancedSummary(props: PlatformSurfaceProps) {
  if (isPlatformShellPending(props.readModel)) {
    return renderPlatformSummaryPending("高级治理");
  }
  const readModel = props.readModel;
  const items: Array<{
    label: string;
    value: string;
    meta: string;
    tone: "ok" | "warn" | "neutral";
    icon: IconName;
    tab: AdvancedTab;
  }> = [
    {
      label: "通道",
      value: String(readModel.channelCount),
      meta: `${readModel.connectedAccountCount}/${readModel.accountCount} 已连接`,
      tone: readModel.channelCount > 0 ? "ok" : "warn",
      icon: "cable",
      tab: "channels",
    },
    {
      label: "设备",
      value: String(readModel.nodeCount),
      meta: props.nodesProps?.devicesList
        ? `${props.nodesProps.devicesList.pending.length} 待审批 · ${props.nodesProps.devicesList.paired.length} 已配对`
        : `${readModel.nodeCount} 个节点`,
      tone: readModel.nodeCount > 0 ? "ok" : "warn",
      icon: "smartphone",
      tab: "devices",
    },
    {
      label: "会话",
      value: String(readModel.sessionsCount),
      meta: props.sessionsProps?.result
        ? `${props.sessionsProps.result.count ?? readModel.sessionsCount} 条会话`
        : `${readModel.sessionsCount} 条会话`,
      tone: readModel.sessionsCount > 0 ? "ok" : "warn",
      icon: "messagesSquare",
      tab: "sessions",
    },
    {
      label: "日志",
      value: String(props.logsProps?.entries.length ?? 0),
      meta: props.logsProps?.file ? "平台运行日志" : "等待拉取日志",
      tone: props.logsProps?.entries.length ? "ok" : "warn",
      icon: "fileText",
      tab: "logs",
    },
    {
      label: "实例",
      value: String(readModel.presenceCount),
      meta: `${readModel.runtimeHosts.length} 台主机`,
      tone: readModel.presenceCount > 0 ? "ok" : "warn",
      icon: "server",
      tab: "instances",
    },
    {
      label: "使用",
      value: formatTokens(readModel.totalTokens),
      meta: `${formatCost(readModel.totalCost)} 成本`,
      tone: readModel.missingCostEntries > 0 ? "warn" : "neutral",
      icon: "activity",
      tab: "usage",
    },
    {
      label: "路由",
      value: String(readModel.providerIds.length),
      meta: `${readModel.providerIds.length} 个提供方`,
      tone: "neutral",
      icon: "compass",
      tab: "routing",
    },
    {
      label: "执行治理",
      value: "Fabric",
      meta: "AI 工具执行控制平面",
      tone: "neutral",
      icon: "shield",
      tab: "fabric" as AdvancedTab,
    },
    {
      label: "协作工具",
      value: "CLI",
      meta: "第三方编程 CLI 后端",
      tone: "neutral",
      icon: "wrench",
      tab: "cliBackend" as AdvancedTab,
    },
    {
      label: "开发监督",
      value: "Supervisor",
      meta: "AI 开发任务监督看板",
      tone: "neutral",
      icon: "cpu",
      tab: "supervisor" as AdvancedTab,
    },
  ];
  return html`
    <section class="platform-capabilities__summary" aria-label="高级治理总览">
      ${items.map(
        (item) => html`
          <button
            type="button"
            class="platform-capabilities__summary-card is-${item.tone}"
            data-advanced-tab-id=${item.tab}
          >
            <span class="platform-capabilities__summary-icon is-${item.tone}">
              ${renderIcon(item.icon, "platform-capabilities__summary-icon-svg")}
            </span>
            <div class="platform-capabilities__summary-body">
              <div class="platform-capabilities__summary-label">${item.label}</div>
              <div class="platform-capabilities__summary-value is-${item.tone}">${item.value}</div>
              <div class="platform-capabilities__summary-meta">${item.meta}</div>
            </div>
          </button>
        `,
      )}
    </section>
  `;
}

// ---- Tab bar -------------------------------------------------------------

function renderAdvancedTabBar() {
  return html`
    <div
      class="platform-module-tabs platform-module-tabs--inline"
      role="tablist"
      aria-label="高级治理模块"
    >
      ${ADVANCED_TABS.map(
        (tab) => html`
          <a
            href=${platformAdvancedTabHref(tab.id)}
            class="platform-module-tab ${activeAdvancedTab === tab.id ? "is-active" : ""}"
            data-advanced-tab-id=${tab.id}
            role="tab"
            aria-selected=${String(activeAdvancedTab === tab.id)}
          >
            ${tab.label}
          </a>
        `,
      )}
    </div>
  `;
}

// ---- Channels tab --------------------------------------------------------

let expandedChannelKey: string | null = null;

function toggleChannelExpand(key: string) {
  expandedChannelKey = expandedChannelKey === key ? null : key;
  requestPlatformSurfaceRerender();
}

function resolveChannelStatus(
  key: string,
  snapshot: PlatformSurfaceProps["channelsProps"]["snapshot"],
): {
  configured: boolean;
  running: boolean;
  connected: boolean;
  accounts: number;
  lastError: string | null;
} {
  const channels = snapshot?.channels as Record<string, Record<string, unknown>> | null;
  const status = channels?.[key];
  const accounts = snapshot?.channelAccounts?.[key] ?? [];
  return {
    configured: status?.configured === true,
    running: status?.running === true,
    connected: status?.connected === true,
    accounts: accounts.length,
    lastError: channelFaultMessage(snapshot, key),
  };
}

function resolveChannelLabel(
  key: string,
  snapshot: PlatformSurfaceProps["channelsProps"]["snapshot"],
): string {
  if (snapshot?.channelLabels?.[key]) {
    return snapshot.channelLabels[key];
  }
  const meta = snapshot?.channelMeta?.find((m) => m.id === key);
  if (meta?.label) {
    return meta.label;
  }
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    discord: "Discord",
    googlechat: "Google Chat",
    slack: "Slack",
    signal: "Signal",
    imessage: "iMessage",
    nostr: "Nostr",
    wecom: "企业微信",
    feishu: "飞书",
    dingtalk: "钉钉",
    wechat: "微信",
  };
  return labels[key] ?? key;
}

function renderChannelsTab(props: PlatformSurfaceProps) {
  const snapshot = props.channelsProps.snapshot;
  const channelOrder = snapshot?.channelMeta?.map((m) => m.id) ?? snapshot?.channelOrder ?? [];
  const channels = channelOrder.map((key) => {
    const status = resolveChannelStatus(key, snapshot);
    const enabled = status.configured || status.running || status.connected || status.accounts > 0;
    return { key, ...status, enabled, label: resolveChannelLabel(key, snapshot) };
  });

  // 确保中国市场核心通道始终可见（即使未安装插件）
  const CHINA_MARKET_CHANNELS: Array<{ key: string; label: string }> = [
    { key: "wecom", label: "企业微信" },
    { key: "feishu", label: "飞书" },
    { key: "dingtalk", label: "钉钉" },
    { key: "wechat", label: "微信" },
  ];
  for (const preset of CHINA_MARKET_CHANNELS) {
    if (!channels.some((ch) => ch.key === preset.key)) {
      channels.push({
        key: preset.key,
        label: preset.label,
        configured: false,
        running: false,
        connected: false,
        accounts: 0,
        lastError: null,
        enabled: false,
      });
    }
  }

  const sorted = [...channels].toSorted((a, b) => {
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    return 0;
  });

  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">通道连接器目录与治理</div>
        </div>
        <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshChannels(false)}>
          刷新
        </button>
      </div>
      ${
        sorted.length > 0
          ? html`
              <div class="platform-capabilities__distribution card-follow">
                <table class="platform-capabilities__distribution-table">
                  <colgroup>
                    <col style="width: 30%" />
                    <col style="width: 15%" />
                    <col style="width: 15%" />
                    <col style="width: 15%" />
                    <col style="width: 25%" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>通道</th>
                      <th>状态</th>
                      <th>连接</th>
                      <th>账户</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sorted.map((ch) => {
                      const statusLabel = ch.running
                        ? "运行中"
                        : ch.configured
                          ? "已配置"
                          : "未配置";
                      const statusTone = ch.running ? "ok" : ch.configured ? "neutral" : "warn";
                      const connLabel = ch.connected ? "已连接" : "未连接";
                      const connTone = ch.connected ? "ok" : ch.configured ? "warn" : "neutral";
                      return html`
                        <tr>
                          <td>
                            <div class="platform-capabilities__distribution-tenant">
                              <span class="platform-capabilities__distribution-avatar"
                                >${ch.label.slice(0, 1).toUpperCase()}</span
                              >
                              <div class="platform-capabilities__distribution-tenant-copy">
                                <div class="platform-capabilities__distribution-tenant-name">
                                  ${ch.label}
                                </div>
                                ${ch.lastError ? html`<div class="platform-capabilities__distribution-tenant-id is-danger">${ch.lastError.slice(0, 40)}</div>` : nothing}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span class="platform-capabilities__chip is-${statusTone}"
                              >${statusLabel}</span
                            >
                          </td>
                          <td>
                            <span class="platform-capabilities__chip is-${connTone}"
                              >${connLabel}</span
                            >
                          </td>
                          <td><span class="muted">${ch.accounts} 个</span></td>
                          <td>
                            <button
                              class="btn btn--sm ${expandedChannelKey === ch.key ? "btn--primary" : ""}"
                              type="button"
                              @click=${() => toggleChannelExpand(ch.key)}
                            >
                              ${expandedChannelKey === ch.key ? "收起" : "查看治理"}
                            </button>
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              </div>
            `
          : html`
              <div class="platform-capabilities__empty card-follow">
                ${renderIcon("cable", "platform-capabilities__empty-icon")}
                <div class="platform-capabilities__empty-copy">
                  <div class="platform-capabilities__empty-title">暂无通道</div>
                  <div class="platform-capabilities__empty-sub">配置消息通道后将在此展示。</div>
                </div>
              </div>
            `
      }
    </section>

    ${
      expandedChannelKey
        ? html`
            <section class="card card-follow">
              <div class="row row--split">
                <div class="card-title">
                  ${resolveChannelLabel(expandedChannelKey, snapshot)} 治理详情
                </div>
                <button
                  class="btn btn--sm"
                  @click=${() => toggleChannelExpand(expandedChannelKey!)}
                >
                  关闭
                </button>
              </div>
              <div class="card-follow">
                ${renderExpandedChannelGovernance(props, expandedChannelKey)}
              </div>
            </section>
          `
        : nothing
    }
  `;
}

function renderExpandedChannelGovernance(props: PlatformSurfaceProps, channelKey: string) {
  const snapshot = props.channelsProps.snapshot;
  const status = resolveChannelStatus(channelKey, snapshot);
  const channelLabel = resolveChannelLabel(channelKey, snapshot);
  const channelMeta = snapshot?.channelMeta?.find((entry) => entry.id === channelKey) ?? null;
  const runtimeHref = pathForTab("platformAdvanced", props.basePath, {
    context: {
      runtimeId: channelKey,
      sourcePort: "platform",
      sourcePage: "platformAdvanced",
    },
  });

  return html`
    <div class="stack">
      <div class="callout">
        ${channelLabel} 在平台端只展示连接器可用性、账户规模和运行态健康。
        企业租户的具体凭证配置已迁移至企业端「渠道凭证」页面。
      </div>
      <div class="grid grid-cols-4">
        <div class="stat stat--compact">
          <div class="stat-label">配置状态</div>
          <div class="stat-value ${status.configured ? "ok" : "warn"}">
            ${status.configured ? "已开通" : "未开通"}
          </div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">运行状态</div>
          <div class="stat-value ${status.running ? "ok" : ""}">
            ${status.running ? "运行中" : "未运行"}
          </div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">连接状态</div>
          <div class="stat-value ${status.connected ? "ok" : ""}">
            ${status.connected ? "已连接" : "未连接"}
          </div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">账户数</div>
          <div class="stat-value">${status.accounts}</div>
        </div>
      </div>
      ${status.lastError ? html`<div class="callout danger">${status.lastError}</div>` : nothing}
      <div class="list">
        <div class="list-item">
          <div class="list-main">
            <div class="list-title">连接器定位</div>
            <div class="list-sub">
              ${
                channelMeta?.description?.trim()
                  ? channelMeta.description
                  : "平台负责连接器目录、通路治理与运行监督；租户凭证归企业端隔离管理。"
              }
            </div>
          </div>
        </div>
      </div>
      <div class="row row--tight row--wrap">
        <a
          class="btn btn--sm"
          href=${runtimeHref}
          @click=${(event: MouseEvent) => followPortHref(event, runtimeHref)}
        >
          查看运行态
        </a>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => props.actions.advanced.onRefreshChannels(true)}
        >
          重新探测
        </button>
      </div>
    </div>
  `;
}

// ---- Instances tab -------------------------------------------------------

function renderDevicesTab(props: PlatformSurfaceProps) {
  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">设备与节点治理</div>
        </div>
        <div class="row row--tight row--wrap">
          <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshDevices()}>
            刷新设备
          </button>
          <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshNodes()}>
            刷新节点
          </button>
        </div>
      </div>
    </section>
    ${
      props.nodesProps
        ? html`<div class="card-follow">${renderNodes(props.nodesProps)}</div>`
        : html`
            <section class="card card-follow">
              <div class="muted">设备治理视图不可用。</div>
            </section>
          `
    }
  `;
}

function renderSessionsTab(props: PlatformSurfaceProps) {
  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">会话运维</div>
        </div>
        <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshSessions()}>
          刷新会话
        </button>
      </div>
    </section>
    ${
      props.sessionsProps
        ? html`<div class="card-follow">${renderSessions(props.sessionsProps)}</div>`
        : html`
            <section class="card card-follow">
              <div class="muted">会话运维视图不可用。</div>
            </section>
          `
    }
  `;
}

function renderLogsTab(props: PlatformSurfaceProps) {
  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">日志与排障</div>
        </div>
        <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshLogs()}>
          刷新日志
        </button>
      </div>
    </section>
    ${
      props.logsProps
        ? html`<div class="card-follow">${renderLogs(props.logsProps)}</div>`
        : html`
            <section class="card card-follow">
              <div class="muted">日志运维视图不可用。</div>
            </section>
          `
    }
  `;
}

function renderInstancesTab(props: PlatformSurfaceProps) {
  const readModel = props.readModel;
  const basePath = props.basePath;
  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">运行实例</div>
          <div class="card-sub">
            ${readModel.presenceCount} 个在线 · ${readModel.runtimeHosts.length} 台主机 · 版本
            ${readModel.currentVersion ?? "—"}
          </div>
        </div>
        <div class="row row--tight">
          ${readModel.cronNextAt ? html`<span class="muted text-xs">下次唤醒 ${formatNextRun(readModel.cronNextAt)}</span>` : nothing}
          <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefreshInstances()}>
            刷新
          </button>
        </div>
      </div>
    </section>
    ${
      props.instancesProps
        ? html`<div class="card-follow">${renderInstances(props.instancesProps)}</div>`
        : readModel.runtimeHosts.length > 0
          ? html`
              <section class="card card-follow">
                <div class="platform-capabilities__distribution">
                  <table class="platform-capabilities__distribution-table">
                    <thead>
                      <tr>
                        <th>主机</th>
                        <th>会话</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${readModel.runtimeHosts.map(
                        (host) => html`
                          <tr>
                            <td>
                              <div class="platform-capabilities__distribution-tenant">
                                <span class="platform-capabilities__distribution-avatar"
                                  >${renderIcon("server", "platform-capabilities__distribution-action-icon")}</span
                                >
                                <div class="platform-capabilities__distribution-tenant-copy">
                                  <div class="platform-capabilities__distribution-tenant-name">
                                    ${host}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>${readModel.sessionsCount}</td>
                            <td>
                              <a
                                class="platform-capabilities__distribution-action"
                                href=${pathForTab("platformAdvanced", basePath, { context: { runtimeId: host, sourcePort: "platform", sourcePage: "platformAdvanced" } })}
                                @click=${(event: MouseEvent) => followPortHref(event, pathForTab("platformAdvanced", basePath, { context: { runtimeId: host, sourcePort: "platform", sourcePage: "platformAdvanced" } }))}
                              >
                                ${renderIcon("arrowUpRight", "platform-capabilities__distribution-action-icon")}
                                <span>详情</span>
                              </a>
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            `
          : html`
              <div class="platform-capabilities__empty card-follow">
                ${renderIcon("server", "platform-capabilities__empty-icon")}
                <div class="platform-capabilities__empty-copy">
                  <div class="platform-capabilities__empty-title">暂无运行实例</div>
                  <div class="platform-capabilities__empty-sub">当前没有正在上报的运行主机。</div>
                </div>
              </div>
            `
    }
  `;
}

// ---- Usage tab -----------------------------------------------------------

function renderUsageTab(props: PlatformSurfaceProps) {
  const readModel = props.readModel;
  const usage = readModel.currentUsageOverview;
  const errorTone = usage.errorRate > 0.02 ? "warn" : "";
  return html`
    <section class="card">
      <div class="card-title">平台使用概览</div>
      <div class="stat-grid stat-grid--compact card-follow">
        <div class="stat stat--compact">
          <div class="stat-label">总请求</div>
          <div class="stat-value">${usage.totalMessages || "—"}</div>
          <div class="muted stat-note">${usage.sessionCount} 个会话</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">令牌消耗</div>
          <div class="stat-value">${formatTokens(usage.totalTokens || readModel.totalTokens)}</div>
          <div class="muted stat-note">平台累计</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">错误率</div>
          <div class="stat-value ${errorTone}">
            ${usage.totalMessages > 0 ? `${(usage.errorRate * 100).toFixed(1)}%` : "—"}
          </div>
          <div class="muted stat-note">${usage.errorCount} 错误</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">平均延迟</div>
          <div class="stat-value">
            ${typeof usage.avgLatencyMs === "number" ? `${Math.round(usage.avgLatencyMs)} ms` : "—"}
          </div>
          <div class="muted stat-note">最近 7 日</div>
        </div>
      </div>
    </section>
    <section class="card card-follow">
      <div class="row row--split">
        <div>
          <div class="card-title">成本与归因</div>
          <div class="card-sub">
            ${
              readModel.missingCostEntries > 0
                ? `${readModel.missingCostEntries} 条记录缺少成本归因`
                : "成本归因完整"
            }
          </div>
        </div>
        <div class="chip-row">
          <span class="chip">总成本 ${formatCost(readModel.totalCost)}</span>
          ${usage.topModelLabel ? html`<span class="chip">TOP ${usage.topModelLabel}</span>` : nothing}
        </div>
      </div>
    </section>
  `;
}

// ---- Routing tab ---------------------------------------------------------

function renderRoutingTab(props: PlatformSurfaceProps) {
  const readModel = props.readModel;
  const basePath = props.basePath;
  return html`
    <section class="card">
      <div class="row row--split">
        <div>
          <div class="card-title">租户路由</div>
          <div class="card-sub">
            ${readModel.tenantDirectory.length} 个租户 · ${readModel.providerIds.length} 个提供方 ·
            ${readModel.configuredModelCount} 个模型
          </div>
        </div>
        <button class="btn btn--sm" @click=${() => props.actions.advanced.onRefresh()}>刷新</button>
      </div>
    </section>
    ${
      readModel.tenantDirectory.length > 0
        ? html`
            <section class="card card-follow">
              <div class="platform-capabilities__distribution">
                <table class="platform-capabilities__distribution-table">
                  <colgroup>
                    <col style="width: 40%" />
                    <col style="width: 20%" />
                    <col style="width: 20%" />
                    <col style="width: 20%" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>租户</th>
                      <th>提供方</th>
                      <th>模型</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${readModel.tenantDirectory.map(
                      (entry) => html`
                        <tr>
                          <td>
                            <div class="platform-capabilities__distribution-tenant">
                              <span class="platform-capabilities__distribution-avatar"
                                >${entry.label.slice(0, 1).toUpperCase()}</span
                              >
                              <div class="platform-capabilities__distribution-tenant-copy">
                                <div class="platform-capabilities__distribution-tenant-name">
                                  ${entry.label}
                                </div>
                                <div class="platform-capabilities__distribution-tenant-id">
                                  ${entry.tenantId}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td><span class="muted">${readModel.providerIds.length} 个</span></td>
                          <td><span class="muted">${readModel.configuredModelCount} 个</span></td>
                          <td>
                            <a
                              class="platform-capabilities__distribution-action"
                              href=${pathForTab("enterpriseOverview", basePath, { tenantId: entry.tenantId })}
                              @click=${(event: MouseEvent) => followPortHref(event, pathForTab("enterpriseOverview", basePath, { tenantId: entry.tenantId }))}
                            >
                              ${renderIcon("arrowUpRight", "platform-capabilities__distribution-action-icon")}
                              <span>进入</span>
                            </a>
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          `
        : html`
            <div class="platform-capabilities__empty card-follow">
              ${renderIcon("compass", "platform-capabilities__empty-icon")}
              <div class="platform-capabilities__empty-copy">
                <div class="platform-capabilities__empty-title">暂无路由对象</div>
                <div class="platform-capabilities__empty-sub">创建租户后，路由映射会自动生成。</div>
              </div>
            </div>
          `
    }
  `;
}

// ---- Main surface --------------------------------------------------------

function renderAdvancedTabBody(
  tab: AdvancedTab,
  props: PlatformSurfaceProps,
  enterpriseDirectory: PlatformSurfaceProps["readModel"]["enterpriseDirectory"],
): TemplateResult {
  switch (tab) {
    case "channels":
      return renderChannelsTab(props);
    case "devices":
      return renderDevicesTab(props);
    case "sessions":
      return renderSessionsTab(props);
    case "logs":
      return renderLogsTab(props);
    case "instances":
      return renderInstancesTab(props);
    case "usage":
      return renderUsageTab(props);
    case "routing":
      return renderRoutingTab(props);
    case "fabric":
      return html`<fabric-governance-section
        .client=${props.client ?? null}
      ></fabric-governance-section>`;
    case "cliBackend":
      return html`<cli-backend-admin-section
        .client=${props.client ?? null}
        .enterprises=${enterpriseDirectory}
      ></cli-backend-admin-section>`;
    case "supervisor":
      return html`<supervisor-governance-section
        .client=${props.client ?? null}
        .enterprises=${enterpriseDirectory}
      ></supervisor-governance-section>`;
    case "governance":
      return html`<management-governance-section
        .client=${props.client ?? null}
        .enterprises=${enterpriseDirectory}
        .authPanelProps=${props.authPanelProps ?? null}
      ></management-governance-section>`;
    default:
      return html``;
  }
}

export function renderPlatformAdvancedSurface(props: PlatformSurfaceProps) {
  activeAdvancedTab = resolveAdvancedTab();
  purgeStaleAdvancedPanels(activeAdvancedTab);

  const enterpriseDirectory = props.readModel.enterpriseDirectory ?? [];

  queueMicrotask(() => purgeStaleAdvancedPanels(activeAdvancedTab));

  return html`
    <section class="platform-capabilities" @click=${handlePlatformAdvancedSurfaceClick}>
      <div class="card platform-advanced-tabs-card">${renderAdvancedTabBar()}</div>
      ${renderAdvancedSummary(props)}
      <div class="platform-capabilities__body" data-advanced-tab=${activeAdvancedTab}>
        ${keyed(
          activeAdvancedTab,
          html`<div class="platform-advanced-tab-pane">
            ${renderAdvancedTabBody(activeAdvancedTab, props, enterpriseDirectory)}
          </div>`,
        )}
      </div>
    </section>
  `;
}
