import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  isDocxRenderableFilename,
  isPptxRenderableFilename,
  isXlsxRenderableFilename,
  renderDocxBufferToHtml,
  renderOfficePreviewHtml,
  renderPptxBufferToHtml,
  renderXlsxBufferToHtml,
} from "./office-render.ts";

describe("isDocxRenderableFilename", () => {
  it("accepts .docx (any case)", () => {
    expect(isDocxRenderableFilename("报告.docx")).toBe(true);
    expect(isDocxRenderableFilename("Report.DOCX")).toBe(true);
  });

  it("rejects non-docx or extensionless names", () => {
    expect(isDocxRenderableFilename("report.doc")).toBe(false); // legacy binary .doc unsupported
    expect(isDocxRenderableFilename("report.pdf")).toBe(false);
    expect(isDocxRenderableFilename("report.md")).toBe(false);
    expect(isDocxRenderableFilename("report")).toBe(false);
  });
});

describe("isPptxRenderableFilename", () => {
  it("accepts .pptx", () => {
    expect(isPptxRenderableFilename("讲座.pptx")).toBe(true);
    expect(isPptxRenderableFilename("Deck.PPTX")).toBe(true);
  });

  it("rejects legacy .ppt and other types", () => {
    expect(isPptxRenderableFilename("deck.ppt")).toBe(false);
    expect(isPptxRenderableFilename("deck.docx")).toBe(false);
  });
});

describe("isXlsxRenderableFilename", () => {
  it("accepts .xlsx", () => {
    expect(isXlsxRenderableFilename("销售.xlsx")).toBe(true);
    expect(isXlsxRenderableFilename("Sheet.XLSX")).toBe(true);
  });

  it("rejects legacy .xls and other types", () => {
    expect(isXlsxRenderableFilename("sheet.xls")).toBe(false);
    expect(isXlsxRenderableFilename("sheet.docx")).toBe(false);
  });
});

describe("renderDocxBufferToHtml", () => {
  it("returns null for a non-docx / corrupt buffer instead of throwing", async () => {
    const garbage = Buffer.from("not a real docx file", "utf-8");
    await expect(renderDocxBufferToHtml(garbage)).resolves.toBeNull();
  });

  it("returns null for an empty buffer", async () => {
    await expect(renderDocxBufferToHtml(Buffer.alloc(0))).resolves.toBeNull();
  });
});

describe("renderPptxBufferToHtml", () => {
  it("returns null for corrupt buffers", async () => {
    await expect(renderPptxBufferToHtml(Buffer.from("not pptx"))).resolves.toBeNull();
  });

  it("renders slide text into an HTML deck", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>组织新未来</a:t><a:t>数字人同事</a:t></p:sld>`,
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>第二页要点</a:t></p:sld>`,
    );
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const html = await renderPptxBufferToHtml(buffer, "讲座.pptx");
    expect(html).toContain("组织新未来");
    expect(html).toContain("第二页要点");
    expect(html).toContain("第 1 页");
    expect(html).toContain("第 2 页");
  });
});

async function makeMinimalSalesXlsx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
  <si><t>月份</t></si>
  <si><t>销售额</t></si>
  <si><t>1月</t></si>
  <si><t>2月</t></si>
  <si><t>3月</t></si>
</sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>100</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>3</v></c>
      <c r="B3"><v>180</v></c>
    </row>
    <row r="4">
      <c r="A4" t="s"><v>4</v></c>
      <c r="B4"><v>150</v></c>
    </row>
  </sheetData>
</worksheet>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="销售" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("renderXlsxBufferToHtml", () => {
  it("returns null for corrupt buffers", async () => {
    await expect(renderXlsxBufferToHtml(Buffer.from("not xlsx"))).resolves.toBeNull();
  });

  it("renders table cells and an auto SVG chart", async () => {
    const buffer = await makeMinimalSalesXlsx();
    const html = await renderXlsxBufferToHtml(buffer, "销售.xlsx");
    expect(html).toContain("销售.xlsx");
    expect(html).toContain("1月");
    expect(html).toContain("销售额");
    expect(html).toContain("100");
    expect(html).toMatch(/<svg\b/i);
    expect(html).toContain("自动图表");
  });
});

describe("renderOfficePreviewHtml", () => {
  it("keeps xlsx bytes for download while returning HTML", async () => {
    const buffer = await makeMinimalSalesXlsx();
    const rendered = await renderOfficePreviewHtml({ filename: "销售.xlsx", buffer });
    expect(rendered?.keepBytes).toBe(true);
    expect(rendered?.html).toContain("销售额");
  });

  it("returns null for unsupported names", async () => {
    await expect(
      renderOfficePreviewHtml({ filename: "notes.txt", buffer: Buffer.from("hi") }),
    ).resolves.toBeNull();
  });
});
