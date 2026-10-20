import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_EMBEDDING_MAX_BATCH_INPUTS,
  embedRemoteInputsInPages,
} from "./embedding-remote-batch.js";

describe("embedRemoteInputsInPages", () => {
  it("keeps a single request when the batch is within the DashScope cap", async () => {
    const embedPage = vi.fn(async (page: string[]) => page.map((text) => text.length));
    const texts = Array.from({ length: REMOTE_EMBEDDING_MAX_BATCH_INPUTS }, (_, i) => `c${i}`);
    await expect(embedRemoteInputsInPages({ inputs: texts, embedPage })).resolves.toEqual(
      texts.map((text) => text.length),
    );
    expect(embedPage).toHaveBeenCalledOnce();
  });

  it("splits 25 inputs into pages of 10 so DashScope never sees >10", async () => {
    const seen: number[] = [];
    const embedPage = vi.fn(async (page: string[]) => {
      seen.push(page.length);
      if (page.length > REMOTE_EMBEDDING_MAX_BATCH_INPUTS) {
        throw new Error("批量大小无效，不应大于 10");
      }
      return page.map(() => [1]);
    });
    const texts = Array.from({ length: 25 }, (_, i) => `chunk-${i}`);
    const vectors = await embedRemoteInputsInPages({ inputs: texts, embedPage });
    expect(seen).toEqual([10, 10, 5]);
    expect(vectors).toHaveLength(25);
    expect(embedPage).toHaveBeenCalledTimes(3);
  });
});
