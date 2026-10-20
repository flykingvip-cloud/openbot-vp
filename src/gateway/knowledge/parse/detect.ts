/** 低于此字符数视为扫描/图片型 PDF，可进入视觉 OCR 路径。 */
export const SCANNED_PDF_MIN_TEXT_CHARS = 32;

export function pdfNeedsVisionOcr(localText: string, ocrEnabled?: boolean): boolean {
  if (ocrEnabled !== true) {
    return false;
  }
  return localText.trim().length < SCANNED_PDF_MIN_TEXT_CHARS;
}
