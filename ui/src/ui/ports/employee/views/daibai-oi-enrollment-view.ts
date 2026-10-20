/**
 * Stage B OI gap actions: primary submits oi_enrollment, secondary opens the
 * existing authorize page. This module never calls authorize / grant RPCs.
 */
import { html, nothing } from "lit";
import type {
  DaibaiCapabilityGapItem,
  DaibaiGapCtaKind,
  DaibaiGapApplyDeeplink,
} from "./daibai-capability-gaps.ts";
import { resolveDaibaiCatalogTemplateId } from "./daibai-catalog-template-id.ts";
import {
  noteDaibaiOiEnrollmentSubmitted,
  requestDaibaiMyApplicationsRefresh,
} from "./daibai-my-applications-view.ts";
import {
  beginDaibaiOiEnrollmentSubmit,
  completeDaibaiOiEnrollmentSubmit,
  daibaiOiEnrollmentKey,
  failDaibaiOiEnrollmentSubmit,
  getDaibaiOiEnrollmentUiState,
} from "./daibai-oi-enrollment-session.ts";
import {
  resolveDaibaiOiEnrollmentIdentity,
  type DaibaiOiIdentityContext,
} from "./daibai-oi-enrollment.ts";
import { DAIBAI_TEAM_COPY } from "./daibai-team-onboarding-model.ts";
import type { DaibaiTeamCreatedMember } from "./daibai-team-onboarding-model.ts";
import { dispatchDaibaiTeamOnboarding } from "./daibai-team-onboarding-session.ts";

export type DaibaiOiEnrollmentSubmitInput = {
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
  catalogId: string;
  templateId: string;
  clientRequestId: string;
  reason?: string;
};

export type DaibaiOiEnrollmentActionHost = {
  onRequestRender?: (() => void) | null;
  onApplyCapabilityGap?:
    | ((
        cta: DaibaiGapCtaKind,
        item: DaibaiCapabilityGapItem,
        member: DaibaiTeamCreatedMember,
        deeplink?: DaibaiGapApplyDeeplink,
      ) => void)
    | null;
  onSubmitOiEnrollment?:
    | ((input: DaibaiOiEnrollmentSubmitInput) => Promise<{ approvalId: string }>)
    | null;
  onListMyApplications?: (() => Promise<unknown>) | null;
  onCancelMyApplication?: ((approvalId: string) => Promise<void>) | null;
  oiIdentityContext?: DaibaiOiIdentityContext | null;
};

function notify(host: DaibaiOiEnrollmentActionHost) {
  host.onRequestRender?.();
}

function identityScopeForCta(cta: DaibaiGapCtaKind): "personal" | "enterprise" | null {
  if (cta === "apply_personal_oi") {
    return "personal";
  }
  if (cta === "apply_enterprise_oi") {
    return "enterprise";
  }
  return null;
}

function formatOiSubmitSuccess(approvalId: string): string {
  return DAIBAI_TEAM_COPY.oiSubmitSuccess.replace("{id}", approvalId);
}

/** Secondary path only: leave the success page and open the existing OI settings. */
function openExistingOiAuthorize(
  item: DaibaiCapabilityGapItem,
  member: DaibaiTeamCreatedMember,
  host: DaibaiOiEnrollmentActionHost,
) {
  if (!item.cta) {
    return;
  }
  dispatchDaibaiTeamOnboarding({ type: "skip" });
  host.onApplyCapabilityGap?.(item.cta, item, member);
  notify(host);
}

async function submitOiEnrollment(
  item: DaibaiCapabilityGapItem,
  member: DaibaiTeamCreatedMember,
  host: DaibaiOiEnrollmentActionHost,
) {
  const identityScope = item.cta ? identityScopeForCta(item.cta) : null;
  if (!identityScope) {
    return;
  }
  const key = daibaiOiEnrollmentKey(member.agentId, item.key);
  if (getDaibaiOiEnrollmentUiState().submittedByKey[key]) {
    notify(host);
    return;
  }
  const targetAgentId = member.agentId.trim();
  const resolved = resolveDaibaiOiEnrollmentIdentity({
    identityScope,
    targetAgentId,
    context: host.oiIdentityContext ?? null,
  });
  if (!resolved.ok) {
    failDaibaiOiEnrollmentSubmit(key, resolved.message);
    notify(host);
    return;
  }
  if (!host.onSubmitOiEnrollment) {
    failDaibaiOiEnrollmentSubmit(key, DAIBAI_TEAM_COPY.oiSubmitUnavailable);
    notify(host);
    return;
  }
  beginDaibaiOiEnrollmentSubmit(key);
  notify(host);
  try {
    const templateId = resolveDaibaiCatalogTemplateId(member.catalogId);
    const result = await host.onSubmitOiEnrollment({
      identityScope,
      identityId: resolved.identityId,
      targetAgentId,
      catalogId: member.catalogId,
      templateId,
      clientRequestId: `daibai-oi:${identityScope}:${member.catalogId}:${resolved.identityId}:${targetAgentId}`,
      reason: `大白岗位运营身份申请：${member.name} / ${identityScope} / ${item.label}`,
    });
    const approvalId = typeof result?.approvalId === "string" ? result.approvalId.trim() : "";
    if (!approvalId) {
      throw new Error(DAIBAI_TEAM_COPY.oiSubmitError);
    }
    completeDaibaiOiEnrollmentSubmit(key, {
      approvalId,
      identityScope,
      identityId: resolved.identityId,
      targetAgentId,
      catalogId: member.catalogId,
    });
    noteDaibaiOiEnrollmentSubmitted({
      approvalId,
      identityScope,
      identityId: resolved.identityId,
      targetAgentId,
      catalogId: member.catalogId,
      displayName: item.label,
    });
    requestDaibaiMyApplicationsRefresh({
      onRequestRender: () => notify(host),
      onListMyApplications: host.onListMyApplications ?? null,
      onCancelMyApplication: host.onCancelMyApplication ?? null,
      onApplyCapabilityGap: host.onApplyCapabilityGap ?? null,
    });
  } catch (error) {
    failDaibaiOiEnrollmentSubmit(
      key,
      error instanceof Error && error.message.trim()
        ? error.message
        : DAIBAI_TEAM_COPY.oiSubmitError,
    );
  }
  notify(host);
}

export function renderDaibaiOiGapActions(
  item: DaibaiCapabilityGapItem,
  member: DaibaiTeamCreatedMember,
  host: DaibaiOiEnrollmentActionHost,
) {
  if (!item.cta || !item.ctaLabel || !identityScopeForCta(item.cta)) {
    return nothing;
  }
  const key = daibaiOiEnrollmentKey(member.agentId, item.key);
  const ui = getDaibaiOiEnrollmentUiState();
  const submitted = ui.submittedByKey[key];
  const submitError = ui.submitErrorByKey[key];
  const submitting = ui.submittingKey === key;
  return html`<span class="employee-workbench__team-onboarding-scan-actions">
    ${
      submitted
        ? html`<span
            class="employee-workbench__team-onboarding-gap-note"
            data-oi-submit-success=${submitted.approvalId}
          >${formatOiSubmitSuccess(submitted.approvalId)}</span>`
        : nothing
    }
    ${
      submitError
        ? html`<span class="employee-workbench__team-onboarding-gap-note" data-oi-submit-error="true">${submitError}</span>`
        : nothing
    }
    ${
      submitted
        ? nothing
        : html`<button
            type="button"
            class="btn ghost employee-workbench__team-onboarding-gap-cta"
            data-team-gap-cta=${item.cta}
            data-team-oi-submit=${item.cta}
            data-team-gap-member=${member.agentId}
            ?disabled=${submitting}
            @click=${() => {
              void submitOiEnrollment(item, member, host);
            }}
          >
            ${submitting ? DAIBAI_TEAM_COPY.oiSubmitting : item.ctaLabel}
          </button>`
    }
    <button
      type="button"
      class="btn ghost employee-workbench__team-onboarding-gap-cta"
      data-team-oi-open=${item.cta}
      data-team-gap-member=${member.agentId}
      ?disabled=${submitting}
      @click=${() => openExistingOiAuthorize(item, member, host)}
    >
      ${DAIBAI_TEAM_COPY.oiOpenAuthorize}
    </button>
  </span>`;
}
