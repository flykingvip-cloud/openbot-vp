import JSZip from "jszip";
import mammoth from "mammoth";
import { extractPptxSlides, type OfficeSlideText } from "./office-pptx-text.js";

/**
 * Server-side Office document rendering for faithful artifact previews.
 *
 * A produced Word file (.docx) is the real deliverable, so the preview must show the document —
 * not the chat text. mammoth converts the .docx to semantic HTML (embedded images become inline
 * data URIs), which the client sanitizes (DOMPurify) before rendering. Conversion is best-effort:
 * on any failure the caller falls back to a plain download of the original file.
 *
 * PPTX has no mammoth equivalent here — we extract per-slide text from the OOXML package and
 * render a lightweight slide-deck HTML so "打开成果" can preview decks in the sidebar.
 *
 * XLSX is parsed via OOXML (JSZip) into a self-contained HTML table + optional SVG chart.
 */

const DOCX_EXTENSIONS = new Set([".docx"]);
const PPTX_EXTENSIONS = new Set([".pptx"]);
const XLSX_EXTENSIONS = new Set([".xlsx"]);

const XLSX_MAX_ROWS = 200;
const XLSX_MAX_COLS = 20;
const XLSX_MAX_CHART_CATEGORIES = 24;
const XLSX_MAX_PIE_CATEGORIES = 12;
const XLSX_MAX_SERIES = 3;

function extensionOf(filename: string): string {
  const lower = filename.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

/** True when a filename is a modern Word document mammoth can render to HTML. */
export function isDocxRenderableFilename(filename: string): boolean {
  return DOCX_EXTENSIONS.has(extensionOf(filename));
}

/** True when a filename is a modern PowerPoint package we can preview as HTML slides. */
export function isPptxRenderableFilename(filename: string): boolean {
  return PPTX_EXTENSIONS.has(extensionOf(filename));
}

/** True when a filename is a modern Excel workbook we can preview as HTML + SVG chart. */
export function isXlsxRenderableFilename(filename: string): boolean {
  return XLSX_EXTENSIONS.has(extensionOf(filename));
}

export type OfficePreviewHtml = {
  html: string;
  /** Keep original bytes so save/archive can write the Office package, not HTML. */
  keepBytes: boolean;
  slides?: OfficeSlideText[];
};

/** Best-effort HTML preview for modern Office packages opened via 打开成果. */
export async function renderOfficePreviewHtml(params: {
  filename: string;
  buffer: Buffer;
}): Promise<OfficePreviewHtml | null> {
  const { filename, buffer } = params;
  if (isDocxRenderableFilename(filename)) {
    const html = await renderDocxBufferToHtml(buffer);
    return html ? { html, keepBytes: true } : null;
  }
  if (isPptxRenderableFilename(filename)) {
    const rendered = await renderPptxPreview(buffer, filename);
    return rendered ? { html: rendered.html, keepBytes: true, slides: rendered.slides } : null;
  }
  if (isXlsxRenderableFilename(filename)) {
    const html = await renderXlsxBufferToHtml(buffer, filename);
    return html ? { html, keepBytes: true } : null;
  }
  return null;
}

/**
 * Convert a .docx buffer to HTML. Returns null on any conversion failure (unsupported/corrupt
 * file, legacy binary .doc, etc.) so the caller can gracefully fall back to download.
 */
export async function renderDocxBufferToHtml(buffer: Buffer): Promise<string | null> {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    const html = typeof result?.value === "string" ? result.value.trim() : "";
    return html || null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderPptxPreview(
  buffer: Buffer,
  title = "Presentation",
): Promise<{ html: string; slides: OfficeSlideText[] } | null> {
  const slides = await extractPptxSlides(buffer);
  if (!slides) {
    return null;
  }
  const safeTitle = escapeHtml(title.trim() || "Presentation");
  const body = slides
    .map((slide) => {
      const content =
        slide.lines.length > 0
          ? `<ul>${slide.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
          : `<p class="muted">（本页无可提取文字）</p>`;
      return `<section class="slide"><header>第 ${slide.index} 页</header>${content}</section>`;
    })
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>
body{margin:0;padding:20px;font:14px/1.55 system-ui,-apple-system,sans-serif;color:#14212b;background:#eef2f6}
h1{font-size:18px;margin:0 0 16px}
.slide{background:#fff;border:1px solid #d7dee7;border-radius:14px;padding:18px 20px;margin:0 0 14px;box-shadow:0 1px 2px rgba(20,33,43,.04)}
.slide header{font-size:12px;font-weight:600;color:#5b6b76;margin:0 0 10px;letter-spacing:.02em}
.slide ul{margin:0;padding-left:1.2em}
.slide li{margin:6px 0}
.muted{color:#7a8792;margin:0}
.footnote{margin-top:16px;font-size:12px;color:#7a8792}
</style></head><body>
<h1>${safeTitle}</h1>
${body}
<p class="footnote">PPTX 文字预览 · 共 ${slides.length} 页（非原版排版）</p>
</body></html>`;
  return { html, slides };
}

/**
 * Convert a .pptx buffer to a self-contained HTML slide deck (text-first preview).
 * Returns null when the package cannot be parsed or yields no slide text.
 */
export async function renderPptxBufferToHtml(
  buffer: Buffer,
  title = "Presentation",
): Promise<string | null> {
  const rendered = await renderPptxPreview(buffer, title);
  return rendered?.html ?? null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

function columnLettersToIndex(letters: string): number {
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

function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) {
    return null;
  }
  const col = columnLettersToIndex(match[1] ?? "");
  const row = Number(match[2]) - 1;
  if (col < 0 || !Number.isFinite(row) || row < 0) {
    return null;
  }
  return { row, col };
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(xml))) {
    const chunk = siMatch[1] ?? "";
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(chunk))) {
      parts.push(decodeXmlEntities(tMatch[1] ?? ""));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

type SheetCell = { raw: string; numeric: number | null };

function parseSheetCells(xml: string, sharedStrings: string[]): Map<string, SheetCell> {
  const cells = new Map<string, SheetCell>();
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(xml))) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    const ref = /\br="([^"]+)"/.exec(attrs)?.[1];
    if (!ref) {
      continue;
    }
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
    let raw = "";
    let numeric: number | null = null;
    if (type === "s") {
      const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() ?? "");
      raw = Number.isFinite(index) ? (sharedStrings[index] ?? "") : "";
    } else if (type === "inlineStr") {
      const parts: string[] = [];
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRe.exec(body))) {
        parts.push(decodeXmlEntities(tMatch[1] ?? ""));
      }
      raw = parts.join("");
    } else if (type === "b") {
      raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() === "1" ? "TRUE" : "FALSE";
    } else if (type === "str") {
      raw = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() ?? "");
    } else {
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() ?? "";
      if (value) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          numeric = asNumber;
          raw = String(asNumber);
        } else {
          raw = decodeXmlEntities(value);
        }
      }
    }
    cells.set(ref, { raw, numeric });
  }
  return cells;
}

function buildGrid(cells: Map<string, SheetCell>): {
  grid: SheetCell[][];
  truncated: boolean;
  totalRows: number;
  totalCols: number;
} {
  let maxRow = -1;
  let maxCol = -1;
  for (const ref of cells.keys()) {
    const parsed = parseCellRef(ref);
    if (!parsed) {
      continue;
    }
    maxRow = Math.max(maxRow, parsed.row);
    maxCol = Math.max(maxCol, parsed.col);
  }
  if (maxRow < 0 || maxCol < 0) {
    return { grid: [], truncated: false, totalRows: 0, totalCols: 0 };
  }
  const totalRows = maxRow + 1;
  const totalCols = maxCol + 1;
  const rowCount = Math.min(totalRows, XLSX_MAX_ROWS);
  const colCount = Math.min(totalCols, XLSX_MAX_COLS);
  const grid: SheetCell[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ({ raw: "", numeric: null })),
  );
  for (const [ref, cell] of cells) {
    const parsed = parseCellRef(ref);
    if (!parsed || parsed.row >= rowCount || parsed.col >= colCount) {
      continue;
    }
    grid[parsed.row][parsed.col] = cell;
  }
  return {
    grid,
    truncated: totalRows > XLSX_MAX_ROWS || totalCols > XLSX_MAX_COLS,
    totalRows,
    totalCols,
  };
}

function parseNumberLoose(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) {
    return null;
  }
  const percent = trimmed.endsWith("%");
  const candidate = percent ? trimmed.slice(0, -1) : trimmed;
  const value = Number(candidate);
  if (!Number.isFinite(value)) {
    return null;
  }
  return percent ? value / 100 : value;
}

function isMostlyNumericColumn(grid: SheetCell[][], col: number, startRow: number): boolean {
  let numeric = 0;
  let nonEmpty = 0;
  for (let row = startRow; row < grid.length; row += 1) {
    const cell = grid[row]?.[col];
    const raw = cell?.raw?.trim() ?? "";
    if (!raw) {
      continue;
    }
    nonEmpty += 1;
    const value = cell?.numeric ?? parseNumberLoose(raw);
    if (value !== null) {
      numeric += 1;
    }
  }
  return nonEmpty > 0 && numeric / nonEmpty >= 0.7;
}

function isMostlyCategoryColumn(grid: SheetCell[][], col: number, startRow: number): boolean {
  let nonEmpty = 0;
  let numeric = 0;
  for (let row = startRow; row < grid.length; row += 1) {
    const cell = grid[row]?.[col];
    const raw = cell?.raw?.trim() ?? "";
    if (!raw) {
      continue;
    }
    nonEmpty += 1;
    const value = cell?.numeric ?? parseNumberLoose(raw);
    if (value !== null) {
      numeric += 1;
    }
  }
  return nonEmpty > 0 && numeric / nonEmpty < 0.5;
}

type ChartSeries = { name: string; values: number[] };

type AutoChart = {
  kind: "bar" | "line" | "pie";
  categories: string[];
  series: ChartSeries[];
};

function detectAutoChart(grid: SheetCell[][]): AutoChart | null {
  if (grid.length < 2 || (grid[0]?.length ?? 0) < 2) {
    return null;
  }
  const header = grid[0] ?? [];
  const dataRows = grid.slice(1);
  if (dataRows.length === 0) {
    return null;
  }

  let categoryCol = -1;
  for (let col = 0; col < header.length; col += 1) {
    if (isMostlyCategoryColumn(grid, col, 1)) {
      categoryCol = col;
      break;
    }
  }
  if (categoryCol < 0) {
    categoryCol = 0;
  }

  const valueCols: number[] = [];
  for (let col = 0; col < header.length; col += 1) {
    if (col === categoryCol) {
      continue;
    }
    if (isMostlyNumericColumn(grid, col, 1)) {
      valueCols.push(col);
    }
    if (valueCols.length >= XLSX_MAX_SERIES) {
      break;
    }
  }
  if (valueCols.length === 0) {
    return null;
  }

  const categories: string[] = [];
  const series: ChartSeries[] = valueCols.map((col) => ({
    name: header[col]?.raw?.trim() || `列 ${col + 1}`,
    values: [] as number[],
  }));

  for (const row of dataRows) {
    if (categories.length >= XLSX_MAX_CHART_CATEGORIES) {
      break;
    }
    const label = row[categoryCol]?.raw?.trim() || `行 ${categories.length + 2}`;
    let hasValue = false;
    const rowValues: number[] = [];
    for (let i = 0; i < valueCols.length; i += 1) {
      const col = valueCols[i];
      const cell = row[col];
      const value = cell?.numeric ?? parseNumberLoose(cell?.raw ?? "");
      if (value === null) {
        rowValues.push(0);
        continue;
      }
      hasValue = true;
      rowValues.push(value);
    }
    if (!hasValue) {
      continue;
    }
    categories.push(label);
    for (let i = 0; i < series.length; i += 1) {
      series[i].values.push(rowValues[i] ?? 0);
    }
  }

  if (categories.length < 2) {
    return null;
  }

  if (series.length === 1 && categories.length <= XLSX_MAX_PIE_CATEGORIES) {
    const values = series[0].values;
    const total = values.reduce((sum, value) => sum + Math.abs(value), 0);
    if (total > 0) {
      const positiveShare = values.filter((value) => value > 0).length / values.length;
      if (positiveShare >= 0.8) {
        return { kind: "pie", categories, series };
      }
    }
  }

  if (series.length === 1 && categories.length >= 4) {
    const labelsLookSequential = categories.every((label, index) => {
      const asNumber = Number(label.replace(/[^\d.-]/g, ""));
      return Number.isFinite(asNumber) || /\d{4}|Q[1-4]|周|月|日/.test(label) || index < 2;
    });
    if (labelsLookSequential) {
      return { kind: "line", categories, series };
    }
  }

  return { kind: "bar", categories, series };
}

const CHART_COLORS = ["#2f6fed", "#15aabf", "#f59f00"];

function renderBarOrLineSvg(chart: AutoChart): string {
  const width = 640;
  const height = 280;
  const pad = { top: 24, right: 16, bottom: 56, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const allValues = chart.series.flatMap((item) => item.values);
  const maxValue = Math.max(...allValues, 0);
  const minValue = Math.min(...allValues, 0);
  const span = maxValue - minValue || 1;
  const zeroY = pad.top + ((maxValue - 0) / span) * plotH;
  const categoryCount = chart.categories.length;
  const groupWidth = plotW / categoryCount;
  const seriesCount = chart.series.length;

  const bars: string[] = [];
  const lines: string[] = [];
  chart.series.forEach((item, seriesIndex) => {
    const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
    if (chart.kind === "bar") {
      const barWidth = Math.max(4, (groupWidth * 0.7) / seriesCount);
      item.values.forEach((value, index) => {
        const x = pad.left + index * groupWidth + groupWidth * 0.15 + seriesIndex * barWidth;
        const y = pad.top + ((maxValue - value) / span) * plotH;
        const h = Math.abs(zeroY - y);
        bars.push(
          `<rect x="${x.toFixed(1)}" y="${Math.min(y, zeroY).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${color}" rx="2"/>`,
        );
      });
    } else {
      const points = item.values
        .map((value, index) => {
          const x = pad.left + index * groupWidth + groupWidth / 2;
          const y = pad.top + ((maxValue - value) / span) * plotH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      lines.push(`<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}"/>`);
      item.values.forEach((value, index) => {
        const x = pad.left + index * groupWidth + groupWidth / 2;
        const y = pad.top + ((maxValue - value) / span) * plotH;
        lines.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}"/>`);
      });
    }
  });

  const labels = chart.categories
    .map((label, index) => {
      const x = pad.left + index * groupWidth + groupWidth / 2;
      const short = label.length > 8 ? `${label.slice(0, 7)}…` : label;
      return `<text x="${x.toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#5b6b76">${escapeHtml(short)}</text>`;
    })
    .join("");

  const legend = chart.series
    .map((item, index) => {
      const color = CHART_COLORS[index % CHART_COLORS.length];
      const x = pad.left + index * 140;
      return `<rect x="${x}" y="6" width="10" height="10" rx="2" fill="${color}"/><text x="${x + 16}" y="15" font-size="11" fill="#5b6b76">${escapeHtml(item.name)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="chart">
<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
${legend}
<line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${width - pad.right}" y2="${zeroY.toFixed(1)}" stroke="#d7dee7"/>
${chart.kind === "bar" ? bars.join("") : lines.join("")}
${labels}
</svg>`;
}

function renderPieSvg(chart: AutoChart): string {
  const values = chart.series[0]?.values ?? [];
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) {
    return "";
  }
  const cx = 160;
  const cy = 140;
  const r = 100;
  let angle = -Math.PI / 2;
  const slices: string[] = [];
  values.forEach((value, index) => {
    const portion = Math.max(value, 0) / total;
    const next = angle + portion * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next);
    const y2 = cy + r * Math.sin(next);
    const large = portion > 0.5 ? 1 : 0;
    const color = CHART_COLORS[index % CHART_COLORS.length];
    slices.push(
      `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}"/>`,
    );
    angle = next;
  });
  const legend = chart.categories
    .map((label, index) => {
      const color = CHART_COLORS[index % CHART_COLORS.length];
      const y = 24 + index * 18;
      const short = label.length > 14 ? `${label.slice(0, 13)}…` : label;
      return `<rect x="300" y="${y - 10}" width="10" height="10" rx="2" fill="${color}"/><text x="318" y="${y}" font-size="12" fill="#5b6b76">${escapeHtml(short)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 520 280" role="img" aria-label="pie chart">
<rect x="0" y="0" width="520" height="280" fill="#fff"/>
${slices.join("")}
${legend}
</svg>`;
}

function renderChartSection(chart: AutoChart | null): string {
  if (!chart) {
    return "";
  }
  const svg = chart.kind === "pie" ? renderPieSvg(chart) : renderBarOrLineSvg(chart);
  if (!svg) {
    return "";
  }
  const kindLabel = chart.kind === "pie" ? "饼图" : chart.kind === "line" ? "折线图" : "柱状图";
  return `<section class="chart">
<header>自动图表 · ${kindLabel}</header>
${svg}
</section>`;
}

function renderTableHtml(grid: SheetCell[][]): string {
  if (grid.length === 0) {
    return `<p class="muted">工作表为空</p>`;
  }
  const rows = grid
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => {
          const tag = rowIndex === 0 ? "th" : "td";
          return `<${tag}>${escapeHtml(cell.raw)}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<div class="table-wrap"><table>${rows}</table></div>`;
}

async function resolveFirstWorksheetPath(zip: JSZip): Promise<string | null> {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) {
    const fallback = Object.keys(zip.files)
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry) && !zip.files[entry]?.dir)
      .toSorted((a, b) => {
        const na = Number(a.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
        const nb = Number(b.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
        return na - nb;
      });
    return fallback[0] ?? null;
  }

  const sheetMatches = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)];
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const ridToTarget = new Map<string, string>();
  if (relsXml) {
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = rel[0] ?? "";
      const id = /\bId="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (id && target) {
        ridToTarget.set(id, target.replace(/^\//, ""));
      }
    }
  }

  for (const sheetTag of sheetMatches) {
    const tag = sheetTag[0] ?? "";
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1] ?? /\bRelationshipId="([^"]+)"/.exec(tag)?.[1];
    if (!rid) {
      continue;
    }
    const target = ridToTarget.get(rid);
    if (!target) {
      continue;
    }
    const normalized = target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
    if (zip.files[normalized] && !zip.files[normalized]?.dir) {
      return normalized;
    }
  }

  const fallback = Object.keys(zip.files)
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry) && !zip.files[entry]?.dir)
    .toSorted((a, b) => {
      const na = Number(a.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });
  return fallback[0] ?? null;
}

/**
 * Convert a .xlsx buffer to a self-contained HTML preview (table + optional SVG chart).
 * Returns null when the package cannot be parsed or yields no usable cells.
 */
export async function renderXlsxBufferToHtml(
  buffer: Buffer,
  title = "Spreadsheet",
): Promise<string | null> {
  try {
    if (!buffer?.length) {
      return null;
    }
    const zip = await JSZip.loadAsync(buffer);
    const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
    const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
    const sheetPath = await resolveFirstWorksheetPath(zip);
    if (!sheetPath) {
      return null;
    }
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) {
      return null;
    }
    const cells = parseSheetCells(sheetXml, sharedStrings);
    if (cells.size === 0) {
      return null;
    }
    const { grid, truncated, totalRows, totalCols } = buildGrid(cells);
    if (grid.length === 0) {
      return null;
    }
    const chart = detectAutoChart(grid);
    const safeTitle = escapeHtml(title.trim() || "Spreadsheet");
    const truncationNote = truncated
      ? `<p class="note">已截断预览：原表约 ${totalRows} 行 × ${totalCols} 列，此处最多展示 ${XLSX_MAX_ROWS} × ${XLSX_MAX_COLS}。</p>`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>
body{margin:0;padding:20px;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#14212b;background:#eef2f6}
h1{font-size:18px;margin:0 0 12px}
.note,.muted,.footnote{color:#7a8792;font-size:12px}
.chart,.table-wrap{background:#fff;border:1px solid #d7dee7;border-radius:14px;padding:14px 16px;margin:0 0 14px;box-shadow:0 1px 2px rgba(20,33,43,.04)}
.chart header{font-size:12px;font-weight:600;color:#5b6b76;margin:0 0 10px}
.table-wrap{overflow:auto;max-height:min(60vh,520px)}
table{border-collapse:collapse;width:100%;min-width:320px;font-size:12.5px}
th,td{border:1px solid #e3e9ef;padding:6px 8px;text-align:left;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
th{background:#f5f8fb;font-weight:650;position:sticky;top:0}
svg{width:100%;height:auto;display:block}
.footnote{margin-top:8px}
</style></head><body>
<h1>${safeTitle}</h1>
${truncationNote}
${renderChartSection(chart)}
${renderTableHtml(grid)}
<p class="footnote">Excel 预览 · 首个工作表 · 可用侧栏下载原文件</p>
</body></html>`;
  } catch {
    return null;
  }
}
