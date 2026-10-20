import type { GatewayClient } from "../../server-methods/types.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { listKnowledgeRecentVisits } from "../recent-visits.js";
import type { KnowledgeRecentVisit } from "../types.js";

export async function adaptAgentKnowledgeMemory(
  client: GatewayClient | null,
  params: { limit?: number } = {},
): Promise<{
  visits: KnowledgeRecentVisit[];
  memoryHints: string[];
}> {
  const context = await resolveKnowledgeSourceContext(client);
  const visits = listKnowledgeRecentVisits({
    userId: context.userId,
    seatId: context.seatId,
    limit: params.limit ?? 6,
  });
  return {
    visits,
    memoryHints: visits.map((visit) => visit.title),
  };
}
