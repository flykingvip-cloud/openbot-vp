import { describe, expect, it } from "vitest";
import {
  MCP_APPROVE_AND_PROVISION_RISK_ZH,
  governanceApprovalStatusLabel,
  governanceCategorySupportsApproveAndProvision,
  governanceFulfillmentStatusLabel,
} from "./governance-approval-labels.ts";

describe("governance approval labels", () => {
  it("renders pack skill review states in Chinese", () => {
    expect(governanceApprovalStatusLabel("pending")).toBe("待审批");
    expect(governanceApprovalStatusLabel("approved")).toBe("已批准");
    expect(governanceFulfillmentStatusLabel("pending_admin_save")).toBe("已批准（待管理员开通）");
    expect(governanceFulfillmentStatusLabel("fulfilled")).toBe("已开通");
    expect(governanceFulfillmentStatusLabel("failed")).toBe("开通失败");
    expect(governanceCategorySupportsApproveAndProvision("mcp_tool_mapping")).toBe(true);
    expect(governanceCategorySupportsApproveAndProvision("oi_enrollment")).toBe(false);
    expect(governanceCategorySupportsApproveAndProvision("pack_skill_review")).toBe(false);
    expect(MCP_APPROVE_AND_PROVISION_RISK_ZH).toContain("批准并开通");
    expect(MCP_APPROVE_AND_PROVISION_RISK_ZH).toContain("套餐不变");
  });
});
