import { t } from "../../i18n/index.ts";

export function runtimeMessageLoadWorkbenchFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.loadWorkbenchFailed");
}

export function runtimeMessageRefreshWorkbenchFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.refreshWorkbenchFailed");
}

export function runtimeMessageLoadGovernanceFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.loadGovernanceFailed");
}

export function runtimeMessageGovernanceIndexNotReady(): string {
  return t("frontstage.workbench.knowledgeUniverse.governance.indexNotReady");
}

export function runtimeMessageGovernanceTaskUpdateFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.governanceTaskUpdateFailed");
}

export function runtimeMessageLoadIssueGraphFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.loadIssueGraphFailed");
}

export function runtimeMessageSearchWorkspaceFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.searchWorkspaceFailed");
}

export function runtimeMessageLoadNodeDetailFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.loadNodeDetailFailed");
}

export function runtimeMessageCapabilityRequestFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.capabilityRequestFailed");
}

export function runtimeMessageEnterpriseAccessRequestFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.enterpriseAccessRequestFailed");
}

export function runtimeMessageLoadKnowledgeObjectFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.loadKnowledgeObjectFailed");
}

export function runtimeMessageGatewayStaleHint(): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.errors.gatewayStaleHint");
}

/** Map gateway/runtime errors to user-facing copy; never surface raw `unknown method:` text. */
export function runtimeMessageFromError(error: unknown, fallback: () => string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown method:\s*knowledge\./i.test(message)) {
    return runtimeMessageGatewayStaleHint();
  }
  return message.trim() ? message : fallback();
}

export function runtimeNoticeCapabilityAccessSubmitted(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.notices.capabilityAccessSubmitted", {
    title,
  });
}

export function runtimeNoticeEnterpriseAccessSubmitted(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.runtime.notices.enterpriseAccessSubmitted", {
    title,
  });
}

export function runtimeNoticeGovernanceClaimTruthAccepted(params: {
  subject?: string | null;
  value: string;
}): string {
  const subject =
    params.subject?.trim() ||
    t(
      "frontstage.workbench.knowledgeUniverse.governance.notices.claimTruthAcceptedFallbackSubject",
    );
  return t("frontstage.workbench.knowledgeUniverse.governance.notices.claimTruthAccepted", {
    subject,
    value: params.value,
  });
}

export function runtimeNoticeGovernanceClaimConflictDismissed(): string {
  return t("frontstage.workbench.knowledgeUniverse.governance.notices.claimConflictDismissed");
}

export function runtimeNoticeGovernanceTaskResolved(): string {
  return t("frontstage.workbench.knowledgeUniverse.governance.notices.taskResolved");
}

export function runtimeNoticeGovernanceTaskDismissed(): string {
  return t("frontstage.workbench.knowledgeUniverse.governance.notices.taskDismissed");
}

export function personalManageMessageLoadVersionsFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.manage.loadVersionsFailed");
}

export function personalManageNoticeTagsUpdated(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.manage.tagsUpdated");
}

export function personalManageMessageTagsUpdateFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.manage.tagsUpdateFailed");
}

export function personalManageMessageVersionCompareFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.manage.versionCompareFailed");
}
