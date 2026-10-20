// ui/src/ui/controllers/enterprise-incubation/upstream-report.ts

export type ProposalStatusDisplay = {
  status: ProposalStatus;
  label: string;
  color: "gray" | "blue" | "green" | "red" | "orange";
};

export type ProposalStatus = "pending" | "reviewing" | "approved" | "rejected" | "supplement";

/**
 * 提案状态到颜色编码的映射
 */
export function getProposalStatusDisplay(status: ProposalStatus): ProposalStatusDisplay {
  const map: Record<ProposalStatus, ProposalStatusDisplay> = {
    pending: { status: "pending", label: "待审批", color: "gray" },
    reviewing: { status: "reviewing", label: "审批中", color: "blue" },
    approved: { status: "approved", label: "已通过", color: "green" },
    rejected: { status: "rejected", label: "已拒绝", color: "red" },
    supplement: { status: "supplement", label: "需补充材料", color: "orange" },
  };
  return map[status];
}
