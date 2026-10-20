/** 岗位交接状态中文标签：治理队列 / 岗位详情 / 交接编辑器共用同一份。 */
export function handoverStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "asset_review":
      return "资产审查中";
    case "pending_approval":
      return "待批准冻结";
    case "frozen":
      return "待绑定继任人";
    case "rebound":
      return "已完成继任绑定";
    case "completed":
      return "已完成";
    default:
      return status;
  }
}
