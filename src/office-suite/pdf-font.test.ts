import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildPdf } from "./pdf.js";
import { loadTtf, resolveCjkFontPath } from "./ttf.js";
it("embeds available OpenType or TrueType CJK outlines and renders Chinese form appearances", () => {
  const filename = resolveCjkFontPath();
  expect(filename).not.toBeNull();
  const font = loadTtf(filename!);
  const generated = buildPdf(
    {
      title: "中文验收",
      pages: [
        { paragraphs: ["没有合规发票不得付款。"] },
        { paragraphs: ["第二页：请核对数量与交付日期。"] },
      ],
      formFields: [{ name: "姓名", value: "张三" }],
    },
    font,
  );
  expect(generated.missingGlyphs).toEqual([]);
  expect(generated.fontEmbedded).toBe(true);
  const structure = generated.bytes.toString("latin1");
  if (font.outlineFormat === "opentype-cff") {
    expect(structure).toContain("/FontFile3");
    expect(structure).toContain("/Subtype /OpenType");
    expect(structure).toContain("/Subtype /CIDFontType0");
  } else {
    expect(structure).toContain("/FontFile2");
    expect(structure).toContain("/Subtype /CIDFontType2");
  }
  expect(structure).toContain("/AP << /N");
  expect(structure).not.toContain("/Helv");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-font-verify-"));
  try {
    const pdf = path.join(root, "verify.pdf");
    fs.writeFileSync(pdf, generated.bytes);
    const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
    expect(info).toMatch(/Pages:\s+2/);
    const text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
    expect(text).toContain("没有合规发票不得付款");
    expect(text).toContain("张三");
    execFileSync(
      "pdftoppm",
      ["-f", "2", "-singlefile", "-scale-to", "300", "-png", pdf, path.join(root, "page")],
      { stdio: "pipe" },
    );
    expect(fs.statSync(path.join(root, "page.png")).size).toBeGreaterThan(1000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
