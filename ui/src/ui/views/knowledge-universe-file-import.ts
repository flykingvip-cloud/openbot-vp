import type { PersonalDocumentUploadAttachment } from "../capability/knowledge-universe/personal-document-upload.ts";

export const SPACE_FILE_IMPORT_ACCEPT =
  ".pdf,.doc,.docx,.md,.markdown,.txt,.csv,.xls,.xlsx,.ppt,.pptx";

export const SPACE_FILE_IMPORT_MAX_FILES = 20;
export const SPACE_FILE_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

export type FileChunkingStrategy = "auto" | "paragraph" | "fixed";

export type FileImportQueueStatus = "ready" | "uploading" | "done" | "error";

export type FileImportQueueItem = {
  id: string;
  attachment: PersonalDocumentUploadAttachment;
  status: FileImportQueueStatus;
  errorMessage?: string;
};

export function formatImportFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createEmptyFileImportState() {
  return {
    libraryWorkspaceFileImportItems: [] as FileImportQueueItem[],
    libraryWorkspaceFileImportAdvancedOpen: false,
    libraryWorkspaceFileChunkingStrategy: "auto" as FileChunkingStrategy,
    libraryWorkspaceFileOcrEnabled: true,
  };
}

export function countReadyFileImportItems(items: FileImportQueueItem[]): number {
  return items.filter((item) => item.status === "ready").length;
}
