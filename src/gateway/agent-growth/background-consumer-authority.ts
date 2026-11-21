import type { OpenBotConfig } from "../../config/config.js";
import type { TenantContext } from "../tenant-context.js";
import { assertWithinTenantRoot, resolveTenantAgentDirForContext } from "../tenant-store-paths.js";
import { createOperationalGrowthConsumer } from "./operational-event-consumer.js";

export type GrowthServiceGrant = {
  principalId: string;
  context: TenantContext;
  agentIds: readonly string[];
};
/** Grant comes from trusted service authorization; revalidated for each event. */
export function createBackgroundGrowthConsumer(input: {
  cfg: OpenBotConfig;
  tenantId: string;
  authorize: () => Promise<GrowthServiceGrant>;
}) {
  return createOperationalGrowthConsumer({
    cfg: input.cfg,
    resolveAgentDir: async (agentId) => {
      const grant = await input.authorize();
      if (
        !grant.principalId.trim() ||
        grant.context.tenantId !== input.tenantId ||
        !grant.context.userId.trim() ||
        !grant.agentIds.includes(agentId)
      ) {
        throw new Error("Background growth service is not authorized for this agent");
      }
      const dir = resolveTenantAgentDirForContext(grant.context, agentId);
      assertWithinTenantRoot(grant.context, dir);
      return dir;
    },
  });
}
