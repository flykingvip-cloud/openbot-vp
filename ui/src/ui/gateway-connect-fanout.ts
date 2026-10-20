import { isEnterpriseSurfaceTab } from "./ports/enterprise/views/enterprise-surface-types.ts";

/**
 * Enterprise tabs hydrate via `loadEnterpriseTabShell`; skip employee/platform
 * eager fan-out (spaces / tools / nodes / devices / workbench polls).
 */
export function shouldUseLeanGatewayConnectFanout(tab: string): boolean {
  const normalized = tab === "enterpriseBudget" ? "enterpriseUsage" : tab;
  return isEnterpriseSurfaceTab(normalized);
}
