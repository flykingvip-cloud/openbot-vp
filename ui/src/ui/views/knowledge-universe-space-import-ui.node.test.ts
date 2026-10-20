import { describe, expect, it } from "vitest";
import { parseWizardSteps } from "./knowledge-universe-space-import-ui.ts";

describe("knowledge-universe-space-import-ui", () => {
  it("parseWizardSteps splits arrow-delimited hints", () => {
    expect(parseWizardSteps("选择连接器 → 配置凭证 → 测试连通性 → 绑定到当前空间。")).toEqual([
      "选择连接器",
      "配置凭证",
      "测试连通性",
      "绑定到当前空间",
    ]);
  });
});
