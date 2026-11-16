/**
 * R4: 6-page operating-review PPTX through the product office_file tool
 * and official office-suite preview/export path. Not a hand-copied PPT.
 *
 * LibreOffice+Poppler pixel previews are recorded when available; otherwise
 * the test still requires a real OOXML zip with 6 slides and version/hash
 * isolation, and the report must label rendering as structured-only (GAP).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeFileTool } from "../agents/tools/office-file-tool.js";
import { renderOfficeToPngs } from "./preview.js";

const tempDirs: string[] = [];
const PREVIEW_DIR = "/tmp/openbot-r2/pptx-preview";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function detailsOf(result: unknown): {
  ok?: boolean;
  artifactId?: string;
  relativePath?: string;
  message?: string;
} {
  const record = result as { details?: Record<string, unknown> };
  return (record.details ?? {}) as {
    ok?: boolean;
    artifactId?: string;
    relativePath?: string;
    message?: string;
  };
}

const SLIDES = [
  { title: "经营复盘封面", bullets: ["第一阶段", "等待用户验收"] },
  {
    title: "收入",
    bullets: ["1月 100", "2月 120", "3月 150", "合计 370"],
    chart: {
      type: "bar" as const,
      categories: ["1月", "2月", "3月"],
      series: [{ name: "收入", values: [100, 120, 150] }],
    },
  },
  { title: "成本", bullets: ["1月 70", "2月 78", "3月 90", "合计 238"] },
  {
    title: "利润",
    bullets: ["1月 30", "2月 42", "3月 60", "合计 132"],
    chart: {
      type: "line" as const,
      categories: ["1月", "2月", "3月"],
      series: [{ name: "利润", values: [30, 42, 60] }],
    },
  },
  { title: "对账", bullets: ["收入 370", "成本 238", "利润 132"] },
  { title: "阶段结论", bullets: ["本阶段交付完成", "等待用户验收"] },
];

describe("R4 operating-review PPTX lifecycle via office_file", () => {
  it("creates 6 slides, previews, exports, edits one slide, and keeps original bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-r4-pptx-"));
    tempDirs.push(root);
    const tool = createOfficeFileTool({
      workspaceDir: root,
      tenantId: "iso-r4",
      userId: "bot-coord",
    });
    const created = await tool.execute("r4-create", {
      action: "create",
      kind: "pptx",
      filename: "operating-review-6p.pptx",
      specJson: JSON.stringify({ slides: SLIDES }),
      render: true,
    });
    const createdDetails = detailsOf(created);
    expect(createdDetails.ok, JSON.stringify(created)).toBe(true);
    expect(createdDetails.artifactId).toBeTruthy();
    expect(createdDetails.relativePath).toBeTruthy();
    const suiteRoot = path.join(root, "output", "office-suite");
    const originalPath = path.join(suiteRoot, createdDetails.relativePath ?? "");
    const originalBytes = await fs.readFile(originalPath);
    expect(originalBytes.length).toBeGreaterThan(1000);
    const originalSha = sha256(originalBytes);
    const zip = await JSZip.loadAsync(originalBytes);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .toSorted((left, right) => left.localeCompare(right));
    expect(slideNames).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide3.xml",
      "ppt/slides/slide4.xml",
      "ppt/slides/slide5.xml",
      "ppt/slides/slide6.xml",
    ]);
    const slide4 = await zip.file("ppt/slides/slide4.xml")?.async("string");
    expect(slide4).toContain("42");
    expect(await zip.file("ppt/slides/slide1.xml")?.async("string")).toContain("经营复盘封面");

    const preview = await tool.execute("r4-preview", {
      action: "preview",
      artifactId: createdDetails.artifactId,
      render: true,
    });
    const previewDetails = detailsOf(preview);
    expect(previewDetails.ok, JSON.stringify(preview)).toBe(true);

    const exported = await tool.execute("r4-export", {
      action: "export",
      artifactId: createdDetails.artifactId,
      filename: "operating-review-6p-download.pptx",
    });
    const exportedDetails = detailsOf(exported);
    expect(exportedDetails.ok, JSON.stringify(exported)).toBe(true);
    const exportedBytes = exportedDetails.relativePath
      ? await fs.readFile(path.join(suiteRoot, exportedDetails.relativePath))
      : originalBytes;
    expect(exportedBytes.length).toBeGreaterThan(1000);
    const exportZip = await JSZip.loadAsync(exportedBytes);
    expect(
      Object.keys(exportZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)),
    ).toHaveLength(6);

    const native = await renderOfficeToPngs(originalBytes, "pptx");
    await fs.mkdir(PREVIEW_DIR, { recursive: true });
    const metaPath = path.join(PREVIEW_DIR, "render-meta.json");
    if (native.available && native.pages && native.pages.length > 0) {
      expect(native.pageCount).toBeGreaterThanOrEqual(6);
      expect(native.nonWhiteRatio ?? 0).toBeGreaterThan(0);
      for (const [index, page] of native.pages.entries()) {
        const dest = path.join(PREVIEW_DIR, `slide-${String(index + 1).padStart(2, "0")}.png`);
        await fs.writeFile(dest, page);
        expect((await fs.stat(dest)).size).toBeGreaterThan(0);
      }
      await fs.writeFile(
        metaPath,
        `${JSON.stringify(
          {
            available: true,
            pageCount: native.pageCount,
            nonWhiteRatio: native.nonWhiteRatio,
            sha256: originalSha,
            renderer: "soffice+pdftoppm",
          },
          null,
          2,
        )}\n`,
      );
    } else {
      await fs.writeFile(
        metaPath,
        `${JSON.stringify(
          {
            available: false,
            reason: native.reason ?? "pixel preview unavailable",
            sha256: originalSha,
            slides: 6,
          },
          null,
          2,
        )}\n`,
      );
    }

    const edited = await tool.execute("r4-edit", {
      action: "edit",
      artifactId: createdDetails.artifactId,
      specJson: JSON.stringify({
        slideIndex: 3,
        title: "利润（修订）",
        bullets: ["1月 30", "2月 42", "3月 60", "合计 132", "已复核"],
      }),
    });
    const editedDetails = detailsOf(edited);
    expect(editedDetails.ok, JSON.stringify(edited)).toBe(true);
    expect(editedDetails.relativePath).toBeTruthy();
    const editedPath = path.join(suiteRoot, editedDetails.relativePath ?? "");
    const editedBytes = await fs.readFile(editedPath);
    const editedSha = sha256(editedBytes);
    expect(editedSha).not.toBe(originalSha);
    const editedZip = await JSZip.loadAsync(editedBytes);
    expect(await editedZip.file("ppt/slides/slide4.xml")?.async("string")).toContain(
      "利润（修订）",
    );
    expect(await editedZip.file("ppt/slides/slide1.xml")?.async("string")).toContain(
      "经营复盘封面",
    );
    expect(await editedZip.file("ppt/slides/slide1.xml")?.async("string")).toBe(
      await zip.file("ppt/slides/slide1.xml")?.async("string"),
    );
    const originalAfter = await fs.readFile(originalPath);
    expect(sha256(originalAfter)).toBe(originalSha);

    const reread = await tool.execute("r4-read", {
      action: "read",
      artifactId: editedDetails.artifactId ?? createdDetails.artifactId,
    });
    const readDetails = detailsOf(reread);
    expect(readDetails.ok, JSON.stringify(reread)).toBe(true);
    expect(JSON.stringify(reread)).toContain("利润（修订）");
    expect(JSON.stringify(reread)).toContain("经营复盘封面");
  });
});
