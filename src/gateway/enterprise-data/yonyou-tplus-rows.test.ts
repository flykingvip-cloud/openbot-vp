import { describe, expect, it } from "vitest";
import {
  extractYonyouTplusRows,
  normalizeYonyouTplusVoucherRows,
  yonyouTplusSelectFieldLeaf,
} from "./yonyou-tplus-rows.js";

describe("extractYonyouTplusRows", () => {
  it("unwraps data.Rows from a Chanjet voucher list body", () => {
    expect(
      extractYonyouTplusRows({
        code: "0",
        data: { Rows: [["1", "2026/10/20", "SA-1"]] },
      }),
    ).toEqual([["1", "2026/10/20", "SA-1"]]);
  });
});

describe("normalizeYonyouTplusVoucherRows", () => {
  it("maps positional Rows using selectFields leaf names", () => {
    expect(yonyouTplusSelectFieldLeaf("SaleDelivery.Code")).toBe("Code");
    expect(
      normalizeYonyouTplusVoucherRows(
        [["1", "2026/10/20", "SA-1"]],
        ["SaleDelivery.ID", "SaleDelivery.VoucherDate", "SaleDelivery.Code"],
      ),
    ).toEqual([{ ID: "1", VoucherDate: "2026/10/20", Code: "SA-1" }]);
  });

  it("leaves object rows unchanged", () => {
    const rows = [{ Code: "SA-2", ID: "2" }];
    expect(normalizeYonyouTplusVoucherRows(rows, ["SaleDelivery.Code"])).toEqual(rows);
  });
});
