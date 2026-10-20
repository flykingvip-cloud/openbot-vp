/**
 * Conversation Projection schema + minimal async worker (CL-P2-02).
 * Product summary — does NOT replace runtime compaction summary.
 * Projection must not become an independent memory evidence source.
 */
import { createHash } from "node:crypto";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { extractProjectionSignals } from "./projection-rules.js";

export type ConversationProjection = {
  schemaVersion: 1;
  conversationId: string;
  revision: number;
  sources: Array<{
    sourceIdentityId: string;
    bindingId: string;
    sessionId: string;
    firstTurnId: string;
    lastTurnId: string;
    sourceChecksum: string;
  }>;
  generatedAt: string;
  generatedBy: {
    kind: "RULE" | "MODEL";
    provider: string | null;
    model: string | null;
    promptVersion: string;
  };
  goal: string | null;
  decisions: Array<{
    id: string;
    text: string;
    status: "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    evidenceRefs: string[];
  }>;
  constraints: Array<{ text: string; evidenceRefs: string[] }>;
  importantContext: Array<{ text: string; evidenceRefs: string[] }>;
  pendingTasks: Array<{
    text: string;
    ownerId: string | null;
    dueAt: string | null;
    evidenceRefs: string[];
  }>;
  participants: string[];
  shortSummary: string;
};

export const PROJECTION_PROMPT_VERSION = "rule-v2";

export function computeProjectionDedupKey(params: {
  conversationId: string;
  sourceFingerprints: string[];
  promptVersion?: string;
}): string {
  const sorted = [...params.sourceFingerprints]
    .map((s) => s.trim())
    .filter(Boolean)
    .toSorted();
  return createHash("sha256")
    .update(
      [params.conversationId, params.promptVersion ?? PROJECTION_PROMPT_VERSION, ...sorted].join(
        "\0",
      ),
    )
    .digest("hex");
}

export type ProjectionStore = {
  get(conversationId: string): Promise<ConversationProjection | null>;
  save(projection: ConversationProjection, dedupKey: string): Promise<void>;
  getDedupKey(conversationId: string): Promise<string | null>;
  /** Optional hard-delete for purge (file + in-memory stores). */
  delete?(conversationId: string): Promise<void>;
};

/** In-memory projection store for local/tests. */
export class InMemoryProjectionStore implements ProjectionStore {
  private readonly byId = new Map<string, ConversationProjection>();
  private readonly dedup = new Map<string, string>();

  async get(conversationId: string): Promise<ConversationProjection | null> {
    return this.byId.get(conversationId) ?? null;
  }

  async save(projection: ConversationProjection, dedupKey: string): Promise<void> {
    this.byId.set(projection.conversationId, projection);
    this.dedup.set(projection.conversationId, dedupKey);
  }

  async getDedupKey(conversationId: string): Promise<string | null> {
    return this.dedup.get(conversationId) ?? null;
  }

  async delete(conversationId: string): Promise<void> {
    this.byId.delete(conversationId);
    this.dedup.delete(conversationId);
  }
}

export type RuleProjectionInput = {
  conversationId: string;
  participants: string[];
  /** Meaningful user message(s) for rule summary / signals. */
  userTexts: string[];
  /** Optional assistant texts for decision/task extraction. */
  assistantTexts?: string[];
  sources: ConversationProjection["sources"];
  previous?: ConversationProjection | null;
};

/** Demote APPROVED decisions that lack evidence refs (fail closed). */
export function sanitizeProjectionDecisions(
  projection: ConversationProjection,
): ConversationProjection {
  return {
    ...projection,
    decisions: projection.decisions.map((d) =>
      d.status === "APPROVED" && d.evidenceRefs.length === 0
        ? { ...d, status: "PROPOSED" as const }
        : d,
    ),
  };
}

/**
 * Rule-based projection (no model). Never blocks main reply.
 * Decisions without evidenceRefs are not marked APPROVED.
 */
export function buildRuleProjection(input: RuleProjectionInput): ConversationProjection {
  const evidenceRefs = input.sources.map((s) => s.sourceIdentityId).filter(Boolean);
  const signals = extractProjectionSignals({
    userTexts: input.userTexts,
    assistantTexts: input.assistantTexts,
    evidenceRefs,
  });
  const revision = (input.previous?.revision ?? 0) + 1;
  const projection: ConversationProjection = {
    schemaVersion: 1,
    conversationId: input.conversationId,
    revision,
    sources: input.sources,
    generatedAt: new Date().toISOString(),
    generatedBy: {
      kind: "RULE",
      provider: null,
      model: null,
      promptVersion: PROJECTION_PROMPT_VERSION,
    },
    goal: signals.goal,
    decisions: signals.decisions,
    constraints: signals.constraints,
    importantContext: signals.importantContext,
    pendingTasks: signals.pendingTasks,
    participants: input.participants,
    shortSummary: signals.shortSummary,
  };
  return sanitizeProjectionDecisions(projection);
}

/**
 * Async refresh: skip when source fingerprint set unchanged.
 * On failure, caller should keep previous revision.
 */
export async function refreshConversationProjection(params: {
  store: ProjectionStore;
  input: RuleProjectionInput;
}): Promise<{ projection: ConversationProjection; skipped: boolean }> {
  const fingerprints = params.input.sources.map((s) => `${s.sourceIdentityId}:${s.sourceChecksum}`);
  const dedupKey = computeProjectionDedupKey({
    conversationId: params.input.conversationId,
    sourceFingerprints: fingerprints,
  });
  const existingKey = await params.store.getDedupKey(params.input.conversationId);
  if (existingKey && existingKey === dedupKey) {
    const existing = await params.store.get(params.input.conversationId);
    if (existing) {
      return { projection: existing, skipped: true };
    }
  }
  const previous = await params.store.get(params.input.conversationId);
  const projection = sanitizeProjectionDecisions(
    buildRuleProjection({ ...params.input, previous }),
  );
  await params.store.save(projection, dedupKey);
  return { projection, skipped: false };
}

/** Optional: pull participants from catalog for projection. */
export async function loadParticipantsFromCatalog(
  catalog: ConversationCatalogRepository,
  dataPlaneId: string,
  conversationId: string,
): Promise<string[]> {
  const record = await catalog.getConversation(dataPlaneId, conversationId);
  return record?.participantIds ?? [];
}
