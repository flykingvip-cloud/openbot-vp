import { html, nothing } from "lit";
import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import type { PlatformAuthPanelProps } from "../../../../views/platform-auth-panel.ts";
import type { PlatformPortTenantsActions } from "../../view-types.ts";
import { formatTrialApplicationDateTime } from "./TenantTrialApplicationsSection.ts";

export type TrialExtendPreset = 1 | 2 | 4;

export type TenantTrialExtendDialogState = {
  enterpriseId: string;
  tenantName: string;
  trialEndsLabel?: string;
  seatQuota?: number;
};

let extendDialog: TenantTrialExtendDialogState | null = null;
let selectedWeeks: TrialExtendPreset = 2;
/** Dialog-local submitting flag — never borrow global platformAuthBusy. */
let extendSubmitting = false;

function requestRerender() {
  requestOpenBotAppRerender();
}

export function isTenantTrialExtendDialogOpen() {
  return extendDialog != null;
}

export function openTenantTrialExtendDialog(state: TenantTrialExtendDialogState) {
  extendDialog = state;
  selectedWeeks = 2;
  extendSubmitting = false;
  requestRerender();
}

export function closeTenantTrialExtendDialog() {
  if (extendSubmitting) {
    return;
  }
  extendDialog = null;
  extendSubmitting = false;
  requestRerender();
}

/** @internal vitest reset */
export function __resetTenantTrialExtendForTest() {
  extendDialog = null;
  selectedWeeks = 2;
  extendSubmitting = false;
}

export function renderPlatformAuthFeedback(params: {
  error?: string | null;
  notice?: string | null;
  busy?: boolean;
}) {
  if (!params.error && !params.notice && !params.busy) {
    return nothing;
  }
  return html`
    <div class="platform-tenants__auth-feedback" role="status">
      ${
        params.busy
          ? html`
              <div class="muted">正在处理…</div>
            `
          : nothing
      }
      ${params.error ? html`<div class="callout danger">${params.error}</div>` : nothing}
      ${
        params.notice && !params.error
          ? html`<div class="callout success">${params.notice}</div>`
          : nothing
      }
    </div>
  `;
}

function previewEndsAt(weeks: TrialExtendPreset): string {
  const ends = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);
  return formatTrialApplicationDateTime(ends.toISOString());
}

const PRESETS: Array<{ weeks: TrialExtendPreset; label: string; hint: string }> = [
  { weeks: 1, label: "1 周", hint: "7 天" },
  { weeks: 2, label: "2 周", hint: "14 天" },
  { weeks: 4, label: "4 周", hint: "28 天" },
];

/** 延长试用轻量确认弹层：选择 1/2/4 周后确认更新到期时间。 */
export function renderTenantTrialExtendDialog(params: {
  authPanelProps?: PlatformAuthPanelProps | null;
  actions?: PlatformPortTenantsActions | null;
}) {
  if (!extendDialog) {
    return nothing;
  }
  const auth = params.authPanelProps;
  const busy = extendSubmitting;
  const canManage = Boolean(auth?.state?.canManagePlatform);
  const canSubmit = canManage && Boolean(params.actions?.onUpdateTrialInstance);
  const dialog = extendDialog;

  const confirm = () => {
    if (!canSubmit || busy) {
      return;
    }
    extendSubmitting = true;
    requestRerender();
    void params.actions
      ?.onUpdateTrialInstance({
        enterpriseId: dialog.enterpriseId,
        trialDays: selectedWeeks * 7,
        ...(dialog.seatQuota && dialog.seatQuota > 0 ? { seatCount: dialog.seatQuota } : {}),
      })
      .then((ok) => {
        extendSubmitting = false;
        if (ok) {
          extendDialog = null;
          requestRerender();
        } else {
          requestRerender();
        }
      })
      .catch(() => {
        extendSubmitting = false;
        requestRerender();
      });
  };

  return html`
    <div
      class="platform-tenants__extend-dialog-root"
      role="presentation"
      data-testid="tenant-extend-dialog"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !busy) {
          closeTenantTrialExtendDialog();
        }
      }}
    >
      <div
        class="platform-tenants__extend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-tenants-extend-title"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            closeTenantTrialExtendDialog();
          }
        }}
      >
        <header class="platform-tenants__extend-dialog-head">
          <div>
            <h3 id="platform-tenants-extend-title">延长试用</h3>
            <p class="muted">为「${dialog.tenantName}」选择延期时长，确认后立即生效。</p>
          </div>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantTrialExtendDialog()}
          >
            关闭
          </button>
        </header>

        ${
          dialog.trialEndsLabel
            ? html`<div class="platform-tenants__extend-dialog-meta">
                当前截止：<strong>${dialog.trialEndsLabel}</strong>
              </div>`
            : nothing
        }

        ${
          !canSubmit
            ? html`
                <div class="callout danger">需要平台管理员权限才能延长试用。</div>
              `
            : nothing
        }

        ${renderPlatformAuthFeedback({
          error: auth?.error,
          notice: busy ? null : auth?.notice,
          busy,
        })}

        <div class="platform-tenants__extend-presets" role="radiogroup" aria-label="延期时长">
          ${PRESETS.map(
            (preset) => html`
              <button
                type="button"
                class="platform-tenants__extend-preset ${selectedWeeks === preset.weeks ? "is-selected" : ""}"
                role="radio"
                aria-checked=${selectedWeeks === preset.weeks ? "true" : "false"}
                ?disabled=${busy || !canSubmit}
                @click=${() => {
                  selectedWeeks = preset.weeks;
                  requestRerender();
                }}
              >
                <span class="platform-tenants__extend-preset-label">${preset.label}</span>
                <span class="muted">${preset.hint}</span>
                <span class="platform-tenants__extend-preset-preview">
                  延期至 ${previewEndsAt(preset.weeks)}
                </span>
              </button>
            `,
          )}
        </div>

        <footer class="platform-tenants__extend-dialog-footer">
          <button
            class="btn"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantTrialExtendDialog()}
          >
            取消
          </button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${busy || !canSubmit}
            @click=${confirm}
          >
            ${busy ? "保存中…" : `确认延长 ${selectedWeeks} 周`}
          </button>
        </footer>
      </div>
    </div>
  `;
}

/** @deprecated 改用弹层；保留导出避免过渡期引用断裂。 */
export function renderTenantTrialExtensionSection(_params: {
  enterpriseId: string;
  tenantName: string;
  trialEndsLabel?: string;
  authPanelProps?: PlatformAuthPanelProps | null;
  actions?: PlatformPortTenantsActions | null;
}) {
  return nothing;
}
