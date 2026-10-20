import { html, nothing } from "lit";
import { BUILTIN_STEWARD_NAME } from "../../../builtin-steward-selection.ts";
import { installDaibaiGuideHistoryBridge } from "../daibai-guide-history-wire.ts";
import {
  buildUserUiSnapshotFromDaibai,
  stewardSuggestionAsOptional,
} from "../guidance/build-ui-snapshot.ts";
import type { GuidanceOrchestratorClient } from "../guidance/metrics-client.ts";
import { recordGuidanceMetricClient, recordGuidanceShownOnce } from "../guidance/metrics-client.ts";
import { renderOrchestratedGuidanceSurface } from "../guidance/render-orchestrated-cta.ts";
import {
  acknowledgeGuidanceSnapshot,
  clearGuidanceHighRiskConfirm,
  deferGuidanceSnapshot,
  getGuidanceUiControlState,
  isGuidanceHighRiskPending,
  requestGuidanceHighRiskConfirm,
} from "../guidance/ui-control-state.ts";
import type {
  DaibaiCapabilityGapItem,
  DaibaiGapApplyDeeplink,
  DaibaiGapCtaKind,
} from "./daibai-capability-gaps.ts";
import type { DaibaiMcpDiscoverySnapshot, DaibaiMcpDiscoveryStatus } from "./daibai-mcp-scan.ts";
import type { DaibaiOiEnrollmentSubmitInput } from "./daibai-oi-enrollment-view.ts";
import type { DaibaiOiIdentityContext } from "./daibai-oi-enrollment.ts";
import { DAIBAI_TEAM_COPY } from "./daibai-team-onboarding-model.ts";
import type {
  DaibaiTeamCreatedMember,
  DaibaiTeamMemberDraft,
} from "./daibai-team-onboarding-model.ts";
import {
  bindDaibaiTeamGuideOwner,
  dispatchDaibaiTeamOnboarding,
  getDaibaiTeamOnboardingState,
} from "./daibai-team-onboarding-session.ts";
import {
  renderDaibaiTeamOnboarding,
  type DaibaiTeamCreateResult,
} from "./daibai-team-onboarding-view.ts";
import { organizerMeetingLinkPending } from "./meeting-notice-text.ts";
import type { WorkbenchDaibaiStageCapabilityContract } from "./workbench-capability-contracts.ts";
import type { WorkbenchStageConversationContract } from "./workbench-stage-contracts.ts";
import { renderConversationStageShell } from "./workbench-stage-conversation.ts";

/**
 * Optional familiarization ask (header「问大白」). Not the primary「开始引导」outcome.
 * Keep in sync with controllers/daibai.ts — views must not import controllers.
 */
export const DAIBAI_GUIDE_PROMPT =
  "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。";

const DAIBAI_ONBOARDING_QUICK_PROMPTS = [
  "我今天该先做什么？",
  "有哪些推荐能力？",
  "我能让你帮我做哪些事？",
] as const;
const DAIBAI_ACTION_CHIP_STYLES = html`
  <style>
    .employee-workbench__assistant-action-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .employee-workbench__assistant-action-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      padding: 5px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      font-size: 13px;
      line-height: 1.4;
      cursor: pointer;
      transition:
        border-color 140ms ease,
        background 140ms ease;
    }

    .employee-workbench__assistant-action-chip:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
      background: var(--bg-hover);
    }

    .employee-workbench__assistant-action-chip:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .employee-workbench__assistant-action-chip.is-primary {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      background: color-mix(in srgb, var(--accent) 12%, var(--card));
      color: var(--text-strong);
    }
  </style>
`;

type DaibaiThreadPreludeOptions = {
  guideAcknowledged?: boolean;
  onDismissGuide?: (() => void) | null;
  showStewardFooter?: boolean;
  /**
   * Guidance Orchestrator: when true, hide native「开始引导」primary so only
   * `orchestratedPrimary` / `[data-guidance-primary-cta]` may own the next step.
   */
  suppressNativePrimaryCta?: boolean;
  /** Optional orchestrated CTA surface (single primary). */
  orchestratedPrimary?: import("lit").TemplateResult | typeof nothing | null;
  /** Gateway client for metrics (fail-soft). */
  guidanceClient?: GuidanceOrchestratorClient | null;
  /** Stable user id for user-scope snapshot isolation. */
  guidanceUserId?: string | null;
  guidanceTenantId?: string | null;
  /** Re-render host after ack/defer/high-risk pending flips or team-step changes. */
  onGuidanceControlChange?: (() => void) | null;
  /**
   * Create the selected digital employees via the existing agents.create pathway.
   * Absent in isolated prelude tests; the confirm step then reports that create is unavailable.
   */
  onCreateDaibaiTeam?:
    | ((members: DaibaiTeamMemberDraft[]) => Promise<DaibaiTeamCreateResult>)
    | null;
  /**
   * Same entry as the sidebar「AI 助手」plus. Used when that control is not mounted yet.
   */
  onOpenAgentCreator?: (() => void) | null;
  /**
   * Open 系统设置 → 我的机器人 (same destination as the settings sidebar tab).
   * The guide page stays in the conversation.
   */
  onOpenMyRobotsSetup?: (() => void) | null;
  /** Stage B/C gap / scan CTA → existing explicit apply flows (no silent grant). */
  onApplyCapabilityGap?:
    | ((
        cta: DaibaiGapCtaKind,
        item: DaibaiCapabilityGapItem,
        member: DaibaiTeamCreatedMember,
        deeplink?: DaibaiGapApplyDeeplink,
      ) => void)
    | null;
  /** Stage C: read-only MCP discovery RPC wrapper. Optional role args select the server prefilter. */
  onRequestMcpDiscovery?:
    | ((request?: {
        catalogId?: string;
        templateId?: string;
      }) => Promise<DaibaiMcpDiscoverySnapshot>)
    | null;
  /**
   * Stage C: submit mcp_tool_mapping capability-access request (no auto-grant).
   */
  onSubmitMcpScanApproval?:
    | ((input: {
        mcpServer: string;
        mcpTool: string;
        discoveryStatusSnapshot: DaibaiMcpDiscoveryStatus;
        catalogId: string;
        templateId: string;
        clientRequestId: string;
        reason?: string;
      }) => Promise<{ approvalId: string }>)
    | null;
  /**
   * Stage B: submit oi_enrollment capability-access request (no auto-grant).
   */
  onSubmitOiEnrollment?:
    | ((input: DaibaiOiEnrollmentSubmitInput) => Promise<{ approvalId: string }>)
    | null;
  /** Real identity ids already loaded for this employee. Never a gap-key stand-in. */
  oiIdentityContext?: DaibaiOiIdentityContext | null;
  /** Success-page summary via enterprise-data.governance-approvals.list. */
  onListMyApplications?: (() => Promise<unknown>) | null;
  /** Withdraw a pending capability-access request. */
  onCancelMyApplication?: ((approvalId: string) => Promise<void>) | null;
};

function renderOperationalIdentityBindingBanner(conversation: WorkbenchStageConversationContract) {
  const ready = conversation.pendingOperationalIdentityContinuationsReady ?? [];
  if (ready.length > 0) {
    const continuation = ready[0];
    return html`
      <div class="employee-workbench__member-governance-banner">
        运营身份已就绪，可继续执行：${continuation.provider} · ${continuation.requestedAction}
        <button
          type="button"
          class="btn btn--sm btn--primary"
          style="margin-left: 12px"
          @click=${() =>
            conversation.onResumeOperationalIdentityContinuation?.(continuation.continuationToken)}
        >
          继续任务
        </button>
      </div>
    `;
  }

  const pendingOAuth = conversation.pendingOperationalIdentityContinuationsOAuth ?? [];
  if (pendingOAuth.length > 0) {
    const continuation = pendingOAuth[0];
    return html`
      <div class="employee-workbench__member-governance-banner">
        请完成 ${continuation.provider} OAuth 验证后继续：${continuation.requestedAction}
        <button
          type="button"
          class="btn btn--sm btn--primary"
          style="margin-left: 12px"
          @click=${() =>
            conversation.onCompleteOperationalIdentityOAuthForContinuation?.({
              continuationToken: continuation.continuationToken,
              provider: continuation.provider,
            })}
        >
          完成 OAuth
        </button>
      </div>
    `;
  }

  const pendingBinding = conversation.pendingOperationalIdentityContinuationsBinding ?? [];
  if (pendingBinding.length > 0) {
    const continuation = pendingBinding[0];
    const showBrowserGuide = continuation.provider === "personal-email";
    return html`
      <div class="employee-workbench__member-governance-banner">
        当前任务需要先绑定 ${continuation.provider} 运营身份（${continuation.requestedAction}）。
        <button
          type="button"
          class="btn btn--sm btn--primary"
          style="margin-left: 12px"
          @click=${() => conversation.onOpenOperationalIdentityBindingFlow?.()}
        >
          去绑定
        </button>
        ${
          showBrowserGuide
            ? html`
                <button
                  type="button"
                  class="btn btn--sm"
                  style="margin-left: 8px"
                  @click=${() => conversation.onOpenPersonalEmailBrowserGuideFromChat?.()}
                >
                  浏览器获取授权码
                </button>
              `
            : nothing
        }
      </div>
    `;
  }

  const pending = conversation.pendingOperationalIdentityBindingRequests ?? [];
  if (pending.length === 0) {
    return nothing;
  }
  const request = pending[0];
  const showBrowserGuide = request.provider === "personal-email";
  return html`
    <div class="employee-workbench__member-governance-banner">
      当前任务需要绑定 ${request.provider} 运营身份（${request.requestedAction}）。
      <button
        type="button"
        class="btn btn--sm btn--primary"
        style="margin-left: 12px"
        @click=${() => conversation.onOpenOperationalIdentityBindingFlow?.()}
      >
        去绑定
      </button>
      ${
        showBrowserGuide
          ? html`
              <button
                type="button"
                class="btn btn--sm"
                style="margin-left: 8px"
                @click=${() => conversation.onOpenPersonalEmailBrowserGuideFromChat?.()}
              >
                浏览器获取授权码
              </button>
            `
          : nothing
      }
    </div>
  `;
}

function renderDaibaiSupportContext(
  daibaiStage: WorkbenchDaibaiStageCapabilityContract,
  result: NonNullable<WorkbenchDaibaiStageCapabilityContract["daibaiAskResult"]>,
) {
  const supportContext = result.supportContext;
  if (!supportContext) {
    return nothing;
  }
  if (
    supportContext.openCaseCount === 0 &&
    supportContext.waitingOnUserCount === 0 &&
    supportContext.cases.length === 0 &&
    !supportContext.latestCase
  ) {
    return nothing;
  }
  return html`
    <div class="chat-bubble employee-workbench__assistant-prelude-bubble">
      <div class="employee-workbench__assistant-prelude-grid">
        <div class="employee-workbench__assistant-prelude-metric">
          <span class="label">开放支持单</span>
          <strong>${supportContext.openCaseCount}</strong>
        </div>
        <div class="employee-workbench__assistant-prelude-metric">
          <span class="label">待我确认</span>
          <strong>${supportContext.waitingOnUserCount}</strong>
        </div>
      </div>
      ${
        supportContext.cases.length > 0
          ? html`
            <ul class="employee-workbench__assistant-prelude-cases">
              ${supportContext.cases.map(
                (entry) => html`
                  <li>
                    <strong>${entry.userProblem}</strong>
                    <span>状态：${entry.status}</span>
                  </li>
                `,
              )}
            </ul>
          `
          : nothing
      }
      ${
        supportContext.latestCase
          ? html`
            <div class="employee-workbench__assistant-prelude-note">
              最近一条：${supportContext.latestCase.userProblem}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderDaibaiLatestProposal(
  result: NonNullable<WorkbenchDaibaiStageCapabilityContract["daibaiAskResult"]>,
) {
  const latestProposal = result.latestProposal;
  if (!latestProposal) {
    return nothing;
  }
  return html`
    <div class="chat-bubble employee-workbench__assistant-prelude-bubble">
      <div class="employee-workbench__assistant-prelude-title">
        ${latestProposal.seenByUser ? "当前解决方案" : "平台最新回复"}
      </div>
      <div>${latestProposal.userFacingReply}</div>
    </div>
  `;
}

function renderDaibaiWorkspaceOverview(
  result: NonNullable<WorkbenchDaibaiStageCapabilityContract["daibaiAskResult"]>,
) {
  const overview = result.workspaceOverview;
  if (!overview) {
    return nothing;
  }
  const currentSpace = overview.currentSpace;
  const hasCurrentMembers =
    Boolean(currentSpace) &&
    ((currentSpace?.humans.length ?? 0) > 0 || (currentSpace?.bots.length ?? 0) > 0);
  return html`
    <div class="chat-bubble employee-workbench__assistant-prelude-bubble">
      <div class="employee-workbench__assistant-prelude-title">当前工作台概览</div>
      ${result.summary ? html`<div>${result.summary}</div>` : nothing}
      <div class="employee-workbench__assistant-prelude-grid">
        <div class="employee-workbench__assistant-prelude-metric">
          <span class="label">可见机器人</span>
          <strong>${overview.visibleRobotCount}</strong>
        </div>
        <div class="employee-workbench__assistant-prelude-metric">
          <span class="label">可见协作群</span>
          <strong>${overview.visibleSpaceCount}</strong>
        </div>
      </div>
      ${
        currentSpace
          ? html`
            <div class="employee-workbench__assistant-prelude-note">
              当前群：${currentSpace.title} · ${currentSpace.memberCount} 成员（人类 ${currentSpace.humanCount} / 机器人 ${currentSpace.botCount}）
            </div>
          `
          : nothing
      }
      ${
        hasCurrentMembers
          ? html`
            <div class="employee-workbench__assistant-prelude-note">
              人类成员：${currentSpace?.humans.join("、")}
            </div>
            <div class="employee-workbench__assistant-prelude-note">
              机器人成员：${currentSpace?.bots.join("、")}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function formatExpiryHint(expiresAtMs: number): string {
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    return "确认已过期，请重新发起";
  }
  const minutes = Math.ceil(remainingMs / 60000);
  return `请在约 ${minutes} 分钟内确认，逾期需重新发起`;
}

function renderGroupConfigProposalCard(daibaiStage: WorkbenchDaibaiStageCapabilityContract) {
  const pending = daibaiStage.groupConfigProposal;
  if (!pending) {
    return nothing;
  }
  const busy = Boolean(pending.busy);
  return html`
    <div
      class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
      role="group"
      aria-label="应用到协作小组"
    >
      <div class="employee-workbench__assistant-prelude-title">应用到协作小组</div>
      <div aria-live="polite">
        大白给出了可落库的配置建议（${pending.groupId}）。确认后将写入该小组设置与成员名单。
      </div>
      ${
        pending.summaryLines.length > 0
          ? html`
              <div class="employee-workbench__assistant-prelude-note">
                ${pending.summaryLines.map((line) => html`<div>${line}</div>`)}
              </div>
            `
          : nothing
      }
      ${
        pending.error
          ? html`<div class="employee-workbench__steward-confirm-danger">${pending.error}</div>`
          : nothing
      }
      ${
        pending.notice
          ? html`<div class="employee-workbench__assistant-prelude-note">${pending.notice}</div>`
          : nothing
      }
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button
          type="button"
          class="btn btn--sm primary"
          ?disabled=${busy || !daibaiStage.onApplyGroupConfigProposal}
          @click=${() => void daibaiStage.onApplyGroupConfigProposal?.()}
        >
          ${busy ? "正在应用…" : "采纳并写回小组"}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => daibaiStage.onDismissGroupConfigProposal?.()}
        >
          忽略
        </button>
      </div>
    </div>
  `;
}

function renderMeetingConfirmReleaseEpilogue(
  release: NonNullable<WorkbenchDaibaiStageCapabilityContract["meetingConfirmRelease"]>,
) {
  const title = release.title || "会议";
  const isReleasing = release.phase === "releasing";
  const status = isReleasing
    ? release.progressMessage
    : (release.resultMessage ?? release.progressMessage);
  return html`
    <div
      class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card employee-workbench__steward-confirm-card--release"
      role="status"
      aria-live="polite"
      aria-label=${`会议通知：${title}`}
      data-meeting-confirm-release=${release.phase}
    >
      ${
        release.noticeText
          ? html`<p class="employee-workbench__meeting-notice">${release.noticeText}</p>`
          : nothing
      }
      <div>${status}</div>
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button type="button" class="btn btn--sm" disabled>
          ${isReleasing ? "确认中…" : "已发送"}
        </button>
      </div>
    </div>
  `;
}

/** Steward card must show business copy only — never the Error.name prefix. */
function displayMeetingConfirmationError(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/^GatewayRequestError:\s*/i, "")
    .trim();
}

export function renderMeetingConfirmationCard(daibaiStage: WorkbenchDaibaiStageCapabilityContract) {
  const pending = daibaiStage.meetingPendingConfirmation;
  if (!pending) {
    const release = daibaiStage.meetingConfirmRelease;
    if (release) {
      return renderMeetingConfirmReleaseEpilogue(release);
    }
    // Visible when sync failed (e.g. all pending meetings are online without joinUrl).
    // Previously the error stayed on state but this renderer returned nothing.
    if (daibaiStage.meetingConfirmationError) {
      return html`
        <div
          class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
          role="group"
          aria-label="会议确认不可用"
          data-meeting-confirm-card="error"
        >
          <div class="employee-workbench__assistant-prelude-title">会议确认不可用</div>
          <div class="employee-workbench__steward-confirm-danger" aria-live="polite">
            ${displayMeetingConfirmationError(daibaiStage.meetingConfirmationError)}
          </div>
        </div>
      `;
    }
    return nothing;
  }
  // ConfirmChrome thin card (confirmation-card SPEC §3): optional short action title +
  // Confirm/Cancel + optional one-line consequenceHint. Do NOT embed organizer notice body.
  const actionTitle = "确认发送会议";
  const consequenceHint =
    typeof pending.confirmationDetail?.impact === "string"
      ? pending.confirmationDetail.impact.trim()
      : "";
  const linkPending = organizerMeetingLinkPending(pending.meeting);
  const busy = Boolean(daibaiStage.meetingConfirmationLoading);
  const canConfirm = Boolean(daibaiStage.onConfirmMeetingPendingApproval) && !busy && !linkPending;
  // Defensive: protocol violation if online-without-joinUrl still pending — no confirm controls.
  const showConfirmControls = !linkPending;
  return html`
    <div
      class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
      role="group"
      aria-label=${actionTitle}
      data-meeting-confirm-card="true"
      data-meeting-link-pending=${linkPending ? "true" : "false"}
      data-confirm-chrome="thin"
    >
      <div class="employee-workbench__assistant-prelude-title">${actionTitle}</div>
      ${
        consequenceHint && showConfirmControls
          ? html`<div class="employee-workbench__steward-confirm-hint">${consequenceHint}</div>`
          : nothing
      }
      ${
        linkPending
          ? html`
              <div class="employee-workbench__steward-confirm-danger" aria-live="polite">
                线上会议缺少入会链接，无法确认（应由服务端拒绝出卡）。
              </div>
            `
          : nothing
      }
      ${
        daibaiStage.meetingConfirmationError
          ? html`<div class="employee-workbench__steward-confirm-danger">${displayMeetingConfirmationError(daibaiStage.meetingConfirmationError)}</div>`
          : nothing
      }
      <div class="employee-workbench__assistant-prelude-toolbar">
        ${
          showConfirmControls
            ? html`
                <button
                  type="button"
                  class="btn btn--sm primary"
                  ?disabled=${!canConfirm}
                  @click=${() => daibaiStage.onConfirmMeetingPendingApproval?.()}
                >
                  ${busy ? "确认中…" : "确认发送"}
                </button>
              `
            : nothing
        }
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => daibaiStage.onCancelMeetingPendingConfirmation?.()}
        >
          取消，不发送
        </button>
      </div>
    </div>
  `;
}

function renderDaibaiConfirmationCard(daibaiStage: WorkbenchDaibaiStageCapabilityContract) {
  const pending = daibaiStage.daibaiPendingConfirmation;
  if (!pending) {
    return nothing;
  }
  const detail = pending.detail;
  const title = detail?.title ?? "待确认操作";
  const irreversible = detail?.irreversible === true;
  // Danger verb in the confirm button text (a11y: button text carries the action verb).
  const confirmLabel = irreversible ? `确认执行（不可逆）：${title}` : `确认执行：${title}`;
  return html`
    <div
      class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card${
        irreversible ? " is-danger" : ""
      }"
      role="group"
      aria-label=${`待确认操作：${title}`}
    >
      <div class="employee-workbench__assistant-prelude-title">待你确认 · ${title}</div>
      <div aria-live="polite">${pending.message}</div>
      <dl class="employee-workbench__steward-confirm-meta">
        ${detail?.impact ? html`<div><dt>影响范围</dt><dd>${detail.impact}</dd></div>` : nothing}
        ${
          detail?.secondaryPermission
            ? html`<div>
                <dt>权限要求</dt>
                <dd>需要「${detail.secondaryPermission}」权限，缺失时将引导你升级平台</dd>
              </div>`
            : nothing
        }
        ${
          irreversible
            ? html`
                <div>
                  <dt>风险提示</dt>
                  <dd class="employee-workbench__steward-confirm-danger">此操作不可逆，请谨慎确认</dd>
                </div>
              `
            : nothing
        }
        ${
          detail?.expiresAtMs
            ? html`<div><dt>有效期</dt><dd>${formatExpiryHint(detail.expiresAtMs)}</dd></div>`
            : nothing
        }
      </dl>
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button
          type="button"
          class="btn btn--sm primary${irreversible ? " danger" : ""}"
          ?disabled=${!daibaiStage.onConfirmDaibaiPendingAction || daibaiStage.daibaiActionLoading}
          @click=${() => daibaiStage.onConfirmDaibaiPendingAction?.()}
        >
          ${confirmLabel}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${daibaiStage.daibaiActionLoading}
          @click=${() => daibaiStage.onCancelDaibaiPendingConfirmation?.()}
        >
          取消，不执行
        </button>
      </div>
    </div>
  `;
}

function renderDaibaiOnboardingCard(
  result: NonNullable<WorkbenchDaibaiStageCapabilityContract["daibaiAskResult"]>,
  onOpenTeam: () => void,
) {
  if (result.presentation !== "onboarding") {
    return nothing;
  }
  const steps = result.guide?.nextSteps ?? [];
  const recommendations = result.guide?.recommendations ?? [];
  return html`
    <div class="chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__assistant-onboarding-card">
      <div>${result.summary}</div>
      ${
        steps.length > 0
          ? html`
            <ol class="employee-workbench__assistant-onboarding-steps">
              ${steps.map((step) => html`<li>${step}</li>`)}
            </ol>
          `
          : nothing
      }
      ${
        recommendations.length > 0
          ? html`
            <div class="employee-workbench__assistant-onboarding-recs" role="list">
              ${recommendations.slice(0, 3).map(
                (entry) => html`
                  <div class="employee-workbench__assistant-onboarding-rec" role="listitem">
                    <strong>${entry.name}</strong>
                    <span>${entry.reason}</span>
                  </div>
                `,
              )}
            </div>
          `
          : nothing
      }
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button type="button" class="btn btn--sm primary" data-daibai-open-team="true" @click=${onOpenTeam}>
          ${DAIBAI_TEAM_COPY.openTeam}
        </button>
      </div>
    </div>
  `;
}

function renderDaibaiOnboardingQuickPrompts(daibaiStage: WorkbenchDaibaiStageCapabilityContract) {
  const result = daibaiStage.daibaiAskResult;
  if (result?.presentation !== "onboarding") {
    return nothing;
  }
  return html`
    <div class="employee-workbench__assistant-prelude-actions employee-workbench__assistant-onboarding-prompts">
      ${DAIBAI_ONBOARDING_QUICK_PROMPTS.map(
        (prompt) => html`
          <button
            type="button"
            class="employee-workbench__assistant-prelude-action"
            ?disabled=${!daibaiStage.onAskDaibai || daibaiStage.daibaiLoading}
            @click=${() => daibaiStage.onAskDaibai?.(prompt)}
          >
            <strong>${prompt}</strong>
          </button>
        `,
      )}
    </div>
  `;
}

function renderDaibaiSuggestedActions(daibaiStage: WorkbenchDaibaiStageCapabilityContract) {
  if (daibaiStage.daibaiAskResult?.presentation === "onboarding") {
    return nothing;
  }
  const actions = daibaiStage.daibaiAskResult?.suggestedActions ?? [];
  if (actions.length === 0) {
    return nothing;
  }
  return html`
    ${DAIBAI_ACTION_CHIP_STYLES}
    <div
      class="employee-workbench__assistant-prelude-actions employee-workbench__assistant-action-chips"
      data-guidance-optional="true"
    >
      ${actions.map((action) => {
        // Steward / supervisor chips stay optional — never guidance primary CTA.
        return html`
          <button
            class="employee-workbench__assistant-action-chip"
            data-guidance-optional-cta=${action.actionId}
            data-steward-suggestion="true"
            title=${action.description ?? action.label}
            aria-label=${action.description ? `${action.label}：${action.description}` : action.label}
            ?disabled=${!daibaiStage.onExecuteDaibaiAction || daibaiStage.daibaiActionLoading}
            @click=${() => daibaiStage.onExecuteDaibaiAction?.(action.actionId, action.payload)}
          >
            ${action.label}
          </button>
        `;
      })}
    </div>
  `;
}

function renderDaibaiGuideControls(
  daibaiStage: WorkbenchDaibaiStageCapabilityContract,
  options: DaibaiThreadPreludeOptions,
) {
  const guideAcknowledged = Boolean(options.guideAcknowledged);
  const hasResult = Boolean(daibaiStage.daibaiAskResult || daibaiStage.daibaiExecuteResult);
  const suppressPrimary = Boolean(options.suppressNativePrimaryCta);
  if (suppressPrimary && !hasResult && !guideAcknowledged) {
    return nothing;
  }
  if (guideAcknowledged && !hasResult) {
    return html`
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button
          type="button"
          class="btn btn--sm primary"
          ?disabled=${!daibaiStage.onAskDaibai || daibaiStage.daibaiLoading}
          @click=${() => daibaiStage.onAskDaibai?.()}
        >
          ${daibaiStage.daibaiLoading ? "请求中…" : "问大白"}
        </button>
      </div>
    `;
  }
  if (!guideAcknowledged && !hasResult) {
    return html`
      <div class="employee-workbench__assistant-prelude-toolbar">
        ${
          suppressPrimary
            ? nothing
            : html`<button
          type="button"
          class="btn btn--sm primary"
          data-daibai-primary-cta="true"
          ?disabled=${daibaiStage.daibaiLoading}
          @click=${() => {
            dispatchDaibaiTeamOnboarding({ type: "start" });
            options.onGuidanceControlChange?.();
          }}
        >
          ${daibaiStage.daibaiLoading ? "引导中…" : "开始引导"}
        </button>`
        }
        <button
          type="button"
          class="btn btn--sm"
          data-guidance-acknowledge="true"
          @click=${() => options.onDismissGuide?.()}
        >
          我知道了
        </button>
      </div>
    `;
  }
  return !guideAcknowledged
    ? html`
        <div class="employee-workbench__assistant-prelude-toolbar">
          <button
            type="button"
            class="btn btn--sm"
            data-guidance-acknowledge="true"
            @click=${() => options.onDismissGuide?.()}
          >
            我知道了
          </button>
        </div>
      `
    : nothing;
}

export function renderDaibaiThreadPrelude(
  daibaiStage: WorkbenchDaibaiStageCapabilityContract,
  options: DaibaiThreadPreludeOptions = {},
) {
  installDaibaiGuideHistoryBridge();
  bindDaibaiTeamGuideOwner(options.guidanceUserId);
  const guideAcknowledged = Boolean(options.guideAcknowledged);
  const result = daibaiStage.daibaiAskResult;
  const hasActionChips = (result?.suggestedActions?.length ?? 0) > 0;
  const teamOnboardingOpen = getDaibaiTeamOnboardingState().step !== "closed";
  const hasPreludeContent = Boolean(
    teamOnboardingOpen ||
    result?.presentation === "onboarding" ||
    hasActionChips ||
    result?.workspaceOverview ||
    result?.supportContext ||
    result?.latestProposal ||
    daibaiStage.daibaiExecuteResult ||
    daibaiStage.daibaiPendingConfirmation ||
    daibaiStage.groupConfigProposal ||
    (!guideAcknowledged && !result),
  );

  if (!hasPreludeContent && guideAcknowledged) {
    return nothing;
  }

  const client = options.guidanceClient ?? null;
  const userId = (options.guidanceUserId ?? "local").trim() || "local";
  const needsOnboardingGuide = !guideAcknowledged && !result;
  const stewardOptional =
    result?.suggestedActions?.[0] != null
      ? stewardSuggestionAsOptional({
          kind: result.suggestedActions[0].actionId,
          label: result.suggestedActions[0].label,
        })
      : null;
  const autoSnapshot =
    needsOnboardingGuide || stewardOptional
      ? buildUserUiSnapshotFromDaibai({
          userId,
          needsOnboardingGuide,
          tenantId: options.guidanceTenantId ?? null,
          stewardSuggestion: stewardOptional,
        })
      : null;
  const controls = getGuidanceUiControlState();
  const openTeamOnboarding = () => {
    dispatchDaibaiTeamOnboarding({ type: "start" });
    options.onGuidanceControlChange?.();
  };
  let orchestratedPrimary = options.orchestratedPrimary ?? nothing;
  let suppressNative = Boolean(options.suppressNativePrimaryCta);
  if (!teamOnboardingOpen && !options.orchestratedPrimary && autoSnapshot && needsOnboardingGuide) {
    void recordGuidanceShownOnce(client, autoSnapshot);
    suppressNative = true;
    orchestratedPrimary = renderOrchestratedGuidanceSurface(autoSnapshot, {
      acknowledgedKeys: controls.acknowledgedKeys,
      deferredUntilMsByKey: controls.deferredUntilMsByKey,
      highRiskPending: isGuidanceHighRiskPending(autoSnapshot),
      showResume: false,
      showFailureRecover: false,
      onPrimary: (snapshot) => {
        void recordGuidanceMetricClient(client, snapshot, "guidance_primary_clicked");
        openTeamOnboarding();
      },
      onOptional: (snapshot, action) => {
        void recordGuidanceMetricClient(client, snapshot, "guidance_optional_clicked", {
          actionKind: action.kind,
        });
        void daibaiStage.onExecuteDaibaiAction?.(action.kind, undefined);
      },
      onAcknowledge: (snapshot) => {
        acknowledgeGuidanceSnapshot(snapshot);
        void recordGuidanceMetricClient(client, snapshot, "guidance_acknowledged");
        options.onDismissGuide?.();
        options.onGuidanceControlChange?.();
      },
      onDefer: (snapshot) => {
        deferGuidanceSnapshot(snapshot);
        void recordGuidanceMetricClient(client, snapshot, "guidance_deferred");
        options.onDismissGuide?.();
        options.onGuidanceControlChange?.();
      },
      onResume: (snapshot) => {
        void recordGuidanceMetricClient(client, snapshot, "guidance_resumed", {
          metadata: { fromGateway: true },
        });
        openTeamOnboarding();
      },
      onFailureRecover: (snapshot) => {
        void recordGuidanceMetricClient(client, snapshot, "guidance_step_failed", {
          metadata: { recovered: true },
        });
        openTeamOnboarding();
      },
      onRequestHighRiskConfirm: (snapshot) => {
        requestGuidanceHighRiskConfirm(snapshot);
        options.onGuidanceControlChange?.();
      },
      onHighRiskConfirm: (snapshot) => {
        clearGuidanceHighRiskConfirm(snapshot);
        void recordGuidanceMetricClient(client, snapshot, "guidance_high_risk_confirmed");
        openTeamOnboarding();
      },
    });
  }

  return html`
    <div
      class="chat-group assistant employee-workbench__assistant-prelude ${
        teamOnboardingOpen ? "is-team-open" : ""
      }"
    >
      <div class="chat-avatar assistant">大</div>
      <div class="chat-group-messages">
        ${
          !guideAcknowledged && !result?.presentation && !teamOnboardingOpen
            ? html`
                <div class="chat-bubble employee-workbench__assistant-prelude-bubble">
                  ${DAIBAI_TEAM_COPY.welcome}
                </div>
              `
            : nothing
        }
        ${
          result
            ? html`
              ${
                result.presentation === "onboarding"
                  ? renderDaibaiOnboardingCard(result, openTeamOnboarding)
                  : html`
                    ${renderDaibaiWorkspaceOverview(result)}
                    ${renderDaibaiLatestProposal(result)}
                    ${renderDaibaiSupportContext(daibaiStage, result)}
                  `
              }
            `
            : nothing
        }
        ${renderDaibaiConfirmationCard(daibaiStage)}
        ${renderGroupConfigProposalCard(daibaiStage)}
        ${
          daibaiStage.daibaiExecuteResult
            ? html`
              <div class="chat-bubble employee-workbench__assistant-prelude-bubble">
                ${daibaiStage.daibaiExecuteResult.message}
              </div>
            `
            : nothing
        }
        ${renderDaibaiOnboardingQuickPrompts(daibaiStage)}
        ${renderDaibaiSuggestedActions(daibaiStage)}
        ${
          teamOnboardingOpen
            ? renderDaibaiTeamOnboarding({
                onRequestRender: () => options.onGuidanceControlChange?.(),
                onDismiss: () => options.onDismissGuide?.(),
                onExploreCapabilities: () => {
                  if (autoSnapshot) {
                    acknowledgeGuidanceSnapshot(autoSnapshot);
                    void recordGuidanceMetricClient(client, autoSnapshot, "guidance_acknowledged");
                  }
                  options.onDismissGuide?.();
                  // No dedicated product-tour route. Reuse the header「问大白」familiarization ask.
                  void daibaiStage.onAskDaibai?.(DAIBAI_GUIDE_PROMPT);
                  options.onGuidanceControlChange?.();
                },
                onOpenMyRobotsSetup: () => {
                  if (autoSnapshot) {
                    acknowledgeGuidanceSnapshot(autoSnapshot);
                    void recordGuidanceMetricClient(client, autoSnapshot, "guidance_acknowledged");
                  }
                  options.onDismissGuide?.();
                  options.onOpenMyRobotsSetup?.();
                  options.onGuidanceControlChange?.();
                },
                onCreateTeam: options.onCreateDaibaiTeam ?? null,
                onOpenAgentCreator: options.onOpenAgentCreator ?? null,
                onApplyCapabilityGap: (cta, item, member, deeplink) => {
                  if (autoSnapshot) {
                    acknowledgeGuidanceSnapshot(autoSnapshot);
                    void recordGuidanceMetricClient(client, autoSnapshot, "guidance_acknowledged");
                  }
                  options.onDismissGuide?.();
                  options.onApplyCapabilityGap?.(cta, item, member, deeplink);
                  options.onGuidanceControlChange?.();
                },
                onRequestMcpDiscovery: options.onRequestMcpDiscovery ?? null,
                onSubmitMcpScanApproval: options.onSubmitMcpScanApproval ?? null,
                onSubmitOiEnrollment: options.onSubmitOiEnrollment ?? null,
                oiIdentityContext: options.oiIdentityContext ?? null,
                onListMyApplications: options.onListMyApplications ?? null,
                onCancelMyApplication: options.onCancelMyApplication ?? null,
              })
            : html`${orchestratedPrimary}
        ${renderDaibaiGuideControls(daibaiStage, {
          ...options,
          suppressNativePrimaryCta: suppressNative,
        })}`
        }
        <div class="chat-group-footer">
          <span class="chat-sender-name">
            ${options.showStewardFooter === false ? "Assistant" : BUILTIN_STEWARD_NAME}
          </span>
          <span class="chat-group-timestamp">刚刚</span>
        </div>
      </div>
    </div>
  `;
}

export function renderAssistantStagePage(
  conversation: WorkbenchStageConversationContract,
  _shellModel: unknown,
  daibaiStage: WorkbenchDaibaiStageCapabilityContract,
  _props: unknown,
) {
  if (conversation.authPanel) {
    return html`
      <section class="employee-workbench__assistant-stage">
        ${
          daibaiStage.daibaiError
            ? html`
              <div class="employee-workbench__member-governance-banner is-error">
                ${daibaiStage.daibaiError}
              </div>
            `
            : nothing
        }
        ${
          daibaiStage.daibaiActionError
            ? html`
              <div class="employee-workbench__member-governance-banner is-error">
                ${daibaiStage.daibaiActionError}
              </div>
            `
            : nothing
        }
        <div class="employee-workbench__auth-stage">${conversation.authPanel}</div>
      </section>
    `;
  }

  return html`
    <section class="employee-workbench__assistant-stage">
      ${
        daibaiStage.daibaiError
          ? html`
            <div class="employee-workbench__member-governance-banner is-error">
              ${daibaiStage.daibaiError}
            </div>
          `
          : nothing
      }
      ${
        daibaiStage.daibaiActionError
          ? html`
            <div class="employee-workbench__member-governance-banner is-error">
              ${daibaiStage.daibaiActionError}
            </div>
          `
          : nothing
      }
      ${renderOperationalIdentityBindingBanner(conversation)}
      ${renderConversationStageShell(conversation) ?? nothing}
    </section>
  `;
}
