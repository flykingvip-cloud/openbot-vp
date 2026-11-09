import JSZip from "jszip";
import { extractTagText, isMacroPart, splitTopLevel, xmlEscape } from "./xml.js";

export type DocxParagraph = {
  text: string;
  style?: "title" | "heading" | "body";
};

export type DocxTable = {
  headers: string[];
  rows: string[][];
};

export type DocxBlock = ({ type: "paragraph" } & DocxParagraph) | ({ type: "table" } & DocxTable);

export type DocxSpec = {
  blocks: DocxBlock[];
};

export type DocxEdit = {
  paragraphIndex: number;
  text?: string;
  tracked?: boolean;
  author?: string;
  comment?: string;
};

export type DocxRead = {
  paragraphs: string[];
  tables: string[][][];
  comments: string[];
  insertions: string[];
  deletions: string[];
  macrosPresent: boolean;
};

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function buildDocx(spec: DocxSpec): Promise<Buffer> {
  const zip = new JSZip();
  const blocks = spec.blocks.map((block) => renderBlock(block)).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${blocks}${sectPr()}</w:body></w:document>`,
  );
  addPackage(zip, false);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function readDocx(buffer: Buffer): Promise<DocxRead> {
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file("word/document.xml")?.async("string");
  if (!document) {
    throw new Error("docx is missing word/document.xml");
  }
  const { blocks } = splitDocument(document);
  const paragraphs: string[] = [];
  const tables: string[][][] = [];
  for (const block of blocks) {
    if (block.includes("<w:tbl")) {
      tables.push(readTable(block));
      continue;
    }
    paragraphs.push(visibleText(block));
  }
  const commentsXml = await zip.file("word/comments.xml")?.async("string");
  return {
    paragraphs,
    tables,
    comments: commentsXml ? extractTagText(commentsXml, "w:t") : [],
    insertions: extractTagText(document, "w:t").length ? extractInserted(document) : [],
    deletions: extractTagText(document, "w:delText"),
    macrosPresent: Object.keys(zip.files).some((name) => isMacroPart(name)),
  };
}

export async function editDocx(buffer: Buffer, edit: DocxEdit): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    if (isMacroPart(name)) {
      zip.remove(name);
    }
  }
  const document = await zip.file("word/document.xml")?.async("string");
  if (!document) {
    throw new Error("docx is missing word/document.xml");
  }
  const parts = splitDocument(document);
  const paragraphIndexes = parts.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => !entry.block.includes("<w:tbl"));
  const target = paragraphIndexes[edit.paragraphIndex];
  if (!target) {
    throw new Error(`paragraph ${edit.paragraphIndex} is outside this document`);
  }
  let next = target.block;
  if (edit.text !== undefined) {
    next = replaceParagraphText(
      next,
      edit.text,
      Boolean(edit.tracked),
      edit.author?.trim() || "OpenBot",
    );
  }
  if (edit.comment?.trim()) {
    next = addCommentMarkers(next, 0);
    const comments = commentPart(edit.comment.trim(), edit.author?.trim() || "OpenBot");
    zip.file("word/comments.xml", comments);
    await ensureCommentRels(zip);
  }
  const blocks = parts.blocks.slice();
  blocks[target.index] = next;
  zip.file("word/document.xml", `${parts.preamble}${blocks.join("")}${parts.sect}${parts.close}`);
  if (edit.tracked) {
    zip.file(
      "word/settings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}"><w:trackRevisions/></w:settings>`,
    );
    await ensureOverride(
      zip,
      "/word/settings.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function estimateDocxPages(spec: DocxSpec): number {
  const usable = 16838 - 1134 * 2;
  let used = 0;
  for (const block of spec.blocks) {
    if (block.type === "paragraph") {
      const lines = Math.max(1, Math.ceil(block.text.length / 38));
      used += lines * 360;
      continue;
    }
    used += (block.rows.length + 1) * 420;
  }
  return Math.max(1, Math.ceil(used / usable));
}

function renderBlock(block: DocxBlock): string {
  if (block.type === "table") {
    const headers = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.headers.map((header) => tableCell(header, true)).join("")}</w:tr>`;
    const rows = block.rows
      .map((row) => `<w:tr>${row.map((cell) => tableCell(cell, false)).join("")}</w:tr>`)
      .join("");
    const cols = Math.max(block.headers.length, 1);
    const width = Math.floor(9000 / cols);
    const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headers}${rows}</w:tbl>`;
  }
  const style =
    block.style === "title" ? "Title" : block.style === "heading" ? "Heading1" : "Normal";
  return paragraphXml(block.text, style);
}

function paragraphXml(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableCell(text: string, header: boolean): string {
  const bold = header ? "<w:b/>" : "";
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:rPr>${bold}<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function sectPr(): string {
  return `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
}

function addPackage(zip: JSZip, comments: boolean): void {
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${comments ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` : ""}
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file("word/styles.xml", stylesXml());
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="14212B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="14212B"/></w:rPr></w:style>
</w:styles>`;
}

function splitDocument(documentXml: string): {
  preamble: string;
  blocks: string[];
  sect: string;
  close: string;
} {
  const bodyStart = documentXml.indexOf("<w:body");
  if (bodyStart < 0) {
    throw new Error("docx has no body");
  }
  const openEnd = documentXml.indexOf(">", bodyStart);
  const bodyEnd = documentXml.lastIndexOf("</w:body>");
  const inner = documentXml.slice(openEnd + 1, bodyEnd);
  const sectAt = inner.lastIndexOf("<w:sectPr");
  const sect = sectAt >= 0 ? inner.slice(sectAt) : "";
  const content = sectAt >= 0 ? inner.slice(0, sectAt) : inner;
  return {
    preamble: documentXml.slice(0, openEnd + 1),
    blocks: splitTopLevel(content, ["w:p", "w:tbl"]),
    sect,
    close: documentXml.slice(bodyEnd),
  };
}

function visibleText(block: string): string {
  const withoutDeleted = block.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return extractTagText(withoutDeleted, "w:t").join("");
}

function extractInserted(documentXml: string): string[] {
  const inserted: string[] = [];
  const re = /<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(documentXml))) {
    inserted.push(extractTagText(match[1] ?? "", "w:t").join(""));
  }
  return inserted.filter(Boolean);
}

function readTable(block: string): string[][] {
  return splitTopLevel(block, ["w:tr"]).map((row) =>
    splitTopLevel(row, ["w:tc"]).map((cell) => extractTagText(cell, "w:t").join("")),
  );
}

function replaceParagraphText(
  block: string,
  text: string,
  tracked: boolean,
  author: string,
): string {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(block)?.[0] ?? "";
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(block)?.[0] ?? "";
  const old = visibleText(block);
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (!tracked) {
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }
  return `<w:p>${pPr}<w:del w:id="1" w:author="${xmlEscape(author)}" w:date="${date}"><w:r>${rPr}<w:delText xml:space="preserve">${xmlEscape(old)}</w:delText></w:r></w:del><w:ins w:id="2" w:author="${xmlEscape(author)}" w:date="${date}"><w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:ins></w:p>`;
}

function addCommentMarkers(block: string, id: number): string {
  const close = block.lastIndexOf("</w:p>");
  const mark = `<w:commentRangeStart w:id="${id}"/>`;
  const end = `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
  if (block.startsWith("<w:p")) {
    const openEnd = block.indexOf(">");
    return `${block.slice(0, openEnd + 1)}${mark}${block.slice(openEnd + 1, close)}${end}${block.slice(close)}`;
  }
  return block;
}

function commentPart(text: string, author: string): string {
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="${xmlEscape(author)}" w:date="${date}" w:initials="OB"><w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:comment></w:comments>`;
}

async function ensureCommentRels(zip: JSZip): Promise<void> {
  await ensureOverride(
    zip,
    "/word/comments.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  );
  const relsPath = "word/_rels/document.xml.rels";
  const rels = (await zip.file(relsPath)?.async("string")) ?? "";
  if (rels.includes("/comments")) {
    return;
  }
  const next = rels.includes("</Relationships>")
    ? rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
      )
    : rels;
  zip.file(relsPath, next);
}

async function ensureOverride(zip: JSZip, partName: string, contentType: string): Promise<void> {
  const xml = await zip.file("[Content_Types].xml")?.async("string");
  if (!xml || xml.includes(`PartName="${partName}"`)) {
    return;
  }
  zip.file(
    "[Content_Types].xml",
    xml.replace(
      "</Types>",
      `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`,
    ),
  );
}
