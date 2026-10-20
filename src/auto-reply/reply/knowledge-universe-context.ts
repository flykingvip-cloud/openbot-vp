import { applyContextBudgetToEvidence } from "../../gateway/context-scope/budget.js";
import {
  knowledgeConsumeRefsFromScopePlan,
  knowledgeTaskHintsFromScopePlan,
  mayRetrieveOptionalKnowledge,
} from "../../gateway/context-scope/index.js";
import type { ContextScopePlan } from "../../gateway/context-scope/types.js";
import {
  buildAgentCognitiveKnowledgeBundle,
  formatAgentKnowledgeSystemPrompt,
} from "../../gateway/knowledge/adapter/cognitive-runtime-adapter.js";
import { resolveKnowledgeGatewayClientForAgentRun } from "../../gateway/knowledge/agent-run-gateway-client.js";
import type { KnowledgeConsumeReceiptItem } from "../../gateway/knowledge/consume-ref.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import type { KnowledgeRuntimeDiagnostics } from "../../gateway/knowledge/resolve/resolve-engine.js";
import type { KnowledgeTaskContext } from "../../gateway/knowledge/types.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import type { KnowledgeEvidence } from "../../retrieval/types.js";
import {
  allowedKnowledgeSourcesForCeiling,
  type InboundCapabilityCeiling,
  type InboundDepth,
} from "./inbound-depth.js";

function inferTaskTypeFromMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "general";
  }
  if (/分析|为什么|下降|指标|成交|流失/i.test(trimmed)) {
    return "analysis";
  }
  if (/复盘|总结|回顾/i.test(trimmed)) {
    return "retrospective";
  }
  if (/研究|调研|了解/i.test(trimmed)) {
    return "research";
  }
  if (/执行|操作|流程|审批/i.test(trimmed)) {
    return "operations";
  }
  return "general";
}

export type KnowledgeUniversePromptContext = {
  promptBlock: string;
  evidence: KnowledgeEvidence[];
  sourceKnowledgeBaseIds: string[];
  sourceChunkIds: string[];
  sourceUserId: string | null;
  sourceTenantId: string | null;
  receipts: KnowledgeConsumeReceiptItem[];
  diagnostics?: KnowledgeRuntimeDiagnostics;
};

export async function buildKnowledgeUniversePromptContext(params: {
  message: string;
  sessionKey?: string;
  agentId?: string;
  knowledgeBaseId?: string | null;
  requestedCapabilities?: string[];
  requestedSourceHints?: KnowledgeTaskContext["requestedSourceHints"];
  requestedObjectIds?: string[];
  gatewayClient?: GatewayClient | null;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  ownerUserId?: string | null;
  tenantId?: string | null;
  applySourcePolicy?: boolean;
  depth?: InboundDepth;
  capabilityCeiling?: InboundCapabilityCeiling;
  hasExplicitLiveIntent?: boolean;
  abortSignal?: AbortSignal;
  scopePlan?: ContextScopePlan;
}): Promise<KnowledgeUniversePromptContext | undefined> {
  if (params.scopePlan && !mayRetrieveOptionalKnowledge(params.scopePlan)) {
    return undefined;
  }
  const scopeHints = knowledgeTaskHintsFromScopePlan(params.scopePlan);
  const applySourcePolicy = Boolean(params.applySourcePolicy && params.capabilityCeiling);
  // Policy path consumes inbound depth instead of a third keyword table.
  const taskType = applySourcePolicy
    ? params.depth === "retrieve"
      ? "research"
      : "general"
    : inferTaskTypeFromMessage(params.message);
  const knowledgeBaseId = params.knowledgeBaseId ?? scopeHints.knowledgeBaseId ?? null;
  const knowledgeBaseIds = scopeHints.knowledgeBaseIds;
  const requestedSourceHints = params.requestedSourceHints?.length
    ? params.requestedSourceHints
    : scopeHints.requestedSourceHints;
  const consumeRefs = knowledgeConsumeRefsFromScopePlan(params.scopePlan);
  // Typed consume refs replace bare object-id lowering. Do not merge file/folder/api
  // selections back into requestedObjectIds.
  const requestedObjectIds =
    consumeRefs.length > 0 ? [] : [...new Set(params.requestedObjectIds ?? [])];
  const taskContext: KnowledgeTaskContext = {
    taskType,
    sessionKey: params.sessionKey ?? null,
    agentId: params.agentId ?? "employee-agent",
    agentType: "employee-agent",
    knowledgeBaseId,
    ...(knowledgeBaseIds?.length ? { knowledgeBaseIds } : {}),
    ...(params.requestedCapabilities?.length
      ? { requestedCapabilities: params.requestedCapabilities }
      : {}),
    ...(requestedSourceHints?.length ? { requestedSourceHints } : {}),
    ...(requestedObjectIds.length ? { requestedObjectIds } : {}),
  };

  const bridged =
    params.gatewayClient ??
    (
      await resolveKnowledgeGatewayClientForAgentRun({
        gatewayClientUser: params.gatewayClientUser,
        gatewayClientSessionDomain: params.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
        agentId: params.agentId,
        ownerUserId: params.ownerUserId,
        tenantId: params.tenantId,
      })
    )?.client ??
    buildKnowledgeReplyGatewayClient({
      gatewayClientUser: params.gatewayClientUser,
      gatewayClientSessionDomain: params.gatewayClientSessionDomain,
      gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
    });
  const client = bridged;
  const sourcePolicy =
    applySourcePolicy && params.capabilityCeiling
      ? {
          liveSourcesAllowed: params.capabilityCeiling.liveSourcesAllowed,
          allowedSources: allowedKnowledgeSourcesForCeiling(params.capabilityCeiling),
          hasExplicitLiveIntent: Boolean(params.hasExplicitLiveIntent),
        }
      : undefined;

  try {
    const [bundle, sourceContext] = await Promise.all([
      buildAgentCognitiveKnowledgeBundle(client, {
        taskContext,
        query: params.message,
        sourcePolicy,
        ...(consumeRefs.length > 0 ? { selection: { refs: consumeRefs } } : {}),
        abortSignal: params.abortSignal,
      }),
      resolveKnowledgeSourceContext(client),
    ]);
    const budgetedEvidence = params.scopePlan
      ? applyContextBudgetToEvidence({
          evidence: bundle.context.evidence,
          budget: params.scopePlan.budget,
        })
      : bundle.context.evidence;
    const hasEnterpriseKnowledge = bundle.resolve.objects.some(
      (item) => item.source === "enterprise" || item.source === "data",
    );
    const hasFailedConsume = bundle.receipts.some(
      (receipt) => receipt.status === "unavailable" || receipt.status === "denied",
    );
    const hasPromptSignal =
      bundle.context.primaryObjects.length > 0 ||
      budgetedEvidence.length > 0 ||
      bundle.memoryHints.length > 0 ||
      bundle.context.recommendedCapabilities.length > 0 ||
      hasEnterpriseKnowledge ||
      hasFailedConsume ||
      Boolean(bundle.diagnostics.degraded);
    if (!hasPromptSignal) {
      return undefined;
    }
    let promptBlock = formatAgentKnowledgeSystemPrompt(bundle);
    if (params.scopePlan) {
      const maxChars = Math.max(0, params.scopePlan.budget.maxTokens * 4);
      if (promptBlock.length > maxChars) {
        promptBlock = promptBlock.slice(0, maxChars);
      }
    }
    return {
      promptBlock,
      evidence: budgetedEvidence,
      sourceKnowledgeBaseIds: [
        ...new Set(
          bundle.context.evidence
            .map((item) => item.kbId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
      sourceChunkIds: [
        ...new Set(
          bundle.context.evidence
            .map((item) => item.chunkId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
      sourceUserId: sourceContext.userId,
      sourceTenantId: sourceContext.tenantId,
      receipts: bundle.receipts,
      diagnostics: bundle.diagnostics,
    };
  } catch (error) {
    // Preserve availability fallback, but make degradation observable for operators.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      JSON.stringify({
        component: "knowledge-universe-context",
        event: "prompt_context_build_failed",
        reason: message.slice(0, 500),
        degraded: true,
      }),
    );
    return undefined;
  }
}

export async function buildKnowledgeUniverseSystemPrompt(
  params: Parameters<typeof buildKnowledgeUniversePromptContext>[0],
): Promise<string | undefined> {
  const context = await buildKnowledgeUniversePromptContext(params);
  return context?.promptBlock;
}
