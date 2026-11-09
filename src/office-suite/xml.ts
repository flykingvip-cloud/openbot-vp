/** Shared XML and OOXML helpers for the clean-room Office file engines. */

export function xmlEscape(value: string): string {
  return stripXmlIncompatible(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function stripXmlIncompatible(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code !== 0xfffe && code !== 0xffff)
    ) {
      out += char;
    }
  }
  return out;
}

export function columnIndex(letters: string): number {
  let index = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) {
      return -1;
    }
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

export function columnLetters(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function cellRef(row: number, col: number): string {
  return `${columnLetters(col)}${row + 1}`;
}

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) {
    return null;
  }
  const col = columnIndex(match[1] ?? "");
  const row = Number(match[2]) - 1;
  if (col < 0 || !Number.isFinite(row) || row < 0) {
    return null;
  }
  return { row, col };
}

const MACRO_PART =
  /(^|\/)(vbaProject\.bin|vbaData\.xml|vbaProjectSignature\.bin)$|xl\/macrosheets\//i;

export function isMacroPart(name: string): boolean {
  return MACRO_PART.test(name.replaceAll("\\", "/"));
}

/** Top-level element blocks. Nested copies of the same tag stay inside the parent block. */
export function splitTopLevel(xml: string, tags: string[]): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const found = findNextOpen(xml, tags, cursor);
    if (!found) {
      break;
    }
    const end = findMatchingClose(xml, found.index, found.tag);
    blocks.push(xml.slice(found.index, end));
    cursor = end;
  }
  return blocks;
}

function findNextOpen(
  xml: string,
  tags: string[],
  from: number,
): { index: number; tag: string } | null {
  let best = -1;
  let tag = "";
  for (const candidate of tags) {
    let search = from;
    while (search < xml.length) {
      const index = xml.indexOf(`<${candidate}`, search);
      if (index < 0) {
        break;
      }
      const boundary = xml[index + candidate.length + 1];
      if (
        boundary === ">" ||
        boundary === " " ||
        boundary === "/" ||
        boundary === "\n" ||
        boundary === "\r" ||
        boundary === "\t"
      ) {
        if (best < 0 || index < best) {
          best = index;
          tag = candidate;
        }
        break;
      }
      search = index + 1;
    }
  }
  return best < 0 ? null : { index: best, tag };
}

function findMatchingClose(xml: string, openIndex: number, tag: string): number {
  const openEnd = xml.indexOf(">", openIndex);
  if (openEnd < 0) {
    return xml.length;
  }
  if (xml[openEnd - 1] === "/") {
    return openEnd + 1;
  }
  const openToken = `<${tag}`;
  const closeToken = `</${tag}>`;
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < xml.length && depth > 0) {
    const nextOpen = xml.indexOf(openToken, cursor);
    const nextClose = xml.indexOf(closeToken, cursor);
    if (nextClose < 0) {
      return xml.length;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const boundary = xml[nextOpen + openToken.length];
      if (
        boundary === ">" ||
        boundary === " " ||
        boundary === "/" ||
        boundary === "\n" ||
        boundary === "\t"
      ) {
        depth += 1;
      }
      cursor = nextOpen + openToken.length;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeToken.length;
  }
  return cursor;
}

export function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function extractTagText(xml: string, tag: string): string[] {
  const texts: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    texts.push(decodeXml(match[1] ?? ""));
  }
  return texts;
}
