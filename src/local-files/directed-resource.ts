/**
 * `UserDirectedLocalResource`: the per-turn record that lets a read skip the
 * approval card (design 4.5).
 *
 * The rule it encodes is narrow. A path earns a directed grant only when it came
 * from a structured span of the user's own authored text in the current inbound
 * message, and only when the same span also expresses intent to read it.
 *
 * ## Why this is fail closed today
 *
 * No channel in this codebase currently preserves authored-vs-quoted span offsets
 * into the internal message representation. Telegram is the only channel with real
 * entities, and its offsets stop being meaningful at `expandTextLinks`
 * (`src/telegram/bot/helpers.ts`), which rewrites the body before it reaches
 * `MsgContext`. Slack blocks, Discord embeds and forwarded-message attachments are
 * all flattened to text at the adapter boundary.
 *
 * The design already anticipates this: when a channel cannot supply the structure,
 * the message produces no directed grant (design 4.5). So an adapter must opt in by
 * supplying spans; the default is no grant, and a proactive read then needs the
 * one-time approval card instead. This is not a stub — it is the specified
 * behaviour, and it is what keeps a path pasted inside a quoted block or a log
 * excerpt from silently authorizing a read.
 *
 * Deliberately NOT reused: `detectImageReferences`
 * (`src/agents/pi-embedded-runner/run/images.ts`) regex-scans the whole prompt and
 * reads whatever it finds. It cannot tell a typed path from a quoted one, which is
 * precisely the behaviour this record replaces.
 */

import crypto from "node:crypto";
import type { LocalFilesOperation } from "./types.js";

/**
 * Where a span came from. Only `authored_text` can produce a directed grant;
 * every other origin is context, not instruction.
 */
export const SPAN_SOURCE_KINDS = [
  "authored_text",
  "quoted_text",
  "forwarded_text",
  "code_block",
  "attachment_body",
  "history",
  "link_preview",
  "transcript",
] as const;

export type SpanSourceKind = (typeof SPAN_SOURCE_KINDS)[number];

export type RequestedIntent = "read" | "list" | "inspect-archive" | "unspecified";

/** A structured span supplied by a channel adapter. */
export type AuthoredPathSpan = {
  startOffset: number;
  endOffset: number;
  sourceKind: SpanSourceKind;
  /** The raw path text exactly as the user wrote it. Never normalized here. */
  normalizedInput: string;
  /** Intent expressed by the same span. */
  requestedIntent: RequestedIntent;
};

export type UserDirectedLocalResource = {
  inboundMessageId: string;
  tenantId: string;
  userId: string;
  sessionKey: string;
  turnId: string;
  nodeId: string;
  rawPathSpan: AuthoredPathSpan;
  createdAtMs: number;
};

/** Intents that permit skipping the approval card. */
const DIRECT_READ_INTENTS: ReadonlySet<RequestedIntent> = new Set<RequestedIntent>([
  "read",
  "inspect-archive",
]);

export type DirectedGrantCheck =
  | { granted: true; operationHint: LocalFilesOperation }
  | {
      granted: false;
      reason:
        | "no-record"
        | "source-not-authored"
        | "intent-unspecified"
        | "intent-requires-approval"
        | "turn-mismatch";
    };

/**
 * Decide whether a resolved path may be read without an approval card.
 *
 * A record is only usable for the exact turn it was created in. Nothing here
 * consults the model's context, and there is no parameter a model could set to
 * claim a directed grant.
 */
export function evaluateDirectedGrant(params: {
  record: UserDirectedLocalResource | undefined;
  turn: { tenantId: string; userId: string; sessionKey: string; turnId: string };
}): DirectedGrantCheck {
  const record = params.record;
  if (!record) {
    return { granted: false, reason: "no-record" };
  }
  if (
    record.tenantId !== params.turn.tenantId ||
    record.userId !== params.turn.userId ||
    record.sessionKey !== params.turn.sessionKey ||
    record.turnId !== params.turn.turnId
  ) {
    return { granted: false, reason: "turn-mismatch" };
  }
  if (record.rawPathSpan.sourceKind !== "authored_text") {
    return { granted: false, reason: "source-not-authored" };
  }
  const intent = record.rawPathSpan.requestedIntent;
  if (intent === "unspecified") {
    // Path is clear but intent is not: ask, do not read (design 4.5).
    return { granted: false, reason: "intent-unspecified" };
  }
  if (!DIRECT_READ_INTENTS.has(intent)) {
    return { granted: false, reason: "intent-requires-approval" };
  }
  return {
    granted: true,
    operationHint: intent === "inspect-archive" ? "archive.list" : "fs.read",
  };
}

/**
 * Per-turn side table.
 *
 * Kept out of `MsgContext` on purpose: that object is a mutable bag passed by
 * reference and rewritten by later stages, so a record stored on it would be
 * writable by every downstream step. Records here are keyed by a value the tool
 * layer can re-derive, and are write-once per key — mirroring the first-writer-wins
 * stamping used by `applyInputProvenanceToUserMessage`
 * (`src/sessions/input-provenance.ts`).
 */
export class DirectedResourceRegistry {
  private readonly byKey = new Map<string, UserDirectedLocalResource[]>();

  static key(params: {
    tenantId: string;
    userId: string;
    sessionKey: string;
    turnId: string;
  }): string {
    const material = [params.tenantId, params.userId, params.sessionKey, params.turnId].join(
      "\u0000",
    );
    return crypto.createHash("sha256").update(material, "utf8").digest("hex");
  }

  /**
   * Record spans for a turn. Only `authored_text` spans are stored at all, so a
   * quoted or attachment-derived path cannot become a grant later.
   *
   * Write-once: a second call for the same turn is ignored, so a later stage
   * cannot append a span the entry layer did not see.
   */
  record(params: {
    inboundMessageId: string;
    tenantId: string;
    userId: string;
    sessionKey: string;
    turnId: string;
    nodeId: string;
    spans: readonly AuthoredPathSpan[];
    nowMs?: number;
  }): { stored: number; alreadyRecorded: boolean } {
    const key = DirectedResourceRegistry.key(params);
    if (this.byKey.has(key)) {
      return { stored: 0, alreadyRecorded: true };
    }
    const now = params.nowMs ?? Date.now();
    const records = params.spans
      .filter((span) => span.sourceKind === "authored_text")
      .map((span) => ({
        inboundMessageId: params.inboundMessageId,
        tenantId: params.tenantId,
        userId: params.userId,
        sessionKey: params.sessionKey,
        turnId: params.turnId,
        nodeId: params.nodeId,
        // Frozen so a downstream stage cannot rewrite the span it will be judged on.
        rawPathSpan: Object.freeze({ ...span }),
        createdAtMs: now,
      }));
    this.byKey.set(key, records);
    return { stored: records.length, alreadyRecorded: false };
  }

  /** All directed records for a turn. Empty when the channel supplied no spans. */
  list(params: {
    tenantId: string;
    userId: string;
    sessionKey: string;
    turnId: string;
  }): readonly UserDirectedLocalResource[] {
    return this.byKey.get(DirectedResourceRegistry.key(params)) ?? [];
  }

  /**
   * Find the record whose span names this exact raw path.
   *
   * Matching is on the raw text the user wrote, before any expansion, so the
   * lookup cannot be satisfied by a path the model synthesised from a resolved
   * canonical path it saw elsewhere.
   */
  find(params: {
    tenantId: string;
    userId: string;
    sessionKey: string;
    turnId: string;
    rawPath: string;
  }): UserDirectedLocalResource | undefined {
    const wanted = params.rawPath.trim();
    return this.list(params).find((record) => record.rawPathSpan.normalizedInput.trim() === wanted);
  }

  /** Drop a turn's records once the turn ends. */
  clearTurn(params: {
    tenantId: string;
    userId: string;
    sessionKey: string;
    turnId: string;
  }): void {
    this.byKey.delete(DirectedResourceRegistry.key(params));
  }

  size(): number {
    return this.byKey.size;
  }
}
