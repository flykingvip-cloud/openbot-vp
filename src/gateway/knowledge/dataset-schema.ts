/**
 * Dataset column-level schema extraction. Parses uploaded tabular content (CSV / TSV /
 * JSON-array) into a real structural schema — column names, per-column inferred types,
 * column count, and row count — so the 数据集 tab can present datasets as structured
 * knowledge instead of opaque blobs. Pure + dependency-free (no streaming parser libs);
 * handles RFC-4180-style quoting for the delimiter-separated formats.
 */

import { isRecord } from "../records.js";

export type DatasetColumnType = "string" | "number" | "boolean" | "date" | "empty" | "mixed";

export type DatasetColumn = {
  name: string;
  type: DatasetColumnType;
};

export type DatasetSchema = {
  format: "csv" | "tsv" | "json";
  columnCount: number;
  rowCount: number;
  columns: DatasetColumn[];
};

export type DatasetFormat = DatasetSchema["format"];

const MAX_TYPE_SAMPLE_ROWS = 100;
const MAX_COLUMNS = 512;

export function detectDatasetFormat(params: {
  fileName?: string | null;
  mimeType?: string | null;
  sampleText?: string;
}): DatasetFormat | null {
  const name = (params.fileName ?? "").toLowerCase();
  const mime = (params.mimeType ?? "").toLowerCase();
  if (name.endsWith(".csv") || mime.includes("csv")) {
    return "csv";
  }
  if (name.endsWith(".tsv") || mime.includes("tab-separated")) {
    return "tsv";
  }
  if (
    name.endsWith(".json") ||
    name.endsWith(".ndjson") ||
    mime.includes("json") ||
    mime.includes("ndjson")
  ) {
    return "json";
  }
  // Last resort: sniff a leading JSON array/object from the content itself.
  const trimmed = (params.sampleText ?? "").trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return "json";
  }
  return null;
}

/** Parse one delimiter-separated row honouring double-quote quoting + "" escapes. */
function parseDelimitedRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Split delimiter-separated text into logical rows. A newline inside a quoted field does
 * not terminate the row, so we track quote balance across physical lines.
 */
function splitDelimitedRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let quoteCount = 0;
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    current = current ? `${current}\n${line}` : line;
    quoteCount += (line.match(/"/g) ?? []).length;
    if (quoteCount % 2 === 0) {
      rows.push(current);
      current = "";
      quoteCount = 0;
    }
  }
  if (current) {
    rows.push(current);
  }
  return rows.filter((row) => row.trim().length > 0);
}

const NUMBER_RE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const BOOLEAN_RE = /^(true|false|yes|no|y|n)$/i;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}([ t]\d{1,2}:\d{2}(:\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;

function classifyValue(value: string): DatasetColumnType {
  const trimmed = value.trim();
  if (!trimmed) {
    return "empty";
  }
  if (NUMBER_RE.test(trimmed)) {
    return "number";
  }
  if (BOOLEAN_RE.test(trimmed)) {
    return "boolean";
  }
  if (DATE_RE.test(trimmed)) {
    return "date";
  }
  return "string";
}

/** Reduce the per-value classifications of a column into a single column type. */
function reduceColumnType(values: string[]): DatasetColumnType {
  let resolved: DatasetColumnType | null = null;
  for (const value of values) {
    const kind = classifyValue(value);
    if (kind === "empty") {
      continue;
    }
    if (resolved === null) {
      resolved = kind;
    } else if (resolved !== kind) {
      return "mixed";
    }
  }
  return resolved ?? "empty";
}

function uniqueColumnName(raw: string, used: Set<string>, index: number): string {
  let name = raw.trim();
  if (!name) {
    name = `column_${index + 1}`;
  }
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${name}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function extractDelimitedSchema(text: string, format: "csv" | "tsv"): DatasetSchema | null {
  const delimiter = format === "tsv" ? "\t" : ",";
  const rows = splitDelimitedRows(text);
  if (rows.length === 0) {
    return null;
  }
  const header = parseDelimitedRow(rows[0], delimiter);
  if (header.length === 0) {
    return null;
  }
  const used = new Set<string>();
  const columnNames = header
    .slice(0, MAX_COLUMNS)
    .map((raw, index) => uniqueColumnName(raw, used, index));

  const dataRows = rows.slice(1);
  const sampleValues: string[][] = columnNames.map(() => []);
  const sampleLimit = Math.min(dataRows.length, MAX_TYPE_SAMPLE_ROWS);
  for (let r = 0; r < sampleLimit; r += 1) {
    const cells = parseDelimitedRow(dataRows[r], delimiter);
    for (let c = 0; c < columnNames.length; c += 1) {
      sampleValues[c].push(cells[c] ?? "");
    }
  }

  const columns: DatasetColumn[] = columnNames.map((name, index) => ({
    name,
    type: reduceColumnType(sampleValues[index] ?? []),
  }));

  return {
    format,
    columnCount: columns.length,
    rowCount: dataRows.length,
    columns,
  };
}

function extractJsonSchema(text: string): DatasetSchema | null {
  const trimmed = text.trim();
  let records: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      records = parsed.filter(isRecord);
    } else if (isRecord(parsed)) {
      records = [parsed];
    } else {
      return null;
    }
  } catch {
    // Fall back to NDJSON (one JSON object per line).
    records = [];
    for (const line of trimmed.split(/\r\n|\r|\n/)) {
      const value = line.trim();
      if (!value) {
        continue;
      }
      try {
        const parsed = JSON.parse(value) as unknown;
        if (isRecord(parsed)) {
          records.push(parsed);
        }
      } catch {
        return null;
      }
    }
  }
  if (records.length === 0) {
    return null;
  }

  const columnOrder: string[] = [];
  const valuesByColumn = new Map<string, string[]>();
  const sampleLimit = Math.min(records.length, MAX_TYPE_SAMPLE_ROWS);
  for (let r = 0; r < sampleLimit; r += 1) {
    for (const [key, value] of Object.entries(records[r])) {
      if (!valuesByColumn.has(key)) {
        if (columnOrder.length >= MAX_COLUMNS) {
          continue;
        }
        columnOrder.push(key);
        valuesByColumn.set(key, []);
      }
      valuesByColumn.get(key)!.push(jsonValueToSampleString(value));
    }
  }

  const columns: DatasetColumn[] = columnOrder.map((name) => ({
    name,
    type: reduceColumnType(valuesByColumn.get(name) ?? []),
  }));

  return {
    format: "json",
    columnCount: columns.length,
    rowCount: records.length,
    columns,
  };
}

function jsonValueToSampleString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  // Nested objects/arrays are non-scalar → treat as a present string value.
  return "object";
}

/**
 * Extract a dataset schema from raw tabular text. Returns null when the content is not a
 * recognizable dataset (so callers can skip schema bookkeeping for free-text documents).
 */
export function extractDatasetSchema(params: {
  text: string;
  fileName?: string | null;
  mimeType?: string | null;
}): DatasetSchema | null {
  const format = detectDatasetFormat({
    fileName: params.fileName,
    mimeType: params.mimeType,
    sampleText: params.text,
  });
  if (!format) {
    return null;
  }
  if (format === "json") {
    return extractJsonSchema(params.text);
  }
  return extractDelimitedSchema(params.text, format);
}
