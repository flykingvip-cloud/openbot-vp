/**
 * 成功页「我的申请」区块。读取 governance-approvals.list，提交扫描后刷新。
 * 已批准待开通的 MCP 行可次要打开 EDC；不会在这里开通映射或授权。
 */
import { html, nothing } from "lit";
import type {
  DaibaiCapabilityGapItem,
  DaibaiGapApplyDeeplink,
  DaibaiGapCtaKind,
} from "./daibai-capability-gaps.ts";
import {
  beginDaibaiMyApplicationCancel,
  beginDaibaiMyApplicationsLoad,
  completeDaibaiMyApplicationsLoad,
  failDaibaiMyApplicationCancel,
  failDaibaiMyApplicationsLoad,
  getDaibaiMyApplicationsUiState,
  markDaibaiMyApplicationCancelled,
  markDaibaiMyApplicationsUnavailable,
  noteDaibaiMyApplicationSubmitted,
  visibleDaibaiMyApplications,
} from "./daibai-my-applications-session.ts";
import {
  buildOptimisticDaibaiMcpApplication,
  buildOptimisticDaibaiOiApplication,
  daibaiApplicationAdminEdcTarget,
  daibaiApplicationCanCancel,
  daibaiApplicationCategoryLabel,
  daibaiApplicationStatusLabel,
  parseDaibaiMyApplicationsResponse,
  resolveDaibaiApplicationProductStatus,
  type DaibaiMyApplication,
} from "./daibai-my-applications.ts";
import { DAIBAI_TEAM_COPY } from "./daibai-team-onboarding-model.ts";
import type { DaibaiTeamCreatedMember } from "./daibai-team-onboarding-model.ts";
import { dispatchDaibaiTeamOnboarding } from "./daibai-team-onboarding-session.ts";

export type DaibaiMyApplicationsHost = {
  onRequestRender?: (() => void) | null;
  onListMyApplications?: (() => Promise<unknown>) | null;
  onCancelMyApplication?: ((approvalId: string) => Promise<void>) | null;
  onApplyCapabilityGap?:
    | ((
        cta: DaibaiGapCtaKind,
        item: DaibaiCapabilityGapItem,
        member: DaibaiTeamCreatedMember,
        deeplink?: DaibaiGapApplyDeeplink,
      ) => void)
    | null;
};

function notify(host: DaibaiMyApplicationsHost) {
  host.onRequestRender?.();
}

async function settleDaibaiMyApplicationsLoad(
  token: number,
  host: DaibaiMyApplicationsHost,
): Promise<void> {
  try {
    const payload = await host.onListMyApplications?.();
    const applied = completeDaibaiMyApplicationsLoad(
      token,
      parseDaibaiMyApplicationsResponse(payload),
    );
    if (applied) {
      notify(host);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim() ? error.message : DAIBAI_TEAM_COPY.appsError;
    const applied = failDaibaiMyApplicationsLoad(token, message);
    if (applied) {
      notify(host);
    }
  }
}

function kickoffDaibaiMyApplicationsLoad(host: DaibaiMyApplicationsHost, notifyNow: boolean): void {
  if (!host.onListMyApplications) {
    markDaibaiMyApplicationsUnavailable();
    if (notifyNow) {
      notify(host);
    }
    return;
  }
  const token = beginDaibaiMyApplicationsLoad();
  if (notifyNow) {
    notify(host);
  }
  void settleDaibaiMyApplicationsLoad(token, host);
}

/** First paint of the success page. Does not re-enter render. */
export function ensureDaibaiMyApplicationsLoaded(host: DaibaiMyApplicationsHost): void {
  if (getDaibaiMyApplicationsUiState().phase !== "idle") {
    return;
  }
  kickoffDaibaiMyApplicationsLoad(host, false);
}

export function requestDaibaiMyApplicationsRefresh(host: DaibaiMyApplicationsHost): void {
  kickoffDaibaiMyApplicationsLoad(host, true);
}

export function noteDaibaiMcpScanSubmitted(input: {
  approvalId: string;
  mcpServer: string;
  mcpTool: string;
  catalogId?: string;
}): void {
  noteDaibaiMyApplicationSubmitted(buildOptimisticDaibaiMcpApplication(input));
}

export function noteDaibaiOiEnrollmentSubmitted(input: {
  approvalId: string;
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
  catalogId?: string;
  displayName?: string;
}): void {
  noteDaibaiMyApplicationSubmitted(buildOptimisticDaibaiOiApplication(input));
}

async function cancelDaibaiMyApplication(
  approvalId: string,
  host: DaibaiMyApplicationsHost,
): Promise<void> {
  if (!host.onCancelMyApplication) {
    return;
  }
  const ui = getDaibaiMyApplicationsUiState();
  if (ui.cancellingId) {
    return;
  }
  beginDaibaiMyApplicationCancel(approvalId);
  notify(host);
  try {
    await host.onCancelMyApplication(approvalId);
    markDaibaiMyApplicationCancelled(approvalId);
    notify(host);
    requestDaibaiMyApplicationsRefresh(host);
  } catch (error) {
    failDaibaiMyApplicationCancel(
      approvalId,
      error instanceof Error && error.message.trim()
        ? error.message
        : DAIBAI_TEAM_COPY.appsCancelError,
    );
    notify(host);
  }
}

function openApplicationEdc(
  application: DaibaiMyApplication,
  member: DaibaiTeamCreatedMember,
  host: DaibaiMyApplicationsHost,
) {
  const target = daibaiApplicationAdminEdcTarget(application);
  if (!target) {
    return;
  }
  const synthetic: DaibaiCapabilityGapItem = {
    key: `my_application:${application.approvalId}`,
    kind: "mcp",
    label: application.displayName,
    status: "pending",
    cta: "mcp_scan_apply",
    ctaLabel: DAIBAI_TEAM_COPY.scanOpenEdc,
    note: DAIBAI_TEAM_COPY.appsLead,
  };
  dispatchDaibaiTeamOnboarding({ type: "skip" });
  host.onApplyCapabilityGap?.("mcp_scan_apply", synthetic, member, {
    mcpServer: target.mcpServer,
    mcpTool: target.mcpTool || undefined,
    edc: target.edc,
    approvalId: target.approvalId,
  });
  notify(host);
}

function renderApplicationRow(
  application: DaibaiMyApplication,
  member: DaibaiTeamCreatedMember,
  host: DaibaiMyApplicationsHost,
) {
  const product = resolveDaibaiApplicationProductStatus(application);
  const ui = getDaibaiMyApplicationsUiState();
  const cancelling = ui.cancellingId === application.approvalId;
  const cancelError = ui.cancelErrorById[application.approvalId];
  const edc = daibaiApplicationAdminEdcTarget(application);
  const canCancel = daibaiApplicationCanCancel(application) && Boolean(host.onCancelMyApplication);
  const mark =
    product === "fulfilled" ? "✓" : product === "rejected" || product === "cancelled" ? "·" : "□";
  return html`<li
    class="employee-workbench__team-onboarding-gap"
    data-approval-id=${application.approvalId}
    data-approval-category=${application.category}
    data-approval-status=${application.status}
    data-approval-product-status=${product}
  >
    <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">${mark}</span>
    <span class="employee-workbench__team-onboarding-gap-copy">
      <span class="employee-workbench__team-onboarding-gap-label">${application.displayName}</span>
      <span class="employee-workbench__team-onboarding-gap-badge">${daibaiApplicationStatusLabel(application)}</span>
      <span class="employee-workbench__team-onboarding-gap-note">${daibaiApplicationCategoryLabel(application.category)}</span>
      ${
        cancelError
          ? html`<span class="employee-workbench__team-onboarding-gap-note" data-approval-cancel-error="true">${cancelError}</span>`
          : nothing
      }
    </span>
    ${
      canCancel || edc
        ? html`<span class="employee-workbench__team-onboarding-apps-actions">
            ${
              canCancel
                ? html`<button
                    type="button"
                    class="btn ghost employee-workbench__team-onboarding-gap-cta"
                    data-team-my-application-cancel=${application.approvalId}
                    ?disabled=${cancelling}
                    @click=${() => {
                      void cancelDaibaiMyApplication(application.approvalId, host);
                    }}
                  >
                    ${cancelling ? DAIBAI_TEAM_COPY.appsCancelling : DAIBAI_TEAM_COPY.appsCancel}
                  </button>`
                : nothing
            }
            ${
              edc
                ? html`<button
                    type="button"
                    class="btn ghost employee-workbench__team-onboarding-gap-cta"
                    data-team-my-application-edc=${application.approvalId}
                    @click=${() => openApplicationEdc(application, member, host)}
                  >
                    ${DAIBAI_TEAM_COPY.scanOpenEdc}
                  </button>`
                : nothing
            }
          </span>`
        : nothing
    }
  </li>`;
}

export function renderDaibaiMyApplicationsSection(
  host: DaibaiMyApplicationsHost & { members: readonly DaibaiTeamCreatedMember[] },
) {
  ensureDaibaiMyApplicationsLoaded(host);
  const ui = getDaibaiMyApplicationsUiState();
  const visible = visibleDaibaiMyApplications();
  const member = host.members[0] ?? { catalogId: "", agentId: "", name: "" };
  return html`
    <div
      class="employee-workbench__team-onboarding-apps-panel"
      data-team-my-applications="true"
      data-team-my-applications-phase=${ui.phase}
    >
      <div class="employee-workbench__team-onboarding-apps-head">
        <h4 class="employee-workbench__team-onboarding-gaps-title">${DAIBAI_TEAM_COPY.appsTitle}</h4>
        <button
          type="button"
          class="btn ghost employee-workbench__team-onboarding-gap-cta"
          data-team-my-applications-refresh="true"
          ?disabled=${ui.phase === "loading"}
          @click=${() => requestDaibaiMyApplicationsRefresh(host)}
        >
          ${DAIBAI_TEAM_COPY.appsRefresh}
        </button>
      </div>
      <p class="employee-workbench__team-onboarding-gaps-lead">${DAIBAI_TEAM_COPY.appsLead}</p>
      ${
        ui.phase === "loading"
          ? html`<p class="employee-workbench__team-onboarding-gaps-empty" data-team-my-applications-status="loading">${DAIBAI_TEAM_COPY.appsLoading}</p>`
          : nothing
      }
      ${
        ui.phase === "error"
          ? html`<p class="employee-workbench__team-onboarding-gaps-empty" data-team-my-applications-status="error">${ui.error ?? DAIBAI_TEAM_COPY.appsError}</p>`
          : nothing
      }
      ${
        ui.phase === "unavailable"
          ? html`<p class="employee-workbench__team-onboarding-gaps-empty" data-team-my-applications-status="unavailable">${DAIBAI_TEAM_COPY.appsUnavailable}</p>`
          : nothing
      }
      ${
        ui.phase === "ready" && visible.length === 0
          ? html`<p class="employee-workbench__team-onboarding-gaps-empty" data-team-my-applications-empty="true">${DAIBAI_TEAM_COPY.appsEmpty}</p>`
          : nothing
      }
      ${
        visible.length > 0
          ? html`<ul class="employee-workbench__team-onboarding-gap-list" data-team-my-applications-list="true">
              ${visible.map((application) => renderApplicationRow(application, member, host))}
            </ul>`
          : nothing
      }
    </div>
  `;
}
