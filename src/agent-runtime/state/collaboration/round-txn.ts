import fs from "node:fs/promises";
import {
  appendJsonlDurable,
  withRoundLock,
  writeJsonDurable,
} from "../../../gateway/collaboration-dispatch/round-store-io.js";

/**
 * Collaboration durable writes. Each store keeps its own directory and line kind.
 * Callers keep flag checks and post-lock fan-out. The lock still wraps read, check, and append.
 */

export type BoardClaimMutateResult<TItem> =
  | { ok: true; value: TItem; skipAppend?: boolean }
  | { ok: false; reason: string; message: string };

export async function mutateBoardClaimLog<TItem>(params: {
  claimsDir: string;
  stem: string;
  logPath: string;
  itemId: string;
  at: number;
  readLines: () => Promise<unknown>;
  currentOf: (lines: unknown) => TItem | null;
  mutate: (
    current: TItem,
  ) => BoardClaimMutateResult<TItem> | Promise<BoardClaimMutateResult<TItem>>;
}): Promise<BoardClaimMutateResult<TItem>> {
  return withRoundLock(params.claimsDir, params.stem, async () => {
    const lines = await params.readLines();
    const current = params.currentOf(lines);
    if (!current) {
      return {
        ok: false,
        reason: "not_found",
        message: `board claim item not found: ${params.itemId}`,
      };
    }
    const mutated = await params.mutate(current);
    if (!mutated.ok) {
      return mutated;
    }
    if (mutated.skipAppend) {
      return { ok: true, value: mutated.value };
    }
    await fs.mkdir(params.claimsDir, { recursive: true });
    await appendJsonlDurable(params.logPath, {
      kind: "board_claim",
      at: params.at,
      item: mutated.value,
    });
    return { ok: true, value: mutated.value };
  });
}

export async function appendBoardClaimLog<TItem>(params: {
  claimsDir: string;
  stem: string;
  logPath: string;
  at: number;
  item: TItem;
}): Promise<void> {
  await withRoundLock(params.claimsDir, params.stem, async () => {
    await fs.mkdir(params.claimsDir, { recursive: true });
    await appendJsonlDurable(params.logPath, {
      kind: "board_claim",
      at: params.at,
      item: params.item,
    });
  });
}

export async function commitPrivateTodolistLog<TLine, TResult extends { ok: boolean }>(params: {
  dir: string;
  stem: string;
  logPath: string;
  at: number | (() => number);
  readLines: () => Promise<TLine[]>;
  decide: (lines: TLine[]) => { result: TResult; appends?: unknown[] };
}): Promise<TResult> {
  return withRoundLock(params.dir, params.stem, async () => {
    await fs.mkdir(params.dir, { recursive: true });
    const lines = await params.readLines();
    const outcome = params.decide(lines);
    if (outcome.result.ok && outcome.appends && outcome.appends.length > 0) {
      const at = typeof params.at === "function" ? params.at() : params.at;
      for (const todolist of outcome.appends) {
        await appendJsonlDurable(params.logPath, {
          kind: "executor_private_todolist",
          at,
          todolist,
        });
      }
    }
    return outcome.result;
  });
}

export async function appendPeerReviewLog<TEvent>(params: {
  reviewsDir: string;
  stem: string;
  logPath: string;
  at: number;
  event: TEvent;
}): Promise<void> {
  await withRoundLock(params.reviewsDir, params.stem, async () => {
    await fs.mkdir(params.reviewsDir, { recursive: true });
    await appendJsonlDurable(params.logPath, {
      kind: "peer_review",
      at: params.at,
      event: params.event,
    });
  });
}

/** Handoff lock. Recovery and status checks stay in the callback; wake stays outside. */
export function withHandoffRoundLock<T>(
  handoffsDir: string,
  stem: string,
  run: () => Promise<T>,
): Promise<T> {
  return withRoundLock(handoffsDir, stem, run);
}

export async function appendHandoffLogLine<TLine>(logPath: string, line: TLine): Promise<void> {
  await appendJsonlDurable(logPath, line);
}

export async function writeHandoffJson<TValue>(filePath: string, value: TValue): Promise<void> {
  await writeJsonDurable(filePath, value);
}
