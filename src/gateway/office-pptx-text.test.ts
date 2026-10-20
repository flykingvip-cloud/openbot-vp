import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  extractPptxSlides,
  formatOfficeSlideDraft,
  parseOfficeSlideDraft,
  parseOfficeSlidesInput,
  patchPptxSlideTexts,
} from "./office-pptx-text.js";

async function makeDeck(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>组织新未来</a:t><a:t>数字人同事</a:t></p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>第二页要点</a:t></p:sld>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("office pptx text round-trip", () => {
  it("extracts, formats, parses, and writes text back into the package", async () => {
    const original = await makeDeck();
    const slides = await extractPptxSlides(original);
    expect(slides).toEqual([
      { index: 1, lines: ["组织新未来", "数字人同事"] },
      { index: 2, lines: ["第二页要点"] },
    ]);
    const draft = formatOfficeSlideDraft(slides ?? []);
    expect(draft).toContain("# 第 1 页");
    const edited = parseOfficeSlideDraft(
      draft.replace("组织新未来", "通州后勤方案").replace("第二页要点", "编制说明"),
    );
    const patched = await patchPptxSlideTexts(original, edited);
    expect(patched).toBeTruthy();
    expect(await extractPptxSlides(patched!)).toEqual([
      { index: 1, lines: ["通州后勤方案", "数字人同事"] },
      { index: 2, lines: ["编制说明"] },
    ]);
  });

  it("appends extra lines onto a slide", async () => {
    const original = await makeDeck();
    const patched = await patchPptxSlideTexts(original, [
      { index: 1, lines: ["组织新未来", "数字人同事", "新增要点"] },
    ]);
    expect(await extractPptxSlides(patched!)).toEqual([
      { index: 1, lines: ["组织新未来", "数字人同事", "新增要点"] },
      { index: 2, lines: ["第二页要点"] },
    ]);
  });

  it("parses structured slide input from the preview editor", () => {
    expect(parseOfficeSlidesInput([{ index: 1, lines: ["  通州后勤方案  ", ""] }])).toEqual([
      { index: 1, lines: ["通州后勤方案"] },
    ]);
    expect(parseOfficeSlidesInput([])).toBeNull();
  });
});
