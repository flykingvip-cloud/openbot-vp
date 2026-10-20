import { describe, expect, it } from "vitest";
import { formatOrganizationBulkSeatDeletionNotice } from "../views/enterprise-organization-surface.ts";

describe("formatOrganizationBulkSeatDeletionNotice", () => {
  it("summarizes full success", () => {
    expect(
      formatOrganizationBulkSeatDeletionNotice({
        succeeded: 2,
        failed: [],
      }),
    ).toBe("已删除 2 个岗位。");
  });

  it("summarizes mixed success and failure", () => {
    expect(
      formatOrganizationBulkSeatDeletionNotice({
        succeeded: 1,
        failed: [{ name: "待激活岗", error: "删除失败" }],
      }),
    ).toBe("已删除 1 个岗位；1 个失败：待激活岗（删除失败）");
  });

  it("summarizes total failure", () => {
    expect(
      formatOrganizationBulkSeatDeletionNotice({
        succeeded: 0,
        failed: [
          { name: "A", error: "网络错误" },
          { name: "B", error: "权限不足" },
        ],
      }),
    ).toBe("批量删除失败：A（网络错误）；B（权限不足）");
  });
});
