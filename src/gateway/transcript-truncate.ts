/**
 * Transcript truncation with reversible tail archive (chat-checkpoint-rollback P3).
 *
 * Restoring to a checkpoint removes conversation messages after that point. To
 * keep the operation reversible (design principle 2), the removed tail is first
 * archived to a sibling file before the main transcript JSONL is atomically
 * rewritten up to (and including) the boundary message line.
 *
 * The boundary is located by the top-level entry `id` of the JSONL line
 * (matching `MemoryCheckpoint.boundary_message_id`). When the boundary cannot be
 * found the operation is a no-op so no data is ever lost.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isTranscriptStartBoundary } from "../auto-reply/reply/chat-checkpoint-boundary.js";

export type TranscriptTruncateResult = {
  /** Whether the boundary line was located in the transcript. */
  boundaryFound: boolean;
  /** Number of trailing lines removed (0 when boundary is the last line). */
  removedCount: number;
  /** Whether the main transcript was rewritten (i.e. lines were removed). */
  truncated: boolean;
  /** Entry ids removed from the main transcript (for recall deny watermark). */
  removedMessageIds?: string[];
  /** Absolute path to the archived tail, when one was written. */
  archivePath?: string;
};

function resolveBoundaryIndex(
  lines: string[],
  boundaryMessageId: string | undefined,
): number | null {
  if (!boundaryMessageId) {
    return null;
  }
  if (isTranscriptStartBoundary(boundaryMessageId)) {
    const firstMessage = lines.findIndex((line) => {
      try {
        return (JSON.parse(line) as { type?: unknown }).type === "message";
      } catch {
        return false;
      }
    });
    // Keep session header lines; drop every message (first-turn restore).
    return firstMessage < 0 ? lines.length - 1 : firstMessage - 1;
  }
  const index = lines.findIndex((line) => parseEntryId(line) === boundaryMessageId);
  return index >= 0 ? index : null;
}

function parseEntryId(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Truncate `transcriptPath` to the line whose entry id equals
 * `boundaryMessageId`, archiving the removed tail to `archivePath` first.
 */
export async function truncateTranscriptToBoundary(params: {
  transcriptPath: string;
  boundaryMessageId: string | undefined;
  archivePath: string;
  /** When aborted, the transcript is left untouched. */
  signal?: AbortSignal;
}): Promise<TranscriptTruncateResult> {
  if (params.signal?.aborted) {
    const reason = params.signal.reason;
    throw reason instanceof Error ? reason : new Error("restore aborted");
  }
  if (!params.boundaryMessageId) {
    return { boundaryFound: false, removedCount: 0, truncated: false };
  }

  let content: string;
  try {
    content = params.signal
      ? await fs.readFile(params.transcriptPath, { encoding: "utf8", signal: params.signal })
      : await fs.readFile(params.transcriptPath, "utf8");
  } catch (err) {
    if (params.signal?.aborted) {
      throw err;
    }
    return { boundaryFound: false, removedCount: 0, truncated: false };
  }

  const lines = content.split("\n").filter((line) => line.length > 0);
  const boundaryIndex = resolveBoundaryIndex(lines, params.boundaryMessageId);
  if (boundaryIndex == null) {
    // Boundary already gone (e.g. compacted): do nothing rather than risk loss.
    return { boundaryFound: false, removedCount: 0, truncated: false };
  }

  if (params.signal?.aborted) {
    const reason = params.signal.reason;
    throw reason instanceof Error ? reason : new Error("restore aborted");
  }
  const head = lines.slice(0, boundaryIndex + 1);
  const tail = lines.slice(boundaryIndex + 1);
  if (tail.length === 0) {
    return { boundaryFound: true, removedCount: 0, truncated: false, removedMessageIds: [] };
  }

  const removedMessageIds = tail
    .map((line) => parseEntryId(line))
    .filter((id): id is string => Boolean(id));

  // 1) Archive the tail FIRST so truncation stays reversible even if the
  //    subsequent rewrite fails.
  await fs.mkdir(path.dirname(params.archivePath), { recursive: true });
  await fs.writeFile(params.archivePath, `${tail.join("\n")}\n`, "utf8");

  // 2) Atomically rewrite the main transcript to the boundary.
  const tmp = `${params.transcriptPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${head.join("\n")}\n`, "utf8");
  await fs.rename(tmp, params.transcriptPath);

  return {
    boundaryFound: true,
    removedCount: tail.length,
    truncated: true,
    removedMessageIds,
    archivePath: params.archivePath,
  };
}
