import type { GatewayClient } from "../../server-methods/types.js";
import { runKnowledgeResolveEngine } from "../resolve/resolve-engine.js";
import type { KnowledgeResolveResult, KnowledgeTaskContext } from "../types.js";

export async function adaptKnowledgeResolve(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<KnowledgeResolveResult> {
  return runKnowledgeResolveEngine(client, params);
}
