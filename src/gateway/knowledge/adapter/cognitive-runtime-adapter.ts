import type { GatewayClient } from "../../server-methods/types.js";
import type { KnowledgeConsumeReceiptItem } from "../consume-ref.js";
import {
  runKnowledgeRuntimeEngine,
  type KnowledgeResolveSourcePolicy,
  type KnowledgeRuntimeDiagnostics,
  type KnowledgeRuntimeSelection,
} from "../resolve/resolve-engine.js";
import type {
  KnowledgeAgentContext,
  KnowledgeResolveResult,
  KnowledgeTaskContext,
} from "../types.js";

export type AgentCognitiveKnowledgeBundle = {
  resolve: KnowledgeResolveResult;
  context: KnowledgeAgentContext;
  memoryHints: string[];
  receipts: KnowledgeConsumeReceiptItem[];
  diagnostics: KnowledgeRuntimeDiagnostics;
};

/**
 * Agent-facing cognitive bundle. Delegates to the single runtime composition
 * engine (resolve + context + memory computed in one pass), so the reply path
 * and the Runtime Cognitive Context RPCs share exactly one composition.
 */
export async function buildAgentCognitiveKnowledgeBundle(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
    sourcePolicy?: KnowledgeResolveSourcePolicy;
    selection?: KnowledgeRuntimeSelection;
    abortSignal?: AbortSignal;
  },
): Promise<AgentCognitiveKnowledgeBundle> {
  const { resolve, context, memoryHints, receipts, diagnostics } = await runKnowledgeRuntimeEngine(
    client,
    params,
  );
  return { resolve, context, memoryHints, receipts, diagnostics };
}

export function formatAgentKnowledgeSystemPrompt(bundle: AgentCognitiveKnowledgeBundle): string {
  return bundle.context.promptBlock;
}
