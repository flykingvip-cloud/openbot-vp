import { t } from "../../i18n/index.ts";
import type { KnowledgeCompatWarningDto } from "../capability/knowledge-universe/endpoints.ts";

export function appendPersonalCompatWarnings(
  notice: string,
  warnings?: KnowledgeCompatWarningDto[] | null,
): string {
  if (!warnings?.length) {
    return notice;
  }
  return `${notice} ${warnings.map((item) => item.message).join(" ")}`.trim();
}

export function personalMessageKnowledgeBaseRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.knowledgeBaseRequired");
}

export function personalMessageCreateSpaceFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.workspace.errors.createFailed");
}

export function personalNoticeCollected(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.notices.collected");
}

export function personalNoticeUploaded(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.notices.uploaded");
}

export function personalNoticeWebCollected(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.notices.webCollected");
}

export function personalNoticeDatasetImported(count: number): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.notices.datasetImported", { count });
}

export function personalDatasetDefaultTitle(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.datasetDefaultTitle");
}

export function personalNoticeFileSelected(fileName: string): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.notices.fileSelected", { fileName });
}

export function personalMessageCollectFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.collectFailed");
}

export function personalMessageUnsupportedFileType(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.unsupportedFileType");
}

export function personalMessageReadFileFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.readFileFailed");
}

export function personalMessageSelectFileFirst(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.selectFileFirst");
}

export function personalMessageUploadFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.uploadFailed");
}

export function personalMessageUrlRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.urlRequired");
}

export function personalMessageNoteContentRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.note.errors.contentRequired");
}

export function personalMessageUrlBatchEmpty(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.url.errors.empty");
}

export function personalMessageUrlBatchInvalid(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.url.errors.invalid");
}

export function personalMessageUrlModeComingSoon(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.url.errors.modeComingSoon");
}

export function personalNoticeWebBatchImported(imported: number, failed: number): string {
  if (failed > 0) {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.url.notices.batchImportedWithFailed",
      {
        imported,
        failed,
      },
    );
  }
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.url.notices.batchImported", {
    imported,
  });
}

export function personalMessageDatasetEmpty(): string {
  return t("frontstage.workbench.knowledgeUniverse.personal.errors.datasetEmpty");
}

export function personalMessageBindSourceFailed(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.errors.bindFailed");
}

export function personalNoticeActiveSourceBound(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.notices.bound");
}

export function personalMessageActiveSourceEndpointRequired(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.errors.endpointRequired");
}

// NOTE: Restored to unblock the production build — `knowledge-universe.ts` still
// imports this (eagerly reached via app.ts). Re-added verbatim from HEAD without
// removing the in-flight refactor's new exports. Safe to drop once the importer
// stops using it.
export function libraryCreateDefaultQuickTitle(): string {
  return t("frontstage.workbench.knowledgeUniverse.libraryCreate.defaultQuickTitle");
}
