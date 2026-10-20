import { html, nothing } from "lit";
import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import type { PlatformAuthPanelProps } from "../../../../views/platform-auth-panel.ts";
import type { PlatformPortTenantsActions } from "../../view-types.ts";
import { renderPlatformAuthFeedback } from "./TenantTrialExtensionSection.ts";

export type TenantAdminContactDialogState = {
  enterpriseId: string;
  tenantName: string;
  contactName?: string;
  contactEmail?: string;
  adminActivationStatus?: "pending_activation" | "activated" | "missing";
};

let adminDialog: TenantAdminContactDialogState | null = null;
let draftName = "";
let draftEmail = "";
let resendOnSave = true;
let adminSubmitting = false;

function requestRerender() {
  requestOpenBotAppRerender();
}

export function isTenantAdminContactDialogOpen() {
  return adminDialog != null;
}

export function openTenantAdminContactDialog(state: TenantAdminContactDialogState) {
  adminDialog = state;
  draftName = state.contactName?.trim() ?? "";
  draftEmail = state.contactEmail?.trim() ?? "";
  resendOnSave = state.adminActivationStatus !== "activated";
  adminSubmitting = false;
  requestRerender();
}

export function closeTenantAdminContactDialog() {
  if (adminSubmitting) {
    return;
  }
  adminDialog = null;
  adminSubmitting = false;
  requestRerender();
}

/** @internal vitest reset */
export function __resetTenantAdminContactForTest() {
  adminDialog = null;
  draftName = "";
  draftEmail = "";
  resendOnSave = true;
  adminSubmitting = false;
}

export function renderTenantAdminContactDialog(params: {
  authPanelProps?: PlatformAuthPanelProps | null;
  actions?: PlatformPortTenantsActions | null;
}) {
  if (!adminDialog) {
    return nothing;
  }
  const auth = params.authPanelProps;
  const busy = adminSubmitting;
  const canManage = Boolean(auth?.state?.canManagePlatform);
  const canSubmit =
    canManage &&
    Boolean(params.actions?.onUpdateEnterpriseAdmin) &&
    draftName.trim().length > 0 &&
    draftEmail.trim().includes("@");
  const dialog = adminDialog;
  const isPendingOrMissing = dialog.adminActivationStatus !== "activated";
  const canResend =
    canManage &&
    Boolean(params.actions?.onResendEnterpriseAdminActivation) &&
    dialog.adminActivationStatus === "pending_activation" &&
    Boolean(dialog.contactEmail);

  const confirm = () => {
    if (!canSubmit || busy) {
      return;
    }
    adminSubmitting = true;
    requestRerender();
    void params.actions
      ?.onUpdateEnterpriseAdmin({
        enterpriseId: dialog.enterpriseId,
        adminName: draftName.trim(),
        adminEmail: draftEmail.trim(),
        resendActivation: isPendingOrMissing ? resendOnSave : false,
      })
      .then((ok) => {
        adminSubmitting = false;
        if (ok) {
          adminDialog = null;
          requestRerender();
        } else {
          requestRerender();
        }
      })
      .catch(() => {
        adminSubmitting = false;
        requestRerender();
      });
  };

  const resendOnly = () => {
    if (!canResend || busy) {
      return;
    }
    adminSubmitting = true;
    requestRerender();
    void params.actions
      ?.onResendEnterpriseAdminActivation({ enterpriseId: dialog.enterpriseId })
      .then((ok) => {
        adminSubmitting = false;
        if (ok) {
          adminDialog = null;
        }
        requestRerender();
      })
      .catch(() => {
        adminSubmitting = false;
        requestRerender();
      });
  };

  const statusLabel =
    dialog.adminActivationStatus === "activated"
      ? "已激活"
      : dialog.adminActivationStatus === "pending_activation"
        ? "待激活"
        : "未配置";

  return html`
    <div
      class="platform-tenants__extend-dialog-root"
      role="presentation"
      data-testid="tenant-admin-contact-dialog"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !busy) {
          closeTenantAdminContactDialog();
        }
      }}
    >
      <div
        class="platform-tenants__extend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-tenants-admin-title"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            closeTenantAdminContactDialog();
          }
        }}
      >
        <header class="platform-tenants__extend-dialog-head">
          <div>
            <h3 id="platform-tenants-admin-title">
              ${dialog.adminActivationStatus === "missing" ? "添加管理员" : "编辑管理员"}
            </h3>
            <p class="muted">为「${dialog.tenantName}」维护企业管理员联系人。</p>
          </div>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantAdminContactDialog()}
          >
            关闭
          </button>
        </header>

        <div class="platform-tenants__extend-dialog-meta">
          当前状态：<strong>${statusLabel}</strong>
          ${
            dialog.contactEmail
              ? html` ·
                ${dialog.contactName ? `${dialog.contactName} · ` : ""}${dialog.contactEmail}`
              : nothing
          }
        </div>

        ${
          !canManage
            ? html`
                <div class="callout danger">需要平台管理员权限才能修改管理员信息。</div>
              `
            : nothing
        }
        ${renderPlatformAuthFeedback({
          error: auth?.error,
          notice: busy ? null : auth?.notice,
          busy,
        })}

        <label class="field">
          <span>管理员姓名</span>
          <input
            type="text"
            .value=${draftName}
            ?disabled=${busy || !canManage}
            data-testid="tenant-admin-name-input"
            @input=${(event: Event) => {
              draftName = (event.target as HTMLInputElement).value;
              requestRerender();
            }}
          />
        </label>
        <label class="field">
          <span>管理员邮箱</span>
          <input
            type="email"
            .value=${draftEmail}
            ?disabled=${busy || !canManage}
            data-testid="tenant-admin-email-input"
            @input=${(event: Event) => {
              draftEmail = (event.target as HTMLInputElement).value;
              requestRerender();
            }}
          />
        </label>

        ${
          isPendingOrMissing
            ? html`
                <label class="row row--tight">
                  <input
                    type="checkbox"
                    .checked=${resendOnSave}
                    ?disabled=${busy || !canManage}
                    @change=${(event: Event) => {
                      resendOnSave = (event.target as HTMLInputElement).checked;
                      requestRerender();
                    }}
                  />
                  <span>保存后发送 / 重发激活邮件</span>
                </label>
              `
            : html`
                <div class="muted">已激活管理员仅更新姓名与邮箱，不会再次发送激活邮件。</div>
              `
        }

        <footer class="platform-tenants__extend-dialog-footer">
          ${
            canResend
              ? html`
                  <button
                    class="btn"
                    type="button"
                    data-testid="tenant-admin-resend"
                    ?disabled=${busy}
                    @click=${resendOnly}
                  >
                    ${busy ? "处理中…" : "仅重发激活"}
                  </button>
                `
              : nothing
          }
          <button
            class="btn"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantAdminContactDialog()}
          >
            取消
          </button>
          <button
            class="btn btn--primary"
            type="button"
            data-testid="tenant-admin-save"
            ?disabled=${busy || !canSubmit}
            @click=${confirm}
          >
            ${busy ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  `;
}
