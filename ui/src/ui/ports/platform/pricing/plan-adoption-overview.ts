/**
 * 套餐采用数据（向后兼容 re-export；渲染见 pricing-operating-dashboard.ts）。
 */

export { buildPlanAdoptionRows, type PlanAdoptionRow } from "./pricing-operating-dashboard.ts";

export function formatAdoptionShare(sharePercent: number | null): string {
  if (sharePercent === null) {
    return "—";
  }
  if (sharePercent === 0) {
    return "0%";
  }
  if (sharePercent >= 10) {
    return `${Math.round(sharePercent)}%`;
  }
  return `${sharePercent.toFixed(1)}%`;
}
