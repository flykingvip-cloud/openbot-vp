import { describe, expect, it } from "vitest";
import { buildOrganizationImportPreview } from "./enterprise-org-import-preview.ts";

describe("buildOrganizationImportPreview", () => {
  it("builds nested preview tree and flags invalid rows", () => {
    const preview = buildOrganizationImportPreview([
      ["姓名", "邮箱", "部门", "岗位", "上级部门", "岗位职责"],
      ["Alice", "alice@example.com", "华东区", "销售总监", "销售部", "负责华东销售"],
      ["", "bad-email", "销售部", "销售专员", "", ""],
    ]);

    expect(preview.validRows).toHaveLength(1);
    expect(preview.validRows[0]?.teamLabel).toBe("销售部/华东区");
    expect(preview.errorCount).toBe(1);
    expect(preview.tree[0]?.fullPath).toBe("销售部");
    expect(preview.tree[0]?.childDepartments[0]?.fullPath).toBe("销售部/华东区");
    expect(preview.rows[1]?.errorMessage).toBeTruthy();
    expect(preview.structureSyncPlan.paths).toEqual(["销售部", "销售部/华东区"]);
  });

  it("rejects email values used as seat title or employee name", () => {
    const preview = buildOrganizationImportPreview([
      ["姓名", "邮箱", "部门", "岗位"],
      ["368809901@qq.com", "368809901@qq.com", "销售部", "368809901@qq.com"],
    ]);
    expect(preview.validRows).toHaveLength(0);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.errorMessage).toBe("岗位和姓名不能填写邮箱");
  });
});
