import { html, nothing } from "lit";
import {
  listDaibaiActionableGaps,
  summarizeDaibaiPostCreateGaps,
  type DaibaiCapabilityGapItem,
  type DaibaiGapApplyDeeplink,
  type DaibaiGapCtaKind,
} from "./daibai-capability-gaps.ts";
import { resolveDaibaiCatalogTemplateId } from "./daibai-catalog-template-id.ts";
import {
  beginDaibaiMcpScan,
  beginDaibaiMcpScanSubmit,
  completeDaibaiMcpScanByCatalog,
  completeDaibaiMcpScanSubmit,
  daibaiMcpScanCandidateKey,
  failDaibaiMcpScan,
  failDaibaiMcpScanSubmit,
  getDaibaiMcpScanUiState,
} from "./daibai-mcp-scan-session.ts";
import {
  isDaibaiMcpDiscoveryPermissionFailure,
  rankOrFilterMcpDiscoveryForDaibaiRole,
  type DaibaiMcpDiscoverySnapshot,
  type DaibaiMcpDiscoveryStatus,
  type DaibaiMcpScanCandidate,
} from "./daibai-mcp-scan.ts";
import {
  noteDaibaiMcpScanSubmitted,
  renderDaibaiMyApplicationsSection,
  requestDaibaiMyApplicationsRefresh,
} from "./daibai-my-applications-view.ts";
import {
  renderDaibaiOiGapActions,
  type DaibaiOiEnrollmentSubmitInput,
} from "./daibai-oi-enrollment-view.ts";
import type { DaibaiOiIdentityContext } from "./daibai-oi-enrollment.ts";
import type {
  DaibaiTeamCreatedMember,
  DaibaiTeamMemberDraft,
  DaibaiTeamPath,
} from "./daibai-team-onboarding-model.ts";
import {
  DAIBAI_TEAM_CATALOG,
  DAIBAI_TEAM_CATEGORIES,
  DAIBAI_TEAM_COPY,
  selectedDaibaiTeamAgents,
} from "./daibai-team-onboarding-model.ts";
import {
  dispatchDaibaiTeamOnboarding,
  getDaibaiTeamOnboardingState,
} from "./daibai-team-onboarding-session.ts";

export type DaibaiTeamCreateResult = {
  created: DaibaiTeamCreatedMember[];
  error: string | null;
};

export type DaibaiTeamOnboardingViewOptions = {
  onRequestRender?: (() => void) | null;
  onDismiss?: (() => void) | null;
  /** Leave the guide and start the existing capability familiarization ask. */
  onExploreCapabilities?: (() => void) | null;
  /** Leave the guide and open 系统设置 → 我的机器人. */
  onOpenMyRobotsSetup?: (() => void) | null;
  onCreateTeam?: ((members: DaibaiTeamMemberDraft[]) => Promise<DaibaiTeamCreateResult>) | null;
  /** Same handler as the sidebar AI 助手 plus, when that button is not in the document. */
  onOpenAgentCreator?: (() => void) | null;
  /**
   * Stage B/C: jump into an existing explicit apply flow for a gap / scan CTA.
   * Must never silently grant MCP / OI / oauth.
   */
  onApplyCapabilityGap?:
    | ((
        cta: DaibaiGapCtaKind,
        item: DaibaiCapabilityGapItem,
        member: DaibaiTeamCreatedMember,
        deeplink?: DaibaiGapApplyDeeplink,
      ) => void)
    | null;
  /**
   * Stage C: read-only enterprise-data.mcp-discovery.for-seat. Absent → scan button shows unavailable.
   */
  onRequestMcpDiscovery?:
    | ((request?: {
        catalogId?: string;
        templateId?: string;
      }) => Promise<DaibaiMcpDiscoverySnapshot>)
    | null;
  /**
   * Stage C CTA: create mcp_tool_mapping via governance-approvals.create.
   * Must never call mcp-mapping.upsert / grants.upsert / OI authorize.
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
   * Stage B OI CTA: create oi_enrollment via governance-approvals.create.
   * Must never call OI authorize / grants.upsert / mcp-mapping.upsert.
   */
  onSubmitOiEnrollment?:
    | ((input: DaibaiOiEnrollmentSubmitInput) => Promise<{ approvalId: string }>)
    | null;
  /** Loaded personal / enterprise identities. Missing id is an error, never a fake id. */
  oiIdentityContext?: DaibaiOiIdentityContext | null;
  /**
   * Success-page「我的申请」: enterprise-data.governance-approvals.list.
   * Non-admin callers are already scoped to the current user by the gateway.
   */
  onListMyApplications?: (() => Promise<unknown>) | null;
  /** Optional withdraw for a pending request (governance-approvals.cancel). */
  onCancelMyApplication?: ((approvalId: string) => Promise<void>) | null;
};

const ASSISTANT_ADD_SELECTOR = 'button.employee-workbench__group-add[aria-label="add AI 助手"]';

/** Click the existing sidebar plus so the guide opens the same creator. */
export function clickWorkbenchAssistantAddControl(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const button = document.querySelector<HTMLButtonElement>(ASSISTANT_ADD_SELECTOR);
  if (!button) {
    return false;
  }
  button.click();
  return true;
}

function openSameAgentCreator(options: DaibaiTeamOnboardingViewOptions) {
  // Prefer the live sidebar AI 助手 + so the guide shares that exact click path.
  if (clickWorkbenchAssistantAddControl()) {
    return;
  }
  // Fallback: injected opener (expands nav / opens the same creator sheet).
  options.onOpenAgentCreator?.();
}

function notify(options: DaibaiTeamOnboardingViewOptions) {
  options.onRequestRender?.();
}

function choose(path: DaibaiTeamPath, options: DaibaiTeamOnboardingViewOptions) {
  dispatchDaibaiTeamOnboarding({ type: "choosePath", path });
  notify(options);
}

function renderCatalogAccordion(options: DaibaiTeamOnboardingViewOptions) {
  const open = getDaibaiTeamOnboardingState().path === "catalog";
  return html`
    <div class="employee-workbench__team-onboarding-accordion">
      <button
        type="button"
        class="employee-workbench__team-onboarding-path ${open ? "is-selected" : ""}"
        data-team-path="catalog"
        aria-expanded=${open ? "true" : "false"}
        @click=${() => choose("catalog", options)}
      >
        <span class="employee-workbench__team-onboarding-path-copy">
          <strong>${DAIBAI_TEAM_COPY.catalogTitle}</strong>
          <span>${DAIBAI_TEAM_COPY.catalogBody}</span>
        </span>
        <span class="employee-workbench__team-onboarding-caret" aria-hidden="true">${open ? "▾" : "▸"}</span>
      </button>
      ${open ? renderCatalog(options) : nothing}
    </div>
  `;
}

/** Split plusGuidance so only the + character is interactive. */
export function splitDaibaiPlusGuidance(text: string = DAIBAI_TEAM_COPY.plusGuidance): {
  before: string;
  after: string;
} {
  const token = "\u201c+\u201d"; // “+”
  const index = text.indexOf(token);
  if (index < 0) {
    return { before: text, after: "" };
  }
  return {
    before: text.slice(0, index) + "\u201c",
    after: "\u201d" + text.slice(index + token.length),
  };
}

function renderPlusGuidance(options: DaibaiTeamOnboardingViewOptions) {
  const { before, after } = splitDaibaiPlusGuidance();
  return html`
    <p class="employee-workbench__team-onboarding-plus-line">
      ${before}<button
        type="button"
        class="employee-workbench__team-onboarding-plus"
        data-team-open-creator="true"
        aria-label="add AI 助手"
        @click=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          openSameAgentCreator(options);
        }}
      >+</button>${after}
    </p>
  `;
}

function renderCatalog(options: DaibaiTeamOnboardingViewOptions) {
  const state = getDaibaiTeamOnboardingState();
  const visible = DAIBAI_TEAM_CATALOG.filter(
    (agent) => state.category === "all" || agent.category === state.category,
  );
  return html`
    <p class="employee-workbench__team-onboarding-lead">${DAIBAI_TEAM_COPY.pickLead}</p>
    <div class="employee-workbench__team-onboarding-tabs" role="tablist" aria-label="候选分类">
      ${DAIBAI_TEAM_CATEGORIES.map(
        (category) => html`
          <button
            type="button"
            class="employee-workbench__team-onboarding-tab ${
              state.category === category.id ? "is-active" : ""
            }"
            role="tab"
            aria-selected=${state.category === category.id ? "true" : "false"}
            data-team-category=${category.id}
            @click=${() => {
              dispatchDaibaiTeamOnboarding({ type: "setCategory", category: category.id });
              notify(options);
            }}
          >
            ${category.label}
          </button>
        `,
      )}
    </div>
    <div class="employee-workbench__team-onboarding-catalog" role="listbox" aria-label="候选数字员工" aria-multiselectable="true">
      ${visible.map((agent) => {
        const selected = state.selectedIds.includes(agent.id);
        return html`
          <button
            type="button"
            class="employee-workbench__team-onboarding-agent ${selected ? "is-selected" : ""}"
            role="option"
            aria-selected=${selected ? "true" : "false"}
            data-team-agent=${agent.id}
            @click=${() => {
              dispatchDaibaiTeamOnboarding({ type: "toggle", id: agent.id });
              notify(options);
            }}
          >
            <span class="employee-workbench__team-onboarding-emoji" aria-hidden="true">${agent.emoji}</span>
            <span class="employee-workbench__team-onboarding-agent-copy">
              <span class="employee-workbench__team-onboarding-agent-name">
                <strong>${agent.name}</strong>
                ${
                  agent.recommended
                    ? html`<span class="employee-workbench__team-onboarding-badge">${DAIBAI_TEAM_COPY.recommended}</span>`
                    : nothing
                }
              </span>
              <span class="employee-workbench__team-onboarding-specialty">${agent.specialty}</span>
              <span class="employee-workbench__team-onboarding-caps">
                ${agent.caps.map((cap) => html`<span>${cap}</span>`)}
              </span>
              <span class="employee-workbench__team-onboarding-fit"
                >${DAIBAI_TEAM_COPY.fitPrefix} · ${agent.fit}</span
              >
            </span>
            <span class="employee-workbench__team-onboarding-check" aria-hidden="true"></span>
          </button>
        `;
      })}
    </div>
    <div class="employee-workbench__team-onboarding-float">
      <span>${DAIBAI_TEAM_COPY.selected} ${state.selectedIds.length} ${DAIBAI_TEAM_COPY.people}</span>
      <button
        type="button"
        class="btn primary employee-workbench__team-onboarding-submit"
        data-team-create="true"
        ?disabled=${state.busy || state.selectedIds.length === 0}
        @click=${() => {
          void submitTeam(options);
        }}
      >
        ${state.busy ? DAIBAI_TEAM_COPY.creating : DAIBAI_TEAM_COPY.create}
      </button>
    </div>
  `;
}

function gapStatusLabel(item: DaibaiCapabilityGapItem): string {
  switch (item.status) {
    case "preloaded":
      return DAIBAI_TEAM_COPY.gapsPreloaded;
    case "recommended":
      return DAIBAI_TEAM_COPY.gapsRecommended;
    case "check_unavailable":
      return DAIBAI_TEAM_COPY.gapsSeatCheck;
    default:
      return DAIBAI_TEAM_COPY.gapsPending;
  }
}

function scanStatusLabel(status: DaibaiMcpScanCandidate["status"]): string {
  switch (status) {
    case "authorized":
      return DAIBAI_TEAM_COPY.scanAuthorized;
    case "mapped_pending_grant":
      return DAIBAI_TEAM_COPY.gapsPending;
    default:
      return DAIBAI_TEAM_COPY.gapsPending;
  }
}

function emptyScanMessage(
  reason: ReturnType<typeof rankOrFilterMcpDiscoveryForDaibaiRole>["emptyReason"],
): string {
  switch (reason) {
    case "remote_unavailable":
      return DAIBAI_TEAM_COPY.scanEmptyRemote;
    case "no_candidates":
      return DAIBAI_TEAM_COPY.scanEmptyNoCandidates;
    case "no_match":
      return DAIBAI_TEAM_COPY.scanEmptyNoMatch;
    default:
      return DAIBAI_TEAM_COPY.scanEmptyNoMatch;
  }
}

async function runMcpScan(
  members: readonly DaibaiTeamCreatedMember[],
  options: DaibaiTeamOnboardingViewOptions,
) {
  if (!options.onRequestMcpDiscovery) {
    failDaibaiMcpScan(DAIBAI_TEAM_COPY.scanUnavailable);
    notify(options);
    return;
  }
  beginDaibaiMcpScan();
  notify(options);
  try {
    const seen = new Set<string>();
    const entries: { catalogId: string; snapshot: DaibaiMcpDiscoverySnapshot }[] = [];
    for (const member of members) {
      const catalogId = member.catalogId.trim();
      if (!catalogId || seen.has(catalogId)) {
        continue;
      }
      seen.add(catalogId);
      const templateId = resolveDaibaiCatalogTemplateId(catalogId);
      const snapshot = await options.onRequestMcpDiscovery({ catalogId, templateId });
      entries.push({ catalogId, snapshot });
    }
    completeDaibaiMcpScanByCatalog(entries);
  } catch (error) {
    const permissionFailure = isDaibaiMcpDiscoveryPermissionFailure(error);
    failDaibaiMcpScan(
      error instanceof Error && error.message.trim() ? error.message : DAIBAI_TEAM_COPY.scanError,
      { suppressStaticFallback: permissionFailure },
    );
  }
  notify(options);
}

function buildScanDeeplink(
  candidate: DaibaiMcpScanCandidate,
  approvalId?: string,
): DaibaiGapApplyDeeplink {
  return {
    mcpServer: candidate.serverName,
    mcpTool: candidate.toolName || undefined,
    capabilityId: candidate.capabilityId,
    edc: candidate.status === "mapped_pending_grant" ? "authorization" : "capabilities",
    ...(approvalId ? { approvalId } : {}),
  };
}

function openScanEdc(
  candidate: DaibaiMcpScanCandidate,
  member: DaibaiTeamCreatedMember,
  options: DaibaiTeamOnboardingViewOptions,
  approvalId?: string,
) {
  const synthetic: DaibaiCapabilityGapItem = {
    key: `mcp_scan:${candidate.serverName}:${candidate.toolName || "*"}`,
    kind: "mcp",
    label: candidate.toolName
      ? `${candidate.serverName} / ${candidate.toolName}`
      : candidate.serverName,
    status: candidate.status === "authorized" ? "preloaded" : "pending",
    cta: "mcp_scan_apply",
    ctaLabel: DAIBAI_TEAM_COPY.scanOpenEdc,
    note: candidate.note,
  };
  // Secondary path only: leave success page and open EDC for admin Save.
  dispatchDaibaiTeamOnboarding({ type: "skip" });
  options.onApplyCapabilityGap?.(
    "mcp_scan_apply",
    synthetic,
    member,
    buildScanDeeplink(candidate, approvalId),
  );
  notify(options);
}

async function submitScanCandidate(
  candidate: DaibaiMcpScanCandidate,
  member: DaibaiTeamCreatedMember,
  options: DaibaiTeamOnboardingViewOptions,
) {
  if (!candidate.cta) {
    return;
  }
  const mcpTool = candidate.toolName.trim();
  if (!mcpTool) {
    const key = daibaiMcpScanCandidateKey(member.catalogId, candidate.serverName, "");
    failDaibaiMcpScanSubmit(key, DAIBAI_TEAM_COPY.scanSubmitError);
    notify(options);
    return;
  }
  const key = daibaiMcpScanCandidateKey(member.catalogId, candidate.serverName, mcpTool);
  const existing = getDaibaiMcpScanUiState().submittedByKey[key];
  if (existing) {
    notify(options);
    return;
  }
  if (!options.onSubmitMcpScanApproval) {
    failDaibaiMcpScanSubmit(key, DAIBAI_TEAM_COPY.scanSubmitUnavailable);
    notify(options);
    return;
  }
  beginDaibaiMcpScanSubmit(key);
  notify(options);
  try {
    const templateId = resolveDaibaiCatalogTemplateId(member.catalogId);
    const result = await options.onSubmitMcpScanApproval({
      mcpServer: candidate.serverName,
      mcpTool,
      discoveryStatusSnapshot: candidate.status,
      catalogId: member.catalogId,
      templateId,
      clientRequestId: `daibai-mcp-scan:${member.catalogId}:${candidate.serverName}:${mcpTool}:${candidate.status}`,
      reason: `大白岗位扫描申请：${member.name} / ${candidate.serverName} / ${mcpTool}`,
    });
    const approvalId = typeof result?.approvalId === "string" ? result.approvalId.trim() : "";
    if (!approvalId) {
      throw new Error(DAIBAI_TEAM_COPY.scanSubmitError);
    }
    completeDaibaiMcpScanSubmit(key, {
      approvalId,
      mcpServer: candidate.serverName,
      mcpTool,
      catalogId: member.catalogId,
    });
    noteDaibaiMcpScanSubmitted({
      approvalId,
      mcpServer: candidate.serverName,
      mcpTool,
      catalogId: member.catalogId,
    });
    requestDaibaiMyApplicationsRefresh({
      onRequestRender: () => notify(options),
      onListMyApplications: options.onListMyApplications ?? null,
      onCancelMyApplication: options.onCancelMyApplication ?? null,
      onApplyCapabilityGap: options.onApplyCapabilityGap ?? null,
    });
  } catch (error) {
    failDaibaiMcpScanSubmit(
      key,
      error instanceof Error && error.message.trim()
        ? error.message
        : DAIBAI_TEAM_COPY.scanSubmitError,
    );
  }
  notify(options);
}

function formatScanSubmitSuccess(approvalId: string): string {
  return DAIBAI_TEAM_COPY.scanSubmitSuccess.replace("{id}", approvalId);
}

function renderScanCandidateActions(
  candidate: DaibaiMcpScanCandidate,
  member: DaibaiTeamCreatedMember,
  options: DaibaiTeamOnboardingViewOptions,
) {
  if (!candidate.cta || !candidate.ctaLabel) {
    if (candidate.status !== "authorized") {
      return nothing;
    }
    return html`<span class="employee-workbench__team-onboarding-gap-badge">${DAIBAI_TEAM_COPY.scanAuthorized}</span>`;
  }
  const key = daibaiMcpScanCandidateKey(
    member.catalogId,
    candidate.serverName,
    candidate.toolName.trim(),
  );
  const scan = getDaibaiMcpScanUiState();
  const submitted = scan.submittedByKey[key];
  const submitError = scan.submitErrorByKey[key];
  const submitting = scan.submittingKey === key;
  if (submitted) {
    return html`<span class="employee-workbench__team-onboarding-scan-actions">
      <span
        class="employee-workbench__team-onboarding-gap-note"
        data-scan-submit-success=${submitted.approvalId}
      >${formatScanSubmitSuccess(submitted.approvalId)}</span>
      <button
        type="button"
        class="btn ghost employee-workbench__team-onboarding-gap-cta"
        data-team-scan-edc="true"
        @click=${() => openScanEdc(candidate, member, options, submitted.approvalId)}
      >
        ${DAIBAI_TEAM_COPY.scanOpenEdc}
      </button>
    </span>`;
  }
  return html`<span class="employee-workbench__team-onboarding-scan-actions">
    ${
      submitError
        ? html`<span class="employee-workbench__team-onboarding-gap-note" data-scan-submit-error="true">${submitError}</span>`
        : nothing
    }
    <button
      type="button"
      class="btn ghost employee-workbench__team-onboarding-gap-cta"
      data-team-scan-cta="mcp_scan_apply"
      ?disabled=${submitting}
      @click=${() => {
        void submitScanCandidate(candidate, member, options);
      }}
    >
      ${submitting ? DAIBAI_TEAM_COPY.scanSubmitting : candidate.ctaLabel}
    </button>
    <button
      type="button"
      class="btn ghost employee-workbench__team-onboarding-gap-cta"
      data-team-scan-edc="true"
      ?disabled=${submitting}
      @click=${() => openScanEdc(candidate, member, options)}
    >
      ${DAIBAI_TEAM_COPY.scanOpenEdc}
    </button>
  </span>`;
}

function renderMemberScan(
  member: DaibaiTeamCreatedMember,
  options: DaibaiTeamOnboardingViewOptions,
) {
  const summary = summarizeDaibaiPostCreateGaps(member.catalogId);
  if (!summary.hasRoleTemplate) {
    return nothing;
  }
  const scan = getDaibaiMcpScanUiState();
  const filtered =
    scan.byCatalogId[member.catalogId] ??
    rankOrFilterMcpDiscoveryForDaibaiRole(scan.snapshot, member.catalogId);
  const oiItems = summary.items.filter((item) => item.kind === "oi");

  return html`
    <div
      class="employee-workbench__team-onboarding-scan"
      data-team-mcp-scan=${member.catalogId}
      data-team-mcp-scan-phase=${scan.phase}
    >
      <div class="employee-workbench__team-onboarding-scan-head">
        <strong>${member.name}</strong>
        <span class="employee-workbench__team-onboarding-gaps-template">${summary.templateId}</span>
      </div>
      ${
        scan.phase === "loading"
          ? html`<p class="employee-workbench__team-onboarding-scan-status" data-scan-status="loading">${DAIBAI_TEAM_COPY.scanScanning}</p>`
          : nothing
      }
      ${
        scan.phase === "error"
          ? html`<p class="employee-workbench__team-onboarding-scan-status" data-scan-status="error">${scan.error ?? DAIBAI_TEAM_COPY.scanError}</p>`
          : nothing
      }
      ${
        scan.phase === "ready" && filtered.candidates.length > 0
          ? html`<ul class="employee-workbench__team-onboarding-gap-list" data-scan-group="candidates">
              ${filtered.candidates.map(
                (candidate) => html`<li
                  class="employee-workbench__team-onboarding-gap"
                  data-scan-server=${candidate.serverName}
                  data-scan-tool=${candidate.toolName}
                  data-scan-status=${candidate.status}
                  data-scan-cta=${candidate.cta ?? ""}
                >
                  <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">${candidate.status === "authorized" ? "✓" : "□"}</span>
                  <span class="employee-workbench__team-onboarding-gap-copy">
                    <span class="employee-workbench__team-onboarding-gap-label"
                      >${candidate.toolName ? `${candidate.serverName} / ${candidate.toolName}` : candidate.serverName}</span
                    >
                    <span class="employee-workbench__team-onboarding-gap-badge">${scanStatusLabel(candidate.status)}</span>
                    <span class="employee-workbench__team-onboarding-gap-note">${candidate.note}</span>
                  </span>
                  ${renderScanCandidateActions(candidate, member, options)}
                </li>`,
              )}
            </ul>`
          : nothing
      }
      ${
        scan.phase === "ready" && filtered.candidates.length === 0
          ? html`<p class="employee-workbench__team-onboarding-scan-status" data-scan-status="empty">${emptyScanMessage(filtered.emptyReason)}</p>`
          : nothing
      }
      ${
        !scan.suppressStaticFallback &&
        filtered.staticFallbackHints.length > 0 &&
        (scan.phase === "error" ||
          (scan.phase === "ready" && filtered.usedStaticFallback) ||
          (scan.phase === "idle" && !options.onRequestMcpDiscovery))
          ? html`<ul class="employee-workbench__team-onboarding-gap-list" data-scan-group="static-fallback">
              ${filtered.staticFallbackHints.map(
                (hint) => html`<li
                  class="employee-workbench__team-onboarding-gap"
                  data-scan-static=${hint.key}
                >
                  <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">□</span>
                  <span class="employee-workbench__team-onboarding-gap-copy">
                    <span class="employee-workbench__team-onboarding-gap-label">${hint.label}</span>
                    <span class="employee-workbench__team-onboarding-gap-badge">${DAIBAI_TEAM_COPY.scanStaticFallback}</span>
                    <span class="employee-workbench__team-onboarding-gap-note">${hint.note}</span>
                  </span>
                  <button
                    type="button"
                    class="btn ghost employee-workbench__team-onboarding-gap-cta"
                    data-team-gap-cta="mcp_admin_save"
                    @click=${() => {
                      dispatchDaibaiTeamOnboarding({ type: "skip" });
                      options.onApplyCapabilityGap?.(
                        "mcp_admin_save",
                        {
                          key: hint.key,
                          kind: "mcp",
                          label: hint.label,
                          status: "pending",
                          cta: "mcp_admin_save",
                          ctaLabel: "去数据能力中心（管理员 Save）",
                          note: hint.note,
                        },
                        member,
                      );
                      notify(options);
                    }}
                  >
                    去数据能力中心（管理员 Save）
                  </button>
                </li>`,
              )}
            </ul>`
          : nothing
      }
      ${
        oiItems.length > 0
          ? html`<div class="employee-workbench__team-onboarding-scan-oi" data-scan-oi="true">
              <p class="employee-workbench__team-onboarding-gap-note">${DAIBAI_TEAM_COPY.scanOiLead}</p>
              <ul class="employee-workbench__team-onboarding-gap-list" data-scan-group="oi">
                ${oiItems.map(
                  (item) => html`<li
                    class="employee-workbench__team-onboarding-gap"
                    data-gap-key=${item.key}
                    data-gap-cta=${item.cta ?? ""}
                  >
                    <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">□</span>
                    <span class="employee-workbench__team-onboarding-gap-copy">
                      <span class="employee-workbench__team-onboarding-gap-label">${item.label}</span>
                      <span class="employee-workbench__team-onboarding-gap-badge">${DAIBAI_TEAM_COPY.gapsRecommended}</span>
                    </span>
                    ${
                      item.cta === "apply_personal_oi" || item.cta === "apply_enterprise_oi"
                        ? renderDaibaiOiGapActions(item, member, options)
                        : item.cta && item.ctaLabel
                          ? html`<button
                              type="button"
                              class="btn ghost employee-workbench__team-onboarding-gap-cta"
                              data-team-gap-cta=${item.cta}
                              @click=${() => {
                                dispatchDaibaiTeamOnboarding({ type: "skip" });
                                options.onApplyCapabilityGap?.(item.cta!, item, member);
                                notify(options);
                              }}
                            >
                              ${item.ctaLabel}
                            </button>`
                          : nothing
                    }
                  </li>`,
                )}
              </ul>
            </div>`
          : nothing
      }
    </div>
  `;
}

function renderScanPanel(
  members: readonly DaibaiTeamCreatedMember[],
  options: DaibaiTeamOnboardingViewOptions,
) {
  const roleMembers = members.filter(
    (member) => summarizeDaibaiPostCreateGaps(member.catalogId).hasRoleTemplate,
  );
  if (roleMembers.length === 0) {
    return nothing;
  }
  const scan = getDaibaiMcpScanUiState();
  const scanLabel =
    scan.phase === "loading"
      ? DAIBAI_TEAM_COPY.scanScanning
      : scan.phase === "ready" || scan.phase === "error"
        ? DAIBAI_TEAM_COPY.scanRetry
        : DAIBAI_TEAM_COPY.scanButton;
  return html`
    <div class="employee-workbench__team-onboarding-scan-panel" data-team-mcp-scan-panel="true">
      <h4 class="employee-workbench__team-onboarding-gaps-title">${DAIBAI_TEAM_COPY.scanTitle}</h4>
      <p class="employee-workbench__team-onboarding-gaps-lead">${DAIBAI_TEAM_COPY.scanLead}</p>
      <p class="employee-workbench__team-onboarding-gap-note">${DAIBAI_TEAM_COPY.scanAdminNote}</p>
      <button
        type="button"
        class="btn primary employee-workbench__team-onboarding-scan-btn"
        data-team-mcp-scan-run="true"
        ?disabled=${scan.phase === "loading"}
        @click=${() => {
          void runMcpScan(roleMembers, options);
        }}
      >
        ${scanLabel}
      </button>
      ${roleMembers.map((member) => renderMemberScan(member, options))}
    </div>
  `;
}

function renderMemberGaps(
  member: DaibaiTeamCreatedMember,
  options: DaibaiTeamOnboardingViewOptions,
) {
  const summary = summarizeDaibaiPostCreateGaps(member.catalogId);
  if (!summary.hasRoleTemplate) {
    return nothing;
  }
  const actionable = listDaibaiActionableGaps(summary);
  const preloaded = summary.items.filter((item) => item.status === "preloaded");
  return html`
    <div
      class="employee-workbench__team-onboarding-gaps"
      data-team-gaps=${member.catalogId}
      data-team-gaps-template=${summary.templateId}
    >
      <div class="employee-workbench__team-onboarding-gaps-head">
        <strong>${member.name}</strong>
        <span class="employee-workbench__team-onboarding-gaps-template">${summary.templateId}</span>
      </div>
      ${
        preloaded.length > 0
          ? html`<ul class="employee-workbench__team-onboarding-gap-list" data-gap-group="preloaded">
              ${preloaded.map(
                (item) => html`<li
                  class="employee-workbench__team-onboarding-gap"
                  data-gap-key=${item.key}
                  data-gap-kind=${item.kind}
                  data-gap-status=${item.status}
                >
                  <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">✓</span>
                  <span class="employee-workbench__team-onboarding-gap-copy">
                    <span class="employee-workbench__team-onboarding-gap-label">${item.label}</span>
                    <span class="employee-workbench__team-onboarding-gap-badge">${gapStatusLabel(item)}</span>
                  </span>
                </li>`,
              )}
            </ul>`
          : nothing
      }
      ${
        actionable.length > 0
          ? html`<ul class="employee-workbench__team-onboarding-gap-list" data-gap-group="actionable">
              ${actionable.map(
                (item) => html`<li
                  class="employee-workbench__team-onboarding-gap"
                  data-gap-key=${item.key}
                  data-gap-kind=${item.kind}
                  data-gap-status=${item.status}
                  data-gap-cta=${item.cta ?? ""}
                >
                  <span class="employee-workbench__team-onboarding-gap-mark" aria-hidden="true">□</span>
                  <span class="employee-workbench__team-onboarding-gap-copy">
                    <span class="employee-workbench__team-onboarding-gap-label">${item.label}</span>
                    <span class="employee-workbench__team-onboarding-gap-badge">${gapStatusLabel(item)}</span>
                    ${item.note ? html`<span class="employee-workbench__team-onboarding-gap-note">${item.note}</span>` : nothing}
                  </span>
                  ${
                    item.cta === "apply_personal_oi" || item.cta === "apply_enterprise_oi"
                      ? renderDaibaiOiGapActions(item, member, options)
                      : item.cta && item.ctaLabel
                        ? html`<button
                            type="button"
                            class="btn ghost employee-workbench__team-onboarding-gap-cta"
                            data-team-gap-cta=${item.cta}
                            data-team-gap-member=${member.agentId}
                            @click=${() => {
                              dispatchDaibaiTeamOnboarding({ type: "skip" });
                              options.onApplyCapabilityGap?.(item.cta!, item, member);
                              notify(options);
                            }}
                          >
                            ${item.ctaLabel}
                          </button>`
                        : nothing
                  }
                </li>`,
              )}
            </ul>`
          : html`<p class="employee-workbench__team-onboarding-gaps-empty">${DAIBAI_TEAM_COPY.gapsEmpty}</p>`
      }
    </div>
  `;
}

function renderSuccess(options: DaibaiTeamOnboardingViewOptions) {
  const state = getDaibaiTeamOnboardingState();
  const showGaps = state.created.some(
    (member) => summarizeDaibaiPostCreateGaps(member.catalogId).hasRoleTemplate,
  );
  return html`
    <div class="employee-workbench__team-onboarding-success" role="status">
      <span class="employee-workbench__team-onboarding-success-mark" aria-hidden="true">✓</span>
      <h3 class="employee-workbench__team-onboarding-title">${DAIBAI_TEAM_COPY.successTitle}</h3>
      <p class="employee-workbench__team-onboarding-lead">${DAIBAI_TEAM_COPY.successBody}</p>
      ${
        state.created.length > 0
          ? html`<ul class="employee-workbench__team-onboarding-created">
              ${state.created.map((member) => html`<li>${member.name}</li>`)}
            </ul>`
          : nothing
      }
      ${
        showGaps
          ? html`<div class="employee-workbench__team-onboarding-gaps-panel" data-team-gaps-panel="true">
              <h4 class="employee-workbench__team-onboarding-gaps-title">${DAIBAI_TEAM_COPY.gapsTitle}</h4>
              <p class="employee-workbench__team-onboarding-gaps-lead">${DAIBAI_TEAM_COPY.gapsLead}</p>
              ${state.created.map((member) => renderMemberGaps(member, options))}
            </div>`
          : nothing
      }
      ${showGaps ? renderScanPanel(state.created, options) : nothing}
      ${renderDaibaiMyApplicationsSection({
        members: state.created,
        onRequestRender: options.onRequestRender,
        onListMyApplications: options.onListMyApplications ?? null,
        onCancelMyApplication: options.onCancelMyApplication ?? null,
        onApplyCapabilityGap: options.onApplyCapabilityGap ?? null,
      })}
    </div>
    <p class="employee-workbench__team-onboarding-retain" data-team-retained="true">
      ${DAIBAI_TEAM_COPY.retainedNote}
    </p>
  `;
}

function renderDismiss(options: DaibaiTeamOnboardingViewOptions) {
  return html`
    <div class="employee-workbench__team-onboarding-dismiss">
      <button
        type="button"
        class="btn ghost"
        data-team-explore="true"
        @click=${() => {
          dispatchDaibaiTeamOnboarding({ type: "skip" });
          options.onExploreCapabilities?.();
          notify(options);
        }}
      >
        ${DAIBAI_TEAM_COPY.exploreCapabilities}
      </button>
      <button
        type="button"
        class="btn ghost"
        data-team-my-robots="true"
        @click=${() => {
          dispatchDaibaiTeamOnboarding({ type: "skip" });
          options.onOpenMyRobotsSetup?.();
          notify(options);
        }}
      >
        ${DAIBAI_TEAM_COPY.completePersonalSetup}
      </button>
    </div>
  `;
}

async function submitTeam(options: DaibaiTeamOnboardingViewOptions) {
  const members = selectedDaibaiTeamAgents(getDaibaiTeamOnboardingState());
  if (members.length === 0) {
    dispatchDaibaiTeamOnboarding({ type: "createFailure", error: DAIBAI_TEAM_COPY.emptySelection });
    notify(options);
    return;
  }
  if (!options.onCreateTeam) {
    dispatchDaibaiTeamOnboarding({ type: "createFailure", error: DAIBAI_TEAM_COPY.unavailable });
    notify(options);
    return;
  }
  dispatchDaibaiTeamOnboarding({ type: "createStart" });
  notify(options);
  try {
    const result = await options.onCreateTeam(members);
    dispatchDaibaiTeamOnboarding({
      type: "createSuccess",
      created: result.created,
      error: result.error,
    });
  } catch (error) {
    dispatchDaibaiTeamOnboarding({
      type: "createFailure",
      error: error instanceof Error ? error.message : DAIBAI_TEAM_COPY.unavailable,
    });
  }
  notify(options);
}

export function renderDaibaiTeamOnboarding(options: DaibaiTeamOnboardingViewOptions = {}) {
  const state = getDaibaiTeamOnboardingState();
  if (state.step === "closed") {
    return nothing;
  }
  const ready = state.created.length > 0;
  return html`
    <section
      class="employee-workbench__team-onboarding"
      data-daibai-team-onboarding="true"
      data-team-step="page"
      data-team-panel=${state.path ?? ""}
      aria-label=${DAIBAI_TEAM_COPY.kicker}
    >
      <h3 class="employee-workbench__team-onboarding-title">${DAIBAI_TEAM_COPY.welcome}</h3>
      ${
        ready
          ? renderSuccess(options)
          : html`
            ${renderCatalogAccordion(options)}
            ${renderPlusGuidance(options)}
          `
      }
      ${state.error ? html`<p class="employee-workbench__team-onboarding-error">${state.error}</p>` : nothing}
      ${renderDismiss(options)}
    </section>
  `;
}
