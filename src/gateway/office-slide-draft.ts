/** Slide text draft used by PPTX preview edit and workspace write-back. */

export type OfficeSlideText = {
  index: number;
  lines: string[];
};

const PAGE_HEADER = /^#\s*第\s*(\d+)\s*页\s*$/;

export function formatOfficeSlideDraft(slides: OfficeSlideText[]): string {
  return slides
    .map((slide) => [`# 第 ${slide.index} 页`, ...slide.lines].join("\n"))
    .join("\n\n")
    .trim();
}

export function parseOfficeSlidesInput(value: unknown): OfficeSlideText[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const slides: OfficeSlideText[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const index = Number(record.index);
    if (!Number.isFinite(index) || index < 1) {
      continue;
    }
    const lines = Array.isArray(record.lines)
      ? record.lines
          .filter((line): line is string => typeof line === "string")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
    slides.push({ index, lines });
  }
  return slides.length > 0 ? slides : null;
}

export function parseOfficeSlideDraft(text: string): OfficeSlideText[] {
  const slides: OfficeSlideText[] = [];
  let current: OfficeSlideText | null = null;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const header = PAGE_HEADER.exec(raw.trim());
    if (header) {
      current = { index: Number(header[1]), lines: [] };
      slides.push(current);
      continue;
    }
    if (!current) {
      current = { index: 1, lines: [] };
      slides.push(current);
    }
    const line = raw.trim();
    if (line) {
      current.lines.push(line);
    }
  }
  return slides.filter((slide) => Number.isFinite(slide.index) && slide.index > 0);
}

export function isPptxWorkspaceFilename(filename?: string | null): boolean {
  return /\.pptx$/i.test((filename ?? "").trim());
}
