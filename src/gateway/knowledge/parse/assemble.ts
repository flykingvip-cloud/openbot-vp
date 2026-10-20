/** 合并多页视觉 OCR 结果为单一文档文本。 */
export function assembleVisionPageTexts(pageTexts: readonly string[]): string {
  return pageTexts
    .map((page) => page.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
