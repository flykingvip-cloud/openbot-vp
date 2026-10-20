import JSZip from "jszip";

export const DATASET_IMPORT_ACCEPT = ".xlsx,.csv";
export const DATASET_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const DATASET_IMPORT_PREVIEW_ROW_LIMIT = 5;

export type DatasetImportTab = "file" | "manual";

export type DatasetImportPreview = {
  headers: string[];
  rows: string[][];
  totalRowCount: number;
  truncated: boolean;
};

export function isDatasetImportFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || name.endsWith(".xlsx") || file.type.includes("csv");
}

export function validateDatasetImportFile(file: File): string | null {
  if (!isDatasetImportFile(file)) {
    return "Only .xlsx and .csv files are supported.";
  }
  if (file.size > DATASET_IMPORT_MAX_BYTES) {
    return "File exceeds the 50MB limit.";
  }
  return null;
}

function parseDelimitedTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((entry) => entry.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((entry) => entry.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function parseXmlDocument(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${label} parse failed.`);
  }
  return document;
}

function xmlTextContent(element: Element, tagName: string) {
  const target = element.getElementsByTagName(tagName)[0];
  return target?.textContent ?? "";
}

function readXlsxSharedStrings(document: Document): string[] {
  return Array.from(document.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function resolveXlsxSheetPath(workbook: Document, relationships: Document): string {
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relationshipId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttribute("id");
  const relationship = relationshipId
    ? Array.from(relationships.getElementsByTagName("Relationship")).find(
        (entry) => entry.getAttribute("Id") === relationshipId,
      )
    : null;
  const target = relationship?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const normalized = target.replace(/^\/+/, "").replace(/^\.\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function xlsxColumnIndex(cellRef: string) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  if (!letters) {
    return -1;
  }
  return Array.from(letters).reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function readXlsxCell(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
  }
  const value = xmlTextContent(cell, "v").trim();
  if (type === "s") {
    const sharedIndex = Number.parseInt(value, 10);
    return Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "";
  }
  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }
  return value;
}

type XlsxZipFile = {
  async(type: "string"): Promise<string>;
};

type XlsxZipArchive = {
  file(path: string): XlsxZipFile | null;
};

export async function parseDatasetXlsxTable(file: File): Promise<string[][]> {
  const zip = (await JSZip.loadAsync(await file.arrayBuffer())) as XlsxZipArchive;
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipFile) {
    throw new Error("Excel file is missing workbook metadata.");
  }
  const workbook = parseXmlDocument(await workbookFile.async("string"), "Workbook");
  const relationships = parseXmlDocument(await relationshipFile.async("string"), "Relationships");
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? readXlsxSharedStrings(parseXmlDocument(await sharedStringsFile.async("string"), "Strings"))
    : [];
  const sheetPath = resolveXlsxSheetPath(workbook, relationships);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    throw new Error("Excel file is missing the first worksheet.");
  }
  const sheet = parseXmlDocument(await sheetFile.async("string"), "Worksheet");
  return Array.from(sheet.getElementsByTagName("row"))
    .map((rowElement) => {
      const row: string[] = [];
      Array.from(rowElement.getElementsByTagName("c")).forEach((cell) => {
        const columnIndex = xlsxColumnIndex(cell.getAttribute("r") ?? "");
        row[columnIndex >= 0 ? columnIndex : row.length] = readXlsxCell(cell, sharedStrings);
      });
      return row.map((entry) => entry ?? "");
    })
    .filter((row) => row.some((entry) => entry.length > 0));
}

export async function parseDatasetImportTable(file: File): Promise<string[][]> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".csv") || file.type.includes("csv")) {
    return parseDelimitedTable(await file.text(), ",");
  }
  if (fileName.endsWith(".xlsx")) {
    return parseDatasetXlsxTable(file);
  }
  throw new Error("Only .xlsx and .csv files are supported.");
}

function detectDelimiter(headerLine: string): string | null {
  if (headerLine.includes("\t")) {
    return "\t";
  }
  if (headerLine.includes(",")) {
    return ",";
  }
  return null;
}

export function parseDatasetManualTable(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trimEnd());
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return [];
  }
  const delimiter = detectDelimiter(nonEmpty[0] ?? "");
  if (delimiter) {
    return parseDelimitedTable(trimmed, delimiter);
  }
  return nonEmpty.map((line) => [line.trim()]);
}

function looksLikeHeaderRow(row: string[]): boolean {
  if (row.length < 2) {
    return false;
  }
  const joined = row.join(" ").toLowerCase();
  return (
    joined.includes("title") ||
    joined.includes("content") ||
    joined.includes("内容") ||
    row.every((cell) => cell.length > 0 && !/^\d+(\.\d+)?$/.test(cell))
  );
}

export function buildDatasetImportPreview(table: string[][]): DatasetImportPreview | null {
  const normalized = table
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (normalized.length === 0) {
    return null;
  }
  const singleColumn = normalized.every((row) => row.length <= 1);
  if (singleColumn) {
    const rows = normalized.map((row) => [row[0] ?? ""]);
    return {
      headers: ["content"],
      rows: rows.slice(0, DATASET_IMPORT_PREVIEW_ROW_LIMIT),
      totalRowCount: rows.length,
      truncated: rows.length > DATASET_IMPORT_PREVIEW_ROW_LIMIT,
    };
  }
  const hasHeader = looksLikeHeaderRow(normalized[0] ?? []);
  const headers = hasHeader
    ? (normalized[0] ?? []).map((header, index) => header || `column_${index + 1}`)
    : (normalized[0] ?? []).map((_, index) => `column_${index + 1}`);
  const dataRows = hasHeader ? normalized.slice(1) : normalized;
  const width = headers.length;
  const rows = dataRows.map((row) => {
    const padded = [...row];
    while (padded.length < width) {
      padded.push("");
    }
    return padded.slice(0, width);
  });
  const totalRowCount = rows.length;
  return {
    headers,
    rows: rows.slice(0, DATASET_IMPORT_PREVIEW_ROW_LIMIT),
    totalRowCount,
    truncated: totalRowCount > DATASET_IMPORT_PREVIEW_ROW_LIMIT,
  };
}

export function datasetRecordsFromTable(table: string[][]): { title?: string; text: string }[] {
  const preview = buildDatasetImportPreview(table);
  if (!preview) {
    return [];
  }
  if (preview.headers.length === 1 && preview.headers[0] === "content") {
    return table
      .map((row) => row[0]?.trim() ?? "")
      .filter((line) => line.length > 0)
      .map((text) => ({ text }));
  }
  const hasHeader = looksLikeHeaderRow(table[0] ?? []);
  const headers = hasHeader
    ? (table[0] ?? []).map((header, index) => header || `column_${index + 1}`)
    : preview.headers;
  const dataRows = hasHeader ? table.slice(1) : table;
  const titleIndex = headers.findIndex((header) => header.toLowerCase() === "title");
  const contentIndex = headers.findIndex((header) =>
    ["content", "text", "body", "内容", "正文"].includes(header.toLowerCase()),
  );
  const width = headers.length;
  return dataRows
    .map((row, index) => {
      const padded = row.map((cell) => cell.trim());
      while (padded.length < width) {
        padded.push("");
      }
      const title =
        titleIndex >= 0 ? padded[titleIndex]?.trim() : padded[0]?.trim() || `Record ${index + 1}`;
      const text =
        contentIndex >= 0
          ? (padded[contentIndex]?.trim() ?? "")
          : headers
              .map((header, columnIndex) => {
                const value = padded[columnIndex]?.trim() ?? "";
                if (!value) {
                  return "";
                }
                return `${header}: ${value}`;
              })
              .filter(Boolean)
              .join("\n");
      return { title, text };
    })
    .filter((record) => record.text.length > 0);
}

export function datasetTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base || "Dataset";
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineCell(ref: string, value: string) {
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

export async function downloadDatasetImportTemplateXlsx() {
  if (typeof window === "undefined") {
    return;
  }
  const rows = [
    ["title", "content"],
    ["Sample title", "Sample content for one dataset record."],
  ];
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) =>
          inlineCell(`${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`, value),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Dataset" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`,
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "openbot-dataset-template.xlsx";
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}
