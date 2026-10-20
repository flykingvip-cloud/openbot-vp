/**
 * Provider vision inputs accept png, jpeg, gif, and webp only.
 * A 400 for any other bytes is a soft turn failure: explain it in the thread.
 * The live screenshot's `request_id: sha256:…` is a redacted request id, not an
 * image-byte digest — keep a separate content digest when we drop bytes.
 */

export const UNSUPPORTED_IMAGE_DIALOGUE = [
  "这张图片没有送进模型。当前模型接受的图片格式是 png、jpeg、gif 和 webp。",
  "下一步可以二选一：去掉这张附件后重新发送，或把图片另存为 png / jpeg 再上传。",
].join("\n\n");

const UNSUPPORTED_IMAGE_API_RE = /unsupported image/i;

/**
 * True for the provider 400 and for the dialogue we substitute for it.
 * Requires the format list so a casual mention of "unsupported image" does not match.
 */
export function isUnsupportedImageSoftFailure(raw: string | null | undefined): boolean {
  if (!raw) {
    return false;
  }
  const text = raw.trim();
  if (!text) {
    return false;
  }
  if (text.includes(UNSUPPORTED_IMAGE_DIALOGUE)) {
    return true;
  }
  if (!UNSUPPORTED_IMAGE_API_RE.test(text)) {
    return false;
  }
  const lower = text.toLowerCase();
  return (
    lower.includes("webp") &&
    lower.includes("png") &&
    (lower.includes("jpeg") || lower.includes("jpg")) &&
    lower.includes("gif")
  );
}
