import { describe, expect, it } from "vitest";
import { applyClassificationMasking } from "./masking-engine.js";
import type { EnterpriseDataStore, FieldClassification } from "./types.js";

function emptyStore(overrides?: Partial<EnterpriseDataStore>): EnterpriseDataStore {
  return {
    fieldClassifications: {},
    maskingPolicies: {},
    classificationRuntimeConfigs: {},
    ...overrides,
  } as EnterpriseDataStore;
}

function publicField(
  partial: Partial<FieldClassification> & Pick<FieldClassification, "fieldPath">,
): FieldClassification {
  const now = "2026-11-04T00:00:00.000Z";
  return {
    classificationId: `cls-${partial.actionKey ?? "erp.warehouse.query"}-${partial.fieldPath}`,
    tenantId: "001",
    connectorId: "erp-yonyou-tplus",
    actionKey: "erp.warehouse.query",
    version: "v1",
    classification: "PUBLIC",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("applyClassificationMasking array records", () => {
  const ref = {
    connectorId: "erp-yonyou-tplus",
    actionKey: "erp.warehouse.query",
    version: "v1",
  } as const;

  it("does not collapse unclassified records array to *** (yonyou simulated shape)", () => {
    const payload = { records: [{ Code: "01", Name: "模拟仓库" }] };
    const result = applyClassificationMasking({
      store: emptyStore(),
      tenantId: "001",
      ref,
      payload,
    });
    expect(result.data).toEqual({
      records: [{ Code: "***", Name: "***" }],
    });
    expect(Array.isArray((result.data as { records: unknown }).records)).toBe(true);
    expect((result.data as { records: unknown[] }).records.length).toBe(1);
  });

  it("keeps Code/Name when seeded as records[*] PUBLIC", () => {
    const store = emptyStore({
      fieldClassifications: {
        a: publicField({ fieldPath: "records[*].Code" }),
        b: publicField({ fieldPath: "records[*].Name" }),
      },
    });
    const payload = { records: [{ Code: "01", Name: "模拟仓库" }] };
    const result = applyClassificationMasking({
      store,
      tenantId: "001",
      ref,
      payload,
    });
    expect(result.data).toEqual(payload);
    expect(result.maskedFields).toEqual([]);
  });

  it("keeps partner Code/Name/PartnerType when seeded PUBLIC", () => {
    const actionKey = "erp.partner.query_page";
    const store = emptyStore({
      fieldClassifications: {
        a: publicField({ actionKey, fieldPath: "records[*].Code" }),
        b: publicField({ actionKey, fieldPath: "records[*].Name" }),
        c: publicField({ actionKey, fieldPath: "records[*].PartnerType.Code" }),
        d: publicField({ actionKey, fieldPath: "records[*].PartnerType.Name" }),
      },
    });
    const payload = {
      records: [
        {
          Code: "001",
          Name: "山水扇业",
          PartnerType: { Code: "01", Name: "客户" },
          MobilePhone: "13800138000",
        },
      ],
    };
    const result = applyClassificationMasking({
      store,
      tenantId: "001",
      ref: {
        connectorId: "erp-yonyou-tplus",
        actionKey,
        version: "v1",
      },
      payload,
    });
    expect(result.data).toEqual({
      records: [
        {
          Code: "001",
          Name: "山水扇业",
          PartnerType: { Code: "01", Name: "客户" },
          MobilePhone: "***",
        },
      ],
    });
  });

  it("keeps sale_delivery Code/VoucherDate/ID when seeded PUBLIC", () => {
    const actionKey = "erp.sale_delivery.query_list";
    const store = emptyStore({
      fieldClassifications: {
        a: publicField({ actionKey, fieldPath: "records[*].Code" }),
        b: publicField({ actionKey, fieldPath: "records[*].ID" }),
        c: publicField({ actionKey, fieldPath: "records[*].VoucherDate" }),
      },
    });
    const payload = {
      records: [{ ID: "1", VoucherDate: "2026/10/20", Code: "SA-1", BankAccount: "622200001" }],
    };
    const result = applyClassificationMasking({
      store,
      tenantId: "001",
      ref: {
        connectorId: "erp-yonyou-tplus",
        actionKey,
        version: "v1",
      },
      payload,
    });
    expect(result.data).toEqual({
      records: [{ ID: "1", VoucherDate: "2026/10/20", Code: "SA-1", BankAccount: "***" }],
    });
  });

  it("keeps sale_delivery analytics path keys when seeded PUBLIC", () => {
    const actionKey = "erp.sale_delivery.query_list";
    const store = emptyStore({
      fieldClassifications: {
        a: publicField({ actionKey, fieldPath: "records[*].Code" }),
        b: publicField({ actionKey, fieldPath: "records[*].Customer.Name" }),
        c: publicField({ actionKey, fieldPath: "records[*].SaleDeliveryDetails.Quantity" }),
        d: publicField({
          actionKey,
          fieldPath: "records[*].SaleDeliveryDetails.OrigTaxAmount",
        }),
        e: publicField({
          actionKey,
          fieldPath: "records[*].SaleDeliveryDetails.Inventory.Name",
        }),
      },
    });
    const payload = {
      records: [
        {
          Code: "SA-1",
          Customer: { Name: "苏州扇来善往" },
          SaleDeliveryDetails: {
            Inventory: { Name: "宣纸扇" },
            Quantity: "2",
            OrigTaxAmount: "180.00",
          },
          BankAccount: "622200001",
        },
      ],
    };
    const result = applyClassificationMasking({
      store,
      tenantId: "001",
      ref: {
        connectorId: "erp-yonyou-tplus",
        actionKey,
        version: "v1",
      },
      payload,
    });
    expect(result.data).toEqual({
      records: [
        {
          Code: "SA-1",
          Customer: { Name: "苏州扇来善往" },
          SaleDeliveryDetails: {
            Inventory: { Name: "宣纸扇" },
            Quantity: "2",
            OrigTaxAmount: "180.00",
          },
          BankAccount: "***",
        },
      ],
    });
  });

  it("keeps inventory cost/price when seeded PUBLIC", () => {
    const actionKey = "erp.inventory.query_page";
    const store = emptyStore({
      fieldClassifications: {
        a: publicField({ actionKey, fieldPath: "records[*].Code" }),
        b: publicField({ actionKey, fieldPath: "records[*].Name" }),
        c: publicField({ actionKey, fieldPath: "records[*].InvSCost" }),
        d: publicField({ actionKey, fieldPath: "records[*].LatestCost" }),
        e: publicField({ actionKey, fieldPath: "records[*].RetailPriceNew" }),
      },
    });
    const result = applyClassificationMasking({
      store,
      tenantId: "001",
      ref: {
        connectorId: "erp-yonyou-tplus",
        actionKey,
        version: "v1",
      },
      payload: {
        records: [
          {
            Code: "INV-1",
            Name: "宣纸扇",
            InvSCost: "12.5",
            LatestCost: "13",
            RetailPriceNew: "88",
            BankAccount: "622200001",
          },
        ],
      },
    });
    expect(result.data).toEqual({
      records: [
        {
          Code: "INV-1",
          Name: "宣纸扇",
          InvSCost: "12.5",
          LatestCost: "13",
          RetailPriceNew: "88",
          BankAccount: "***",
        },
      ],
    });
  });
});
