import { expect, it } from "vitest";
import { cleanupEmbeddedAttempt } from "./attempt-cleanup.js";

it.each([-1, 0, 1, 2, 3, 4, 5, 6, 7])(
  "releases all resources in order when step %s fails",
  async (failed) => {
    const calls: number[] = [];
    const step = (index: number) => () => {
      calls.push(index);
      if (failed === index) {
        throw new Error(`failed ${index}`);
      }
    };
    const cleanup = cleanupEmbeddedAttempt({
      removeContextCompiler: step(0),
      removeToolResultGuard: step(1),
      removeReplyReminder: step(2),
      removeReplyRewriter: step(3),
      flushToolResults: async () => step(4)(),
      disposeSession: step(5),
      releaseWebSocket: step(6),
      releaseLock: async () => step(7)(),
    });
    if (failed < 0) {
      await expect(cleanup).resolves.toBeUndefined();
    } else {
      await expect(cleanup).rejects.toThrow(`failed ${failed}`);
    }
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  },
);
