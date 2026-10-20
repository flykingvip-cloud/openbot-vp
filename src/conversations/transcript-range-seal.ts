/**
 * Deterministic, non-overlapping transcript range sealing (plan §5.3 / CL-P0-04).
 * Append must only seal after watermark; never whole-file path replay of sealed ranges.
 */
import { createHash } from "node:crypto";
import { buildMemorySourceIdentity } from "./ids.js";
import type { MemorySourceIdentity, TranscriptIngestWatermark } from "./types.js";

export type SealableMessage = {
  /** Stable message id (JSONL message.id or synthetic). */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 0-based index among user/assistant messages only. */
  turnIndex: number;
  parentId?: string;
};

export type TranscriptRangeSealOptions = {
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  messages: SealableMessage[];
  watermark: TranscriptIngestWatermark | null;
  maxTurns?: number;
  maxBytes?: number;
  now?: string;
};

export type SealedTranscriptRange = {
  identity: MemorySourceIdentity;
  messages: SealableMessage[];
  normalizedText: string;
};

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_BYTES = 32 * 1024;
const TURN_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

export function isValidTranscriptMessageId(id: string): boolean {
  return TURN_ID_RE.test(id);
}

/**
 * Synthetic id for historical JSONL without message.id.
 * Does not rewrite the file (preserves checksums).
 */
export function synthesizeTranscriptMessageId(params: {
  sessionId: string;
  jsonlLine1Based: number;
  role: string;
  normalizedText: string;
}): string {
  const digest = createHash("sha256").update(params.normalizedText).digest("hex").slice(0, 16);
  return `syn:${params.sessionId}:${params.jsonlLine1Based}:${params.role}:${digest}`;
}

export function normalizeSealText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function computeRangeContentChecksum(texts: string[]): string {
  const joined = texts.map(normalizeSealText).join("\n");
  return createHash("sha256").update(joined).digest("hex");
}

/**
 * Build operation / ingestion key material excluding path and syncReason (plan §5.3.4).
 */
export function buildSealOperationKey(params: {
  dataPlaneId: string;
  sourceIdentityId: string;
  contentChecksum: string;
  scopeKey?: string;
}): string {
  return [
    "seal-op-v1",
    params.dataPlaneId,
    params.sourceIdentityId,
    params.contentChecksum,
    params.scopeKey ?? "",
  ].join("|");
}

/**
 * Seal complete ranges after watermark. Incomplete tail remains unsealed.
 */
export function sealTranscriptRanges(options: TranscriptRangeSealOptions): {
  sealed: SealedTranscriptRange[];
  nextWatermark: TranscriptIngestWatermark;
} {
  const now = options.now ?? new Date().toISOString();
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const messages = [...options.messages].toSorted((a, b) => a.turnIndex - b.turnIndex);

  const lastSealedIndex = options.watermark?.lastSealedTurnIndex ?? -1;
  const candidates = messages.filter((m) => m.turnIndex > lastSealedIndex);

  const sealed: SealedTranscriptRange[] = [];
  let cursor = 0;

  while (cursor < candidates.length) {
    const segment: SealableMessage[] = [];
    let bytes = 0;
    let i = cursor;
    for (; i < candidates.length; i++) {
      const msg = candidates[i];
      const text = normalizeSealText(msg.text);
      const nextBytes = bytes + Buffer.byteLength(text, "utf8");
      if (segment.length > 0 && (segment.length >= maxTurns || nextBytes > maxBytes)) {
        break;
      }
      segment.push(msg);
      bytes = nextBytes;
      // Prefer break after a complete turn (assistant following user) when segment non-empty
      if (
        segment.length >= 2 &&
        msg.role === "assistant" &&
        (segment.length >= maxTurns || bytes >= maxBytes)
      ) {
        i++;
        break;
      }
    }

    // Incomplete final segment: leave unsealed unless it is a full maxTurns pack.
    const isComplete =
      segment.length > 0 &&
      (segment.length >= maxTurns ||
        bytes >= maxBytes ||
        // seal if next message would start a new segment and we have at least one full UA pair
        i < candidates.length ||
        (segment.length >= 2 && segment[segment.length - 1].role === "assistant"));

    if (!isComplete || segment.length === 0) {
      break;
    }

    const first = segment[0];
    const last = segment[segment.length - 1];
    const texts = segment.map((m) => m.text);
    const contentChecksum = computeRangeContentChecksum(texts);
    const identity = buildMemorySourceIdentity({
      dataPlaneId: options.dataPlaneId,
      conversationId: options.conversationId,
      bindingId: options.bindingId,
      sessionId: options.sessionId,
      firstTurnId: first.id,
      lastTurnId: last.id,
      turnIndexRange: [first.turnIndex, last.turnIndex],
      contentChecksum,
      createdAt: now,
    });
    sealed.push({
      identity,
      messages: segment,
      normalizedText: texts.map(normalizeSealText).join("\n"),
    });
    cursor = i;
  }

  const lastSealed = sealed[sealed.length - 1];
  const nextWatermark: TranscriptIngestWatermark = lastSealed
    ? {
        schemaVersion: 1,
        dataPlaneId: options.dataPlaneId,
        bindingId: options.bindingId,
        sessionId: options.sessionId,
        lastSealedTurnId: lastSealed.identity.lastTurnId,
        lastSealedTurnIndex: lastSealed.identity.turnIndexRange[1],
        lastContentChecksum: lastSealed.identity.contentChecksum,
        updatedAt: now,
      }
    : (options.watermark ?? {
        schemaVersion: 1,
        dataPlaneId: options.dataPlaneId,
        bindingId: options.bindingId,
        sessionId: options.sessionId,
        lastSealedTurnId: null,
        lastSealedTurnIndex: null,
        lastContentChecksum: null,
        updatedAt: now,
      });

  return { sealed, nextWatermark };
}
