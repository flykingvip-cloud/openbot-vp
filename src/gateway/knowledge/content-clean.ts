/**
 * Normalize extracted document text before semantic fingerprinting.
 * Strips export noise (timestamps, page numbers, repeated headers/footers).
 */

const ISO_TIMESTAMP =
  /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_TIMESTAMP = /\b\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}(?::\d{2})?\b/g;
const PAGE_NUMBER_EN = /\bpage\s+\d+\s+of\s+\d+\b/gi;
const PAGE_NUMBER_ZH = /第\s*\d+\s*页(?:\s*\/\s*\d+\s*页)?/g;
const STANDALONE_PAGE = /^\s*-\s*\d+\s*-\s*$/gm;

export function cleanKnowledgeDocumentText(rawText: string): string {
  let text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text
    .replace(ISO_TIMESTAMP, " ")
    .replace(ISO_DATE, " ")
    .replace(SLASH_TIMESTAMP, " ")
    .replace(PAGE_NUMBER_EN, " ")
    .replace(PAGE_NUMBER_ZH, " ")
    .replace(STANDALONE_PAGE, "\n");

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 3) {
    return lines.join("\n").replace(/\s+/g, " ").trim();
  }

  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const filtered = lines.filter((line) => {
    const count = counts.get(line) ?? 0;
    if (count >= 3 && line.length <= 120) {
      return false;
    }
    return true;
  });

  return filtered.join("\n").replace(/\s+/g, " ").trim();
}
