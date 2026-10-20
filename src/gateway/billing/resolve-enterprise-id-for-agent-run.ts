/**
 * 从 agentId 解析 enterpriseId（agent-run 商业闸口前置）。
 *
 * 独立模块，避免 authorize-commercial-run ↔ agent-run-governance 循环依赖。
 */

export async function resolveEnterpriseIdForAgentRun(input: {
  agentId?: string;
  enterpriseId?: string;
}): Promise<string | null> {
  const explicit = input.enterpriseId?.trim();
  if (explicit) {
    return explicit;
  }
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return null;
  }
  const { resolveAgentRunEntitlementScope } =
    await import("../model-entitlement/resolve-agent-run-scope.js");
  const scope = await resolveAgentRunEntitlementScope({ agentId }).catch(() => null);
  return scope?.tenantId ?? null;
}
