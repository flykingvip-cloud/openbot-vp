import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderDocxBufferToHtml } from "../gateway/office-render.js";
import { buildDocx } from "./docx.js";
import { renderOfficeToPngs } from "./preview.js";
import type { OfficeLogEvent, OfficePrincipal } from "./scope.js";
import { createOfficeSuite, type OfficeResult } from "./service.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const tenantA = (userId: string, admin = false): OfficePrincipal => ({
  tenantId: "tenant-a",
  userId,
  tenantAdmin: admin,
});
const tenantB: OfficePrincipal = { tenantId: "tenant-b", userId: "user-b" };
const individual: OfficePrincipal = { tenantId: null, userId: "person-1" };

async function withSuite(run: (root: string, logs: OfficeLogEvent[]) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-suite-"));
  const logs: OfficeLogEvent[] = [];
  try {
    await run(root, logs);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function textOf(result: OfficeResult): string {
  return JSON.stringify(result.details ?? {});
}

describe("office file suite", { timeout: 90_000 }, () => {
  it("creates a Chinese multi-page Word file, edits one paragraph, and keeps the rest", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const rows = Array.from({ length: 50 }, (_, index) => [
        `项目${index + 1}`,
        "跨页说明：采购、交付与验收需要保留中文换行。",
        index % 2 === 0 ? "进行中" : "已完成",
      ]);
      const created = await suite.execute(tenantA("user-a"), {
        action: "create",
        kind: "docx",
        filename: "季度报告",
        spec: {
          blocks: [
            { type: "paragraph", style: "title", text: "华北区季度报告" },
            { type: "paragraph", text: "这段需要改写。" },
            { type: "paragraph", text: "这段必须原样保留。" },
            { type: "table", headers: ["项目", "说明", "状态"], rows },
          ],
        },
      });
      expect(created.ok).toBe(true);
      expect(textOf(created)).toContain("华北区季度报告");
      const summary = created.details?.summary as { pageEstimate?: number } | undefined;
      expect(summary?.pageEstimate ?? 0).toBeGreaterThanOrEqual(2);

      const bytes = await fs.readFile(path.join(root, created.relativePath ?? ""));
      const html = await renderDocxBufferToHtml(bytes);
      expect(html).toContain("跨页说明");
      expect(html).toContain("项目50");

      const originalSha = created.details?.sha256;
      const edited = await suite.execute(tenantA("user-a"), {
        action: "edit",
        artifactId: created.artifactId,
        spec: {
          paragraphIndex: 1,
          text: "这段已经修订。",
          tracked: true,
          author: "审阅人",
          comment: "请确认口径。",
        },
      });
      expect(edited.ok).toBe(true);
      expect(textOf(edited)).toContain("这段已经修订。");
      expect(textOf(edited)).toContain("这段必须原样保留。");
      expect(textOf(edited)).toContain("项目50");
      expect(textOf(edited)).toContain("请确认口径。");
      const editedRead = edited.details?.summary as {
        insertions: string[];
        deletions: string[];
        comments: string[];
      };
      expect(editedRead.insertions).toContain("这段已经修订。");
      expect(editedRead.deletions).toContain("这段需要改写。");
      expect(editedRead.comments).toContain("请确认口径。");

      const originalAfter = await fs.readFile(path.join(root, created.relativePath ?? ""));
      const { createHash } = await import("node:crypto");
      expect(createHash("sha256").update(originalAfter).digest("hex")).toBe(originalSha);

      const failed = await suite.execute(tenantA("user-a"), {
        action: "edit",
        artifactId: created.artifactId,
        spec: { paragraphIndex: 40, text: "不会写入" },
      });
      expect(failed.ok).toBe(false);
      expect(
        createHash("sha256")
          .update(await fs.readFile(path.join(root, created.relativePath ?? "")))
          .digest("hex"),
      ).toBe(originalSha);

      const native = await renderOfficeToPngs(bytes, "docx");
      if (native.available) {
        expect(native.pageCount).toBeGreaterThanOrEqual(2);
        expect(native.nonWhiteRatio ?? 0).toBeGreaterThan(0.01);
      }
    });
  });

  it("edits one slide and preserves the other slide, chart, and image", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const created = await suite.execute(tenantA("user-a"), {
        action: "create",
        kind: "pptx",
        spec: {
          slides: [
            { title: "封面", bullets: ["不要改这一页"] },
            {
              title: "销售趋势",
              bullets: ["华北领先"],
              imagePngBase64: PNG,
              chart: {
                type: "bar",
                categories: ["华北", "华南"],
                series: [{ name: "销量", values: [12, 9] }],
              },
            },
          ],
        },
      });
      expect(created.ok).toBe(true);
      const before = await fs.readFile(path.join(root, created.relativePath ?? ""));
      const zipBefore = await JSZip.loadAsync(before);
      const slide1Before = await zipBefore.file("ppt/slides/slide1.xml")?.async("string");
      const edited = await suite.execute(tenantA("user-a"), {
        action: "edit",
        artifactId: created.artifactId,
        spec: { slideIndex: 1, title: "销售趋势（修订）", bullets: ["华南追平"] },
      });
      expect(textOf(edited)).toContain("销售趋势（修订）");
      expect(textOf(edited)).toContain("不要改这一页");
      const after = await fs.readFile(path.join(root, edited.relativePath ?? ""));
      const zipAfter = await JSZip.loadAsync(after);
      expect(await zipAfter.file("ppt/slides/slide1.xml")?.async("string")).toBe(slide1Before);
      expect(await zipAfter.file("ppt/charts/chart2.xml")?.async("string")).toContain("华北");
      expect(zipAfter.file("ppt/media/image2.png")).toBeTruthy();
      const native = await renderOfficeToPngs(after, "pptx");
      if (native.available) {
        expect(native.pageCount).toBeGreaterThanOrEqual(2);
        expect(native.nonWhiteRatio ?? 0).toBeGreaterThan(0);
      }
    });
  });

  it("imports csv, recalculates after an input change, and keeps number formats", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const created = await suite.execute(tenantA("user-a"), {
        action: "create",
        kind: "xlsx",
        spec: {
          csv: { name: "导入", text: "名称,数量\n苹果,2\n梨,3\n", delimiter: "," },
          sheets: [
            {
              name: "预算",
              columns: [
                { header: "项目", format: "text" },
                { header: "数量", format: "number" },
                { header: "单价", format: "number" },
                { header: "金额", format: "number" },
                { header: "占比", format: "percent" },
              ],
              rows: [
                ["华北", 2, 3, null, null],
                ["华南", 4, 5, null, null],
              ],
              formulas: [
                { cell: "D2", formula: "B2*C2+SUM(B2:C2)", format: "number" },
                { cell: "E2", formula: "B2/10", format: "percent" },
              ],
              chart: true,
            },
          ],
        },
      });
      expect(created.ok).toBe(true);
      const summary = created.details?.summary as {
        sheets: { name: string; cells: Record<string, { display: string; formula?: string }> }[];
        charts: number;
      };
      const budget = summary.sheets.find((sheet) => sheet.name === "预算");
      expect(budget?.cells.D2?.display).toBe("11.00");
      expect(budget?.cells.E2?.display).toBe("20%");
      expect(
        summary.sheets.some((sheet) => sheet.name === "导入" && sheet.cells.A2?.display === "苹果"),
      ).toBe(true);
      expect(summary.charts).toBe(1);
      const zip = await JSZip.loadAsync(
        await fs.readFile(path.join(root, created.relativePath ?? "")),
      );
      expect(await zip.file("xl/charts/chart1.xml")?.async("string")).toContain("华北");

      const edited = await suite.execute(tenantA("user-a"), {
        action: "edit",
        artifactId: created.artifactId,
        spec: { sheet: "预算", cells: [{ cell: "B2", value: 4 }] },
      });
      const next = edited.details?.summary as typeof summary;
      const budgetNext = next.sheets.find((sheet) => sheet.name === "预算");
      expect(budgetNext?.cells.D2?.display).toBe("19.00");
      expect(budgetNext?.cells.E2?.display).toBe("40%");
      expect(budgetNext?.cells.A2?.display).toBe("华北");
      expect(budgetNext?.cells.C2?.display).toBe("3.00");
      const chart = await JSZip.loadAsync(
        await fs.readFile(path.join(root, edited.relativePath ?? "")),
      );
      expect(await chart.file("xl/charts/chart1.xml")?.async("string")).toContain(">4<");
    });
  });

  it("generates a multi-page Chinese PDF with a form field and extracts the text", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const created = await suite.execute(individual, {
        action: "create",
        kind: "pdf",
        spec: {
          title: "验收单",
          pages: [
            { paragraphs: ["第一页：中文采购验收说明。", "供应商：华北示例公司"] },
            { paragraphs: ["第二页：请核对数量与交付日期。"] },
          ],
          formFields: [{ name: "姓名", value: "张三" }],
        },
      });
      expect(created.ok).toBe(true);
      expect(created.details?.missingGlyphs).toEqual([]);
      const summary = created.details?.summary as {
        pages: string[];
        fields: { name: string; value: string }[];
        pageCount: number;
      };
      expect(summary.pageCount).toBe(2);
      expect(summary.pages.join("\n")).toContain("中文采购验收说明");
      expect(summary.pages[1]).toContain("第二页");
      expect(summary.fields).toEqual([{ name: "姓名", value: "张三" }]);
      const native = await renderOfficeToPngs(
        await fs.readFile(path.join(root, created.relativePath ?? "")),
        "pdf",
      );
      if (native.available) {
        expect(native.pageCount).toBe(2);
        expect(native.nonWhiteRatio ?? 0).toBeGreaterThan(0.01);
      }
    });
  });

  it("isolates files and templates across two tenants and an individual user", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const created = await suite.execute(tenantA("user-a"), {
        action: "create",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "租户甲的秘密正文" }] },
      });
      const deniedSameTenant = await suite.execute(tenantA("user-a2"), {
        action: "read",
        artifactId: created.artifactId,
      });
      const deniedOtherTenant = await suite.execute(tenantB, {
        action: "export",
        artifactId: created.artifactId,
      });
      const deniedIndividual = await suite.execute(individual, {
        action: "preview",
        artifactId: created.artifactId,
      });
      expect(deniedSameTenant.ok).toBe(false);
      expect(deniedOtherTenant.ok).toBe(false);
      expect(deniedIndividual.ok).toBe(false);
      expect(textOf(deniedOtherTenant)).not.toContain("租户甲的秘密正文");

      const personal = await suite.execute(tenantA("user-a"), {
        action: "template_save",
        name: "个人纪要",
        scope: "personal",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "个人模板" }] },
      });
      const listedByOther = await suite.execute(tenantA("user-a2"), { action: "template_list" });
      expect(JSON.stringify(listedByOther.details)).not.toContain(personal.details?.templateId);

      const notAdmin = await suite.execute(tenantA("user-a"), {
        action: "template_save",
        name: "企业模板",
        scope: "tenant",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "企业" }] },
      });
      expect(notAdmin.ok).toBe(false);

      const tenantTemplate = await suite.execute(tenantA("admin-a", true), {
        action: "template_save",
        name: "企业纪要",
        scope: "tenant",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "企业共享但只限本租户" }] },
      });
      expect(tenantTemplate.ok).toBe(true);
      const peer = await suite.execute(tenantA("user-a2"), {
        action: "template_list",
        scope: "tenant",
      });
      expect(JSON.stringify(peer.details)).toContain("企业纪要");
      const outsider = await suite.execute(tenantB, {
        action: "template_use",
        templateId: String(tenantTemplate.details?.templateId),
      });
      expect(outsider.ok).toBe(false);

      const platformDenied = await suite.execute(tenantA("admin-a", true), {
        action: "template_save",
        name: "平台模板",
        scope: "platform",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "平台" }] },
      });
      expect(platformDenied.ok).toBe(false);
      const platform = await suite.execute(
        { tenantId: null, userId: "platform-admin", platformAdmin: true },
        {
          action: "template_save",
          name: "平台纪要",
          scope: "platform",
          kind: "docx",
          spec: { blocks: [{ type: "paragraph", text: "平台可复用" }] },
        },
      );
      const used = await suite.execute(individual, {
        action: "template_use",
        templateId: String(platform.details?.templateId),
        spec: { blocks: [{ type: "paragraph", text: "平台模板已改写" }] },
      });
      expect(used.ok).toBe(true);
      expect(textOf(used)).toContain("平台模板已改写");
      expect(textOf(used)).not.toContain("平台可复用");
    });
  });

  it("does not log document text and reports Excel live as disconnected", async () => {
    await withSuite(async (root, logs) => {
      const suite = createOfficeSuite({
        rootDir: root,
        logger: (event) => logs.push(event),
      });
      const created = await suite.execute(individual, {
        action: "create",
        kind: "docx",
        spec: { blocks: [{ type: "paragraph", text: "正文口令 sk-live-secret-value" }] },
      });
      expect(created.ok).toBe(true);
      expect(JSON.stringify(logs)).not.toContain("sk-live-secret-value");
      expect(JSON.stringify(logs)).not.toContain("正文口令");
      const live = await suite.execute(individual, { action: "excel_live", liveOp: "edit" });
      expect(live.ok).toBe(false);
      expect(live.status).toBe("未接入");
      const status = await suite.execute(individual, { action: "connector_status" });
      const connectors = status.details?.connectors as { id: string; status: string }[];
      expect(connectors.map((entry) => `${entry.id}:${entry.status}`).toSorted()).toEqual([
        "excel-live:未接入",
        "google-workspace:未接入",
      ]);
      const matrix = await suite.execute(individual, { action: "capability" });
      expect(JSON.stringify(matrix.details)).toContain("未接入");
      const blobs = await fs.readdir(path.join(root, "individual", "person-1", "blobs"));
      expect(blobs).toHaveLength(1);
    });
  });

  it("keeps an uploaded macro package intact and does not execute it", async () => {
    await withSuite(async (root) => {
      const suite = createOfficeSuite({ rootDir: root });
      const docx = await buildDocx({ blocks: [{ type: "paragraph", text: "含宏原件" }] });
      const zip = await JSZip.loadAsync(docx);
      zip.file("word/vbaProject.bin", Buffer.from("macro-bytes"));
      const packed = await zip.generateAsync({ type: "nodebuffer" });
      const imported = await suite.execute(individual, {
        action: "import",
        filename: "macro.docx",
        bytes: packed,
      });
      expect(imported.ok).toBe(true);
      expect(imported.details?.macrosPresent).toBe(true);
      expect(imported.details?.macrosExecuted).toBe(false);
      const stored = await fs.readFile(path.join(root, imported.relativePath ?? ""));
      const storedZip = await JSZip.loadAsync(stored);
      expect(storedZip.file("word/vbaProject.bin")).toBeTruthy();
      const edited = await suite.execute(individual, {
        action: "edit",
        artifactId: imported.artifactId,
        spec: { paragraphIndex: 0, text: "已去掉宏的新版本" },
      });
      const editedZip = await JSZip.loadAsync(
        await fs.readFile(path.join(root, edited.relativePath ?? "")),
      );
      expect(editedZip.file("word/vbaProject.bin")).toBeFalsy();
      expect(await storedZip.file("word/vbaProject.bin")?.async("string")).toBe("macro-bytes");
    });
  });
});
