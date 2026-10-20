import { describe, expect, it } from "vitest";
import {
  DAIBAI_CATALOG_TEMPLATE_ID,
  DAIBAI_DEFAULT_TEMPLATE_ID,
  resolveDaibaiCatalogTemplateId,
} from "./daibai-catalog-template-id.ts";

describe("daibai catalog → templateId mapping", () => {
  it("snapshots the Stage A pilot map", () => {
    expect(DAIBAI_CATALOG_TEMPLATE_ID).toEqual({
      email: "personal_mail_assistant",
      crm: "sales_assistant",
      contract: "contract_reviewer",
    });
    expect(DAIBAI_DEFAULT_TEMPLATE_ID).toBe("generic_worker");
  });

  it("resolves pilots and falls back for unknown / empty / custom", () => {
    expect(resolveDaibaiCatalogTemplateId("email")).toBe("personal_mail_assistant");
    expect(resolveDaibaiCatalogTemplateId("crm")).toBe("sales_assistant");
    expect(resolveDaibaiCatalogTemplateId("contract")).toBe("contract_reviewer");
    expect(resolveDaibaiCatalogTemplateId("calendar")).toBe("generic_worker");
    expect(resolveDaibaiCatalogTemplateId("custom")).toBe("generic_worker");
    expect(resolveDaibaiCatalogTemplateId("")).toBe("generic_worker");
    expect(resolveDaibaiCatalogTemplateId(null)).toBe("generic_worker");
    expect(resolveDaibaiCatalogTemplateId(undefined)).toBe("generic_worker");
    expect(resolveDaibaiCatalogTemplateId("  email  ")).toBe("personal_mail_assistant");
  });
});
