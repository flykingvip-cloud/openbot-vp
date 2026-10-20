/** zh-CN labels for governance approval rows, including pack_skill_review. */

export function governanceApprovalStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待审批";
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已撤回";
    default:
      return status;
  }
}

/** Only MCP mapping has a safe explicit provision path inside decide. */
export function governanceCategorySupportsApproveAndProvision(category: string): boolean {
  return category === "mcp_tool_mapping";
}

export const MCP_APPROVE_AND_PROVISION_RISK_ZH =
  "批准并开通会在这次决定里写入 MCP 工具映射。申请若仍需席位授权，将按申请单上的席位授予该能力。确认后才会执行。套餐不变。某一步失败时，审批保持已批准，开通状态为失败，可重试开通，已做出的决定保持不变。";

export function governanceFulfillmentStatusLabel(status: string): string {
  switch (status) {
    case "not_required":
      return "无需开通";
    case "pending_admin_save":
      return "已批准（待管理员开通）";
    case "fulfilled":
      return "已开通";
    case "failed":
      return "开通失败";
    default:
      return status;
  }
}
