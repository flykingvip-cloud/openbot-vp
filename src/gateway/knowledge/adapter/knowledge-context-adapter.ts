import type { GatewayClient } from "../../server-methods/types.js";
import { runKnowledgeContextEngine } from "../resolve/resolve-engine.js";
import type { KnowledgeAgentContext, KnowledgeTaskContext } from "../types.js";

export async function adaptKnowledgeContext(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<KnowledgeAgentContext> {
  return runKnowledgeContextEngine(client, params);
}
