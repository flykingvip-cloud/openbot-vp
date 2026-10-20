import { html, nothing } from "lit";
import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import type { PlatformAuthPanelProps } from "../../../../views/platform-auth-panel.ts";
import type { PlatformPortTenantsActions } from "../../view-types.ts";
import { renderPlatformAuthFeedback } from "./TenantTrialExtensionSection.ts";

export type TenantSeatSettingsDialogState = {
  enterpriseId: string;
  tenantName: string;
  seatQuota: number;
  seatUsed: number;
};

let seatDialog: TenantSeatSettingsDialogState | null = null;
let draftSeatCount = "";
let seatSubmitting = false;

function requestRerender() {
  requestOpenBotAppRerender();
}

export function isTenantSeatSettingsDialogOpen() {
  return seatDialog != null;
}

export function openTenantSeatSettingsDialog(state: TenantSeatSettingsDialogState) {
  seatDialog = state;
  draftSeatCount = String(Math.max(state.seatQuota, 1));
  seatSubmitting = false;
  requestRerender();
}

export function closeTenantSeatSettingsDialog() {
  if (seatSubmitting) {
    return;
  }
  seatDialog = null;
  seatSubmitting = false;
  requestRerender();
}

/** @internal vitest reset */
export function __resetTenantSeatSettingsForTest() {
  seatDialog = null;
  draftSeatCount = "";
  seatSubmitting = false;
}

function parsedSeatCount(): number | null {
  const parsed = Number.parseInt(draftSeatCount.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

/** 试用席位上限轻量编辑弹层。 */
export function renderTenantSeatSettingsDialog(params: {
  authPanelProps?: PlatformAuthPanelProps | null;
  actions?: PlatformPortTenantsActions | null;
}) {
  if (!seatDialog) {
    return nothing;
  }
  const auth = params.authPanelProps;
  const busy = seatSubmitting;
  const canManage = Boolean(auth?.state?.canManagePlatform);
  const nextCount = parsedSeatCount();
  const canSubmit =
    canManage && Boolean(params.actions?.onUpdateTrialInstance) && nextCount != null;
  const dialog = seatDialog;
  const belowUsed = nextCount != null && nextCount < dialog.seatUsed;

  const confirm = () => {
    if (!canSubmit || busy || nextCount == null) {
      return;
    }
    seatSubmitting = true;
    requestRerender();
    void params.actions
      ?.onUpdateTrialInstance({
        enterpriseId: dialog.enterpriseId,
        seatCount: nextCount,
      })
      .then((ok) => {
        seatSubmitting = false;
        if (ok) {
          seatDialog = null;
          requestRerender();
        } else {
          requestRerender();
        }
      })
      .catch(() => {
        seatSubmitting = false;
        requestRerender();
      });
  };

  return html`
    <div
      class="platform-tenants__extend-dialog-root"
      role="presentation"
      data-testid="tenant-seat-settings-dialog"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !busy) {
          closeTenantSeatSettingsDialog();
        }
      }}
    >
      <div
        class="platform-tenants__extend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-tenants-seat-title"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            closeTenantSeatSettingsDialog();
          }
        }}
      >
        <header class="platform-tenants__extend-dialog-head">
          <div>
            <h3 id="platform-tenants-seat-title">席位设置</h3>
            <p class="muted">为「${dialog.tenantName}」调整试用可授权员工数。</p>
          </div>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantSeatSettingsDialog()}
          >
            关闭
          </button>
        </header>

        <div class="platform-tenants__extend-dialog-meta">
          当前占用：<strong>${dialog.seatUsed}</strong> / 上限
          <strong>${dialog.seatQuota}</strong>
        </div>

        ${
          !canSubmit && !canManage
            ? html`
                <div class="callout danger">需要平台管理员权限才能调整试用席位。</div>
              `
            : nothing
        }

        ${renderPlatformAuthFeedback({
          error: auth?.error,
          notice: busy ? null : auth?.notice,
          busy,
        })}

        <label class="field">
          <span>试用席位上限</span>
          <input
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            placeholder="默认 5"
            .value=${draftSeatCount}
            ?disabled=${busy || !canManage}
            data-testid="tenant-seat-count-input"
            @input=${(event: Event) => {
              draftSeatCount = (event.target as HTMLInputElement).value;
              requestRerender();
            }}
          />
        </label>
        <p class="muted">只改席位数，试用流程与到期日保持不变。已占用席位不会被回收。</p>
        ${
          belowUsed
            ? html`
                <div class="callout">
                  已占用 ${dialog.seatUsed} 席，保存后上限不会低于当前占用。
                </div>
              `
            : nothing
        }

        <footer class="platform-tenants__extend-dialog-footer">
          <button
            class="btn"
            type="button"
            ?disabled=${busy}
            @click=${() => closeTenantSeatSettingsDialog()}
          >
            取消
          </button>
          <button
            class="btn btn--primary"
            type="button"
            data-testid="tenant-seat-save"
            ?disabled=${busy || !canSubmit}
            @click=${confirm}
          >
            ${busy ? "保存中…" : "保存席位"}
          </button>
        </footer>
      </div>
    </div>
  `;
}
