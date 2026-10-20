import { resolveContextBudget } from "./budget.js";
import { maxLevelFromGroupConfidentiality } from "./confidentiality.js";
import {
  DEFAULT_CONTEXT_POLICY,
  type ContextMode,
  type ContextPolicyV1,
  type ContextScopePlan,
  type ContextSource,
  type ResolveContextScopeInput,
  type RetrievalStrategy,
} from "./types.js";

function sourceKey(source: ContextSource): string {
  switch (source.type) {
    case "conversation":
      return `conversation:${source.id}`;
    case "group":
      return `group:${source.groupId}`;
    case "knowledge":
      return `knowledge:${source.knowledgeBaseId}`;
    case "folder":
      return `folder:${source.parentId ?? ""}:${source.path}`;
    case "file":
      return `file:${source.parentId ?? ""}:${source.fileId}`;
    case "api":
      return `api:${source.parentId ?? ""}:${source.connectorId}`;
  }
}

function uniqueSources(sources: ContextSource[]): ContextSource[] {
  const seen = new Set<string>();
  const next: ContextSource[] = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(source);
  }
  return next;
}

function isAllowedSource(source: ContextSource, policy: ContextPolicyV1): boolean {
  if (!policy.allowedSourceTypes.includes(source.type)) {
    return false;
  }
  if (source.type === "api" && !policy.allowExternalSources) {
    return false;
  }
  return true;
}

function resolveMode(params: ResolveContextScopeInput, policy: ContextPolicyV1): ContextMode {
  const requested = params.request?.mode;
  if (requested && policy.allowMemberOverride) {
    return requested;
  }
  if ((params.request?.sources?.length ?? 0) > 0 && policy.allowMemberOverride) {
    return "focused";
  }
  if (params.inboundDepth === "chat") {
    return "minimal";
  }
  // P2 single-track: group chat defaults to chat/minimal (conversation+group only).
  // Knowledge expansion requires explicit retrieve/act depth or UI scope sources above.
  if (!params.inboundDepth && params.groupId?.trim()) {
    return "minimal";
  }
  return policy.defaultMode;
}

function strategyForMode(mode: ContextMode, policy: ContextPolicyV1): RetrievalStrategy {
  if (mode === "minimal") {
    return {
      semanticSearch: false,
      keywordSearch: false,
      metadataFilter: false,
      recursiveFolderScan: false,
      externalApi: false,
      allowKnowledgePrefetch: false,
    };
  }
  return {
    semanticSearch: true,
    keywordSearch: true,
    metadataFilter: true,
    recursiveFolderScan: mode === "deep",
    externalApi: mode === "deep" && policy.allowExternalSources,
    allowKnowledgePrefetch: true,
  };
}

export function resolveContextScopePlan(params: ResolveContextScopeInput): ContextScopePlan {
  const policy = params.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  const mode = resolveMode(params, policy);
  const reasons: string[] = [`mode:${mode}`];
  if (params.inboundDepth) {
    reasons.push(`inbound:${params.inboundDepth}`);
  } else if (params.groupId?.trim() && mode === "minimal") {
    reasons.push("inbound:chat_group_default");
  }

  const conversation: ContextSource = {
    type: "conversation",
    id: params.sessionKey,
  };
  const mandatory: ContextSource[] = [conversation];
  const groupId = params.groupId?.trim();
  if (groupId && policy.mandatoryGroupContext) {
    mandatory.push({ type: "group", groupId });
    reasons.push("mandatory_group");
  }

  const requested = (params.request?.sources ?? []).filter((source) =>
    isAllowedSource(source, policy),
  );
  const optional: ContextSource[] = [];
  if (mode === "focused" || mode === "deep") {
    optional.push(...requested);
  } else if (mode === "auto") {
    optional.push({ type: "knowledge", knowledgeBaseId: "authorized" });
  }

  const sources = uniqueSources([...mandatory, ...optional]).slice(
    0,
    resolveContextBudget({ mode, contextPolicy: policy }).maxSources,
  );

  return {
    mode,
    sources,
    mandatorySources: uniqueSources(mandatory),
    retrievalStrategy: strategyForMode(mode, policy),
    budget: resolveContextBudget({ mode, contextPolicy: policy }),
    lifetime: params.request?.lifetime ?? "turn",
    confidentiality: {
      maxLevel: maxLevelFromGroupConfidentiality(params.groupConfidentiality),
    },
    fullContextDumpAllowed: false,
    reasons,
  };
}

export function mayRetrieveOptionalKnowledge(plan: ContextScopePlan): boolean {
  return plan.retrievalStrategy.allowKnowledgePrefetch && plan.mode !== "minimal";
}

function deniedIdForSource(source: ContextSource): string {
  switch (source.type) {
    case "conversation":
      return source.id;
    case "group":
      return source.groupId;
    case "knowledge":
      return source.knowledgeBaseId;
    case "folder":
      return source.path;
    case "file":
      return source.fileId;
    case "api":
      return source.connectorId;
  }
}

export function degradeContextScopePlanToMandatory(
  plan: ContextScopePlan,
  reason: "denied:authorize_failed" | "scope_persistence_degraded",
): ContextScopePlan {
  const denyReason = reason === "denied:authorize_failed" ? "authorize_failed" : "persist_failed";
  const mandatoryKeys = new Set(
    plan.mandatorySources.map((source) => `${source.type}:${deniedIdForSource(source)}`),
  );
  const denied = [...(plan.deniedSources ?? [])];
  for (const source of plan.sources) {
    const key = `${source.type}:${deniedIdForSource(source)}`;
    if (mandatoryKeys.has(key)) {
      continue;
    }
    const parentId =
      source.type === "folder" || source.type === "file" || source.type === "api"
        ? source.parentId
        : undefined;
    denied.push({
      type: source.type,
      id: deniedIdForSource(source),
      ...(parentId ? { parentId } : {}),
      reason: denyReason,
    });
  }
  return {
    ...plan,
    sources: [...plan.mandatorySources],
    retrievalStrategy: {
      semanticSearch: false,
      keywordSearch: false,
      metadataFilter: false,
      recursiveFolderScan: false,
      externalApi: false,
      allowKnowledgePrefetch: false,
    },
    reasons: plan.reasons.includes(reason) ? plan.reasons : [...plan.reasons, reason],
    ...(denied.length > 0 ? { deniedSources: denied } : {}),
  };
}

export function canCloseGroupRuntimeContext(plan: ContextScopePlan): boolean {
  return !plan.mandatorySources.some((source) => source.type === "group");
}
