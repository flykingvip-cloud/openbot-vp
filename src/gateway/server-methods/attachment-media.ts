import { saveMediaBuffer } from "../../media/store.js";
import {
  DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES,
  DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES,
  type ChatFileContent,
  type ChatImageContent,
} from "../chat-attachments.js";

type AttachmentMediaLog = {
  warn?: (message: string) => void;
};

export async function stageImagesAsMediaAttachmentNotes(params: {
  images: ChatImageContent[];
  files?: ChatFileContent[];
  runId: string;
  log: AttachmentMediaLog;
  label?: string;
}): Promise<string | undefined> {
  const lines: string[] = [];
  const label = params.label ?? "agent";

  for (const [index, image] of params.images.entries()) {
    try {
      const saved = await saveMediaBuffer(
        Buffer.from(image.data, "base64"),
        image.mimeType,
        "webchat-uploads",
        DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES,
        image.fileName || `${label}-image-${index + 1}`,
      );
      const prefix =
        params.images.length > 1
          ? `[media attached ${index + 1}/${params.images.length}: `
          : "[media attached: ";
      lines.push(`${prefix}${saved.path} (${saved.contentType ?? image.mimeType})]`);
    } catch (err) {
      params.log.warn?.(
        `${label} image media staging failed run=${params.runId} image=${index + 1}: ${String(err)}`,
      );
    }
  }

  for (const [index, file] of (params.files ?? []).entries()) {
    try {
      const saved = await saveMediaBuffer(
        Buffer.from(file.data, "base64"),
        file.mimeType,
        "webchat-uploads",
        DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES,
        file.fileName || `${label}-file-${index + 1}`,
      );
      const prefix =
        (params.files?.length ?? 0) > 1
          ? `[file attached ${index + 1}/${params.files?.length}: `
          : "[file attached: ";
      lines.push(
        `${prefix}${saved.path} (${saved.contentType ?? file.mimeType}) — prefer this path for structured Office/PDF work; do not ask the user to re-upload]`,
      );
    } catch (err) {
      params.log.warn?.(
        `${label} file media staging failed run=${params.runId} file=${file.fileName}: ${String(err)}`,
      );
    }
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}
