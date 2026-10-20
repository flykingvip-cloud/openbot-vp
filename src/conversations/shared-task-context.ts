/**
 * Shared Task Context (CL-P3-02).
 * Collaboration public context — no private CoT / private memory / full workspace files.
 * Only approved decisions and hard constraints with evidence may inject as hard truth.
 */
import { createHash } from "node:crypto";

export type SharedTaskDecisionStatus = "PROPOSED" | "APPROVED" | "SUPERSEDED" | "REJECTED";

export type SharedTaskDecision = {
  decisionId: string;
  text: string;
  status: SharedTaskDecisionStatus;
  evidenceRefs: string[];
  /** When SUPERSEDED, points at the replacement decisionId. */
  supersededBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SharedTaskContext = {
  schemaVersion: 1;
  conversationId: string;
  groupId: string;
  revision: number;
  mission: string | null;
  currentPhase: string | null;
  goals: Array<{ text: string; status: string; evidenceRefs: string[] }>;
  /**
   * All decisions (proposed/approved/superseded). Injection uses only APPROVED
   * with non-empty evidenceRefs (see activeApprovedDecisions).
   */
  approvedDecisions: SharedTaskDecision[];
  hardConstraints: Array<{ text: string; evidenceRefs: string[] }>;
  taskRefs: string[];
  deliverableRefs: string[];
  unresolvedQuestions: Array<{ text: string; evidenceRefs: string[] }>;
  updatedBy: string;
  updatedAt: string;
};

export type SharedTaskContextStore = {
  get(groupId: string, conversationId: string): Promise<SharedTaskContext | null>;
  save(context: SharedTaskContext, expectedRevision?: number): Promise<SharedTaskContext>;
};

export class SharedTaskContextConcurrencyError extends Error {
  readonly code = "REVISION_MISMATCH";
  constructor(message = "shared task context revision mismatch") {
    super(message);
    this.name = "SharedTaskContextConcurrencyError";
  }
}

export class InMemorySharedTaskContextStore implements SharedTaskContextStore {
  private readonly map = new Map<string, SharedTaskContext>();

  private key(groupId: string, conversationId: string): string {
    return `${groupId}\0${conversationId}`;
  }

  async get(groupId: string, conversationId: string): Promise<SharedTaskContext | null> {
    return this.map.get(this.key(groupId, conversationId)) ?? null;
  }

  async save(context: SharedTaskContext, expectedRevision?: number): Promise<SharedTaskContext> {
    const k = this.key(context.groupId, context.conversationId);
    const existing = this.map.get(k);
    if (expectedRevision !== undefined) {
      const current = existing?.revision ?? 0;
      if (current !== expectedRevision) {
        throw new SharedTaskContextConcurrencyError();
      }
    }
    const sanitized = sanitizeSharedTaskContext(context);
    this.map.set(k, sanitized);
    return sanitized;
  }
}

/** File-backed store under Data Root (rebuildable collaboration projection). */
export class FileSharedTaskContextStore implements SharedTaskContextStore {
  constructor(private readonly rootDir: string) {}

  private filePath(groupId: string, conversationId: string): string {
    const safeGroup = groupId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeConv = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `${this.rootDir}/${safeGroup}/${safeConv}.json`;
  }

  async get(groupId: string, conversationId: string): Promise<SharedTaskContext | null> {
    const { readFile } = await import("node:fs/promises");
    try {
      const raw = await readFile(this.filePath(groupId, conversationId), "utf-8");
      return sanitizeSharedTaskContext(JSON.parse(raw) as SharedTaskContext);
    } catch {
      return null;
    }
  }

  async save(context: SharedTaskContext, expectedRevision?: number): Promise<SharedTaskContext> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const existing = await this.get(context.groupId, context.conversationId);
    if (expectedRevision !== undefined) {
      const current = existing?.revision ?? 0;
      if (current !== expectedRevision) {
        throw new SharedTaskContextConcurrencyError();
      }
    }
    const sanitized = sanitizeSharedTaskContext(context);
    const fp = this.filePath(context.groupId, context.conversationId);
    await mkdir(dirname(fp), { recursive: true });
    await writeFile(fp, `${JSON.stringify(sanitized, null, 2)}\n`, "utf-8");
    return sanitized;
  }
}

const PRIVATE_LEAK_RE =
  /\b(chain[- ]of[- ]thought|private memory|tool result|internal monologue|hidden thought)\b/gi;

export function stripPrivateSharedText(text: string): string {
  return text.replace(PRIVATE_LEAK_RE, "[redacted]").trim();
}

function normalizeDecision(raw: SharedTaskDecision | Record<string, unknown>): SharedTaskDecision {
  const text = stripPrivateSharedText(typeof raw.text === "string" ? raw.text : "");
  const evidenceRefs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs.map((ref) => (typeof ref === "string" ? ref : "")).filter(Boolean)
    : [];
  let status = (raw.status as SharedTaskDecisionStatus | undefined) ?? "APPROVED";
  // Legacy rows without status were treated as approved — keep, but require evidence.
  if (!raw.status && evidenceRefs.length > 0) {
    status = "APPROVED";
  }
  if (status === "APPROVED" && evidenceRefs.length === 0) {
    status = "PROPOSED";
  }
  return {
    decisionId: (typeof raw.decisionId === "string" ? raw.decisionId : "").trim() || "unknown",
    text,
    status,
    evidenceRefs,
    supersededBy: typeof raw.supersededBy === "string" ? raw.supersededBy : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

function sanitizeSharedTaskContext(context: SharedTaskContext): SharedTaskContext {
  return {
    ...context,
    schemaVersion: 1,
    mission: context.mission ? stripPrivateSharedText(context.mission) : null,
    currentPhase: context.currentPhase ? stripPrivateSharedText(context.currentPhase) : null,
    approvedDecisions: (context.approvedDecisions ?? []).map((d) => normalizeDecision(d)),
    hardConstraints: (context.hardConstraints ?? [])
      .filter((c) => c.evidenceRefs.length > 0 && c.text.trim().length > 0)
      .map((c) => ({ ...c, text: stripPrivateSharedText(c.text) })),
    goals: (context.goals ?? [])
      .filter((g) => g.text.trim().length > 0)
      .map((g) => ({ ...g, text: stripPrivateSharedText(g.text) })),
    unresolvedQuestions: (context.unresolvedQuestions ?? []).map((q) => ({
      ...q,
      text: stripPrivateSharedText(q.text),
    })),
  };
}

/** Decisions that may inject as hard truth. */
export function activeApprovedDecisions(context: SharedTaskContext): SharedTaskDecision[] {
  return context.approvedDecisions.filter(
    (d) => d.status === "APPROVED" && d.evidenceRefs.length > 0 && d.text.trim().length > 0,
  );
}

const sharedTaskStoreCache = new Map<string, FileSharedTaskContextStore>();

export function getSharedTaskContextStore(dataRoot: string): SharedTaskContextStore {
  const root = `${dataRoot.replace(/\/$/, "")}/.meta/conversations/shared-task`;
  const existing = sharedTaskStoreCache.get(root);
  if (existing) {
    return existing;
  }
  const store = new FileSharedTaskContextStore(root);
  sharedTaskStoreCache.set(root, store);
  return store;
}

/** Validate injection budget: shared task context must fit allocated token share. */
export function fitSharedTaskContextToBudget(params: {
  context: SharedTaskContext;
  maxTokens: number;
  estimateTokens: (text: string) => number;
}): { text: string; truncated: boolean } {
  const lines: string[] = [];
  if (params.context.mission) {
    lines.push(`Mission: ${params.context.mission}`);
  }
  if (params.context.currentPhase) {
    lines.push(`Phase: ${params.context.currentPhase}`);
  }
  for (const g of params.context.goals) {
    lines.push(`Goal (${g.status}): ${g.text}`);
  }
  // Only APPROVED + evidenced decisions inject as authoritative.
  for (const d of activeApprovedDecisions(params.context)) {
    lines.push(`Decision: ${d.text}`);
  }
  for (const c of params.context.hardConstraints) {
    if (c.evidenceRefs.length === 0) {
      continue;
    }
    lines.push(`Constraint: ${c.text}`);
  }
  for (const q of params.context.unresolvedQuestions) {
    lines.push(`Open: ${q.text}`);
  }

  let text = lines.join("\n");
  if (params.estimateTokens(text) <= params.maxTokens) {
    return { text, truncated: false };
  }
  while (lines.length > 2 && params.estimateTokens(lines.join("\n")) > params.maxTokens) {
    lines.pop();
  }
  text = lines.join("\n");
  while (text.length > 0 && params.estimateTokens(text) > params.maxTokens) {
    text = text.slice(0, Math.floor(text.length * 0.85));
  }
  return { text, truncated: true };
}

export function emptySharedTaskContext(params: {
  conversationId: string;
  groupId: string;
  updatedBy: string;
}): SharedTaskContext {
  return {
    schemaVersion: 1,
    conversationId: params.conversationId,
    groupId: params.groupId,
    revision: 0,
    mission: null,
    currentPhase: null,
    goals: [],
    approvedDecisions: [],
    hardConstraints: [],
    taskRefs: [],
    deliverableRefs: [],
    unresolvedQuestions: [],
    updatedBy: params.updatedBy,
    updatedAt: new Date().toISOString(),
  };
}

function mintDecisionId(text: string, evidenceRefs: string[]): string {
  return createHash("sha256")
    .update(`${text}\0${evidenceRefs.join(",")}`)
    .digest("hex")
    .slice(0, 12);
}

/** Propose a decision — not injectable until approve. */
export function proposeSharedDecision(params: {
  context: SharedTaskContext;
  decisionId?: string;
  text: string;
  evidenceRefs?: string[];
  updatedBy: string;
}): SharedTaskContext {
  const text = params.text.trim();
  if (!text) {
    throw new Error("decision text required");
  }
  const evidenceRefs = params.evidenceRefs ?? [];
  const decisionId = params.decisionId ?? mintDecisionId(text, evidenceRefs);
  const now = new Date().toISOString();
  const next: SharedTaskDecision = {
    decisionId,
    text,
    status: "PROPOSED",
    evidenceRefs,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...params.context,
    revision: params.context.revision + 1,
    approvedDecisions: [
      ...params.context.approvedDecisions.filter((d) => d.decisionId !== decisionId),
      next,
    ],
    updatedBy: params.updatedBy,
    updatedAt: now,
  };
}

/** Approve a proposed (or new) decision — requires evidence. */
export function approveSharedDecision(params: {
  context: SharedTaskContext;
  decisionId: string;
  text?: string;
  evidenceRefs: string[];
  updatedBy: string;
}): SharedTaskContext {
  if (params.evidenceRefs.length === 0) {
    throw new Error("approved decisions require evidenceRefs");
  }
  const existing = params.context.approvedDecisions.find((d) => d.decisionId === params.decisionId);
  const text = (params.text ?? existing?.text ?? "").trim();
  if (!text) {
    throw new Error("decision text required");
  }
  const now = new Date().toISOString();
  const next: SharedTaskDecision = {
    decisionId: params.decisionId,
    text,
    status: "APPROVED",
    evidenceRefs: params.evidenceRefs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ...params.context,
    revision: params.context.revision + 1,
    approvedDecisions: [
      ...params.context.approvedDecisions.filter((d) => d.decisionId !== params.decisionId),
      next,
    ],
    updatedBy: params.updatedBy,
    updatedAt: now,
  };
}

/**
 * Supersede an approved decision with a new one. Old status → SUPERSEDED and
 * is no longer injected as current truth.
 */
export function supersedeSharedDecision(params: {
  context: SharedTaskContext;
  previousDecisionId: string;
  newText: string;
  evidenceRefs: string[];
  newDecisionId?: string;
  updatedBy: string;
}): SharedTaskContext {
  if (params.evidenceRefs.length === 0) {
    throw new Error("superseding decision requires evidenceRefs");
  }
  const prev = params.context.approvedDecisions.find(
    (d) => d.decisionId === params.previousDecisionId,
  );
  if (!prev) {
    throw new Error("previous decision not found");
  }
  const now = new Date().toISOString();
  const newId = params.newDecisionId ?? mintDecisionId(params.newText, params.evidenceRefs);
  const superseded: SharedTaskDecision = {
    ...prev,
    status: "SUPERSEDED",
    supersededBy: newId,
    updatedAt: now,
  };
  const replacement: SharedTaskDecision = {
    decisionId: newId,
    text: params.newText.trim(),
    status: "APPROVED",
    evidenceRefs: params.evidenceRefs,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...params.context,
    revision: params.context.revision + 1,
    approvedDecisions: [
      ...params.context.approvedDecisions.filter(
        (d) => d.decisionId !== params.previousDecisionId && d.decisionId !== newId,
      ),
      superseded,
      replacement,
    ],
    updatedBy: params.updatedBy,
    updatedAt: now,
  };
}
