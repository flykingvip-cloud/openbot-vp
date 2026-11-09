import JSZip from "jszip";
import {
  formatValue,
  isFormulaCell,
  recalculate,
  type CellInput,
  type NumberFormat,
  type SheetModel,
} from "./formula.js";
import { cellRef, isMacroPart, parseCellRef, xmlEscape } from "./xml.js";

export type XlsxColumn = {
  header: string;
  format?: NumberFormat;
};

export type XlsxSheetSpec = {
  name: string;
  columns?: XlsxColumn[];
  rows?: (string | number | null)[][];
  formulas?: { cell: string; formula: string; format?: NumberFormat }[];
  chart?: boolean;
};

export type XlsxSpec = {
  sheets?: XlsxSheetSpec[];
  csv?: { name?: string; text: string; delimiter?: "," | "\t" };
};

export type XlsxCellEdit = {
  cell: string;
  value?: string | number | null;
  formula?: string;
  format?: NumberFormat;
};

export type XlsxEdit = {
  sheet: string;
  cells: XlsxCellEdit[];
};

export type XlsxRead = {
  sheets: {
    name: string;
    cells: Record<
      string,
      { value: string | number | boolean | null; formula?: string; display: string }
    >;
  }[];
  charts: number;
  issues: { sheet: string; cell: string; code: string; message: string }[];
  macrosPresent: boolean;
};

const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

export async function buildXlsx(spec: XlsxSpec): Promise<Buffer> {
  const sheets = normalizeSheets(spec);
  return writeWorkbook(sheets);
}

export async function readXlsx(buffer: Buffer): Promise<XlsxRead> {
  const parsed = await loadWorkbook(buffer);
  const calc = recalculate(parsed.models);
  return {
    sheets: parsed.models.map((model) => ({
      name: model.name,
      cells: Object.fromEntries(
        Object.keys(model.cells).map((ref) => {
          const input = model.cells[ref];
          return [
            ref,
            {
              value: calc.values[model.name]?.[ref] ?? null,
              ...(input && isFormulaCell(input) ? { formula: input.formula } : {}),
              display: calc.display[model.name]?.[ref] ?? "",
            },
          ];
        }),
      ),
    })),
    charts: parsed.chartCount,
    issues: calc.issues,
    macrosPresent: parsed.macrosPresent,
  };
}

export async function editXlsx(buffer: Buffer, edit: XlsxEdit): Promise<Buffer> {
  const parsed = await loadWorkbook(buffer);
  const model = parsed.models.find((sheet) => sheet.name === edit.sheet);
  if (!model) {
    throw new Error(`sheet ${edit.sheet} does not exist`);
  }
  for (const change of edit.cells) {
    const ref = change.cell.trim().toUpperCase();
    if (!parseCellRef(ref)) {
      throw new Error(`cell ${change.cell} is not a valid reference`);
    }
    if (change.formula !== undefined) {
      model.cells[ref] = {
        formula: change.formula.replace(/^=/, ""),
        format: change.format ?? model.cells[ref]?.format,
      };
      continue;
    }
    model.cells[ref] = {
      value: change.value ?? null,
      format: change.format ?? model.cells[ref]?.format,
    };
  }
  return writeWorkbook(parsed.models);
}

function normalizeSheets(spec: XlsxSpec): SheetModel[] {
  const sheets: SheetModel[] = [];
  if (spec.csv) {
    sheets.push(
      sheetFromCsv(spec.csv.name?.trim() || "导入", spec.csv.text, spec.csv.delimiter ?? ","),
    );
  }
  for (const sheet of spec.sheets ?? []) {
    sheets.push(sheetFromSpec(sheet));
  }
  if (sheets.length === 0) {
    throw new Error("workbook needs a sheet or csv");
  }
  return sheets;
}

function sheetFromSpec(spec: XlsxSheetSpec): SheetModel {
  const cells: Record<string, CellInput> = {};
  const columns = spec.columns ?? [];
  columns.forEach((column, index) => {
    cells[cellRef(0, index)] = { value: column.header, format: "text" };
  });
  (spec.rows ?? []).forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const format = columns[colIndex]?.format ?? (typeof value === "number" ? "general" : "text");
      cells[cellRef(rowIndex + (columns.length > 0 ? 1 : 0), colIndex)] = {
        value,
        format,
      };
    });
  });
  for (const formula of spec.formulas ?? []) {
    cells[formula.cell.trim().toUpperCase()] = {
      formula: formula.formula.replace(/^=/, ""),
      format: formula.format ?? "general",
    };
  }
  const model: SheetModel = { name: spec.name, cells };
  if (spec.chart) {
    (model as SheetModel & { chart?: boolean }).chart = true;
  }
  return model;
}

function sheetFromCsv(name: string, text: string, delimiter: "," | "\t"): SheetModel {
  const cells: Record<string, CellInput> = {};
  parseCsv(text, delimiter).forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const numeric = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
      cells[cellRef(rowIndex, colIndex)] = {
        value: numeric ?? value,
        format: numeric === null ? "text" : "general",
      };
    });
  });
  return { name, cells };
}

export function parseCsv(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.length > 0));
}

async function loadWorkbook(buffer: Buffer): Promise<{
  models: SheetModel[];
  chartCount: number;
  macrosPresent: boolean;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbook) {
    throw new Error("xlsx is missing xl/workbook.xml");
  }
  const names = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((match) =>
    decode(match[1] ?? ""),
  );
  const models: SheetModel[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)?.async("string");
    const rels = await zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`)?.async("string");
    const model: SheetModel = {
      name: names[i] ?? `Sheet${i + 1}`,
      cells: xml ? parseSheet(xml) : {},
    };
    if (rels?.includes("drawing")) {
      (model as SheetModel & { chart?: boolean }).chart = true;
    }
    models.push(model);
  }
  return {
    models,
    chartCount: Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name))
      .length,
    macrosPresent: Object.keys(zip.files).some((name) => isMacroPart(name)),
  };
}

function parseSheet(xml: string): Record<string, CellInput> {
  const cells: Record<string, CellInput> = {};
  const re = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    const ref = /\br="([^"]+)"/.exec(attrs)?.[1]?.toUpperCase();
    if (!ref) {
      continue;
    }
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
    const format = formatFromStyle(style);
    const formula = /<f>([\s\S]*?)<\/f>/.exec(body)?.[1];
    if (formula) {
      cells[ref] = { formula: decode(formula), format };
      continue;
    }
    if (type === "inlineStr") {
      const text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => decode(part[1] ?? ""))
        .join("");
      cells[ref] = { value: text, format: format === "general" ? "text" : format };
      continue;
    }
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() ?? "";
    const numeric = Number(raw);
    cells[ref] = { value: raw && Number.isFinite(numeric) ? numeric : raw, format };
  }
  return cells;
}

function formatFromStyle(style: number): NumberFormat {
  if (style === 1) {
    return "number";
  }
  if (style === 2) {
    return "percent";
  }
  if (style === 3) {
    return "date";
  }
  if (style === 4) {
    return "text";
  }
  return "general";
}

function styleFromFormat(format: NumberFormat | undefined): number {
  if (format === "number") {
    return 1;
  }
  if (format === "percent") {
    return 2;
  }
  if (format === "date") {
    return 3;
  }
  if (format === "text") {
    return 4;
  }
  return 0;
}

async function writeWorkbook(models: SheetModel[]): Promise<Buffer> {
  const calc = recalculate(models);
  if (calc.issues.some((issue) => issue.code === "#CYCLE" || issue.code === "#NAME?")) {
    const first = calc.issues[0];
    throw new Error(first ? `${first.code} ${first.message}` : "formula failed");
  }
  const zip = new JSZip();
  const sheetTags = models
    .map(
      (model, index) =>
        `<sheet name="${xmlEscape(model.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
  );
  const rels = models
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const relExtra = `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  const chartSheet = models.findIndex((model) => modelHasChart(model));
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
  ];
  models.forEach((model, index) => {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    const wantChart = index === chartSheet;
    if (wantChart) {
      const chart = chartXml(model, calc.display[model.name] ?? {});
      zip.file("xl/charts/chart1.xml", chart);
      zip.file(
        "xl/drawings/drawing1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${A}" xmlns:c="${C}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
      );
      zip.file(
        "xl/drawings/_rels/drawing1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
      );
      zip.file(
        `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      );
      overrides.push(
        `<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
    }
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(model, calc, wantChart));
  });
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}${relExtra}</Relationships>`,
  );
  zip.file("xl/styles.xml", stylesXml());
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function sheetXml(
  model: SheetModel,
  calc: ReturnType<typeof recalculate>,
  drawing: boolean,
): string {
  const byRow = new Map<number, string[]>();
  for (const [ref, input] of Object.entries(model.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) {
      continue;
    }
    const style = styleFromFormat(input?.format);
    const styleAttr = style ? ` s="${style}"` : "";
    const value = calc.values[model.name]?.[ref];
    let cell = "";
    if (input && isFormulaCell(input)) {
      const cached = typeof value === "number" ? value : 0;
      cell = `<c r="${ref}"${styleAttr}><f>${xmlEscape(input.formula)}</f><v>${cached}</v></c>`;
    } else if (typeof value === "number") {
      cell = `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
    } else {
      cell = `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(value == null ? "" : String(value))}</t></is></c>`;
    }
    const list = byRow.get(pos.row) ?? [];
    list.push(cell);
    byRow.set(pos.row, list);
  }
  const rows = [...byRow.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([row, cells]) => `<row r="${row + 1}">${cells.join("")}</row>`)
    .join("");
  const drawingTag = drawing ? `<drawing r:id="rIdDrawing"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows}</sheetData>${drawingTag}</worksheet>`;
}

function chartXml(model: SheetModel, display: Record<string, string>): string {
  const coords = Object.keys(model.cells)
    .map((ref) => ({ ref, ...parseCellRef(ref)! }))
    .filter((entry) => entry.row > 0);
  const categories = coords
    .filter((entry) => entry.col === 0)
    .toSorted((a, b) => a.row - b.row)
    .map((entry) => display[entry.ref] ?? "");
  const seriesCols = [
    ...new Set(coords.filter((entry) => entry.col > 0).map((entry) => entry.col)),
  ].toSorted((a, b) => a - b);
  const cats = categories
    .map((category, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(category)}</c:v></c:pt>`)
    .join("");
  const catXml = `<c:cat><c:strLit><c:ptCount val="${categories.length}"/>${cats}</c:strLit></c:cat>`;
  const series = seriesCols.slice(0, 3).map((col) => {
    const header = display[cellRef(0, col)] || `系列${col}`;
    const values = categories.map((_, row) => Number(display[cellRef(row + 1, col)] ?? "0") || 0);
    const pts = values
      .map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)
      .join("");
    return `<c:ser><c:idx val="${col - 1}"/><c:order val="${col - 1}"/><c:tx><c:v>${xmlEscape(header)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill></c:spPr>${catXml}<c:val><c:numLit><c:ptCount val="${values.length}"/>${pts}</c:numLit></c:val></c:ser>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series.join("")}<c:axId val="1"/><c:axId val="2"/></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
}

function modelHasChart(model: SheetModel): boolean {
  return (model as SheetModel & { chart?: boolean }).chart === true;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0%"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;
}

function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

export function displayCell(value: string | number | boolean | null, format: NumberFormat): string {
  return formatValue(value, format);
}
