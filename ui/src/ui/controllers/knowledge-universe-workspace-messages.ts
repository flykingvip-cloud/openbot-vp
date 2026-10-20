import { t } from "../../i18n/index.ts";

export function isDeliverablesUserContextError(message: string): boolean {
  return /user context required/i.test(message);
}

export function resolveWorkspaceLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not authorized/i.test(message)) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.errors.loadForbidden");
  }
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.loadFailed");
}

export function workspaceMessageCreateEmptyTitle(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.createEmptyTitle");
}

export function workspaceMessageSelectLibraryFirst(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.selectLibraryFirst");
}

export function workspaceMessageKbSearchEmpty(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.kbSearchEmpty");
}

export function workspaceMessageKbSearchFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.kbSearchFailed");
}

export function workspaceMessageCreateFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.createFailed");
}

export function workspaceMessageArchiveSelectLibrary(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.archiveSelectLibrary");
}

export function workspaceMessageArchiveFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.archiveFailed");
}

export function workspaceNoticeInviteComingSoon(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.inviteComingSoon");
}

export function workspaceNoticeInviteSent(email: string): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.inviteSent", { email });
}

export function workspaceMessageInviteEmailRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.inviteEmailRequired");
}

export function workspaceMessageInviteFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.inviteFailed");
}

export function workspaceNoticeTabActionComingSoon(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.tabActionComingSoon");
}

export function workspaceNoticeImportReadOnly(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.readOnlyNotice");
}

export function workspaceNoticeDocumentDetached(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeDetached");
}

export function workspaceNoticeDocumentRestored(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeRestored");
}

export function workspaceNoticeDocumentDeleted(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeDeleted");
}

export function workspaceNoticeSourceIngested(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeSourceIngested");
}

export function workspaceMessageIngestFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.ingestSourceFailed");
}

export function workspaceNoticeDeliverableDeleted(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.deliverableDeleted", {
    title:
      title.trim() || t("frontstage.workbench.knowledgeUniverse.workspace.deliverableFallback"),
  });
}

export function workspaceMessageDetachSelectLibrary(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.detachSelectLibrary");
}

export function workspaceMessageDetachFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.detachFailed");
}

export function workspaceMessageRestoreFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.restoreFailed");
}

export function workspaceNoticeCreated(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.created", { title });
}

export function workspaceNoticeRenamed(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.renamed", { title });
}

export function workspaceNoticeDeleted(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.deleted", { title });
}

export function workspaceMessageRenameEmptyTitle(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.renameEmptyTitle");
}

export function workspaceMessageRenameFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.renameFailed");
}

export function workspaceMessageDeleteSelectLibrary(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.deleteSelectLibrary");
}

export function workspaceMessageDeleteConfirmRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.deleteConfirmRequired");
}

export function workspaceMessageDeleteFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.deleteFailed");
}

export function workspaceNoticeArchived(libraryTitle?: string): string {
  if (libraryTitle) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.notices.archivedToLibrary", {
      library: libraryTitle,
    });
  }
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.archived");
}

export function workspaceNoticeArchivedWithRag(libraryTitle: string, hitCount: number): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.archivedRagVerified", {
    library: libraryTitle,
    count: hitCount,
  });
}

export function workspaceNoticeKbSearchIndexed(count: number): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.kbSearchIndexed", { count });
}

export function workspaceNoticeKbSearchSubstring(count: number): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.kbSearchSubstring", {
    count,
  });
}

export function workspaceNoticeRelationsOpened(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.relationsOpened", { title });
}

export function workspaceNoticeAssignExpert(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.assignExpert", { title });
}

export function workspaceNoticeNoGovernanceTask(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.noGovernanceTask", { title });
}

export function workspaceNoticeMarkInvalid(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.markInvalid", { title });
}

export function workspaceNoticeMarkInvalidManual(title: string): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.notices.markInvalidManual", { title });
}
