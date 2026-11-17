import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildPptx, readPptx } from "./pptx.js";

describe("pptx table slides", () => {
  it("writes a detail table onto a titled slide and reads the cells back", async () => {
    const buffer = await buildPptx({
      slides: [
        { title: "合计", bullets: ["收入 370", "成本 238", "利润 132"] },
        {
          title: "三个月收入、成本与利润明细",
          table: {
            headers: ["月份", "收入", "成本", "利润"],
            rows: [
              ["1月", "100", "70", "30"],
              ["2月", "120", "78", "42"],
              ["3月", "150", "90", "60"],
              ["合计", "370", "238", "132"],
            ],
          },
        },
      ],
    });
    const read = await readPptx(buffer);
    expect(read.slides).toHaveLength(2);
    expect(read.slides[1]?.title).toBe("三个月收入、成本与利润明细");
    expect(read.slides[1]?.table).toEqual({
      headers: ["月份", "收入", "成本", "利润"],
      rows: [
        ["1月", "100", "70", "30"],
        ["2月", "120", "78", "42"],
        ["3月", "150", "90", "60"],
        ["合计", "370", "238", "132"],
      ],
    });
    const zip = await JSZip.loadAsync(buffer);
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string");
    expect(slide2).toContain("<a:tbl>");
    expect(slide2).toContain("30");
    expect(slide2).toContain("42");
    expect(slide2).toContain("60");
    expect(slide2).toContain("370");
    expect(slide2).toContain("238");
    expect(slide2).toContain("132");
    expect(read.slides[0]?.bullets).toEqual(["收入 370", "成本 238", "利润 132"]);
  });
});
