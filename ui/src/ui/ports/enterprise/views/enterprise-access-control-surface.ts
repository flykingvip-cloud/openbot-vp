import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { renderIcon } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { canEditEnterpriseSupervisorPolicy } from "../../../supervisor/supervisor-types.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import { renderEnterpriseSegmentedNav } from "../../../views/enterprise-segmented-nav.ts";
import "../../../views/model-authorization-section.ts";
import "./enterprise-integrations-providers.ts";
import { renderOperationalIdentityGovernancePanel } from "../../../views/operational-identity-governance-panel.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import {
  displayEnterpriseLastError,
  formatEnterpriseRoleLabel,
  resolveEnterpriseConnectionView,
  resolveIdleSeatCount,
} from "../enterprise-connection-copy.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { renderEnterpriseIdentityAssetsSection } from "./enterprise-identity-assets-section.ts";
import {
  countUnreadBindingActivity,
  readBindingActivitySeenAt,
  writeBindingActivitySeenAt,
} from "./enterprise-identity-binding-activity-prefs.ts";
import { renderEnterpriseIdentityCredentialEditPanel } from "./enterprise-identity-credential-edit-panel.ts";
import { renderEnterpriseIdentityEmployeeBindingsPanel } from "./enterprise-identity-employee-bindings-panel.ts";
import { renderEnterpriseIdentityPolicyEditorFields } from "./enterprise-identity-policy-editor-fields.ts";
import { renderIdentityRegisterProviderPicker } from "./enterprise-identity-register-provider-picker.ts";
import { renderEnterpriseMessageChannelsSurface } from "./enterprise-message-channels-surface.ts";
import {
  accessCommitNotice,
  renderAuditExportButton,
  renderCreateRoleControl,
  renderIpAllowlistControl,
  renderPendingSecurityNotice,
  renderSessionPolicyControl,
  submitAccessPermissionCommit,
} from "./enterprise-pending-controls-panel.ts";
import { renderEnterpriseSecurityControlRows } from "./enterprise-security-controls-panel.ts";
import type { SurfaceBlock } from "./enterprise-surface-shared.ts";
import {
  buildEnterpriseAdminInviteDirectoryHref,
  followDelegatedPortHref,
  isGatewayAuthIssue,
  requestEnterpriseAppRerender,
  shouldProceed,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import "../../../supervisor/supervisor-node-registry-panel.ts";
import "../../../supervisor/supervisor-worker-policy-panel.ts";
import "../../../supervisor/cli-credential-self-panel.ts";
import "./enterprise-governance-memory-cards.ts";

/**
 * 子页面/分段导航的编程式跳转：复用与 `followPortHref` 一致的
 * pushState + popstate + 宿主重渲染流程（无 MouseEvent 时使用）。
 */
function navigateToPortHref(href: string): void {
  if (typeof window === "undefined") {
    return;
  }
  pushAppHistoryState(href);
}

type AccessView = "roles" | "users" | "matrix";
type ModelsSettingsView = "authorization" | "keys";
type AccessMatrixFilter = "all" | "risk";
type AccessRoleKey = "admin" | "operator" | "viewer";
type SettingsSection =
  | "overview"
  | "profile"
  | "access"
  | "integrations"
  | "identities"
  | "identity-bindings"
  | "channels"
  | "governance"
  | "security";
type SettingsStat = {
  label: string;
  value: string;
  tone?: "warn" | "ok";
};
type AccessPermissionDefinition = {
  id: string;
  module: string;
  label: string;
  highRisk?: boolean;
  description?: string;
};

const ACCESS_PERMISSION_CATALOG: AccessPermissionDefinition[] = [
  {
    id: "member:view",
    module: "组织管理",
    label: "查看成员",
    description: "查看成员目录与岗位归属。",
  },
  {
    id: "member:edit",
    module: "组织管理",
    label: "编辑成员",
    description: "调整成员状态、岗位与交接。",
  },
  {
    id: "member:delete",
    module: "组织管理",
    label: "删除成员",
    highRisk: true,
    description: "移除成员与其直接访问能力。",
  },
  {
    id: "usage:view",
    module: "能力使用管理",
    label: "查看能力使用",
    description: "查看机器人能力使用、安装关系、效果分析与治理问题等只读视图。",
  },
  {
    id: "usage:install-manage",
    module: "能力使用管理",
    label: "管理能力安装",
    description: "在能力安装管理页执行能力卸载等管理操作。",
  },
  {
    id: "usage:governance",
    module: "能力使用管理",
    label: "处理使用治理问题",
    description: "处理低效能力、未使用能力、冲突能力等使用治理问题。",
  },
  {
    id: "mesh:view",
    module: "机巢治理",
    label: "查看排名",
    description: "查看员工、机器人与协作小组排名。",
  },
  {
    id: "mesh:govern",
    module: "机巢治理",
    label: "处理异常",
    highRisk: true,
    description: "进入治理队列处理限制、归因和创建人问题。",
  },
  {
    id: "usage:budget",
    module: "使用情况",
    label: "调整预算",
    highRisk: true,
    description: "设置预算阈值和预算限制预案。",
  },
  {
    id: "settings:policy",
    module: "设置",
    label: "管理策略",
    highRisk: true,
    description: "修改企业策略、密钥和配置边界。",
  },
];

const ACCESS_ROLE_PERMISSIONS: Record<AccessRoleKey, string[]> = {
  viewer: ["member:view", "usage:view", "mesh:view"],
  operator: ["member:view", "member:edit", "usage:view", "usage:install-manage", "mesh:view"],
  admin: ACCESS_PERMISSION_CATALOG.map((entry) => entry.id),
};

function resolveAccessView(search: string): AccessView {
  const value = new URLSearchParams(search).get("accessView");
  return value === "users" || value === "matrix" ? value : "roles";
}

function resolveAccessRoleKey(search: string): AccessRoleKey {
  const value = new URLSearchParams(search).get("accessRole");
  return value === "admin" || value === "viewer" ? value : "operator";
}

function resolveAccessUserKey(search: string): string | null {
  const value = new URLSearchParams(search).get("accessUser")?.trim();
  return value || null;
}

function resolveAccessSearch(search: string): string {
  return new URLSearchParams(search).get("accessSearch")?.trim() ?? "";
}

function resolveAccessMatrixFilter(search: string): AccessMatrixFilter {
  return new URLSearchParams(search).get("accessMatrix") === "risk" ? "risk" : "all";
}

function resolveModelsView(search: string): ModelsSettingsView {
  return new URLSearchParams(search).get("modelsView") === "keys" ? "keys" : "authorization";
}

function isSettingsSection(value: string | null | undefined): value is SettingsSection {
  return (
    value === "overview" ||
    value === "profile" ||
    value === "access" ||
    value === "integrations" ||
    value === "identities" ||
    value === "identity-bindings" ||
    value === "channels" ||
    value === "governance" ||
    value === "security"
  );
}

function resolveSettingsSection(pathname: string, search: string): SettingsSection {
  const pathMatch = pathname.match(/\/settings\/([^/?#]+)/u);
  const pathValue = pathMatch?.[1]?.trim().toLowerCase();
  // Legacy alias: settings/message-channels → channels (企业通道)
  if (pathValue === "message-channels") {
    return "channels";
  }
  if (isSettingsSection(pathValue)) {
    return pathValue;
  }
  // Legacy deep link: /enterprise/{tenantId}/channels → 渠道凭证 section
  if (/\/channels\/?$/u.test(pathname) || /\/channels\//u.test(pathname)) {
    if (!pathname.includes("/settings/")) {
      return "channels";
    }
  }
  const searchParams = new URLSearchParams(search);
  const value = searchParams.get("settingsSection")?.trim();
  if (value === "access") {
    return "access";
  }
  if (value === "system") {
    return "security";
  }
  if (value === "integrations") {
    return "integrations";
  }
  if (value === "identities") {
    return "identities";
  }
  if (value === "identity-bindings") {
    return "identity-bindings";
  }
  if (value === "channels") {
    return "channels";
  }
  if (
    searchParams.has("accessView") ||
    searchParams.has("accessRole") ||
    searchParams.has("accessUser") ||
    searchParams.has("accessSearch") ||
    searchParams.has("accessMatrix")
  ) {
    return "access";
  }
  return "overview";
}

function resolveSettingsBaseHref(pathname: string): string {
  const match = pathname.match(/^(.*\/settings)(?:\/[^/?#]+)?$/u);
  return match?.[1] ?? pathname;
}

function buildSettingsSectionHref(baseHref: string, section: SettingsSection): string {
  const normalized =
    baseHref.endsWith("/") && baseHref.length > 1 ? baseHref.slice(0, -1) : baseHref;
  return section === "overview" ? normalized : `${normalized}/${section}`;
}

function buildIntegrationsTabHref(baseHref: string, view: ModelsSettingsView): string {
  const href = buildSettingsSectionHref(baseHref, "integrations");
  try {
    const parsed = new URL(
      href,
      typeof window !== "undefined" ? window.location.href : "http://localhost",
    );
    parsed.searchParams.delete("settingsSection");
    if (view === "keys") {
      parsed.searchParams.set("modelsView", "keys");
    } else {
      parsed.searchParams.delete("modelsView");
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return href;
  }
}

function appendAccessSearchToHref(
  href: string,
  params: {
    view?: AccessView | null;
    role?: AccessRoleKey | null;
    user?: string | null;
    query?: string | null;
    matrix?: AccessMatrixFilter | null;
  },
) {
  try {
    const parsed = new URL(
      href,
      typeof window !== "undefined" ? window.location.href : "http://localhost",
    );
    parsed.searchParams.delete("settingsSection");
    if (params.view && params.view !== "roles") {
      parsed.searchParams.set("accessView", params.view);
    } else {
      parsed.searchParams.delete("accessView");
    }
    if (params.role && params.role !== "operator") {
      parsed.searchParams.set("accessRole", params.role);
    } else {
      parsed.searchParams.delete("accessRole");
    }
    if (params.user) {
      parsed.searchParams.set("accessUser", params.user);
    } else {
      parsed.searchParams.delete("accessUser");
    }
    if (params.query) {
      parsed.searchParams.set("accessSearch", params.query);
    } else {
      parsed.searchParams.delete("accessSearch");
    }
    if (params.matrix && params.matrix !== "all") {
      parsed.searchParams.set("accessMatrix", params.matrix);
    } else {
      parsed.searchParams.delete("accessMatrix");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const search = new URLSearchParams();
    if (params.view && params.view !== "roles") {
      search.set("accessView", params.view);
    }
    if (params.role && params.role !== "operator") {
      search.set("accessRole", params.role);
    }
    if (params.user) {
      search.set("accessUser", params.user);
    }
    if (params.query) {
      search.set("accessSearch", params.query);
    }
    if (params.matrix && params.matrix !== "all") {
      search.set("accessMatrix", params.matrix);
    }
    const suffix = search.toString();
    return suffix ? `${href}${href.includes("?") ? "&" : "?"}${suffix}` : href;
  }
}

function updateAccessSearchParams(
  patch: Partial<{
    accessView: AccessView | null;
    accessRole: AccessRoleKey | null;
    accessUser: string | null;
    accessSearch: string | null;
    accessMatrix: AccessMatrixFilter | null;
  }>,
) {
  if (typeof window === "undefined") {
    return;
  }
  const next = new URL(window.location.href);
  const assign = (key: string, value: string | null | undefined, defaultValue?: string) => {
    if (!value || (defaultValue && value === defaultValue)) {
      next.searchParams.delete(key);
      return;
    }
    next.searchParams.set(key, value);
  };
  if ("accessView" in patch) {
    assign("accessView", patch.accessView, "roles");
  }
  if ("accessRole" in patch) {
    assign("accessRole", patch.accessRole, "operator");
  }
  if ("accessUser" in patch) {
    assign("accessUser", patch.accessUser);
  }
  if ("accessSearch" in patch) {
    assign("accessSearch", patch.accessSearch);
  }
  if ("accessMatrix" in patch) {
    assign("accessMatrix", patch.accessMatrix, "all");
  }
  // Same top-level tab: pushState alone does not update Lit @state — force host rerender.
  pushAppHistoryState(`${next.pathname}${next.search}${next.hash}`);
}

function settingsConnection(props: EnterpriseSurfaceProps) {
  return resolveEnterpriseConnectionView({
    connected: props.readModel.connected,
    connectionPhase: props.readModel.connectionPhase,
    lastError: props.readModel.lastError,
    payloadReady: props.readModel.enterprisePayloadReady,
    authIssue: isGatewayAuthIssue(props.readModel.lastError),
  });
}

function settingsLastError(props: EnterpriseSurfaceProps): string | null {
  return displayEnterpriseLastError({
    connected: props.readModel.connected,
    connectionPhase: props.readModel.connectionPhase,
    lastError: props.readModel.lastError,
    payloadReady: props.readModel.enterprisePayloadReady,
    authIssue: isGatewayAuthIssue(props.readModel.lastError),
  });
}

function normalizeAccessRole(
  member: EnterprisePortReadModel["memberSummaries"][number],
): AccessRoleKey {
  if (member.membershipRole === "enterprise-admin") {
    return "admin";
  }
  return member.seatTitle ? "operator" : "viewer";
}

function dedupePermissionIds(entries: string[]) {
  return [...new Set(entries)];
}

/** Copy shown on controls that look actionable but have no backend yet. */
const SETTINGS_ACTION_PENDING_TITLE = "此操作尚未接入，按钮已停用，避免被误认为已经生效。";

function renderPendingSettingsAction(
  label: string,
  tone: "default" | "primary" | "danger" = "default",
) {
  const toneClass = tone === "danger" ? " btn--danger" : tone === "primary" ? " btn--primary" : "";
  return html`
    <button
      class="btn btn--sm${toneClass}"
      type="button"
      disabled
      title=${SETTINGS_ACTION_PENDING_TITLE}
    >
      ${label}
    </button>
  `;
}

function renderSettingsStats(stats: SettingsStat[]) {
  return html`
    <div class="enterprise-settings-stat-grid">
      ${stats.map(
        (stat) => html`
          <div class="enterprise-settings-stat">
            <span class="enterprise-settings-stat__label">${stat.label}</span>
            <strong class="enterprise-settings-stat__value ${stat.tone ? `is-${stat.tone}` : ""}"
              >${stat.value}</strong
            >
          </div>
        `,
      )}
    </div>
  `;
}

function buildSettingsTabHref(
  baseHref: string,
  section: SettingsSection,
  params: { accessView: AccessView; selectedUser: string | null },
): string {
  if (section === "access") {
    return appendAccessSearchToHref(buildSettingsSectionHref(baseHref, "access"), {
      view: params.accessView,
      user: params.selectedUser,
    });
  }
  return buildSettingsSectionHref(baseHref, section);
}

/** Top segmented tabs for 系统设置 (replaces the card hub). */
function renderSettingsSectionShell(params: {
  props: EnterpriseSurfaceProps;
  baseHref: string;
  settingsSection: SettingsSection;
  accessView: AccessView;
  selectedUser: string | null;
}) {
  const { baseHref, settingsSection } = params;
  const tabs: Array<{ id: SettingsSection; label: string; hint: string }> = [
    { id: "overview", label: "概览", hint: "设置总览与关键指标" },
    { id: "profile", label: "企业信息", hint: "企业身份、席位结构和组织主数据" },
    { id: "access", label: "管理员", hint: "多管理员治理、角色边界和风险复核" },
    { id: "integrations", label: "模型管理", hint: "模型授权、提供方与密钥" },
    { id: "identities", label: "企业身份", hint: "企业身份、数字账户与员工绑定总览" },
    { id: "channels", label: "企业通道", hint: "企业微信 / 飞书 / 钉钉 IM 通道接入" },
    { id: "governance", label: "治理", hint: "企业策略、资产流转边界和治理待办" },
    { id: "security", label: "安全", hint: "当前账号、登录安全、会话控制与操作日志" },
  ];
  return html`
    <section class="enterprise-settings-shell">
      ${renderEnterpriseModuleHeader({
        title: t("tabs.enterpriseSettings"),
        subtitle: t("subtitles.enterpriseSettings"),
      })}
      ${renderEnterpriseSegmentedNav(
        tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          hint: tab.hint,
          active:
            settingsSection === tab.id ||
            (tab.id === "identities" && settingsSection === "identity-bindings"),
        })),
        (id) => {
          if (!isSettingsSection(id)) {
            return;
          }
          navigateToPortHref(
            buildSettingsTabHref(baseHref, id, {
              accessView: params.accessView,
              selectedUser: params.selectedUser,
            }),
          );
        },
      )}
    </section>
  `;
}

function renderAccessPermissionTree(
  permissionIds: string[],
  params: {
    editable?: boolean;
    selectedIds?: string[];
    onToggle?: (permissionId: string) => void;
  } = {},
) {
  const selectedIds = params.selectedIds ?? permissionIds;
  const modules = [...new Set(ACCESS_PERMISSION_CATALOG.map((entry) => entry.module))];
  return html`
    <div class="enterprise-access-tree">
      ${modules.map((module) => {
        const items = ACCESS_PERMISSION_CATALOG.filter(
          (entry) => entry.module === module && permissionIds.includes(entry.id),
        );
        if (!items.length) {
          return nothing;
        }
        return html`
          <section class="enterprise-access-tree__module">
            <div class="enterprise-access-tree__module-title">${module}</div>
            <div class="enterprise-access-tree__items">
              ${items.map((item) => {
                const checked = selectedIds.includes(item.id);
                return html`
                  <label
                    class="enterprise-access-tree__item ${params.editable ? "is-editable" : ""}"
                    title=${item.description ?? item.label}
                  >
                    <input
                      type="checkbox"
                      .checked=${checked}
                      ?disabled=${!params.editable}
                      @change=${() => params.onToggle?.(item.id)}
                    />
                    <span>${item.label}</span>
                    ${
                      item.highRisk
                        ? html`
                            <span class="enterprise-access-tag enterprise-access-tag--danger">高风险</span>
                          `
                        : nothing
                    }
                  </label>
                `;
              })}
            </div>
          </section>
        `;
      })}
    </div>
  `;
}

function renderSettingsOverviewSection(params: {
  props: EnterpriseSurfaceProps;
  baseHref: string;
}) {
  const { props, baseHref } = params;
  const tenantLabel =
    props.readModel.currentTenantLabel ?? props.readModel.currentTenantId ?? "未命名租户";
  const governanceFocusCount =
    props.readModel.configIssueCount +
    props.readModel.meshSummary.governanceIssueCount +
    props.readModel.missingCostEntries;
  const stats: SettingsStat[] = [
    { label: "企业成员", value: `${props.readModel.memberCount}` },
    {
      label: "管理员",
      value: `${props.readModel.adminCount}`,
      tone: props.readModel.adminCount === 0 ? "warn" : undefined,
    },
    {
      label: "已接入",
      value: `${props.readModel.channelCount + props.readModel.configuredProviderCount}`,
      tone:
        props.readModel.channelCount > 0 || props.readModel.configuredProviderCount > 0
          ? "ok"
          : undefined,
    },
    {
      label: "治理关注",
      value: `${governanceFocusCount}`,
      tone: governanceFocusCount > 0 ? "warn" : "ok",
    },
    { label: "活动会话", value: `${props.readModel.sessionsCount}` },
  ];

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      ${renderSettingsStats(stats)}

      <div class="enterprise-settings-panel-grid">
        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">企业信息</div>
              <div class="enterprise-settings-panel__sub">
                ${tenantLabel} 的组织主数据和席位概览。
              </div>
            </div>
            <a
              class="btn btn--sm enterprise-settings-panel__head-action"
              href=${buildSettingsSectionHref(baseHref, "profile")}
            >
              进入
            </a>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>企业名称</dt>
              <dd>${tenantLabel}</dd>
            </div>
            <div>
              <dt>企业标识</dt>
              <dd><code>${props.readModel.currentTenantId ?? "—"}</code></dd>
            </div>
            <div>
              <dt>岗位占用</dt>
              <dd>${props.readModel.occupiedSeatCount} / ${props.readModel.seatCount}</dd>
            </div>
            <div>
              <dt>机器人与协作组</dt>
              <dd>${props.readModel.agentCount} / ${props.readModel.groupIds.length}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">管理员与访问</div>
              <div class="enterprise-settings-panel__sub">管理员边界、成员权限和高风险复核。</div>
            </div>
            <a
              class="btn btn--sm enterprise-settings-panel__head-action"
              href=${appendAccessSearchToHref(buildSettingsSectionHref(baseHref, "access"), {
                view: "users",
              })}
            >
              进入
            </a>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>管理员数量</dt>
              <dd>${props.readModel.adminCount}</dd>
            </div>
            <div>
              <dt>当前账号</dt>
              <dd>${props.readModel.authenticatedUser ?? "未识别"}</dd>
            </div>
            <div>
              <dt>成员总数</dt>
              <dd>${props.readModel.memberCount}</dd>
            </div>
            <div>
              <dt>待处理岗位激活</dt>
              <dd>${props.readModel.pendingOfferCount}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">模型管理</div>
              <div class="enterprise-settings-panel__sub">模型授权、提供方与 API Key。</div>
            </div>
            <a
              class="btn btn--sm enterprise-settings-panel__head-action"
              href=${buildSettingsSectionHref(baseHref, "integrations")}
            >
              进入
            </a>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>模型提供方</dt>
              <dd>${props.readModel.configuredProviderCount}</dd>
            </div>
            <div>
              <dt>可用模型</dt>
              <dd>${props.readModel.configuredModelCount}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">策略与治理</div>
              <div class="enterprise-settings-panel__sub">
                看清策略健康、资产流转边界和治理积压。
              </div>
            </div>
            <a
              class="btn btn--sm enterprise-settings-panel__head-action"
              href=${buildSettingsSectionHref(baseHref, "governance")}
            >
              进入
            </a>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>策略待办</dt>
              <dd>${props.readModel.configIssueCount}</dd>
            </div>
            <div>
              <dt>治理异常</dt>
              <dd>${props.readModel.meshSummary.governanceIssueCount}</dd>
            </div>
            <div>
              <dt>未归因成本</dt>
              <dd>${props.readModel.meshSummary.unattributedCostCount}</dd>
            </div>
            <div>
              <dt>未归属对象</dt>
              <dd>${props.readModel.meshSummary.unownedAssetCount}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">审计与安全</div>
              <div class="enterprise-settings-panel__sub">
                运营身份监管、当前管理员会话、审计导出和连接告警。
              </div>
            </div>
            <a
              class="btn btn--sm enterprise-settings-panel__head-action"
              href=${buildSettingsSectionHref(baseHref, "security")}
            >
              进入
            </a>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>连接状态</dt>
              <dd>
                <span
                  class="enterprise-settings-status ${settingsConnection(props).tone === "ok" ? "is-ok" : settingsConnection(props).tone === "warn" ? "is-warn" : ""}"
                >
                  ${settingsConnection(props).label}
                </span>
              </dd>
            </div>
            <div>
              <dt>当前角色</dt>
              <dd>${formatEnterpriseRoleLabel(props.readModel.membershipRole)}</dd>
            </div>
            <div>
              <dt>最近错误</dt>
              <dd class=${settingsLastError(props) ? "enterprise-settings-kv__error" : ""}>
                ${settingsLastError(props) ?? "暂无"}
              </dd>
            </div>
            <div>
              <dt>活动会话</dt>
              <dd>${props.readModel.sessionsCount}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  `;
}

function renderProfileSection(params: { props: EnterpriseSurfaceProps }) {
  const { props } = params;
  const tenantLabel = props.readModel.currentTenantLabel ?? props.readModel.currentTenantId;
  const tenantId = props.readModel.currentTenantId;
  const stats: SettingsStat[] = [
    { label: "成员", value: `${props.readModel.memberCount}` },
    { label: "岗位", value: `${props.readModel.seatCount}` },
    { label: "机器人", value: `${props.readModel.agentCount}` },
    { label: "协作小组", value: `${props.readModel.groupIds.length}` },
  ];

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      <header class="enterprise-settings-section__header">
        <p class="enterprise-settings-panel__sub">
          企业名称与标识在开通时写入，此处只读。名录与岗位请到「组织与数字人」维护。
        </p>
        <div class="enterprise-settings-actionbar">
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => props.actions.organization.onRefresh()}
          >
            ${renderIcon("refreshCw")} 刷新组织
          </button>
        </div>
      </header>

      ${renderSettingsStats(stats)}

      <div class="enterprise-settings-panel-grid">
        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">企业身份</div>
              <div class="enterprise-settings-panel__sub">当前租户身份、连接状态与管理主体。</div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>企业名称</dt>
              <dd>${tenantLabel || "未命名租户"}</dd>
            </div>
            <div>
              <dt>企业标识</dt>
              <dd><code>${tenantId || "—"}</code></dd>
            </div>
            <div>
              <dt>连接状态</dt>
              <dd>
                <span
                  class="enterprise-settings-status ${settingsConnection(props).tone === "ok" ? "is-ok" : settingsConnection(props).tone === "warn" ? "is-warn" : ""}"
                >
                  ${settingsConnection(props).label}
                </span>
              </dd>
            </div>
            <div>
              <dt>当前管理员</dt>
              <dd>${props.readModel.authenticatedUser ?? "未识别"}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">席位与成员</div>
              <div class="enterprise-settings-panel__sub">成员数量、岗位占用和待激活席位。</div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>岗位占用</dt>
              <dd>${props.readModel.occupiedSeatCount} / ${props.readModel.seatCount}</dd>
            </div>
            <div>
              <dt>空闲岗位</dt>
              <dd>
                ${resolveIdleSeatCount(props.readModel.seatCount, props.readModel.occupiedSeatCount)}
              </dd>
            </div>
            <div>
              <dt>交接中岗位</dt>
              <dd>${props.readModel.handoverSeatCount}</dd>
            </div>
            <div>
              <dt>待激活岗位</dt>
              <dd>${props.readModel.pendingOfferCount}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">业务对象概览</div>
              <div class="enterprise-settings-panel__sub">机器人、协作小组与在线运行基础面。</div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>机器人数量</dt>
              <dd>${props.readModel.agentCount}</dd>
            </div>
            <div>
              <dt>协作小组</dt>
              <dd>${props.readModel.groupIds.length}</dd>
            </div>
            <div>
              <dt>在线节点</dt>
              <dd>${props.readModel.nodeCount}</dd>
            </div>
            <div>
              <dt>默认机器人</dt>
              <dd>${props.readModel.defaultAgentId ?? "未设置"}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  `;
}

function renderIdentityManagementEditor(params: {
  props: EnterpriseSurfaceProps;
  tenantId: string | null;
}) {
  const { props, tenantId } = params;
  const editor = props.identityManagementEditor;
  if (!editor.open) {
    return nothing;
  }
  const catalog = props.readModel.identityProviderCatalog ?? [];
  const selectedProvider = catalog.find((entry) => entry.provider === editor.provider) ?? null;
  const connectorIds = new Set(
    (selectedProvider?.connectorIds ?? []).map((id) => id.toLowerCase()),
  );
  const filteredBindings =
    connectorIds.size === 0
      ? editor.eligibleCredentialBindings
      : editor.eligibleCredentialBindings.filter((entry) =>
          connectorIds.has(entry.connectorId.toLowerCase()),
        );
  const connectorLabel = new Map<string, string>();
  for (const entry of catalog) {
    for (const cid of entry.connectorIds ?? []) {
      connectorLabel.set(cid, entry.label);
    }
  }
  const pickingProvider = editor.mode === "register" && editor.registerStep === "provider";
  const profile = selectedProvider?.registrationProfile ?? null;
  const supportsOAuth = Boolean(profile?.methods.includes("oauth"));
  const title =
    editor.mode === "register"
      ? pickingProvider
        ? "选择平台通道"
        : `连接「${selectedProvider?.label ?? editor.provider}」`
      : editor.mode === "policy"
        ? "管理开放范围"
        : editor.mode === "credential"
          ? "编辑凭证"
          : editor.mode === "edit"
            ? "重命名账号"
            : "绑定数据源";
  const subtitle =
    editor.mode === "register"
      ? pickingProvider
        ? "先选平台，再在右侧填写凭证或完成该平台要求的授权。同一平台可连接多个账号。"
        : supportsOAuth
          ? "填写凭证，或使用「连接 ↗」打开外部登录页完成授权。也可复用已有凭证。"
          : "填写凭证后保存。也可复用已有凭证。"
      : editor.mode === "policy"
        ? "开放给岗位后，员工在个人设置 → 授权 → 企业 把该账号绑到自己的机器人。"
        : editor.mode === "credential"
          ? "密钥留空表示不修改已保存的值。"
          : editor.mode === "edit"
            ? "只改显示名称，不影响凭证与开放范围。"
            : "数据源绑定不产生岗位授权。";
  const oauthProviderLabel = selectedProvider?.label ?? editor.provider;
  const externalAuthHint = oauthProviderLabel
    ? `将打开 ${oauthProviderLabel} 完成登录授权。`
    : "将打开外部登录页完成授权。";
  const oauthAction =
    supportsOAuth && editor.onStartOAuth
      ? {
          disabled: editor.busy,
          hint: profile?.oauthHint ? `${externalAuthHint} ${profile.oauthHint}` : externalAuthHint,
          title: externalAuthHint,
          onClick: () => editor.onStartOAuth?.(editor.provider),
        }
      : null;
  const submitLabel =
    editor.mode === "register"
      ? "保存连接"
      : editor.mode === "policy"
        ? "保存开放范围"
        : editor.mode === "credential"
          ? "保存凭证"
          : editor.mode === "edit"
            ? "保存名称"
            : "保存";
  return html`
    <article class="enterprise-settings-panel enterprise-settings-panel--flat">
      <div class="enterprise-settings-panel__head">
        <div>
          <div class="enterprise-settings-panel__title">${title}</div>
          <div class="enterprise-settings-panel__sub">${subtitle}</div>
        </div>
        <button class="btn btn--sm" type="button" @click=${editor.onClose}>关闭</button>
      </div>
      ${
        editor.mode === "register"
          ? pickingProvider
            ? renderIdentityRegisterProviderPicker({
                catalog,
                busy: false,
                onSelect: editor.onRegisterProviderSelect,
              })
            : html`
              ${
                editor.onRegisterProviderBack
                  ? html`<div class="enterprise-settings-actionbar">
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${editor.busy}
                        @click=${editor.onRegisterProviderBack}
                      >
                        返回平台
                      </button>
                    </div>`
                  : nothing
              }
              <label class="enterprise-settings-field">
                <span>账号名称</span>
                <input
                  type="text"
                  .value=${editor.displayName}
                  ?disabled=${editor.busy}
                  @input=${(event: Event) =>
                    editor.onDisplayNameChange((event.target as HTMLInputElement).value)}
                />
              </label>
              ${
                profile
                  ? renderEnterpriseIdentityCredentialEditPanel({
                      profile,
                      provider: editor.provider,
                      providerLabel: selectedProvider?.label ?? editor.provider,
                      variant: "create",
                      fieldsReady: true,
                      credentialFields: editor.credentialFields,
                      gatewayEgressIp: props.readModel.gatewayEgressIp,
                      reauthHint: selectedProvider?.reauthHint,
                      busy: editor.busy,
                      onCredentialFieldChange: editor.onCredentialFieldChange,
                      oauth: oauthAction
                        ? {
                            label: "连接 ↗",
                            ...oauthAction,
                          }
                        : undefined,
                    })
                  : nothing
              }
              ${
                filteredBindings.length > 0
                  ? html`
                      <label class="enterprise-settings-field">
                        <span>或选择已有凭证</span>
                        <select
                          .value=${editor.credentialBindingId}
                          ?disabled=${editor.busy}
                          @change=${(event: Event) =>
                            editor.onCredentialBindingIdChange(
                              (event.target as HTMLSelectElement).value,
                            )}
                        >
                          <option value="">不使用已有凭证</option>
                          ${filteredBindings.map(
                            (entry) => html`
                              <option value=${entry.credentialBindingId}>
                                ${connectorLabel.get(entry.connectorId) ?? entry.connectorId}
                              </option>
                            `,
                          )}
                        </select>
                      </label>
                    `
                  : nothing
              }
            `
          : editor.mode === "policy"
            ? renderEnterpriseIdentityPolicyEditorFields({
                editor,
                readModel: props.readModel,
              })
            : editor.mode === "credential"
              ? profile
                ? renderEnterpriseIdentityCredentialEditPanel({
                    profile,
                    provider: editor.provider,
                    providerLabel: selectedProvider?.label ?? editor.provider,
                    variant: "edit",
                    fieldsReady: editor.credentialFieldsReady,
                    externalAccountId: editor.credentialFields.appId,
                    credentialFields: editor.credentialFields,
                    credentialSecretsConfigured: editor.credentialSecretsConfigured,
                    gatewayEgressIp: props.readModel.gatewayEgressIp,
                    reauthHint: selectedProvider?.reauthHint,
                    busy: editor.busy,
                    onCredentialFieldChange: editor.onCredentialFieldChange,
                    oauth: oauthAction
                      ? {
                          label: "重新授权 ↗",
                          ...oauthAction,
                        }
                      : undefined,
                  })
                : html`
                    <div class="enterprise-settings-empty">该平台不支持在此编辑凭证。</div>
                  `
              : editor.mode === "edit"
                ? html`
                    <label class="enterprise-settings-field">
                      <span>账号名称</span>
                      <input
                        type="text"
                        .value=${editor.displayName}
                        ?disabled=${editor.busy}
                        @input=${(event: Event) =>
                          editor.onDisplayNameChange((event.target as HTMLInputElement).value)}
                      />
                    </label>
                  `
                : html`
                <label class="enterprise-settings-field">
                  <span>身份</span>
                  <select
                    .value=${editor.identityId}
                    ?disabled=${editor.busy}
                    @change=${(event: Event) =>
                      editor.onIdentityIdChange((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">选择身份</option>
                    ${editor.identityOptions.map(
                      (entry) => html`
                        <option value=${entry.identityId}>
                          ${entry.displayName} (${entry.providerLabel})
                        </option>
                      `,
                    )}
                  </select>
                </label>
                <label class="enterprise-settings-field">
                  <span>数据源</span>
                  <select
                    .value=${editor.dataSourceId}
                    ?disabled=${editor.busy}
                    @change=${(event: Event) =>
                      editor.onDataSourceIdChange((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">选择 DataSource</option>
                    ${editor.eligibleDataSources.map(
                      (entry) => html`
                        <option value=${entry.sourceId}>
                          ${entry.displayName} (${entry.sourceKey})
                        </option>
                      `,
                    )}
                  </select>
                </label>
                <label class="enterprise-settings-field">
                  <span>用途</span>
                  <select
                    .value=${editor.bindingPurpose}
                    ?disabled=${editor.busy}
                    @change=${(event: Event) =>
                      editor.onBindingPurposeChange(
                        (event.target as HTMLSelectElement).value as typeof editor.bindingPurpose,
                      )}
                  >
                    <option value="source_authentication">source_authentication</option>
                    <option value="source_collection">source_collection</option>
                    <option value="source_sync">source_sync</option>
                  </select>
                </label>
              `
      }
      ${
        pickingProvider
          ? nothing
          : html`
              <div class="enterprise-settings-actionbar">
                <button class="btn btn--sm" type="button" ?disabled=${editor.busy} @click=${editor.onClose}>
                  取消
                </button>
                <button
                  class="btn btn--sm btn--primary"
                  type="button"
                  ?disabled=${!tenantId || editor.busy}
                  @click=${editor.onSubmit}
                >
                  ${submitLabel}
                </button>
              </div>
            `
      }
    </article>
  `;
}

function renderIdentityRevokeConfirmModal(params: {
  props: EnterpriseSurfaceProps;
  tenantId: string | null;
}) {
  const { props, tenantId } = params;
  const editor = props.identityManagementEditor;
  const identityId = (editor?.revokeConfirmIdentityId ?? "").trim();
  if (!identityId) {
    return nothing;
  }
  const asset =
    props.readModel.identityAssetSummaries.find((entry) => entry.identityId === identityId) ?? null;
  const displayName = asset?.displayName?.trim() || identityId;
  return html`
    <div
      class="enterprise-access-modal-overlay enterprise-identity-editor-overlay enterprise-identity-revoke-overlay"
      role="presentation"
      @click=${(event: Event) => {
        if (event.target === event.currentTarget && !editor.busy) {
          editor.onCloseRevokeConfirm();
        }
      }}
    >
      <section
        class="enterprise-access-modal enterprise-identity-revoke-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="enterprise-identity-revoke-title"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="enterprise-access-modal__title" id="enterprise-identity-revoke-title">
          确认删除
        </div>
        <p class="enterprise-identity-revoke-modal__prompt">
          确定删除「<strong>${displayName}</strong>」？
        </p>
        <div class="enterprise-access-modal__footer">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${editor.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              editor.onCloseRevokeConfirm();
            }}
          >
            取消
          </button>
          <button
            class="btn btn--sm btn--danger"
            type="button"
            ?disabled=${!tenantId || editor.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              editor.onConfirmRevoke();
            }}
          >
            ${editor.busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  `;
}

/** 收敛 lit `nothing`（unique symbol）为空模板，满足回调 `() => TemplateResult` 的契约。 */
function asTemplateResult(
  value: ReturnType<typeof html> | typeof nothing,
): ReturnType<typeof html> {
  return value === nothing ? html`` : value;
}

function renderIdentityWorkspace(params: {
  props: EnterpriseSurfaceProps;
  tenantId: string | null;
  baseHref: string;
  view: "catalog" | "bindings";
}) {
  const { props, tenantId, baseHref, view } = params;
  const readModel = props.readModel;
  const rows = readModel.employeeIdentityBindingRows ?? [];
  const unreadCount = countUnreadBindingActivity(
    readModel.recentIdentityBindingActivity ?? [],
    readBindingActivitySeenAt(tenantId),
  );
  const employeeCount = new Set(rows.map((row) => row.employeeId)).size;
  const identityCount = new Set(rows.map((row) => row.identityId)).size;
  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      <div class="enterprise-identity-workspace__toolbar">
        ${renderEnterpriseSegmentedNav(
          [
            {
              id: "catalog",
              label: "身份目录",
              hint: "连接与管理企业数字身份",
              active: view === "catalog",
              href: buildSettingsSectionHref(baseHref, "identities"),
            },
            {
              id: "bindings",
              label: "绑定总览",
              hint: "员工把企业身份绑到机器人的记录",
              active: view === "bindings",
              href: buildSettingsSectionHref(baseHref, "identity-bindings"),
            },
          ],
          (id) =>
            navigateToPortHref(
              buildSettingsSectionHref(
                baseHref,
                id === "bindings" ? "identity-bindings" : "identities",
              ),
            ),
        )}
        <div class="enterprise-settings-actionbar">
          ${
            view === "catalog" && tenantId
              ? html`<button
                  class="btn btn--sm btn--primary"
                  type="button"
                  @click=${() =>
                    props.actions.settings.onOpenIdentityEditor(tenantId, {
                      mode: "register",
                    })}
                >
                  ${renderIcon("plus")} 连接身份
                </button>`
              : nothing
          }
          ${
            view === "bindings" && unreadCount > 0
              ? html`<button
                  class="btn btn--sm"
                  type="button"
                  @click=${() => {
                    writeBindingActivitySeenAt(tenantId);
                    props.identityManagementEditor.onMarkEmployeeBindingActivityRead?.();
                  }}
                >
                  全部标为已读
                </button>`
              : nothing
          }
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${!tenantId || readModel.operationalIdentityBusy}
            @click=${() => tenantId && props.actions.settings.onRefreshIdentities(tenantId)}
          >
            ${renderIcon("refreshCw")} 同步
          </button>
        </div>
      </div>
      ${
        view === "bindings"
          ? html`
              <div class="enterprise-identity-compact-stats">
                <span class="enterprise-identity-compact-stat">绑定记录 ${rows.length}</span>
                <span
                  class="enterprise-identity-compact-stat${unreadCount > 0 ? " enterprise-identity-compact-stat--warn" : ""}"
                >${unreadCount > 0 ? "△ " : ""}未读变更 ${unreadCount}</span>
                <span class="enterprise-identity-compact-stat">涉及员工 ${employeeCount}</span>
                <span class="enterprise-identity-compact-stat">涉及身份 ${identityCount}</span>
              </div>
              ${
                readModel.operationalIdentityNotice
                  ? html`<div class="enterprise-settings-notice">${readModel.operationalIdentityNotice}</div>`
                  : nothing
              }
              ${renderEnterpriseIdentityEmployeeBindingsPanel({
                readModel,
                editor: props.identityManagementEditor,
                tenantId,
                standalone: true,
                onMarkBindingActivityRead:
                  props.identityManagementEditor.onMarkEmployeeBindingActivityRead,
                onOpenIdentity: (identityId) => {
                  props.identityManagementEditor.onSelectDetailIdentity(identityId);
                  navigateToPortHref(buildSettingsSectionHref(baseHref, "identities"));
                },
              })}
            `
          : renderEnterpriseIdentityAssetsSection({
              props,
              tenantId,
              omitChrome: true,
              renderIdentityManagementEditor: () =>
                asTemplateResult(
                  renderIdentityManagementEditor({
                    props,
                    tenantId,
                  }),
                ),
              renderIdentityRevokeConfirmModal: () =>
                asTemplateResult(
                  renderIdentityRevokeConfirmModal({
                    props,
                    tenantId,
                  }),
                ),
            })
      }
    </section>
  `;
}

function modelAuthorizationOrgRoster(readModel: EnterpriseSurfaceProps["readModel"]) {
  return {
    departmentPaths: readModel.organizationDepartmentPaths ?? [],
    childOrders: readModel.organizationChildOrders,
    seats: readModel.seatSummaries.map((seat) => ({
      seatId: seat.seatId,
      title: seat.title,
      teamLabel: seat.teamLabel,
      status: seat.status,
      roleCode: seat.roleCode,
      occupantLabel: seat.currentEmployeeLabel,
      occupantUser: seat.currentEmployeeUser,
    })),
    members: readModel.memberSummaries.map((member) => ({
      user: member.user,
      displayLabel: member.displayLabel,
      membershipRole: member.membershipRole,
      status: member.status,
      seatTitle: member.seatTitle,
      seatTeamLabel: member.seatTeamLabel,
    })),
  };
}

function renderIntegrationsSection(params: {
  props: EnterpriseSurfaceProps;
  baseHref: string;
  modelsView: ModelsSettingsView;
}) {
  const { props, modelsView } = params;
  const providerCount = props.readModel.configuredProviderCount;
  const providerIds = props.readModel.providerIds ?? [];
  const modelCount = props.readModel.configuredModelCount;
  const modelIds = props.readModel.configuredModelIds ?? [];
  const modelMode = props.readModel.modelMode;

  return html`
    <section
      class="enterprise-settings-section enterprise-settings-section--flat"
      data-testid="enterprise-models-settings"
    >
      ${renderEnterpriseSegmentedNav(
        [
          {
            id: "authorization",
            label: "模型授权",
            hint: "按组织选择席位，调整模型授权",
            active: modelsView === "authorization",
          },
          {
            id: "keys",
            label: "模型与 API Key",
            hint: "模型提供方与密钥",
            active: modelsView === "keys",
          },
        ],
        (id) => {
          if (id === "authorization" || id === "keys") {
            navigateToPortHref(buildIntegrationsTabHref(params.baseHref, id));
          }
        },
      )}
      ${
        modelsView === "keys"
          ? html`
              <enterprise-integrations-providers
                .client=${props.client ?? null}
                .enterpriseId=${props.readModel.currentTenantId ?? ""}
                .catalogProviderIds=${providerIds}
                .catalogModelIds=${modelIds}
                .modelMode=${modelMode ?? ""}
                .providerCount=${providerCount}
                .modelCount=${modelCount}
                .onOpenAuthorization=${() =>
                  navigateToPortHref(buildIntegrationsTabHref(params.baseHref, "authorization"))}
                .orgRoster=${modelAuthorizationOrgRoster(props.readModel)}
              ></enterprise-integrations-providers>
            `
          : props.client
            ? html`
                <model-authorization-section
                  .client=${props.client}
                  .enterpriseId=${props.readModel.currentTenantId ?? null}
                  .orgRoster=${modelAuthorizationOrgRoster(props.readModel)}
                  .embedded=${true}
                ></model-authorization-section>
              `
            : html`
                <div class="model-auth-empty">连接网关后可管理模型授权。</div>
              `
      }
    </section>
  `;
}

function renderGovernanceSection(params: { props: EnterpriseSurfaceProps }) {
  const { props } = params;
  const canEditSupervisor = canEditEnterpriseSupervisorPolicy(props.readModel.membershipRole);
  const issueLabels = props.readModel.configIssueLabels ?? [];
  const anomalies = props.readModel.meshAnomalies ?? [];
  const governanceItems = [
    ...issueLabels.map((label) => ({
      title: label,
      meta: "配置策略待处理",
    })),
    ...anomalies.slice(0, 4).map((entry) => ({
      title: entry.reason,
      meta: `${entry.title} · ${entry.meta}`,
    })),
  ].slice(0, 6);
  const stats: SettingsStat[] = [
    {
      label: "策略待办",
      value: `${props.readModel.configIssueCount}`,
      tone: props.readModel.configIssueCount > 0 ? "warn" : "ok",
    },
    {
      label: "治理异常",
      value: `${props.readModel.meshSummary.governanceIssueCount}`,
      tone: props.readModel.meshSummary.governanceIssueCount > 0 ? "warn" : "ok",
    },
    {
      label: "未归因成本",
      value: `${props.readModel.meshSummary.unattributedCostCount}`,
      tone: props.readModel.meshSummary.unattributedCostCount > 0 ? "warn" : undefined,
    },
    {
      label: "未归属对象",
      value: `${props.readModel.meshSummary.unownedAssetCount}`,
      tone: props.readModel.meshSummary.unownedAssetCount > 0 ? "warn" : undefined,
    },
  ];

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      <header
        class="enterprise-settings-section__header enterprise-settings-section__header--actions"
      >
        <div class="enterprise-settings-actionbar">
          <button
            class="btn btn--sm btn--primary"
            type="button"
            title="重新加载当前策略快照"
            @click=${() => props.actions.settings.onRefreshPolicies()}
          >
            ${renderIcon("clipboardCheck")} 重新校验
          </button>
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => props.actions.mesh.onRefreshIncidents()}
          >
            ${renderIcon("refreshCw")} 刷新治理
          </button>
        </div>
      </header>

      ${renderSettingsStats(stats)}

      <div class="enterprise-settings-panel-grid">
        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">企业策略基线</div>
              <div class="enterprise-settings-panel__sub">
                ${props.readModel.configValid === false ? "当前存在配置漂移或策略缺口。" : "策略基线已建立。"}
              </div>
            </div>
            <button
              class="btn btn--sm enterprise-settings-panel__head-action"
              type="button"
              title="重新加载当前策略快照"
              @click=${() => props.actions.settings.onRefreshPolicies()}
            >
              校验
            </button>
          </div>
          ${
            issueLabels.length === 0
              ? html`
                  <div class="enterprise-settings-empty">没有待处理的企业策略事项。</div>
                `
              : html`
                  <ul class="enterprise-settings-row-list">
                    ${issueLabels.slice(0, 4).map(
                      (label) => html`
                        <li class="enterprise-settings-row enterprise-settings-row--warn">
                          <span class="enterprise-settings-status is-warn">待处理</span>
                          <div class="enterprise-settings-row__main">
                            <div class="enterprise-settings-row__title">${label}</div>
                            <div class="enterprise-settings-row__meta">
                              建议修复后再继续管理员操作。
                            </div>
                          </div>
                        </li>
                      `,
                    )}
                  </ul>
                `
          }
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">资产流转边界</div>
              <div class="enterprise-settings-panel__sub">
                把提交、审核、发布和上架拆成清晰边界，避免审批和商业化混在一起。
              </div>
            </div>
          </div>
          <div class="enterprise-settings-chip-row">
            <span class="enterprise-settings-chip">员工贡献</span>
            <span class="enterprise-settings-chip">企业审核</span>
            <span class="enterprise-settings-chip">企业发布</span>
            <span class="enterprise-settings-chip">平台上架独立决策</span>
          </div>
          <div class="enterprise-settings-empty">
            企业内部审核通过并不等于自动上架到平台。商业化、价格和市场曝光应该在平台层独立决策。
          </div>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">治理待办</div>
              <div class="enterprise-settings-panel__sub">优先关注未归属、未归因和受限对象。</div>
            </div>
            <button
              class="btn btn--sm enterprise-settings-panel__head-action"
              type="button"
              title="重新加载治理待办"
              @click=${() => props.actions.mesh.onRefreshIncidents()}
            >
              刷新
            </button>
          </div>
          ${
            governanceItems.length === 0
              ? html`
                  <div class="enterprise-settings-empty">当前没有治理积压。</div>
                `
              : html`
                  <ul class="enterprise-settings-row-list">
                    ${governanceItems.map(
                      (entry) => html`
                        <li class="enterprise-settings-row enterprise-settings-row--warn">
                          <span class="enterprise-settings-status is-warn">待处理</span>
                          <div class="enterprise-settings-row__main">
                            <div class="enterprise-settings-row__title">${entry.title}</div>
                            <div class="enterprise-settings-row__meta">${entry.meta}</div>
                          </div>
                        </li>
                      `,
                    )}
                  </ul>
                `
          }
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">成本与归因</div>
              <div class="enterprise-settings-panel__sub">
                快速识别预算、归因缺口与异常成本对象。
              </div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>累计成本</dt>
              <dd>${props.readModel.totalCost.toFixed(2)}</dd>
            </div>
            <div>
              <dt>累计令牌</dt>
              <dd>${props.readModel.totalTokens}</dd>
            </div>
            <div>
              <dt>缺失成本记录</dt>
              <dd>${props.readModel.missingCostEntries}</dd>
            </div>
            <div>
              <dt>未归因对象</dt>
              <dd>${props.readModel.meshSummary.unattributedCostCount}</dd>
            </div>
          </dl>
        </article>
      </div>

      <p class="enterprise-settings-panel__sub" data-retention-consequence>
        对话会按此保留，到期归档或删除。
      </p>
      <div class="enterprise-settings-panel-grid">
        <enterprise-memory-governance-card
          .client=${props.client ?? null}
          .tenantId=${props.readModel.currentTenantId}
        ></enterprise-memory-governance-card>
        <enterprise-retention-policy-card
          .client=${props.client ?? null}
          .tenantId=${props.readModel.currentTenantId}
        ></enterprise-retention-policy-card>
      </div>

      <div class="enterprise-settings-supervisor-block">
        <div class="enterprise-settings-panel__head">
          <div>
            <div class="enterprise-settings-panel__title">开发监督</div>
            <div class="enterprise-settings-panel__sub">
              ${
                canEditSupervisor
                  ? "管理租户 Worker 执行策略与 seat → Node 绑定，支撑 IDE CLI 在本机执行监督任务。"
                  : "查看租户 Worker 执行策略与 seat → Node 绑定（只读）。修改需 enterprise-admin 权限。"
              }
            </div>
          </div>
        </div>
        <supervisor-worker-policy-panel
          .client=${props.client ?? null}
          .tenantId=${props.readModel.currentTenantId}
          .editable=${canEditSupervisor}
        ></supervisor-worker-policy-panel>
        <supervisor-node-registry-panel
          .client=${props.client ?? null}
          .tenantId=${props.readModel.currentTenantId}
          .editable=${canEditSupervisor}
        ></supervisor-node-registry-panel>
        ${
          canEditSupervisor
            ? html`
                <cli-credential-self-panel
                  variant="enterprise"
                  .client=${props.client ?? null}
                ></cli-credential-self-panel>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

function renderEnterprisePasswordChangeSection(authPanelProps: PlatformAuthPanelProps | null) {
  if (!authPanelProps?.state?.enabled) {
    return html`
      <div class="enterprise-settings-empty">
        ${t("frontstage.workbench.settings.securityPasswordUnavailable")}
      </div>
    `;
  }
  if (!authPanelProps.session || !authPanelProps.onChangePassword) {
    return html`
      <div class="enterprise-settings-empty">
        ${t("frontstage.workbench.settings.securityPasswordUnavailable")}
      </div>
    `;
  }
  return html`
    <div class="enterprise-settings-password-form">
      <div class="enterprise-settings-row__title">
        ${t("overview.platformAuth.passwordChangeTitle")}
      </div>
      <div class="enterprise-settings-form-grid enterprise-settings-gap-md">
        <label class="field">
          <span>${t("overview.platformAuth.fields.currentPassword")}</span>
          <input
            type="password"
            autocomplete="current-password"
            .value=${authPanelProps.currentPassword}
            ?disabled=${authPanelProps.busy}
            @input=${(event: Event) =>
              authPanelProps.onCurrentPasswordChange?.(
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label class="field">
          <span>${t("overview.platformAuth.fields.newPassword")}</span>
          <input
            type="password"
            autocomplete="new-password"
            .value=${authPanelProps.newPassword}
            ?disabled=${authPanelProps.busy}
            @input=${(event: Event) =>
              authPanelProps.onNewPasswordChange?.((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="enterprise-form-actions">
        <button
          class="btn btn--sm btn--primary"
          type="button"
          ?disabled=${
            authPanelProps.busy ||
            !authPanelProps.currentPassword.trim() ||
            !authPanelProps.newPassword.trim()
          }
          @click=${() => void authPanelProps.onChangePassword?.()}
        >
          ${
            authPanelProps.busy
              ? t("common.loading")
              : t("overview.platformAuth.passwordChangeSubmit")
          }
        </button>
      </div>
      ${
        authPanelProps.error
          ? html`
              <div class="enterprise-settings-kv__error enterprise-settings-gap-sm">
                ${authPanelProps.error}
              </div>
            `
          : nothing
      }
      ${
        authPanelProps.notice
          ? html`
              <div class="enterprise-settings-empty enterprise-settings-gap-sm">
                ${authPanelProps.notice}
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderSecuritySection(params: { props: EnterpriseSurfaceProps }) {
  const { props } = params;
  const authState = props.authPanelProps?.state;
  const stats: SettingsStat[] = [
    {
      label: "连接状态",
      value: settingsConnection(props).label,
      tone:
        settingsConnection(props).tone === "ok"
          ? "ok"
          : settingsConnection(props).tone === "warn"
            ? "warn"
            : undefined,
    },
    { label: "当前角色", value: formatEnterpriseRoleLabel(props.readModel.membershipRole) },
    { label: "活动会话", value: `${props.readModel.sessionsCount}` },
    {
      label: "安全提醒",
      value: `${Number(Boolean(settingsLastError(props))) + props.readModel.configIssueCount}`,
      tone:
        Boolean(settingsLastError(props)) || props.readModel.configIssueCount > 0 ? "warn" : "ok",
    },
  ];

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      <header
        class="enterprise-settings-section__header enterprise-settings-section__header--actions"
      >
          <div class="enterprise-settings-actionbar">
          ${
            props.client?.connected
              ? renderAuditExportButton(props.client, "导出审计")
              : renderPendingSettingsAction("导出审计")
          }
          ${
            props.client?.connected
              ? nothing
              : html`
                  <span class="enterprise-settings-row__meta">尚未接入</span>
                `
          }
          <button
            class="btn btn--sm btn--danger"
            type="button"
            @click=${() => {
              if (!shouldProceed("确认退出企业管理员会话？")) {
                return;
              }
              void props.actions.settings.onLogout();
            }}
          >
            退出企业管理员
          </button>
        </div>
      </header>

      ${renderSettingsStats(stats)}

      <div class="enterprise-settings-panel-grid">
        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">当前账号与访问</div>
              <div class="enterprise-settings-panel__sub">
                当前管理员会话概览，登录入口保留在独立登录页。
              </div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>当前账号</dt>
              <dd>${props.readModel.authenticatedUser ?? "未识别"}</dd>
            </div>
            <div>
              <dt>成员角色</dt>
              <dd>${formatEnterpriseRoleLabel(props.readModel.membershipRole)}</dd>
            </div>
            <div>
              <dt>会话类型</dt>
              <dd>${formatEnterpriseRoleLabel(authState?.sessionKind)}</dd>
            </div>
            <div>
              <dt>当前企业</dt>
              <dd>${authState?.enterprise?.name ?? props.readModel.currentTenantLabel ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">账号安全</div>
              <div class="enterprise-settings-panel__sub">登录策略、双因素与会话控制。</div>
            </div>
          </div>
          ${renderEnterprisePasswordChangeSection(props.authPanelProps)}
          <ul class="enterprise-settings-row-list enterprise-settings-gap-lg">
            ${renderEnterpriseSecurityControlRows(props)}
            <li class="enterprise-settings-row">
              <div class="enterprise-settings-row__main">
                <div class="enterprise-settings-row__title">会话超时</div>
                <div class="enterprise-settings-row__meta">
                  ${
                    props.client?.connected
                      ? "空闲超时会删除到期的登录会话，并在下一次网关请求时重新校验。"
                      : "尚未接入 · 登录会话没有空闲计时，这里不能调整。"
                  }
                </div>
              </div>
              ${
                props.client?.connected
                  ? renderSessionPolicyControl(props.client)
                  : html`<div class="enterprise-settings-row__actions">
                    ${renderPendingSettingsAction("调整")}
                  </div>`
              }
            </li>
            <li class="enterprise-settings-row">
              <div class="enterprise-settings-row__main">
                <div class="enterprise-settings-row__title">IP 白名单</div>
                <div class="enterprise-settings-row__meta">
                  ${
                    props.client?.connected
                      ? "登录、会话和网关使用同一来源地址。不包含当前地址时不会写入。"
                      : "尚未接入 · 不能在此配置。登录和网关看到的来源地址不一致，写入可能把当前管理员锁在外面。"
                  }
                </div>
              </div>
              ${
                props.client?.connected
                  ? renderIpAllowlistControl(props.client)
                  : html`<div class="enterprise-settings-row__actions">
                    ${renderPendingSettingsAction("配置")}
                  </div>`
              }
            </li>
          </ul>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">操作日志</div>
              <div class="enterprise-settings-panel__sub">
                登录、密钥变更、权限调整与租户操作审计。
              </div>
            </div>
            ${
              props.client?.connected
                ? renderAuditExportButton(props.client, "导出")
                : renderPendingSettingsAction("导出")
            }
          </div>
          ${renderPendingSecurityNotice()}
          <div class="enterprise-settings-empty">
            ${
              props.client?.connected
                ? "导出只包含本企业安全审计，并在下载时再次核对租户。"
                : "审计导出尚未接入。现有登录日志没有企业字段，不能按租户安全导出。"
            }
          </div>
        </article>

        <article class="enterprise-settings-panel enterprise-settings-panel--flat">
          <div class="enterprise-settings-panel__head">
            <div>
              <div class="enterprise-settings-panel__title">连接与异常</div>
              <div class="enterprise-settings-panel__sub">
                快速确认当前环境是否稳定，避免误把环境问题看成权限问题。
              </div>
            </div>
          </div>
          <dl class="enterprise-settings-kv">
            <div>
              <dt>连接状态</dt>
              <dd>
                <span
                  class="enterprise-settings-status ${settingsConnection(props).tone === "ok" ? "is-ok" : settingsConnection(props).tone === "warn" ? "is-warn" : ""}"
                >
                  ${settingsConnection(props).label}
                </span>
              </dd>
            </div>
            <div>
              <dt>最近错误</dt>
              <dd class=${settingsLastError(props) ? "enterprise-settings-kv__error" : ""}>
                ${settingsLastError(props) ?? "暂无"}
              </dd>
            </div>
            <div>
              <dt>配置待办</dt>
              <dd>${props.readModel.configIssueCount}</dd>
            </div>
            <div>
              <dt>在线节点</dt>
              <dd>${props.readModel.nodeCount}</dd>
            </div>
          </dl>
        </article>
      </div>

      ${
        props.operationalIdentityGovernancePanel
          ? renderOperationalIdentityGovernancePanel({
              ...props.operationalIdentityGovernancePanel,
              viewContext: "enterprise",
            })
          : nothing
      }
    </section>
  `;
}

export function renderAccessControlCenter(props: EnterpriseSurfaceProps, notices: SurfaceBlock[]) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const accessView = resolveAccessView(search);
  const accessRole = resolveAccessRoleKey(search);
  const accessUser = resolveAccessUserKey(search);
  const accessSearch = resolveAccessSearch(search).toLowerCase();
  const accessMatrixFilter = resolveAccessMatrixFilter(search);
  const settingsSection = resolveSettingsSection(pathname, search);
  const modelsView = resolveModelsView(search);
  const editor = props.accessControlEditor ?? {
    kind: null,
    targetKey: null,
    selectedPermissionIds: [] as string[],
    notice: null,
    riskConfirmOpen: false,
    onOpen: () => undefined,
    onClose: () => undefined,
    onTogglePermission: () => undefined,
    onSave: () => undefined,
    onCancelRisk: () => undefined,
    onConfirmRisk: () => undefined,
  };
  const baseHref =
    pathname && typeof window !== "undefined"
      ? resolveSettingsBaseHref(pathname)
      : pathForTab("enterpriseSettings", props.basePath, {
          tenantId: props.readModel.currentTenantId,
        });
  const roles = (
    [
      { key: "viewer", label: "查看者" },
      { key: "operator", label: "操作员" },
      { key: "admin", label: "管理员" },
    ] as const
  ).map((role) => ({
    key: role.key,
    label: role.label,
    count: props.readModel.memberSummaries.filter(
      (member) => normalizeAccessRole(member) === role.key,
    ).length,
    permissions: ACCESS_ROLE_PERMISSIONS[role.key],
  }));
  const selectedRole = roles.find((entry) => entry.key === accessRole) ?? roles[1];
  const users = props.readModel.memberSummaries
    .map((member) => {
      const normalizedRole = normalizeAccessRole(member);
      const rolePermissions =
        ACCESS_ROLE_PERMISSIONS[member.membershipRole === "enterprise-admin" ? "admin" : "viewer"];
      const positionPermissions = member.seatTitle ? ACCESS_ROLE_PERMISSIONS.operator : [];
      return {
        ...member,
        normalizedRole,
        rolePermissions,
        positionPermissions,
        teamPermissions: [] as string[],
        overridePermissions: [] as string[],
        effectivePermissions: dedupePermissionIds([...rolePermissions, ...positionPermissions]),
      };
    })
    .filter((member) => {
      if (!accessSearch) {
        return true;
      }
      return (
        member.displayLabel.toLowerCase().includes(accessSearch) ||
        member.user.toLowerCase().includes(accessSearch) ||
        (member.seatTitle?.toLowerCase().includes(accessSearch) ?? false)
      );
    })
    .toSorted((left, right) => {
      const leftScore =
        left.normalizedRole === "admin" ? 2 : left.normalizedRole === "operator" ? 1 : 0;
      const rightScore =
        right.normalizedRole === "admin" ? 2 : right.normalizedRole === "operator" ? 1 : 0;
      return rightScore - leftScore || left.displayLabel.localeCompare(right.displayLabel);
    });
  const selectedUser = users.find((entry) => entry.user === accessUser) ?? users[0] ?? null;
  const matrixPermissions = ACCESS_PERMISSION_CATALOG.filter(
    (entry) => accessMatrixFilter === "all" || entry.highRisk,
  );
  const adminOverage = Math.max(props.readModel.adminCount - 1, 0);
  const drawerRole = roles.find((entry) => entry.key === editor.targetKey) ?? null;
  const drawerUser = users.find((entry) => entry.user === editor.targetKey) ?? null;
  const drawerKind = editor.kind;
  const drawerLabel =
    drawerKind === "role"
      ? (drawerRole?.label ?? "角色")
      : (drawerUser?.displayLabel ?? drawerUser?.user ?? "成员");
  const drawerSelectedIds =
    editor.selectedPermissionIds.length > 0
      ? editor.selectedPermissionIds
      : drawerKind === "role"
        ? (drawerRole?.permissions ?? [])
        : (drawerUser?.effectivePermissions ?? []);
  const drawerHighRiskItems = ACCESS_PERMISSION_CATALOG.filter(
    (entry) => entry.highRisk && drawerSelectedIds.includes(entry.id),
  );
  // 权限编辑器主体只构建一次：角色/成员视图已有左右分栏工作台，
  // 编辑器直接内联到右侧详情栏（workspace 呈现）；矩阵视图没有详情栏，
  // 仍以浮层抽屉呈现。权限目录与保存回调保持不变。
  const permissionEditorInline =
    settingsSection === "access" &&
    ((drawerKind === "role" && accessView === "roles") ||
      (drawerKind === "user" && accessView === "users"));
  const permissionEditorBody = drawerKind
    ? html`
        <div class="enterprise-access-drawer__header">
          <div>
            <div class="enterprise-access-drawer__title">编辑权限 · ${drawerLabel}</div>
            <div class="enterprise-access-drawer__sub">
              ${drawerKind === "role" ? "角色规则" : "成员生效权限"} ·
              ${props.client?.connected ? "只提交 usage:budget" : "本地草稿模式"}
            </div>
          </div>
          <button class="btn btn--sm" type="button" @click=${editor.onClose}>关闭</button>
        </div>
        ${
          drawerKind === "user" && drawerUser
            ? html`
                <div class="enterprise-access-drawer__sources">
                  <span class="enterprise-access-tag">岗位：${drawerUser.seatTitle ?? "无"}</span>
                  <span class="enterprise-access-tag">角色：${drawerUser.membershipRole}</span>
                  <span class="enterprise-access-tag enterprise-access-tag--info"
                    >临时授权：无</span
                  >
                </div>
              `
            : nothing
        }
        ${renderAccessPermissionTree(
          ACCESS_PERMISSION_CATALOG.map((entry) => entry.id),
          {
            editable: true,
            selectedIds: drawerSelectedIds,
            onToggle: editor.onTogglePermission,
          },
        )}
        ${editor.notice ? html`<div class="enterprise-access-drawer__notice">${editor.notice}</div>` : nothing}
        ${
          accessCommitNotice()
            ? html`<div class="enterprise-access-drawer__notice" data-testid="access-commit-notice"
              >${accessCommitNotice()?.text}</div
            >`
            : nothing
        }
        <div class="enterprise-access-drawer__footer">
          <button class="btn" type="button" @click=${editor.onClose}>取消</button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${!props.client?.connected}
            title=${
              props.client?.connected
                ? "提交到网关。只有 usage:budget 会改变鉴权，其余权限不会写入。"
                : "只更新本地草稿，不会写入权限。正式提交尚未接入。"
            }
            @click=${() => {
              const targetKey = editor.targetKey;
              if (!props.client?.connected || !drawerKind || !targetKey) {
                editor.onSave({
                  targetLabel: drawerLabel,
                  hasHighRisk: drawerHighRiskItems.length > 0,
                });
                return;
              }
              const permissionIds =
                editor.selectedPermissionIds.length > 0
                  ? editor.selectedPermissionIds
                  : drawerSelectedIds;
              if (drawerHighRiskItems.length > 0) {
                editor.onSave({ targetLabel: drawerLabel, hasHighRisk: true });
                return;
              }
              void submitAccessPermissionCommit({
                client: props.client,
                targetKind: drawerKind === "role" ? "role" : "member",
                targetKey,
                permissionIds,
                confirmedHighRiskPermissionIds: [],
              });
            }}
          >
            ${props.client?.connected ? "提交权限" : "保存草稿"}
          </button>
        </div>
        <p class="enterprise-settings-row__meta" data-testid="access-permission-commit-pending">
          ${
            props.client?.connected
              ? "只有 usage:budget 会改变非管理员的预算权限。其他矩阵项不会写入。"
              : "正式提交尚未接入。成员身份只有企业管理员和成员两档，保存只留在这台浏览器的草稿里，不会写入权限。"
          }
        </p>
      `
    : nothing;

  const identityChrome =
    settingsSection === "identities" || settingsSection === "identity-bindings";
  return html`
    <div
      class="enterprise-access${identityChrome ? " enterprise-access--compact-chrome" : ""}"
      @click=${followDelegatedPortHref}
    >
      ${notices}
      ${renderSettingsSectionShell({
        props,
        baseHref,
        settingsSection,
        accessView,
        selectedUser: selectedUser?.user ?? null,
      })}
      ${
        settingsSection === "access"
          ? html`
              <div
                class="enterprise-settings-section enterprise-settings-section--flat enterprise-access-toolbar-wrap"
              >
                <div class="enterprise-settings-actionbar enterprise-settings-actionbar--start">
                  ${
                    props.readModel.adminCount > 0
                      ? html`<span class="enterprise-access-pill enterprise-access-pill--danger"
                          >${props.readModel.adminCount} 个高权限待复核</span
                        >`
                      : nothing
                  }
                  ${
                    adminOverage > 0
                      ? html`<span class="enterprise-access-pill enterprise-access-pill--warn"
                          >${adminOverage} 个管理员过多</span
                        >`
                      : nothing
                  }
                  <a
                    class="btn btn--sm"
                    data-testid="enterprise-access-invite-admin"
                    title="进入员工名录，选择员工发送管理员邀请"
                    href=${buildEnterpriseAdminInviteDirectoryHref(
                      props.basePath,
                      props.readModel.currentTenantId,
                    )}
                  >
                    ${renderIcon("user")} 邀请管理员
                  </a>
                  <a
                    class="btn btn--sm btn--primary"
                    href=${appendAccessSearchToHref(buildSettingsSectionHref(baseHref, "access"), {
                      view: "users",
                      user: selectedUser?.user ?? null,
                    })}
                  >
                    立即复核
                  </a>
                </div>
                ${renderEnterpriseSegmentedNav(
                  [
                    { id: "roles", label: "角色与权限", active: accessView === "roles" },
                    { id: "users", label: "成员权限", active: accessView === "users" },
                    { id: "matrix", label: "权限矩阵", active: accessView === "matrix" },
                  ],
                  (id) =>
                    navigateToPortHref(
                      appendAccessSearchToHref(buildSettingsSectionHref(baseHref, "access"), {
                        view: id as AccessView,
                        role: accessRole,
                        user: selectedUser?.user ?? accessUser,
                        query: accessSearch || null,
                        matrix: accessMatrixFilter,
                      }),
                    ),
                )}
              </div>
            `
          : nothing
      }
      ${settingsSection === "overview" ? renderSettingsOverviewSection({ props, baseHref }) : nothing}
      ${settingsSection === "profile" ? renderProfileSection({ props }) : nothing}
      ${
        settingsSection === "integrations"
          ? renderIntegrationsSection({ props, baseHref, modelsView })
          : nothing
      }
      ${
        settingsSection === "identities" || settingsSection === "identity-bindings"
          ? renderIdentityWorkspace({
              props,
              tenantId: props.readModel.currentTenantId,
              baseHref,
              view: settingsSection === "identity-bindings" ? "bindings" : "catalog",
            })
          : nothing
      }
      ${
        settingsSection === "channels"
          ? renderEnterpriseMessageChannelsSurface({
              host: props.client ?? props,
              props: {
                client: props.client ?? null,
                tenantId: props.readModel.currentTenantId ?? null,
                syncBusy: props.channelCredentialsEditor?.syncBusy,
                identityLinkHint: props.channelCredentialsEditor?.identityLinkHint ?? null,
                onSyncOperationalIdentity: (channelId) => {
                  const tenantId = props.readModel.currentTenantId;
                  if (!tenantId) {
                    return;
                  }
                  props.channelCredentialsEditor?.onSelectChannel(channelId);
                  void props.actions.settings.onSyncChannelToOperationalIdentity(
                    tenantId,
                    channelId,
                  );
                },
                onNavigateToIdentities: () => {
                  navigateToPortHref(buildSettingsSectionHref(baseHref, "identities"));
                },
              },
              requestUpdate: () => {
                requestEnterpriseAppRerender();
                void props.actions.settings.onRefresh();
              },
            })
          : nothing
      }
      ${settingsSection === "governance" ? renderGovernanceSection({ props }) : nothing}
      ${settingsSection === "security" ? renderSecuritySection({ props }) : nothing}
      ${
        settingsSection === "access"
          ? html`
              <div class="enterprise-access-layout">
                <div class="enterprise-access-layout__main">
                  ${
                    accessView === "roles"
                      ? html`
                          <section
                            class="enterprise-access-workbench enterprise-access-workbench--split"
                          >
                            <div class="enterprise-access-list">
                              <div class="enterprise-access-section-title">角色列表</div>
                              ${roles.map(
                                (role) => html`
                                  <a
                                    class="enterprise-access-list-row ${selectedRole.key === role.key ? "is-active" : ""}"
                                    href=${appendAccessSearchToHref(
                                      buildSettingsSectionHref(baseHref, "access"),
                                      {
                                        view: "roles",
                                        role: role.key,
                                      },
                                    )}
                                  >
                                    <div>
                                      <strong>${role.label}</strong>
                                      <span>${role.count} 人</span>
                                    </div>
                                    ${
                                      role.key === "admin" && role.count > 0
                                        ? html`
                                            <span class="enterprise-access-tag enterprise-access-tag--danger">高风险</span>
                                          `
                                        : nothing
                                    }
                                  </a>
                                `,
                              )}
                              ${renderCreateRoleControl(props.client)}
                            </div>
                            <div class="enterprise-access-detail">
                              ${
                                permissionEditorInline
                                  ? permissionEditorBody
                                  : html`
                                      <div class="enterprise-access-detail__header">
                                        <div>
                                          <div class="enterprise-access-detail__title">
                                            ${selectedRole.label}
                                          </div>
                                          <div class="enterprise-access-detail__sub">
                                            管理该角色在各模块中的默认权限。
                                          </div>
                                        </div>
                                        <button
                                          class="btn btn--sm btn--primary"
                                          type="button"
                                          @click=${() =>
                                            editor.onOpen({
                                              kind: "role",
                                              targetKey: selectedRole.key,
                                              permissionIds: selectedRole.permissions,
                                            })}
                                        >
                                          编辑权限
                                        </button>
                                      </div>
                                      ${renderAccessPermissionTree(selectedRole.permissions)}
                                    `
                              }
                            </div>
                          </section>
                        `
                      : accessView === "users"
                        ? html`
                            <section
                              class="enterprise-access-workbench enterprise-access-workbench--split"
                            >
                              <div class="enterprise-access-list">
                                <div class="enterprise-access-toolbar">
                                  <label class="field">
                                    <span>搜索成员</span>
                                    <input
                                      .value=${accessSearch}
                                      placeholder="搜索成员 / 邮箱 / 岗位"
                                      @input=${(event: Event) =>
                                        updateAccessSearchParams({
                                          accessSearch: (
                                            event.currentTarget as HTMLInputElement
                                          ).value.trim(),
                                          accessUser: null,
                                        })}
                                    />
                                  </label>
                                </div>
                                ${users.map(
                                  (user) => html`
                                    <a
                                      class="enterprise-access-list-row ${selectedUser?.user === user.user ? "is-active" : ""}"
                                      href=${appendAccessSearchToHref(
                                        buildSettingsSectionHref(baseHref, "access"),
                                        {
                                          view: "users",
                                          user: user.user,
                                          query: accessSearch || null,
                                        },
                                      )}
                                    >
                                      <div>
                                        <strong>${user.displayLabel}</strong>
                                        <span>${user.normalizedRole}</span>
                                      </div>
                                      ${
                                        user.normalizedRole === "admin"
                                          ? html`
                                              <span class="enterprise-access-tag enterprise-access-tag--danger">高权限</span>
                                            `
                                          : html`<span class="enterprise-access-tag"
                                              >${user.status}</span
                                            >`
                                      }
                                    </a>
                                  `,
                                )}
                              </div>
                              <div class="enterprise-access-detail">
                                ${
                                  permissionEditorInline
                                    ? permissionEditorBody
                                    : selectedUser
                                      ? html`
                                          <div class="enterprise-access-detail__header">
                                            <div>
                                              <div class="enterprise-access-detail__title">
                                                ${selectedUser.displayLabel} 的权限
                                              </div>
                                              <div class="enterprise-access-detail__sub">
                                                权限来源透明化，先看来源，再看最终生效结果。
                                              </div>
                                            </div>
                                            <button
                                              class="btn btn--sm btn--primary"
                                              type="button"
                                              @click=${() =>
                                                editor.onOpen({
                                                  kind: "user",
                                                  targetKey: selectedUser.user,
                                                  permissionIds: selectedUser.effectivePermissions,
                                                })}
                                            >
                                              编辑权限
                                            </button>
                                          </div>
                                          <div class="enterprise-access-source-list">
                                            <div class="enterprise-access-source-row">
                                              <span>岗位</span>
                                              <strong
                                                >${selectedUser.seatTitle ? `${selectedUser.seatTitle} → 操作员` : "无"}</strong
                                              >
                                            </div>
                                            <div class="enterprise-access-source-row">
                                              <span>角色</span>
                                              <strong
                                                >${formatEnterpriseRoleLabel(selectedUser.membershipRole === "enterprise-admin" ? "admin" : "viewer")}</strong
                                              >
                                            </div>
                                            <div class="enterprise-access-source-row">
                                              <span>团队</span>
                                              <strong>无单独继承</strong>
                                            </div>
                                            <div class="enterprise-access-source-row">
                                              <span>临时授权</span>
                                              <strong>无</strong>
                                            </div>
                                          </div>
                                          <div class="enterprise-access-effective">
                                            <div class="enterprise-access-section-title">
                                              最终权限
                                            </div>
                                            <div class="enterprise-access-effective__tags">
                                              ${dedupePermissionIds([
                                                selectedUser.normalizedRole,
                                                selectedUser.seatTitle ? "operator" : "",
                                              ])
                                                .filter(Boolean)
                                                .map(
                                                  (label) =>
                                                    html`<span
                                                      class="enterprise-access-tag enterprise-access-tag--info"
                                                      >${formatEnterpriseRoleLabel(label)}</span
                                                    >`,
                                                )}
                                              ${
                                                selectedUser.effectivePermissions.some(
                                                  (permissionId) =>
                                                    ACCESS_PERMISSION_CATALOG.some(
                                                      (entry) =>
                                                        entry.id === permissionId && entry.highRisk,
                                                    ),
                                                )
                                                  ? html`
                                                      <span class="enterprise-access-tag enterprise-access-tag--danger">存在高风险权限</span>
                                                    `
                                                  : html`
                                                      <span class="enterprise-access-tag">无高风险权限</span>
                                                    `
                                              }
                                            </div>
                                          </div>
                                          ${renderAccessPermissionTree(selectedUser.effectivePermissions)}
                                        `
                                      : html`
                                          <div class="enterprise-empty">当前没有匹配的成员。</div>
                                        `
                                }
                              </div>
                            </section>
                          `
                        : html`
                            <section class="enterprise-access-workbench">
                              <div class="enterprise-access-detail__header">
                                <div>
                                  <div class="enterprise-access-detail__title">权限矩阵</div>
                                  <div class="enterprise-access-detail__sub">
                                    全局对照成员与权限，快速识别越权与高风险项。
                                  </div>
                                </div>
                                <div class="enterprise-access-filter-group">
                                  <button
                                    class="enterprise-access-chip ${accessMatrixFilter === "all" ? "is-active" : ""}"
                                    type="button"
                                    @click=${() => updateAccessSearchParams({ accessMatrix: "all" })}
                                  >
                                    全部权限
                                  </button>
                                  <button
                                    class="enterprise-access-chip ${accessMatrixFilter === "risk" ? "is-active" : ""}"
                                    type="button"
                                    @click=${() => updateAccessSearchParams({ accessMatrix: "risk" })}
                                  >
                                    仅高风险
                                  </button>
                                </div>
                              </div>
                              <div class="enterprise-access-matrix">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>权限</th>
                                      ${users.map((user) => html`<th>${user.displayLabel}</th>`)}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${matrixPermissions.map(
                                      (permission) => html`
                                        <tr>
                                          <td>
                                            <strong>${permission.label}</strong>
                                            ${
                                              permission.highRisk
                                                ? html`
                                                    <span class="enterprise-access-tag enterprise-access-tag--danger">高风险</span>
                                                  `
                                                : nothing
                                            }
                                          </td>
                                          ${users.map((user) => {
                                            const granted = user.effectivePermissions.includes(
                                              permission.id,
                                            );
                                            return html`
                                              <td>
                                                <button
                                                  class="enterprise-access-matrix__cell ${granted ? "is-granted" : ""}"
                                                  type="button"
                                                  @click=${() =>
                                                    editor.onOpen({
                                                      kind: "user",
                                                      targetKey: user.user,
                                                      permissionIds: user.effectivePermissions,
                                                    })}
                                                >
                                                  ${granted ? "✓" : "-"}
                                                </button>
                                              </td>
                                            `;
                                          })}
                                        </tr>
                                      `,
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          `
                  }
                </div>
              </div>
            `
          : nothing
      }
      ${/* sidebar removed: "权限风险"/"审计日志"/"快捷处理" merged into header chips and integrated drawers */ nothing}
      ${/* "账号与访问设置" (platform auth panel) removed: 注册 / 登录 / 平台超管 等是平台层入口，不属于企业系统设置 */ nothing}
      ${
        drawerKind && !permissionEditorInline
          ? html`
              <div
                class="enterprise-access-drawer-overlay"
                @click=${(event: MouseEvent) => {
                  if (event.target === event.currentTarget) {
                    editor.onClose();
                  }
                }}
              >
                <section class="enterprise-access-drawer">${permissionEditorBody}</section>
              </div>
            `
          : nothing
      }
      ${
        editor.riskConfirmOpen
          ? html`
              <div class="enterprise-access-modal-overlay">
                <section class="enterprise-access-modal">
                  <div class="enterprise-access-modal__title">高风险权限草稿</div>
                  <div class="enterprise-access-modal__body">
                    ${
                      props.client?.connected
                        ? `确认后把 usage:budget 提交到网关。未接入的权限不会写入。「${drawerLabel}」`
                        : `确认后只把这些高风险项留在「${drawerLabel}」的本地草稿里，不会写入权限。正式提交尚未接入。`
                    }
                    <ul>
                      ${drawerHighRiskItems.map((item) => html`<li>${item.label}</li>`)}
                    </ul>
                  </div>
                  <div class="enterprise-access-modal__footer">
                    <button class="btn" type="button" @click=${editor.onCancelRisk}>取消</button>
                    <button
                      class="btn btn--danger"
                      type="button"
                      title=${
                        props.client?.connected
                          ? "确认后提交 usage:budget。未接入的权限不会写入。"
                          : "只确认本地草稿，不会授予权限。"
                      }
                      @click=${() => {
                        const targetKey = editor.targetKey;
                        if (!props.client?.connected || !drawerKind || !targetKey) {
                          editor.onConfirmRisk({ targetLabel: drawerLabel });
                          return;
                        }
                        editor.onCancelRisk();
                        void submitAccessPermissionCommit({
                          client: props.client,
                          targetKind: drawerKind === "role" ? "role" : "member",
                          targetKey,
                          permissionIds: drawerSelectedIds,
                          confirmedHighRiskPermissionIds: drawerHighRiskItems.map(
                            (item) => item.id,
                          ),
                        });
                      }}
                    >
                      ${props.client?.connected ? "确认授予" : "确认草稿"}
                    </button>
                  </div>
                </section>
              </div>
            `
          : nothing
      }
    </div>
  `;
}
