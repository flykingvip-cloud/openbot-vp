import type { OpenBotConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { authorizeConversationAction } from "./acl.js";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
/**
 * Collaboration conversation bindings (CL-P3-01).
 * One GROUP_PUBLIC + zero or more AGENT_EXECUTION streams under one conversationId.
 */
import { createEtag, createBindingId } from "./ids.js";
import { createRuntimeSessionForConversation } from "./session-runtime.js";
import type {
  ConversationRecord,
  ConversationSessionBinding,
  ConversationTenantContext,
} from "./types.js";
import { validateBindingCardinality } from "./validation.js";

export type AttachExecutionBindingResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  sessionKey: string;
};

/**
 * Attach an agent execution stream to an existing collaboration conversation.
 * Does not copy the public transcript.
 */
export async function attachAgentExecutionBinding(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  ctx: ConversationTenantContext;
  conversationId: string;
  agentId: string;
  etag?: string;
}): Promise<AttachExecutionBindingResult> {
  const record = await params.catalog.getConversation(
    params.ctx.dataPlaneId,
    params.conversationId,
  );
  if (!record) {
    throw new Error("conversation not found");
  }
  if (record.surfaceType !== "COLLABORATION_GROUP" || !record.groupId) {
    throw new Error("execution bindings only allowed on collaboration conversations");
  }
  const auth = authorizeConversationAction({
    ctx: params.ctx,
    record,
    action: "write",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  if (params.etag && params.etag !== record.etag) {
    throw new Error("etag mismatch");
  }

  const agentId = normalizeAgentId(params.agentId);
  const existing = await params.catalog.listBindings(params.ctx.dataPlaneId, params.conversationId);
  const already = existing.find(
    (b) => b.role === "AGENT_EXECUTION" && b.agentId === agentId && !b.endedAt,
  );
  if (already) {
    return { record, binding: already, sessionKey: already.sessionKey };
  }

  const bindingId = createBindingId();
  // Distinguish execution streams from public GROUP_PUBLIC binding.
  const execSessionKey = `agent:${agentId}:space:${record.groupId}:execution:${record.conversationId}`;
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const runtime = await createRuntimeSessionForConversation({
    cfg: params.cfg,
    agentId,
    sessionKey: execSessionKey,
    label: `${record.title} · ${agentId}`,
    storePath,
  });

  const now = new Date().toISOString();
  const binding: ConversationSessionBinding = {
    schemaVersion: 1,
    bindingId,
    dataPlaneId: params.ctx.dataPlaneId,
    conversationId: record.conversationId,
    sessionKey: execSessionKey,
    sessionId: runtime.sessionId,
    agentId,
    role: "AGENT_EXECUTION",
    aliasTargetBindingId: null,
    transcriptState: "LIVE",
    createdAt: now,
    endedAt: null,
  };
  await params.catalog.saveBinding(binding);

  const nextBindings = [...existing, binding];
  const cardinality = validateBindingCardinality(nextBindings, "COLLABORATION_GROUP");
  if (!cardinality.ok) {
    // Roll back binding if cardinality broken (missing GROUP_PUBLIC).
    throw new Error(cardinality.reasonCode);
  }

  // Touch conversation etag.
  const expectedEtag = record.etag;
  const nextRecord: ConversationRecord = {
    ...record,
    updatedAt: now,
    etag: createEtag(),
  };
  await params.catalog.updateConversation(nextRecord, expectedEtag);

  return { record: nextRecord, binding, sessionKey: execSessionKey };
}

/**
 * Default history binding: PRIMARY or GROUP_PUBLIC only.
 * AGENT_EXECUTION requires explicit role + read_execution_stream permission.
 */
export function selectDefaultHistoryBinding(
  bindings: ConversationSessionBinding[],
): ConversationSessionBinding | null {
  return (
    bindings.find((b) => b.role === "PRIMARY" && !b.endedAt) ??
    bindings.find((b) => b.role === "GROUP_PUBLIC" && !b.endedAt) ??
    null
  );
}

export function listExecutionBindings(
  bindings: ConversationSessionBinding[],
): ConversationSessionBinding[] {
  return bindings.filter((b) => b.role === "AGENT_EXECUTION" && !b.endedAt);
}

/**
 * End an agent execution stream (bot leave / remove). Does not delete transcript;
 * marks binding endedAt so it no longer participates as active execution.
 */
export async function endAgentExecutionBinding(params: {
  catalog: ConversationCatalogRepository;
  ctx: ConversationTenantContext;
  conversationId: string;
  agentId: string;
  etag?: string;
}): Promise<{ record: ConversationRecord; binding: ConversationSessionBinding | null }> {
  const record = await params.catalog.getConversation(
    params.ctx.dataPlaneId,
    params.conversationId,
  );
  if (!record) {
    throw new Error("conversation not found");
  }
  const auth = authorizeConversationAction({
    ctx: params.ctx,
    record,
    action: "write",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  if (params.etag && params.etag !== record.etag) {
    throw new Error("etag mismatch");
  }
  const agentId = normalizeAgentId(params.agentId);
  const existing = await params.catalog.listBindings(params.ctx.dataPlaneId, params.conversationId);
  const target = existing.find(
    (b) => b.role === "AGENT_EXECUTION" && b.agentId === agentId && !b.endedAt,
  );
  if (!target) {
    return { record, binding: null };
  }
  const now = new Date().toISOString();
  const ended: ConversationSessionBinding = {
    ...target,
    endedAt: now,
    transcriptState: "READ_ONLY",
  };
  await params.catalog.saveBinding(ended);
  const nextRecord: ConversationRecord = {
    ...record,
    updatedAt: now,
    etag: createEtag(),
  };
  await params.catalog.updateConversation(nextRecord, record.etag);
  return { record: nextRecord, binding: ended };
}

/** Lineage helper: public conversation aggregates execution session keys. */
export function buildConversationLineage(params: {
  record: ConversationRecord;
  bindings: ConversationSessionBinding[];
}): {
  conversationId: string;
  groupId: string | null;
  publicSessionKey: string | null;
  executionSessionKeys: string[];
} {
  const publicBinding = selectDefaultHistoryBinding(params.bindings);
  return {
    conversationId: params.record.conversationId,
    groupId: params.record.groupId,
    publicSessionKey: publicBinding?.sessionKey ?? null,
    executionSessionKeys: listExecutionBindings(params.bindings).map((b) => b.sessionKey),
  };
}
