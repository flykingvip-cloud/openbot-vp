/**
 * Capability Center — 运行态使用面板编排器
 *
 * 把原「能力应用管理」(enterprise-capability-usage-management) 的三个运行态子页
 * —— 机器人视图 / 效果分析 / 应用治理 —— 作为「企业能力中心」的工作区 Tab 面板复用。
 *
 * 设计：
 * - 复用既有控制器（robot-capability-view / usage-analytics / usage-governance）
 *   与视图（robot-capability-view-page / usage-analytics-page / usage-governance-page）。
 * - 控制器按 client 实例重建，state 存于模块级单例（与能力中心 surface 其它受管状态一致）。
 * - 子 Tab 首次进入时按需 load（lazy），重复进入不重复拉数据。
 *
 * 注意：本编排器不持有顶层 tab 状态；activeTab 与 ?tab= 同步由能力中心 surface 负责。
 */

import { html, type TemplateResult } from "lit-html";
import { createEnterpriseUsageGateway } from "../../capability/enterprise-asset-library-usage/gateway-client.ts";
import {
  createRobotCapabilityViewController,
  type RobotCapabilityViewState,
} from "../../controllers/enterprise-asset-library-usage/robot-capability-view.ts";
import {
  createUsageAnalyticsController,
  type UsageAnalyticsState,
} from "../../controllers/enterprise-asset-library-usage/usage-analytics.ts";
import {
  createUsageGovernanceController,
  type UsageGovernanceState,
} from "../../controllers/enterprise-asset-library-usage/usage-governance.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { renderRobotCapabilityViewPage } from "./../enterprise-asset-library-usage/robot-capability-view-page.ts";
import { renderUsageAnalyticsPage } from "./../enterprise-asset-library-usage/usage-analytics-page.ts";
import { renderUsageGovernancePage } from "./../enterprise-asset-library-usage/usage-governance-page.ts";

export type UsagePanelTab = "robots" | "analytics" | "governance";

// ─────────────────────────────────────────────────────────────────────────
// Module-level controller state (SPA lifecycle, keyed by client instance)
// ─────────────────────────────────────────────────────────────────────────

let robotViewState: RobotCapabilityViewState | null = null;
let analyticsState: UsageAnalyticsState | null = null;
let governanceState: UsageGovernanceState | null = null;

let robotViewController: ReturnType<typeof createRobotCapabilityViewController> | null = null;
let analyticsController: ReturnType<typeof createUsageAnalyticsController> | null = null;
let governanceController: ReturnType<typeof createUsageGovernanceController> | null = null;

let lastClient: GatewayBrowserClient | null = null;
let controllersInitialized = false;
let loadedTabs = new Set<UsagePanelTab>();
let rerenderFn: (() => void) | null = null;

function ensureControllers(client: GatewayBrowserClient | null, rerender: () => void): void {
  rerenderFn = rerender;
  if (controllersInitialized && (lastClient === client || (!client && !lastClient))) {
    return;
  }
  lastClient = client;
  controllersInitialized = true;
  loadedTabs = new Set();
  robotViewState = null;
  analyticsState = null;
  governanceState = null;

  if (!client) {
    robotViewController = null;
    analyticsController = null;
    governanceController = null;
    return;
  }

  const usageGateway = createEnterpriseUsageGateway(client);
  robotViewController = createRobotCapabilityViewController(usageGateway, (s) => {
    robotViewState = s;
    rerenderFn?.();
  });
  analyticsController = createUsageAnalyticsController(usageGateway, (s) => {
    analyticsState = s;
    rerenderFn?.();
  });
  governanceController = createUsageGovernanceController(usageGateway, (s) => {
    governanceState = s;
    rerenderFn?.();
  });
}

function ensureTabLoaded(tab: UsagePanelTab): void {
  if (loadedTabs.has(tab)) {
    return;
  }
  loadedTabs.add(tab);
  switch (tab) {
    case "robots":
      void robotViewController?.load();
      break;
    case "analytics":
      void analyticsController?.load();
      break;
    case "governance":
      void governanceController?.load();
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export type UsagePanelsContext = {
  client: GatewayBrowserClient | null;
  basePath: string;
  tenantId: string;
  rerender: () => void;
};

/**
 * 初始化（或在 client 变化时重建）运行态控制器，并确保指定 Tab 已触发加载。
 * 由能力中心 surface 在渲染对应 Tab 前调用。
 */
export function prepareUsagePanels(ctx: UsagePanelsContext, activeTab: UsagePanelTab): void {
  ensureControllers(ctx.client, ctx.rerender);
  ensureTabLoaded(activeTab);
}

function renderLoadingPlaceholder(message: string): TemplateResult {
  return html`
    <div style="padding: 24px 0">
      <p style="color: #6b7280; font-size: 14px">${message}</p>
    </div>
  `;
}

export function buildRobotsPanel(): TemplateResult {
  if (robotViewController && robotViewState) {
    return renderRobotCapabilityViewPage({
      state: robotViewState,
      controller: robotViewController,
    });
  }
  return renderLoadingPlaceholder("正在加载机器人能力配置视图…");
}

export function buildAnalyticsPanel(ctx: UsagePanelsContext): TemplateResult {
  if (analyticsState) {
    return renderUsageAnalyticsPage({
      state: analyticsState,
      controller: analyticsController!,
      basePath: ctx.basePath,
      tenantId: ctx.tenantId,
    });
  }
  return renderLoadingPlaceholder("正在加载使用效果分析…");
}

export function buildGovernancePanel(ctx: UsagePanelsContext): TemplateResult {
  if (governanceState) {
    return renderUsageGovernancePage({
      state: governanceState,
      controller: governanceController!,
      basePath: ctx.basePath,
      tenantId: ctx.tenantId,
    });
  }
  return renderLoadingPlaceholder("正在加载使用治理…");
}
