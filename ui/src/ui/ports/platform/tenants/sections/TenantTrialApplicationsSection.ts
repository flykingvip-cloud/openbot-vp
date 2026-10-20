import { html, nothing } from "lit";
import type {
  ControlUiPlatformTrialApplicationStatus,
  ControlUiPlatformTrialApplicationSummary,
} from "../../../../../../../src/gateway/control-ui-contract.js";
import type { PlatformPortTenantsActions } from "../../view-types.ts";

export const TRIAL_APPLICATION_STATUS_LABEL: Record<
  ControlUiPlatformTrialApplicationStatus,
  string
> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已拒绝",
  converted: "已开通",
};

const REVIEW_REASON_LABEL: Record<string, string> = {
  free_email: "个人邮箱",
  large_team: "团队规模较大",
  large_account_name: "疑似大客户关键词",
  needs_demo: "需要演示",
  mid_market_team: "中型团队",
};

export function formatTrialApplicationDateTime(value: string | undefined): string {
  if (!value) {
    return "—";
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export function formatTrialReviewReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) {
    return "无标记";
  }
  return reasons.map((reason) => REVIEW_REASON_LABEL[reason] ?? reason).join(" / ");
}

export function approveTrialApplication(
  application: ControlUiPlatformTrialApplicationSummary,
  actions: PlatformPortTenantsActions,
) {
  if (typeof window === "undefined" || !window.confirm) {
    void actions.onApproveTrialApplication({ applicationId: application.id });
    return;
  }
  const note =
    window.prompt(`通过 ${application.companyName} 的试用申请？\n可填写备注（可空）：`, "") ?? "";
  void actions.onApproveTrialApplication({
    applicationId: application.id,
    ...(note.trim() ? { reviewNote: note.trim() } : {}),
  });
}

export function rejectTrialApplication(
  application: ControlUiPlatformTrialApplicationSummary,
  actions: PlatformPortTenantsActions,
) {
  if (typeof window === "undefined" || !window.prompt) {
    return;
  }
  const reason = window.prompt(`拒绝 ${application.companyName} 的试用申请，请填写原因：`, "");
  if (reason === null) {
    return;
  }
  const trimmed = reason.trim();
  if (!trimmed) {
    window.alert?.("拒绝原因为必填项。");
    return;
  }
  void actions.onRejectTrialApplication({
    applicationId: application.id,
    rejectionReason: trimmed,
  });
}

/**
 * @deprecated 独立审批列表面板已并入统一租户列表；保留导出供过渡期引用检查。
 * 请勿在列表页再次渲染完整审批区。
 */
export function renderTenantTrialApplicationsSection(_params: {
  platformAuthState: unknown;
  actions: PlatformPortTenantsActions;
}) {
  return nothing;
}

/** 申请详情页内的审批操作区（仅详情页使用）。 */
export function renderTrialApplicationDetailActions(params: {
  application: ControlUiPlatformTrialApplicationSummary;
  actions: PlatformPortTenantsActions;
  canManagePlatform?: boolean;
  busy?: boolean;
}) {
  if (params.application.status !== "pending") {
    return nothing;
  }
  if (params.canManagePlatform === false) {
    return html`
      <div class="platform-tenants__detail-actions-row">
        <span class="muted">需要平台管理员权限才能审批。</span>
      </div>
    `;
  }
  return html`
    <div class="platform-tenants__detail-actions-row">
      <button
        class="btn btn--primary"
        type="button"
        ?disabled=${Boolean(params.busy)}
        @click=${() => approveTrialApplication(params.application, params.actions)}
      >
        批准申请
      </button>
      <button
        class="btn"
        type="button"
        ?disabled=${Boolean(params.busy)}
        @click=${() => rejectTrialApplication(params.application, params.actions)}
      >
        拒绝申请
      </button>
    </div>
  `;
}
