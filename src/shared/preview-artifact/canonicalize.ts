/** Normalize preview / artifact body text before hashing or blob storage. */
export function canonicalizePreviewText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
