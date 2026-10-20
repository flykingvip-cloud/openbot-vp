import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import {
  isGatewayAuthIssue,
  resolveGatewayAuthRecoveryHint,
} from "../../../gateway-auth-classification.ts";
import { pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import { formatCost } from "../../../views/usage-metrics.ts";
import {
  displayEnterpriseLastError,
  resolveEnterpriseConnectionView,
} from "../enterprise-connection-copy.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
export type SurfaceBlock = TemplateResult | typeof nothing;
import {
  orgWsBody,
  orgWsFooter,
  orgWsHeader,
  orgWsKvGrid,
  orgWsNotice,
} from "./enterprise-org-workspace-template.ts";
import {
  type OrganizationEditorPresentation,
  wrapOrganizationEditorPresentation,
} from "./enterprise-org-workspace.ts";
import type { SurfaceTone, WorkspaceItemAction } from "./enterprise-surface-types.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

export {
  isGatewayAuthIssue,
  resolveGatewayAuthRecoveryHint,
} from "../../../gateway-auth-classification.ts";

/**
 * 强制让宿主 `<openbot-app>` 元素重渲染。
 *
 * 背景：子页（tab 内部子路由）切换时，顶层 `host.tab` 不变（如 `enterpriseUsage` / 能力中心子页），
 * 因此仅派发 `popstate` 不会引起任何响应式 `@state` 变化 —— Lit 不会重渲染，子页内容停留在原 tab。
 * 这里显式调用宿主的 `requestUpdate()` 兜底，确保子路由切换后视图同步更新。
 * 与 `ports/platform/capabilities/page.ts` 的处理方式保持一致。
 */
export function requestEnterpriseAppRerender(): void {
  if (typeof document === "undefined") {
    return;
  }
  const appHost = document.querySelector("openbot-app") as {
    requestUpdate?: () => unknown;
  } | null;
  appHost?.requestUpdate?.();
}

export function followPortHref(event: MouseEvent, href: string) {
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
  if (typeof window === "undefined") {
    return;
  }
  pushAppHistoryState(href);
  requestEnterpriseAppRerender();
}

function resolveDelegatedPortHref(event: MouseEvent): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const target =
    event.composedPath().find((entry): entry is Element => entry instanceof Element) ??
    (event.target instanceof Element ? event.target : null);
  const anchor = target?.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) {
    return null;
  }
  const rawHref = anchor.getAttribute("href")?.trim();
  if (!rawHref || rawHref.startsWith("#")) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawHref, window.location.href);
  } catch {
    return null;
  }
  if (
    parsed.origin !== window.location.origin ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    return null;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function followDelegatedPortHref(event: MouseEvent) {
  const href = resolveDelegatedPortHref(event);
  if (!href) {
    return;
  }
  followPortHref(event, href);
}

/** Org-directory query flag set by 系统设置 →「邀请管理员」(pick an employee to invite). */
export const ENTERPRISE_ADMIN_INVITE_PICK_PARAM = "organizationAdminInvite";

/**
 * 「邀请管理员」entry: jump into the enterprise employee directory (member view)
 * ready to pick an existing employee and send an admin invite email.
 */
export function buildEnterpriseAdminInviteDirectoryHref(
  basePath: string,
  tenantId: string | null | undefined,
): string {
  const path = pathForTab("enterpriseOrganization", basePath, { tenantId: tenantId ?? null });
  const params = new URLSearchParams();
  params.set("organizationView", "member");
  params.set(ENTERPRISE_ADMIN_INVITE_PICK_PARAM, "1");
  return `${path}?${params.toString()}`;
}

export function shouldProceed(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm(message);
}

export function renderEnterprisePage(params: {
  tone: SurfaceTone;
  notices: SurfaceBlock[];
  header: SurfaceBlock;
  primary: SurfaceBlock[];
  secondary?: SurfaceBlock[];
  full?: SurfaceBlock[];
}) {
  const hasSecondary = Boolean(params.secondary?.length);
  return html`
    <div
      class="enterprise-surface enterprise-surface--${params.tone}"
      @click=${followDelegatedPortHref}
    >
      ${params.notices} ${params.header}
      <section class="enterprise-console card">
        <div
          class="enterprise-console__body ${hasSecondary ? "" : "enterprise-console__body--single"}"
        >
          <div class="enterprise-surface__main">${params.primary}</div>
          ${
            hasSecondary
              ? html`<div class="enterprise-surface__side">${params.secondary}</div>`
              : nothing
          }
        </div>
      </section>
      ${
        params.full?.length
          ? html`<div class="enterprise-surface__full">${params.full}</div>`
          : nothing
      }
    </div>
  `;
}

export function renderMeshBadge(
  label: string,
  tone: "neutral" | "ok" | "warn" | "danger" = "neutral",
) {
  return html`<span class="enterprise-mesh-badge enterprise-mesh-badge--${tone}">${label}</span>`;
}

export function renderEnterpriseSeatLimitNotice(params: {
  authPanelProps: {
    state?: {
      sessionKind?: string;
      enterprise?: {
        status: string;
        seatUsed: number;
        seatQuota: number;
        upgradeUrl?: string;
        contactAdvisorUrl?: string;
      } | null;
    } | null;
  } | null;
}) {
  const authPanelProps = params.authPanelProps;
  const enterprise = authPanelProps?.state?.enterprise;
  if (
    !authPanelProps ||
    authPanelProps.state?.sessionKind !== "enterprise-admin" ||
    !enterprise ||
    enterprise.status !== "trial" ||
    enterprise.seatUsed < enterprise.seatQuota
  ) {
    return nothing;
  }
  return html`
    <div class="callout warning" style="margin-top: 16px;">
      <div><strong>${t("enterprisePort.trial.seatLimitTitle")}</strong></div>
      <div style="margin-top: 6px;">${t("enterprisePort.trial.seatLimitSubtitle")}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 16px;">
        ${
          enterprise.upgradeUrl
            ? html`
                <a
                  class="btn btn--primary"
                  href=${enterprise.upgradeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${t("overview.platformAuth.enterprise.upgrade")}
                </a>
              `
            : nothing
        }
        ${
          enterprise.contactAdvisorUrl
            ? html`
                <a
                  class="btn"
                  href=${enterprise.contactAdvisorUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${t("overview.platformAuth.enterprise.contactAdvisor")}
                </a>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function enterpriseConnectionView(readModel: EnterprisePortReadModel) {
  return resolveEnterpriseConnectionView({
    connected: readModel.connected,
    connectionPhase: readModel.connectionPhase,
    lastError: readModel.lastError,
    payloadReady: readModel.enterprisePayloadReady,
    authIssue: isGatewayAuthIssue(readModel.lastError),
  });
}

export function renderEnterpriseDataNotice(readModel: EnterprisePortReadModel) {
  const view = enterpriseConnectionView(readModel);
  if (!view.showBanner) {
    return nothing;
  }
  const gatewayAuthIssue = isGatewayAuthIssue(readModel.lastError);
  const recoveryHint = resolveGatewayAuthRecoveryHint({
    authMode: readModel.bootstrapAuthMode,
    hasPlatformSession: Boolean(readModel.authenticatedUser),
  });
  const detail = displayEnterpriseLastError({
    connected: readModel.connected,
    connectionPhase: readModel.connectionPhase,
    lastError: readModel.lastError,
    payloadReady: readModel.enterprisePayloadReady,
    authIssue: gatewayAuthIssue,
  });
  return html`
    <div class="callout warning" style="margin-top: 16px;">
      <strong>企业数据未连接。</strong>
      ${gatewayAuthIssue ? recoveryHint : view.bannerBody}
      ${detail && !gatewayAuthIssue ? html`<div style="margin-top: 6px;">${detail}</div>` : nothing}
    </div>
  `;
}

export function renderEnterpriseAuthRequiredSurface(params: {
  basePath: string;
  readModel: EnterprisePortReadModel;
  authPanelProps: {
    state?: {
      enabled?: boolean;
      sessionKind?: string;
      membershipRole?: string | null;
      tenantName?: string;
      enterprise?: { id?: string } | null;
      session?: { tenantId?: string } | null;
    } | null;
  } | null;
  onSwitchToEnterpriseAdmin?: (tenantId: string) => void;
}) {
  const state = params.authPanelProps?.state;
  const tenantId = params.readModel.currentTenantId?.trim() ?? "";
  if (!tenantId || !state?.enabled || state.sessionKind === "enterprise-admin") {
    return null;
  }
  const tenantLabel =
    params.readModel.currentTenantLabel?.trim() || state.tenantName?.trim() || tenantId;
  const boundTenantId = state.enterprise?.id?.trim() || state.session?.tenantId?.trim() || tenantId;
  // Offer one-click switch only when the account is eligible to assume
  // enterprise-admin (platform session on the matching tenant, or a dual-identity
  // member whose highest membershipRole is already enterprise-admin). Pure
  // employees are rejected at the enterprise login entry — do not send them
  // through "企业登录" or frame "返回员工首页" as the recommended path.
  const canAssumeEnterpriseAdmin =
    boundTenantId === tenantId &&
    (state.sessionKind === "platform-admin" ||
      state.sessionKind === "platform-super-admin" ||
      (state.sessionKind === "member" && state.membershipRole === "enterprise-admin"));
  const title = !state.sessionKind
    ? "请先登录企业账户"
    : canAssumeEnterpriseAdmin
      ? "需要切换到企业管理员身份"
      : "没有企业管理员资格";
  const description = !state.sessionKind
    ? `当前页面需要企业管理员会话，才能加载 ${tenantLabel} 的组织、岗位和待确认数据。`
    : canAssumeEnterpriseAdmin &&
        (state.sessionKind === "platform-admin" || state.sessionKind === "platform-super-admin")
      ? `当前以平台管理员身份登录。同一邮箱也是 ${tenantLabel} 的企业管理员，切换到企业管理员身份后即可管理组织与岗位。`
      : canAssumeEnterpriseAdmin
        ? `当前以员工通道登录。同一邮箱也是 ${tenantLabel} 的企业管理员，切换后即可管理组织与岗位。`
        : `你没有企业管理员资格，请从员工端登录。企业登录入口只接受企业管理员账号。`;
  const employeeEntryHref = pathForTab("me", params.basePath);
  return html`
    <section class="enterprise-card enterprise-card--compact enterprise-gate-card">
      <div class="enterprise-section__title">${title}</div>
      <p class="enterprise-section__description">${description}</p>
      <div class="enterprise-gate-card__actions">
        ${
          canAssumeEnterpriseAdmin && params.onSwitchToEnterpriseAdmin
            ? html`
                <button
                  type="button"
                  class="btn btn--primary"
                  @click=${() => params.onSwitchToEnterpriseAdmin?.(tenantId)}
                >
                  以企业管理员身份继续
                </button>
              `
            : !state.sessionKind
              ? html`
                  <a class="btn btn--primary" href=${pathForTab("enterpriseLogin", params.basePath)}>
                    企业登录
                  </a>
                `
              : html`
                  <a class="btn btn--primary" href=${employeeEntryHref}>从员工端登录</a>
                `
        }
        ${
          canAssumeEnterpriseAdmin || !state.sessionKind
            ? html`<a class="btn" href=${employeeEntryHref}>从员工端登录</a>`
            : nothing
        }
      </div>
    </section>
  `;
}

export function renderEnterpriseTrialActions(params: {
  upgradeUrl?: string;
  contactAdvisorUrl?: string;
}) {
  if (!params.upgradeUrl && !params.contactAdvisorUrl) {
    return nothing;
  }
  return html`
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 16px;">
      ${
        params.upgradeUrl
          ? html`
              <a
                class="btn btn--primary"
                href=${params.upgradeUrl}
                target="_blank"
                rel="noreferrer"
              >
                ${t("overview.platformAuth.enterprise.upgrade")}
              </a>
            `
          : nothing
      }
      ${
        params.contactAdvisorUrl
          ? html`
              <a class="btn" href=${params.contactAdvisorUrl} target="_blank" rel="noreferrer">
                ${t("overview.platformAuth.enterprise.contactAdvisor")}
              </a>
            `
          : nothing
      }
    </div>
  `;
}

export function renderEnterpriseTrialExpiredSurface(props: {
  authPanelProps: {
    state?: {
      sessionKind?: string;
      enterprise?: {
        name: string;
        status: string;
        seatUsed: number;
        seatQuota: number;
        trialEndsAt?: string | null;
        upgradeUrl?: string;
        contactAdvisorUrl?: string;
      } | null;
      membershipRole?: string | null;
    } | null;
  } | null;
}) {
  const authPanelProps = props.authPanelProps;
  const enterprise = authPanelProps?.state?.enterprise;
  if (
    !authPanelProps ||
    authPanelProps.state?.sessionKind !== "enterprise-admin" ||
    !enterprise ||
    enterprise.status !== "expired"
  ) {
    return null;
  }
  const authPanel = html`
    <section class="card">
      <div class="card-title">${t("enterprisePort.trial.expiredTitle")}</div>
      <div class="card-sub">${t("enterprisePort.trial.expiredSubtitle")}</div>
      <div class="grid grid-cols-3" style="margin-top: 16px;">
        <div class="stat">
          <div class="stat-label">${t("enterprisePort.stats.tenant")}</div>
          <div class="stat-value">${enterprise.name}</div>
        </div>
        <div class="stat">
          <div class="stat-label">
            ${t("enterprisePort.trial.seatQuota", {
              used: String(enterprise.seatUsed),
              quota: String(enterprise.seatQuota),
            })}
          </div>
          <div class="stat-value warn">${enterprise.status}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${t("enterprisePort.stats.role")}</div>
          <div class="stat-value">${authPanelProps.state?.membershipRole ?? t("common.na")}</div>
        </div>
      </div>
      <div class="list" style="margin-top: 16px;">
        <div class="list-item">
          <div class="list-main">
            <div class="list-sub">
              ${
                enterprise.trialEndsAt
                  ? t("enterprisePort.trial.endedAt", { time: enterprise.trialEndsAt })
                  : t("enterprisePort.trial.expiredSubtitle")
              }
            </div>
          </div>
        </div>
        <div class="list-item">
          <div class="list-main">
            <div class="list-sub">${t("enterprisePort.trial.expiredReadOnly")}</div>
          </div>
        </div>
      </div>
      ${renderEnterpriseTrialActions({
        upgradeUrl: enterprise.upgradeUrl,
        contactAdvisorUrl: enterprise.contactAdvisorUrl,
      })}
    </section>
  `;
  return html`
    ${authPanel}
    ${
      authPanelProps.state?.enterprise
        ? html`
            <div style="margin-top: 16px"></div>
          `
        : nothing
    }
  `;
}

/**
 * Compact read-only banner for the `read_only` trial-expiry handling: unlike the
 * full-screen hard-stop card, this sits above the normal (view-only) workspace
 * so an admin can still inspect data after expiry. Returns `nothing` unless the
 * enterprise-admin session is on an expired tenant with read-only access allowed.
 */
export function renderEnterpriseTrialReadOnlyBanner(props: {
  authPanelProps: {
    state?: {
      sessionKind?: string;
      enterprise?: {
        name: string;
        status: string;
        trialEndsAt?: string | null;
        allowReadOnlyAfterExpiry?: boolean;
        upgradeUrl?: string;
        contactAdvisorUrl?: string;
      } | null;
    } | null;
  } | null;
}) {
  const authPanelProps = props.authPanelProps;
  const enterprise = authPanelProps?.state?.enterprise;
  if (
    !authPanelProps ||
    authPanelProps.state?.sessionKind !== "enterprise-admin" ||
    !enterprise ||
    enterprise.status !== "expired" ||
    enterprise.allowReadOnlyAfterExpiry !== true
  ) {
    return nothing;
  }
  return html`
    <section class="card enterprise-trial-readonly-banner" style="margin-bottom: 16px;">
      <div class="card-title">${t("enterprisePort.trial.readOnlyBannerTitle")}</div>
      <div class="card-sub">
        ${
          enterprise.trialEndsAt
            ? t("enterprisePort.trial.endedAt", { time: enterprise.trialEndsAt })
            : t("enterprisePort.trial.readOnlyBannerSubtitle")
        }
      </div>
      <div class="list-sub" style="margin-top: 8px;">
        ${t("enterprisePort.trial.readOnlyBannerSubtitle")}
      </div>
      ${renderEnterpriseTrialActions({
        upgradeUrl: enterprise.upgradeUrl,
        contactAdvisorUrl: enterprise.contactAdvisorUrl,
      })}
    </section>
  `;
}

export function renderOrganizationConnectionHint(readModel: EnterprisePortReadModel) {
  const view = enterpriseConnectionView(readModel);
  if (!view.showBanner) {
    return nothing;
  }
  const gatewayAuthIssue = isGatewayAuthIssue(readModel.lastError);
  const recoveryHint = resolveGatewayAuthRecoveryHint({
    authMode: readModel.bootstrapAuthMode,
    hasPlatformSession: Boolean(readModel.authenticatedUser),
  });
  const detail = displayEnterpriseLastError({
    connected: readModel.connected,
    connectionPhase: readModel.connectionPhase,
    lastError: readModel.lastError,
    payloadReady: readModel.enterprisePayloadReady,
    authIssue: gatewayAuthIssue,
  });
  return html`
    <div class="enterprise-org-inline-notice" role="status">
      <strong>企业数据未连接</strong>
      <span>${gatewayAuthIssue ? recoveryHint : view.bannerBody}</span>
      ${detail && !gatewayAuthIssue ? html`<span>${detail}</span>` : nothing}
    </div>
  `;
}

export function renderOwnershipTransferEditor(
  props: EnterpriseSurfaceProps,
  options?: { presentation?: OrganizationEditorPresentation },
) {
  const editor = props.ownershipTransferEditor;
  if (!editor || !editor.open) {
    return nothing;
  }
  const presentation = options?.presentation ?? "modal";
  const selectedMember =
    editor.candidateMembers.find((entry) => entry.user === editor.selectedUserId) ?? null;
  const assetLabel = editor.subjectKind === "group" ? "协作小组" : "机器人";
  if (presentation === "workspace") {
    // 组织结构操作区内就地呈现（组织树保持可见）；模态仅供协作治理等其他模块复用。
    return wrapOrganizationEditorPresentation({
      presentation,
      ariaLabel: "归属转移",
      panelClass: "enterprise-org-workspace--panel enterprise-org-ws--flat",
      onClose: editor.onClose,
      content: html`
        ${orgWsHeader({
          title: "归属转移",
          subtitle: `${assetLabel} · ${editor.subjectLabel}`,
          onClose: editor.onClose,
        })}
        ${orgWsBody(html`
          ${orgWsKvGrid([
            { label: "当前岗位", value: editor.positionLabel },
            { label: "当前负责人", value: editor.currentManagerLabel },
            { label: "对象类型", value: assetLabel },
          ])}
          ${editor.error ? orgWsNotice({ kind: "danger", content: editor.error }) : nothing}
          ${
            editor.notice
              ? orgWsNotice({ kind: "ok", content: html`<strong>${editor.notice}</strong>` })
              : nothing
          }
          <label class="field">
            <span>选择新的归属负责人</span>
            <select
              .value=${editor.selectedUserId}
              ?disabled=${editor.busy}
              @change=${(event: Event) =>
                editor.onSelectedUserChange((event.target as HTMLSelectElement).value)}
            >
              <option value="">请选择成员</option>
              ${editor.candidateMembers.map(
                (entry) => html`
                  <option value=${entry.user}>
                    ${entry.displayLabel}${entry.seatTitle ? ` · ${entry.seatTitle}` : ""}
                  </option>
                `,
              )}
            </select>
          </label>
          ${
            selectedMember
              ? html`
                  <div class="enterprise-org-ws__notice">
                    <span>目标确认</span>
                    <strong>${selectedMember.displayLabel}</strong>
                    <small>
                      ${selectedMember.seatTitle ?? "未绑定岗位"} ·
                      ${selectedMember.seatStatus ?? "待复核"}
                    </small>
                  </div>
                `
              : nothing
          }
        `)}
        ${orgWsFooter({
          onCancel: editor.onClose,
          primaryLabel: "确认转移",
          onPrimary: () => editor.onSubmit(),
          primaryDisabled: !editor.selectedUserId,
          busy: editor.busy,
        })}
      `,
    });
  }
  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) {
          editor.onClose();
        }
      }}
    >
      <section class="enterprise-org-modal" role="dialog" aria-modal="true" aria-label="归属转移">
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">归属转移</div>
            <div class="enterprise-org-modal__sub">${assetLabel} · ${editor.subjectLabel}</div>
          </div>
          <button class="btn btn--sm" type="button" @click=${editor.onClose}>关闭</button>
        </div>
        <div class="enterprise-org-modal__body">
          <div class="enterprise-org-modal__stats">
            <div class="stat">
              <div class="stat-label">当前岗位</div>
              <div class="stat-value">${editor.positionLabel}</div>
            </div>
            <div class="stat">
              <div class="stat-label">当前负责人</div>
              <div class="stat-value">${editor.currentManagerLabel}</div>
            </div>
            <div class="stat">
              <div class="stat-label">对象类型</div>
              <div class="stat-value">${assetLabel}</div>
            </div>
          </div>
          ${
            editor.error
              ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--danger">
                  ${editor.error}
                </div>`
              : nothing
          }
          ${
            editor.notice
              ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">
                  <span>流程更新</span>
                  <strong>${editor.notice}</strong>
                </div>`
              : nothing
          }
          <label class="field" style="grid-column: 1 / -1;">
            <span>选择新的归属负责人</span>
            <select
              .value=${editor.selectedUserId}
              ?disabled=${editor.busy}
              @change=${(event: Event) =>
                editor.onSelectedUserChange((event.target as HTMLSelectElement).value)}
            >
              <option value="">请选择成员</option>
              ${editor.candidateMembers.map(
                (entry) => html`
                  <option value=${entry.user}>
                    ${entry.displayLabel}${entry.seatTitle ? ` · ${entry.seatTitle}` : ""}
                  </option>
                `,
              )}
            </select>
          </label>
          ${
            selectedMember
              ? html`
                  <div class="enterprise-org-modal__notice">
                    <span>目标确认</span>
                    <strong>${selectedMember.displayLabel}</strong>
                    <small>
                      ${selectedMember.seatTitle ?? "未绑定岗位"} ·
                      ${selectedMember.seatStatus ?? "待复核"}
                    </small>
                  </div>
                `
              : nothing
          }
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" @click=${editor.onClose}>取消</button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${editor.busy || !editor.selectedUserId}
            @click=${editor.onSubmit}
          >
            ${editor.busy ? "转移中..." : "确认转移"}
          </button>
        </div>
      </section>
    </div>
  `;
}

export function renderMeshActionCards(
  cards: Array<{
    title: string;
    subtitle: string;
    href: string;
    tone?: "primary";
  }>,
) {
  return html`
    <div class="enterprise-mesh-action-cards">
      ${cards.map(
        (card) => html`
          <a
            class="enterprise-mesh-action-card ${card.tone === "primary" ? "is-primary" : ""}"
            href=${card.href}
          >
            <strong>${card.title}</strong>
            <span>${card.subtitle}</span>
          </a>
        `,
      )}
    </div>
  `;
}

export function renderWorkspacePanel(params: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => unknown;
  variant?: "primary" | "secondary" | "critical" | "quiet";
  items: Array<{
    title: string;
    subtitle?: string;
    meta?: string;
    href?: string;
    active?: boolean;
    actions?: WorkspaceItemAction[];
  }>;
  empty: string;
}) {
  return html`
    <section class="enterprise-panel enterprise-panel--${params.variant ?? "primary"}">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">${params.title}</div>
          <div class="enterprise-panel__subtitle">${params.subtitle}</div>
        </div>
        <button class="btn btn--sm" @click=${params.onAction}>${params.actionLabel}</button>
      </div>
      <div class="enterprise-panel__list list">
        ${
          params.items.length === 0
            ? html`<div class="enterprise-empty">${params.empty}</div>`
            : params.items.map((item) =>
                item.href
                  ? html`
                      <a
                        class="list-item list-item-route ${item.active ? "is-active" : ""}"
                        href=${item.href}
                        @click=${(event: MouseEvent) => followPortHref(event, item.href!)}
                        data-active=${item.active ? "true" : "false"}
                        style=${
                          item.active
                            ? "border-color: color-mix(in srgb, var(--accent-500, #2563eb) 45%, white); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-500, #2563eb) 35%, white); background: color-mix(in srgb, var(--accent-500, #2563eb) 6%, white);"
                            : nothing
                        }
                      >
                        <div class="list-main">
                          <div class="list-title">${item.title}</div>
                          ${item.subtitle ? html`<div class="list-sub">${item.subtitle}</div>` : nothing}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                          ${
                            item.active
                              ? html`
                                  <span class="list-sub" style="font-weight: 600">当前查看</span>
                                `
                              : nothing
                          }
                          ${
                            item.actions?.length
                              ? html`
                                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    ${item.actions.map(
                                      (action) => html`
                                        <button
                                          class="btn btn--sm ${
                                            action.tone === "primary"
                                              ? "btn--primary"
                                              : action.tone === "danger"
                                                ? "btn--danger"
                                                : ""
                                          }"
                                          type="button"
                                          @click=${(event: MouseEvent) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            action.onAction();
                                          }}
                                        >
                                          ${action.label}
                                        </button>
                                      `,
                                    )}
                                  </div>
                                `
                              : nothing
                          }
                          ${item.meta ? html`<div class="list-meta">${item.meta}</div>` : nothing}
                        </div>
                      </a>
                    `
                  : html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${item.title}</div>
                          ${item.subtitle ? html`<div class="list-sub">${item.subtitle}</div>` : nothing}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                          ${
                            item.actions?.length
                              ? html`
                                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    ${item.actions.map(
                                      (action) => html`
                                        <button
                                          class="btn btn--sm ${
                                            action.tone === "primary"
                                              ? "btn--primary"
                                              : action.tone === "danger"
                                                ? "btn--danger"
                                                : ""
                                          }"
                                          type="button"
                                          @click=${action.onAction}
                                        >
                                          ${action.label}
                                        </button>
                                      `,
                                    )}
                                  </div>
                                `
                              : nothing
                          }
                          ${item.meta ? html`<div class="list-meta">${item.meta}</div>` : nothing}
                        </div>
                      </div>
                    `,
              )
        }
      </div>
    </section>
  `;
}

export function formatOptionalCost(value: number | null | undefined) {
  return formatCost(value ?? 0);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value * 100)}%`;
}

export function renderMeshCompactHeader(params: {
  title: string;
  agentCount: number;
  groupCount: number;
  totalCost: number;
  onRefresh: () => void;
}) {
  return renderEnterpriseModuleHeader({
    title: params.title,
    trailing: html`
      <div class="enterprise-module-header__metrics">
        <span class="enterprise-metric enterprise-metric--neutral">
          <span class="enterprise-metric__label">机器人</span>
          <strong>${params.agentCount}</strong>
        </span>
        <span class="enterprise-metric enterprise-metric--neutral">
          <span class="enterprise-metric__label">协作小组</span>
          <strong>${params.groupCount}</strong>
        </span>
        <span
          class="enterprise-metric enterprise-metric--${params.totalCost > 0 ? "warn" : "neutral"}"
        >
          <span class="enterprise-metric__label">本月成本</span>
          <strong>${formatCost(params.totalCost)}</strong>
        </span>
      </div>
      <button
        class="enterprise-btn enterprise-btn--secondary enterprise-module-header__refresh"
        type="button"
        @click=${() => params.onRefresh()}
      >
        刷新
      </button>
    `,
  });
}
