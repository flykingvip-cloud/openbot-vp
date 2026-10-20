export type { PersonalDocumentUploadAttachment } from "../../../../../src/gateway/knowledge/personal-document-upload.ts";
export {
  isSupportedPersonalDocument,
  MAX_FOLDER_UPLOAD_FILES,
  readPersonalDocumentUpload,
  readPersonalDocumentUploadFolder,
} from "../../../../../src/gateway/knowledge/personal-document-upload.ts";

export const PERSONAL_DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif";
