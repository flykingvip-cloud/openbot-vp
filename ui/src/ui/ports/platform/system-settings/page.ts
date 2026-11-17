import { html, nothing } from "lit";
import type { ControlUiPlatformAuthMode } from "../../../../../../src/gateway/control-ui-contract.js";
import { t } from "../../../../i18n/index.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import {
  normalizeAppHistoryHref,
  requestOpenBotAppRerender,
} from "../../../request-app-rerender.ts";
import { originForPort } from "../../../routing/subdomain-resolver.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import { renderPlatformAuthPanel } from "../../../views/platform-auth-panel.ts";
import {
  renderDevicePlatformConnectionPanel,
  showDevicePlatformConnectionList,
} from "../device-platform/page.ts";
import type { PlatformModelsMode } from "../models/snapshot-types.ts";
import { isPlatformShellPending, renderPlatformSummaryPending } from "../shared/summary-pending.ts";
import {
  followPortHref,
  requestPlatformSurfaceRerender,
  type PlatformSurfaceProps,
} from "../shared/surface.ts";
import {
  PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX,
  platformCreateTenantHref,
  platformSystemSettingsHref,
  type PlatformSystemSettingsSection,
} from "./route.ts";

// ---- Types & state ------------------------------------------------------

type SystemSettingsTab = PlatformSystemSettingsSection;

const SYSTEM_SETTINGS_TABS: Array<{ id: SystemSettingsTab; label: string }> = [
  { id: "admins", label: "管理员" },
  { id: "defaults", label: "默认策略" },
  { id: "security", label: "安全与审计" },
  { id: "api", label: "API Key" },
  { id: "device-platform", label: "设备平台连接" },
];

let activeSystemSettingsTab: SystemSettingsTab = "admins";
/** Tracks whether device-platform section is currently shown (in-memory form must not leak across tab visits). */
let devicePlatformSectionMounted = false;

function resolveSystemSettingsTab(): SystemSettingsTab {
  if (typeof window === "undefined") {
    return "admins";
  }
  const raw = window.location.hash.trim();
  if (!raw.startsWith(PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX)) {
    return "admins";
  }
  const value = raw.slice(PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX.length);
  return SYSTEM_SETTINGS_TABS.some((tab) => tab.id === value)
    ? (value as SystemSettingsTab)
    : "admins";
}

function activateSystemSettingsTab(tab: SystemSettingsTab) {
  if (typeof window === "undefined") {
    return;
  }
  activeSystemSettingsTab = tab;
  if (tab === "device-platform") {
    // Tab chrome always opens LIST; form only via 添加连接 / 编辑.
    showDevicePlatformConnectionList();
    devicePlatformSectionMounted = true;
  } else {
    devicePlatformSectionMounted = false;
  }
  const { pathname, search } = window.location;
  // 同页 hash 切换不能走 replaceAppHistoryState：它会派发合成 popstate，
  // 进而 onPopState → refreshActiveTab → loadOverview，把页签点击打成全量刷新。
  window.history.replaceState(
    {},
    "",
    normalizeAppHistoryHref(`${pathname}${search}${PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX}${tab}`),
  );
  requestOpenBotAppRerender();
}

const SYSTEM_SETTINGS_AUTH_MODES: ControlUiPlatformAuthMode[] = [
  "platform-bootstrap",
  "platform-super-admin-login",
  "platform-admin-login",
];

const PLATFORM_MODE_OPTIONS: Array<{
  id: PlatformModelsMode;
  label: string;
  summary: string;
}> = [
  {
    id: "native",
    label: "原生",
    summary: "仅使用平台原生模型资产、任务方案、路由与治理数据。",
  },
  {
    id: "aor_enhanced",
    label: "AOR 增强",
    summary: "叠加 AOR 的执行反馈、路由解释、学习状态与优化指标。",
  },
];

const PLATFORM_NATIVE_MODE_CAPABILITIES = [
  "模型资产",
  "任务方案",
  "智能路由配置",
  "基础使用分析",
  "规则治理告警",
];

const PLATFORM_AOR_ENHANCEMENTS = [
  "真实路由解释",
  "Bandit 学习状态",
  "Live Coding 证据",
  "Optimization 指标",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function labelPlatformModelsMode(mode: PlatformModelsMode) {
  return mode === "aor_enhanced" ? "AOR 增强" : "原生";
}

function resolveConfiguredPlatformModelsMode(props: PlatformSurfaceProps): PlatformModelsMode {
  const gateway = asRecord(props.channelsProps.configForm?.gateway);
  const platform = asRecord(gateway?.platform);
  const models = asRecord(platform?.models);
  if (models?.mode === "aor_enhanced") {
    return "aor_enhanced";
  }
  if (models?.mode === "native") {
    return "native";
  }
  return props.readModel.platformModelsMode ?? "native";
}

function resolveSystemSettingsAuthPanelProps(
  authPanelProps: PlatformAuthPanelProps | null | undefined,
): PlatformAuthPanelProps | null {
  if (!authPanelProps) {
    return null;
  }
  const availableModes = authPanelProps.state?.availableModes?.filter((mode) =>
    SYSTEM_SETTINGS_AUTH_MODES.includes(mode),
  );
  const mode = availableModes?.includes(authPanelProps.mode)
    ? authPanelProps.mode
    : (availableModes?.[0] ?? SYSTEM_SETTINGS_AUTH_MODES[0]);
  const state = authPanelProps.state;
  return {
    ...authPanelProps,
    mode,
    compact: false,
    state: {
      ...authPanelProps.state,
      enabled: true,
      hasUsers: state?.hasUsers ?? false,
      hasPlatformAdmins: state?.hasPlatformAdmins ?? false,
      allowRegistration: state?.allowRegistration ?? false,
      requiresInvite: state?.requiresInvite ?? false,
      availableModes: availableModes?.length ? availableModes : SYSTEM_SETTINGS_AUTH_MODES,
      requiresPlatformBootstrap: mode === "platform-bootstrap",
    },
  };
}

// ---- Summary KPI --------------------------------------------------------

function renderSummary(
  props: PlatformSurfaceProps,
  authPanelProps: PlatformAuthPanelProps | null,
  canManagePlatform: boolean,
) {
  const { readModel } = props;
  const adminCount = authPanelProps?.state?.platformAdmins?.length ?? 0;
  const configuredPlatformModelsMode = resolveConfiguredPlatformModelsMode(props);
  const appliedPlatformModelsMode = readModel.platformModelsMode ?? "native";
  const platformModeMeta = props.channelsProps.configFormDirty
    ? "有未保存切换"
    : configuredPlatformModelsMode === appliedPlatformModelsMode
      ? "配置已同步"
      : "等待刷新生效";
  if (isPlatformShellPending(readModel)) {
    return renderPlatformSummaryPending("系统设置");
  }
  return html`
    <section class="platform-capabilities__summary" aria-label="系统设置总览">
      <article class="platform-capabilities__summary-card is-neutral">
        <span class="platform-capabilities__summary-icon">
          ${renderIcon("users", "platform-capabilities__summary-icon-svg")}
        </span>
        <div class="platform-capabilities__summary-body">
          <div class="platform-capabilities__summary-label">平台管理员</div>
          <div class="platform-capabilities__summary-value">${adminCount}</div>
          <div class="platform-capabilities__summary-meta">
            当前角色
            ${
              authPanelProps?.state?.platformRole
                ? t(
                    `overview.platformAuth.sessionKind.platform-${authPanelProps.state.platformRole}`,
                  )
                : t("common.na")
            }
          </div>
        </div>
      </article>
      <article class="platform-capabilities__summary-card is-${canManagePlatform ? "ok" : "warn"}">
        <span class="platform-capabilities__summary-icon is-${canManagePlatform ? "ok" : "warn"}">
          ${renderIcon("shieldCheck", "platform-capabilities__summary-icon-svg")}
        </span>
        <div class="platform-capabilities__summary-body">
          <div class="platform-capabilities__summary-label">配置权限</div>
          <div class="platform-capabilities__summary-value is-${canManagePlatform ? "ok" : "warn"}">
            ${canManagePlatform ? "可管理" : "只读"}
          </div>
          <div class="platform-capabilities__summary-meta">
            ${
              authPanelProps?.state?.sessionKind
                ? t(`overview.platformAuth.sessionKind.${authPanelProps.state.sessionKind}`)
                : "未登录"
            }
          </div>
        </div>
      </article>
      <article
        class="platform-capabilities__summary-card is-${readModel.defaultModelPrimary ? "ok" : "warn"}"
      >
        <span
          class="platform-capabilities__summary-icon is-${readModel.defaultModelPrimary ? "ok" : "warn"}"
        >
          ${renderIcon("cpu", "platform-capabilities__summary-icon-svg")}
        </span>
        <div class="platform-capabilities__summary-body">
          <div class="platform-capabilities__summary-label">默认策略</div>
          <div
            class="platform-capabilities__summary-value is-${readModel.defaultModelPrimary ? "ok" : "warn"}"
          >
            ${readModel.defaultModelPrimary ? "已配置" : "待配置"}
          </div>
          <div class="platform-capabilities__summary-meta">
            ${readModel.modelMode ?? t("common.na")} 模式 · ${readModel.configuredModelCount} 个模型
          </div>
        </div>
      </article>
      <article class="platform-capabilities__summary-card is-neutral">
        <span class="platform-capabilities__summary-icon">
          ${renderIcon("building", "platform-capabilities__summary-icon-svg")}
        </span>
        <div class="platform-capabilities__summary-body">
          <div class="platform-capabilities__summary-label">已知租户</div>
          <div class="platform-capabilities__summary-value">${readModel.knownTenantIds.length}</div>
          <div class="platform-capabilities__summary-meta">
            ${readModel.enterpriseDirectory?.length ?? 0} 个企业
          </div>
        </div>
      </article>
      <article
        class="platform-capabilities__summary-card is-${configuredPlatformModelsMode === "aor_enhanced" ? "ok" : "neutral"}"
      >
        <span
          class="platform-capabilities__summary-icon is-${configuredPlatformModelsMode === "aor_enhanced" ? "ok" : "neutral"}"
        >
          ${renderIcon("activity", "platform-capabilities__summary-icon-svg")}
        </span>
        <div class="platform-capabilities__summary-body">
          <div class="platform-capabilities__summary-label">模型管理模式</div>
          <div
            class="platform-capabilities__summary-value is-${configuredPlatformModelsMode === "aor_enhanced" ? "ok" : "neutral"}"
          >
            ${labelPlatformModelsMode(configuredPlatformModelsMode)}
          </div>
          <div class="platform-capabilities__summary-meta">${platformModeMeta}</div>
        </div>
      </article>
    </section>
  `;
}

// ---- Tab bar ------------------------------------------------------------

function renderTabBar() {
  return html`
    <div
      class="platform-module-tabs platform-module-tabs--inline"
      role="tablist"
      aria-label="系统设置模块"
    >
      ${SYSTEM_SETTINGS_TABS.map(
        (tab) => html`
          <button
            type="button"
            class="platform-module-tab ${activeSystemSettingsTab === tab.id ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(activeSystemSettingsTab === tab.id)}
            @click=${() => activateSystemSettingsTab(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

// ---- Tab: Create tenant -------------------------------------------------

function renderCreateTenantField(params: {
  label: string;
  value: string;
  onInput: (next: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "url" | "number";
  required?: boolean;
  disabled?: boolean;
}) {
  return html`
    <label class="field">
      <span>${params.label}${params.required ? " *" : ""}</span>
      <input
        type=${params.type ?? "text"}
        inputmode=${params.type === "number" ? "numeric" : "text"}
        placeholder=${params.placeholder ?? ""}
        .value=${params.value}
        ?disabled=${params.disabled}
        @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

type CreateTenantMode = "quick-trial" | "formal" | "advanced";
type CreateTenantSource = "sales" | "website" | "partner" | "internal" | "migration";
type CreateTenantPlan = "starter-trial" | "team" | "business" | "enterprise-custom";
type CreateTenantUpgradePolicy = "auto" | "manual" | "pause";
type CreateTenantCapabilityBundle =
  | "ai-basic"
  | "coding-team"
  | "content-team"
  | "knowledge-base"
  | "service-desk";
type CreateTenantAgentTemplate =
  | "enterprise-assistant"
  | "docs-assistant"
  | "coding-assistant"
  | "data-analyst";
type CreateTenantRegion = "mainland" | "global" | "private";
type CreateTenantSecurityPolicy = "standard" | "strict" | "custom";
type CreateTenantActivationAction = "email" | "invite" | "link";
type CreateTenantSlaLevel = "standard" | "premium" | "mission-critical";
type CreateTenantBillingMode = "trial-to-paid" | "prepaid" | "contract" | "custom";
type CreateTenantPermissionPolicy = "default" | "restricted" | "custom";
type CreateTenantAuditLevel = "basic" | "standard" | "strict";
type CreateTenantRoutingPolicy = "default" | "cost-first" | "quality-first" | "private-first";
type CreateTenantIsolationLevel = "shared" | "dedicated" | "private";

const CREATE_TENANT_MODE_OPTIONS: Array<{
  id: CreateTenantMode;
  label: string;
  description: string;
  audience: string;
  features: string[];
  icon: IconName;
}> = [
  {
    id: "quick-trial",
    label: "快速试用企业",
    description: "最快创建一个可体验 AI 的试用租户。",
    audience: "演示 / POC / 官网试用",
    features: ["自动配置", "3 分钟开通", "自动限额", "自动回收"],
    icon: "zap",
  },
  {
    id: "formal",
    label: "正式企业",
    description: "面向已签约客户的标准商业交付。",
    audience: "正式商业客户",
    features: ["套餐管理", "AI 默认策略", "企业运营配置", "长期运行"],
    icon: "building",
  },
  {
    id: "advanced",
    label: "高级创建",
    description: "面向政企与高安全客户，安全锚点在客户侧私有模型。",
    audience: "政企 / 高安全客户",
    features: ["模型治理", "数据隔离", "SSO / 审计", "私有资源池"],
    icon: "settings",
  },
];

const CREATE_TENANT_SOURCE_OPTIONS: Array<{ value: CreateTenantSource; label: string }> = [
  { value: "website", label: "官网注册" },
  { value: "sales", label: "销售创建" },
  { value: "partner", label: "合作伙伴" },
  { value: "internal", label: "内部测试" },
  { value: "migration", label: "迁移客户" },
];

const CREATE_TENANT_PLAN_OPTIONS: Array<{
  value: CreateTenantPlan;
  label: string;
  summary: string;
  monthlyBudget: string;
  agentQuota: number;
  storageGb: number;
}> = [
  {
    value: "starter-trial",
    label: "Starter Trial（试用版）",
    summary: "轻量试用策略，默认成本封顶",
    monthlyBudget: "$100",
    agentQuota: 5,
    storageGb: 20,
  },
  {
    value: "team",
    label: "Team",
    summary: "中小团队正式协作",
    monthlyBudget: "$500",
    agentQuota: 20,
    storageGb: 100,
  },
  {
    value: "business",
    label: "Business",
    summary: "部门级运营与 SLA",
    monthlyBudget: "$2,000",
    agentQuota: 60,
    storageGb: 500,
  },
  {
    value: "enterprise-custom",
    label: "Enterprise Custom",
    summary: "定制限额、路由与商业条款",
    monthlyBudget: "定制",
    agentQuota: 100,
    storageGb: 1000,
  },
];

const CREATE_TENANT_BUNDLE_OPTIONS: Array<{
  value: CreateTenantCapabilityBundle;
  label: string;
  summary: string;
  capabilityCount: number;
}> = [
  {
    value: "ai-basic",
    label: "AI 基础协作",
    summary: "通用问答、任务协作、文件处理",
    capabilityCount: 15,
  },
  {
    value: "coding-team",
    label: "编程团队",
    summary: "代码理解、PR 协作、研发工作流",
    capabilityCount: 22,
  },
  {
    value: "content-team",
    label: "内容团队",
    summary: "选题、写作、素材与发布协作",
    capabilityCount: 18,
  },
  {
    value: "knowledge-base",
    label: "企业知识库",
    summary: "文档检索、知识问答、权限边界",
    capabilityCount: 20,
  },
  {
    value: "service-desk",
    label: "客服工作台",
    summary: "工单分流、应答建议、质检回溯",
    capabilityCount: 24,
  },
];

const CREATE_TENANT_AGENT_TEMPLATE_OPTIONS: Array<{
  value: CreateTenantAgentTemplate;
  label: string;
  summary: string;
}> = [
  { value: "enterprise-assistant", label: "企业助手", summary: "通用问答" },
  { value: "docs-assistant", label: "文档助手", summary: "知识库问答" },
  { value: "coding-assistant", label: "编程助手", summary: "代码开发" },
  { value: "data-analyst", label: "数据分析助手", summary: "报表分析" },
];

let createTenantMode: CreateTenantMode = "quick-trial";
type FormalWizardStep = 1 | 2 | 3;
let formalWizardStep: FormalWizardStep = 1;
let createTenantSource: CreateTenantSource = "sales";
let createTenantPlan: CreateTenantPlan = "starter-trial";
let createTenantUpgradePolicy: CreateTenantUpgradePolicy = "auto";
let createTenantCapabilityBundle: CreateTenantCapabilityBundle = "ai-basic";
let createTenantTextModel = "auto";
let createTenantReasoningModel = "claude-3-5-haiku";
let createTenantImageModel = "disabled";
let createTenantRegion: CreateTenantRegion = "mainland";
let createTenantSecurityPolicy: CreateTenantSecurityPolicy = "standard";
let createTenantOpsOwner = "";
let createTenantSalesOwner = "";
let createTenantSuccessOwner = "";
let createTenantContactPhone = "";
let createTenantSlaLevel: CreateTenantSlaLevel = "standard";
let createTenantBillingMode: CreateTenantBillingMode = "trial-to-paid";
let createTenantPermissionPolicy: CreateTenantPermissionPolicy = "default";
let createTenantAuditLevel: CreateTenantAuditLevel = "standard";
let createTenantTenantOwner = "";
let createTenantSecurityOwner = "";
let createTenantAuditOwner = "";
let createTenantModelAllowlist = "";
let createTenantProviderAllowlist = "";
let createTenantRoutingPolicy: CreateTenantRoutingPolicy = "default";
let createTenantInferenceBudget = "";
let createTenantModelFallback = "enabled";
let createTenantIpAllowlist = "";
let createTenantSsoProvider = "";
let createTenantRbacPreset: CreateTenantPermissionPolicy = "custom";
let createTenantDataIsolation: CreateTenantIsolationLevel = "shared";
let createTenantAuditRetention = "365";
let createTenantResourcePool = "";
let createTenantDedicatedRuntime = "";
let createTenantVectorStore = "";
let createTenantPrivateGateway = "";
let createTenantKubernetesCluster = "";
let createTenantCostCap = "";
let createTenantOveragePolicy = "freeze";
let createTenantBudgetFreeze = "enabled";
let createTenantActivationActions = new Set<CreateTenantActivationAction>(["email", "invite"]);
let createTenantAgentTemplates = new Set<CreateTenantAgentTemplate>([
  "enterprise-assistant",
  "docs-assistant",
]);

function requestSystemSettingsRerender() {
  requestPlatformSurfaceRerender();
}

function setCreateTenantMode(mode: CreateTenantMode) {
  createTenantMode = mode;
  formalWizardStep = 1;
  if (mode === "quick-trial") {
    createTenantSource = "website";
    createTenantPlan = "starter-trial";
    createTenantCapabilityBundle = "ai-basic";
    createTenantUpgradePolicy = "pause";
    createTenantSecurityPolicy = "standard";
    createTenantRegion = "mainland";
    createTenantSlaLevel = "standard";
    createTenantBillingMode = "trial-to-paid";
    createTenantPermissionPolicy = "default";
    createTenantAuditLevel = "basic";
    createTenantAgentTemplates = new Set(["enterprise-assistant", "docs-assistant"]);
  } else if (mode === "formal") {
    createTenantSource = createTenantSource === "website" ? "sales" : createTenantSource;
    createTenantPlan = createTenantPlan === "starter-trial" ? "team" : createTenantPlan;
    createTenantCapabilityBundle = "knowledge-base";
    createTenantUpgradePolicy = "manual";
    createTenantSecurityPolicy =
      createTenantSecurityPolicy === "custom" ? "strict" : createTenantSecurityPolicy;
    createTenantRegion = createTenantRegion === "private" ? "mainland" : createTenantRegion;
    createTenantSlaLevel =
      createTenantSlaLevel === "mission-critical" ? "premium" : createTenantSlaLevel;
    createTenantBillingMode =
      createTenantBillingMode === "custom" ? "contract" : createTenantBillingMode;
    createTenantPermissionPolicy =
      createTenantPermissionPolicy === "custom" ? "restricted" : createTenantPermissionPolicy;
    createTenantAuditLevel =
      createTenantAuditLevel === "basic" ? "standard" : createTenantAuditLevel;
    createTenantAgentTemplates = new Set([
      "enterprise-assistant",
      "docs-assistant",
      "coding-assistant",
    ]);
  } else {
    createTenantSource = "migration";
    createTenantPlan = "enterprise-custom";
    createTenantCapabilityBundle = "service-desk";
    createTenantSecurityPolicy = "custom";
    createTenantRegion = "private";
    createTenantSlaLevel = "mission-critical";
    createTenantBillingMode = "custom";
    createTenantPermissionPolicy = "custom";
    createTenantAuditLevel = "strict";
    createTenantDataIsolation = "dedicated";
    createTenantRoutingPolicy = "private-first";
    createTenantAgentTemplates = new Set([
      "enterprise-assistant",
      "docs-assistant",
      "data-analyst",
    ]);
  }
  requestSystemSettingsRerender();
}

function resetCreateTenantPreview() {
  createTenantSource = "sales";
  createTenantTextModel = "auto";
  createTenantReasoningModel = "claude-3-5-haiku";
  createTenantImageModel = "disabled";
  createTenantRegion = "mainland";
  createTenantOpsOwner = "";
  createTenantSalesOwner = "";
  createTenantSuccessOwner = "";
  createTenantContactPhone = "";
  createTenantSlaLevel = "standard";
  createTenantBillingMode = "trial-to-paid";
  createTenantPermissionPolicy = "default";
  createTenantAuditLevel = "standard";
  createTenantTenantOwner = "";
  createTenantSecurityOwner = "";
  createTenantAuditOwner = "";
  createTenantModelAllowlist = "";
  createTenantProviderAllowlist = "";
  createTenantRoutingPolicy = "default";
  createTenantInferenceBudget = "";
  createTenantModelFallback = "enabled";
  createTenantIpAllowlist = "";
  createTenantSsoProvider = "";
  createTenantRbacPreset = "custom";
  createTenantDataIsolation = "shared";
  createTenantAuditRetention = "365";
  createTenantResourcePool = "";
  createTenantDedicatedRuntime = "";
  createTenantVectorStore = "";
  createTenantPrivateGateway = "";
  createTenantKubernetesCluster = "";
  createTenantCostCap = "";
  createTenantOveragePolicy = "freeze";
  createTenantBudgetFreeze = "enabled";
  createTenantActivationActions = new Set(["email", "invite"]);
  setCreateTenantMode("quick-trial");
}

function setActivationAction(action: CreateTenantActivationAction, enabled: boolean) {
  const next = new Set(createTenantActivationActions);
  if (enabled) {
    next.add(action);
  } else {
    next.delete(action);
  }
  createTenantActivationActions = next;
  requestSystemSettingsRerender();
}

function setAgentTemplate(template: CreateTenantAgentTemplate, enabled: boolean) {
  const next = new Set(createTenantAgentTemplates);
  if (enabled) {
    next.add(template);
  } else {
    next.delete(template);
  }
  createTenantAgentTemplates = next;
  requestSystemSettingsRerender();
}

function asPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function selectedPlanProfile() {
  return CREATE_TENANT_PLAN_OPTIONS.find((option) => option.value === createTenantPlan)!;
}

function selectedBundleProfile() {
  return CREATE_TENANT_BUNDLE_OPTIONS.find(
    (option) => option.value === createTenantCapabilityBundle,
  )!;
}

function resolveCreateTenantDefaultTextModel(props: PlatformSurfaceProps) {
  return (
    props.readModel.defaultModelPrimary ?? props.readModel.configuredModelIds[0] ?? "GPT-4.1-mini"
  );
}

function resolveCreateTenantDefaultImageModel(props: PlatformSurfaceProps) {
  return props.readModel.defaultImageModelPrimary ?? "disabled";
}

function modelLabel(value: string, fallback: string) {
  if (value === "auto") {
    return `${fallback}（平台默认）`;
  }
  if (value === "disabled") {
    return "disabled";
  }
  const labels: Record<string, string> = {
    "gpt-4-1-mini": "GPT-4.1-mini",
    "gpt-4-1": "GPT-4.1",
    "claude-3-5-haiku": "Claude 3.5 Haiku",
    "dall-e-3": "DALL-E 3",
    "gpt-image-1": "GPT Image 1",
  };
  return labels[value] ?? value;
}

function upgradePolicyLabel(value: CreateTenantUpgradePolicy) {
  if (value === "auto") {
    return "自动升级";
  }
  if (value === "manual") {
    return "手动升级";
  }
  return "试用结束后暂停";
}

function sourceLabel(value: CreateTenantSource) {
  return CREATE_TENANT_SOURCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function securityPolicyLabel(value: CreateTenantSecurityPolicy) {
  if (value === "strict") {
    return "增强安全";
  }
  if (value === "custom") {
    return "定制安全";
  }
  return "标准安全";
}

function regionLabel(value: CreateTenantRegion) {
  if (value === "global") {
    return "全球路由";
  }
  if (value === "private") {
    return "专属路由";
  }
  return "中国大陆";
}

function slaLevelLabel(value: CreateTenantSlaLevel) {
  if (value === "premium") {
    return "Premium SLA";
  }
  if (value === "mission-critical") {
    return "Mission Critical SLA";
  }
  return "Standard SLA";
}

function billingModeLabel(value: CreateTenantBillingMode) {
  if (value === "prepaid") {
    return "预付费";
  }
  if (value === "contract") {
    return "合同计费";
  }
  if (value === "custom") {
    return "定制计费";
  }
  return "试用转付费";
}

function permissionPolicyLabel(value: CreateTenantPermissionPolicy) {
  if (value === "restricted") {
    return "受限权限";
  }
  if (value === "custom") {
    return "自定义 RBAC";
  }
  return "默认权限";
}

function auditLevelLabel(value: CreateTenantAuditLevel) {
  if (value === "strict") {
    return "严格审计";
  }
  if (value === "basic") {
    return "基础审计";
  }
  return "标准审计";
}

function routingPolicyLabel(value: CreateTenantRoutingPolicy) {
  if (value === "cost-first") {
    return "成本优先";
  }
  if (value === "quality-first") {
    return "质量优先";
  }
  if (value === "private-first") {
    return "私有资源优先";
  }
  return "默认路由";
}

function isolationLevelLabel(value: CreateTenantIsolationLevel) {
  if (value === "private") {
    return "私有隔离";
  }
  if (value === "dedicated") {
    return "专属资源";
  }
  return "共享资源";
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

function addDaysLabel(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Public helper for enterprise-admin registration deep links (tests + callers). */
export function buildPlatformEnterpriseAdminRegistrationUrl(params: {
  inviteCode: string;
  email?: string;
  adminName?: string;
  activationUrl?: string | null;
}) {
  return activationLinkForInvite(params);
}

function activationLinkForInvite(params: {
  inviteCode: string;
  email?: string;
  adminName?: string;
  activationUrl?: string | null;
}) {
  const fromApi = params.activationUrl?.trim();
  if (fromApi) {
    return fromApi;
  }
  if (!params.inviteCode.trim()) {
    return "创建后生成";
  }
  const url = new URL(`${originForPort("enterprise")}/enterprise/login`);
  url.searchParams.set("authMode", "enterprise-activate");
  url.searchParams.set("code", params.inviteCode.trim());
  const email = params.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  const adminName = params.adminName?.trim();
  if (adminName && (!email || adminName.toLowerCase() !== email.toLowerCase())) {
    url.searchParams.set("name", adminName);
  }
  url.hash = "auth";
  return url.toString();
}

function activationLinkAbsoluteForInvite(params: {
  inviteCode: string;
  email?: string;
  adminName?: string;
  activationUrl?: string | null;
}) {
  return activationLinkForInvite(params);
}

function copyCreateTenantClipboard(value: string, event: Event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement) || !value.trim()) {
    return;
  }
  void navigator.clipboard?.writeText(value).catch(() => undefined);
  const previous = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1600);
}

function createTenantStatusMeta(mode: CreateTenantMode) {
  if (mode === "advanced") {
    return {
      label: "治理审批中",
      tone: "review",
      nextStep: "等待治理审批通过后下发激活材料",
    };
  }
  if (mode === "formal") {
    return {
      label: "正式开通中",
      tone: "formal",
      nextStep: "激活邮件已发送，等待管理员完成首次注册",
    };
  }
  return {
    label: "试用开通中",
    tone: "trial",
    nextStep: "激活邮件已发送，等待管理员完成首次注册",
  };
}

function renderCreateTenantSuccessMetric(label: string, value: unknown, tone?: string) {
  return html`
    <div class="platform-tenant-success__metric">
      <span class="platform-tenant-success__metric-label">${label}</span>
      <strong class="platform-tenant-success__metric-value ${tone ?? ""}">${value}</strong>
    </div>
  `;
}

function renderCreateTenantSuccessCopyField(params: {
  label: string;
  value: string;
  copyValue?: string;
  monospace?: boolean;
}) {
  const copyTarget = params.copyValue ?? params.value;
  const canCopy = Boolean(
    copyTarget.trim() && copyTarget !== "创建后生成" && copyTarget !== "未填写",
  );
  return html`
    <div class="platform-tenant-success__copy-field">
      <span class="platform-tenant-success__copy-label">${params.label}</span>
      <div class="platform-tenant-success__copy-row">
        <code
          class="platform-tenant-success__copy-value ${params.monospace ? "is-mono" : ""}"
          title=${params.value}
        >
          ${params.value}
        </code>
        ${
          canCopy
            ? html`
                <button
                  class="btn btn--sm platform-tenant-success__copy-btn"
                  type="button"
                  @click=${(event: Event) => copyCreateTenantClipboard(copyTarget, event)}
                >
                  ${renderIcon("copy", "platform-tenant-success__copy-icon")} 复制
                </button>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderCreateTenantLocalField(params: {
  label: string;
  value: string;
  onInput: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return renderCreateTenantField({
    label: params.label,
    value: params.value,
    placeholder: params.placeholder,
    disabled: params.disabled,
    onInput: (value) => {
      params.onInput(value);
      requestSystemSettingsRerender();
    },
  });
}

function renderCreateTenantSelect<T extends string>(params: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return html`
    <label class="field platform-tenant-create__field">
      <span>${params.label}</span>
      <select
        .value=${params.value}
        ?disabled=${params.disabled}
        @change=${(event: Event) => {
          params.onChange((event.target as HTMLSelectElement).value as T);
          requestSystemSettingsRerender();
        }}
      >
        ${params.options.map(
          (option) => html`<option value=${option.value}>${option.label}</option>`,
        )}
      </select>
    </label>
  `;
}

function renderCreateTenantSection(params: {
  index: number;
  title: string;
  subtitle: string;
  content: unknown;
}) {
  return html`
    <section class="platform-tenant-create__panel">
      <div class="platform-tenant-create__section-heading">
        <span class="platform-tenant-create__section-index">${params.index}</span>
        <div>
          <div class="platform-tenant-create__section-title">${params.title}</div>
          <div class="platform-tenant-create__section-subtitle">${params.subtitle}</div>
        </div>
      </div>
      ${params.content}
    </section>
  `;
}

function renderCreateTenantModeSelector(params?: { onChange?: (mode: CreateTenantMode) => void }) {
  // Compact pill row: 3 modes condensed into a single segmented control instead
  // of three large cards. Quick-trial covers ~90% of operator usage; the other two
  // shouldn't crowd the first screen.
  return html`
    <div class="platform-tenant-create__mode-pills" role="radiogroup" aria-label="创建模式">
      ${CREATE_TENANT_MODE_OPTIONS.map(
        (option) => html`
          <button
            class="platform-tenant-create__mode-pill ${createTenantMode === option.id ? "is-active" : ""}"
            type="button"
            role="radio"
            aria-checked=${String(createTenantMode === option.id)}
            title=${`${option.description} · 适用于：${option.audience}`}
            @click=${() => {
              setCreateTenantMode(option.id);
              params?.onChange?.(option.id);
            }}
          >
            ${renderIcon(option.icon, "platform-tenant-create__mode-pill-icon")}
            <span>${option.label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function renderCreateTenantChoiceGrid<T extends string>(params: {
  label: string;
  options: Array<{ value: T; label: string; summary: string }>;
  value: T;
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return html`
    <div class="platform-tenant-create__choice-group">
      <div class="platform-tenant-create__choice-label">${params.label}</div>
      <div class="platform-tenant-create__choice-grid">
        ${params.options.map(
          (option) => html`
            <button
              type="button"
              class="platform-tenant-create__choice ${params.value === option.value ? "is-active" : ""}"
              ?disabled=${params.disabled}
              @click=${() => {
                if (params.disabled) {
                  return;
                }
                params.onChange(option.value);
                requestSystemSettingsRerender();
              }}
            >
              <strong>${option.label}</strong>
              <span>${option.summary}</span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderCreateTenantCheckbox(params: {
  label: string;
  summary?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return html`
    <label class="platform-tenant-create__checkbox">
      <input
        type="checkbox"
        .checked=${params.checked}
        ?disabled=${params.disabled}
        @change=${(event: Event) => params.onChange((event.target as HTMLInputElement).checked)}
      />
      <span>
        <strong>${params.label}</strong>
        ${params.summary ? html`<small>${params.summary}</small>` : nothing}
      </span>
    </label>
  `;
}

function renderCreateTenantPreviewCard(params: {
  title: string;
  action?: unknown;
  content: unknown;
}) {
  return html`
    <section class="platform-tenant-create__preview-card">
      <div class="platform-tenant-create__preview-heading">
        <div class="platform-tenant-create__preview-title">${params.title}</div>
        ${params.action ?? nothing}
      </div>
      ${params.content}
    </section>
  `;
}

function renderCreateTenantKV(items: Array<{ label: string; value: unknown; tone?: string }>) {
  return html`
    <div class="platform-tenant-create__kv">
      ${items.map(
        (item) => html`
          <div class="platform-tenant-create__kv-row">
            <span>${item.label}</span>
            <strong class=${item.tone ?? ""}>${item.value}</strong>
          </div>
        `,
      )}
    </div>
  `;
}

function renderCreateTenantError(
  error: string | null,
  email: string,
  basePath: string,
  authPanelProps: PlatformAuthPanelProps,
) {
  if (!error) {
    return nothing;
  }
  const normalized = error.toLowerCase();
  const looksLikeExistingEmail =
    normalized.includes("email") &&
    (normalized.includes("already") ||
      normalized.includes("registered") ||
      normalized.includes("exists") ||
      normalized.includes("已存在") ||
      normalized.includes("已注册"));

  if (!looksLikeExistingEmail) {
    return html`<div class="callout danger platform-tenant-create__message">${error}</div>`;
  }

  return html`
    <section class="platform-tenant-create__error" role="alert">
      <div class="platform-tenant-create__error-title">该管理员邮箱已存在</div>
      <div class="platform-tenant-create__error-mail">${email || "未填写邮箱"}</div>
      <div class="platform-tenant-create__error-body">
        可能属于已创建企业、其他租户成员，或已完成平台注册账号。
      </div>
      <div class="platform-tenant-create__error-actions">
        <a
          class="btn btn--sm"
          href=${pathForTab("platformTenants", basePath)}
          @click=${(event: MouseEvent) => followPortHref(event, pathForTab("platformTenants", basePath))}
        >
          查看现有企业
        </a>
        <button
          class="btn btn--sm"
          type="button"
          disabled
          title="邀请加入当前企业需要成员邀请接口，当前不可执行"
        >
          邀请加入当前企业
        </button>
        <button
          class="btn btn--sm btn--primary"
          type="button"
          @click=${() => authPanelProps.onEmailChange("")}
        >
          更换管理员
        </button>
      </div>
    </section>
  `;
}

function renderCreateTenantAutomationList(items: string[]) {
  return html`
    <div class="platform-tenant-create__automation-list">
      ${items.map(
        (item) => html`
          <div class="platform-tenant-create__automation-item">
            ${renderIcon("checkCircle", "platform-tenant-create__automation-icon")}
            <span>${item}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderQuickTrialTenantForm(params: {
  authPanelProps: PlatformAuthPanelProps;
  defaultTrialDays: number;
  defaultSeatCount: number;
}) {
  const { authPanelProps, defaultTrialDays, defaultSeatCount } = params;
  // Single compact form. No section numbers, no side panel — quick-trial only
  // needs name + admin + email; trial bounds collapse into a details panel.
  return html`
    <section class="platform-tenant-create__quick">
      <div class="platform-tenant-create__field-grid platform-tenant-create__field-grid--compact">
        ${renderCreateTenantField({
          label: "企业名称",
          value: authPanelProps.tenantName,
          placeholder: "例如 极光科技",
          required: true,
          disabled: authPanelProps.busy,
          onInput: authPanelProps.onTenantNameChange,
        })}
        ${renderCreateTenantField({
          label: "管理员姓名",
          value: authPanelProps.displayName,
          placeholder: "请输入管理员姓名",
          required: true,
          disabled: authPanelProps.busy,
          onInput: authPanelProps.onDisplayNameChange,
        })}
        ${renderCreateTenantField({
          label: "管理员邮箱",
          value: authPanelProps.email,
          placeholder: "admin@example.com",
          type: "email",
          required: true,
          disabled: authPanelProps.busy,
          onInput: authPanelProps.onEmailChange,
        })}
      </div>

      <details class="platform-tenant-create__quick-advanced">
        <summary>更多设置（试用时长 / 用户上限）</summary>
        <div class="platform-tenant-create__field-grid platform-tenant-create__field-grid--compact">
          ${renderCreateTenantField({
            label: "试用时长",
            value: authPanelProps.instanceTrialDays,
            placeholder: `默认 ${defaultTrialDays} 天`,
            type: "number",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceTrialDaysChange,
          })}
          ${renderCreateTenantField({
            label: "用户数量上限",
            value: authPanelProps.instanceSeatCount,
            placeholder: `默认 ${defaultSeatCount} 人`,
            type: "number",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceSeatCountChange,
          })}
        </div>
      </details>

      <div class="platform-tenant-create__quick-summary">
        将自动应用：Starter Trial 套餐 · 默认 AI 助手 · 成本上限 $100/月 · 试用结束自动冻结
      </div>
    </section>
  `;
}

function renderFormalWizardStepBar() {
  const steps: Array<{ id: FormalWizardStep; label: string }> = [
    { id: 1, label: "企业身份" },
    { id: 2, label: "商业与 AI" },
    { id: 3, label: "安全与激活" },
  ];
  return html`
    <ol class="platform-tenant-create__wizard-bar" role="list">
      ${steps.map(
        (step) => html`
          <li
            class="platform-tenant-create__wizard-step ${
              formalWizardStep === step.id
                ? "is-active"
                : formalWizardStep > step.id
                  ? "is-done"
                  : ""
            }"
          >
            <span class="platform-tenant-create__wizard-num">${step.id}</span>
            <span class="platform-tenant-create__wizard-label">${step.label}</span>
          </li>
        `,
      )}
    </ol>
  `;
}

function isFormalStepValid(
  step: FormalWizardStep,
  authPanelProps: PlatformAuthPanelProps,
): boolean {
  if (step === 1) {
    return Boolean(
      authPanelProps.tenantName.trim() &&
      authPanelProps.displayName.trim() &&
      authPanelProps.email.trim(),
    );
  }
  // Step 2 & 3 only have selects with defaults; treat as valid.
  return true;
}

function setFormalWizardStep(next: FormalWizardStep) {
  formalWizardStep = next;
  requestSystemSettingsRerender();
}

function renderFormalTenantForm(params: {
  props: PlatformSurfaceProps;
  authPanelProps: PlatformAuthPanelProps;
  defaultTrialDays: number;
  defaultSeatCount: number;
  upgradeUrlPlaceholder: string;
  contactAdvisorUrlPlaceholder: string;
}) {
  const {
    props,
    authPanelProps,
    defaultTrialDays,
    defaultSeatCount,
    upgradeUrlPlaceholder,
    contactAdvisorUrlPlaceholder,
  } = params;
  const step = formalWizardStep;
  const stepBody =
    step === 1
      ? renderFormalIdentityStep(authPanelProps)
      : step === 2
        ? renderFormalCommerceAiStep({
            props,
            authPanelProps,
            defaultTrialDays,
            defaultSeatCount,
            upgradeUrlPlaceholder,
            contactAdvisorUrlPlaceholder,
          })
        : renderFormalSecurityActivationStep(authPanelProps);
  const canAdvance = isFormalStepValid(step, authPanelProps);
  return html`
    ${renderFormalWizardStepBar()} ${stepBody}
    <div class="platform-tenant-create__wizard-nav">
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${step === 1 || authPanelProps.busy}
        @click=${() => setFormalWizardStep((step - 1) as FormalWizardStep)}
      >
        上一步
      </button>
      ${
        step < 3
          ? html`
              <button
                class="btn btn--sm btn--primary"
                type="button"
                ?disabled=${!canAdvance || authPanelProps.busy}
                title=${canAdvance ? "" : "请先完成必填字段"}
                @click=${() => setFormalWizardStep((step + 1) as FormalWizardStep)}
              >
                下一步
              </button>
            `
          : nothing
      }
    </div>
  `;
}

function renderFormalIdentityStep(authPanelProps: PlatformAuthPanelProps) {
  return html`
    ${renderCreateTenantSection({
      index: 1,
      title: "企业信息",
      subtitle: "企业身份、管理员、来源与客户负责人。",
      content: html`
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantField({
            label: "企业名称",
            value: authPanelProps.tenantName,
            placeholder: "例如 极光科技",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onTenantNameChange,
          })}
          ${renderCreateTenantSelect({
            label: "企业来源",
            value: createTenantSource,
            options: CREATE_TENANT_SOURCE_OPTIONS,
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantSource = value;
            },
          })}
          ${renderCreateTenantField({
            label: "管理员姓名",
            value: authPanelProps.displayName,
            placeholder: "请输入管理员姓名",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onDisplayNameChange,
          })}
          ${renderCreateTenantField({
            label: "管理员邮箱",
            value: authPanelProps.email,
            placeholder: "admin@example.com",
            type: "email",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onEmailChange,
          })}
          ${renderCreateTenantLocalField({
            label: "联系方式",
            value: createTenantContactPhone,
            placeholder: "电话 / 企业微信 / 备注",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantContactPhone = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "所属销售",
            value: createTenantSalesOwner,
            placeholder: "销售负责人",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantSalesOwner = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "CSM",
            value: createTenantSuccessOwner,
            placeholder: "客户成功负责人",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantSuccessOwner = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "运营负责人",
            value: createTenantOpsOwner,
            placeholder: "平台运营 Owner",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantOpsOwner = value;
            },
          })}
        </div>
      `,
    })}
  `;
}

function renderFormalCommerceAiStep(params: {
  props: PlatformSurfaceProps;
  authPanelProps: PlatformAuthPanelProps;
  defaultTrialDays: number;
  defaultSeatCount: number;
  upgradeUrlPlaceholder: string;
  contactAdvisorUrlPlaceholder: string;
}) {
  const {
    props,
    authPanelProps,
    defaultTrialDays,
    defaultSeatCount,
    upgradeUrlPlaceholder,
    contactAdvisorUrlPlaceholder,
  } = params;
  return html`
    ${renderCreateTenantSection({
      index: 2,
      title: "商业配置",
      subtitle: "套餐、席位、试用转正式、SLA 与计费方式。",
      content: html`
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantSelect({
            label: "套餐",
            value: createTenantPlan,
            options: CREATE_TENANT_PLAN_OPTIONS.filter(
              (option) => option.value !== "starter-trial",
            ).map((option) => ({ value: option.value, label: option.label })),
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantPlan = value;
            },
          })}
          ${renderCreateTenantField({
            label: "用户席位",
            value: authPanelProps.instanceSeatCount,
            placeholder: `默认 ${defaultSeatCount}`,
            type: "number",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceSeatCountChange,
          })}
          ${renderCreateTenantField({
            label: "试用天数",
            value: authPanelProps.instanceTrialDays,
            placeholder: `默认 ${defaultTrialDays}`,
            type: "number",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceTrialDaysChange,
          })}
          ${renderCreateTenantSelect({
            label: "试用转正式策略",
            value: createTenantUpgradePolicy,
            options: [
              { value: "auto", label: "自动升级" },
              { value: "manual", label: "手动升级" },
              { value: "pause", label: "试用结束后暂停" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantUpgradePolicy = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "SLA 等级",
            value: createTenantSlaLevel,
            options: [
              { value: "standard", label: "Standard SLA" },
              { value: "premium", label: "Premium SLA" },
              { value: "mission-critical", label: "Mission Critical SLA" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantSlaLevel = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "计费方式",
            value: createTenantBillingMode,
            options: [
              { value: "trial-to-paid", label: "试用转付费" },
              { value: "prepaid", label: "预付费" },
              { value: "contract", label: "合同计费" },
              { value: "custom", label: "定制计费" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantBillingMode = value;
            },
          })}
          ${renderCreateTenantField({
            label: "升级套餐链接",
            value: authPanelProps.instanceUpgradeUrl,
            placeholder: upgradeUrlPlaceholder,
            type: "url",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceUpgradeUrlChange,
          })}
          ${renderCreateTenantField({
            label: "联系顾问链接",
            value: authPanelProps.instanceContactAdvisorUrl,
            placeholder: contactAdvisorUrlPlaceholder,
            type: "url",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceContactAdvisorUrlChange,
          })}
        </div>
      `,
    })}
    ${renderCreateTenantSection({
      index: 3,
      title: "AI 默认配置",
      subtitle: "为正式企业配置默认模型方案、能力包和初始 Agent 模板。",
      content: html`
        <div class="platform-tenant-create__split">
          <div class="platform-tenant-create__subpanel">
            <div class="platform-tenant-create__subpanel-title">
              默认模型方案
              <a
                href=${pathForTab("platformModels", props.basePath)}
                @click=${(event: MouseEvent) =>
                  followPortHref(event, pathForTab("platformModels", props.basePath))}
              >
                查看方案详情
              </a>
            </div>
            <div
              class="platform-tenant-create__field-grid platform-tenant-create__field-grid--compact"
            >
              ${renderCreateTenantSelect({
                label: "文本方案",
                value: createTenantTextModel,
                options: [
                  {
                    value: "auto",
                    label: `平台默认：${resolveCreateTenantDefaultTextModel(props)}`,
                  },
                  { value: "gpt-4-1-mini", label: "GPT-4.1-mini（经济型）" },
                  { value: "gpt-4-1", label: "GPT-4.1" },
                ],
                disabled: authPanelProps.busy,
                onChange: (value) => {
                  createTenantTextModel = value;
                },
              })}
              ${renderCreateTenantSelect({
                label: "推理方案",
                value: createTenantReasoningModel,
                options: [
                  { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
                  { value: "gpt-4-1-mini", label: "GPT-4.1-mini" },
                ],
                disabled: authPanelProps.busy,
                onChange: (value) => {
                  createTenantReasoningModel = value;
                },
              })}
              ${renderCreateTenantSelect({
                label: "图片方案",
                value: createTenantImageModel,
                options: [
                  { value: "disabled", label: "disabled" },
                  {
                    value: "auto",
                    label: `平台默认：${resolveCreateTenantDefaultImageModel(props)}`,
                  },
                  { value: "dall-e-3", label: "DALL-E 3" },
                  { value: "gpt-image-1", label: "GPT Image 1" },
                ],
                disabled: authPanelProps.busy,
                onChange: (value) => {
                  createTenantImageModel = value;
                },
              })}
            </div>
          </div>
          <div class="platform-tenant-create__subpanel">
            ${renderCreateTenantChoiceGrid({
              label: "默认能力包",
              options: CREATE_TENANT_BUNDLE_OPTIONS,
              value: createTenantCapabilityBundle,
              onChange: (value) => {
                createTenantCapabilityBundle = value;
              },
            })}
          </div>
        </div>
        <div class="platform-tenant-create__agent-template-grid">
          ${CREATE_TENANT_AGENT_TEMPLATE_OPTIONS.map((option) =>
            renderCreateTenantCheckbox({
              label: option.label,
              summary: option.summary,
              checked: createTenantAgentTemplates.has(option.value),
              disabled: authPanelProps.busy,
              onChange: (checked) => setAgentTemplate(option.value, checked),
            }),
          )}
        </div>
      `,
    })}
  `;
}

function renderFormalSecurityActivationStep(authPanelProps: PlatformAuthPanelProps) {
  return html`
    ${renderCreateTenantSection({
      index: 4,
      title: "安全配置",
      subtitle: "正式企业只配置必要的区域、权限与审计等级，高级治理留给高级创建。",
      content: html`
        <div class="platform-tenant-create__field-grid platform-tenant-create__field-grid--three">
          ${renderCreateTenantSelect({
            label: "数据区域",
            value: createTenantRegion,
            options: [
              { value: "mainland", label: "中国大陆" },
              { value: "global", label: "全球路由" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantRegion = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "默认权限策略",
            value: createTenantPermissionPolicy,
            options: [
              { value: "default", label: "默认权限" },
              { value: "restricted", label: "受限权限" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantPermissionPolicy = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "审计等级",
            value: createTenantAuditLevel,
            options: [
              { value: "basic", label: "基础审计" },
              { value: "standard", label: "标准审计" },
              { value: "strict", label: "严格审计" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantAuditLevel = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "安全策略",
            value: createTenantSecurityPolicy,
            options: [
              { value: "standard", label: "标准安全" },
              { value: "strict", label: "增强安全" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantSecurityPolicy = value;
            },
          })}
        </div>
      `,
    })}
    ${renderCreateTenantActivationSection(5, authPanelProps)}
  `;
}

function renderCreateTenantActivationSection(
  index: number,
  authPanelProps: PlatformAuthPanelProps,
) {
  return renderCreateTenantSection({
    index,
    title: "激活与通知",
    subtitle: "配置管理员激活、邀请码与激活链接交付方式。",
    content: html`
      <div class="platform-tenant-create__activation-grid">
        ${renderCreateTenantCheckbox({
          label: "发送激活邮件",
          summary: "向管理员邮箱发送激活链接",
          checked: createTenantActivationActions.has("email"),
          disabled: authPanelProps.busy,
          onChange: (checked) => setActivationAction("email", checked),
        })}
        ${renderCreateTenantCheckbox({
          label: "生成邀请码",
          summary: "创建后可手动分发给管理员",
          checked: createTenantActivationActions.has("invite"),
          disabled: authPanelProps.busy,
          onChange: (checked) => setActivationAction("invite", checked),
        })}
        ${renderCreateTenantCheckbox({
          label: "复制激活链接",
          summary: "创建后在结果页展示链接",
          checked: createTenantActivationActions.has("link"),
          disabled: authPanelProps.busy,
          onChange: (checked) => setActivationAction("link", checked),
        })}
      </div>
    `,
  });
}

function renderAdvancedTenantDetails(params: {
  authPanelProps: PlatformAuthPanelProps;
  upgradeUrlPlaceholder: string;
  contactAdvisorUrlPlaceholder: string;
}) {
  const { authPanelProps, upgradeUrlPlaceholder, contactAdvisorUrlPlaceholder } = params;
  return html`
    <div class="platform-tenant-create__advanced-stack">
      <details class="platform-tenant-create__advanced-panel" open>
        <summary>平台治理</summary>
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantLocalField({
            label: "租户 Owner",
            value: createTenantTenantOwner,
            placeholder: "最终业务 Owner",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantTenantOwner = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "平台运营负责人",
            value: createTenantOpsOwner,
            placeholder: "平台运营 Owner",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantOpsOwner = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "安全负责人",
            value: createTenantSecurityOwner,
            placeholder: "安全负责人",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantSecurityOwner = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "审计负责人",
            value: createTenantAuditOwner,
            placeholder: "审计负责人",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantAuditOwner = value;
            },
          })}
        </div>
      </details>

      <details class="platform-tenant-create__advanced-panel" open>
        <summary>AI 治理</summary>
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantLocalField({
            label: "模型白名单",
            value: createTenantModelAllowlist,
            placeholder: "gpt-4.1, claude-3.5, private-llm",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantModelAllowlist = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "Provider 白名单",
            value: createTenantProviderAllowlist,
            placeholder: "openai, anthropic, private",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantProviderAllowlist = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "默认路由策略",
            value: createTenantRoutingPolicy,
            options: [
              { value: "default", label: "默认路由" },
              { value: "cost-first", label: "成本优先" },
              { value: "quality-first", label: "质量优先" },
              { value: "private-first", label: "私有资源优先" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantRoutingPolicy = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "推理预算",
            value: createTenantInferenceBudget,
            placeholder: "例如 $5000 / 月",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantInferenceBudget = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "多模型 fallback",
            value: createTenantModelFallback,
            placeholder: "enabled / disabled / custom",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantModelFallback = value;
            },
          })}
        </div>
      </details>

      <details class="platform-tenant-create__advanced-panel">
        <summary>安全治理</summary>
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantLocalField({
            label: "IP 白名单",
            value: createTenantIpAllowlist,
            placeholder: "10.0.0.0/8, 203.0.113.12",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantIpAllowlist = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "SSO",
            value: createTenantSsoProvider,
            placeholder: "Okta / Azure AD / SAML",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantSsoProvider = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "RBAC",
            value: createTenantRbacPreset,
            options: [
              { value: "default", label: "默认权限" },
              { value: "restricted", label: "受限权限" },
              { value: "custom", label: "自定义 RBAC" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantRbacPreset = value;
              createTenantPermissionPolicy = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "数据隔离",
            value: createTenantDataIsolation,
            options: [
              { value: "shared", label: "共享资源" },
              { value: "dedicated", label: "专属资源" },
              { value: "private", label: "私有隔离" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantDataIsolation = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "数据驻留区域",
            value: createTenantRegion,
            options: [
              { value: "mainland", label: "中国大陆" },
              { value: "global", label: "全球路由" },
              { value: "private", label: "专属路由" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantRegion = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "审计保留周期",
            value: createTenantAuditRetention,
            placeholder: "365",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantAuditRetention = value;
            },
          })}
        </div>
      </details>

      <details class="platform-tenant-create__advanced-panel">
        <summary>资源隔离</summary>
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantLocalField({
            label: "独立资源池",
            value: createTenantResourcePool,
            placeholder: "resource-pool-cn-finance",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantResourcePool = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "专属 Agent Runtime",
            value: createTenantDedicatedRuntime,
            placeholder: "runtime-enterprise-a",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantDedicatedRuntime = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "私有向量库",
            value: createTenantVectorStore,
            placeholder: "private-vector-store",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantVectorStore = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "私有模型网关",
            value: createTenantPrivateGateway,
            placeholder: "model-gateway-private",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantPrivateGateway = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "Kubernetes Cluster",
            value: createTenantKubernetesCluster,
            placeholder: "cluster-prod-cn-01",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantKubernetesCluster = value;
            },
          })}
        </div>
      </details>

      <details class="platform-tenant-create__advanced-panel">
        <summary>商业 SLA</summary>
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantSelect({
            label: "专属套餐",
            value: createTenantPlan,
            options: CREATE_TENANT_PLAN_OPTIONS.filter(
              (option) => option.value !== "starter-trial",
            ).map((option) => ({ value: option.value, label: option.label })),
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantPlan = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "SLA",
            value: createTenantSlaLevel,
            options: [
              { value: "standard", label: "Standard SLA" },
              { value: "premium", label: "Premium SLA" },
              { value: "mission-critical", label: "Mission Critical SLA" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantSlaLevel = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "成本上限",
            value: createTenantCostCap,
            placeholder: "例如 $20000 / 月",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantCostCap = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "超额策略",
            value: createTenantOveragePolicy,
            placeholder: "freeze / notify / custom",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantOveragePolicy = value;
            },
          })}
          ${renderCreateTenantLocalField({
            label: "预算冻结",
            value: createTenantBudgetFreeze,
            placeholder: "enabled / manual / custom",
            disabled: authPanelProps.busy,
            onInput: (value) => {
              createTenantBudgetFreeze = value;
            },
          })}
          ${renderCreateTenantSelect({
            label: "计费方式",
            value: createTenantBillingMode,
            options: [
              { value: "trial-to-paid", label: "试用转付费" },
              { value: "prepaid", label: "预付费" },
              { value: "contract", label: "合同计费" },
              { value: "custom", label: "定制计费" },
            ],
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantBillingMode = value;
            },
          })}
          ${renderCreateTenantField({
            label: "升级套餐链接",
            value: authPanelProps.instanceUpgradeUrl,
            placeholder: upgradeUrlPlaceholder,
            type: "url",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceUpgradeUrlChange,
          })}
          ${renderCreateTenantField({
            label: "联系顾问链接",
            value: authPanelProps.instanceContactAdvisorUrl,
            placeholder: contactAdvisorUrlPlaceholder,
            type: "url",
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onInstanceContactAdvisorUrlChange,
          })}
        </div>
      </details>
    </div>
  `;
}

function renderAdvancedTenantForm(params: {
  authPanelProps: PlatformAuthPanelProps;
  upgradeUrlPlaceholder: string;
  contactAdvisorUrlPlaceholder: string;
}) {
  const { authPanelProps, upgradeUrlPlaceholder, contactAdvisorUrlPlaceholder } = params;
  return html`
    ${renderCreateTenantSection({
      index: 1,
      title: "基础配置",
      subtitle: "高级创建先定义租户身份、Owner 与审批入口，再进入治理配置。",
      content: html`
        <div class="platform-tenant-create__field-grid">
          ${renderCreateTenantField({
            label: "企业名称",
            value: authPanelProps.tenantName,
            placeholder: "例如 极光科技",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onTenantNameChange,
          })}
          ${renderCreateTenantSelect({
            label: "企业来源",
            value: createTenantSource,
            options: CREATE_TENANT_SOURCE_OPTIONS,
            disabled: authPanelProps.busy,
            onChange: (value) => {
              createTenantSource = value;
            },
          })}
          ${renderCreateTenantField({
            label: "管理员姓名",
            value: authPanelProps.displayName,
            placeholder: "请输入管理员姓名",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onDisplayNameChange,
          })}
          ${renderCreateTenantField({
            label: "管理员邮箱",
            value: authPanelProps.email,
            placeholder: "admin@example.com",
            type: "email",
            required: true,
            disabled: authPanelProps.busy,
            onInput: authPanelProps.onEmailChange,
          })}
        </div>
      `,
    })}
    ${renderCreateTenantSection({
      index: 2,
      title: "高级创建流程",
      subtitle: "分阶段配置 AI 治理、安全治理、资源隔离、组织责任人与商业 SLA。",
      content: renderAdvancedTenantDetails({
        authPanelProps,
        upgradeUrlPlaceholder,
        contactAdvisorUrlPlaceholder,
      }),
    })}
    ${renderCreateTenantSection({
      index: 3,
      title: "审批与激活",
      subtitle: "高级租户提交后进入平台治理审批，审批通过后再生成激活材料。",
      content: html`
        <div class="platform-tenant-create__approval-note">
          ${renderIcon("shieldCheck", "platform-tenant-create__approval-icon")}
          <div>
            <strong>需要平台治理审批</strong>
            <span>审批链将校验模型白名单、数据隔离、预算冻结和专属资源池。</span>
          </div>
        </div>
        <div class="platform-tenant-create__activation-grid">
          ${renderCreateTenantCheckbox({
            label: "审批后发送激活邮件",
            summary: "审批通过后自动通知管理员",
            checked: createTenantActivationActions.has("email"),
            disabled: authPanelProps.busy,
            onChange: (checked) => setActivationAction("email", checked),
          })}
          ${renderCreateTenantCheckbox({
            label: "审批后生成邀请码",
            summary: "审批通过后生成并记录",
            checked: createTenantActivationActions.has("invite"),
            disabled: authPanelProps.busy,
            onChange: (checked) => setActivationAction("invite", checked),
          })}
          ${renderCreateTenantCheckbox({
            label: "审批后复制激活链接",
            summary: "结果页保留交付入口",
            checked: createTenantActivationActions.has("link"),
            disabled: authPanelProps.busy,
            onChange: (checked) => setActivationAction("link", checked),
          })}
        </div>
      `,
    })}
  `;
}

function renderCreateTenantResult(params: {
  props: PlatformSurfaceProps;
  authPanelProps: PlatformAuthPanelProps;
  mode: CreateTenantMode;
  trialDays: number;
  inviteCode: string;
  tenantId: string;
  planLabel: string;
  bundleLabel: string;
}) {
  const tenantName = params.authPanelProps.tenantName.trim() || "新企业租户";
  const adminEmail = params.authPanelProps.email.trim() || "未填写";
  const adminName = params.authPanelProps.displayName.trim();
  const pending = params.authPanelProps.state?.pendingActivation;
  const enterpriseId =
    pending?.enterpriseId?.trim() ||
    params.authPanelProps.instanceEnterpriseId.trim() ||
    params.tenantId;
  const activationLink = activationLinkAbsoluteForInvite({
    inviteCode: params.inviteCode,
    email: adminEmail === "未填写" ? undefined : adminEmail,
    adminName: adminName || undefined,
    activationUrl: pending?.activationUrl,
  });
  const statusMeta = createTenantStatusMeta(params.mode);
  const resultKicker =
    params.mode === "advanced"
      ? "高级创建申请已提交"
      : params.mode === "formal"
        ? "正式企业已创建"
        : "试用企业已创建";
  const trialEndLabel = params.mode === "advanced" ? "审批后确认" : addDaysLabel(params.trialDays);
  const tenantsHref = pathForTab("platformTenants", params.props.basePath);
  const smtpConfigured = params.authPanelProps.state?.smtpConfigured !== false;
  const sendActivationEmail = () => {
    if (!enterpriseId || enterpriseId === "pending") {
      return;
    }
    void params.props.actions.tenants.onResendEnterpriseAdminActivation({
      enterpriseId,
    });
  };

  return html`
    <div class="platform-tenant-success" role="status" aria-live="polite">
      <div class="platform-tenant-success__backdrop" aria-hidden="true"></div>
      <div class="platform-tenant-success__shell">
        <header class="platform-tenant-success__hero">
          <div class="platform-tenant-success__badge" aria-hidden="true">
            ${renderIcon("checkCircle", "platform-tenant-success__badge-icon")}
          </div>
          <p class="platform-tenant-success__kicker">${resultKicker}</p>
          <h1 class="platform-tenant-success__title">${tenantName}</h1>
          <div class="platform-tenant-success__meta-row">
            <span
              class="platform-tenant-success__status platform-tenant-success__status--${statusMeta.tone}"
            >
              ${statusMeta.label}
            </span>
            <span class="platform-tenant-success__meta-note">${statusMeta.nextStep}</span>
          </div>
        </header>

        <div class="platform-tenant-success__cards">
          <section class="platform-tenant-success__card">
            <div class="platform-tenant-success__card-head">
              <h2 class="platform-tenant-success__card-title">租户概览</h2>
              <span class="platform-tenant-success__card-hint">已写入平台租户目录</span>
            </div>
            <div class="platform-tenant-success__metric-grid">
              ${renderCreateTenantSuccessMetric("Tenant ID", params.tenantId)}
              ${renderCreateTenantSuccessMetric("套餐", params.planLabel)}
              ${renderCreateTenantSuccessMetric("能力包", params.bundleLabel)}
              ${renderCreateTenantSuccessMetric("试用结束", trialEndLabel, "is-accent")}
            </div>
          </section>

          <section class="platform-tenant-success__card platform-tenant-success__card--delivery">
            <div class="platform-tenant-success__card-head">
              <h2 class="platform-tenant-success__card-title">激活交付</h2>
              <span class="platform-tenant-success__card-hint">发送给企业管理员的开通材料</span>
            </div>
            <div class="platform-tenant-success__copy-stack">
              ${renderCreateTenantSuccessCopyField({
                label: "管理员激活码",
                value: params.inviteCode || "已生成",
                copyValue: params.inviteCode,
                monospace: true,
              })}
              ${renderCreateTenantSuccessCopyField({
                label: "管理员邮箱",
                value: adminEmail,
                copyValue: adminEmail === "未填写" ? "" : adminEmail,
              })}
              ${renderCreateTenantSuccessCopyField({
                label: "管理员注册地址",
                value: activationLink,
                copyValue: activationLink === "创建后生成" ? "" : activationLink,
                monospace: true,
              })}
            </div>
          </section>
        </div>

        <section class="platform-tenant-success__next">
          <h2 class="platform-tenant-success__next-title">建议后续步骤</h2>
          <ol class="platform-tenant-success__steps">
            <li>查看下方邮件回执；需要时点击「给管理员发邮件」再发一次邀请码和注册地址</li>
            <li>管理员打开注册地址，完成企业账号激活与首次登录</li>
            <li>回到平台租户详情，按需配置模型策略与能力包</li>
          </ol>
        </section>

        <footer class="platform-tenant-success__actions">
          ${
            params.authPanelProps.busy
              ? html`<div class="callout" data-admin-email-receipt="pending" role="status">
                  正在发送至 ${adminEmail}…
                </div>`
              : params.authPanelProps.error
                ? html`<div class="callout danger" data-admin-email-receipt="error" role="status">
                    ${params.authPanelProps.error}
                  </div>`
                : params.authPanelProps.notice
                  ? html`<div class="callout success" data-admin-email-receipt="ok" role="status">
                      ${params.authPanelProps.notice}
                    </div>`
                  : html`
                      <div class="callout" data-admin-email-receipt="idle" role="status">
                        点击「给管理员发邮件」后，这里会显示是否已发出。
                      </div>
                    `
          }
          <button
            class="btn btn--primary platform-tenant-success__primary-action"
            type="button"
            ?disabled=${
              params.authPanelProps.busy ||
              !enterpriseId ||
              enterpriseId === "pending" ||
              adminEmail === "未填写" ||
              !smtpConfigured
            }
            title=${
              !smtpConfigured
                ? "SMTP 未配置，无法发送邮件"
                : enterpriseId === "pending"
                  ? "企业标识尚未就绪"
                  : "向管理员重发邀请码与注册地址"
            }
            @click=${sendActivationEmail}
          >
            ${params.authPanelProps.busy ? "发送中…" : "给管理员发邮件"}
          </button>
          <div class="platform-tenant-success__secondary-actions">
            <a
              class="btn"
              href=${tenantsHref}
              @click=${(event: MouseEvent) => followPortHref(event, tenantsHref)}
            >
              返回租户列表
            </a>
            <a
              class="platform-tenant-success__text-action"
              href=${pathForTab("platformModels", params.props.basePath)}
              @click=${(event: MouseEvent) =>
                followPortHref(event, pathForTab("platformModels", params.props.basePath))}
            >
              配置模型策略
            </a>
            <a
              class="platform-tenant-success__text-action"
              href=${pathForTab("platformCapabilities", params.props.basePath)}
              @click=${(event: MouseEvent) =>
                followPortHref(event, pathForTab("platformCapabilities", params.props.basePath))}
            >
              配置能力包
            </a>
          </div>
        </footer>
      </div>
    </div>
  `;
}

export function resolvePlatformCreateTenantInviteCode(
  authPanelProps: PlatformAuthPanelProps | null | undefined,
): string {
  if (!authPanelProps) {
    return "";
  }
  const latestInvite = authPanelProps.state?.latestInvite;
  return authPanelProps.inviteCode.trim() || latestInvite?.code || "";
}

function renderCreateTenantSidebar(params: {
  authPanelProps: PlatformAuthPanelProps;
  mode: CreateTenantMode;
  trialDays: number;
  seatCount: number;
  plan: (typeof CREATE_TENANT_PLAN_OPTIONS)[number];
  bundle: (typeof CREATE_TENANT_BUNDLE_OPTIONS)[number];
  textModel: string;
  imageModel: string;
  reasoningModel: string;
  monthlyCalls: number;
  monthlyTokens: number;
  storageGb: number;
  agentQuota: number;
  hasModelDefaults: boolean;
}) {
  const {
    authPanelProps,
    mode,
    trialDays,
    seatCount,
    plan,
    bundle,
    textModel,
    imageModel,
    reasoningModel,
    monthlyCalls,
    monthlyTokens,
    storageGb,
    agentQuota,
    hasModelDefaults,
  } = params;

  if (mode === "quick-trial") {
    return html`
      ${renderCreateTenantPreviewCard({
        title: "试用模式自动化",
        action: html`
          <button class="btn btn--sm" type="button" @click=${resetCreateTenantPreview}>
            重置预览
          </button>
        `,
        content: renderCreateTenantAutomationList([
          "自动配置 AI 能力",
          "自动分配试用资源",
          "自动启用安全限制",
          "自动回收机制",
        ]),
      })}
      ${renderCreateTenantPreviewCard({
        title: "默认策略预览",
        content: html`
          ${renderCreateTenantKV([
            { label: "将应用", value: "Starter Trial Policy", tone: "is-ok" },
            { label: "套餐", value: plan.label },
            { label: "能力环境", value: "AI 基础协作" },
            { label: "初始 Agent", value: "企业助手 / 文档助手" },
            { label: "成本保护", value: "$100 月度上限" },
            { label: "回收策略", value: `${trialDays} 天后自动冻结` },
          ])}
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "资源保护",
        content: html`
          <div class="platform-tenant-create__quota-grid">
            ${[
              { label: "用户上限", value: `${seatCount} 人` },
              { label: "可创建 Agent", value: `${agentQuota} 个` },
              { label: "月度调用", value: `${formatCompactNumber(monthlyCalls)} 次` },
              { label: "存储空间", value: `${storageGb} GB` },
            ].map(
              (item) => html`
                <div class="platform-tenant-create__quota-item">
                  <span>${item.label}</span>
                  <strong>${item.value}</strong>
                </div>
              `,
            )}
          </div>
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "创建后流程",
        content: html`
          <ol class="platform-tenant-create__steps">
            <li>立即创建试用租户并生成邀请码</li>
            <li>管理员通过邮箱完成首次激活</li>
            <li>系统自动开通默认助手和试用资源</li>
            <li>试用到期后冻结或转正式</li>
          </ol>
        `,
      })}
    `;
  }

  if (mode === "advanced") {
    return html`
      ${renderCreateTenantPreviewCard({
        title: "高级创建预览",
        action: html`
          <button class="btn btn--sm" type="button" @click=${resetCreateTenantPreview}>
            重置预览
          </button>
        `,
        content: html`
          ${renderCreateTenantKV([
            { label: "企业名称", value: authPanelProps.tenantName.trim() || "待填写" },
            { label: "租户 Owner", value: createTenantTenantOwner.trim() || "待填写" },
            { label: "安全负责人", value: createTenantSecurityOwner.trim() || "待填写" },
            { label: "SLA", value: slaLevelLabel(createTenantSlaLevel), tone: "is-ok" },
            { label: "创建来源", value: sourceLabel(createTenantSource) },
          ])}
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "治理策略预览",
        content: html`
          ${renderCreateTenantKV([
            { label: "模型治理", value: createTenantModelAllowlist.trim() || "待配置白名单" },
            {
              label: "Provider 治理",
              value: createTenantProviderAllowlist.trim() || "待配置白名单",
            },
            { label: "路由策略", value: routingPolicyLabel(createTenantRoutingPolicy) },
            { label: "RBAC", value: permissionPolicyLabel(createTenantRbacPreset) },
            { label: "数据隔离", value: isolationLevelLabel(createTenantDataIsolation) },
            { label: "审计保留", value: `${createTenantAuditRetention || "365"} 天` },
          ])}
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "资源隔离预估",
        content: html`
          <div class="platform-tenant-create__quota-grid">
            ${[
              { label: "资源池", value: createTenantResourcePool.trim() || "待分配" },
              { label: "Agent Runtime", value: createTenantDedicatedRuntime.trim() || "待分配" },
              { label: "私有向量库", value: createTenantVectorStore.trim() || "按需启用" },
              { label: "模型网关", value: createTenantPrivateGateway.trim() || "按需启用" },
            ].map(
              (item) => html`
                <div class="platform-tenant-create__quota-item">
                  <span>${item.label}</span>
                  <strong>${item.value}</strong>
                </div>
              `,
            )}
          </div>
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "审批流程",
        content: html`
          <ol class="platform-tenant-create__steps">
            <li>提交高级创建申请</li>
            <li>平台治理审批模型、预算和隔离边界</li>
            <li>资源团队确认隔离边界与客户侧私有模型</li>
            <li>审批通过后生成激活材料</li>
          </ol>
        `,
      })}
      ${renderCreateTenantPreviewCard({
        title: "风险与提醒",
        content: html`
          <div class="platform-tenant-create__risk-list">
            ${[
              `成本上限：${createTenantCostCap.trim() || plan.monthlyBudget}`,
              `超额策略：${createTenantOveragePolicy || "freeze"}`,
              `预算冻结：${createTenantBudgetFreeze || "enabled"}`,
              `${regionLabel(createTenantRegion)} · ${securityPolicyLabel(createTenantSecurityPolicy)}`,
            ].map(
              (item) => html`
                <div class="platform-tenant-create__risk-item is-warn">
                  <span></span>
                  <strong>${item}</strong>
                </div>
              `,
            )}
          </div>
        `,
      })}
    `;
  }

  const riskItems = [
    {
      tone: "ok",
      label: "正式企业将进入长期运营列表",
    },
    {
      tone: hasModelDefaults ? "ok" : "warn",
      label: hasModelDefaults ? "默认模型策略已配置" : "未检测到平台默认文本模型",
    },
    {
      tone: trialDays > 30 ? "warn" : "info",
      label:
        trialDays > 30 ? "试用期超过 30 天，建议确认商业负责人" : "建议试用期内同步关注成本预警",
    },
  ];

  return html`
    ${renderCreateTenantPreviewCard({
      title: "创建预览",
      action: html`
        <button class="btn btn--sm" type="button" @click=${resetCreateTenantPreview}>
          重置预览
        </button>
      `,
      content: html`
        ${renderCreateTenantKV([
          { label: "企业名称", value: authPanelProps.tenantName.trim() || "待填写" },
          { label: "管理员", value: authPanelProps.displayName.trim() || "待填写" },
          { label: "管理员邮箱", value: authPanelProps.email.trim() || "待填写" },
          { label: "用户席位", value: `${seatCount} 人` },
          { label: "套餐", value: plan.label, tone: "is-ok" },
          { label: "SLA", value: slaLevelLabel(createTenantSlaLevel) },
          { label: "计费方式", value: billingModeLabel(createTenantBillingMode) },
          { label: "审计等级", value: auditLevelLabel(createTenantAuditLevel) },
        ])}
      `,
    })}
    ${renderCreateTenantPreviewCard({
      title: "默认策略预览",
      content: html`
        ${renderCreateTenantKV([
          { label: "将应用", value: `${plan.label} Policy` },
          { label: "文本模型方案", value: textModel },
          { label: "推理模型方案", value: reasoningModel },
          { label: "图片模型方案", value: imageModel },
          { label: "能力包", value: `${bundle.label}（${bundle.capabilityCount} 项能力）` },
          { label: "初始 Agent 模板", value: `${createTenantAgentTemplates.size} 个` },
          { label: "最大月成本", value: plan.monthlyBudget },
          { label: "可创建 Agent", value: `${agentQuota} 个` },
        ])}
      `,
    })}
    ${renderCreateTenantPreviewCard({
      title: "资源配额预估",
      content: html`
        <div class="platform-tenant-create__quota-grid">
          ${[
            { label: "月度调用额度", value: `${formatCompactNumber(monthlyCalls)} 次` },
            {
              label: "月度 Token 额度",
              value: monthlyTokens >= 1_000_000 ? `${monthlyTokens / 1_000_000}M` : monthlyTokens,
            },
            { label: "存储空间", value: `${storageGb} GB` },
            { label: "并发任务数", value: String(Math.max(5, Math.ceil(seatCount / 2))) },
          ].map(
            (item) => html`
              <div class="platform-tenant-create__quota-item">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
              </div>
            `,
          )}
        </div>
      `,
    })}
    ${renderCreateTenantPreviewCard({
      title: "创建后流程",
      content: html`
        <ol class="platform-tenant-create__steps">
          <li>创建正式企业租户并生成激活材料</li>
          <li>管理员首次登录完成企业信息完善</li>
          <li>系统应用默认 AI 策略、能力包与安全配置</li>
          <li>进入租户运营列表持续跟进健康与成本</li>
        </ol>
      `,
    })}
    ${renderCreateTenantPreviewCard({
      title: "风险与提醒",
      content: html`
        <div class="platform-tenant-create__risk-list">
          ${riskItems.map(
            (item) => html`
              <div class="platform-tenant-create__risk-item is-${item.tone}">
                <span></span>
                <strong>${item.label}</strong>
              </div>
            `,
          )}
          <div class="platform-tenant-create__risk-item is-info">
            <span></span>
            <strong
              >${regionLabel(createTenantRegion)} ·
              ${securityPolicyLabel(createTenantSecurityPolicy)}</strong
            >
          </div>
          <div class="platform-tenant-create__risk-item is-info">
            <span></span>
            <strong>${upgradePolicyLabel(createTenantUpgradePolicy)}</strong>
          </div>
        </div>
      `,
    })}
  `;
}

export type PlatformCreateTenantWorkspaceOptions = {
  /**
   * Drawer-only flag. When true, the workspace renders quick-trial mode only
   * and hides the mode pill bar. Use the full-page route for the formal /
   * advanced flows.
   */
  quickOnly?: boolean;
};

export function renderPlatformCreateTenantWorkspace(
  props: PlatformSurfaceProps,
  options: PlatformCreateTenantWorkspaceOptions = {},
) {
  if (options.quickOnly && createTenantMode !== "quick-trial") {
    setCreateTenantMode("quick-trial");
  }
  const authPanelProps = props.authPanelProps;
  const authEntryPanelProps = resolveSystemSettingsAuthPanelProps(props.authPanelProps);
  const canManagePlatform = Boolean(
    props.authPanelProps?.state?.canManagePlatform ||
    props.authPanelProps?.state?.availableModes?.includes("platform-enterprise-create") ||
    authEntryPanelProps?.state?.canManagePlatform ||
    authEntryPanelProps?.state?.availableModes?.includes("platform-enterprise-create"),
  );
  return renderCreateTenantWorkspace(
    props,
    authPanelProps,
    authEntryPanelProps,
    canManagePlatform,
    options,
  );
}

function renderCreateTenantWorkspace(
  props: PlatformSurfaceProps,
  authPanelProps: PlatformAuthPanelProps | null | undefined,
  authEntryPanelProps: PlatformAuthPanelProps | null,
  canManagePlatform: boolean,
  options: PlatformCreateTenantWorkspaceOptions = {},
) {
  if (!authPanelProps) {
    return renderAuthEntryFallback(props);
  }
  if (!canManagePlatform) {
    return html`
      <section class="card">
        <div class="card-title">平台管理员登录</div>
        <div class="card-sub">创建租户需要平台管理权限。请先切换到平台管理员账号。</div>
        <div class="card-follow">
          ${authEntryPanelProps ? renderPlatformAuthPanel(authEntryPanelProps) : renderAuthEntryFallback(props)}
        </div>
      </section>
    `;
  }

  const policy = authPanelProps.state?.platformPolicy;
  const isQuickTrialMode = createTenantMode === "quick-trial";
  const isAdvancedMode = createTenantMode === "advanced";
  const defaultTrialDays = policy?.defaultTrialDays ?? 14;
  const defaultSeatCount =
    policy?.defaultTrialSeatCount ?? (isQuickTrialMode ? 5 : isAdvancedMode ? 100 : 20);
  const trialDays = asPositiveInt(authPanelProps.instanceTrialDays, defaultTrialDays);
  const seatCount = asPositiveInt(authPanelProps.instanceSeatCount, defaultSeatCount);
  const plan = selectedPlanProfile();
  const bundle = selectedBundleProfile();
  const textModel = modelLabel(createTenantTextModel, resolveCreateTenantDefaultTextModel(props));
  const imageModel = modelLabel(
    createTenantImageModel,
    resolveCreateTenantDefaultImageModel(props),
  );
  const reasoningModel = modelLabel(createTenantReasoningModel, "Claude 3.5 Haiku");
  const monthlyCalls = seatCount * 10_000;
  const monthlyTokens = seatCount * 2_000_000;
  const storageGb = Math.max(plan.storageGb, seatCount * 4);
  const agentQuota = Math.max(plan.agentQuota, createTenantAgentTemplates.size);
  const latestInvite = props.readModel.latestInvite;
  const inviteCode = resolvePlatformCreateTenantInviteCode(authPanelProps);
  const pendingActivation = authPanelProps.state?.pendingActivation;
  const tenantSlug = authPanelProps.tenantName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const tenantId =
    pendingActivation?.enterpriseId?.trim() ||
    latestInvite?.tenantId ||
    authPanelProps.instanceEnterpriseId.trim() ||
    tenantSlug ||
    "pending";
  const submitDisabled =
    authPanelProps.busy ||
    !authPanelProps.tenantName.trim() ||
    !authPanelProps.email.trim() ||
    (!isQuickTrialMode && !authPanelProps.displayName.trim()) ||
    (isAdvancedMode && !createTenantTenantOwner.trim());
  const submitCreateTenant = () => {
    authPanelProps.onCreationModeChange?.(createTenantMode);
    authPanelProps.onModeChange("platform-enterprise-create");
    authPanelProps.onSubmit();
  };
  const hasModelDefaults = Boolean(
    props.readModel.defaultModelPrimary || props.readModel.configuredModelIds.length,
  );
  const upgradeUrlPlaceholder = policy?.upgradeUrl ?? "https://...";
  const contactAdvisorUrlPlaceholder = policy?.contactAdvisorUrl ?? "https://...";
  const submitLabel = isAdvancedMode
    ? "提交高级创建审批"
    : isQuickTrialMode
      ? "立即创建试用租户"
      : "创建正式企业租户";

  if (inviteCode) {
    return html`
      <section class="platform-tenant-create platform-tenant-create--success">
        ${renderCreateTenantResult({
          props,
          authPanelProps,
          mode: createTenantMode,
          trialDays,
          inviteCode,
          tenantId,
          planLabel: plan.label,
          bundleLabel: bundle.label,
        })}
      </section>
    `;
  }

  return html`
    <section class="platform-tenant-create">
      ${
        options.quickOnly
          ? nothing
          : renderCreateTenantModeSelector({ onChange: authPanelProps.onCreationModeChange })
      }

      <div
        class="platform-tenant-create__layout ${
          isQuickTrialMode ? "platform-tenant-create__layout--single" : ""
        }"
      >
        <div class="platform-tenant-create__main">
          ${
            isQuickTrialMode
              ? renderQuickTrialTenantForm({
                  authPanelProps,
                  defaultTrialDays,
                  defaultSeatCount,
                })
              : isAdvancedMode
                ? renderAdvancedTenantForm({
                    authPanelProps,
                    upgradeUrlPlaceholder,
                    contactAdvisorUrlPlaceholder,
                  })
                : renderFormalTenantForm({
                    props,
                    authPanelProps,
                    defaultTrialDays,
                    defaultSeatCount,
                    upgradeUrlPlaceholder,
                    contactAdvisorUrlPlaceholder,
                  })
          }

          <div class="platform-tenant-create__footer-actions">
            ${
              isQuickTrialMode
                ? nothing
                : html`
                    <button
                      class="btn"
                      type="button"
                      disabled
                      title="草稿保存需要平台草稿接口，当前不可执行"
                    >
                      保存为草稿
                    </button>
                    <a
                      class="btn"
                      href=${platformSystemSettingsHref(props.basePath, "defaults")}
                      @click=${(event: MouseEvent) =>
                        followPortHref(
                          event,
                          platformSystemSettingsHref(props.basePath, "defaults"),
                        )}
                    >
                      调整默认策略
                    </a>
                  `
            }
            ${
              // Formal mode submits only after the user reaches step 3 of the wizard.
              isQuickTrialMode || isAdvancedMode || formalWizardStep === 3
                ? html`
                    <button
                      class="btn btn--primary"
                      type="button"
                      ?disabled=${submitDisabled}
                      @click=${submitCreateTenant}
                    >
                      ${authPanelProps.busy ? "创建中..." : submitLabel}
                    </button>
                  `
                : nothing
            }
          </div>
          ${
            authPanelProps.notice
              ? html`<div class="callout success platform-tenant-create__message">
                  ${authPanelProps.notice}
                </div>`
              : nothing
          }
          ${renderCreateTenantError(authPanelProps.error, authPanelProps.email, props.basePath, authPanelProps)}
        </div>

        ${
          isQuickTrialMode
            ? nothing
            : html`
                <aside class="platform-tenant-create__side" aria-label="创建预览">
                  ${renderCreateTenantSidebar({
                    authPanelProps,
                    mode: createTenantMode,
                    trialDays,
                    seatCount,
                    plan,
                    bundle,
                    textModel,
                    imageModel,
                    reasoningModel,
                    monthlyCalls,
                    monthlyTokens,
                    storageGb,
                    agentQuota,
                    hasModelDefaults,
                  })}
                </aside>
              `
        }
      </div>
    </section>
  `;
}

// ---- Tab: Admins --------------------------------------------------------

type AdminRolePreset = "admin" | "custom";

type AdminPermissionOption = {
  scope: string;
  label: string;
  description: string;
};

const ADMIN_PERMISSION_OPTIONS: AdminPermissionOption[] = [
  { scope: "operator.admin", label: "管理", description: "创建代理、管理技能、配置系统" },
  { scope: "operator.read", label: "读取", description: "查看状态、日志、会话数据" },
  { scope: "operator.write", label: "操作", description: "发送消息、执行任务" },
  { scope: "operator.approvals", label: "审批", description: "处理执行审批请求" },
  { scope: "operator.pairing", label: "配对", description: "设备配对与节点管理" },
];

const ALL_SCOPES = ADMIN_PERMISSION_OPTIONS.map((o) => o.scope);

let createAdminRolePreset: AdminRolePreset = "admin";

function setCreateAdminRolePreset(preset: AdminRolePreset, authPanelProps: PlatformAuthPanelProps) {
  createAdminRolePreset = preset;
  if (preset === "admin") {
    authPanelProps.onPlatformAdminScopesChange([...ALL_SCOPES]);
  } else {
    authPanelProps.onPlatformAdminScopesChange([]);
  }
  requestPlatformSurfaceRerender();
}

function resolveScopesForPlatformAdminCreate(authPanelProps: PlatformAuthPanelProps): string[] {
  if (createAdminRolePreset === "admin") {
    return [...ALL_SCOPES];
  }
  return [...authPanelProps.platformAdminScopes];
}

function resolveAdminTypeLabel(platformRole: string, scopes: string[] | undefined): string {
  if (platformRole === "super-admin") {
    return "超级管理员";
  }
  if (!scopes || scopes.length === ALL_SCOPES.length) {
    return "管理员";
  }
  return "自定义";
}

function renderAdminsTab(
  props: PlatformSurfaceProps,
  authPanelProps: PlatformAuthPanelProps | null,
  canManagePlatform: boolean,
  canManagePlatformAdmins: boolean,
) {
  if (!authPanelProps) {
    return renderAuthEntryFallback(props);
  }
  if (!canManagePlatform) {
    return html`
      <section class="card">
        <div class="card-title">平台管理员登录</div>
        <div class="card-sub">当前会话还没有系统设置权限。请切换到管理员账号。</div>
        <div class="card-follow">${renderPlatformAuthPanel(authPanelProps)}</div>
      </section>
    `;
  }

  const admins = authPanelProps.state?.platformAdmins ?? [];
  const currentUser = authPanelProps.session?.user ?? authPanelProps.state?.session?.user ?? null;
  const currentRole = authPanelProps.state?.platformRole ?? null;
  const selectedScopes = new Set(
    createAdminRolePreset === "admin" ? ALL_SCOPES : authPanelProps.platformAdminScopes,
  );
  const canSubmitCreate =
    Boolean(authPanelProps.onCreatePlatformAdmin) &&
    !authPanelProps.busy &&
    Boolean(authPanelProps.platformAdminEmail.trim()) &&
    Boolean(authPanelProps.platformAdminPassword.trim()) &&
    (createAdminRolePreset === "admin" || selectedScopes.size > 0);

  const createForm = canManagePlatformAdmins
    ? html`
        <section class="card platform-admin-create-card">
          <div class="row row--split">
            <div>
              <div class="card-title">添加管理员</div>
              <div class="card-sub">超级管理员可创建平台管理员并分配权限。</div>
            </div>
          </div>

          <div class="platform-admin-form-grid card-follow">
            <label class="field"
              ><span>邮箱</span
              ><input
                type="email"
                placeholder="admin@example.com"
                autocomplete="username"
                .value=${authPanelProps.platformAdminEmail}
                ?disabled=${authPanelProps.busy}
                @input=${(event: Event) =>
                  authPanelProps.onPlatformAdminEmailChange(
                    (event.target as HTMLInputElement).value,
                  )}
            /></label>
            <label class="field"
              ><span>初始密码</span
              ><input
                type="password"
                placeholder="至少 8 位"
                autocomplete="new-password"
                .value=${authPanelProps.platformAdminPassword}
                ?disabled=${authPanelProps.busy}
                @input=${(event: Event) =>
                  authPanelProps.onPlatformAdminPasswordChange(
                    (event.target as HTMLInputElement).value,
                  )}
            /></label>
            <label class="field"
              ><span>名称</span
              ><input
                type="text"
                placeholder="可选"
                autocomplete="name"
                .value=${authPanelProps.platformAdminDisplayName}
                ?disabled=${authPanelProps.busy}
                @input=${(event: Event) =>
                  authPanelProps.onPlatformAdminDisplayNameChange(
                    (event.target as HTMLInputElement).value,
                  )}
            /></label>
            <div class="platform-admin-form-actions">
              <span class="field-label">角色</span>
              <div class="row row--tight platform-admin-role-row">
                ${(["admin", "custom"] as AdminRolePreset[]).map((preset) => {
                  const labels: Record<AdminRolePreset, string> = {
                    admin: "管理员",
                    custom: "自定义",
                  };
                  const active = createAdminRolePreset === preset;
                  return html`
                    <button
                      type="button"
                      class="btn btn--sm platform-admin-role-btn ${active ? "btn--primary" : ""}"
                      ?disabled=${authPanelProps.busy}
                      @click=${() => setCreateAdminRolePreset(preset, authPanelProps)}
                    >
                      ${labels[preset]}
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>

          <div class="muted platform-admin-password-handoff card-follow--sm">
            请把初始密码告知对方。对方用该邮箱和密码登录；创建时不发送邮件。
          </div>

          ${
            createAdminRolePreset === "admin"
              ? html`
                  <div class="platform-admin-scope-summary card-follow--sm muted">
                    将授予全部平台权限（${ALL_SCOPES.length}/${ALL_SCOPES.length}）
                  </div>
                `
              : html`
                  <div class="platform-admin-scope-grid card-follow--sm">
                    ${ADMIN_PERMISSION_OPTIONS.map((option) => {
                      const checked = selectedScopes.has(option.scope);
                      return html`
                        <label
                          class="platform-admin-scope-option is-custom ${checked ? "is-checked" : "is-muted"}"
                        >
                          <input
                            type="checkbox"
                            .checked=${checked}
                            ?disabled=${authPanelProps.busy}
                            @change=${(event: Event) => {
                              const next = new Set(authPanelProps.platformAdminScopes);
                              if ((event.target as HTMLInputElement).checked) {
                                next.add(option.scope);
                              } else {
                                next.delete(option.scope);
                              }
                              authPanelProps.onPlatformAdminScopesChange([...next]);
                            }}
                          />
                          <div class="platform-admin-scope-copy">
                            <div class="platform-admin-scope-label">${option.label}</div>
                            <div class="muted platform-admin-scope-desc">${option.description}</div>
                          </div>
                        </label>
                      `;
                    })}
                  </div>
                `
          }

          <div class="platform-admin-create-footer card-follow">
            <button
              class="btn btn--primary"
              type="button"
              ?disabled=${!canSubmitCreate}
              @click=${() => {
                const scopes = resolveScopesForPlatformAdminCreate(authPanelProps);
                authPanelProps.onPlatformAdminScopesChange(scopes);
                authPanelProps.onCreatePlatformAdmin?.();
              }}
            >
              创建
            </button>
          </div>
          ${authPanelProps.error ? html`<div class="callout danger card-follow--sm">${authPanelProps.error}</div>` : nothing}
          ${authPanelProps.notice ? html`<div class="callout success card-follow--sm">${authPanelProps.notice}</div>` : nothing}
        </section>
      `
    : nothing;

  return html`
    ${createForm}

    <section class="card ${canManagePlatformAdmins ? "card-follow" : ""}">
      <div class="row row--split">
        <div>
          <div class="card-title">平台管理员</div>
          <div class="card-sub">
            ${currentUser ?? "未知"}${currentRole ? ` · ${currentRole === "super-admin" ? "超级管理员" : "管理员"}` : ""}
          </div>
        </div>
        <div class="row row--tight">
          <button class="btn btn--sm" @click=${() => props.actions.systemSettings.onRefresh()}>
            刷新
          </button>
          ${authPanelProps.onLogout ? html`<button class="btn btn--sm" @click=${() => authPanelProps.onLogout?.()}>退出</button>` : nothing}
        </div>
      </div>
      ${
        admins.length > 0
          ? html`
              <div class="platform-capabilities__distribution card-follow">
                <table class="platform-capabilities__distribution-table platform-admin-table">
                  <colgroup>
                    <col style="width: 35%" />
                    <col style="width: 20%" />
                    <col style="width: 15%" />
                    <col style="width: 15%" />
                    <col style="width: 15%" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>管理员</th>
                      <th>类型</th>
                      <th>权限</th>
                      <th>状态</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${admins.map((admin) => {
                      const isSelf = admin.isCurrentUser || admin.user === currentUser;
                      const typeLabel = resolveAdminTypeLabel(admin.platformRole, admin.scopes);
                      const typeTone =
                        admin.platformRole === "super-admin"
                          ? "ok"
                          : typeLabel === "自定义"
                            ? "warn"
                            : "neutral";
                      const statusTone = admin.status === "suspended" ? "danger" : "ok";
                      const scopeCount =
                        admin.platformRole === "super-admin"
                          ? ALL_SCOPES.length
                          : (admin.scopes?.length ?? ALL_SCOPES.length);
                      return html`
                        <tr>
                          <td>
                            <div class="platform-capabilities__distribution-tenant">
                              <span class="platform-capabilities__distribution-avatar"
                                >${(admin.displayName ?? admin.user).slice(0, 1).toUpperCase()}</span
                              >
                              <div class="platform-capabilities__distribution-tenant-copy">
                                <div class="platform-capabilities__distribution-tenant-name">
                                  ${admin.displayName ?? admin.user}${
                                    isSelf
                                      ? html`
                                          <span class="muted platform-admin-self-flag">当前</span>
                                        `
                                      : nothing
                                  }
                                </div>
                                <div class="platform-capabilities__distribution-tenant-id">
                                  ${admin.user}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span class="platform-capabilities__chip is-${typeTone}"
                              >${typeLabel}</span
                            >
                          </td>
                          <td><span class="muted">${scopeCount}/${ALL_SCOPES.length}</span></td>
                          <td>
                            <span class="platform-capabilities__chip is-${statusTone}"
                              >${admin.status === "suspended" ? "停用" : "活跃"}</span
                            >
                          </td>
                          <td>
                            ${
                              canManagePlatformAdmins &&
                              !isSelf &&
                              admin.platformRole !== "super-admin"
                                ? html`<button
                                    class="btn btn--sm"
                                    type="button"
                                    ?disabled=${authPanelProps.busy || !authPanelProps.onRemovePlatformAdmin}
                                    @click=${() => {
                                      if (
                                        typeof window !== "undefined" &&
                                        window.confirm(
                                          `确认撤销 ${admin.displayName ?? admin.user}？`,
                                        )
                                      ) {
                                        authPanelProps.onRemovePlatformAdmin?.(admin.user);
                                      }
                                    }}
                                  >
                                    撤销
                                  </button>`
                                : nothing
                            }
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
                ${renderIcon("users", "platform-capabilities__empty-icon")}
                <div class="platform-capabilities__empty-copy">
                  <div class="platform-capabilities__empty-title">暂无管理员</div>
                  <div class="platform-capabilities__empty-sub">请先完成平台初始化。</div>
                </div>
              </div>
            `
      }
    </section>
  `;
}

function renderAuthEntryFallback(props: PlatformSurfaceProps) {
  return html`
    <section class="card">
      <div class="card-title">进入系统设置</div>
      <div class="card-sub">
        当前没有可用的平台设置会话。请先完成平台管理员登录、初始化或企业激活。
      </div>
      <div class="list card-follow">
        ${[
          {
            title: "平台登录",
            subtitle: "进入独立平台登录页，完成平台管理员登录或超管初始化。",
            meta: "账号入口",
            href: pathForTab("platformLogin", props.basePath),
          },
          {
            title: "申请企业试用",
            subtitle: "企业用户可从试用入口提交申请，平台管理员再处理转化。",
            meta: "试用流程",
            href: pathForTab("trialApply", props.basePath),
          },
          {
            title: "查看租户队列",
            subtitle: "已登录后从租户模块处理企业创建、试用与转化队列。",
            meta: "运营队列",
            href: pathForTab("platformTenants", props.basePath),
          },
        ].map(
          (item) => html`
            <a
              class="list-item list-item-route"
              href=${item.href}
              @click=${(event: MouseEvent) => followPortHref(event, item.href)}
            >
              <div class="list-main">
                <div class="list-title">${item.title}</div>
                <div class="list-sub">${item.subtitle}</div>
              </div>
              <div class="list-meta">${item.meta}</div>
            </a>
          `,
        )}
      </div>
    </section>
  `;
}

// ---- Tab: Defaults ------------------------------------------------------

function renderDefaultsTab(
  props: PlatformSurfaceProps,
  authPanelProps: PlatformAuthPanelProps | null,
  canManagePlatform: boolean,
) {
  const { readModel, basePath } = props;
  const configuredPlatformModelsMode = resolveConfiguredPlatformModelsMode(props);
  const appliedPlatformModelsMode = readModel.platformModelsMode ?? "native";
  const defaultModelFallbackCount = readModel.defaultModelFallbacks?.length ?? 0;
  const allowlistedModelCount = readModel.allowlistedModelRefs?.length ?? 0;
  const aliasCount = readModel.aliasCount ?? 0;
  const installedCapabilityCount = readModel.installedCapabilityCount ?? 0;
  const featureMethodCount = readModel.featureMethodCount ?? 0;
  const configDirty = props.channelsProps.configFormDirty;
  const configSaving = props.channelsProps.configSaving;
  const onSetPlatformModelsMode = (
    props.actions.systemSettings as {
      onSetPlatformModelsMode?: (mode: PlatformModelsMode) => void;
    }
  ).onSetPlatformModelsMode;
  const onSaveConfig = (
    props.actions.systemSettings as {
      onSaveConfig?: () => void;
    }
  ).onSaveConfig;
  const modeCapabilityChips =
    configuredPlatformModelsMode === "aor_enhanced"
      ? [...PLATFORM_NATIVE_MODE_CAPABILITIES, ...PLATFORM_AOR_ENHANCEMENTS]
      : PLATFORM_NATIVE_MODE_CAPABILITIES;
  return html`
    <section class="card" aria-label="规则 Agent">
      <div class="card-title">规则 Agent</div>
      <label>
        <span>个人任务约束适配</span>
        <input type="checkbox" role="switch" aria-label="个人规则 Agent 开关"
          .checked=${asRecord(asRecord(asRecord(props.channelsProps.configForm?.agents)?.defaults)?.contextWindowRuleDecision)?.mode === "dynamic"}
          ?disabled=${!canManagePlatform || configSaving}
          @change=${(event: Event) => {
            (
              props.actions.systemSettings as {
                onSetPersonalRuleAgent?: (enabled: boolean) => void;
              }
            ).onSetPersonalRuleAgent?.((event.target as HTMLInputElement).checked);
          }} />
        <span>${asRecord(asRecord(asRecord(props.channelsProps.configForm?.agents)?.defaults)?.contextWindowRuleDecision)?.mode === "dynamic" ? "开" : "关"}</span>
      </label>
      <div class="card-follow">
        <span>协作规则 Agent</span>
        <input type="checkbox" role="switch" aria-label="协作规则 Agent 开关" disabled />
        <span>关</span>
        <div class="card-sub">协作消费者尚未接通，暂不可开启。</div>
      </div>
      ${canManagePlatform ? html`<button class="btn" ?disabled=${!configDirty || configSaving} @click=${() => onSaveConfig?.()}>保存</button>` : nothing}
    </section>
    <section aria-label="租户创建默认策略">
      <div class="card-title">租户创建默认策略</div>
      ${
        isPlatformShellPending(readModel)
          ? renderPlatformSummaryPending("默认策略")
          : html`
              <div class="platform-capabilities__summary card-follow" aria-label="默认策略">
                ${renderDefaultCard({
                  label: "默认主模型",
                  value: readModel.defaultModelPrimary ?? "未配置",
                  meta: `Fallback ${defaultModelFallbackCount} 个`,
                  icon: "cpu",
                  tone: readModel.defaultModelPrimary ? "ok" : "warn",
                  href: pathForTab("platformModels", basePath),
                })}
                ${renderDefaultCard({
                  label: "默认图像模型",
                  value: readModel.defaultImageModelPrimary ?? "未配置",
                  meta: "支持多模态输入",
                  icon: "image",
                  tone: readModel.defaultImageModelPrimary ? "ok" : "warn",
                  href: pathForTab("platformModels", basePath),
                })}
                ${renderDefaultCard({
                  label: "允许的模型池",
                  value: String(allowlistedModelCount),
                  meta: `${aliasCount} 个别名映射`,
                  icon: "layers",
                  tone: allowlistedModelCount > 0 ? "ok" : "warn",
                  href: pathForTab("platformModels", basePath),
                })}
                ${renderDefaultCard({
                  label: "已安装能力",
                  value: String(installedCapabilityCount),
                  meta: `${featureMethodCount} 个方法`,
                  icon: "puzzle",
                  tone: installedCapabilityCount > 0 ? "ok" : "warn",
                  href: pathForTab("platformCapabilities", basePath),
                })}
              </div>
            `
      }
    </section>
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">模型管理运行模式</div>
          <div class="chip-row card-follow--sm">
            <span class="chip">当前运行 ${labelPlatformModelsMode(appliedPlatformModelsMode)}</span>
            <span
              class="chip ${configuredPlatformModelsMode === appliedPlatformModelsMode ? "" : "warn"}"
            >
              配置值 ${labelPlatformModelsMode(configuredPlatformModelsMode)}
            </span>
            ${
              configDirty
                ? html`
                    <span class="chip warn">有未保存配置</span>
                  `
                : html`
                    <span class="chip">配置已同步</span>
                  `
            }
          </div>
        </div>
        ${
          canManagePlatform
            ? html`
                <button
                  class="btn btn--primary"
                  type="button"
                  ?disabled=${!configDirty || configSaving}
                  @click=${() => {
                    if (
                      typeof window !== "undefined" &&
                      !window.confirm(
                        "确认保存模型管理运行模式？保存后，模型管理会在下次刷新时按新模式加载。",
                      )
                    ) {
                      return;
                    }
                    onSaveConfig?.();
                  }}
                >
                  ${configSaving ? "保存中" : "保存运行模式"}
                </button>
              `
            : nothing
        }
      </div>
      <div class="card-follow">
        ${renderCreateTenantChoiceGrid<PlatformModelsMode>({
          label: "模式选择",
          options: PLATFORM_MODE_OPTIONS.map((option) => ({
            value: option.id,
            label: option.label,
            summary: option.summary,
          })),
          value: configuredPlatformModelsMode,
          disabled: !canManagePlatform,
          onChange: (next) => onSetPlatformModelsMode?.(next),
        })}
      </div>
      <div class="chip-row card-follow--sm">
        ${modeCapabilityChips.map((chip) => html`<span class="chip">${chip}</span>`)}
      </div>
      <div class="list card-follow--sm">
        <div class="list-item">
          <div class="list-main">
            <div class="list-title">
              ${configuredPlatformModelsMode === "aor_enhanced" ? "当前已启用的增强能力" : "当前基础能力范围"}
            </div>
            <div class="list-sub">
              ${
                configuredPlatformModelsMode === "aor_enhanced"
                  ? "模型管理将继续使用平台原生控制面，并额外接入 AOR 的执行反馈、学习状态与优化数据。"
                  : "模型管理仅使用平台原生资产、策略、分析与治理数据，不依赖 AOR 运行反馈。"
              }
            </div>
          </div>
        </div>
        ${
          configuredPlatformModelsMode === "native"
            ? html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">切换到 AOR 增强后将额外获得</div>
                    <div class="list-sub">${PLATFORM_AOR_ENHANCEMENTS.join("、")}</div>
                  </div>
                </div>
              `
            : html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">关闭 AOR 增强后将回退为</div>
                    <div class="list-sub">仅保留平台原生模型管理能力，不再展示 AOR 专属解释与优化指标。</div>
                  </div>
                </div>
              `
        }
      </div>
      <div class="list card-follow--sm">
        <div class="list-item">
          <div class="list-main">
            <div class="list-title">原生</div>
            <div class="list-sub">
              继续使用平台现有资产、策略、分析与治理数据源，不依赖 AOR 运行反馈。
            </div>
          </div>
        </div>
        <div class="list-item">
          <div class="list-main">
            <div class="list-title">AOR 增强</div>
            <div class="list-sub">
              在原生控制面之上叠加 AOR 的路由解释、学习状态、Live Coding 证据与优化指标。
            </div>
          </div>
        </div>
      </div>
      ${
        canManagePlatform
          ? html`
              <div class="muted card-follow--sm">
                切换模式只更新平台配置。保存后，模型管理模块会在下次刷新时按新模式加载。
              </div>
            `
          : html`
              <div class="muted card-follow--sm">
                当前会话为只读。需要平台管理员权限才能调整模型管理运行模式。
              </div>
            `
      }
    </section>
    <section class="card card-follow">
      <div class="card-title">试用策略</div>
      <div class="chip-row card-follow--sm">
        <span class="chip">
          默认试用天数 ${authPanelProps?.state?.platformPolicy?.defaultTrialDays ?? 14}
        </span>
        <span class="chip">
          默认席位 ${authPanelProps?.state?.platformPolicy?.defaultTrialSeatCount ?? "—"}
        </span>
        <span class="chip">模型目录 ${readModel.modelMode ?? "merge"} 模式</span>
      </div>
      ${
        canManagePlatform
          ? html`
              <div class="row row--tight card-follow">
                <a
                  class="btn btn--primary"
                  href=${platformCreateTenantHref(basePath)}
                  @click=${(event: MouseEvent) =>
                    followPortHref(event, platformCreateTenantHref(basePath))}
                >
                  打开创建租户页
                </a>
                <a
                  class="btn"
                  href=${pathForTab("platformModels", basePath)}
                  @click=${(event: MouseEvent) => followPortHref(event, pathForTab("platformModels", basePath))}
                >
                  调整模型默认
                </a>
              </div>
            `
          : html`
              <div class="muted card-follow--sm">需要平台管理员权限才能调整默认策略。</div>
            `
      }
    </section>
  `;
}

function renderDefaultCard(params: {
  label: string;
  value: string;
  meta: string;
  icon: "cpu" | "image" | "layers" | "puzzle" | "building" | "users" | "shieldCheck" | "activity";
  tone: "ok" | "warn" | "danger" | "neutral";
  href: string;
}) {
  return html`
    <a
      class="platform-capabilities__summary-card is-${params.tone}"
      href=${params.href}
      @click=${(event: MouseEvent) => followPortHref(event, params.href)}
    >
      <span class="platform-capabilities__summary-icon is-${params.tone}">
        ${renderIcon(params.icon, "platform-capabilities__summary-icon-svg")}
      </span>
      <div class="platform-capabilities__summary-body">
        <div class="platform-capabilities__summary-label">${params.label}</div>
        <div
          class="platform-capabilities__summary-value platform-capabilities__summary-value--compact is-${params.tone}"
        >
          ${params.value}
        </div>
        <div class="platform-capabilities__summary-meta">${params.meta}</div>
      </div>
    </a>
  `;
}

// ---- Tab: Security & Audit ---------------------------------------------

function renderSecurityTab(props: PlatformSurfaceProps) {
  const { readModel } = props;
  const events: Array<{
    title: string;
    subtitle: string;
    tone: "info" | "warning" | "critical";
    icon: "checkCircle" | "alertTriangle" | "shieldCheck" | "info" | "user" | "building" | "cpu";
  }> = [];

  // Synthesize audit events from readModel
  if (readModel.latestInvite) {
    events.push({
      title: `激活码已签发 · ${readModel.latestInvite.tenantName ?? readModel.latestInvite.tenantId ?? "未命名租户"}`,
      subtitle: `到期 ${readModel.latestInvite.expiresAt}`,
      tone: "info",
      icon: "building",
    });
  }
  if (readModel.hasUpdateAvailable) {
    events.push({
      title: "平台版本待更新",
      subtitle: `当前 ${readModel.currentVersion ?? "—"} → 最新 ${readModel.latestVersion ?? "—"}`,
      tone: "warning",
      icon: "alertTriangle",
    });
  }
  if (readModel.operatorUser) {
    events.push({
      title: "当前运营会话",
      subtitle: `${readModel.operatorUser}${readModel.operatorRole ? ` · ${readModel.operatorRole}` : ""}`,
      tone: "info",
      icon: "user",
    });
  }
  if (readModel.missingCostEntries > 0) {
    events.push({
      title: `成本归因缺口 ${readModel.missingCostEntries} 条`,
      subtitle: "使用数据完整性受影响，建议尽快补齐归因。",
      tone: "warning",
      icon: "alertTriangle",
    });
  }
  if (events.length === 0) {
    events.push({
      title: "审计流水空",
      subtitle: "当前没有可展示的事件记录。",
      tone: "info",
      icon: "info",
    });
  }

  const onRunUpdate = (
    props.actions.systemSettings as {
      onRunUpdate?: () => void;
    }
  ).onRunUpdate;
  const canRunPlatformUpdate = Boolean(readModel.operatorUser);

  return html`
    <section class="card">
      <div class="card-title">安全态势</div>
      <div class="chip-row card-follow--sm">
        <span class="chip"> 当前会话 ${readModel.operatorRole ?? "未登录"} </span>
        <span class="chip"> 运行版本 ${readModel.currentVersion ?? "—"} </span>
        <span class="chip"> ${readModel.hasUpdateAvailable ? "有更新待处理" : "与最新一致"} </span>
      </div>
      <div class="row row--split card-follow">
        <div class="card-sub">
          网关服务端更新（仅平台运维）。将拉取并重装运行时后重启网关；客户端 App 更新由 Sparkle
          自行处理。
        </div>
        <button
          class="btn btn--sm ${readModel.hasUpdateAvailable ? "btn--primary" : ""}"
          type="button"
          ?disabled=${!canRunPlatformUpdate || !onRunUpdate}
          title=${canRunPlatformUpdate ? "运行网关服务端更新并重启" : "需平台运维会话"}
          @click=${() => {
            if (
              typeof window !== "undefined" &&
              !window.confirm(
                "确认运行网关服务端更新？这会重装运行时并重启共享网关，期间服务短暂中断。",
              )
            ) {
              return;
            }
            onRunUpdate?.();
          }}
        >
          运行平台更新
        </button>
      </div>
    </section>
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">审计事件流</div>
        </div>
        <button class="btn btn--sm" disabled title="完整审计日志接入开发中">导出日志</button>
      </div>
      <div class="platform-capabilities__health-list card-follow">
        ${events.map(
          (event) => html`
            <article
              class="platform-capabilities__health-item is-${event.tone === "info" ? "info" : event.tone === "warning" ? "warning" : "critical"}"
            >
              <span
                class="platform-capabilities__health-item-icon is-${event.tone === "info" ? "info" : event.tone === "warning" ? "warning" : "critical"}"
              >
                ${renderIcon(event.icon, "platform-capabilities__health-item-icon-svg")}
              </span>
              <div class="platform-capabilities__health-item-body">
                <div class="platform-capabilities__health-item-title">${event.title}</div>
                <div class="platform-capabilities__health-item-sub">${event.subtitle}</div>
              </div>
            </article>
          `,
        )}
      </div>
    </section>
    <section class="card card-follow">${renderMfaPolicyControl(props)}</section>
    <section class="card card-follow">
      <div class="card-title">安全策略（计划中）</div>
      <div class="list card-follow--sm">
        ${[
          { title: "会话超时", subtitle: "空闲会话自动注销时限" },
          { title: "IP 白名单", subtitle: "限制管理员登录来源 IP" },
          { title: "登录审计", subtitle: "导出历史登录、失败尝试与异常告警" },
        ].map(
          (item) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${item.title}</div>
                <div class="list-sub">${item.subtitle}</div>
              </div>
              <div class="list-meta"><span class="chip">计划中</span></div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

/**
 * Real MFA policy control. Super-admins see a working toggle bound to
 * `requireMfaForPlatformAdmins`; others see read-only status. Disabling reduces
 * the platform's audit + security guarantees, so the copy warns explicitly.
 */
function renderMfaPolicyControl(props: PlatformSurfaceProps) {
  const authState = props.authPanelProps?.state ?? null;
  const onSetMfaPolicy = props.authPanelProps?.onSetMfaPolicy;
  const busy = props.authPanelProps?.busy ?? false;
  const isSuperAdmin = authState?.platformRole === "super-admin";
  // Default to true (the secure default) when the gateway has not reported a value.
  const enabled = authState?.requireMfaForPlatformAdmins ?? true;
  const canToggle = isSuperAdmin && Boolean(onSetMfaPolicy);
  return html`
    <div class="row row--split row--top">
      <div>
        <div class="card-title">强制 MFA</div>
        <div class="card-sub">
          为所有平台管理员启用基于动态验证码（TOTP）的双因素认证。关闭将降低平台的安全与审计保障，仅建议在恢复或受控环境临时使用。
        </div>
        <div class="chip-row card-follow--sm">
          <span class="chip ${enabled ? "is-success" : "is-warning"}">
            ${enabled ? "已启用" : "已关闭"}
          </span>
          ${
            isSuperAdmin
              ? nothing
              : html`
                  <span class="chip">仅超级管理员可修改</span>
                `
          }
        </div>
      </div>
      ${
        canToggle
          ? html`
              <button
                class="btn btn--sm ${enabled ? "" : "btn--primary"}"
                ?disabled=${busy}
                @click=${() => {
                  if (
                    enabled &&
                    typeof window !== "undefined" &&
                    !window.confirm("确认关闭平台管理员强制 MFA？关闭后登录不再要求动态验证码。")
                  ) {
                    return;
                  }
                  onSetMfaPolicy?.(!enabled);
                }}
              >
                ${enabled ? "关闭强制 MFA" : "启用强制 MFA"}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

// ---- Tab: API Key -------------------------------------------------------

function renderApiKeyTab(props: PlatformSurfaceProps) {
  const { readModel } = props;
  return html`
    <section class="card">
      <div class="card-title">平台 API Key</div>
      <div class="chip-row card-follow--sm">
        <span class="chip">${readModel.providerIds.length} 个 Provider 凭证</span>
        <span class="chip">${readModel.channelCount} 个通道账户</span>
        <span class="chip">${readModel.accountCount} 个账户凭证</span>
      </div>
    </section>
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">Provider 凭证</div>
          <div class="card-sub">
            平台级 Provider 凭证（如 OpenAI API Key、Anthropic Key）由模型治理模块管理。
          </div>
        </div>
        <a
          class="btn btn--primary"
          href=${pathForTab("platformModels", props.basePath)}
          @click=${(event: MouseEvent) => followPortHref(event, pathForTab("platformModels", props.basePath))}
        >
          前往模型管理
        </a>
      </div>
      ${
        readModel.providerIds.length > 0
          ? html`
              <div class="list card-follow">
                ${readModel.providerIds.map((providerId) => {
                  const health = readModel.providerHealthDirectory.find(
                    (entry) => entry.providerId === providerId,
                  );
                  const tone =
                    health?.authStatus === "ok"
                      ? "ok"
                      : health?.authStatus === "warn"
                        ? "warn"
                        : "neutral";
                  return html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${providerId}</div>
                        <div class="list-sub">${health?.authLabel ?? "未配置"}</div>
                      </div>
                      <div class="list-meta">
                        <span
                          class="chip chip-${tone === "ok" ? "ok" : tone === "warn" ? "warn" : ""}"
                        >
                          ${health?.authStatus === "ok" ? "已配置" : health?.authStatus === "warn" ? "缺凭证" : "外部"}
                        </span>
                      </div>
                    </div>
                  `;
                })}
              </div>
            `
          : html`
              <div class="muted card-follow--sm">暂未配置任何 Provider 凭证。</div>
            `
      }
    </section>
    <section class="card card-follow">
      <div class="card-title">平台 Token（计划中）</div>
      <div class="list card-follow--sm">
        ${[
          { title: "平台 API Token", subtitle: "用于调用平台管理 API 的长期 Token" },
          { title: "Webhook 签名密钥", subtitle: "用于验证入站 Webhook 的签名密钥" },
          { title: "SSO / OIDC", subtitle: "配置企业身份提供方与单点登录" },
        ].map(
          (item) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${item.title}</div>
                <div class="list-sub">${item.subtitle}</div>
              </div>
              <div class="list-meta"><span class="chip">计划中</span></div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

// ---- Main surface -------------------------------------------------------

export function renderPlatformSystemSettingsSurface(props: PlatformSurfaceProps) {
  activeSystemSettingsTab = resolveSystemSettingsTab();
  if (activeSystemSettingsTab === "device-platform") {
    if (!devicePlatformSectionMounted) {
      // Deep-link / remount after leaving system-settings: drop leftover form view.
      showDevicePlatformConnectionList();
    }
    devicePlatformSectionMounted = true;
  } else {
    devicePlatformSectionMounted = false;
  }
  const authPanelProps = resolveSystemSettingsAuthPanelProps(props.authPanelProps);
  const canManagePlatform = Boolean(
    props.authPanelProps?.state?.canManagePlatform ||
    props.authPanelProps?.state?.availableModes?.includes("platform-enterprise-create") ||
    authPanelProps?.state?.canManagePlatform ||
    authPanelProps?.state?.availableModes?.includes("platform-enterprise-create"),
  );
  const canManagePlatformAdmins = Boolean(authPanelProps?.state?.canManagePlatformAdmins);

  let body;
  switch (activeSystemSettingsTab) {
    case "admins":
      body = renderAdminsTab(props, authPanelProps, canManagePlatform, canManagePlatformAdmins);
      break;
    case "defaults":
      body = renderDefaultsTab(props, authPanelProps, canManagePlatform);
      break;
    case "security":
      body = renderSecurityTab(props);
      break;
    case "api":
      body = renderApiKeyTab(props);
      break;
    case "device-platform":
      body = renderDevicePlatformConnectionPanel();
      break;
  }

  return html`
    <section class="platform-capabilities">
      ${renderSummary(props, authPanelProps, canManagePlatform)}
      <div class="card platform-system-settings__tabs-card">${renderTabBar()}</div>
      <div class="platform-capabilities__body">${body}</div>
    </section>
  `;
}
