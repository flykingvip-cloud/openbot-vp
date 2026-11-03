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

function publicField(partial: Partial<FieldClassification> & Pick<FieldClassification, "fieldPath">): FieldClassification {
  const now = "2026-11-04T00:00:00.000Z";
  return {
    classificationId: `cls-${partial.fieldPath}`,
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
    expect(((result.data as { records: unknown[] }).records).length).toBe(1);
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
});
