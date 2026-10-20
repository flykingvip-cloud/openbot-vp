/**
 * Extract and patch slide text inside a PPTX (OOXML) package.
 * Preview edit writes these strings back into the same <a:t> runs so the
 * workspace .pptx — not just the HTML preview — changes.
 */
import JSZip from "jszip";
import type { OfficeSlideText } from "./office-slide-draft.js";

export type { OfficeSlideText };
export {
  formatOfficeSlideDraft,
  isPptxWorkspaceFilename,
  parseOfficeSlideDraft,
  parseOfficeSlidesInput,
} from "./office-slide-draft.js";

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/i;
const TEXT_RUN = /<a:t([^>]*)>([\s\S]*?)<\/a:t>/g;

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function listSlidePaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((entry) => SLIDE_PATH.test(entry) && !zip.files[entry]?.dir)
    .toSorted((left, right) => {
      const na = Number(left.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(right.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });
}

export function extractTextNodesFromSlideXml(xml: string): string[] {
  const lines: string[] = [];
  TEXT_RUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEXT_RUN.exec(xml))) {
    const text = decodeXmlText(match[2] ?? "");
    if (text) {
      lines.push(text);
    }
  }
  return lines;
}

function replaceSlideTextXml(xml: string, lines: string[]): string {
  const next = lines.map((line) => line.trim()).filter(Boolean);
  TEXT_RUN.lastIndex = 0;
  const hits: Array<{ index: number; length: number; attrs: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = TEXT_RUN.exec(xml))) {
    if (!decodeXmlText(match[2] ?? "")) {
      continue;
    }
    hits.push({ index: match.index, length: match[0].length, attrs: match[1] ?? "" });
  }

  if (hits.length === 0) {
    if (next.length === 0) {
      return xml;
    }
    const extras = next
      .map((line) => `<a:p><a:r><a:t>${escapeXmlText(line)}</a:t></a:r></a:p>`)
      .join("");
    const close = xml.lastIndexOf("</p:sld>");
    if (close >= 0) {
      return `${xml.slice(0, close)}${extras}${xml.slice(close)}`;
    }
    return `${xml}${extras}`;
  }

  let out = "";
  let cursor = 0;
  const shared = Math.min(hits.length, next.length);
  for (let i = 0; i < shared; i += 1) {
    const hit = hits[i];
    out += xml.slice(cursor, hit.index);
    out += `<a:t${hit.attrs}>${escapeXmlText(next[i])}</a:t>`;
    cursor = hit.index + hit.length;
  }
  if (next.length < hits.length) {
    for (let i = shared; i < hits.length; i += 1) {
      const hit = hits[i];
      out += xml.slice(cursor, hit.index);
      cursor = hit.index + hit.length;
    }
    return `${out}${xml.slice(cursor)}`;
  }
  const extras = next.slice(hits.length);
  if (extras.length > 0) {
    out += extras.map((line) => `<a:p><a:r><a:t>${escapeXmlText(line)}</a:t></a:r></a:p>`).join("");
  }
  return `${out}${xml.slice(cursor)}`;
}

export async function extractPptxSlides(buffer: Buffer): Promise<OfficeSlideText[] | null> {
  try {
    if (!buffer?.length) {
      return null;
    }
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = listSlidePaths(zip);
    if (slidePaths.length === 0) {
      return null;
    }
    const slides: OfficeSlideText[] = [];
    for (const slidePath of slidePaths) {
      const xml = await zip.files[slidePath]?.async("string");
      if (!xml) {
        continue;
      }
      slides.push({
        index: Number(slidePath.match(/slide(\d+)\.xml$/i)?.[1] ?? slides.length + 1),
        lines: extractTextNodesFromSlideXml(xml),
      });
    }
    return slides.length > 0 ? slides : null;
  } catch {
    return null;
  }
}

export async function patchPptxSlideTexts(
  buffer: Buffer,
  slides: OfficeSlideText[],
): Promise<Buffer | null> {
  try {
    if (!buffer?.length) {
      return null;
    }
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = listSlidePaths(zip);
    if (slidePaths.length === 0) {
      return null;
    }
    const byIndex = new Map(slides.map((slide) => [slide.index, slide.lines] as const));
    let wrote = false;
    for (const slidePath of slidePaths) {
      const xml = await zip.files[slidePath]?.async("string");
      if (!xml) {
        continue;
      }
      const index = Number(slidePath.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const lines = byIndex.get(index);
      if (!lines) {
        continue;
      }
      zip.file(slidePath, replaceSlideTextXml(xml, lines));
      wrote = true;
    }
    if (!wrote) {
      return null;
    }
    return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  } catch {
    return null;
  }
}
