import type { GrowthServiceGrant } from "../../../gateway/agent-growth/background-consumer-authority.js";
import type { RuntimeSqlClient } from "./execution.js";
/** Environment selects a principal; only a live operator-provisioned database grant authorizes it. */
export function createGrowthServiceAuthorizer(
  db: RuntimeSqlClient,
  tenantId: string,
  principalId: string,
) {
  if (!tenantId.trim() || !principalId.trim()) {
    throw new Error("Growth service identity required");
  }
  return async (): Promise<GrowthServiceGrant> => {
    const result = await db.query(
      `SELECT user_id,domain,agent_ids FROM runtime_growth_service_grants
    WHERE tenant_id=$1 AND principal_id=$2 AND enabled=true AND expires_at>clock_timestamp()`,
      [tenantId, principalId],
    );
    const row = result.rows[0];
    if (
      !row ||
      typeof row.user_id !== "string" ||
      !row.user_id.trim() ||
      (row.domain !== "enterprise" && row.domain !== "employee") ||
      !Array.isArray(row.agent_ids) ||
      !row.agent_ids.every((id) => typeof id === "string" && id.trim())
    ) {
      throw new Error("Growth service grant missing, expired or invalid");
    }
    return {
      principalId,
      context: { tenantId, userId: row.user_id, domain: row.domain },
      agentIds: row.agent_ids as string[],
    };
  };
}
