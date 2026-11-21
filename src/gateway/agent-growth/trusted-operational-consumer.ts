import type { OpenBotConfig } from "../../config/config.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveAuthoritativeMembership, resolveAgentDirForClient } from "../tenant-context.js";
import { createOperationalGrowthConsumer } from "./operational-event-consumer.js";

/** Resolve membership again per event so revocation cannot leave a stale directory capability. */
export function createTrustedOperationalGrowthConsumer(input: {
  cfg: OpenBotConfig;
  client: GatewayClient;
  tenantId: string;
}) {
  if (!input.tenantId.trim()) {
    throw new Error("Growth consumer requires tenant scope");
  }
  return createOperationalGrowthConsumer({
    cfg: input.cfg,
    resolveAgentDir: async (agentId) => {
      const authority = await resolveAuthoritativeMembership(input.client);
      if (authority.tenantId !== input.tenantId) {
        throw new Error("Growth event tenant authority mismatch");
      }
      return resolveAgentDirForClient(input.client, agentId, input.cfg);
    },
  });
}
