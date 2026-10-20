import type { GatewayClient } from "../../server-methods/types.js";
import { knowledgeRecommendations } from "../router.js";
import type { KnowledgeRecommendation, KnowledgeTaskContext } from "../types.js";

export async function adaptRelationshipRecommendations(
  client: GatewayClient | null,
  params: {
    taskContext?: KnowledgeTaskContext | null;
    focusObjectId?: string | null;
    limit?: number;
  },
): Promise<KnowledgeRecommendation[]> {
  return knowledgeRecommendations(client, {
    taskContext: params.taskContext ?? null,
    focusObjectId: params.focusObjectId ?? null,
    limit: params.limit,
  });
}
