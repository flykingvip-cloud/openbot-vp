/**
 * Stable Conversation / binding / source identity IDs (CL-P0-01, CL-P0-04).
 * IDs must not depend on live file paths or mutable session keys alone.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  ConversationSessionBindingRole,
  ConversationSurfaceType,
  MemorySourceIdentity,
} from "./types.js";

const ID_PREFIX = {
  conversation: "conv",
  binding: "cbind",
  source: "msrc",
  hold: "hold",
  purge: "purge",
  lifecycle: "lcjob",
  archive: "arch",
  etag: "etag",
} as const;

/** Lowercase, trim, collapse internal whitespace for stable hashing. */
export function normalizeIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sha256Hex(parts: string[]): string {
  const h = createHash("sha256");
  for (const part of parts) {
    h.update(normalizeIdPart(part));
    h.update("\0");
  }
  return h.digest("hex");
}

function prefixedId(prefix: string, digest: string, length = 32): string {
  return `${prefix}_${digest.slice(0, length)}`;
}

/**
 * Stable migration key for lazy session → Conversation mapping.
 * Uses dataPlaneId + sessionId + bindingRole — never client tenantId alone.
 */
export function buildConversationMigrationKey(params: {
  dataPlaneId: string;
  sessionId: string;
  bindingRole: ConversationSessionBindingRole;
}): string {
  return sha256Hex(["conv-migration-v1", params.dataPlaneId, params.sessionId, params.bindingRole]);
}

/**
 * Deterministic conversationId for a legacy session binding (idempotent backfill).
 * New explicit creates should use {@link createConversationId}.
 */
export function deriveConversationIdFromMigration(params: {
  dataPlaneId: string;
  sessionId: string;
  bindingRole: ConversationSessionBindingRole;
}): string {
  const digest = buildConversationMigrationKey(params);
  return prefixedId(ID_PREFIX.conversation, digest);
}

/** Random conversation ID for user-initiated create (product-stable after mint). */
export function createConversationId(): string {
  return prefixedId(ID_PREFIX.conversation, randomUUID().replace(/-/g, ""), 32);
}

export function createBindingId(): string {
  return prefixedId(ID_PREFIX.binding, randomUUID().replace(/-/g, ""), 32);
}

/**
 * Deterministic binding id for migration (same sessionId+role → same bindingId).
 */
export function deriveBindingIdFromMigration(params: {
  dataPlaneId: string;
  conversationId: string;
  sessionId: string;
  bindingRole: ConversationSessionBindingRole;
}): string {
  const digest = sha256Hex([
    "binding-migration-v1",
    params.dataPlaneId,
    params.conversationId,
    params.sessionId,
    params.bindingRole,
  ]);
  return prefixedId(ID_PREFIX.binding, digest);
}

export function createHoldId(): string {
  return prefixedId(ID_PREFIX.hold, randomUUID().replace(/-/g, ""), 32);
}

export function createPurgeJobId(): string {
  return prefixedId(ID_PREFIX.purge, randomUUID().replace(/-/g, ""), 32);
}

export function createLifecycleJobId(): string {
  return prefixedId(ID_PREFIX.lifecycle, randomUUID().replace(/-/g, ""), 32);
}

/**
 * Opaque archive artifact id for client receipts (never absolute server paths).
 */
export function toArchiveArtifactId(conversationId: string, sessionId: string): string {
  const digest = sha256Hex(["archive-artifact-v1", conversationId, sessionId]);
  return prefixedId(ID_PREFIX.archive, digest, 24);
}

export function createEtag(): string {
  return prefixedId(ID_PREFIX.etag, randomUUID().replace(/-/g, ""), 16);
}

/**
 * Canonical encoding for MemorySourceIdentity (plan §5.3).
 * Excludes file paths; uses data plane + conversation + binding + turn range.
 */
export function encodeMemorySourceIdentityKey(params: {
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  sourceType: "TRANSCRIPT_RANGE";
  firstTurnId: string;
  lastTurnId: string;
}): string {
  return [
    "msrc-v1",
    normalizeIdPart(params.dataPlaneId),
    normalizeIdPart(params.conversationId),
    normalizeIdPart(params.bindingId),
    normalizeIdPart(params.sessionId),
    params.sourceType,
    normalizeIdPart(params.firstTurnId),
    normalizeIdPart(params.lastTurnId),
  ].join("|");
}

export function computeMemorySourceIdentityId(params: {
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  sourceType: "TRANSCRIPT_RANGE";
  firstTurnId: string;
  lastTurnId: string;
}): string {
  const key = encodeMemorySourceIdentityKey({
    dataPlaneId: params.dataPlaneId,
    conversationId: params.conversationId,
    bindingId: params.bindingId,
    sessionId: params.sessionId,
    sourceType: params.sourceType,
    firstTurnId: params.firstTurnId,
    lastTurnId: params.lastTurnId,
  });
  return prefixedId(ID_PREFIX.source, sha256Hex([key]), 40);
}

export function buildMemorySourceIdentity(params: {
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  firstTurnId: string;
  lastTurnId: string;
  turnIndexRange?: [number, number];
  contentChecksum?: string;
  createdAt?: string;
}): MemorySourceIdentity {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const base = {
    dataPlaneId: params.dataPlaneId,
    conversationId: params.conversationId,
    bindingId: params.bindingId,
    sessionId: params.sessionId,
    firstTurnId: params.firstTurnId,
    lastTurnId: params.lastTurnId,
    sourceType: "TRANSCRIPT_RANGE" as const,
  };
  return {
    schemaVersion: 1,
    sourceIdentityId: computeMemorySourceIdentityId(base),
    ...base,
    turnIndexRange: params.turnIndexRange ?? [0, 0],
    contentChecksum: params.contentChecksum ?? "",
    createdAt,
  };
}

export function inferSurfaceFromSessionKey(sessionKey: string): {
  surfaceType: ConversationSurfaceType;
  agentId: string | null;
  groupId: string | null;
  bindingRole: ConversationSessionBindingRole;
} {
  const raw = sessionKey.trim().toLowerCase();
  // Collaboration space: agent:<id>:main:space:<groupId> or ...:space:<groupId>
  const spaceMatch = raw.match(/(?:^|:)space:([^:]+)/);
  if (spaceMatch?.[1]) {
    const agentMatch = raw.match(/^agent:([^:]+):/);
    const isPublic = raw.includes(":main:space:") || /:space:[^:]+$/.test(raw);
    // Heuristic: GROUP_PUBLIC when rest is main:space: or ends with space alone under main
    const isExecution = Boolean(
      agentMatch && !raw.includes(":main:space:") && raw.includes(":space:"),
    );
    return {
      surfaceType: "COLLABORATION_GROUP",
      agentId: agentMatch?.[1] ?? null,
      groupId: spaceMatch[1],
      bindingRole: isExecution && !isPublic ? "AGENT_EXECUTION" : "GROUP_PUBLIC",
    };
  }

  const agentMatch = raw.match(/^agent:([^:]+):/);
  return {
    surfaceType: "AGENT",
    agentId: agentMatch?.[1] ?? (raw === "main" ? "main" : null),
    groupId: null,
    bindingRole: "PRIMARY",
  };
}
