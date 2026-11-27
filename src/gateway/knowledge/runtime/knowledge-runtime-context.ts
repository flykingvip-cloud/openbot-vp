import fs from "node:fs";
import type { GatewayClient } from "../../server-methods/types.js";
import type { KnowledgeConsumeReceiptItem } from "../consume-ref.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { getGovernanceSummary } from "../governance/chunk-governance-store.js";
import type { GovernanceSummary } from "../governance/types.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import {
  clientKnowledgeEmail,
  resolveReadableKnowledgeBaseScope,
} from "../knowledge-access-gate.js";
import {
  runKnowledgeRuntimeEngine,
  type KnowledgeRuntimeSelection,
} from "../resolve/resolve-engine.js";
import type {
  KnowledgeAgentContext,
  KnowledgeResolveResult,
  KnowledgeTaskContext,
} from "../types.js";

/**
 * Single, governance-aware consumption contract for the AI consumption layer
 * (agent / workflow / automation). It converges the knowledge paths into one
 * entry built on the shared runtime composition engine:
 *   - object-level cognitive context (objects + relationship graph + prompt block)
 *   - governance-aware chunk evidence (retrieveKnowledgeFromIndex scoring)
 *   - resolve result (intent, profile, selected sources, recommendations)
 *   - recent-visit memory hints
 * and attaches the knowledge-runtime governance summary so consumers can reason
 * about the trust/health of what they are consuming. Data capabilities remain
 * pre-materialized (consumption boundary): this contract never live-invokes a
 * connector — it only exposes already-governed knowledge.
 */
export type KnowledgeRuntimeContext = {
  resolve: KnowledgeResolveResult;
  context: KnowledgeAgentContext;
  memoryHints: string[];
  receipts: KnowledgeConsumeReceiptItem[];
  governance: GovernanceSummary | null;
};

export async function loadGovernanceSummaryForUser(
  client: GatewayClient | null,
  kbId?: string | null,
): Promise<GovernanceSummary | null> {
  const context = await resolveKnowledgeSourceContext(client);
  if (!context.userId) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: context.userId,
    tenantId: context.tenantId,
  });
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const scope = resolveReadableKnowledgeBaseScope({
    context,
    email: clientKnowledgeEmail(client),
    knowledgeBaseId: kbId?.trim() || undefined,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return getGovernanceSummary(index.db, scope.kbId, scope.allowedKbIds);
  } finally {
    index.close();
  }
}

export async function resolveKnowledgeRuntimeContext(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
    selection?: KnowledgeRuntimeSelection;
  },
): Promise<KnowledgeRuntimeContext> {
  const { resolve, context, memoryHints, receipts } = await runKnowledgeRuntimeEngine(
    client,
    params,
  );
  const governance = await loadGovernanceSummaryForUser(
    client,
    params.taskContext.knowledgeBaseId,
  ).catch(() => null);
  return { resolve, context, memoryHints, receipts, governance };
}
