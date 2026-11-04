import { describe, expect, it } from "vitest";
import {
  extractYonyouTplusRows,
  normalizeYonyouTplusVoucherRows,
  yonyouTplusSelectFieldLeaf,
  yonyouTplusSelectFieldPathKey,
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
  it("maps positional Rows using stable path keys (not leaf-only)", () => {
    expect(yonyouTplusSelectFieldLeaf("SaleDelivery.Code")).toBe("Code");
    expect(yonyouTplusSelectFieldPathKey("SaleDelivery.Code")).toBe("Code");
    expect(yonyouTplusSelectFieldPathKey("SaleDelivery.Customer.Name")).toBe("Customer.Name");
    expect(yonyouTplusSelectFieldPathKey("SaleDelivery.SaleDeliveryDetails.Inventory.Code")).toBe(
      "SaleDeliveryDetails.Inventory.Code",
    );
    expect(
      normalizeYonyouTplusVoucherRows(
        [["1", "2026/10/20", "SA-1"]],
        ["SaleDelivery.ID", "SaleDelivery.VoucherDate", "SaleDelivery.Code"],
      ),
    ).toEqual([{ ID: "1", VoucherDate: "2026/10/20", Code: "SA-1" }]);
  });

  it("keeps header Code distinct from detail Inventory.Code", () => {
    const selectFields = [
      "SaleDelivery.ID",
      "SaleDelivery.Code",
      "SaleDelivery.Customer.Name",
      "SaleDelivery.SaleDeliveryDetails.Inventory.Code",
      "SaleDelivery.SaleDeliveryDetails.Inventory.Name",
      "SaleDelivery.SaleDeliveryDetails.Quantity",
      "SaleDelivery.SaleDeliveryDetails.OrigTaxAmount",
    ];
    expect(
      normalizeYonyouTplusVoucherRows(
        [["9", "SA-9", "苏州扇来善往", "10001", "折扇", "2", "180.00"]],
        selectFields,
      ),
    ).toEqual([
      {
        ID: "9",
        Code: "SA-9",
        Customer: { Name: "苏州扇来善往" },
        SaleDeliveryDetails: {
          Inventory: { Code: "10001", Name: "折扇" },
          Quantity: "2",
          OrigTaxAmount: "180.00",
        },
      },
    ]);
  });

  it("leaves object rows unchanged", () => {
    const rows = [{ Code: "SA-2", ID: "2" }];
    expect(normalizeYonyouTplusVoucherRows(rows, ["SaleDelivery.Code"])).toEqual(rows);
  });
});
