/**
 * Long clipboard text stays in the composer as a folded snippet.
 *
 * Count Unicode code points. Only the pasted chunk folds (not the accumulated
 * draft). The chip previews the first line; "show in text box" unfolds it back
 * into the textarea. On send, the full text joins the message body.
 */

export const PASTE_AS_ATTACHMENT_CHAR_THRESHOLD = 500;

export type ComposerPastePlan =
  | { kind: "files"; files: File[] }
  | { kind: "text-attachment"; text: string; charCount: number }
  | { kind: "text-attachment-and-files"; text: string; charCount: number; files: File[] }
  | { kind: "default" };

export function countPasteChars(text: string): number {
  return Array.from(text).length;
}

export function shouldPasteAsAttachment(
  text: string,
  threshold = PASTE_AS_ATTACHMENT_CHAR_THRESHOLD,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return countPasteChars(text) > threshold;
}

const MARKUP_CLIPBOARD_TYPES = new Set(["text/html", "text/rtf", "text/richtext"]);

export function isMarkupClipboardFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (MARKUP_CLIPBOARD_TYPES.has(mime)) {
    return true;
  }
  return /\.(html?|rtf)$/i.test(file.name);
}

export function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    return (doc.body?.innerText ?? "").replace(/\u00a0/g, " ");
  }
  return trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function readClipboardText(input: { getData: (type: string) => string }): string {
  const plain = input.getData("text/plain") || input.getData("text") || "";
  if (plain.trim()) {
    return plain;
  }
  return stripHtmlToPlainText(input.getData("text/html") || "");
}

function filterRealClipboardFiles(files: File[] | undefined): File[] {
  return (files ?? []).filter((file) => file.size > 0 && !isMarkupClipboardFile(file));
}

export function planComposerPaste(input: {
  files?: File[];
  text?: string;
  threshold?: number;
}): ComposerPastePlan {
  const text = input.text ?? "";
  const realFiles = filterRealClipboardFiles(input.files);
  // Long manuscript paste wins over incidental HTML/RTF clipboard files that
  // Word / browsers attach alongside text/plain. Real images/files are kept
  // alongside the text attachment instead of being dropped.
  if (shouldPasteAsAttachment(text, input.threshold)) {
    if (realFiles.length > 0) {
      return {
        kind: "text-attachment-and-files",
        text,
        charCount: countPasteChars(text),
        files: realFiles,
      };
    }
    return { kind: "text-attachment", text, charCount: countPasteChars(text) };
  }
  if (realFiles.length > 0) {
    return { kind: "files", files: realFiles };
  }
  return { kind: "default" };
}

export function buildPastedTextFileName(now = Date.now(), prefix = "粘贴内容"): string {
  const d = new Date(now);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}.txt`;
}

export function createPastedTextFile(text: string, fileName: string, now = Date.now()): File {
  return new File([text], fileName, { type: "text/plain", lastModified: now });
}

export function decodeDataUrlText(dataUrl: string): string | null {
  const match = /^data:([^,]*),(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  try {
    if (/;base64/i.test(meta)) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export function mergeRestoredPasteIntoDraft(draft: string, pasted: string): string {
  const current = draft.trimEnd();
  if (!current) {
    return pasted;
  }
  return `${current}\n\n${pasted}`;
}

/** First line, trimmed, with a hard character cap so the chip stays one row. */
export function foldedPastePreview(text: string, maxChars = 18): string {
  const firstLine = text.replace(/^\s+/, "").split(/\r?\n/, 1)[0] ?? "";
  const chars = Array.from(firstLine);
  if (chars.length <= maxChars) {
    return firstLine;
  }
  return `${chars.slice(0, maxChars).join("")}...`;
}

export function encodeTextDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return `data:text/plain;base64,${btoa(binary)}`;
}

export function expandFoldedPastesIntoMessage<T extends { source?: string; dataUrl: string }>(
  message: string,
  attachments: T[],
): { message: string; attachments: T[] } {
  const rest: T[] = [];
  let next = message;
  for (const attachment of attachments) {
    if (attachment.source !== "paste") {
      rest.push(attachment);
      continue;
    }
    const text = decodeDataUrlText(attachment.dataUrl);
    if (text == null) {
      rest.push(attachment);
      continue;
    }
    next = mergeRestoredPasteIntoDraft(next, text);
  }
  return { message: next, attachments: rest };
}
