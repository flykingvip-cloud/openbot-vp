import { deflateSync, inflateSync } from "node:zlib";
import type { ParsedTtf } from "./ttf.js";

export type PdfPageSpec = {
  paragraphs: string[];
};

export type PdfFormField = {
  name: string;
  value: string;
};

export type PdfSpec = {
  title: string;
  pages?: PdfPageSpec[];
  paragraphs?: string[];
  formFields?: PdfFormField[];
};

export type PdfBuild = {
  bytes: Buffer;
  pageCount: number;
  missingGlyphs: string[];
  fontEmbedded: boolean;
};

type GlyphRun = {
  hex: string;
  text: string;
  width: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 12;

export function buildPdf(spec: PdfSpec, font: ParsedTtf | null): PdfBuild {
  const pages = normalizePages(spec);
  const fields = spec.formFields ?? [];
  if (fields.length > 0) {
    const last = pages[pages.length - 1];
    if (last) {
      last.paragraphs = [
        ...last.paragraphs,
        ...fields.map((field) => `${field.name}：${field.value}`),
      ];
    }
  }
  const missing = new Set<string>();
  const laid = pages.flatMap((page) => layoutPage(page.paragraphs, font, missing));
  const bytes = serializePdf({
    title: spec.title,
    pages: laid,
    fields,
    font,
  });
  return {
    bytes,
    pageCount: laid.length,
    missingGlyphs: [...missing],
    fontEmbedded: Boolean(font),
  };
}

export type ExtractedPdf = {
  pages: string[];
  fields: PdfFormField[];
};

export function extractPdf(bytes: Buffer): ExtractedPdf {
  const start = bytes.lastIndexOf("startxref");
  if (start < 0) {
    throw new Error("pdf has no xref");
  }
  const xrefOffset = Number(
    bytes
      .toString("latin1", start + 9, start + 40)
      .trim()
      .split(/\s+/)[0],
  );
  const xref = parseXref(bytes, xrefOffset);
  const trailerStart = bytes.indexOf("trailer", xrefOffset);
  const rootRef = Number(
    /\/Root\s+(\d+)\s+0\s+R/.exec(bytes.toString("latin1", trailerStart, trailerStart + 400))?.[1],
  );
  const catalog = objectBody(bytes, xref, rootRef);
  const pagesRef = Number(/\/Pages\s+(\d+)\s+0\s+R/.exec(catalog)?.[1]);
  const pagesBody = objectBody(bytes, xref, pagesRef);
  const kidsBody = /\/Kids\s*\[([^\]]*)\]/.exec(pagesBody)?.[1] ?? "";
  const pageRefs = [...kidsBody.matchAll(/(\d+)\s+0\s+R/g)].map((match) => Number(match[1]));
  const toUnicode = findToUnicode(bytes, xref);
  const texts: string[] = [];
  for (const pageRef of pageRefs) {
    const page = objectBody(bytes, xref, pageRef);
    const contentRef = Number(/\/Contents\s+(\d+)\s+0\s+R/.exec(page)?.[1]);
    if (!contentRef) {
      texts.push("");
      continue;
    }
    const stream = objectStream(bytes, xref, contentRef);
    texts.push(decodeContent(stream, toUnicode));
  }
  const fields: PdfFormField[] = [];
  const fieldRe = /\/T\s*(<[0-9A-Fa-f]+>|\([^)]*\))[\s\S]*?\/V\s*(<[0-9A-Fa-f]+>|\([^)]*\))/;
  for (const ref of xref.keys()) {
    const body = objectBody(bytes, xref, ref);
    if (!body.includes("/FT")) {
      continue;
    }
    const fieldMatch = fieldRe.exec(body);
    if (!fieldMatch) {
      continue;
    }
    fields.push({
      name: decodePdfString(fieldMatch[1] ?? ""),
      value: decodePdfString(fieldMatch[2] ?? ""),
    });
  }
  return { pages: texts, fields };
}

function normalizePages(spec: PdfSpec): PdfPageSpec[] {
  if (spec.pages && spec.pages.length > 0) {
    return spec.pages;
  }
  return [{ paragraphs: [spec.title, ...(spec.paragraphs ?? [])] }];
}

type LaidRun = { hex: string; y: number; text: string };
type LaidPage = { runs: LaidRun[] };

function layoutPage(
  paragraphs: string[],
  font: ParsedTtf | null,
  missing: Set<string>,
): LaidPage[] {
  const pages: LaidPage[] = [];
  let runs: LaidRun[] = [];
  let y = PAGE_HEIGHT - MARGIN - FONT_SIZE;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const nextPage = () => {
    if (runs.length > 0) {
      pages.push({ runs });
    }
    runs = [];
    y = PAGE_HEIGHT - MARGIN - FONT_SIZE;
  };
  for (const paragraph of paragraphs) {
    const wrapped = wrapParagraph(paragraph, font, maxWidth, missing);
    for (const line of wrapped) {
      if (y < MARGIN + FONT_SIZE) {
        nextPage();
      }
      runs.push({ hex: line.hex, y, text: line.text });
      y -= FONT_SIZE + 6;
    }
    y -= 6;
  }
  if (runs.length > 0) {
    pages.push({ runs });
  }
  if (pages.length === 0) {
    pages.push({ runs: [] });
  }
  return pages;
}

function wrapParagraph(
  paragraph: string,
  font: ParsedTtf | null,
  maxWidth: number,
  missing: Set<string>,
): GlyphRun[] {
  const lines: GlyphRun[] = [];
  let hex = "";
  let text = "";
  let width = 0;
  const push = () => {
    if (!text) {
      return;
    }
    lines.push({ hex, text, width });
    hex = "";
    text = "";
    width = 0;
  };
  for (const char of paragraph) {
    const advance = char.codePointAt(0)! > 255 ? FONT_SIZE : FONT_SIZE * 0.55;
    if (width + advance > maxWidth && text) {
      push();
    }
    const gid = glyphId(char, font, missing);
    hex += gid.toString(16).padStart(4, "0");
    text += char;
    width += advance;
  }
  push();
  return lines;
}

function glyphId(char: string, font: ParsedTtf | null, missing: Set<string>): number {
  const code = char.codePointAt(0) ?? 0;
  if (!font) {
    if (code > 127) {
      missing.add(char);
    }
    return code > 0xffff ? 0 : code;
  }
  const gid = font.unicodeToGid.get(code);
  if (!gid) {
    missing.add(char);
    return 0;
  }
  return gid;
}

function serializePdf(input: {
  title: string;
  pages: LaidPage[];
  fields: PdfFormField[];
  font: ParsedTtf | null;
}): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length;
  };
  const isCff = input.font?.outlineFormat === "opentype-cff";
  const fontFile = input.font
    ? add(
        streamObject(
          "<< /Length ",
          deflateSync(input.font.bytes),
          isCff ? " /Filter /FlateDecode /Subtype /OpenType >>" : " /Filter /FlateDecode >>",
        ),
      )
    : 0;
  const toUnicodeMap = new Map<number, string>();
  for (const page of input.pages) {
    for (const run of page.runs) {
      const chars = Array.from(run.text);
      for (let i = 0; i < chars.length; i += 1) {
        const gid = Number.parseInt(run.hex.slice(i * 4, i * 4 + 4), 16);
        const char = chars[i] ?? "";
        if (char && !toUnicodeMap.has(gid)) {
          toUnicodeMap.set(gid, char);
        }
      }
    }
  }
  const toUnicode = add(
    streamObject("<< /Length ", Buffer.from(buildToUnicode(toUnicodeMap), "latin1"), " >>"),
  );
  const descriptor = add(
    `<< /Type /FontDescriptor /FontName /OpenBotOffice /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700${
      fontFile ? ` /${isCff ? "FontFile3" : "FontFile2"} ${fontFile} 0 R` : ""
    } >>`,
  );
  const cidFont = add(
    `<< /Type /Font /Subtype /${isCff ? "CIDFontType0" : "CIDFontType2"} /BaseFont /OpenBotOffice /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 >>`,
  );
  const fontRef = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /OpenBotOffice /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  );
  const fieldRefs: number[] = [];
  for (const field of input.fields) {
    const fieldMissing = new Set<string>();
    const fieldHex = Array.from(field.value)
      .map((char) => glyphId(char, input.font, fieldMissing).toString(16).padStart(4, "0"))
      .join("");
    const appearance = add(
      streamObject(
        `<< /Type /XObject /Subtype /Form /BBox [0 0 230 22] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Length `,
        Buffer.from(`BT /F1 11 Tf 1 0 0 1 2 5 Tm <${fieldHex}> Tj ET`, "latin1"),
        " >>",
      ),
    );
    fieldRefs.push(
      add(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T ${pdfHexString(field.name)} /V ${pdfHexString(field.value)} /Rect [50 36 280 58] /F 4 /DA (/F1 11 Tf 0 g) /AP << /N ${appearance} 0 R >> >>`,
      ),
    );
  }
  const contentRefs: number[] = [];
  for (const page of input.pages) {
    const commands = ["BT", `/F1 ${FONT_SIZE} Tf`];
    for (const run of page.runs) {
      if (!run.hex) {
        continue;
      }
      commands.push(`1 0 0 1 ${MARGIN} ${run.y} Tm <${run.hex}> Tj`);
    }
    commands.push("ET");
    const stream = Buffer.from(commands.join("\n"), "latin1");
    contentRefs.push(add(streamObject("<< /Length ", stream, " >>")));
  }
  const pagesRef = objects.length + input.pages.length + 1;
  const pageRefs: number[] = [];
  for (let i = 0; i < input.pages.length; i += 1) {
    const annots =
      i === input.pages.length - 1 && fieldRefs.length > 0
        ? ` /Annots [${fieldRefs.map((ref) => `${ref} 0 R`).join(" ")}]`
        : "";
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentRefs[i]} 0 R /Resources << /Font << /F1 ${fontRef} 0 R >> >>${annots} >>`,
      ),
    );
  }
  const kids = pageRefs.map((ref) => `${ref} 0 R`).join(" ");
  const pagesObject = add(`<< /Type /Pages /Count ${pageRefs.length} /Kids [${kids}] >>`);
  if (pagesObject !== pagesRef) {
    throw new Error("pdf page tree id drifted");
  }
  const acro = fieldRefs.length
    ? ` /AcroForm << /Fields [${fieldRefs.map((ref) => `${ref} 0 R`).join(" ")}] /NeedAppearances false /DR << /Font << /F1 ${fontRef} 0 R >> >> >>`
    : "";
  const catalog = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R${acro} >>`);
  let pdf = Buffer.from("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n", "latin1");
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    const body = objects[i] ?? Buffer.alloc(0);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
  }
  const xrefAt = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(xref, "latin1")]);
}

function streamObject(prefix: string, data: Buffer, suffix: string): Buffer {
  return Buffer.concat([
    Buffer.from(`${prefix}${data.length}${suffix}\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

function buildToUnicode(map: Map<number, string>): string {
  const entries = [...map.entries()].filter(([, char]) => char);
  const chunks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const slice = entries.slice(i, i + 100);
    chunks.push(`${slice.length} beginbfchar`);
    for (const [gid, char] of slice) {
      const code = char.codePointAt(0) ?? 0;
      chunks.push(`<${gid.toString(16).padStart(4, "0")}> <${code.toString(16).padStart(4, "0")}>`);
    }
    chunks.push("endbfchar");
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

function pdfHexString(value: string): string {
  const bom = Buffer.from([0xfe, 0xff]);
  const body = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    body.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  return `<${Buffer.concat([bom, body]).toString("hex")}>`;
}

function decodePdfString(token: string): string {
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1);
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return bytes.swap16().toString("utf16le", 2);
    }
    return bytes.toString("latin1");
  }
  return token.slice(1, -1);
}

function parseXref(bytes: Buffer, offset: number): Map<number, number> {
  const text = bytes.toString("latin1", offset, offset + 400_000);
  const lines = text.split(/\r?\n/);
  const map = new Map<number, number>();
  let index = 1;
  let cursor = 0;
  if (lines[0]?.startsWith("xref")) {
    cursor = 1;
  }
  while (cursor < lines.length) {
    const head = lines[cursor] ?? "";
    if (head.startsWith("trailer")) {
      break;
    }
    const range = /^(\d+)\s+(\d+)$/.exec(head.trim());
    if (range) {
      index = Number(range[1]);
      const count = Number(range[2]);
      for (let n = 0; n < count; n += 1) {
        cursor += 1;
        const entry = lines[cursor] ?? "";
        if (entry.includes(" n")) {
          map.set(index, Number(entry.slice(0, 10)));
        }
        index += 1;
      }
    }
    cursor += 1;
  }
  return map;
}

function objectSlice(bytes: Buffer, xref: Map<number, number>, ref: number): Buffer {
  const start = xref.get(ref);
  if (start === undefined) {
    throw new Error(`missing pdf object ${ref}`);
  }
  const headerEnd = bytes.indexOf("\n", start);
  const next =
    [...xref.values()].filter((value) => value > start).toSorted((a, b) => a - b)[0] ??
    bytes.length;
  return bytes.subarray(headerEnd + 1, next);
}

function objectBody(bytes: Buffer, xref: Map<number, number>, ref: number): string {
  return objectSlice(bytes, xref, ref).toString("latin1");
}

function objectStream(bytes: Buffer, xref: Map<number, number>, ref: number): string {
  const raw = objectSlice(bytes, xref, ref);
  const marker = Buffer.from("stream\n", "latin1");
  const start = raw.indexOf(marker);
  if (start < 0) {
    return raw.toString("latin1");
  }
  const dict = raw.subarray(0, start).toString("latin1");
  const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? 0);
  const data = raw.subarray(start + marker.length, start + marker.length + length);
  if (dict.includes("/FlateDecode")) {
    return inflateSync(data).toString("latin1");
  }
  return data.toString("latin1");
}

function findToUnicode(bytes: Buffer, xref: Map<number, number>): Map<number, string> {
  const map = new Map<number, string>();
  for (const ref of xref.keys()) {
    const body = objectBody(bytes, xref, ref);
    if (!body.includes("beginbfchar")) {
      continue;
    }
    const stream = objectStream(bytes, xref, ref);
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(stream))) {
      const gid = Number.parseInt(match[1] ?? "", 16);
      const code = Number.parseInt(match[2] ?? "", 16);
      if (Number.isFinite(gid) && Number.isFinite(code)) {
        map.set(gid, String.fromCodePoint(code));
      }
    }
  }
  return map;
}

function decodeContent(stream: string, toUnicode: Map<number, string>): string {
  const lines: string[] = [];
  const re = /<([0-9A-Fa-f]+)>\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stream))) {
    const hex = match[1] ?? "";
    let text = "";
    for (let i = 0; i < hex.length; i += 4) {
      const gid = Number.parseInt(hex.slice(i, i + 4), 16);
      text += toUnicode.get(gid) ?? "";
    }
    lines.push(text);
  }
  return lines.join("\n");
}
